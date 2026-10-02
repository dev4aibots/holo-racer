/**
 * HOLO-RACER game world: endless holographic highway racing.
 * Owns the render loop, car physics, collisions, modes, countdown,
 * cameras, and wires together world/tracks/vehicles/traffic/coins/effects.
 */
import * as THREE from 'three';
import type { DriveInput, GameMode, GameSnapshot } from '../types.ts';
import { GAME } from '../config.ts';
import { World } from './world.ts';
import { buildEnvironment, updateEnvironment } from './tracks.ts';
import type { TrackVariant } from './tracks.ts';
import { buildHologramCar } from './vehicles.ts';
import { TrafficManager } from './traffic.ts';
import { CoinManager } from './coins.ts';
import { Effects } from './effects.ts';

export interface GameCallbacks {
  onSnapshot(s: GameSnapshot): void;
  onCoin(total: number): void;
  onCrash(): void;
  onCountdown(n: number): void;
}

type State = 'idle' | 'countdown' | 'running' | 'finished';

const ROAD_HALF = (GAME.LANES * GAME.LANE_WIDTH) / 2 - 1.0;
const PLAYER_HALF_LEN = 2.15;
const PLAYER_HALF_W = 0.95;
const TRAFFIC_HALF_LEN = 2.15;
const TRAFFIC_HALF_W = 0.95;
const SNAPSHOT_HZ = 10;
const TRIAL_SECONDS = 60;
const RUSH_SECONDS = 90;

const tmpDesired = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
const tmpPos = new THREE.Vector3();

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private world!: World;
  private playerCar!: THREE.Group;
  private playerWheels: THREE.Mesh[] = [];
  private traffic!: TrafficManager;
  private coins!: CoinManager;
  private effects!: Effects;
  private disposeEnv: (() => void) | null = null;
  private variant: TrackVariant = 'neon-city';

  private raf = 0;
  private lastT = 0;
  private state: State = 'idle';
  private mode: GameMode = 'cruise';
  private paused = false;
  private input: DriveInput = { steering: 0, throttle: 0, brake: 0 };

  private speed = 0;
  private distance = 0;
  private playerX = 0;
  private playerZ = 0;
  private coinCount = 0;
  private timeLeft: number | null = null;
  private speedLimitF = 1;
  private cameraMode: 'first' | 'third' = 'third';
  private camPos = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private camInit = false;
  private shake = 0;
  private countdownT = 0;
  private lastCount = 0;
  private crashCooldownUntil = 0;
  private crashedUntil = 0;
  private snapT = 0;

  private onResizeBound = (): void => this.resize();

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: GameCallbacks,
  ) {}

  async init(): Promise<void> {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, GAME.MAX_PIXEL_RATIO));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1500);
    this.scene.add(this.camera); // speed lines attach to the camera

    this.world = new World(this.scene);
    this.disposeEnv = buildEnvironment(this.scene, this.variant);

    this.playerCar = buildHologramCar(0x00e5ff);
    this.playerWheels = this.playerCar.userData.wheels as THREE.Mesh[];
    this.scene.add(this.playerCar);

    this.traffic = new TrafficManager(this.scene);
    this.coins = new CoinManager(this.scene);
    this.effects = new Effects(this.scene, this.camera);

    this.resize();
    window.addEventListener('resize', this.onResizeBound);

    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Start a run: resets state and plays the 3-2-1-GO countdown. */
  start(mode: GameMode): void {
    this.mode = mode;
    this.speed = 0;
    this.distance = 0;
    this.playerX = 0;
    this.playerZ = 0;
    this.coinCount = 0;
    this.timeLeft = mode === 'trial' ? TRIAL_SECONDS : mode === 'rush' ? RUSH_SECONDS : null;
    this.traffic.reset();
    this.coins.reset();
    this.snapT = 0;
    this.shake = 0;
    this.crashCooldownUntil = 0;
    this.crashedUntil = 0;
    this.input = { steering: 0, throttle: 0, brake: 0 };
    this.state = 'countdown';
    this.countdownT = 3.6;
    this.lastCount = 4;
  }

  setInput(input: DriveInput): void {
    this.input = input;
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  setCameraMode(m: 'first' | 'third'): void {
    this.cameraMode = m;
  }

  setSpeedLimit(f: number): void {
    this.speedLimitF = THREE.MathUtils.clamp(f, 0.2, 1);
  }

  setTrackVariant(v: TrackVariant): void {
    if (v === this.variant && this.disposeEnv) return;
    this.variant = v;
    this.world.setVariant(v);
    if (this.disposeEnv) this.disposeEnv();
    this.disposeEnv = buildEnvironment(this.scene, v);
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResizeBound);
    if (this.disposeEnv) this.disposeEnv();
    this.effects.dispose();
    this.coins.dispose();
    this.traffic.reset();
    this.world.dispose();
    this.renderer.dispose();
  }

  private loop = (t: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    if (!this.paused && dt > 0) this.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number): void {
    const now = performance.now();

    // Countdown before controls go live.
    if (this.state === 'countdown') {
      this.countdownT -= dt;
      const n = Math.ceil(this.countdownT);
      if (n !== this.lastCount && n >= 1 && n <= 3) {
        this.lastCount = n;
        this.cb.onCountdown(n);
      }
      if (this.countdownT <= 0) {
        this.state = 'running';
        this.cb.onCountdown(0); // GO
      }
    }

    const live = this.state === 'running';
    const drive: DriveInput = live ? this.input : { steering: 0, throttle: 0, brake: 0 };

    // Physics: Dr. Driving flavored.
    const maxSpeed = GAME.MAX_SPEED * this.speedLimitF;
    const drag = GAME.DRAG * (this.speed / GAME.MAX_SPEED);
    this.speed += (drive.throttle * GAME.ACCEL - drive.brake * GAME.BRAKE_DECEL - drag) * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, 0, maxSpeed);
    const speedFrac = this.speed / GAME.MAX_SPEED;
    const latV = drive.steering * GAME.STEER_SPEED * speedFrac;
    this.playerX = THREE.MathUtils.clamp(this.playerX + latV * dt, -ROAD_HALF, ROAD_HALF);
    this.distance += this.speed * dt;
    this.playerZ = -this.distance;

    // Mode timers.
    if (live && this.timeLeft !== null) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.state = 'finished';
        this.emitSnapshot(now); // final snapshot
      }
    }

    // Player car visuals.
    this.playerCar.position.set(this.playerX, 0, this.playerZ);
    this.playerCar.rotation.y = -drive.steering * 0.22;
    for (const w of this.playerWheels) w.rotation.x += (this.speed * dt) / 0.34;

    // Traffic + collisions.
    this.traffic.update(dt, this.playerZ, this.speed);
    if (live && now >= this.crashCooldownUntil) {
      for (const c of this.traffic.getCars()) {
        if (
          Math.abs(c.z - this.playerZ) < PLAYER_HALF_LEN + TRAFFIC_HALF_LEN &&
          Math.abs(c.x - this.playerX) < PLAYER_HALF_W + TRAFFIC_HALF_W
        ) {
          this.speed *= GAME.CRASH_SLOWDOWN;
          this.crashCooldownUntil = now + GAME.CRASH_COOLDOWN_MS;
          this.crashedUntil = now + 700;
          this.shake = 0.9;
          tmpPos.set(this.playerX, 1, this.playerZ - 1.5);
          this.effects.spawnCrash(tmpPos);
          this.cb.onCrash();
          break;
        }
      }
    }

    // Coins.
    const got = this.coins.update(dt, this.playerX, this.playerZ);
    if (got > 0) {
      this.coinCount += got;
      this.cb.onCoin(this.coinCount);
      tmpPos.set(this.playerX, 1.2, this.playerZ);
      this.effects.spawnCoin(tmpPos);
    }

    // World recycling + effects.
    this.world.update(this.playerZ);
    updateEnvironment(this.scene, this.playerZ);
    this.effects.update(dt, speedFrac);

    this.updateCamera(dt);

    // Snapshots ~10 Hz while running/countdown.
    if (this.state === 'running' || this.state === 'countdown') {
      this.snapT += dt;
      if (this.snapT >= 1 / SNAPSHOT_HZ) {
        this.snapT = 0;
        this.emitSnapshot(now);
      }
    }
  }

  private updateCamera(dt: number): void {
    if (this.cameraMode === 'third') {
      tmpDesired.set(this.playerX, 4.4, this.playerZ + 9);
      tmpLook.set(this.playerX, 1.4, this.playerZ - 8);
    } else {
      tmpDesired.set(this.playerX, 1.5, this.playerZ - 0.4);
      tmpLook.set(this.playerX, 1.0, this.playerZ - 30);
    }
    if (!this.camInit) {
      this.camPos.copy(tmpDesired);
      this.lookAt.copy(tmpLook);
      this.camInit = true;
    }
    const k = 1 - Math.exp(-dt * 6);
    this.camPos.lerp(tmpDesired, k);
    this.lookAt.lerp(tmpLook, k);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.7;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    this.camera.lookAt(this.lookAt);
  }

  private score(): number {
    const dist = Math.floor(this.distance);
    if (this.mode === 'trial') return dist;
    if (this.mode === 'rush') return this.coinCount * 100 + dist;
    return dist + this.coinCount * 25;
  }

  private emitSnapshot(now: number): void {
    this.cb.onSnapshot({
      speedKmh: Math.round(this.speed * 3.6),
      score: this.score(),
      coins: this.coinCount,
      mode: this.mode,
      timeLeft: this.timeLeft,
      crashed: now < this.crashedUntil,
    });
  }
}

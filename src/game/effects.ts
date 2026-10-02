/**
 * Effects: pooled particle bursts (crash sparks, coin sparkles) and
 * speed lines attached to the camera at high speed. All Points-based.
 */
import * as THREE from 'three';

interface Burst {
  points: THREE.Points;
  mat: THREE.PointsMaterial;
  vel: Float32Array;
  life: number;
  maxLife: number;
  gravity: number;
}

const SPEED_LINE_COUNT = 42;

export class Effects {
  private crashPool: Burst[] = [];
  private crashActive: Burst[] = [];
  private coinPool: Burst[] = [];
  private coinActive: Burst[] = [];
  private speedLines: THREE.LineSegments;
  private speedMat: THREE.LineBasicMaterial;
  private linePos: Float32Array;

  constructor(
    private scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    // Speed lines live in camera space: streaks rushing past at high speed.
    this.linePos = new Float32Array(SPEED_LINE_COUNT * 6);
    for (let i = 0; i < SPEED_LINE_COUNT; i++) this.resetLine(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.speedMat = new THREE.LineBasicMaterial({
      color: 0x9fd8ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.speedLines = new THREE.LineSegments(geo, this.speedMat);
    this.speedLines.frustumCulled = false;
    this.speedLines.visible = false;
    camera.add(this.speedLines);
  }

  private resetLine(i: number, randomZ: boolean): void {
    const x = (Math.random() - 0.5) * 26;
    const y = Math.random() * 9 - 1;
    const z = randomZ ? -6 - Math.random() * 130 : -130 - Math.random() * 20;
    const o = i * 6;
    this.linePos[o] = x;
    this.linePos[o + 1] = y;
    this.linePos[o + 2] = z;
    this.linePos[o + 3] = x;
    this.linePos[o + 4] = y;
    this.linePos[o + 5] = z - 4;
  }

  private makeBurst(n: number, color: number, size: number): Burst {
    const positions = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    this.scene.add(points);
    return { points, mat, vel: new Float32Array(n * 3), life: 0, maxLife: 1, gravity: 10 };
  }

  private launch(pool: Burst[], active: Burst[], n: number, color: number, size: number,
    pos: THREE.Vector3, speedMin: number, speedMax: number, life: number, gravity: number,
    upBias: number): void {
    let burst = pool.pop();
    if (!burst) {
      if (active.length >= 10) return;
      burst = this.makeBurst(n, color, size);
    }
    const positions = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      positions.setXYZ(i, pos.x, pos.y, pos.z);
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.35) * Math.PI;
      const sp = speedMin + Math.random() * (speedMax - speedMin);
      burst.vel[i * 3] = Math.cos(a) * Math.cos(e) * sp;
      burst.vel[i * 3 + 1] = Math.sin(e) * sp + upBias;
      burst.vel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * sp;
    }
    positions.needsUpdate = true;
    burst.life = life * (0.8 + Math.random() * 0.4);
    burst.maxLife = burst.life;
    burst.gravity = gravity;
    burst.mat.opacity = 1;
    burst.points.visible = true;
    active.push(burst);
  }

  spawnCrash(pos: THREE.Vector3): void {
    this.launch(this.crashPool, this.crashActive, 42, 0xffa030, 0.42, pos, 5, 16, 0.8, 15, 3);
  }

  spawnCoin(pos: THREE.Vector3): void {
    this.launch(this.coinPool, this.coinActive, 16, 0xffe066, 0.3, pos, 2, 6, 0.55, 5, 4);
  }

  private stepBurst(b: Burst, dt: number): boolean {
    b.life -= dt;
    if (b.life <= 0) {
      b.points.visible = false;
      return false;
    }
    const positions = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = positions.count;
    for (let i = 0; i < n; i++) {
      b.vel[i * 3 + 1] -= b.gravity * dt;
      positions.setXYZ(
        i,
        positions.getX(i) + b.vel[i * 3] * dt,
        Math.max(0.05, positions.getY(i) + b.vel[i * 3 + 1] * dt),
        positions.getZ(i) + b.vel[i * 3 + 2] * dt,
      );
    }
    positions.needsUpdate = true;
    b.mat.opacity = b.life / b.maxLife;
    return true;
  }

  update(dt: number, speed01: number): void {
    for (let i = this.crashActive.length - 1; i >= 0; i--) {
      if (!this.stepBurst(this.crashActive[i], dt)) {
        this.crashPool.push(this.crashActive[i]);
        this.crashActive.splice(i, 1);
      }
    }
    for (let i = this.coinActive.length - 1; i >= 0; i--) {
      if (!this.stepBurst(this.coinActive[i], dt)) {
        this.coinPool.push(this.coinActive[i]);
        this.coinActive.splice(i, 1);
      }
    }

    // Speed lines fade in above ~55% of max speed.
    const intensity = THREE.MathUtils.clamp((speed01 - 0.55) / 0.45, 0, 1);
    this.speedLines.visible = intensity > 0.01;
    if (this.speedLines.visible) {
      this.speedMat.opacity = intensity * 0.65;
      const rush = 30 + speed01 * 170;
      for (let i = 0; i < SPEED_LINE_COUNT; i++) {
        const o = i * 6;
        let z = this.linePos[o + 2] + rush * dt;
        if (z > -4) {
          this.resetLine(i, false);
          z = this.linePos[o + 2];
        } else {
          this.linePos[o + 2] = z;
        }
        const len = 2 + speed01 * 9;
        this.linePos[o + 5] = z - len;
      }
      (this.speedLines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    for (const b of [...this.crashPool, ...this.crashActive, ...this.coinPool, ...this.coinActive]) {
      this.scene.remove(b.points);
      b.points.geometry.dispose();
      b.mat.dispose();
    }
    this.speedLines.geometry.dispose();
    this.speedMat.dispose();
  }
}

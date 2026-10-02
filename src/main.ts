/**
 * HOLO-RACER bootstrap.
 *
 * Wiring: camera -> TrackingClient (worker) -> GestureEngine -> Game/Audio/HUD.
 * Pinch acts as a mouse: on pinchStarted we hit-test the pinch cursor against
 * [data-action] buttons and click whatever is underneath.
 * Keyboard fallback (arrows/WASD) drives the car if the camera is unavailable.
 */
import { GestureEngine, detectGrip, detectSingleFist, handScale, isFist, isPalmOpen, pinchDistance } from './gestures/engine.ts';
import { TrackingClient, type TrackingStatus } from './tracking/client.ts';
import { Game } from './game/game.ts';
import { AudioEngine } from './audio/synth.ts';
import { HUD } from './ui/hud.ts';
import { Screens } from './ui/screens.ts';
import { GestureLab } from './ui/gesture-lab.ts';
import { HandSkeletonOverlay } from './ui/hand-skeleton.ts';
import { VirtualWheel3D } from './ui/virtual-wheel-3d.ts';
import {
  cameraDiagnosticsText,
  cameraFixHint,
  gatherCameraDiagnostics,
  queryCameraPermission,
} from './ui/camera-diagnostics.ts';
import { createAdapter } from './net/adapter.ts';
import { loadCalibration, loadHighScores, saveCalibration, saveHighScore } from './storage.ts';
import {
  LM,
  type Calibration,
  type ControlState,
  type DriveInput,
  type GameMode,
  type GameSnapshot,
  type HandFrame,
  type TrackedHand,
} from './types.ts';

type AppState = 'boot' | 'menu' | 'starting' | 'racing' | 'paused' | 'finished';

const HAND_BONES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

class App {
  private state: AppState = 'boot';
  private cal: Calibration = loadCalibration();
  private highScores = loadHighScores();
  private engine = new GestureEngine(this.cal);
  private audio = new AudioEngine();
  private hud: HUD;
  private screens: Screens;
  private gestureLab: GestureLab | null = null;
  private skeleton: HandSkeletonOverlay | null = null;
  private wheel: VirtualWheel3D | null = null;
  private game: Game | null = null;
  private tracking: TrackingClient | null = null;
  private trackingDelegate = '—';
  private net = createAdapter('local');
  private playerId = `p-${Math.random().toString(36).slice(2, 10)}`;

  private latestHands: TrackedHand[] = [];
  private latestControl: ControlState | null = null;
  /** Timestamp of last frame with hands visible (for tracking-loss detection). */
  private lastHandsSeen = 0;
  /** Why the game was paused ('tracking-lost' enables auto-resume). */
  private pauseReason: string | null = null;
  /** True when the current race uses hand controls (not keyboard). */
  private usingHandControls = false;
  private mode: GameMode = 'cruise';
  private kbMode = false;
  /** Diagnostics panel shows only on the first camera failure per session. */
  private cameraDiagShown = false;
  /** True while the camera-setup environment screen is open. */
  private setupOpen = false;
  /** True when the pending camera request came from the setup screen. */
  private setupWanted = false;
  /** True when calibration was opened from setup (return there when done). */
  private returnToSetup = false;
  private setupCanvas: HTMLCanvasElement | null = null;
  private setupCtx: CanvasRenderingContext2D | null = null;
  /** Tiny offscreen canvas for ambient-light sampling. */
  private lumaCanvas: HTMLCanvasElement | null = null;
  private lastLuma = -1;
  private frameNo = 0;
  private keys = new Set<string>();
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private lastInput: DriveInput = { steering: 0, throttle: 0, brake: 0 };

  constructor() {
    const uiRoot = document.getElementById('ui-root')!;
    this.hud = new HUD(uiRoot, {
      onPause: () => {
        if (this.state === 'racing') this.pause();
        else if (this.state === 'paused') this.resume();
      },
    });
    this.screens = new Screens(uiRoot, {
      onStart: (m) => void this.startRace(m),
      onResume: () => this.resume(),
      onRestart: () => void this.startRace(this.mode),
      onQuitToMenu: () => this.quitToMenu(),
      onOpenSettings: () => this.screens.showSettings(this.cal, (c) => this.applyCalibration(c)),
      onOpenCalibration: () => this.screens.showCalibration(() => this.sampleCalibration()),
      onOpenHowTo: () => this.screens.showHowTo(),
      onOpenCameraSetup: () => void this.openCameraSetup(),
      onCloseOverlay: () => this.closeOverlay(),
      onCalibrationDone: (p) => {
        this.cal = { ...this.cal, ...p };
        saveCalibration(this.cal);
        this.engine.setCalibration(this.cal);
        // Return to the setup environment when calibration started there.
        if (this.returnToSetup) {
          this.returnToSetup = false;
          void this.openCameraSetup();
          return;
        }
        // Auto-launch the race that was waiting on calibration.
        if (this.pendingMode) {
          const m = this.pendingMode;
          this.pendingMode = null;
          void this.startRace(m);
        }
      },
    });

    // Gesture Lab (diagnostics) — hidden until opened from camera setup.
    this.gestureLab = new GestureLab(uiRoot, {
      onBack: () => this.closeGestureLab(),
      onCopy: () => {
        const m = this.tracking?.getMetrics();
        const text = this.gestureLab!.snapshot(
          {
            inferMs: m?.inferMs ?? 0,
            fps: m?.fps ?? 0,
            degraded: m?.degraded ?? false,
            delegate: this.trackingDelegate,
          },
          this.latestControl,
        );
        void navigator.clipboard?.writeText(text).then(
          () => this.hud.flash('Readings copied'),
          () => this.hud.flash('Copy failed — screenshot instead'),
        );
      },
    });
    this.overlay = document.createElement('canvas');
    this.overlay.id = 'glove-overlay';
    document.getElementById('app')!.appendChild(this.overlay);
    const octx = this.overlay.getContext('2d');
    if (!octx) throw new Error('overlay 2d context unavailable');
    this.octx = octx;
    this.resizeOverlay();
    window.addEventListener('resize', () => {
      this.resizeOverlay();
      this.game?.resize();
    });

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'racing') this.pause();
    });

    this.initOverlays();
    void this.boot();
  }

  private async boot(): Promise<void> {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.game = new Game(canvas, {
      onSnapshot: (s: GameSnapshot) => this.onSnapshot(s),
      onCoin: () => this.audio.coin(),
      onCrash: () => {
        this.audio.crash();
        this.hud.flash('CRASH!');
      },
      onCountdown: (n: number) => {
        this.audio.countdown(n);
        this.hud.showCountdown(n);
      },
    });
    try {
      await this.game.init();
    } catch (err) {
      // GPU-less environments (rare): fail gracefully instead of a blank page.
      console.error('[holo-racer] WebGL init failed:', err);
      this.screens.showFatal(
        'Graphics unavailable',
        'HOLO-RACER needs WebGL to render its holographic world, and this browser could not provide it.',
      );
      return;
    }
    this.game.setCameraMode(this.cal.camera);
    this.game.setSpeedLimit(this.cal.speedLimit);
    this.state = 'menu';
    // Self-diagnosing boot: inside a preview/sandbox the page is not a secure
    // context, so the camera API can never exist here. Say so up front instead
    // of letting the user chase a phantom camera problem.
    if (!window.isSecureContext || !navigator.mediaDevices) {
      this.screens.showInsecureWarning(() => {
        this.screens.hideAll();
        this.screens.showMenu(this.highScores[this.mode]);
      });
    } else {
      this.screens.showMenu(this.highScores[this.mode]);
    }
    requestAnimationFrame(() => this.renderOverlay());
    // In-game self-test automation: `?selftest=1` runs checks against the
    // live app and renders a report. Lazy import keeps it out of the play bundle.
    if (new URLSearchParams(location.search).has('selftest')) {
      void import('./selftest/run.ts').then((m) => m.runSelfTest());
    }
  }

  // ---------------- race lifecycle ----------------

  private async startRace(mode: GameMode): Promise<void> {
    if (this.state === 'starting' || this.state === 'racing') return;
    this.mode = mode;
    this.screens.hideAll();
    this.state = 'starting';
    this.hud.setVisible(true);
    this.hud.flash('Starting…');

    await this.audio.init().catch(() => undefined);
    this.audio.setMuted(this.cal.muted);

    // Tracking must be up before calibration so the sampler sees live hands.
    await this.ensureTracking();

    // First run (with a camera): force calibration so steering neutral is real.
    if (!this.kbMode && !this.wasCalibrated()) {
      this.pendingMode = mode;
      this.state = 'menu';
      this.screens.showCalibration(() => this.sampleCalibration());
      this.hud.flash('Calibrate your grip, then race!');
      return;
    }
    this.launchGame();
  }

  private wasCalibrated(): boolean {
    // Defaults are all-zero angle + 0.16 scale; any real capture changes these.
    return this.cal.neutralAngle !== 0 || this.cal.neutralScale !== 0.16;
  }

  private pendingMode: GameMode | null = null;

  private async ensureTracking(): Promise<void> {
    const video = document.getElementById('cam-feed') as HTMLVideoElement;
    if (!this.tracking) {
      this.tracking = new TrackingClient(video, {
        onFrame: (f) => this.onHandFrame(f),
        onStatus: (s, d) => this.onTrackingStatus(s, d),
      });
    }
    try {
      await this.tracking.start();
      this.kbMode = false;
    } catch (e) {
      // Camera unavailable: keyboard fallback so the game is still playable.
      this.kbMode = true;
      if (!this.cameraDiagShown) {
        // First failure this session: show the full diagnostics panel so the
        // user can actually fix the underlying problem. Callbacks continue.
        this.cameraDiagShown = true;
        const d = await gatherCameraDiagnostics((e as Error)?.cause);
        this.screens.showCameraDiagnostics(d, cameraFixHint(d), {
          onRetry: () => {
            this.cameraDiagShown = false;
            this.state = 'menu';
            if (this.setupWanted) {
              this.setupWanted = false;
              void this.openCameraSetup();
            } else {
              void this.startRace(this.mode);
            }
          },
          onCopy: () => {
            const text = cameraDiagnosticsText(d);
            void navigator.clipboard?.writeText(text).then(
              () => this.hud.flash('Diagnostics copied'),
              () => this.hud.flash('Copy failed — screenshot the panel'),
            );
          },
          onKeyboard: () => {
            this.screens.hideAll();
            this.launchGame();
          },
        });
        return;
      }
      this.hud.flash('No camera — keyboard mode (WASD/arrows)');
    }
  }

  // ---------------- camera & gesture setup environment ----------------

  /**
   * Opens the gesture environment: requests the camera (this is where the
   * browser permission prompt appears), then shows the live preview with
   * skeleton overlay, tracking status and environment checklist.
   */
  private async openCameraSetup(): Promise<void> {
    if (this.state !== 'menu' || this.setupOpen) return;
    this.screens.hideAll();
    this.hud.setVisible(false);
    this.setupWanted = true;
    this.hud.flash('Requesting camera…');
    await this.ensureTracking();
    this.setupWanted = false;
    if (this.kbMode) return; // ensureTracking showed the diagnostics panel.

    // Camera is live: build the environment screen.
    const feed = document.getElementById('cam-feed') as HTMLVideoElement;
    this.screens.showCameraSetup({
      onCalibrate: () => {
        this.returnToSetup = true;
        this.setupOpen = false;
        this.screens.showCalibration(() => this.sampleCalibration());
      },
      onRace: () => {
        this.closeCameraSetup();
        void this.startRace(this.mode);
      },
      onBack: () => this.closeCameraSetup(),
      onLab: () => this.openGestureLab(),
    });
    const preview = document.getElementById('setup-preview') as HTMLVideoElement | null;
    const stream = feed.srcObject as MediaStream | null;
    if (preview && stream) {
      preview.srcObject = stream;
      void preview.play().catch(() => undefined);
    }
    this.setupCanvas = document.getElementById('setup-skeleton') as HTMLCanvasElement | null;
    this.setupCtx = this.setupCanvas?.getContext('2d') ?? null;
    const permEl = document.getElementById('setup-perm');
    if (permEl) {
      const p = await queryCameraPermission();
      permEl.textContent = `Camera permission: ${p}`;
    }
    this.setupOpen = true;
  }

  private closeCameraSetup(): void {
    this.setupOpen = false;
    this.setupCanvas = null;
    this.setupCtx = null;
    this.screens.hideAll();
    this.state = 'menu';
    this.screens.showMenu(this.highScores[this.mode]);
  }

  /** Open the Gesture Lab diagnostics overlay (from camera setup). */
  private openGestureLab(): void {
    this.setupOpen = false;
    this.screens.hideAll();
    this.gestureLab?.show();
  }

  private closeGestureLab(): void {
    this.gestureLab?.hide();
    // Return to the camera setup environment.
    void this.openCameraSetup();
  }

  /** Create the hand-driven control overlays (skeleton + virtual wheel). */
  private initOverlays(): void {
    this.skeleton = new HandSkeletonOverlay();
    this.wheel = new VirtualWheel3D();
    this.applyOverlaySettings();
  }

  /** Apply settings toggles to the overlays. */
  private applyOverlaySettings(): void {
    this.skeleton?.setVisible(this.cal.showSkeleton && this.usingHandControls);
    this.wheel?.setVisible(this.cal.showWheel && this.usingHandControls);
  }

  /** Draw the mirrored skeleton overlay + update setup readouts. */
  private updateSetupScreen(): void {
    const canvas = this.setupCanvas;
    const ctx = this.setupCtx;
    if (!canvas || !ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    // Mirrored to match the flipped preview video.
    // (latestHands are already mirror-mapped by the tracking client,
    //  and the preview video is CSS-flipped — so draw directly.)
    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.9)';
    ctx.shadowColor = 'rgba(0, 240, 255, 0.9)';
    ctx.shadowBlur = 10;
    for (const hand of this.latestHands) {
      const pts = hand.landmarks.map((p) => ({ x: p.x * w, y: p.y * h }));
      ctx.beginPath();
      for (const [a, b] of HAND_BONES) {
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Live status readouts (cheap DOM writes, throttled to every 6th frame).
    if (this.frameNo % 6 !== 0) return;
    const handsEl = document.getElementById('setup-hands');
    if (handsEl) {
      const parts = this.latestHands.map((hd, i) => {
        const shape = isFist(hd) ? '✊ fist' : isPalmOpen(hd) ? '🖐 open' : '✋ hand';
        return `hand${i + 1}: ${shape}`;
      });
      handsEl.textContent = this.latestHands.length === 0
        ? 'Hands: — (show your hands to the camera)'
        : `Hands: ${this.latestHands.length} (${parts.join(' · ')})`;
    }
    this.setCheck('setup-frame', this.latestHands.length > 0
      ? { cls: 'pass', label: `${this.latestHands.length} hand${this.latestHands.length > 1 ? 's' : ''} in frame` }
      : { cls: 'fail', label: 'No hands visible — move into frame' });

    // Distance check from average hand scale vs calibrated neutral.
    const scales = this.latestHands.map((hd) => handScale(hd));
    if (scales.length > 0) {
      const avg = scales.reduce((a, b) => a + b, 0) / scales.length;
      const ratio = avg / Math.max(0.05, this.cal.neutralScale);
      if (ratio < 0.7) this.setCheck('setup-dist', { cls: 'warn', label: 'Too far — move closer' });
      else if (ratio > 1.6) this.setCheck('setup-dist', { cls: 'warn', label: 'Too close — back up a little' });
      else this.setCheck('setup-dist', { cls: 'pass', label: 'Distance looks good' });
    } else {
      this.setCheck('setup-dist', { cls: '', label: 'Hand distance' });
    }

    // Lighting check from sampled frame luminance.
    if (this.lastLuma >= 0) {
      if (this.lastLuma < 40) this.setCheck('setup-light', { cls: 'fail', label: 'Too dark — face a lamp or window' });
      else if (this.lastLuma > 215) this.setCheck('setup-light', { cls: 'warn', label: 'Very bright — avoid backlight' });
      else this.setCheck('setup-light', { cls: 'pass', label: 'Lighting looks good' });
    }
  }

  private setCheck(id: string, s: { cls: string; label: string }): void {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `check${s.cls ? ' ' + s.cls : ''}`;
    const label = el.querySelector('span:last-child');
    if (label) label.textContent = s.label;
  }

  /** Sample ambient brightness from the camera feed (~2x/sec). */
  private sampleLuma(): void {
    const feed = document.getElementById('cam-feed') as HTMLVideoElement | null;
    if (!feed || feed.readyState < 2 || feed.videoWidth === 0) return;
    if (!this.lumaCanvas) {
      this.lumaCanvas = document.createElement('canvas');
      this.lumaCanvas.width = 32;
      this.lumaCanvas.height = 32;
    }
    const c = this.lumaCanvas.getContext('2d', { willReadFrequently: true });
    if (!c) return;
    c.drawImage(feed, 0, 0, 32, 32);
    const data = c.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    this.lastLuma = sum / (data.length / 4);
  }

  private launchGame(): void {
    this.game!.setTrackVariant(this.mode === 'cruise' ? 'coast' : 'neon-city');
    this.game!.setPaused(false);
    this.game!.start(this.mode);
    this.state = 'racing';
    this.usingHandControls = !this.kbMode;
    this.pauseReason = null;
    this.lastHandsSeen = 0;
    this.applyOverlaySettings();
    // Clear any stale "waiting for camera" banner; keyboard mode gets its own.
    this.hud.clearFlash();
    if (this.kbMode) this.hud.flash('No camera — keyboard mode (WASD/arrows)');
  }

  private pause(): void {
    if (this.state !== 'racing') return;
    this.state = 'paused';
    this.game!.setPaused(true);
    this.audio.pause();
    this.screens.showPause();
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.screens.hideAll();
    this.game!.setPaused(false);
    this.audio.resume();
    this.state = 'racing';
  }

  private quitToMenu(): void {
    this.state = 'menu';
    this.pendingMode = null;
    this.game!.setPaused(true);
    this.screens.showMenu(this.highScores[this.mode]);
    this.hud.setVisible(false);
  }

  private closeOverlay(): void {
    if (this.state === 'paused') this.resume();
    else if (this.screens.currentScreenId === 'camdiag') {
      // Escape on the camera-diagnostics panel = play with keyboard.
      this.screens.hideAll();
      this.launchGame();
    } else if (this.screens.currentScreenId === 'setup') {
      this.closeCameraSetup();
    } else if (this.state === 'menu') {
      // Closing settings/howto/calibration from the menu → back to menu.
      this.screens.showMenu(this.highScores[this.mode]);
    } else this.screens.hideAll();
  }

  // ---------------- per-frame wiring ----------------

  private onHandFrame(frame: HandFrame): void {
    this.latestHands = frame.hands;
    const c = this.engine.update(frame);
    this.latestControl = c;

    // Tracking-loss autopause: if racing with hand controls and hands vanish
    // for >300ms, pause with a clear message. Instant resume on reacquire.
    // (Prevents the car driving blind when tracking drops.)
    const now = performance.now();
    if (frame.hands.length > 0) {
      this.lastHandsSeen = now;
      if (this.state === 'paused' && this.pauseReason === 'tracking-lost') {
        this.pauseReason = null;
        this.resume();
      }
    } else if (
      this.state === 'racing' &&
      this.usingHandControls &&
      this.lastHandsSeen > 0 &&
      now - this.lastHandsSeen > 300
    ) {
      this.pauseReason = 'tracking-lost';
      this.pause();
      this.hud.flash('TRACKING INTERRUPTED — show your hands', 3000);
    }

    // Gesture Lab live update (if open).
    if (this.gestureLab?.isOpen && this.tracking) {
      const m = this.tracking.getMetrics();
      this.gestureLab.update(
        {
          inferMs: m.inferMs,
          fps: m.fps,
          degraded: m.degraded,
          delegate: this.trackingDelegate,
        },
        c,
      );
    }

    // Pinch cursor + pinch-to-click work on menus too (calibration, pause).
    this.hud.showCursor(c.pinch.x, c.pinch.y, c.pinch.active, frame.hands.length > 0);
    if (c.pinchStarted) this.pinchClick(c.pinch.x, c.pinch.y);

    // Hand-driven control overlays: skeleton fingers + virtual wheel.
    // Only during racing/paused with hand controls (not on menus).
    const showOverlays = (this.state === 'racing' || this.state === 'paused')
      && this.usingHandControls;
    if (showOverlays) {
      this.skeleton?.draw(frame.hands.map((h) => ({
        landmarks: h.landmarks,
        label: h.handedness === 'Unknown' ? 'Left' : h.handedness,
        grip: c.gripLocked,
      })));
      // Grip markers: left/right hand wrist positions for the wheel.
      const lw = frame.hands.find((h) => h.handedness === 'Left')?.landmarks[0];
      const rw = frame.hands.find((h) => h.handedness === 'Right')?.landmarks[0];
      this.wheel?.update(
        c.steering,
        c.gripLocked,
        lw ? { x: 1 - lw.x, y: lw.y } : null,
        rw ? { x: 1 - rw.x, y: rw.y } : null,
      );
    } else {
      this.skeleton?.draw([]);
    }

    if (this.state === 'racing' || this.state === 'paused') {
      const input: DriveInput = { steering: c.steering, throttle: c.throttle, brake: c.brake };
      this.lastInput = input;
      if (this.state === 'racing') {
        this.game!.setInput(input);
        this.audio.setEngine(
          Math.min(1, Math.abs(input.throttle - input.brake) + 0.15),
          input.throttle,
        );
      }
      this.hud.update(
        this.lastSnapshot ?? emptySnapshot(),
        c.quality,
        c.gripLocked,
      );

      // Palms-open hold = pause toggle.
      if (c.pauseRequested) {
        if (this.state === 'racing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
    }
  }

  private lastSnapshot: GameSnapshot | null = null;

  private onSnapshot(s: GameSnapshot): void {
    this.lastSnapshot = s;
    if (this.state === 'racing') {
      if (this.latestControl) {
        this.hud.update(s, this.latestControl.quality, this.latestControl.gripLocked);
      } else {
        // Keyboard fallback: no tracking frames, still keep the HUD live.
        this.hud.update(s, 0, false);
      }
    }
    // Multiplayer: broadcast quantized state (local adapter = no-op).
    if (this.net.connected && this.state === 'racing') {
      this.net.sendState({
        id: this.playerId,
        steer: Math.round(s.speedKmh === 0 ? 0 : this.lastInput.steering * 127),
        speed: Math.round(Math.min(1, s.speedKmh / 230) * 255),
        lane: 0,
        dist: Math.round(s.score % 4000),
      });
    }
    // Timed modes: finish once.
    if (s.timeLeft !== null && s.timeLeft <= 0 && this.state === 'racing') {
      this.finishRace(s);
    }
  }

  private finishRace(s: GameSnapshot): void {
    this.state = 'finished';
    this.game!.setPaused(true);
    const isBest = saveHighScore(this.mode, s.score);
    this.highScores = loadHighScores();
    this.hud.flash(isBest ? `FINISH! NEW BEST: ${s.score}` : `FINISH! Score: ${s.score}`);
    window.setTimeout(() => {
      if (this.state === 'finished') this.quitToMenu();
    }, 3500);
  }

  private onTrackingStatus(s: TrackingStatus, detail?: string): void {
    // Surface every phase in the HUD — a silent "Starting…" was the old failure mode.
    if (s === 'requesting-camera') {
      this.hud.flashSticky('📷 Waiting for camera permission…');
    } else if (s === 'loading-model') {
      this.hud.flashSticky(`🧠 Loading hand-tracking model… ${detail ?? ''}`);
    } else if (s === 'ready') {
      this.hud.clearFlash();
      this.hud.flash(`✋ Hand tracking ready${detail ? ` (${detail})` : ''}`);
      const m = /delegate=(\w+)/.exec(detail ?? '');
      if (m) this.trackingDelegate = m[1];
    } else if (s === 'no-camera' || s === 'error') {
      this.hud.clearFlash();
      console.warn('[tracking]', s, detail);
    }
  }

  // ---------------- pinch-to-click ----------------

  private pinchClick(x01: number, y01: number): void {
    const el = document.elementFromPoint(x01 * window.innerWidth, y01 * window.innerHeight);
    const btn = el?.closest?.('[data-action]') as HTMLElement | null;
    if (btn) {
      this.audio.click();
      btn.click();
    }
  }

  // ---------------- calibration sampler ----------------

  private sampleCalibration(): {
    angle: number | null;
    scale: number | null;
    cx: number | null;
    pinch: number | null;
    hands: number;
    gripLocked: boolean;
  } {
    const hands = this.latestHands;
    const grip = this.cal.oneHandMode ? detectSingleFist(hands) : detectGrip(hands);
    let pinch: number | null = null;
    if (hands.length > 0) {
      pinch = Math.min(...hands.map((h) => pinchDistance(h)));
    }
    return {
      angle: grip.locked ? grip.angle : null,
      scale: grip.locked ? grip.scale : null,
      cx: grip.locked ? grip.cx : null,
      pinch,
      hands: hands.length,
      gripLocked: grip.locked,
    };
  }

  private applyCalibration(c: Calibration): void {
    this.cal = c;
    saveCalibration(c);
    this.engine.setCalibration(c);
    this.game?.setCameraMode(c.camera);
    this.game?.setSpeedLimit(c.speedLimit);
    this.audio.setMuted(c.muted);
    this.applyOverlaySettings();
  }

  // ---------------- keyboard fallback ----------------

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.key === 'Escape') {
      this.closeOverlay();
      return;
    }
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (down && (this.state === 'racing' || this.state === 'paused') && (k === 'p')) {
      if (this.state === 'racing') this.pause();
      else this.resume();
    }
  }

  // ---------------- glove overlay ----------------

  private resizeOverlay(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.floor(window.innerWidth * dpr);
    this.overlay.height = Math.floor(window.innerHeight * dpr);
    this.overlay.style.width = `${window.innerWidth}px`;
    this.overlay.style.height = `${window.innerHeight}px`;
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private renderOverlay(): void {
    requestAnimationFrame(() => this.renderOverlay());
    const ctx = this.octx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    this.frameNo++;

    // Camera-setup environment screen (menu state): live skeleton + checklist.
    if (this.setupOpen) {
      if (this.frameNo % 15 === 0) this.sampleLuma();
      this.updateSetupScreen();
      return;
    }

    if (this.state !== 'racing' && this.state !== 'paused' && this.state !== 'starting') return;

    // Keyboard fallback: drive from keys at ~60Hz.
    if (this.kbMode && this.state === 'racing') {
      const k = this.keys;
      const input: DriveInput = {
        steering: (k.has('arrowleft') || k.has('a') ? -1 : 0) + (k.has('arrowright') || k.has('d') ? 1 : 0),
        throttle: k.has('arrowup') || k.has('w') ? 1 : 0,
        brake: k.has('arrowdown') || k.has('s') ? 1 : 0,
      };
      this.game!.setInput(input);
      this.lastInput = input;
      this.audio.setEngine(input.throttle > 0 ? 0.8 : 0.2, input.throttle);
    }

    // Draw glowing gloves for tracked hands only (no camera background).
    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.9)';
    ctx.shadowColor = 'rgba(0, 240, 255, 0.9)';
    ctx.shadowBlur = 14;
    for (const hand of this.latestHands) {
      const pts = hand.landmarks.map((p) => ({ x: p.x * w, y: p.y * h }));
      ctx.beginPath();
      for (const [a, b] of HAND_BONES) {
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      }
      ctx.stroke();
      // Fingertips.
      ctx.fillStyle = 'rgba(255, 43, 214, 0.95)';
      ctx.shadowColor = 'rgba(255, 43, 214, 0.9)';
      for (const tip of [LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP]) {
        ctx.beginPath();
        ctx.arc(pts[tip].x, pts[tip].y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // In-race live camera preview (toggle in Settings).
    if (this.state === 'racing' && this.cal.showCamPreview && !this.kbMode) {
      this.drawPreviewPip(ctx, h);
    }
  }

  /** Small mirrored camera preview during races. */
  private drawPreviewPip(ctx: CanvasRenderingContext2D, h: number): void {
    const feed = document.getElementById('cam-feed') as HTMLVideoElement | null;
    if (!feed || feed.readyState < 2 || feed.videoWidth === 0) return;
    const pw = 168;
    const ph = Math.round((pw * feed.videoHeight) / Math.max(1, feed.videoWidth));
    const px = 14;
    const py = h - ph - 14;
    ctx.save();
    // Mirror for a natural self-view.
    ctx.translate(px + pw, py);
    ctx.scale(-1, 1);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, pw, ph, 10);
    else ctx.rect(0, 0, pw, ph);
    ctx.clip();
    ctx.drawImage(feed, 0, 0, pw, ph);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(px, py, pw, ph, 10);
    else ctx.rect(px, py, pw, ph);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 240, 255, 0.9)';
    ctx.font = '11px monospace';
    ctx.fillText('YOU', px + 8, py + 16);
    ctx.restore();
  }
}

function emptySnapshot(): GameSnapshot {
  return { speedKmh: 0, score: 0, coins: 0, mode: 'cruise', timeLeft: null, crashed: false };
}

new App();

/**
 * Main-thread tracking orchestrator.
 *
 * Owns the camera, a low-res capture canvas, and the tracking Worker.
 * The capture stream (640x480) is fully decoupled from the render loop:
 * frames are produced on a timer, transferred to the worker as ImageBitmaps,
 * and results come back async. Inference latency therefore never blocks the
 * game — worst case, controls run one tracking tick behind.
 *
 * Coordinate note: selfie cameras are mirrored. We mirror landmark x here so
 * the on-screen pinch cursor and glove overlays match what the user sees in a
 * mirror, and we swap the handedness labels to stay consistent.
 */
import { TRACKING } from '../config.ts';
import { LM, type HandFrame, type TrackedHand } from '../types.ts';
import { LandmarkSmoother } from './filters.ts';
import type { WorkerHand, WorkerIn, WorkerOut } from './protocol.ts';

// Build-time flag (vite.config.ts): true only for single-file builds,
// where the worker must be inlined (separate worker files can't load
// from file:// due to CORS).
declare const __INLINE_WORKER__: boolean;

export type TrackingStatus =
  | 'idle'
  | 'requesting-camera'
  | 'loading-model'
  | 'ready'
  | 'degraded'
  | 'error'
  | 'no-camera';

export interface TrackingCallbacks {
  onFrame: (frame: HandFrame) => void;
  onStatus: (s: TrackingStatus, detail?: string) => void;
}

export class TrackingClient {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  /** Fatal worker error for the current init attempt (drives fallback). */
  private workerFatal: string | null = null;
  /** Blob URL for the prefetched hand model (revoked on stop). */
  private modelBlobUrl: string | null = null;
  private smoother = new LandmarkSmoother(TRACKING.NUM_HANDS, 21);
  private timer: number | null = null;
  private running = false;
  private ready = false;
  private lastCapture = 0;
  private captureIntervalMs = 1000 / TRACKING.TARGET_FPS;
  private inferAvg = 0;
  private degraded = false;
  /** Rolling end-to-end latency (capture → result arrival), for prediction. */
  private e2eAvg = 0;
  /**
   * Backpressure flag: true while the worker is processing a frame.
   * The worker runs detectForVideo synchronously (blocking), so without this
   * the client would queue frames faster than inference completes and latency
   * would grow unboundedly. With it, the worker always processes the FRESHEST
   * frame and end-to-end latency is exactly one inference time.
   */
  private inflight = false;
  private cb: TrackingCallbacks;

  constructor(video: HTMLVideoElement, cb: TrackingCallbacks) {
    this.video = video;
    this.cb = cb;
    this.canvas = document.createElement('canvas');
    this.canvas.width = TRACKING.WIDTH;
    this.canvas.height = TRACKING.HEIGHT;
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d canvas context unavailable');
    this.ctx = ctx;
  }

  /** Start camera + worker. Resolves when the model is ready. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cb.onStatus('requesting-camera');
    try {
      // A stuck permission prompt used to freeze the game with no feedback.
      this.stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({
          video: {
            // Match the 640x480 inference canvas — requesting 720p only wastes
            // USB bandwidth and downscale CPU for pixels we throw away.
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
          },
          audio: false,
        }),
        25000,
        'Camera request timed out — is the camera held by another app?',
      );
    } catch (err) {
      this.running = false;
      this.cb.onStatus('no-camera', String(err));
      throw new Error(`Camera unavailable: ${String(err)}`, { cause: err });
    }
    // Best-effort: ask for continuous exposure/focus for lighting robustness.
    try {
      const track = this.stream.getVideoTracks()[0];
      await track.applyConstraints({ advanced: [{ exposureMode: 'continuous' }] } as unknown as MediaTrackConstraints);
    } catch {
      /* not supported everywhere — fine */
    }

    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play().catch(() => undefined);

    // The gesture model (~8MB) is the long pole on first run. MediaPipe gives no
    // download progress, so fetch it here with a progress callback — otherwise
    // the UI sits on "Starting…" with no feedback on slow connections.
    this.cb.onStatus('loading-model', '0%');
    let modelUrl: string = TRACKING.GESTURE_MODEL_URL;
    try {
      const blob = await fetchWithProgress(TRACKING.GESTURE_MODEL_URL, (pct) => {
        this.cb.onStatus('loading-model', `${pct}%`);
      });
      this.modelBlobUrl = URL.createObjectURL(blob);
      modelUrl = this.modelBlobUrl;
    } catch (err) {
      // Fall back to letting the worker fetch it directly.
      console.warn('[tracking] model prefetch failed, worker will fetch directly:', err);
    }

    // GPU first, then CPU on a FRESH worker. The fallback needs a new worker
    // (not just a retry in the same one): the WASM ESM loader is single-use
    // per module registry, so re-importing in the same worker fails.
    let lastError: unknown = null;
    let readyDelegate: 'GPU' | 'CPU' | null = null;
    for (const delegate of ['GPU', 'CPU'] as const) {
      this.cb.onStatus('loading-model', `starting hand tracker (${delegate})…`);
      try {
        await this.startWorkerOnce(modelUrl, delegate);
        readyDelegate = delegate;
        break;
      } catch (err) {
        console.warn(`[tracking] ${delegate} init failed:`, err);
        lastError = err;
        this.terminateWorker();
      }
    }
    if (!readyDelegate) {
      this.running = false;
      this.cb.onStatus('error', `hand tracking unavailable: ${String(lastError)}`);
      throw new Error(`Hand tracking unavailable: ${String(lastError)}`, { cause: lastError });
    }

    this.lastCapture = performance.now();
    // Drive capture with requestVideoFrameCallback when available: it fires
    // when the compositor presents a NEW frame, so we always infer on the
    // freshest image, aligned to vsync. Falls back to setInterval polling.
    if (typeof (this.video as any).requestVideoFrameCallback === 'function') {
      const rvfc = () => {
        if (!this.running) return;
        void this.capture();
        (this.video as any).requestVideoFrameCallback(rvfc);
      };
      (this.video as any).requestVideoFrameCallback(rvfc);
    } else {
      this.timer = window.setInterval(() => void this.capture(), 8);
    }
  }

  /**
   * Create the worker and init a single delegate. Resolves when the worker
   * reports ready; rejects on fatal worker error or timeout.
   */
  private async startWorkerOnce(modelUrl: string, delegate: 'GPU' | 'CPU'): Promise<void> {
    try {
      if (__INLINE_WORKER__) {
        // Single-file (file://) builds: workers can't load as separate files
        // due to CORS, so the worker is inlined as a blob.
        const { default: InlineWorker } = await withTimeout(
          import('./worker.ts?worker&inline'),
          15000,
          'Tracking worker failed to load',
        );
        this.worker = new InlineWorker();
      } else {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      }
    } catch (err) {
      throw new Error(`tracking worker failed: ${String(err)}`, { cause: err });
    }
    this.ready = false;
    this.workerFatal = null;
    this.worker.onmessage = (ev: MessageEvent<WorkerOut>) => this.handleWorker(ev.data);
    this.worker.onerror = (ev) => {
      this.cb.onStatus('error', `tracking worker error: ${ev.message}`);
    };
    const init: WorkerIn = {
      type: 'init',
      wasmUrl: TRACKING.WASM_URL,
      modelUrl,
      delegate,
      numHands: TRACKING.NUM_HANDS,
      minDetection: TRACKING.MIN_DETECTION_CONFIDENCE,
      minPresence: TRACKING.MIN_PRESENCE_CONFIDENCE,
      minTracking: TRACKING.MIN_TRACKING_CONFIDENCE,
    };
    this.worker.postMessage(init);

    // Wait for ready (or fatal error) — bounded per attempt.
    await new Promise<void>((resolve, reject) => {
      const to = window.setTimeout(() => reject(new Error(`${delegate} init timed out`)), 45000);
      const check = () => {
        if (this.ready) {
          window.clearTimeout(to);
          resolve();
        } else if (this.workerFatal) {
          window.clearTimeout(to);
          reject(new Error(this.workerFatal));
        } else {
          window.setTimeout(check, 250);
        }
      };
      check();
    });
  }

  /** Kill the worker without touching the camera stream. */
  private terminateWorker(): void {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* noop */
      }
      this.worker = null;
    }
    this.ready = false;
    this.workerFatal = null;
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'close' } satisfies WorkerIn);
      } catch {
        /* already gone */
      }
    }
    this.terminateWorker();
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.modelBlobUrl) {
      URL.revokeObjectURL(this.modelBlobUrl);
      this.modelBlobUrl = null;
    }
    this.ready = false;
    this.cb.onStatus('idle');
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Live pipeline metrics for diagnostics. */
  getMetrics(): { inferMs: number; fps: number; degraded: boolean } {
    return {
      inferMs: this.inferAvg,
      fps: this.captureIntervalMs > 0 ? 1000 / this.captureIntervalMs : 0,
      degraded: this.degraded,
    };
  }

  private handleWorker(msg: WorkerOut): void {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.cb.onStatus('ready', `delegate=${msg.delegate}`);
        break;
      case 'result': {
        this.inflight = false;
        // Measure end-to-end latency: capture timestamp → now.
        // Use it to predict landmarks forward, cancelling perceived lag.
        const now = performance.now();
        const e2e = now - msg.t;
        this.e2eAvg = this.e2eAvg === 0 ? e2e : this.e2eAvg * 0.9 + e2e * 0.1;
        this.smoother.setLookahead(this.e2eAvg / 1000);
        this.adaptToLatency(msg.inferMs);
        const hands = this.processHands(msg.hands, msg.t);
        this.cb.onFrame({ t: msg.t, hands });
        break;
      }
      case 'error':
        this.inflight = false;
        this.cb.onStatus(msg.fatal ? 'error' : 'degraded', msg.message);
        if (msg.fatal) {
          this.ready = false;
          this.workerFatal = msg.message;
        }
        break;
    }
  }

  /** Slow the capture cadence if inference can't keep up. */
  private adaptToLatency(inferMs: number): void {
    this.inferAvg = this.inferAvg === 0 ? inferMs : this.inferAvg * 0.9 + inferMs * 0.1;
    if (!this.degraded && this.inferAvg > 55) {
      this.degraded = true;
      this.captureIntervalMs = 1000 / 20;
      this.cb.onStatus('degraded', `inference ${this.inferAvg.toFixed(0)}ms — tracking at 20fps`);
    } else if (this.degraded && this.inferAvg < 28) {
      this.degraded = false;
      this.captureIntervalMs = 1000 / TRACKING.TARGET_FPS;
      this.cb.onStatus('ready', 'inference recovered');
    }
  }

  private async capture(): Promise<void> {
    if (!this.running || !this.ready || !this.worker) return;
    // Backpressure: drop this tick if the worker is still on the previous
    // frame. This keeps latency at one inference time instead of queueing.
    if (this.inflight) return;
    const now = performance.now();
    if (now - this.lastCapture < this.captureIntervalMs) return;
    if (this.video.readyState < 2 || this.video.videoWidth === 0) return;
    this.lastCapture = now;

    // Cover-crop the video into the 640x480 capture canvas.
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const targetAspect = TRACKING.WIDTH / TRACKING.HEIGHT;
    const srcAspect = vw / vh;
    let sw: number;
    let sh: number;
    let sx: number;
    let sy: number;
    if (srcAspect > targetAspect) {
      sh = vh;
      sw = vh * targetAspect;
      sx = (vw - sw) / 2;
      sy = 0;
    } else {
      sw = vw;
      sh = vw / targetAspect;
      sx = 0;
      sy = (vh - sh) / 2;
    }
    this.ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, TRACKING.WIDTH, TRACKING.HEIGHT);
    try {
      const bitmap = await createImageBitmap(this.canvas);
      this.inflight = true;
      this.worker.postMessage({ type: 'frame', bitmap, t: now } satisfies WorkerIn, [bitmap]);
    } catch {
      /* frame dropped — next tick will try again */
    }
  }

  private processHands(hands: WorkerHand[], t: number): TrackedHand[] {
    // Stable slot order: sort by wrist x before smoothing.
    const sorted = [...hands].sort((a, b) => a.landmarks[LM.WRIST].x - b.landmarks[LM.WRIST].x);
    const smoothed = this.smoother.smooth(
      sorted.map((h) => h.landmarks),
      t,
    );
    return sorted.map((h, i) => ({
      // Mirror x so overlays/cursor match the user's mirror expectation.
      landmarks: smoothed[i].map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })),
      handedness:
        h.handedness === 'Left' ? 'Right' : h.handedness === 'Right' ? 'Left' : 'Unknown',
      score: h.score,
      gesture: h.gesture,
      gestureScore: h.gestureScore,
    }));
  }
}

/** Reject if `p` doesn't settle within `ms` — no phase may hang forever. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([p, timeout]).finally(() => window.clearTimeout(timer));
}

/** Fetch with byte progress (used for the ~8MB hand model). */
async function fetchWithProgress(url: string, onProgress: (pct: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    if (total > 0) onProgress(Math.min(99, Math.round((loaded / total) * 100)));
  }
  onProgress(100);
  return new Blob(chunks, { type: 'application/octet-stream' });
}

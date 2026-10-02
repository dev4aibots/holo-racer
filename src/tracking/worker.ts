/**
 * Hand-tracking Web Worker.
 *
 * Runs MediaPipe HandLandmarker off the main thread so inference never blocks
 * rendering. Receives transferred ImageBitmaps, runs detectForVideo, and posts
 * back plain landmark arrays. GPU delegate first, automatic CPU fallback.
 *
 * MediaPipe is dynamically imported so bundlers code-split it into a separate
 * chunk that only loads when tracking starts.
 */
import type { WorkerHand, WorkerIn, WorkerOut } from './protocol.ts';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// Static import: this module only ever loads inside the tracking worker,
// which itself only starts when the camera does — so MediaPipe stays out
// of the main bundle AND inlines cleanly into blob workers (dynamic
// import() of a relative chunk cannot resolve from a blob: URL).
/* eslint-disable @typescript-eslint/no-explicit-any */
let landmarker: any = null;
let delegate: 'GPU' | 'CPU' = 'GPU';
let lastTimestamp = 0;

function post(msg: WorkerOut): void {
  (self as unknown as { postMessage(m: WorkerOut): void }).postMessage(msg);
}

async function createLandmarker(
  wasmUrl: string,
  modelUrl: string,
  numHands: number,
  minDetection: number,
  minPresence: number,
  minTracking: number,
  tryDelegate: 'GPU' | 'CPU',
): Promise<any> {
  // useModule=true: our worker is an ES module worker, and importScripts()
  // is disallowed inside module workers — the classic UMD loader would fail
  // with "ModuleFactory not set". The ESM loader sets globalThis.ModuleFactory
  // via dynamic import(), which works in module workers.
  const fileset = await FilesetResolver.forVisionTasks(wasmUrl, true);
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl, delegate: tryDelegate },
    runningMode: 'VIDEO',
    numHands,
    minHandDetectionConfidence: minDetection,
    minHandPresenceConfidence: minPresence,
    minTrackingConfidence: minTracking,
  });
}

async function handleInit(msg: Extract<WorkerIn, { type: 'init' }>): Promise<void> {
  // Single delegate attempt. The client recreates the worker when falling
  // back (a fresh worker gets a fresh module registry — re-importing the WASM
  // ESM loader in the same worker would hit the module cache and fail with
  // "ModuleFactory not set").
  const d = msg.delegate;
  try {
    delegate = d;
    landmarker = await createLandmarker(
      msg.wasmUrl,
      msg.modelUrl,
      msg.numHands,
      msg.minDetection,
      msg.minPresence,
      msg.minTracking,
      d,
    );
    post({ type: 'ready', delegate: d });
  } catch (err) {
    landmarker = null;
    post({
      type: 'error',
      message: `HandLandmarker init failed (delegate=${d}): ${String(err)}`,
      fatal: true,
    });
  }
}

function handleFrame(bitmap: ImageBitmap, t: number): void {
  if (!landmarker) {
    bitmap.close();
    return;
  }
  try {
    // Timestamps must be strictly increasing for VIDEO mode.
    const ts = Math.max(t, lastTimestamp + 1);
    lastTimestamp = ts;
    const t0 = performance.now();
    const result = landmarker.detectForVideo(bitmap, ts);
    const inferMs = performance.now() - t0;
    const hands: WorkerHand[] = result.landmarks.map((lm: Array<{ x: number; y: number; z: number }>, i: number) => {
      const cat = result.handedness?.[i]?.[0];
      const raw = cat?.categoryName === 'Left' || cat?.categoryName === 'Right' ? cat.categoryName : 'Unknown';
      return {
        landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        handedness: raw as WorkerHand['handedness'],
        score: typeof cat?.score === 'number' ? cat.score : 0.5,
      };
    });
    post({ type: 'result', t, hands, inferMs });
  } catch (err) {
    post({ type: 'error', message: `detectForVideo failed: ${String(err)}`, fatal: false });
  } finally {
    bitmap.close();
  }
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      void handleInit(msg);
      break;
    case 'frame':
      handleFrame(msg.bitmap, msg.t);
      break;
    case 'setDelegate':
      // Re-create on the requested delegate.
      void (async () => {
        try {
          if (landmarker) {
            await landmarker.setOptions({ baseOptions: { delegate: msg.delegate } });
            delegate = msg.delegate;
            post({ type: 'ready', delegate });
          }
        } catch (err) {
          post({ type: 'error', message: `setDelegate failed: ${String(err)}`, fatal: false });
        }
      })();
      break;
    case 'close':
      try {
        landmarker?.close();
      } catch {
        /* noop */
      }
      landmarker = null;
      break;
  }
};

export {}; // ensure this file is treated as a module

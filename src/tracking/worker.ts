/**
 * Hand-tracking Web Worker.
 *
 * Runs MediaPipe GestureRecognizer off the main thread so inference never
 * blocks rendering. Receives transferred ImageBitmaps, runs recognizeForVideo,
 * and posts back landmarks + classified gestures. GPU delegate first,
 * automatic CPU fallback.
 *
 * We use GestureRecognizer (not HandLandmarker) because it returns hand
 * landmarks AND robust gesture classification (Closed_Fist, Open_Palm, …)
 * in a single inference pass — the classifier head is more reliable than
 * heuristic curl ratios, at no extra latency cost.
 *
 * MediaPipe is statically imported so the worker inlines cleanly into blob
 * workers (dynamic import() of a relative chunk cannot resolve from blob:).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WorkerHand, WorkerIn, WorkerOut } from './protocol.ts';
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';

let recognizer: any = null;
let delegate: 'GPU' | 'CPU' = 'GPU';
let lastTimestamp = 0;

function post(msg: WorkerOut): void {
  (self as unknown as { postMessage(m: WorkerOut): void }).postMessage(msg);
}

async function createRecognizer(
  wasmUrl: string,
  modelUrl: string,
  numHands: number,
  minDetection: number,
  minPresence: number,
  minTracking: number,
  tryDelegate: 'GPU' | 'CPU',
): Promise<any> {
  // useModule=true: our worker is an ES module worker, and importScripts()
  // is disallowed inside module workers.
  const fileset = await FilesetResolver.forVisionTasks(wasmUrl, true);
  return GestureRecognizer.createFromOptions(fileset, {
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
  // back (a fresh worker gets a fresh module registry).
  const d = msg.delegate;
  try {
    delegate = d;
    recognizer = await createRecognizer(
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
    recognizer = null;
    post({
      type: 'error',
      message: `GestureRecognizer init failed (delegate=${d}): ${String(err)}`,
      fatal: true,
    });
  }
}

function handleFrame(bitmap: ImageBitmap, t: number): void {
  if (!recognizer) {
    bitmap.close();
    return;
  }
  try {
    // Timestamps must be strictly increasing for VIDEO mode.
    const ts = Math.max(t, lastTimestamp + 1);
    lastTimestamp = ts;
    const t0 = performance.now();
    const result = recognizer.recognizeForVideo(bitmap, ts);
    const inferMs = performance.now() - t0;
    const hands: WorkerHand[] = result.landmarks.map((lm: Array<{ x: number; y: number; z: number }>, i: number) => {
      const cat = result.handedness?.[i]?.[0];
      const raw = cat?.categoryName === 'Left' || cat?.categoryName === 'Right' ? cat.categoryName : 'Unknown';
      // Gesture classification: take the top-scoring gesture.
      const gestures = result.gestures?.[i] ?? [];
      const top = gestures.length > 0
        ? gestures.reduce((a: any, b: any) => (b.score > a.score ? b : a))
        : null;
      return {
        landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        handedness: raw as WorkerHand['handedness'],
        score: typeof cat?.score === 'number' ? cat.score : 0.5,
        gesture: top?.categoryName ?? '',
        gestureScore: typeof top?.score === 'number' ? top.score : 0,
      };
    });
    post({ type: 'result', t, hands, inferMs });
  } catch (err) {
    post({ type: 'error', message: `recognizeForVideo failed: ${String(err)}`, fatal: false });
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
          if (recognizer) {
            await recognizer.setOptions({ baseOptions: { delegate: msg.delegate } });
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
        recognizer?.close();
      } catch {
        /* noop */
      }
      recognizer = null;
      break;
  }
};

export {}; // ensure this file is treated as a module

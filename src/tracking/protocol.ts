/**
 * Worker <-> main-thread protocol for hand tracking.
 * All payloads are structured-cloneable (ImageBitmap is transferred).
 */
import type { Landmark } from '../types.ts';

export interface WorkerHand {
  landmarks: Landmark[];
  handedness: 'Left' | 'Right' | 'Unknown';
  /** Detection confidence 0..1. */
  score: number;
  /**
   * Classified gesture from MediaPipe GestureRecognizer (e.g. "Closed_Fist",
   * "Open_Palm", "Pointing_Up"). Empty string when unclassified.
   */
  gesture: string;
  /** Classification confidence 0..1. */
  gestureScore: number;
}

export type WorkerIn =
  | {
      type: 'init';
      wasmUrl: string;
      modelUrl: string;
      /** Single delegate attempt — the client recreates the worker for fallback. */
      delegate: 'GPU' | 'CPU';
      numHands: number;
      minDetection: number;
      minPresence: number;
      minTracking: number;
    }
  | { type: 'frame'; bitmap: ImageBitmap; t: number }
  | { type: 'setDelegate'; delegate: 'GPU' | 'CPU' }
  | { type: 'close' };

export type WorkerOut =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'result'; t: number; hands: WorkerHand[]; inferMs: number }
  | { type: 'error'; message: string; fatal: boolean };

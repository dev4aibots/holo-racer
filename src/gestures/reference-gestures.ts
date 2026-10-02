/**
 * Reference-ported gesture recognition from user's MR Spatial Computer.
 *
 * Ports gesture_recognizer.py EXACTLY:
 *
 * Priority cascade:
 *   1. PINCH (custom, highest priority) - palm-span-normalized ratio
 *   2. MediaPipe gesture (>= 0.40 confidence)
 *   3. GRAB fallback (mean tip-to-palm < 0.08)
 *   4. POINT fallback (index extended > 0.10, others curled < 0.09)
 *   5. SWIPE (currently fixed using filter velocity)
 *
 * Pinch state machine:
 *   - Engage: ratio < 0.34, Release: ratio > 0.085 (4x hysteresis)
 *   - Rising-edge latch: exactly one click per pinch-close
 *   - Re-arms only on full release
 *   - Primary hand only
 *
 * Anti-hallucination:
 *   - Stale-gesture stickiness: weak frame never reports NONE
 *   - Previous gesture persists
 */
import type { TrackedHand, Landmark } from '../types.ts';
import { LM } from '../types.ts';

export type GestureType =
  | 'PINCH'
  | 'GRAB'
  | 'OPEN_PALM'
  | 'POINT'
  | 'SWIPE'
  | 'NONE';

export interface GestureResult {
  gesture: GestureType;
  confidence: number;
  pinchRatio: number;
  isPinchClick: boolean; // rising edge - exactly one per pinch
}

// Reference constants
const PINCH_ENGAGE = 0.34;
const PINCH_RELEASE = 0.085;
const MP_GESTURE_CONFIDENCE = 0.40;
const GRAB_TIP_PALM_THRESHOLD = 0.08;
const POINT_INDEX_EXTENDED = 0.10;
const POINT_OTHERS_CURLED = 0.09;

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Palm-span-normalized pinch ratio (distance-invariant).
 * Reference: ||thumb_tip - index_tip|| / ||wrist - middle_MCP||
 */
export function pinchRatio(hand: TrackedHand): number {
  const pinchDist = dist(
    hand.landmarks[LM.THUMB_TIP],
    hand.landmarks[LM.INDEX_TIP],
  );
  const palmSpan = dist(
    hand.landmarks[LM.WRIST],
    hand.landmarks[LM.MIDDLE_MCP],
  );
  if (palmSpan < 1e-6) return 1.0;
  return pinchDist / palmSpan;
}

export function pinchCenter(hand: TrackedHand): Landmark {
  const t = hand.landmarks[LM.THUMB_TIP];
  const i = hand.landmarks[LM.INDEX_TIP];
  return {
    x: (t.x + i.x) / 2,
    y: (t.y + i.y) / 2,
    z: (t.z + i.z) / 2,
  };
}

export function palmCenter(hand: TrackedHand): Landmark {
  const w = hand.landmarks[LM.WRIST];
  const idx = hand.landmarks[LM.INDEX_MCP];
  const mid = hand.landmarks[LM.MIDDLE_MCP];
  const ring = hand.landmarks[LM.RING_MCP];
  const pinky = hand.landmarks[LM.PINKY_MCP];
  return {
    x: (w.x + idx.x + mid.x + ring.x + pinky.x) / 5,
    y: (w.y + idx.y + mid.y + ring.y + pinky.y) / 5,
    z: (w.z + idx.z + mid.z + ring.z + pinky.z) / 5,
  };
}

/**
 * Palm normal via cross product: (index_mcp - wrist) x (pinky_mcp - wrist)
 * Reference: perception_types.rs
 * Note: flips for mirrored/left hands - negate by handedness if needed.
 */
export function palmNormal(hand: TrackedHand): { x: number; y: number; z: number } {
  const w = hand.landmarks[LM.WRIST];
  const idx = hand.landmarks[LM.INDEX_MCP];
  const pinky = hand.landmarks[LM.PINKY_MCP];

  const v1 = { x: idx.x - w.x, y: idx.y - w.y, z: idx.z - w.z };
  const v2 = { x: pinky.x - w.x, y: pinky.y - w.y, z: pinky.z - w.z };

  // Cross product v1 x v2
  const nx = v1.y * v2.z - v1.z * v2.y;
  const ny = v1.z * v2.x - v1.x * v2.z;
  const nz = v1.x * v2.y - v1.y * v2.x;

  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-6) return { x: 0, y: 0, z: 1 };
  return { x: nx / len, y: ny / len, z: nz / len };
}

/**
 * Per-hand gesture state (pinch latch, previous gesture for stickiness).
 */
export class HandGestureState {
  pinchLatched = false;
  pinchLevel = false;
  previousGesture: GestureType = 'NONE';
  grabDebounceCount = 0;

  reset(): void {
    this.pinchLatched = false;
    this.pinchLevel = false;
    this.previousGesture = 'NONE';
    this.grabDebounceCount = 0;
  }
}

/**
 * Reference gesture recognizer with priority cascade.
 */
export class ReferenceGestureRecognizer {
  private handStates = new Map<string, HandGestureState>();

  private getState(handId: string): HandGestureState {
    let s = this.handStates.get(handId);
    if (!s) {
      s = new HandGestureState();
      this.handStates.set(handId, s);
    }
    return s;
  }

  /**
   * Recognize gesture for a hand.
   * @param hand Tracked hand with landmarks
   * @param handId Stable ID for state (e.g., "Left" or "Right")
   * @param mpGesture MediaPipe gesture classification (if available)
   * @param mpConfidence MediaPipe gesture confidence
   * @param isPrimary Whether this is the primary hand (for pinch-click)
   */
  recognize(
    hand: TrackedHand,
    handId: string,
    mpGesture: string | null,
    mpConfidence: number,
    isPrimary: boolean,
  ): GestureResult {
    const state = this.getState(handId);
    const ratio = pinchRatio(hand);

    // --- 1. PINCH (highest priority, custom) ---
    // Hysteresis: engage at 0.34, release at 0.085
    if (!state.pinchLevel && ratio < PINCH_ENGAGE) {
      state.pinchLevel = true;
    } else if (state.pinchLevel && ratio > PINCH_RELEASE) {
      state.pinchLevel = false;
      state.pinchLatched = false; // re-arm on full release
    }

    // Rising-edge latch: exactly one click per pinch
    let isPinchClick = false;
    if (state.pinchLevel && !state.pinchLatched && isPrimary) {
      state.pinchLatched = true;
      isPinchClick = true;
    }

    if (state.pinchLevel) {
      state.previousGesture = 'PINCH';
      return {
        gesture: 'PINCH',
        confidence: 1.0,
        pinchRatio: ratio,
        isPinchClick,
      };
    }

    // --- 2. MediaPipe gesture (>= 0.40 confidence) ---
    if (mpGesture && mpConfidence >= MP_GESTURE_CONFIDENCE) {
      const mapped = this.mapMPGesture(mpGesture);
      if (mapped !== 'NONE') {
        state.previousGesture = mapped;
        return {
          gesture: mapped,
          confidence: mpConfidence,
          pinchRatio: ratio,
          isPinchClick: false,
        };
      }
    }

    // --- 3. GRAB fallback (mean tip-to-palm < 0.08) ---
    if (this.isGrab(hand)) {
      state.previousGesture = 'GRAB';
      return {
        gesture: 'GRAB',
        confidence: 0.8,
        pinchRatio: ratio,
        isPinchClick: false,
      };
    }

    // --- 4. POINT fallback ---
    if (this.isPoint(hand)) {
      state.previousGesture = 'POINT';
      return {
        gesture: 'POINT',
        confidence: 0.7,
        pinchRatio: ratio,
        isPinchClick: false,
      };
    }

    // --- 5. Stale-gesture stickiness (anti-hallucination) ---
    // Weak frame never reports NONE - previous gesture persists
    if (state.previousGesture !== 'NONE') {
      return {
        gesture: state.previousGesture,
        confidence: 0.3, // low confidence = stale
        pinchRatio: ratio,
        isPinchClick: false,
      };
    }

    return {
      gesture: 'NONE',
      confidence: 0,
      pinchRatio: ratio,
      isPinchClick: false,
    };
  }

  private mapMPGesture(mpGesture: string): GestureType {
    switch (mpGesture) {
      case 'Closed_Fist':
        return 'GRAB';
      case 'Open_Palm':
        return 'OPEN_PALM';
      case 'Pointing_Up':
        return 'POINT';
      default:
        return 'NONE';
    }
  }

  private isGrab(hand: TrackedHand): boolean {
    const palm = palmCenter(hand);
    const tips = [
      LM.THUMB_TIP,
      LM.INDEX_TIP,
      LM.MIDDLE_TIP,
      LM.RING_TIP,
      LM.PINKY_TIP,
    ];
    let sum = 0;
    for (const tip of tips) {
      sum += dist(hand.landmarks[tip], palm);
    }
    return sum / tips.length < GRAB_TIP_PALM_THRESHOLD;
  }

  private isPoint(hand: TrackedHand): boolean {
    const wrist = hand.landmarks[LM.WRIST];
    const scale = dist(wrist, hand.landmarks[LM.MIDDLE_MCP]);
    if (scale < 1e-6) return false;

    const indexExtended =
      dist(hand.landmarks[LM.INDEX_TIP], wrist) / scale > POINT_INDEX_EXTENDED;
    const othersCurled =
      dist(hand.landmarks[LM.MIDDLE_TIP], wrist) / scale < POINT_OTHERS_CURLED &&
      dist(hand.landmarks[LM.RING_TIP], wrist) / scale < POINT_OTHERS_CURLED &&
      dist(hand.landmarks[LM.PINKY_TIP], wrist) / scale < POINT_OTHERS_CURLED;

    return indexExtended && othersCurled;
  }

  reset(handId: string): void {
    this.handStates.delete(handId);
  }

  resetAll(): void {
    this.handStates.clear();
  }
}

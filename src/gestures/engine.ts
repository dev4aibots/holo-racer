/**
 * Minimal gesture engine — trusts MediaPipe's GestureRecognizer directly.
 *
 * No custom fist/palm classifiers. No per-landmark filter chains.
 * MediaPipe's neural classifier is better than hand-tuned curl ratios.
 *
 * - Steering: wrist-to-wrist vector (2-hand) or knuckle line (1-hand)
 * - Throttle/brake: apparent hand size (z-depth proxy)
 * - Pinch: thumb-index distance (simple threshold)
 * - Pause: both palms open (MediaPipe Open_Palm)
 */
import { GESTURES } from '../config.ts';
import {
  LM,
  type Calibration,
  type ControlState,
  type HandFrame,
  type Landmark,
  type TrackedHand,
} from '../types.ts';

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Trust MediaPipe's classifier directly — no custom curl logic. */
export function isFist(hand: TrackedHand): boolean {
  return isClosedHand(hand.landmarks);
}

/** Trust MediaPipe's classifier directly. */
export function isPalmOpen(hand: TrackedHand): boolean {
  return isOpenPalm(hand.landmarks);
}

/**
 * Geometric fist detection from iakashkanaujiya/car_driving.
 * Counts folded fingers: tip-to-wrist < MCP-to-wrist × 1.58.
 * More robust than neural classifier across hand sizes/lighting.
 * Zero inference cost — pure math on landmarks.
 */
export function isClosedHand(landmarks: Landmark[]): boolean {
  if (landmarks.length < 21) return false;
  const wrist = landmarks[LM.WRIST];
  const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
  const mcps = [LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let folded = 0;
  for (let i = 0; i < tips.length; i++) {
    const tipDist = dist(landmarks[tips[i]], wrist);
    const mcpDist = dist(landmarks[mcps[i]], wrist);
    if (tipDist < mcpDist * 1.58) folded++;
  }
  return folded >= 3;
}

/**
 * Geometric open palm detection from iakashkanaujiya/car_driving.
 * Counts extended fingers: tip-to-wrist > MCP-to-wrist × 1.65.
 */
export function isOpenPalm(landmarks: Landmark[]): boolean {
  if (landmarks.length < 21) return false;
  const wrist = landmarks[LM.WRIST];
  const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
  const mcps = [LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let extended = 0;
  for (let i = 0; i < tips.length; i++) {
    const tipDist = dist(landmarks[tips[i]], wrist);
    const mcpDist = dist(landmarks[mcps[i]], wrist);
    if (tipDist > mcpDist * 1.65) extended++;
  }
  return extended === 4;
}

export function handScale(hand: TrackedHand): number {
  const s = dist(hand.landmarks[LM.WRIST], hand.landmarks[LM.MIDDLE_MCP]);
  return s > 1e-6 ? s : 1e-6;
}

export function pinchDistance(hand: TrackedHand): number {
  return dist(hand.landmarks[LM.THUMB_TIP], hand.landmarks[LM.INDEX_TIP]) / handScale(hand);
}

/** Map hand scale ratio to throttle/brake. Far (small) = throttle, close (large) = brake. */
export function scaleToPedals(scale: number, neutralScale: number): { throttle: number; brake: number } {
  const r = scale / Math.max(neutralScale, 1e-6);
  let throttle = 0;
  let brake = 0;
  if (r < 0.94) throttle = clamp((0.94 - r) / 0.38, 0, 1);
  else if (r > 1.06) brake = clamp((r - 1.06) / 0.5, 0, 1);
  return { throttle, brake };
}

/** Detect two-fist grip for calibration/setup screens. */
export function detectGrip(hands: TrackedHand[]): { locked: boolean; angle: number; scale: number; cx: number; cy: number } {
  const noGrip = { locked: false, angle: 0, scale: 0, cx: 0.5, cy: 0.5 };
  if (hands.length < 2) return noGrip;
  const fists = hands.filter(isFist);
  if (fists.length < 2) return noGrip;
  const [a, b] = [...fists].sort(
    (h1, h2) => h1.landmarks[LM.WRIST].x - h2.landmarks[LM.WRIST].x,
  );
  const wa = a.landmarks[LM.WRIST];
  const wb = b.landmarks[LM.WRIST];
  const interWrist = dist(wa, wb);
  const avgScale = (handScale(a) + handScale(b)) / 2;
  if (interWrist > GESTURES.GRIP_RATIO * avgScale) return noGrip;
  return {
    locked: true,
    angle: Math.atan2(wb.y - wa.y, wb.x - wa.x),
    scale: avgScale,
    cx: (wa.x + wb.x) / 2,
    cy: (wa.y + wb.y) / 2,
  };
}

/** Detect single-fist grip for calibration/setup screens. */
export function detectSingleFist(hands: TrackedHand[]): { locked: boolean; angle: number; scale: number; cx: number; cy: number } {
  const noGrip = { locked: false, angle: 0, scale: 0, cx: 0.5, cy: 0.5 };
  const fists = hands.filter(isFist);
  if (fists.length === 0) return noGrip;
  const h = fists.sort((a, b) => b.score - a.score)[0];
  const i = h.landmarks[LM.INDEX_MCP];
  const p = h.landmarks[LM.PINKY_MCP];
  return {
    locked: true,
    angle: Math.atan2(p.y - i.y, p.x - i.x),
    scale: handScale(h),
    cx: h.landmarks[LM.WRIST].x,
    cy: h.landmarks[LM.WRIST].y,
  };
}

export class GestureEngine {
  private cal: Calibration;
  private steerSm = 0;
  private throttleSm = 0;
  private brakeSm = 0;
  private pinchActive = false;
  private palmsSince: number | null = null;

  constructor(cal: Calibration) {
    this.cal = cal;
  }

  setCalibration(cal: Calibration): void {
    this.cal = cal;
    this.steerSm = 0;
    this.throttleSm = 0;
    this.brakeSm = 0;
    this.pinchActive = false;
    this.palmsSince = null;
  }

  update(frame: HandFrame): ControlState {
    const t = frame.t;
    const hands = frame.hands;
    const oneHand = this.cal.oneHandMode;

    let steering = 0;
    let throttle = 0;
    let brake = 0;
    let gripLocked = false;

    // --- Steering: two fists or one fist ---
    const fists = hands.filter(isFist);
    if (!oneHand && fists.length >= 2) {
      // Two-hand: sort by x, use wrist-to-wrist vector
      const [a, b] = [...fists].sort(
        (h1, h2) => h1.landmarks[LM.WRIST].x - h2.landmarks[LM.WRIST].x,
      );
      const wa = a.landmarks[LM.WRIST];
      const wb = b.landmarks[LM.WRIST];
      // Require hands close together (gripping)
      const interWrist = dist(wa, wb);
      const avgScale = (handScale(a) + handScale(b)) / 2;
      if (interWrist < GESTURES.GRIP_RATIO * avgScale) {
        gripLocked = true;
        const angle = Math.atan2(wb.y - wa.y, wb.x - wa.x);
        // car_driving steering: 0.56 rad range, 0.045 rad deadzone (jitter filter)
        const STEER_RANGE = 0.56;
        const DEADZONE = 0.045;
        let delta = angleDiff(angle, this.cal.neutralAngle);
        if (Math.abs(delta) <= DEADZONE) delta = 0;
        else delta -= Math.sign(delta) * DEADZONE;
        const rot = clamp(delta / STEER_RANGE, -1, 1);
        const cx = (wa.x + wb.x) / 2;
        const lat = (cx - this.cal.neutralCx) / 0.15;
        const raw = Math.abs(rot) >= Math.abs(lat) ? rot : lat;
        steering = clamp(raw * this.cal.sensitivity, -1, 1);
        // Throttle/brake from hand size
        const scale = avgScale;
        const r = scale / Math.max(this.cal.neutralScale, 1e-6);
        if (r < 0.94) throttle = clamp((0.94 - r) / 0.38, 0, 1);
        else if (r > 1.06) brake = clamp((r - 1.06) / 0.5, 0, 1);
      }
    } else if (oneHand && fists.length >= 1) {
      // One-hand: knuckle line rotation
      const h = fists.sort((a, b) => b.score - a.score)[0];
      const i = h.landmarks[LM.INDEX_MCP];
      const p = h.landmarks[LM.PINKY_MCP];
      const angle = Math.atan2(p.y - i.y, p.x - i.x);
      gripLocked = true;
      steering = clamp(
        (angleDiff(angle, this.cal.neutralAngle) / GESTURES.MAX_STEER_RAD) * this.cal.sensitivity,
        -1, 1,
      );
      const r = handScale(h) / Math.max(this.cal.neutralScale, 1e-6);
      if (r < 0.94) throttle = clamp((0.94 - r) / 0.38, 0, 1);
      else if (r > 1.06) brake = clamp((r - 1.06) / 0.5, 0, 1);
    }

    // Light output smoothing (single-pole, no filter chains)
    const sAlpha = gripLocked ? 0.55 : 0.5;
    this.steerSm += (steering - this.steerSm) * sAlpha;
    this.throttleSm += (throttle - this.throttleSm) * 0.45;
    this.brakeSm += (brake - this.brakeSm) * 0.45;

    // --- Pinch: simple threshold with hysteresis ---
    let pinchStarted = false;
    let pinchX = 0.5;
    let pinchY = 0.5;
    if (hands.length > 0) {
      const best = [...hands].sort((a, b) => pinchDistance(a) - pinchDistance(b))[0];
      const pd = pinchDistance(best);
      pinchX = (best.landmarks[LM.THUMB_TIP].x + best.landmarks[LM.INDEX_TIP].x) / 2;
      pinchY = (best.landmarks[LM.THUMB_TIP].y + best.landmarks[LM.INDEX_TIP].y) / 2;
      const want = this.pinchActive ? pd < 0.35 : pd < 0.25;
      if (want && !this.pinchActive) pinchStarted = true;
      this.pinchActive = want;
    } else {
      this.pinchActive = false;
    }

    // --- Pause: both palms open held ---
    let pauseFired = false;
    const palms = hands.filter(isPalmOpen);
    if (palms.length >= 2) {
      if (this.palmsSince === null) this.palmsSince = t;
      else if (t - this.palmsSince >= GESTURES.PAUSE_HOLD_MS) {
        pauseFired = true;
        this.palmsSince = null;
      }
    } else {
      this.palmsSince = null;
    }

    // Decay when hands lost
    if (hands.length === 0) {
      this.steerSm *= 0.9;
      this.throttleSm *= 0.9;
      this.brakeSm *= 0.9;
    }

    return {
      t,
      steering: this.steerSm,
      throttle: this.throttleSm,
      brake: this.brakeSm,
      gripLocked,
      pinch: {
        active: this.pinchActive,
        x: pinchX,
        y: pinchY,
      },
      pinchStarted,
      pinchEnded: false,
      palmsOpen: palms.length >= 2,
      pauseRequested: pauseFired,
      handsCount: hands.length,
      quality: hands.length > 0 ? Math.min(1, hands[0].score + 0.2) : 0,
    };
  }
}

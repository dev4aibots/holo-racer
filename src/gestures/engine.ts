/**
 * Gesture engine: converts smoothed hand landmarks into driving controls.
 *
 * Control model (locked from user spec):
 *  - 2-hand "wheel grip": both fists held together (one fist grabbing the
 *    other's thumb ~= two fists in close proximity). The rotation of the
 *    wrist-to-wrist vector steers; the apparent hand size (distance from
 *    camera) drives throttle/brake.
 *  - 1-hand mode: single fist; steering from knuckle-line rotation.
 *  - Pinch (thumb-index, either hand) = click, with hysteresis + debounce.
 *  - Both palms open held 500ms = pause menu.
 *
 * All functions here are pure except GestureEngine, which holds calibration,
 * debounce timers and output smoothing. Fully unit-testable with synthetic
 * landmarks (see engine.test.ts).
 */
import { GESTURES } from '../config.ts';
import {
  FINGER_TIPS,
  LM,
  type Calibration,
  type ControlState,
  type HandFrame,
  type Landmark,
  type TrackedHand,
} from '../types.ts';

export function dist(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function mid(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/**
 * Apparent hand size in normalized image units. Robust proxy for distance
 * from camera (MediaPipe z is wrist-relative, so it cannot give absolute
 * distance — apparent size can).
 */
export function handScale(hand: TrackedHand): number {
  const s = dist(hand.landmarks[LM.WRIST], hand.landmarks[LM.MIDDLE_MCP]);
  return s > 1e-6 ? s : 1e-6;
}

function fingerCurl(hand: TrackedHand, tipIdx: number, scale: number): number {
  return dist(hand.landmarks[tipIdx], hand.landmarks[LM.WRIST]) / scale;
}

/** True when index/middle/ring/pinky are curled into the palm. */
export function isFist(hand: TrackedHand): boolean {
  // Prefer the MediaPipe classifier when confident — it's trained on real
  // hands and more robust than curl ratios across hand shapes/lighting.
  if (hand.gesture === 'Closed_Fist' && hand.gestureScore >= 0.4) return true;
  if (hand.gesture === 'Open_Palm' && hand.gestureScore >= 0.4) return false;
  const s = handScale(hand);
  for (const tip of FINGER_TIPS) {
    if (fingerCurl(hand, tip, s) > GESTURES.CURL_RATIO) return false;
  }
  // Thumb tucked: tip close to wrist as well.
  if (fingerCurl(hand, LM.THUMB_TIP, s) > GESTURES.CURL_RATIO * 1.15) return false;
  return true;
}

/** True when all fingers + thumb are extended. */
export function isPalmOpen(hand: TrackedHand): boolean {
  // Prefer the MediaPipe classifier when confident.
  if (hand.gesture === 'Open_Palm' && hand.gestureScore >= 0.4) return true;
  if (hand.gesture === 'Closed_Fist' && hand.gestureScore >= 0.4) return false;
  const s = handScale(hand);
  for (const tip of FINGER_TIPS) {
    if (fingerCurl(hand, tip, s) < GESTURES.EXTEND_RATIO) return false;
  }
  if (fingerCurl(hand, LM.THUMB_TIP, s) < 1.25) return false;
  return true;
}

/** Thumb-tip to index-tip distance, normalized by hand scale. */
export function pinchDistance(hand: TrackedHand): number {
  return dist(hand.landmarks[LM.THUMB_TIP], hand.landmarks[LM.INDEX_TIP]) / handScale(hand);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function expSmooth(prev: number, next: number, alpha: number): number {
  return prev + (next - prev) * alpha;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface GripInfo {
  locked: boolean;
  /** Steering vector angle (rad) in image plane. */
  angle: number;
  /** Mean apparent hand scale of gripping hands. */
  scale: number;
  /** Midpoint of the grip (normalized coords) — for glove rendering. */
  cx: number;
  cy: number;
}

/**
 * Detect the two-fist steering grip. Hands sorted left/right by wrist x.
 * Returns locked=false unless both hands are fists held close together.
 */
export function detectGrip(hands: TrackedHand[]): GripInfo {
  const noGrip: GripInfo = { locked: false, angle: 0, scale: 0, cx: 0.5, cy: 0.5 };
  if (hands.length < 2) return noGrip;
  const [a, b] = [...hands].sort(
    (h1, h2) => h1.landmarks[LM.WRIST].x - h2.landmarks[LM.WRIST].x,
  );
  if (!isFist(a) || !isFist(b)) return noGrip;
  const sa = handScale(a);
  const sb = handScale(b);
  const wa = a.landmarks[LM.WRIST];
  const wb = b.landmarks[LM.WRIST];
  const interWrist = dist(wa, wb);
  if (interWrist > GESTURES.GRIP_RATIO * ((sa + sb) / 2)) return noGrip;
  return {
    locked: true,
    angle: Math.atan2(wb.y - wa.y, wb.x - wa.x),
    scale: (sa + sb) / 2,
    cx: (wa.x + wb.x) / 2,
    cy: (wa.y + wb.y) / 2,
  };
}

/**
 * 1-hand fallback: single fist steered by knuckle-line (index MCP -> pinky
 * MCP) rotation relative to the calibrated neutral angle.
 */
export function detectSingleFist(hands: TrackedHand[]): GripInfo {
  const noGrip: GripInfo = { locked: false, angle: 0, scale: 0, cx: 0.5, cy: 0.5 };
  if (hands.length < 1) return noGrip;
  // Use the most confident fist.
  const fists = hands.filter(isFist).sort((h1, h2) => h2.score - h1.score);
  if (fists.length === 0) return noGrip;
  const h = fists[0];
  const i = h.landmarks[LM.INDEX_MCP];
  const p = h.landmarks[LM.PINKY_MCP];
  const w = h.landmarks[LM.WRIST];
  return {
    locked: true,
    angle: Math.atan2(p.y - i.y, p.x - i.x),
    scale: handScale(h),
    cx: w.x,
    cy: w.y,
  };
}

/** Map apparent-size ratio to throttle/brake with deadzone. */
export function scaleToPedals(scale: number, neutralScale: number): { throttle: number; brake: number } {
  const r = scale / Math.max(neutralScale, 1e-6);
  const dz = GESTURES.SCALE_DEADZONE;
  let throttle = 0;
  let brake = 0;
  if (r < 1 - dz) {
    throttle = clamp((1 - dz - r) / GESTURES.THROTTLE_RANGE, 0, 1);
  } else if (r > 1 + dz) {
    brake = clamp((r - 1 - dz) / GESTURES.BRAKE_RANGE, 0, 1);
  }
  return { throttle, brake };
}

interface PinchDebounce {
  reported: boolean;
  candidate: boolean;
  candidateSince: number;
}

export class GestureEngine {
  private cal: Calibration;
  private pinch: PinchDebounce = { reported: false, candidate: false, candidateSince: 0 };
  private palmsSince: number | null = null;
  private pauseFired = false;
  private steerSm = 0;
  private throttleSm = 0;
  private brakeSm = 0;
  private qualitySm = 0;

  constructor(cal: Calibration) {
    this.cal = cal;
  }

  setCalibration(cal: Calibration): void {
    this.cal = cal;
    this.reset();
  }

  reset(): void {
    this.pinch = { reported: false, candidate: false, candidateSince: 0 };
    this.palmsSince = null;
    this.pauseFired = false;
    this.steerSm = 0;
    this.throttleSm = 0;
    this.brakeSm = 0;
    this.qualitySm = 0;
  }

  update(frame: HandFrame): ControlState {
    const t = frame.t;
    const hands = frame.hands;
    const oneHand = this.cal.oneHandMode;

    // --- Grip / steering ---
    // Dual-mode: rotation (wrist-to-wrist vector angle) + lateral (grip
    // center X). Rotation is primary; lateral catches users who move hands
    // sideways instead of rotating like a wheel. Both are normalized and
    // the stronger signal wins.
    const grip = oneHand ? detectSingleFist(hands) : detectGrip(hands);
    let steering = 0;
    let throttle = 0;
    let brake = 0;
    if (grip.locked) {
      // Rotation steering: vector angle vs calibrated neutral.
      const rotRaw = angleDiff(grip.angle, this.cal.neutralAngle) / GESTURES.MAX_STEER_RAD;
      // Lateral steering: grip center X vs calibrated neutral.
      // 0.15 normalized units = full lock (sensitive, responsive).
      const latRaw = (grip.cx - this.cal.neutralCx) / 0.15;
      // Use the stronger of the two signals.
      const raw = Math.abs(rotRaw) >= Math.abs(latRaw) ? rotRaw : latRaw;
      steering = clamp(raw * this.cal.sensitivity, -1, 1);
      const pedals = scaleToPedals(grip.scale, this.cal.neutralScale);
      throttle = pedals.throttle;
      brake = pedals.brake;
    }
    this.steerSm = expSmooth(this.steerSm, steering, grip.locked ? GESTURES.STEER_SMOOTH : 0.5);
    this.throttleSm = expSmooth(this.throttleSm, throttle, GESTURES.THROTTLE_SMOOTH);
    this.brakeSm = expSmooth(this.brakeSm, brake, GESTURES.THROTTLE_SMOOTH);

    // --- Pinch (thumb-index, best candidate hand) ---
    let pinchStarted = false;
    let pinchEnded = false;
    let pinchX = 0.5;
    let pinchY = 0.5;
    if (hands.length > 0) {
      const ranked = [...hands].sort((h1, h2) => pinchDistance(h1) - pinchDistance(h2));
      const best = ranked[0];
      const pd = pinchDistance(best);
      pinchX = (best.landmarks[LM.THUMB_TIP].x + best.landmarks[LM.INDEX_TIP].x) / 2;
      pinchY = (best.landmarks[LM.THUMB_TIP].y + best.landmarks[LM.INDEX_TIP].y) / 2;
      const wantActive = this.pinch.reported
        ? pd < this.cal.pinchUp // hysteresis: release only past the upper band
        : pd < this.cal.pinchDown;
      if (wantActive !== this.pinch.candidate) {
        this.pinch.candidate = wantActive;
        this.pinch.candidateSince = t;
      } else if (
        wantActive !== this.pinch.reported &&
        t - this.pinch.candidateSince >= GESTURES.PINCH_DEBOUNCE_MS
      ) {
        this.pinch.reported = wantActive;
        if (wantActive) pinchStarted = true;
        else pinchEnded = true;
      }
    } else if (this.pinch.reported || this.pinch.candidate) {
      // Hands lost: release pinch immediately to avoid stuck clicks.
      this.pinch.reported = false;
      this.pinch.candidate = false;
      pinchEnded = true;
    }

    // --- Palms-open hold => pause ---
    const needPalms = oneHand ? 1 : 2;
    const palmsOpen = hands.length >= needPalms && hands.slice(0, needPalms).every(isPalmOpen);
    let pauseRequested = false;
    if (palmsOpen) {
      if (this.palmsSince === null) {
        this.palmsSince = t;
        this.pauseFired = false;
      } else if (!this.pauseFired && t - this.palmsSince >= GESTURES.PAUSE_HOLD_MS) {
        this.pauseFired = true;
        pauseRequested = true;
      }
    } else {
      this.palmsSince = null;
      this.pauseFired = false;
    }

    // --- Quality ---
    const targetQ = hands.length === 0 ? 0 : hands.reduce((s, h) => s + h.score, 0) / hands.length;
    this.qualitySm = expSmooth(this.qualitySm, targetQ, 0.2);

    return {
      t,
      steering: this.steerSm,
      throttle: this.throttleSm,
      brake: this.brakeSm,
      pinch: { active: this.pinch.reported, x: pinchX, y: pinchY },
      pinchStarted,
      pinchEnded,
      palmsOpen,
      pauseRequested,
      handsCount: hands.length,
      gripLocked: grip.locked,
      quality: this.qualitySm,
    };
  }
}

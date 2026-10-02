/**
 * Shared contracts for holo-racer.
 * Every module speaks these types; keep them stable.
 */

/** A single 2D/3D landmark in normalized image coordinates (x,y in 0..1). */
export interface Landmark {
  x: number;
  y: number;
  /** Relative depth; wrist is the origin. Smaller = closer to camera. */
  z: number;
}

export type Handedness = 'Left' | 'Right' | 'Unknown';

export interface TrackedHand {
  /** 21 MediaPipe hand landmarks, index 0 = wrist. */
  landmarks: Landmark[];
  handedness: Handedness;
  /** Detection confidence 0..1 as reported by the landmarker. */
  score: number;
}

/** One tracking tick from the worker (already smoothed by the client). */
export interface HandFrame {
  /** performance.now() timestamp (ms) of the source video frame. */
  t: number;
  /** 0..2 hands. */
  hands: TrackedHand[];
}

/** MediaPipe landmark indices. */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const FINGER_TIPS = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP] as const;

/** Pinch cursor + button state for UI interaction. */
export interface PinchState {
  active: boolean;
  /** Normalized cursor position (0..1), midpoint of thumb+index tips. */
  x: number;
  y: number;
}

/**
 * Per-frame driving + UI control state produced by the gesture engine.
 * All analog values are normalized and smoothed.
 */
export interface ControlState {
  t: number;
  /** -1 (full left) .. +1 (full right). 0 when no grip locked. */
  steering: number;
  /** 0..1 throttle from hand distance (far = fast). */
  throttle: number;
  /** 0..1 brake from hand distance (very close = brake). */
  brake: number;
  pinch: PinchState;
  /** Edge-triggered this frame. */
  pinchStarted: boolean;
  pinchEnded: boolean;
  /** Both palms currently open (pre-hold). */
  palmsOpen: boolean;
  /** Edge: palms held open for PAUSE_HOLD_MS. */
  pauseRequested: boolean;
  handsCount: number;
  /** True while the steering grip pose is confidently detected. */
  gripLocked: boolean;
  /** 0..1 overall tracking confidence. */
  quality: number;
}

/** Persisted calibration + settings (localStorage). */
export interface Calibration {
  /** Grip vector angle (rad) at neutral steering. */
  neutralAngle: number;
  /** Hand scale (wrist->middle_mcp, normalized units) at neutral distance. */
  neutralScale: number;
  /** Normalized pinch thresholds (thumb-index dist / hand scale). */
  pinchDown: number;
  pinchUp: number;
  oneHandMode: boolean;
  /** Steering sensitivity multiplier. */
  sensitivity: number;
  camera: 'first' | 'third';
  muted: boolean;
  /** 0..1, scales max speed for comfort. */
  speedLimit: number;
  /** Show the live camera feed (PiP) during races + in the setup screen. */
  showCamPreview: boolean;
}

export type GameMode = 'cruise' | 'trial' | 'rush';

export interface GameSnapshot {
  speedKmh: number;
  score: number;
  coins: number;
  mode: GameMode;
  timeLeft: number | null;
  crashed: boolean;
}

/** Input the game world consumes each frame. */
export interface DriveInput {
  steering: number;
  throttle: number;
  brake: number;
}

/** Minimal multiplayer state delta (quantized, client-predicted). */
export interface NetCarState {
  id: string;
  /** Quantized: -128..127 */
  steer: number;
  /** Quantized: 0..255 */
  speed: number;
  /** Lane index 0..3 */
  lane: number;
  /** Meters along track, quantized */
  dist: number;
}

/**
 * Central tuning constants. All magic numbers live here so gameplay,
 * gestures and tracking can be tuned from one place.
 */
import type { Calibration } from './types.ts';

export const TRACKING = {
  /** Tracking stream resolution — decoupled from render. */
  WIDTH: 640,
  HEIGHT: 480,
  /** Target inference cadence; auto-throttled down if the device is slow. */
  TARGET_FPS: 30,
  MIN_FPS: 10,
  NUM_HANDS: 2,
  MIN_DETECTION_CONFIDENCE: 0.5,
  MIN_TRACKING_CONFIDENCE: 0.5,
  MIN_PRESENCE_CONFIDENCE: 0.5,
  /** WASM runtime + model. WASM is pinned to the bundled tasks-vision
   *  version; the model uses the `latest` alias so it auto-updates. */
  WASM_URL: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
  MODEL_URL:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
} as const;

export const GESTURES = {
  /** Finger considered curled if tip->wrist < CURL_RATIO * handScale. */
  CURL_RATIO: 1.15,
  /** Finger considered extended if tip->wrist > EXTEND_RATIO * handScale. */
  EXTEND_RATIO: 1.5,
  /** Two fists form a grip if wrist distance < GRIP_RATIO * avgScale. */
  GRIP_RATIO: 1.7,
  /** Steering maps grip rotation over ±MAX_STEER_RAD to -1..1. */
  MAX_STEER_RAD: 0.65,
  /** Throttle: fractional hand-size shrink for full throttle. */
  THROTTLE_RANGE: 0.38,
  /** Brake: fractional hand-size growth for full brake. */
  BRAKE_RANGE: 0.5,
  /** Deadzone around neutral scale. */
  SCALE_DEADZONE: 0.06,
  /** Pinch must persist this long to flip state (anti-flicker). */
  PINCH_DEBOUNCE_MS: 120,
  /** Both palms open this long => pause menu. */
  PAUSE_HOLD_MS: 500,
  /** Output smoothing (0..1, higher = snappier). */
  STEER_SMOOTH: 0.35,
  THROTTLE_SMOOTH: 0.25,
} as const;

export const GAME = {
  LANES: 4,
  LANE_WIDTH: 3.6,
  /** Max speed m/s before speedLimit scaling (~ 230 km/h). */
  MAX_SPEED: 64,
  ACCEL: 22,
  BRAKE_DECEL: 38,
  DRAG: 4.5,
  STEER_SPEED: 2.6,
  CRASH_SLOWDOWN: 0.45,
  CRASH_COOLDOWN_MS: 900,
  COIN_SPAWN_EVERY_M: 28,
  TRAFFIC_DENSITY: 0.55,
  /** Render pixel ratio cap for perf. */
  MAX_PIXEL_RATIO: 1.5,
} as const;

export const NET = {
  /** Target total bandwidth incl. game traffic: well under 1 MB/s. */
  MAX_BYTES_PER_SEC: 200_000,
  SEND_HZ: 10,
  /** Quantization ranges for NetCarState. */
  Q: { STEER: 127, SPEED: 255, DIST_M: 4000 },
} as const;

export const DEFAULT_CALIBRATION: Calibration = {
  neutralAngle: 0,
  neutralScale: 0.16,
  pinchDown: 0.45,
  pinchUp: 0.68,
  oneHandMode: false,
  sensitivity: 1.0,
  camera: 'third',
  muted: false,
  speedLimit: 1.0,
  showCamPreview: true,
};

export const STORAGE_KEYS = {
  CALIBRATION: 'holo-racer:calibration:v1',
  HIGH_SCORE: 'holo-racer:highscore:v1',
} as const;

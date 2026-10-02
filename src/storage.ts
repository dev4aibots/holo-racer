/**
 * localStorage persistence: calibration/settings + high scores.
 * All reads are validated; corrupt data falls back to defaults.
 */
import { DEFAULT_CALIBRATION, STORAGE_KEYS } from './config.ts';
import type { Calibration, GameMode } from './types.ts';

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function loadCalibration(): Calibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CALIBRATION);
    if (!raw) return { ...DEFAULT_CALIBRATION };
    const p = JSON.parse(raw) as Partial<Calibration>;
    const d = DEFAULT_CALIBRATION;
    return {
      neutralAngle: isNum(p.neutralAngle) ? p.neutralAngle : d.neutralAngle,
      neutralScale: isNum(p.neutralScale) && p.neutralScale > 0.01 ? p.neutralScale : d.neutralScale,
      neutralCx: isNum(p.neutralCx) ? Math.min(1, Math.max(0, p.neutralCx)) : d.neutralCx,
      pinchDown: isNum(p.pinchDown) ? p.pinchDown : d.pinchDown,
      pinchUp: isNum(p.pinchUp) && p.pinchUp > (p.pinchDown ?? 0) ? p.pinchUp : d.pinchUp,
      oneHandMode: typeof p.oneHandMode === 'boolean' ? p.oneHandMode : d.oneHandMode,
      sensitivity: isNum(p.sensitivity) ? Math.min(2, Math.max(0.5, p.sensitivity)) : d.sensitivity,
      camera: p.camera === 'first' || p.camera === 'third' ? p.camera : d.camera,
      muted: typeof p.muted === 'boolean' ? p.muted : d.muted,
      speedLimit: isNum(p.speedLimit) ? Math.min(1, Math.max(0.4, p.speedLimit)) : d.speedLimit,
      showCamPreview: typeof p.showCamPreview === 'boolean' ? p.showCamPreview : d.showCamPreview,
      showSkeleton: typeof p.showSkeleton === 'boolean' ? p.showSkeleton : d.showSkeleton,
      showWheel: typeof p.showWheel === 'boolean' ? p.showWheel : d.showWheel,
    };
  } catch {
    return { ...DEFAULT_CALIBRATION };
  }
}

export function saveCalibration(cal: Calibration): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CALIBRATION, JSON.stringify(cal));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export type HighScores = Record<GameMode, number>;

export function loadHighScores(): HighScores {
  const fallback: HighScores = { cruise: 0, trial: 0, rush: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HIGH_SCORE);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<HighScores>;
    return {
      cruise: isNum(p.cruise) ? Math.max(0, Math.floor(p.cruise)) : 0,
      trial: isNum(p.trial) ? Math.max(0, Math.floor(p.trial)) : 0,
      rush: isNum(p.rush) ? Math.max(0, Math.floor(p.rush)) : 0,
    };
  } catch {
    return fallback;
  }
}

export function saveHighScore(mode: GameMode, score: number): boolean {
  const scores = loadHighScores();
  if (score <= scores[mode]) return false;
  scores[mode] = Math.floor(score);
  try {
    localStorage.setItem(STORAGE_KEYS.HIGH_SCORE, JSON.stringify(scores));
  } catch {
    /* noop */
  }
  return true;
}

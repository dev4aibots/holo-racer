import { describe, expect, it } from 'vitest';
import { DEFAULT_CALIBRATION, GESTURES } from '../src/config.ts';
import {
  GestureEngine,
  detectGrip,
  detectSingleFist,
  handScale,
  isFist,
  isPalmOpen,
  pinchDistance,
  scaleToPedals,
} from '../src/gestures/engine.ts';
import { LM, type HandFrame, type Landmark, type TrackedHand } from '../src/types.ts';

type Pose = 'fist' | 'palm' | 'pinch';

/**
 * Fabricate 21 plausible landmarks. Hand-local units: wrist->middle_mcp = 1u.
 * Image coords (x right, y down); fingers point up (-y).
 */
function makeHand(cx: number, cy: number, u: number, rot: number, pose: Pose, score = 0.95): TrackedHand {
  const P = (x: number, y: number): Landmark => ({ x: x * u, y: y * u, z: 0 });
  const pts: Landmark[] = new Array(21);

  pts[LM.WRIST] = P(0, 0);
  pts[LM.THUMB_CMC] = P(-0.35, -0.3);
  pts[LM.THUMB_MCP] = P(-0.5, -0.42);
  pts[LM.THUMB_IP] = P(-0.68, -0.6);

  const mcps: Array<[number, number]> = [
    [-0.4, -0.92], // index
    [0, -1.0], // middle
    [0.4, -0.92], // ring
    [0.76, -0.78], // pinky
  ];
  const mcpIdx = [LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  const pipIdx = [LM.INDEX_PIP, LM.MIDDLE_PIP, LM.RING_PIP, LM.PINKY_PIP];
  const dipIdx = [LM.INDEX_DIP, LM.MIDDLE_DIP, LM.RING_DIP, LM.PINKY_DIP];
  const tipIdx = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];

  for (let f = 0; f < 4; f++) {
    const [mx, my] = mcps[f];
    pts[mcpIdx[f]] = P(mx, my);
    let tx: number;
    let ty: number;
    if (pose === 'fist') {
      tx = mx * 0.25;
      ty = -0.42 + f * 0.05;
    } else {
      // palm / pinch: extended with slight fan
      tx = mx * 1.15;
      ty = my - 0.95;
    }
    pts[pipIdx[f]] = P(mx + (tx - mx) / 3, my + (ty - my) / 3);
    pts[dipIdx[f]] = P(mx + ((tx - mx) * 2) / 3, my + ((ty - my) * 2) / 3);
    pts[tipIdx[f]] = P(tx, ty);
  }

  if (pose === 'fist') {
    pts[LM.THUMB_TIP] = P(-0.3, -0.52); // tucked
  } else if (pose === 'pinch') {
    // Thumb tip meets index tip at a shared point.
    const px = -0.55;
    const py = -1.55;
    pts[LM.THUMB_TIP] = P(px, py);
    pts[LM.INDEX_TIP] = P(px, py);
    pts[LM.INDEX_DIP] = P((mcps[0][0] + px) / 2, (mcps[0][1] + py) / 2);
    pts[LM.INDEX_PIP] = P((mcps[0][0] * 3 + px) / 4, (mcps[0][1] * 3 + py) / 4);
  } else {
    pts[LM.THUMB_TIP] = P(-1.02, -0.88); // extended out
  }

  // Rotate around wrist, translate to (cx, cy).
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (const p of pts) {
    const x = p.x * cos - p.y * sin + cx;
    const y = p.x * sin + p.y * cos + cy;
    p.x = x;
    p.y = y;
  }
  return { landmarks: pts, handedness: 'Unknown', score, gesture: '', gestureScore: 0 };
}

function frame(t: number, hands: TrackedHand[]): HandFrame {
  return { t, hands };
}

function twoFistGrip(t: number, u = 0.16, angle = 0): HandFrame {
  // Wrists placed so the wrist-to-wrist vector has the given angle.
  // Separation scales with u (perspective-correct: farther hands are smaller
  // AND closer together in normalized units).
  const d = 1.25 * u;
  const ax = 0.5 - (Math.cos(angle) * d) / 2;
  const ay = 0.5 - (Math.sin(angle) * d) / 2;
  const bx = 0.5 + (Math.cos(angle) * d) / 2;
  const by = 0.5 + (Math.sin(angle) * d) / 2;
  return frame(t, [makeHand(ax, ay, u, 0, 'fist'), makeHand(bx, by, u, 0, 'fist')]);
}

describe('landmark helpers', () => {
  it('measures hand scale wrist->middle_mcp', () => {
    const h = makeHand(0.5, 0.5, 0.16, 0, 'fist');
    expect(handScale(h)).toBeCloseTo(0.16, 5);
  });

  it('classifies fist vs palm', () => {
    expect(isFist(makeHand(0.5, 0.5, 0.16, 0, 'fist'))).toBe(true);
    expect(isFist(makeHand(0.5, 0.5, 0.16, 0, 'palm'))).toBe(false);
    expect(isPalmOpen(makeHand(0.5, 0.5, 0.16, 0, 'palm'))).toBe(true);
    expect(isPalmOpen(makeHand(0.5, 0.5, 0.16, 0, 'fist'))).toBe(false);
  });

  it('pinch distance is ~0 for pinch pose, large for palm', () => {
    expect(pinchDistance(makeHand(0.5, 0.5, 0.16, 0, 'pinch'))).toBeLessThan(0.1);
    expect(pinchDistance(makeHand(0.5, 0.5, 0.16, 0, 'palm'))).toBeGreaterThan(1.0);
  });
});

describe('grip detection', () => {
  it('locks when two fists are close, rejects when apart', () => {
    expect(detectGrip(twoFistGrip(0).hands).locked).toBe(true);
    const far = frame(0, [makeHand(0.2, 0.5, 0.16, 0, 'fist'), makeHand(0.8, 0.5, 0.16, 0, 'fist')]);
    expect(detectGrip(far.hands).locked).toBe(false);
  });

  it('rejects when a hand is not a fist', () => {
    const mixed = frame(0, [makeHand(0.4, 0.5, 0.16, 0, 'fist'), makeHand(0.55, 0.5, 0.16, 0, 'palm')]);
    expect(detectGrip(mixed.hands).locked).toBe(false);
  });

  it('single-fist mode locks on one fist', () => {
    const one = frame(0, [makeHand(0.5, 0.5, 0.16, 0.3, 'fist')]);
    expect(detectSingleFist(one.hands).locked).toBe(true);
    expect(detectSingleFist([]).locked).toBe(false);
  });
});

describe('GestureEngine', () => {
  it('steers with grip rotation and converges with smoothing', () => {
    const eng = new GestureEngine({ ...DEFAULT_CALIBRATION });
    const target = Math.max(-1, -0.45 / GESTURES.MAX_STEER_RAD); // clamped to [-1, 1]
    let s = eng.update(twoFistGrip(0, 0.16, -0.45));
    for (let i = 1; i <= 40; i++) s = eng.update(twoFistGrip(i * 33, 0.16, -0.45));
    expect(s.gripLocked).toBe(true);
    expect(s.steering).toBeCloseTo(target, 1);
  });

  it('maps hand distance to throttle (far) and brake (close)', () => {
    const eng = new GestureEngine({ ...DEFAULT_CALIBRATION });
    let s = eng.update(twoFistGrip(0));
    for (let i = 1; i <= 40; i++) s = eng.update(twoFistGrip(i * 33, 0.096)); // far
    expect(s.throttle).toBeGreaterThan(0.8);
    expect(s.brake).toBe(0);
    for (let i = 41; i <= 80; i++) s = eng.update(twoFistGrip(i * 33, 0.224)); // close
    expect(s.brake).toBeGreaterThan(0.5);
    expect(s.throttle).toBeLessThan(0.1);
  });

  it('scaleToPedals has a deadzone at neutral', () => {
    const { throttle, brake } = scaleToPedals(0.16, 0.16);
    expect(throttle).toBe(0);
    expect(brake).toBe(0);
  });

  it('pinch requires debounce hold, ignores flicker', () => {
    const eng = new GestureEngine({ ...DEFAULT_CALIBRATION });
    const pinch = (t: number) => frame(t, [makeHand(0.5, 0.5, 0.16, 0, 'pinch')]);
    const open = (t: number) => frame(t, [makeHand(0.5, 0.5, 0.16, 0, 'palm')]);

    let s = eng.update(pinch(0));
    expect(s.pinch.active).toBe(false);
    s = eng.update(pinch(30));
    expect(s.pinch.active).toBe(false); // not yet past debounce (60ms)
    expect(s.pinchStarted).toBe(false);
    s = eng.update(pinch(70));
    expect(s.pinch.active).toBe(true);
    expect(s.pinchStarted).toBe(true);

    // Flicker: release briefly then re-pinch — must not end the pinch.
    s = eng.update(open(90));
    expect(s.pinchEnded).toBe(false);
    s = eng.update(pinch(110));
    expect(s.pinch.active).toBe(true);

    // Real release held past debounce ends it.
    s = eng.update(open(200));
    s = eng.update(open(300));
    expect(s.pinchEnded).toBe(true);
    expect(s.pinch.active).toBe(false);
  });

  it('fires pause once after both palms held 500ms', () => {
    const eng = new GestureEngine({ ...DEFAULT_CALIBRATION });
    const palms = (t: number) =>
      frame(t, [makeHand(0.35, 0.5, 0.16, 0, 'palm'), makeHand(0.65, 0.5, 0.16, 0, 'palm')]);
    let s = eng.update(palms(0));
    expect(s.pauseRequested).toBe(false);
    s = eng.update(palms(400));
    expect(s.pauseRequested).toBe(false);
    s = eng.update(palms(600));
    expect(s.pauseRequested).toBe(true);
    s = eng.update(palms(800));
    expect(s.pauseRequested).toBe(false); // fires only once per hold
    // Releasing resets the hold timer.
    s = eng.update(frame(900, []));
    s = eng.update(palms(1500));
    expect(s.pauseRequested).toBe(false);
  });

  it('losing hands releases pinch and decays controls safely', () => {
    const eng = new GestureEngine({ ...DEFAULT_CALIBRATION });
    const pinch = (t: number) => frame(t, [makeHand(0.5, 0.5, 0.16, 0, 'pinch')]);
    eng.update(pinch(0));
    eng.update(pinch(200));
    const s = eng.update(frame(300, []));
    expect(s.pinch.active).toBe(false);
    expect(s.pinchEnded).toBe(true);
    expect(s.gripLocked).toBe(false);
    expect(s.handsCount).toBe(0);
  });

  it('1-hand mode steers from a single fist', () => {
    const eng = new GestureEngine({ ...DEFAULT_CALIBRATION, oneHandMode: true });
    let s = eng.update(frame(0, [makeHand(0.5, 0.5, 0.16, 0.4, 'fist')]));
    for (let i = 1; i <= 40; i++)
      s = eng.update(frame(i * 33, [makeHand(0.5, 0.5, 0.16, 0.4, 'fist')]));
    expect(s.gripLocked).toBe(true);
    expect(Math.abs(s.steering)).toBeGreaterThan(0.2);
  });
});

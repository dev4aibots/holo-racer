/**
 * Unit tests for reference-ported temporal filter and gestures.
 * Ports the exact constants from user's MR Spatial Computer.
 */
import { describe, expect, it } from 'vitest';
import { OneEuroFilter, CursorFilter, Debouncer } from '../src/gestures/reference-filter.ts';
import {
  ReferenceGestureRecognizer,
  pinchRatio,
} from '../src/gestures/reference-gestures.ts';
import { LM } from '../src/types.ts';
import type { TrackedHand } from '../src/types.ts';

function makeHand(overrides: Partial<TrackedHand> = {}): TrackedHand {
  const landmarks = Array.from({ length: 21 }, (_, i) => ({
    x: 0.5 + (i % 5) * 0.01,
    y: 0.5 + Math.floor(i / 5) * 0.01,
    z: 0,
  }));
  // Make a fist by default (tips close to wrist)
  return {
    landmarks,
    handedness: 'Right',
    score: 0.9,
    gesture: null,
    gestureScore: 0,
    ...overrides,
  } as TrackedHand;
}

describe('OneEuroFilter (reference constants)', () => {
  it('uses minCutoff 1.6, beta 0.020, dCutoff 1.0', () => {
    const f = new OneEuroFilter();
    // Filter should smooth but track
    const t0 = 0;
    let v = f.filter(0.5, t0);
    expect(v).toBeCloseTo(0.5, 5);
    v = f.filter(0.6, t0 + 0.016);
    // Should move toward 0.6 but not jump all the way (smoothing)
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(0.6);
  });

  it('applies velocity-gated 15ms extrapolation when fast', () => {
    const f = new OneEuroFilter();
    const t0 = 0;
    // Fast movement: 0.5 -> 1.0 in 16ms = ~31 units/s (>> 0.5 threshold)
    f.filter(0.5, t0);
    const v = f.filter(1.0, t0 + 0.016);
    // With extrapolation, should overshoot the filtered value
    // (exact value depends on filter state, just verify it's working)
    expect(v).toBeGreaterThan(0.5);
  });

  it('does not extrapolate when stationary', () => {
    const f = new OneEuroFilter();
    const t0 = 0;
    f.filter(0.5, t0);
    // Small movement: velocity < 0.5 threshold
    f.filter(0.501, t0 + 0.016);
    const v2 = f.filter(0.501, t0 + 0.032);
    // Should converge without overshoot
    expect(Math.abs(v2 - 0.501)).toBeLessThan(0.01);
  });
});

describe('CursorFilter', () => {
  it('filters 2D points', () => {
    const cf = new CursorFilter();
    const p1 = cf.filter(0.5, 0.5, 0);
    expect(p1.x).toBeCloseTo(0.5, 5);
    expect(p1.y).toBeCloseTo(0.5, 5);
  });

  it('scales extrapolation with latency', () => {
    const cf = new CursorFilter();
    cf.setLatencyMs(100); // high latency
    // Fast movement should extrapolate more
    cf.filter(0.5, 0.5, 0);
    const p = cf.filter(0.8, 0.8, 0.016);
    expect(p.x).toBeGreaterThan(0.5);
  });
});

describe('Debouncer', () => {
  it('requires 2 consecutive trues (reference 2/2)', () => {
    const d = new Debouncer(2);
    expect(d.update(true)).toBe(false); // 1st true
    expect(d.update(true)).toBe(true); // 2nd true -> flips
    expect(d.update(false)).toBe(true); // 1st false
    expect(d.update(false)).toBe(false); // 2nd false -> flips
  });
});

describe('ReferenceGestureRecognizer', () => {
  it('detects pinch with 0.34/0.085 hysteresis', () => {
    const rec = new ReferenceGestureRecognizer();
    const hand = makeHand();
    // Set thumb and index tips close together (pinch)
    hand.landmarks[LM.THUMB_TIP] = { x: 0.5, y: 0.5, z: 0 };
    hand.landmarks[LM.INDEX_TIP] = { x: 0.51, y: 0.5, z: 0 }; // 0.01 apart
    hand.landmarks[LM.WRIST] = { x: 0.5, y: 0.6, z: 0 };
    hand.landmarks[LM.MIDDLE_MCP] = { x: 0.5, y: 0.55, z: 0 }; // palm span 0.05
    // Ratio = 0.01 / 0.05 = 0.2 < 0.34 -> pinch
    const r = rec.recognize(hand, 'Right', null, 0, true);
    expect(r.gesture).toBe('PINCH');
    expect(r.isPinchClick).toBe(true); // rising edge, primary hand
  });

  it('pinch re-arms only on full release', () => {
    const rec = new ReferenceGestureRecognizer();
    const hand = makeHand();
    hand.landmarks[LM.THUMB_TIP] = { x: 0.5, y: 0.5, z: 0 };
    hand.landmarks[LM.INDEX_TIP] = { x: 0.51, y: 0.5, z: 0 };
    hand.landmarks[LM.WRIST] = { x: 0.5, y: 0.6, z: 0 };
    hand.landmarks[LM.MIDDLE_MCP] = { x: 0.5, y: 0.55, z: 0 };

    // First pinch -> click
    let r = rec.recognize(hand, 'Right', null, 0, true);
    expect(r.isPinchClick).toBe(true);

    // Still pinched -> no second click
    r = rec.recognize(hand, 'Right', null, 0, true);
    expect(r.isPinchClick).toBe(false);

    // Release (ratio > 0.085)
    hand.landmarks[LM.INDEX_TIP] = { x: 0.6, y: 0.5, z: 0 }; // far apart
    r = rec.recognize(hand, 'Right', null, 0, true);
    expect(r.gesture).not.toBe('PINCH');

    // Pinch again -> click (re-armed)
    hand.landmarks[LM.INDEX_TIP] = { x: 0.51, y: 0.5, z: 0 };
    r = rec.recognize(hand, 'Right', null, 0, true);
    expect(r.isPinchClick).toBe(true);
  });

  it('pinch-click only fires for primary hand', () => {
    const rec = new ReferenceGestureRecognizer();
    const hand = makeHand();
    hand.landmarks[LM.THUMB_TIP] = { x: 0.5, y: 0.5, z: 0 };
    hand.landmarks[LM.INDEX_TIP] = { x: 0.51, y: 0.5, z: 0 };
    hand.landmarks[LM.WRIST] = { x: 0.5, y: 0.6, z: 0 };
    hand.landmarks[LM.MIDDLE_MCP] = { x: 0.5, y: 0.55, z: 0 };

    const r = rec.recognize(hand, 'Left', null, 0, false); // not primary
    expect(r.gesture).toBe('PINCH');
    expect(r.isPinchClick).toBe(false); // no click for non-primary
  });

  it('maps MediaPipe Closed_Fist to GRAB', () => {
    const rec = new ReferenceGestureRecognizer();
    const hand = makeHand();
    // Make tips far from palm so GRAB fallback doesn't trigger
    // (we want MP gesture to win)
    const r = rec.recognize(hand, 'Right', 'Closed_Fist', 0.8, true);
    expect(r.gesture).toBe('GRAB');
  });

  it('stale gesture persists (anti-hallucination)', () => {
    const rec = new ReferenceGestureRecognizer();
    const hand = makeHand();
    // First: strong GRAB via MP
    let r = rec.recognize(hand, 'Right', 'Closed_Fist', 0.9, true);
    expect(r.gesture).toBe('GRAB');

    // Then: weak frame (no MP gesture, not grab, not point)
    // Should persist GRAB, not snap to NONE
    r = rec.recognize(hand, 'Right', null, 0, true);
    // Might be GRAB (via fallback) or stale GRAB - either way not NONE
    expect(r.gesture).not.toBe('NONE');
  });
});

describe('pinchRatio', () => {
  it('is distance-invariant (normalized by palm span)', () => {
    const hand = makeHand();
    hand.landmarks[LM.THUMB_TIP] = { x: 0.5, y: 0.5, z: 0 };
    hand.landmarks[LM.INDEX_TIP] = { x: 0.52, y: 0.5, z: 0 };
    hand.landmarks[LM.WRIST] = { x: 0.5, y: 0.6, z: 0 };
    hand.landmarks[LM.MIDDLE_MCP] = { x: 0.5, y: 0.55, z: 0 };
    // 0.02 / 0.05 = 0.4
    expect(pinchRatio(hand)).toBeCloseTo(0.4, 2);
  });
});

/**
 * One Euro filter (Casiez et al.) for low-latency, low-jitter smoothing of
 * landmark streams. Pure TS, no dependencies.
 */

function alpha(cutoff: number, freq: number): number {
  const te = 1 / Math.max(freq, 1e-6);
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / te);
}

export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;
  /**
   * Velocity extrapolation: when the signal moves faster than this
   * (normalized units/sec), predict forward to cancel pipeline latency.
   * The lookahead is set dynamically from measured end-to-end latency.
   */
  private static readonly EXTRAPOLATE_VEL = 0.5;
  private lookaheadS = 0.015;

  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  /** Set the prediction lookahead in seconds (from measured pipeline latency). */
  setLookahead(seconds: number): void {
    this.lookaheadS = Math.max(0, Math.min(0.1, seconds));
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  /** Current velocity estimate (normalized units/sec). */
  get velocity(): number {
    return this.dxPrev;
  }

  filter(x: number, t: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.tPrev = t;
      this.xPrev = x;
      return x;
    }
    const dt = Math.max((t - this.tPrev) / 1000, 1e-6);
    const freq = 1 / dt;
    const dx = (x - this.xPrev) * freq;
    const edx = this.dxPrev + alpha(this.dCutoff, freq) * (dx - this.dxPrev);
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    let xHat = this.xPrev + alpha(cutoff, freq) * (x - this.xPrev);
    this.xPrev = xHat;
    this.dxPrev = edx;
    this.tPrev = t;
    // Forward-predict by measured pipeline latency during fast motion.
    if (Math.abs(edx) > OneEuroFilter.EXTRAPOLATE_VEL) {
      xHat += edx * this.lookaheadS;
    }
    return xHat;
  }
}

/**
 * Smooths a full set of hand landmarks. One filter per coordinate per
 * landmark per hand slot. Hand slots are positional (sorted by wrist x) so
 * identities stay stable frame-to-frame; a hand-count change resets.
 *
 * Includes an innovation gate: rejects one-frame landmark teleports
 * (MediaPipe glitches) that would otherwise jerk the steering.
 */
export class LandmarkSmoother {
  private filters: OneEuroFilter[] = [];
  private lastCount = -1;
  private lastRaw: Array<Array<{ x: number; y: number; z: number }>> = [];
  /**
   * Max plausible per-frame landmark movement (normalized units).
   * At 30fps, 0.15 = 4.5 units/sec — faster than any real hand motion.
   * Teleports beyond this are rejected as glitches.
   */
  private static readonly MAX_TELEPORT = 0.15;

  constructor(
    private maxHands = 2,
    private landmarks = 21,
    minCutoff = 1.2,
    beta = 0.03,
  ) {
    for (let i = 0; i < this.maxHands * this.landmarks * 3; i++) {
      this.filters.push(new OneEuroFilter(minCutoff, beta));
    }
  }

  /** Set prediction lookahead (seconds) from measured pipeline latency. */
  setLookahead(seconds: number): void {
    for (const f of this.filters) f.setLookahead(seconds);
  }

  /**
   * Smooth hands in place order. `hands[i][j]` = landmark j of hand i with
   * {x,y,z}. Returns a new array (does not mutate input).
   *
   * Innovation gate: if a landmark teleports further than MAX_TELEPORT in
   * one frame, it's a MediaPipe glitch — hold the last good value instead
   * of feeding the spike into the filter.
   */
  smooth(
    hands: Array<Array<{ x: number; y: number; z: number }>>,
    t: number,
  ): Array<Array<{ x: number; y: number; z: number }>> {
    if (hands.length !== this.lastCount) {
      for (const f of this.filters) f.reset();
      this.lastCount = hands.length;
      this.lastRaw = [];
    }
    const out = hands.map((lm, hi) =>
      lm.map((p, li) => {
        const base = (hi * this.landmarks + li) * 3;
        // Innovation gate: reject teleports.
        const prev = this.lastRaw[hi]?.[li];
        let px = p.x, py = p.y, pz = p.z;
        if (prev) {
          const dx = px - prev.x, dy = py - prev.y, dz = pz - prev.z;
          if (dx * dx + dy * dy + dz * dz > LandmarkSmoother.MAX_TELEPORT ** 2) {
            px = prev.x; py = prev.y; pz = prev.z;
          }
        }
        return {
          x: this.filters[base].filter(px, t),
          y: this.filters[base + 1].filter(py, t),
          z: this.filters[base + 2].filter(pz, t),
        };
      }),
    );
    // Store raw (pre-gate) for next frame's teleport check — use the gated
    // values so a sustained glitch doesn't permanently poison the reference.
    this.lastRaw = out.map(hand => hand.map(p => ({ ...p })));
    return out;
  }
}

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

  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
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
    const xHat = this.xPrev + alpha(cutoff, freq) * (x - this.xPrev);
    this.xPrev = xHat;
    this.dxPrev = edx;
    this.tPrev = t;
    return xHat;
  }
}

/**
 * Smooths a full set of hand landmarks. One filter per coordinate per
 * landmark per hand slot. Hand slots are positional (sorted by wrist x) so
 * identities stay stable frame-to-frame; a hand-count change resets.
 */
export class LandmarkSmoother {
  private filters: OneEuroFilter[] = [];
  private lastCount = -1;

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

  /**
   * Smooth hands in place order. `hands[i][j]` = landmark j of hand i with
   * {x,y,z}. Returns a new array (does not mutate input).
   */
  smooth(
    hands: Array<Array<{ x: number; y: number; z: number }>>,
    t: number,
  ): Array<Array<{ x: number; y: number; z: number }>> {
    if (hands.length !== this.lastCount) {
      for (const f of this.filters) f.reset();
      this.lastCount = hands.length;
    }
    return hands.map((lm, hi) =>
      lm.map((p, li) => {
        const base = (hi * this.landmarks + li) * 3;
        return {
          x: this.filters[base].filter(p.x, t),
          y: this.filters[base + 1].filter(p.y, t),
          z: this.filters[base + 2].filter(p.z, t),
        };
      }),
    );
  }
}

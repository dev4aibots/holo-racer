/**
 * Reference-ported temporal filtering from user's MR Spatial Computer.
 *
 * Ports temporal_filter.py EXACTLY:
 * - OneEuro 1D filter with min_cutoff 1.6, beta 0.020, d_cutoff 1.0
 * - dt = max(ts - t_prev, 0.0001)
 * - Adaptive cutoff: cutoff = min_cutoff + beta * |dx_hat|
 * - Velocity-gated 15ms forward extrapolation: if |dx_hat| > 0.5: x_hat += dx_hat * 0.015
 *
 * CRITICAL: Filter runs on CURSOR POINT, not per-landmark.
 * One update per hand per frame = cheap + butter-smooth (per reference).
 */
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(minCutoff = 1.6, beta = 0.020, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const te = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + te / dt);
  }

  filter(x: number, timestamp: number): number {
    const dt = this.tPrev === null
      ? 0.016
      : Math.max(timestamp - this.tPrev, 0.0001);

    // Estimate derivative
    const dx = this.xPrev === null ? 0 : (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    // Adaptive cutoff based on speed
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = this.xPrev === null
      ? x
      : a * x + (1 - a) * this.xPrev;

    // Velocity-gated forward extrapolation (15ms, only when fast)
    let result = xHat;
    if (Math.abs(dxHat) > 0.5) {
      result = xHat + dxHat * 0.015;
    }

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = timestamp;
    return result;
  }

  getVelocity(): number {
    return this.dxPrev;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

/**
 * Cursor-level temporal filter (2D point).
 * One instance per hand. Filters the CURSOR (pinch center or palm center),
 * NOT individual landmarks — this is the reference's key smoothness insight.
 */
export class CursorFilter {
  private fx = new OneEuroFilter();
  private fy = new OneEuroFilter();
  private latencyMs = 50; // measured end-to-end, scales extrapolation horizon

  setLatencyMs(ms: number): void {
    this.latencyMs = Math.max(0, Math.min(200, ms));
  }

  /**
   * Filter a 2D cursor point. Returns smoothed + extrapolated position.
   * Extrapolation horizon scales with measured latency (reference used fixed 15ms).
   */
  filter(x: number, y: number, timestamp: number): { x: number; y: number } {
    // Scale the extrapolation by measured latency vs reference 15ms baseline
    // The OneEuroFilter has fixed 15ms; we adjust by pre-scaling velocity influence
    // via timestamp manipulation is complex, so we use the base filter and
    // apply additional latency-compensated extrapolation here.
    const fx = this.fx.filter(x, timestamp);
    const fy = this.fy.filter(y, timestamp);

    // Additional latency compensation beyond the 15ms in the filter
    const extraMs = Math.max(0, this.latencyMs - 15) / 1000;
    if (extraMs > 0.001) {
      const vx = this.fx.getVelocity();
      const vy = this.fy.getVelocity();
      const speed = Math.hypot(vx, vy);
      if (speed > 0.5) {
        return {
          x: fx + vx * extraMs,
          y: fy + vy * extraMs,
        };
      }
    }
    return { x: fx, y: fy };
  }

  getVelocity(): { x: number; y: number } {
    return { x: this.fx.getVelocity(), y: this.fy.getVelocity() };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}

/**
 * Debouncer: requires N consecutive true/false before state changes.
 * Reference uses 2/2 for grab transitions.
 */
export class Debouncer {
  private count = 0;
  private state = false;
  private readonly required: number;

  constructor(required = 2) {
    this.required = required;
  }

  update(value: boolean): boolean {
    if (value === this.state) {
      this.count = 0;
    } else {
      this.count++;
      if (this.count >= this.required) {
        this.state = value;
        this.count = 0;
      }
    }
    return this.state;
  }

  get value(): boolean {
    return this.state;
  }

  reset(): void {
    this.count = 0;
    this.state = false;
  }
}

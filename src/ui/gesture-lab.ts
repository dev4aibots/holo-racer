/**
 * Gesture Lab — live diagnostics for the camera gesture pipeline.
 *
 * Shows real-time pipeline metrics so gesture problems can be diagnosed
 * with numbers instead of guesses. The user screenshots this (or reads the
 * values) to report what's actually happening on their hardware.
 */
import type { ControlState } from '../types.ts';

export interface LabMetrics {
  /** Rolling average MediaPipe inference time (ms). */
  inferMs: number;
  /** Capture cadence (fps). */
  fps: number;
  /** True when inference is slow and we've dropped to 20fps. */
  degraded: boolean;
  /** GPU or CPU delegate. */
  delegate: string;
}

export interface LabCallbacks {
  onBack(): void;
  onCopy(): void;
}

function bar(value: number, min: number, max: number): string {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const filled = Math.round(pct * 20);
  return '█'.repeat(filled) + '░'.repeat(20 - filled);
}

export class GestureLab {
  private root: HTMLElement;
  private cb: LabCallbacks;
  private el: HTMLElement | null = null;
  private els: Record<string, HTMLElement> = {};

  constructor(root: HTMLElement, cb: LabCallbacks) {
    this.root = root;
    this.cb = cb;
  }

  show(): void {
    this.hide();
    const el = document.createElement('div');
    el.className = 'screen';
    el.dataset.screen = 'gesture-lab';
    el.innerHTML = `
      <div class="holo-panel lab-panel">
        <h2 class="panel-title">🔬 Gesture Lab — live diagnostics</h2>
        <p class="hint">Move your hands like you're driving. Watch the numbers.
        Screenshot this panel (or copy the text) to report what's happening.</p>

        <h3 class="lab-section">Pipeline</h3>
        <div class="lab-grid">
          <div class="lab-row"><span>Inference time</span><b id="lab-infer">—</b></div>
          <div class="lab-row"><span>Camera rate</span><b id="lab-fps">—</b></div>
          <div class="lab-row"><span>AI delegate</span><b id="lab-delegate">—</b></div>
          <div class="lab-row"><span>Pipeline mode</span><b id="lab-mode">—</b></div>
        </div>

        <h3 class="lab-section">Detection</h3>
        <div class="lab-grid">
          <div class="lab-row"><span>Hands seen</span><b id="lab-hands">—</b></div>
          <div class="lab-row"><span>Steering grip</span><b id="lab-grip">—</b></div>
          <div class="lab-row"><span>Signal quality</span><b id="lab-quality">—</b></div>
        </div>

        <h3 class="lab-section">Live controls</h3>
        <div class="lab-grid">
          <div class="lab-row"><span>Steering</span><b id="lab-steer">—</b></div>
          <div class="lab-row"><span>Throttle</span><b id="lab-throttle">—</b></div>
          <div class="lab-row"><span>Brake</span><b id="lab-brake">—</b></div>
          <div class="lab-row"><span>Pinch</span><b id="lab-pinch">—</b></div>
        </div>

        <h3 class="lab-section">Latency estimate</h3>
        <div class="lab-grid">
          <div class="lab-row"><span>Hand → game</span><b id="lab-latency">—</b></div>
        </div>
        <p class="hint">Estimate = capture interval + inference + smoothing.
        Over 250ms feels laggy. Over 400ms feels broken.</p>

        <div class="btn-row">
          <button class="holo-btn" id="lab-copy">⧉ Copy readings</button>
          <button class="holo-btn primary" id="lab-back">← Back</button>
        </div>
      </div>
    `;
    this.root.appendChild(el);
    this.el = el;
    const q = (id: string): HTMLElement => {
      const n = el.querySelector<HTMLElement>(id);
      if (!n) throw new Error(`GestureLab: missing ${id}`);
      return n;
    };
    for (const id of ['lab-infer', 'lab-fps', 'lab-delegate', 'lab-mode', 'lab-hands',
      'lab-grip', 'lab-quality', 'lab-steer', 'lab-throttle', 'lab-brake',
      'lab-pinch', 'lab-latency']) {
      this.els[id] = q(`#${id}`);
    }
    q('#lab-back').addEventListener('click', () => this.cb.onBack());
    q('#lab-copy').addEventListener('click', () => this.cb.onCopy());
  }

  /** Refresh all readouts. Call on every hand frame. */
  update(m: LabMetrics, c: ControlState | null): void {
    if (!this.el) return;
    const set = (id: string, text: string, good?: boolean): void => {
      const n = this.els[id];
      n.textContent = text;
      n.classList.toggle('lab-good', good === true);
      n.classList.toggle('lab-bad', good === false);
    };

    // Pipeline
    set('lab-infer', `${m.inferMs.toFixed(0)} ms`, m.inferMs < 50 ? true : m.inferMs > 100 ? false : undefined);
    set('lab-fps', `${m.fps.toFixed(0)} fps`);
    set('lab-delegate', m.delegate);
    set('lab-mode', m.degraded ? 'DEGRADED (20fps)' : 'FULL (30fps)', !m.degraded);

    // Detection
    if (c) {
      set('lab-hands', String(c.handsCount), c.handsCount > 0 ? true : false);
      set('lab-grip', c.gripLocked ? 'LOCKED ✓' : 'no grip', c.gripLocked);
      set('lab-quality', `${Math.round(c.quality * 100)}%`, c.quality > 0.5 ? true : c.quality < 0.2 ? false : undefined);

      // Controls
      set('lab-steer', `${bar(c.steering, -1, 1)} ${c.steering >= 0 ? '+' : ''}${c.steering.toFixed(2)}`);
      set('lab-throttle', `${bar(c.throttle, 0, 1)} ${Math.round(c.throttle * 100)}%`);
      set('lab-brake', `${bar(c.brake, 0, 1)} ${Math.round(c.brake * 100)}%`);
      set('lab-pinch', c.pinch.active ? 'DOWN ●' : 'up ○', c.pinch.active);

      // Latency estimate: capture interval + inference + ~2 frames smoothing/render
      const captureMs = 1000 / Math.max(m.fps, 1);
      const estimate = captureMs + m.inferMs + 50;
      set('lab-latency', `~${estimate.toFixed(0)} ms`,
        estimate < 200 ? true : estimate > 350 ? false : undefined);
    } else {
      set('lab-hands', '—');
      set('lab-grip', '—');
      set('lab-quality', '—');
      set('lab-steer', '—');
      set('lab-throttle', '—');
      set('lab-brake', '—');
      set('lab-pinch', '—');
      set('lab-latency', '—');
    }
  }

  /** Plain-text snapshot for copy/paste bug reports. */
  snapshot(m: LabMetrics, c: ControlState | null): string {
    const lines = [
      'HOLO-RACER Gesture Lab readings',
      `Inference: ${m.inferMs.toFixed(0)} ms`,
      `Camera: ${m.fps.toFixed(0)} fps (${m.degraded ? 'degraded' : 'full'})`,
      `Delegate: ${m.delegate}`,
    ];
    if (c) {
      lines.push(
        `Hands: ${c.handsCount}, grip: ${c.gripLocked ? 'locked' : 'no'}, quality: ${Math.round(c.quality * 100)}%`,
        `Steering: ${c.steering.toFixed(2)}, throttle: ${Math.round(c.throttle * 100)}%, brake: ${Math.round(c.brake * 100)}%`,
        `Pinch: ${c.pinch.active ? 'down' : 'up'}`,
      );
    }
    return lines.join('\n');
  }

  hide(): void {
    if (this.el) {
      this.el.remove();
      this.el = null;
      this.els = {};
    }
  }

  get isOpen(): boolean {
    return this.el !== null;
  }
}

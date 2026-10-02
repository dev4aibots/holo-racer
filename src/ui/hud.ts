/**
 * HUD — in-race overlay: speed, score, coins, timer, tracking status,
 * grip lock indicator, pinch cursor reticle, flash messages, countdown.
 */
import type { GameSnapshot } from '../types.ts';

/** Color for the tracking status dot from 0..1 quality. */
function qualityColor(q: number): string {
  if (q >= 0.66) return '#3dff9e';
  if (q >= 0.33) return '#ffd94d';
  return '#ff4d6d';
}

export class HUD {
  private el: HTMLElement;
  private speedEl: HTMLElement;
  private scoreEl: HTMLElement;
  private coinsEl: HTMLElement;
  private timeEl: HTMLElement;
  private timeWrap: HTMLElement;
  private dotEl: HTMLElement;
  private gripEl: HTMLElement;
  private cursorEl: HTMLElement;
  private flashEl: HTMLElement;
  private countdownEl: HTMLElement;
  private pauseBtn: HTMLElement;
  private flashTimer: number | null = null;
  private countdownTimer: number | null = null;

  constructor(root: HTMLElement, opts?: { onPause?: () => void }) {
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.className = 'hidden';
    this.el.innerHTML = `
      <div class="hud-group">
        <div class="hud-speed"><span id="hud-speed-val">0</span><small> km/h</small></div>
        <div class="hud-stat"><span class="label">SCORE</span><span class="value" id="hud-score-val">0</span></div>
        <div class="hud-stat"><span class="label">COINS</span><span class="value coins" id="hud-coins-val">0</span></div>
        <div class="hud-stat" id="hud-time-wrap"><span class="label">TIME</span><span class="value time" id="hud-time-val">--</span></div>
      </div>
      <div class="hud-group">
        <div class="hud-status">
          <span class="track-dot" id="hud-track-dot" title="Tracking quality"></span>
          <span class="grip-badge" id="hud-grip">GRIP</span>
          <button class="hud-pause-btn" id="hud-pause" title="Pause (P)" aria-label="Pause game">⏸</button>
        </div>
      </div>
      <div id="hud-flash" aria-live="polite"></div>
      <div id="hud-countdown" aria-live="assertive"></div>
    `;
    root.appendChild(this.el);

    const q = (id: string): HTMLElement => {
      const n = this.el.querySelector<HTMLElement>(id);
      if (!n) throw new Error(`HUD: missing ${id}`);
      return n;
    };
    this.speedEl = q('#hud-speed-val');
    this.scoreEl = q('#hud-score-val');
    this.coinsEl = q('#hud-coins-val');
    this.timeEl = q('#hud-time-val');
    this.timeWrap = q('#hud-time-wrap');
    this.dotEl = q('#hud-track-dot');
    this.gripEl = q('#hud-grip');
    this.flashEl = q('#hud-flash');
    this.countdownEl = q('#hud-countdown');
    this.pauseBtn = q('#hud-pause');
    if (opts?.onPause) {
      this.pauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onPause?.();
      });
    }

    // Pinch cursor reticle lives in the root (above screens too).
    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'pinch-cursor';
    this.cursorEl.style.display = 'none';
    root.appendChild(this.cursorEl);
  }

  /** Per-frame refresh from the game snapshot. */
  update(s: GameSnapshot, quality: number, gripLocked: boolean): void {
    this.speedEl.textContent = String(Math.round(s.speedKmh));
    this.scoreEl.textContent = String(s.score);
    this.coinsEl.textContent = String(s.coins);
    if (s.timeLeft == null) {
      this.timeWrap.style.display = 'none';
    } else {
      this.timeWrap.style.display = '';
      const t = Math.max(0, s.timeLeft);
      const m = Math.floor(t / 60);
      const sec = Math.floor(t % 60);
      this.timeEl.textContent = `${m}:${String(sec).padStart(2, '0')}`;
    }
    this.dotEl.style.background = qualityColor(quality);
    this.dotEl.style.color = qualityColor(quality);
    this.gripEl.classList.toggle('locked', gripLocked);
    this.gripEl.textContent = gripLocked ? 'GRIP ✓' : 'GRIP';
  }

  /**
   * Move the pinch cursor reticle. x01/y01 are normalized 0..1 viewport
   * coords (y down). active = pinch currently down. visible = any hand tracked.
   */
  showCursor(x01: number, y01: number, active: boolean, visible: boolean): void {
    if (!visible) {
      this.cursorEl.style.display = 'none';
      return;
    }
    this.cursorEl.style.display = 'block';
    this.cursorEl.style.left = `${x01 * 100}%`;
    this.cursorEl.style.top = `${y01 * 100}%`;
    this.cursorEl.classList.toggle('active', active);
  }

  /** Center-screen transient message (e.g. "+50", "CRASH!", "FINAL LAP"). */
  flash(text: string, durationMs = 1200): void {
    if (this.flashTimer != null) window.clearTimeout(this.flashTimer);
    this.flashEl.textContent = text;
    this.flashEl.classList.add('show');
    this.flashTimer = window.setTimeout(() => {
      this.flashEl.classList.remove('show');
      this.flashTimer = null;
    }, durationMs);
  }

  /** Message that stays visible until clearFlash() or the next flash(). */
  flashSticky(text: string): void {
    this.flash(text, 3_600_000);
  }

  clearFlash(): void {
    if (this.flashTimer != null) window.clearTimeout(this.flashTimer);
    this.flashTimer = null;
    this.flashEl.classList.remove('show');
  }

  /** Big countdown number; pass 0 or negative to clear. */
  showCountdown(n: number): void {
    if (this.countdownTimer != null) window.clearTimeout(this.countdownTimer);
    if (n <= 0) {
      this.countdownEl.classList.remove('show');
      this.countdownEl.textContent = '';
      return;
    }
    this.countdownEl.textContent = n > 0 && n < 4 ? String(n) : 'GO!';
    this.countdownEl.classList.add('show');
  }

  setVisible(v: boolean): void {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.cursorEl.style.display = 'none';
      this.flashEl.classList.remove('show');
      this.countdownEl.classList.remove('show');
    }
  }
}

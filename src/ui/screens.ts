/**
 * Screens — fullscreen menu / pause / settings / calibration / how-to overlays.
 *
 * Pinch-to-click contract (implemented by main.ts, NOT here):
 *   Every interactive button carries a `data-action` attribute (listed below).
 *   main.ts hit-tests the pinch cursor position against `[data-action]`
 *   elements and synthesizes a real `.click()` on the one under the cursor,
 *   so all buttons here are plain <button>s with normal click handlers.
 *   The `.cursor-hover` CSS class highlights the button under the cursor.
 *
 * Action names:
 *   Menu:        mode-cruise | mode-trial | mode-rush
 *                open-howto | open-calibration | open-settings | open-camera-setup
 *   CameraSetup: setup-calibrate | setup-race | setup-back
 *   Pause:       pause-resume | pause-restart | pause-settings | pause-quit
 *   Settings:    close-overlay            (back button)
 *   HowTo:       close-overlay            (back button)
 *   Calibration: cal-capture-neutral | cal-capture-pinch | cal-done
 *                cal-back                 (back one step / cancel)
 *
 * Keyboard: Escape fires onCloseOverlay() whenever a non-menu screen is open.
 */
import type { Calibration, GameMode } from '../types.ts';
import type { CameraDiagnostics } from './camera-diagnostics.ts';

export interface ScreenCallbacks {
  onStart(mode: GameMode): void;
  onResume(): void;
  onRestart(): void;
  onQuitToMenu(): void;
  onOpenSettings(): void;
  onOpenCalibration(): void;
  onOpenHowTo(): void;
  onOpenCameraSetup(): void;
  onCloseOverlay(): void;
  onCalibrationDone(cal: Partial<Calibration>): void;
}

/** Callbacks for the camera-diagnostics panel. */
export interface CameraDiagCallbacks {
  onRetry(): void;
  onCopy(): void;
  onKeyboard(): void;
}

/** Callbacks for the camera & gesture setup environment screen. */
export interface CameraSetupCallbacks {
  /** Open the calibration wizard (returns to setup when done). */
  onCalibrate(): void;
  /** Leave setup and start a race. */
  onRace(): void;
  /** Leave setup, back to the menu. */
  onBack(): void;
}

/** One live tracking sample for the calibration wizard. */
export interface CalSample {  /** Grip vector angle (rad), null when no grip locked. */
  angle: number | null;
  /** Hand scale (wrist->middle_mcp), null when no grip locked. */
  scale: number | null;
  /** Normalized thumb-index distance of best hand, null when no hands. */
  pinch: number | null;
  hands: number;
  gripLocked: boolean;
}

type Sampler = () => CalSample;

const MODES: Array<{ mode: GameMode; action: string; icon: string; name: string; desc: string }> = [
  { mode: 'cruise', action: 'mode-cruise', icon: '🛣️', name: 'CRUISE', desc: 'Endless run. Chase the high score.' },
  { mode: 'trial', action: 'mode-trial', icon: '⏱️', name: 'TIME TRIAL', desc: 'Beat the clock. Every second counts.' },
  { mode: 'rush', action: 'mode-rush', icon: '🪙', name: 'COIN RUSH', desc: 'Grab coins, dodge traffic.' },
];

export class Screens {
  private root: HTMLElement;
  private cb: ScreenCallbacks;
  private current: HTMLElement | null = null;
  private currentId: string | null = null;
  private intervals: number[] = [];
  private timeouts: number[] = [];
  private rafs: number[] = [];

  constructor(root: HTMLElement, cb: ScreenCallbacks) {
    this.root = root;
    this.cb = cb;
    window.addEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.currentId !== null && this.currentId !== 'menu') {
      e.preventDefault();
      this.cb.onCloseOverlay();
    }
  };

  /** Id of the currently mounted screen ('menu', 'camdiag', …), or null. */
  get currentScreenId(): string | null {
    return this.currentId;
  }

  /** Stop any live loops/timers owned by the current screen. */
  private clearDynamic(): void {
    for (const id of this.intervals) window.clearInterval(id);
    for (const id of this.timeouts) window.clearTimeout(id);
    for (const id of this.rafs) cancelAnimationFrame(id);
    this.intervals = [];
    this.timeouts = [];
    this.rafs = [];
  }

  /** Remove current screen and mount a fresh container. */
  private mount(id: string, floating = false): HTMLElement {
    this.clearDynamic();
    if (this.current) this.current.remove();
    const el = document.createElement('div');
    el.className = floating ? 'screen floating' : 'screen';
    el.dataset.screen = id;
    this.root.appendChild(el);
    this.current = el;
    this.currentId = id;
    return el;
  }

  private btn(action: string, label: string, cls = 'holo-btn', html = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.dataset.action = action;
    if (html) b.innerHTML = label;
    else b.textContent = label;
    return b;
  }

  private backButton(label = '← Back'): HTMLButtonElement {
    const b = this.btn('close-overlay', label, 'holo-btn');
    b.addEventListener('click', () => this.cb.onCloseOverlay());
    return b;
  }

  // ---------------------------------------------------------------- menu

  showMenu(highScore: number): void {
    const el = this.mount('menu');
    el.innerHTML = `
      <h1 class="game-title">HOLO-RACER</h1>
      <p class="game-subtitle">hands are the controller</p>
      <div class="high-score">🏆 BEST&nbsp;&nbsp;${highScore}</div>
      <div class="mode-cards"></div>
      <div class="btn-row menu-links"></div>
      <p class="kbd-hint">Pinch thumb + index to click · <kbd>Esc</kbd> closes panels</p>
    `;
    const cards = el.querySelector('.mode-cards') as HTMLElement;
    for (const m of MODES) {
      const b = this.btn(
        m.action,
        `<span class="mode-icon">${m.icon}</span><span class="mode-name">${m.name}</span><span class="mode-desc">${m.desc}</span>`,
        'holo-btn mode-card',
        true,
      );
      b.addEventListener('click', () => this.cb.onStart(m.mode));
      cards.appendChild(b);
    }
    const links = el.querySelector('.menu-links') as HTMLElement;
    const camSetup = this.btn('open-camera-setup', '🎥 Camera & gestures', 'holo-btn primary');
    camSetup.addEventListener('click', () => this.cb.onOpenCameraSetup());
    const howto = this.btn('open-howto', '❓ How to play');
    howto.addEventListener('click', () => this.cb.onOpenHowTo());
    const cal = this.btn('open-calibration', '✋ Calibrate hands', 'holo-btn magenta');
    cal.addEventListener('click', () => this.cb.onOpenCalibration());
    const settings = this.btn('open-settings', '⚙ Settings');
    settings.addEventListener('click', () => this.cb.onOpenSettings());
    links.append(camSetup, howto, cal, settings);
  }

  // ---------------------------------------------------------------- pause

  showPause(): void {
    const el = this.mount('pause', true);
    const panel = document.createElement('div');
    panel.className = 'holo-panel';
    panel.innerHTML = `<h2 class="panel-title">⏸ Paused</h2>`;
    const col = document.createElement('div');
    col.className = 'btn-col';
    const resume = this.btn('pause-resume', '▶ Resume', 'holo-btn primary');
    resume.addEventListener('click', () => this.cb.onResume());
    const restart = this.btn('pause-restart', '↻ Restart');
    restart.addEventListener('click', () => this.cb.onRestart());
    const settings = this.btn('pause-settings', '⚙ Settings');
    settings.addEventListener('click', () => this.cb.onOpenSettings());
    const quit = this.btn('pause-quit', '✕ Quit to menu', 'holo-btn danger');
    quit.addEventListener('click', () => this.cb.onQuitToMenu());
    col.append(resume, restart, settings, quit);
    panel.appendChild(col);
    panel.insertAdjacentHTML(
      'beforeend',
      `<p class="hint">Open both palms to pause · pinch to click buttons</p>`,
    );
    el.appendChild(panel);
    resume.focus();
  }

  // ---------------------------------------------------------------- settings

  showSettings(cal: Calibration, onChange: (c: Calibration) => void): void {
    const el = this.mount('settings');
    const panel = document.createElement('div');
    panel.className = 'holo-panel';
    panel.innerHTML = `<h2 class="panel-title">⚙ Settings</h2>`;
    const draft: Calibration = { ...cal };
    const emit = (): void => onChange({ ...draft });

    const makeRow = (label: string): { row: HTMLElement; val: HTMLElement } => {
      const r = document.createElement('div');
      r.className = 'setting-row';
      const lab = document.createElement('label');
      lab.textContent = label;
      const v = document.createElement('span');
      v.className = 'value';
      r.append(lab, v);
      return { row: r, val: v };
    };

    // One-hand mode toggle
    {
      const { row, val } = makeRow('One-hand steering');
      const t = document.createElement('label');
      t.className = 'toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = draft.oneHandMode;
      input.setAttribute('aria-label', 'One-hand steering');
      const track = document.createElement('span');
      track.className = 'track';
      t.append(input, track);
      input.addEventListener('change', () => {
        draft.oneHandMode = input.checked;
        val.textContent = input.checked ? 'ON' : 'OFF';
        emit();
      });
      val.textContent = draft.oneHandMode ? 'ON' : 'OFF';
      row.appendChild(t);
      panel.appendChild(row);
    }

    // Camera preview (PiP) toggle
    {
      const { row, val } = makeRow('Camera preview in races');
      const t = document.createElement('label');
      t.className = 'toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = draft.showCamPreview;
      input.setAttribute('aria-label', 'Camera preview in races');
      const track = document.createElement('span');
      track.className = 'track';
      t.append(input, track);
      input.addEventListener('change', () => {
        draft.showCamPreview = input.checked;
        val.textContent = input.checked ? 'ON' : 'OFF';
        emit();
      });
      val.textContent = draft.showCamPreview ? 'ON' : 'OFF';
      row.appendChild(t);
      panel.appendChild(row);
    }

    // Sensitivity slider 0.5–2
    {
      const { row, val } = makeRow('Steering sensitivity');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0.5';
      input.max = '2';
      input.step = '0.05';
      input.value = String(draft.sensitivity);
      input.setAttribute('aria-label', 'Steering sensitivity');
      const show = (): void => { val.textContent = `${draft.sensitivity.toFixed(2)}×`; };
      input.addEventListener('input', () => {
        draft.sensitivity = Number(input.value);
        show();
        emit();
      });
      show();
      row.append(input, val);
      panel.appendChild(row);
    }

    // Camera segmented control
    {
      const { row, val } = makeRow('Camera');
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Camera view');
      const first = document.createElement('button');
      first.type = 'button';
      first.textContent = 'FIRST';
      const third = document.createElement('button');
      third.type = 'button';
      third.textContent = 'THIRD';
      const sync = (): void => {
        first.classList.toggle('on', draft.camera === 'first');
        third.classList.toggle('on', draft.camera === 'third');
        val.textContent = draft.camera === 'first' ? '1ST' : '3RD';
      };
      first.addEventListener('click', () => { draft.camera = 'first'; sync(); emit(); });
      third.addEventListener('click', () => { draft.camera = 'third'; sync(); emit(); });
      sync();
      seg.append(first, third);
      row.append(seg, val);
      panel.appendChild(row);
    }

    // Speed limit slider 0.4–1
    {
      const { row, val } = makeRow('Speed limit');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0.4';
      input.max = '1';
      input.step = '0.05';
      input.value = String(draft.speedLimit);
      input.setAttribute('aria-label', 'Speed limit');
      const show = (): void => { val.textContent = `${Math.round(draft.speedLimit * 100)}%`; };
      input.addEventListener('input', () => {
        draft.speedLimit = Number(input.value);
        show();
        emit();
      });
      show();
      row.append(input, val);
      panel.appendChild(row);
    }

    // Mute toggle
    {
      const { row, val } = makeRow('Mute audio');
      const t = document.createElement('label');
      t.className = 'toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = draft.muted;
      input.setAttribute('aria-label', 'Mute audio');
      const track = document.createElement('span');
      track.className = 'track';
      t.append(input, track);
      input.addEventListener('change', () => {
        draft.muted = input.checked;
        val.textContent = input.checked ? 'MUTED' : 'ON';
        emit();
      });
      val.textContent = draft.muted ? 'MUTED' : 'ON';
      row.appendChild(t);
      panel.appendChild(row);
    }

    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    btnRow.appendChild(this.backButton('← Back'));
    panel.appendChild(btnRow);
    el.appendChild(panel);
  }

  // ---------------------------------------------------------------- calibration

  showCalibration(sample: Sampler): void {
    const el = this.mount('calibration');
    const captured: Partial<Calibration> = {};
    this.renderCalStep1(el, sample, captured);
  }

  private calShell(el: HTMLElement, step: string, title: string): { panel: HTMLElement; live: HTMLElement } {
    el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'holo-panel';
    const stepEl = document.createElement('p');
    stepEl.className = 'cal-step';
    stepEl.textContent = step;
    const titleEl = document.createElement('h2');
    titleEl.className = 'panel-title';
    titleEl.textContent = title;
    const live = document.createElement('div');
    live.className = 'cal-live';
    live.setAttribute('aria-live', 'polite');
    panel.append(stepEl, titleEl, live);
    el.appendChild(panel);
    return { panel, live };
  }

  private fmtSample(s: CalSample): string {
    const grip = s.gripLocked ? '<span class="ok">LOCKED ✓</span>' : '<span class="warn">no grip</span>';
    const ang = s.angle == null ? '--' : `${((s.angle * 180) / Math.PI).toFixed(1)}°`;
    const scl = s.scale == null ? '--' : s.scale.toFixed(3);
    const pin = s.pinch == null ? '--' : s.pinch.toFixed(3);
    return `hands: ${s.hands}   grip: ${grip}\nangle: ${ang}   scale: ${scl}\npinch: ${pin}`;
  }

  private startLiveReadout(live: HTMLElement, sample: Sampler, extra?: (s: CalSample) => string): void {
    const tick = (): void => {
      const s = sample();
      const tail = extra ? extra(s) : '';
      live.innerHTML = this.fmtSample(s) + (tail ? `\n${tail}` : '');
    };
    tick();
    this.intervals.push(window.setInterval(tick, 120));
  }

  private renderCalStep1(el: HTMLElement, sample: Sampler, captured: Partial<Calibration>): void {
    this.clearDynamic();
    const { panel, live } = this.calShell(el, 'Step 1 of 2', '✋ Neutral grip');
    panel.insertAdjacentHTML(
      'beforeend',
      `<p class="hint">Hold your <b>two-fist steering grip</b> at a comfortable distance.<br>Keep it level, like holding a wheel. Hold still, then capture.</p>`,
    );
    this.startLiveReadout(live, sample);

    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    const capture = this.btn('cal-capture-neutral', '📸 Capture neutral', 'holo-btn primary');
    const cancel = this.btn('cal-back', '✕ Cancel', 'holo-btn danger');
    cancel.addEventListener('click', () => this.cb.onCloseOverlay());
    btnRow.append(capture, cancel);
    panel.appendChild(btnRow);

    capture.addEventListener('click', () => {
      capture.disabled = true;
      capture.textContent = 'Hold still… capturing';
      const angles: number[] = [];
      const scales: number[] = [];
      const t0 = performance.now();
      const collect = (): void => {
        const s = sample();
        if (s.angle != null) angles.push(s.angle);
        if (s.scale != null) scales.push(s.scale);
        if (performance.now() - t0 < 1200) {
          this.rafs.push(requestAnimationFrame(collect));
        } else {
          if (angles.length === 0 || scales.length === 0) {
            capture.disabled = false;
            capture.textContent = '📸 Capture neutral';
            live.innerHTML += `\n<span class="warn">No grip detected — hold the two-fist grip and retry.</span>`;
            return;
          }
          // Circular mean for the angle, plain mean for scale.
          const sx = angles.reduce((a, x) => a + Math.sin(x), 0) / angles.length;
          const cx = angles.reduce((a, x) => a + Math.cos(x), 0) / angles.length;
          captured.neutralAngle = Math.atan2(sx, cx);
          captured.neutralScale = scales.reduce((a, x) => a + x, 0) / scales.length;
          this.renderCalStep2(el, sample, captured);
        }
      };
      this.rafs.push(requestAnimationFrame(collect));
    });
  }

  private renderCalStep2(el: HTMLElement, sample: Sampler, captured: Partial<Calibration>): void {
    this.clearDynamic();
    const { panel, live } = this.calShell(el, 'Step 2 of 2', '🤏 Pinch calibration');
    panel.insertAdjacentHTML(
      'beforeend',
      `<p class="hint">Pinch <b>thumb + index finger</b> together and release, <b>3 times</b>.<br>Watch the counter, then capture.</p>
       <div class="pin-count" aria-live="polite">pinches: <span id="pinch-count">0</span>/3</div>`,
    );

    let pinchCount = 0;
    let wasDown = false;
    const mid = 0.56; // between typical down (~0.45) and up (~0.68)
    this.startLiveReadout(live, sample, (s) => {
      if (s.pinch != null) {
        const down = s.pinch < mid;
        if (down && !wasDown) {
          pinchCount += 1;
          const n = panel.querySelector('#pinch-count');
          if (n) n.textContent = String(Math.min(pinchCount, 99));
        }
        wasDown = down;
      }
      return pinchCount >= 3
        ? '<span class="ok">Nice — 3 pinches seen. Hit capture.</span>'
        : '';
    });

    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    const capture = this.btn('cal-capture-pinch', '📸 Capture pinch', 'holo-btn primary');
    const back = this.btn('cal-back', '← Redo step 1');
    back.addEventListener('click', () => this.renderCalStep1(el, sample, captured));
    btnRow.append(capture, back);
    panel.appendChild(btnRow);

    capture.addEventListener('click', () => {
      capture.disabled = true;
      capture.textContent = 'Pinch 3 times…';
      const values: number[] = [];
      const t0 = performance.now();
      const collect = (): void => {
        const s = sample();
        if (s.pinch != null) values.push(s.pinch);
        if (performance.now() - t0 < 2200) {
          this.rafs.push(requestAnimationFrame(collect));
        } else if (values.length < 10) {
          capture.disabled = false;
          capture.textContent = '📸 Capture pinch';
          live.innerHTML += `\n<span class="warn">No hand data — make sure a hand is visible and retry.</span>`;
        } else {
          const sorted = [...values].sort((a, b) => a - b);
          const pct = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
          captured.pinchDown = pct(0.15);
          captured.pinchUp = pct(0.85);
          // Sanity: keep a minimum gap so the thresholds never invert.
          if (captured.pinchUp - captured.pinchDown < 0.08) {
            captured.pinchUp = captured.pinchDown + 0.08;
          }
          this.renderCalStep3(el, captured);
        }
      };
      this.rafs.push(requestAnimationFrame(collect));
    });
  }

  private renderCalStep3(el: HTMLElement, captured: Partial<Calibration>): void {
    this.clearDynamic();
    el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'holo-panel';
    const deg = captured.neutralAngle == null ? '--' : `${((captured.neutralAngle * 180) / Math.PI).toFixed(1)}°`;
    panel.innerHTML = `
      <p class="cal-step">Done</p>
      <h2 class="panel-title">✅ Calibration saved</h2>
      <div class="cal-live">neutral angle: ${deg}
neutral scale: ${(captured.neutralScale ?? 0).toFixed(3)}
pinch down: ${(captured.pinchDown ?? 0).toFixed(3)}   up: ${(captured.pinchUp ?? 0).toFixed(3)}</div>
      <p class="hint">You can re-run this any time from the menu.</p>
    `;
    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    const done = this.btn('cal-done', '🏁 Done', 'holo-btn primary');
    done.addEventListener('click', () => this.cb.onCalibrationDone({ ...captured }));
    const redo = this.btn('cal-back', '↻ Start over');
    redo.addEventListener('click', () => this.cb.onOpenCalibration());
    btnRow.append(done, redo);
    panel.appendChild(btnRow);
    el.appendChild(panel);
    done.focus();
  }

  // ---------------------------------------------------------------- how to play

  showHowTo(): void {
    const el = this.mount('howto');
    const panel = document.createElement('div');
    panel.className = 'holo-panel';
    panel.innerHTML = `
      <h2 class="panel-title">❓ How to play</h2>
      <ul class="howto-list">
        <li><span class="emoji">✊✊</span><span><b>Grip to steer.</b> Hold two fists together like a steering wheel. Tilt the grip left/right to steer.</span></li>
        <li><span class="emoji">👐</span><span><b>Push / pull for pedals.</b> Move the grip <b>away</b> from the camera to accelerate, <b>toward</b> you to brake.</span></li>
        <li><span class="emoji">🤏</span><span><b>Pinch = click.</b> Touch thumb + index together to press the glowing button under the cursor.</span></li>
        <li><span class="emoji">🖐️🖐️</span><span><b>Palms open = pause.</b> Hold both palms open toward the camera to pause.</span></li>
        <li><span class="emoji">🦾</span><span><b>One-hand mode</b> (in Settings) steers with a single fist if you prefer.</span></li>
      </ul>
      <p class="kbd-hint">Tip: good lighting and a plain background help tracking. <kbd>Esc</kbd> closes panels.</p>
    `;
    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    btnRow.appendChild(this.backButton('← Back'));
    panel.appendChild(btnRow);
    el.appendChild(panel);
  }

  // ---------------------------------------------------------------- fatal

  /** Full-screen, non-dismissable error (e.g. WebGL unavailable). */
  showFatal(title: string, message: string): void {
    const el = this.mount('fatal');
    const panel = document.createElement('div');
    panel.className = 'holo-panel';
    panel.innerHTML = `
      <h2 class="panel-title">⚠️ ${title}</h2>
      <p class="fatal-msg">${message}</p>
      <p class="kbd-hint">Try a browser with hardware acceleration enabled (Chrome / Edge / Safari).</p>
    `;
    el.appendChild(panel);
  }

  // --------------------------------------------------- camera diagnostics

  /** Full-screen camera failure report with concrete fix hints. */
  showCameraDiagnostics(d: CameraDiagnostics, hint: string, cb: CameraDiagCallbacks): void {
    const el = this.mount('camdiag');
    const panel = document.createElement('div');
    panel.className = 'holo-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = '📷 Camera couldn\u2019t start';
    panel.appendChild(title);

    const table = document.createElement('dl');
    table.className = 'diag-table';
    const rows: Array<[string, string]> = [
      ['Error', d.errorName + (d.errorMessage ? ' — ' + d.errorMessage : '')],
      ['Secure context', d.secureContext ? 'yes' : 'NO'],
      ['Protocol', d.protocol],
      ['Camera API', d.mediaDevices ? 'available' : 'NOT AVAILABLE'],
      ['Cameras seen', d.videoInputs === null ? 'unknown' : String(d.videoInputs)],
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      table.append(dt, dd);
    }
    panel.appendChild(table);

    const hintEl = document.createElement('p');
    hintEl.className = 'diag-hint';
    hintEl.textContent = hint;
    panel.appendChild(hintEl);

    const row = document.createElement('div');
    row.className = 'btn-row';
    const mk = (label: string, action: string, fn: () => void, primary = false): void => {
      const b = document.createElement('button');
      b.className = primary ? 'holo-btn primary' : 'holo-btn';
      b.dataset.action = action;
      b.textContent = label;
      b.addEventListener('click', fn);
      row.appendChild(b);
    };
    mk('↻ Retry camera', 'cam-retry', cb.onRetry, true);
    mk('⧉ Copy diagnostics', 'cam-copy', cb.onCopy);
    mk('⌨ Play with keyboard', 'cam-keyboard', cb.onKeyboard);
    panel.appendChild(row);

    el.appendChild(panel);
  }

  // ------------------------------------------------------ camera setup

  /**
   * The gesture environment: live camera preview with skeleton overlay,
   * live tracking status, environment checklist (lighting / distance /
   * framing) and one-click calibration. main.ts keeps the readouts fresh
   * while this screen is mounted (ids below are the live-update contract).
   *
   * Live ids: setup-preview (video), setup-skeleton (canvas),
   *   setup-perm, setup-hands, setup-light, setup-dist, setup-frame.
   */
  showCameraSetup(cb: CameraSetupCallbacks): void {
    const el = this.mount('setup');
    const panel = document.createElement('div');
    panel.className = 'holo-panel setup-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = '🎥 Camera & gesture setup';
    panel.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'setup-grid';

    // Preview column: camera feed + skeleton overlay.
    const prevWrap = document.createElement('div');
    prevWrap.className = 'setup-preview-wrap';
    const stage = document.createElement('div');
    stage.className = 'setup-stage';
    const video = document.createElement('video');
    video.id = 'setup-preview';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    const skeleton = document.createElement('canvas');
    skeleton.id = 'setup-skeleton';
    stage.append(video, skeleton);
    prevWrap.appendChild(stage);
    const cap = document.createElement('p');
    cap.className = 'setup-caption';
    cap.textContent = 'This is what the tracker sees — keep both fists in frame';
    prevWrap.appendChild(cap);
    grid.appendChild(prevWrap);

    // Status column.
    const side = document.createElement('div');
    side.className = 'setup-side';

    const mkLine = (id: string, text: string): HTMLElement => {
      const p = document.createElement('p');
      p.id = id;
      p.className = 'setup-line';
      p.textContent = text;
      side.appendChild(p);
      return p;
    };
    mkLine('setup-perm', 'Camera permission: …');
    mkLine('setup-hands', 'Hands: —');

    const checks = document.createElement('div');
    checks.className = 'setup-checks';
    const mkCheck = (id: string, label: string): void => {
      const row = document.createElement('div');
      row.className = 'check';
      row.id = id;
      const dot = document.createElement('span');
      dot.className = 'dot';
      const lab = document.createElement('span');
      lab.textContent = label;
      row.append(dot, lab);
      checks.appendChild(row);
    };
    mkCheck('setup-light', 'Lighting');
    mkCheck('setup-dist', 'Hand distance');
    mkCheck('setup-frame', 'Hands in frame');
    side.appendChild(checks);

    const tips = document.createElement('ul');
    tips.className = 'setup-tips';
    for (const tip of [
      'Face a lamp or window — light on your hands, not behind you.',
      'Hold both fists at arm\u2019s length, about shoulder width apart.',
      'Plain background helps; avoid busy patterns behind your hands.',
      'Pinch thumb + index to click buttons — try it on the buttons below.',
    ]) {
      const li = document.createElement('li');
      li.textContent = tip;
      tips.appendChild(li);
    }
    side.appendChild(tips);
    grid.appendChild(side);
    panel.appendChild(grid);

    const row = document.createElement('div');
    row.className = 'btn-row';
    const race = this.btn('setup-race', '🏁 Start racing', 'holo-btn primary');
    race.addEventListener('click', cb.onRace);
    const calib = this.btn('setup-calibrate', '🎯 Calibrate gestures');
    calib.addEventListener('click', cb.onCalibrate);
    const back = this.btn('setup-back', '← Back');
    back.addEventListener('click', cb.onBack);
    row.append(race, calib, back);
    panel.appendChild(row);

    el.appendChild(panel);
  }

  // ----------------------------------------------------------------

  /**
   * Shown at boot when the page is not a secure context (preview/sandbox):
   * the camera API can never exist here. Tells the user exactly how to
   * run the file properly instead of failing mysteriously later.
   */
  showInsecureWarning(onPlayAnyway: () => void): void {
    const el = this.mount('insecure');
    const panel = document.createElement('div');
    panel.className = 'holo-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = '⚠️ Preview mode — camera unavailable';
    panel.appendChild(title);

    const msg = document.createElement('p');
    msg.className = 'fatal-msg';
    msg.textContent =
      'This file is open inside a preview or sandbox, not directly in your browser. ' +
      'Web pages can only use the camera from a secure context, so hand tracking is disabled here.';
    panel.appendChild(msg);

    const steps = document.createElement('ol');
    steps.className = 'setup-tips';
    for (const s of [
      'Download holo-racer-game.html from the chat (do not just preview it).',
      'Double-click the downloaded file — it opens directly in your browser.',
      'Click "🎥 Camera & gestures", then Allow when the browser asks for the camera.',
    ]) {
      const li = document.createElement('li');
      li.textContent = s;
      steps.appendChild(li);
    }
    panel.appendChild(steps);

    const row = document.createElement('div');
    row.className = 'btn-row';
    const b = document.createElement('button');
    b.className = 'holo-btn primary';
    b.dataset.action = 'insecure-play';
    b.textContent = '⌨ Play with keyboard anyway';
    b.addEventListener('click', onPlayAnyway);
    row.appendChild(b);
    panel.appendChild(row);

    el.appendChild(panel);
  }

  /** Remove any visible screen and stop its live loops. */
  hideAll(): void {
    this.clearDynamic();
    if (this.current) this.current.remove();
    this.current = null;
    this.currentId = null;
  }
}

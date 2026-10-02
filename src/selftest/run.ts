/**
 * HOLO-RACER in-game self-test.
 *
 * Open the game with `?selftest=1` and it runs a battery of automated
 * checks against the REAL running app (renderer, gesture engine, audio,
 * storage, UI) and renders a pass/fail report. Lazy-loaded so it never
 * costs bytes in the normal play bundle.
 *
 * This is the "browser automation for testing the game itself": no
 * external harness needed — the game tests itself, including the
 * gesture pipeline with synthetic hand landmarks.
 */
import { GESTURES } from '../config.ts';
import {
  detectGrip,
  detectSingleFist,
  isFist,
  isPalmOpen,
  pinchDistance,
  scaleToPedals,
} from '../gestures/engine.ts';
import { LM, type Landmark, type TrackedHand } from '../types.ts';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------
// Synthetic hands (hand-local units: wrist->middle_mcp = 1).
// ---------------------------------------------------------------------------

function lm(x: number, y: number): Landmark {
  return { x, y, z: 0 };
}

/** Build a 21-landmark hand. `curl` 0 = open palm, 1 = tight fist. */
function synthHand(cx: number, curl: number, pinch = false): TrackedHand {
  const pts: Landmark[] = new Array(21);
  for (let i = 0; i < 21; i++) pts[i] = lm(cx, 0);
  pts[LM.WRIST] = lm(cx, 0);
  pts[LM.MIDDLE_MCP] = lm(cx, -1); // scale = 1
  const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
  for (const t of tips) {
    // fist: tips near wrist (0.5u); palm: far (1.8u)
    const d = 0.5 + (1 - curl) * 1.3;
    pts[t] = lm(cx, -d);
  }
  pts[LM.THUMB_TIP] = pinch ? lm(cx + 0.12, -1.6) : lm(cx, curl > 0.5 ? -0.5 : -1.45);
  if (pinch) pts[LM.INDEX_TIP] = lm(cx, -1.6); // thumb+index touching
  pts[LM.INDEX_MCP] = lm(cx - 0.35, -0.9);
  pts[LM.PINKY_MCP] = lm(cx + 0.35, -0.9);
  return { landmarks: pts, handedness: 'Unknown', score: 0.95, gesture: '', gestureScore: 0 };
}

// ---------------------------------------------------------------------------
// Checks.
// ---------------------------------------------------------------------------

function checkWebGL(): Check {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    return gl
      ? { name: 'WebGL context', pass: true, detail: 'webgl2 available' }
      : { name: 'WebGL context', pass: false, detail: 'no webgl2/webgl context' };
  } catch (e) {
    return { name: 'WebGL context', pass: false, detail: String(e).slice(0, 120) };
  }
}

function checkAudio(): Check {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return { name: 'WebAudio', pass: false, detail: 'AudioContext missing' };
    const ac = new AC();
    const ok = ac.sampleRate > 0;
    void ac.close().catch(() => undefined);
    return { name: 'WebAudio', pass: ok, detail: `sampleRate ${ac.sampleRate}` };
  } catch (e) {
    return { name: 'WebAudio', pass: false, detail: String(e).slice(0, 120) };
  }
}

function checkStorage(): Check {
  try {
    localStorage.setItem('__hrt', '1');
    const ok = localStorage.getItem('__hrt') === '1';
    localStorage.removeItem('__hrt');
    return { name: 'localStorage', pass: ok, detail: ok ? 'read/write ok' : 'write did not persist' };
  } catch (e) {
    return { name: 'localStorage', pass: false, detail: String(e).slice(0, 120) };
  }
}

function checkGestures(): Check[] {
  const out: Check[] = [];
  const fist = synthHand(0, 1);
  const palm = synthHand(0, 0);
  const pinch = synthHand(0, 0, true);

  out.push({
    name: 'Gesture: fist detected',
    pass: isFist(fist) && !isFist(palm),
    detail: `isFist(fist)=${isFist(fist)} isFist(palm)=${isFist(palm)}`,
  });
  out.push({
    name: 'Gesture: open palm detected',
    pass: isPalmOpen(palm) && !isPalmOpen(fist),
    detail: `isPalmOpen(palm)=${isPalmOpen(palm)}`,
  });
  const pd = pinchDistance(pinch);
  const pdOpen = pinchDistance(palm);
  out.push({
    name: 'Gesture: pinch distance',
    pass: pd < pdOpen && pd < 0.35,
    detail: `pinch=${pd.toFixed(2)} open=${pdOpen.toFixed(2)}`,
  });
  const grip = detectGrip([synthHand(-0.4, 1), synthHand(0.4, 1)]);
  out.push({
    name: 'Gesture: two-fist grip locks',
    pass: grip.locked,
    detail: `locked=${grip.locked} angle=${grip.angle.toFixed(2)}`,
  });
  const single = detectSingleFist([synthHand(0, 1)]);
  out.push({
    name: 'Gesture: single-fist fallback',
    pass: single.locked,
    detail: `locked=${single.locked}`,
  });
  const pedals = scaleToPedals(0.6, 1);
  const brake = scaleToPedals(1.8, 1);
  out.push({
    name: 'Gesture: push/pull pedals',
    pass: pedals.throttle > 0.5 && brake.brake > 0.5,
    detail: `throttle=${pedals.throttle.toFixed(2)} brake=${brake.brake.toFixed(2)}`,
  });
  return out;
}

function checkMenu(): Check {
  const menu = document.querySelector('[data-screen="menu"]');
  const btns = [...document.querySelectorAll('#ui-root [data-screen="menu"] button')].length;
  return {
    name: 'Menu renders',
    pass: !!menu && btns >= 3,
    detail: menu ? `${btns} buttons` : 'menu screen missing',
  };
}

function checkThresholds(): Check {
  const sane =
    GESTURES.CURL_RATIO > 0 &&
    GESTURES.EXTEND_RATIO > GESTURES.CURL_RATIO &&
    GESTURES.GRIP_RATIO > 0;
  return { name: 'Gesture thresholds sane', pass: sane, detail: `curl=${GESTURES.CURL_RATIO} extend=${GESTURES.EXTEND_RATIO}` };
}

// ---------------------------------------------------------------------------
// Report UI.
// ---------------------------------------------------------------------------

function renderReport(checks: Check[]): void {
  const passed = checks.filter((c) => c.pass).length;
  const host = document.createElement('div');
  host.id = 'selftest-report';
  host.innerHTML = `
    <div class="st-panel">
      <h2>🔬 SELF-TEST ${passed}/${checks.length} passed</h2>
      <ul>${checks
        .map(
          (c) =>
            `<li class="${c.pass ? 'ok' : 'bad'}"><span>${c.pass ? '✅' : '❌'}</span><b>${c.name}</b><small>${c.detail}</small></li>`,
        )
        .join('')}</ul>
      <p class="st-hint">Close this tab when done — self-test never runs in normal play.</p>
    </div>`;
  const style = document.createElement('style');
  style.textContent = `
    #selftest-report { position: fixed; inset: 0; z-index: 9999; display: flex;
      align-items: center; justify-content: center; background: rgba(2,6,16,.88);
      font-family: system-ui, sans-serif; }
    #selftest-report .st-panel { max-width: 560px; width: 92%; max-height: 86vh; overflow: auto;
      background: #06121f; border: 1px solid #00e5ff; border-radius: 14px; padding: 1.4rem 1.6rem;
      color: #dff6ff; box-shadow: 0 0 40px rgba(0,229,255,.25); }
    #selftest-report h2 { margin: 0 0 1rem; color: #00e5ff; font-size: 1.25rem; }
    #selftest-report ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .45rem; }
    #selftest-report li { display: grid; grid-template-columns: 1.6rem 1fr; gap: .1rem .6rem;
      background: rgba(0,229,255,.06); border-radius: 8px; padding: .5rem .7rem; align-items: center; }
    #selftest-report li.bad { background: rgba(255,70,90,.1); }
    #selftest-report li small { grid-column: 2; color: #8fb8cc; font-size: .78rem; }
    #selftest-report .st-hint { color: #8fb8cc; font-size: .8rem; margin: 1rem 0 0; }`;
  document.head.appendChild(style);
  document.body.appendChild(host);
  console.info(`[selftest] ${passed}/${checks.length} passed`, checks);
}

/** Entry point, called from main.ts when `?selftest=1` is present. */
export function runSelfTest(): void {
  // Let the app finish booting (menu render) before checking.
  const run = () => {
    const checks: Check[] = [
      checkWebGL(),
      checkAudio(),
      checkStorage(),
      checkThresholds(),
      checkMenu(),
      ...checkGestures(),
    ];
    renderReport(checks);
  };
  if (document.querySelector('[data-screen="menu"]')) run();
  else {
    const iv = window.setInterval(() => {
      if (document.querySelector('[data-screen="menu"]') || document.querySelector('[data-screen="fatal"]')) {
        window.clearInterval(iv);
        run();
      }
    }, 500);
    window.setTimeout(() => window.clearInterval(iv), 30_000);
  }
}

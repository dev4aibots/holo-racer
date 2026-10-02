# HOLO-RACER 🏎️🖐️

A webcam-controlled holographic racing game. **Your hands are the controller** — no headset, no gamepad, just a browser and a webcam.

## How to play

| Gesture | Action |
|---|---|
| 🤜🤛 Two-fist grip (one fist grabbing the other's thumb, held horizontal) | Steering wheel — rotate to steer |
| Pull hands **away** from camera | Throttle (farther = faster) |
| Push hands **toward** camera | Slow down / brake (very close = full brake) |
| 🤏 Pinch (thumb + index, either hand) | Click / select UI buttons |
| 🖐️🖐️ Both palms open, held ~0.5s | Pause menu |

1. Open the game, pick a mode (Cruise / Time Trial / Coin Rush).
2. Allow camera access.
3. **Calibrate** (first run): hold your grip level at a comfortable distance → Capture neutral; pinch 3× → Capture pinch.
4. Countdown… GO!

Keyboard fallback (WASD/arrows, P = pause) if no camera is available.

## Modes

- **Cruise** — endless highway, score = distance + coins.
- **Time Trial** — 60 seconds, score = distance.
- **Coin Rush** — 90 seconds, score = coins.

Crashing into traffic only slows you down — there is no game over.

## Run it

```bash
npm install
npm run dev      # dev server
npm run build    # production build → dist/
npm run preview  # serve the production build
npm test         # gesture-engine unit tests (synthetic landmarks, no webcam)
```

## Deploy to Vercel

```bash
npm run build
# then either:
vercel --prod            # via Vercel CLI, or
# push to GitHub and import the repo in the Vercel dashboard (framework: Vite)
```

The build is fully static (`dist/`). No server needed for single-player.

## Architecture

```
camera → TrackingClient (main thread)
            │  640×480 capture, decoupled from render
            ▼
   tracking Worker ── MediaPipe HandLandmarker (WASM, GPU→CPU fallback)
            │  plain landmark arrays
            ▼
   LandmarkSmoother (One Euro filter per coordinate)
            ▼
   GestureEngine ── grip/steer/throttle/brake/pinch/palms → ControlState
            ▼
   Game (three.js) · AudioEngine (WebAudio synth) · HUD/Screens (DOM)
```

- **Tracking** never blocks rendering: inference runs in a Web Worker on a
  640×480 stream; if inference slows, capture auto-throttles (30→20fps) and
  the game keeps running on the last known state.
- **Pinch reliability**: thumb-index distance normalized by hand size,
  hysteresis band + 120ms debounce, instant release when hands are lost.
- **Multiplayer-ready**: `src/net/adapter.ts` defines `INetAdapter`
  (`LocalAdapter` no-op + `WebSocketAdapter` with validated, quantized
  10Hz state deltas ≈ 600 B/s per peer). Pair with any trivial JSON
  broadcast relay (see protocol sketch in the file).

## Versions pinned

| Package | Version | Why |
|---|---|---|
| `three` | 0.186.1 | latest stable at build time |
| `@mediapipe/tasks-vision` | 0.10.33 | battle-tested HandLandmarker API |
| `vite` | 7.3.x | stable major |
| `typescript` | 5.9.3 | stable (7.x is the risky native rewrite) |

MediaPipe WASM + model load from pinned CDNs at runtime (keeps the bundle
small); the game itself works offline once cached.

## Performance notes

- Render pixel ratio capped at 1.5; shared geometries/materials; instanced
  coins; fog-culled scenery; no postprocessing.
- Total first-load JS ≈ three.js (~600KB) + app code; MediaPipe (~few MB
  WASM+model) lazy-loads only when tracking starts.

## Security

- Strict CSP meta (no inline scripts, no `eval`); MediaPipe/CDN allowlisted.
- Multiplayer messages schema-validated, size-capped (4KB), rate-limited;
  remote IDs never injected into DOM.
- No secrets in the client bundle.

## Automated testing

Three layers, cheapest first:

```bash
npm test          # unit tests: gesture engine vs synthetic landmarks (13 tests)
npm run test:e2e  # Playwright: boots the real game, drives with the keyboard,
                  # checks pause/settings, fails on ANY console error
npx playwright install chromium   # one-time browser download for e2e
```

E2E details (`tests/e2e/`):
- `boot.spec.ts` — title, menu buttons, canvases, no fatal screen
- `race.spec.ts` — countdown finishes, car accelerates, score accrues, steering
- `pause.spec.ts` — `P` pauses, all buttons present, resume continues the race
- `settings.spec.ts` — settings + how-to panels open/close
- Every spec auto-fails on console errors or uncaught exceptions (see
  `specs/fixtures.ts`), and SwiftShader flags let it run without a GPU.

In-game self-test — open the game with `?selftest=1`:
runs 11 checks against the live app (WebGL, WebAudio, storage, gesture
pipeline with synthetic hands, menu render) and shows a pass/fail report.
Lazy-loaded, so it costs zero bytes in normal play.

## Known limits

- Hand tracking needs decent lighting and a visible upper body/face-free
  background; very low light degrades gracefully (status dot in HUD).
- 90fps tracking is only reachable on strong hardware/GPU delegate;
  the client auto-degrades capture fps to protect latency.
- True multiplayer needs a relay server (protocol documented in
  `src/net/adapter.ts`); single-player is complete standalone.

## Next steps

1. Playtest the pinch thresholds on real hardware; tune `GESTURES` in
   `src/config.ts`.
2. Deploy the WS relay (15-line sketch in `src/net/adapter.ts`) and render
   remote ghost cars.
3. Add ghost/replay for Time Trial from localStorage runs.

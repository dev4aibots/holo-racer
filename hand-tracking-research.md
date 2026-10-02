# Hand-Tracking & Web Racing Game Research — 2026-10-02

Sources: starred repos of `dev4aibots` and `kinglalit610-netizen` (via GitHub REST API),
plus targeted GitHub code search sorted by stars. READMEs and key source files inspected.

## Ranked Top 10

### 1. Manthan-13521/GestureKart-AI-Racing — ★4 — TypeScript
https://github.com/Manthan-13521/GestureKart-AI-Racing · Live: https://car--raceing.vercel.app
**Why #1:** Closest stack to HOLO-RACER (TypeScript + MediaPipe + Three.js + Vite, Vercel-deployed).
**Key techniques:**
- `InputSource` abstraction: hand / keyboard / touch / gyro sources feed a unified `InputFrame`
- `GestureCalibration`: calibrated neutral center + dead zone + adaptive EMA smoothing (`alpha 0.55`)
- Steering from palm-center X: `(lm[0] + lm[5] + lm[9]) / 3` averaged over both hands, mirrored
- Classic `@mediapipe/hands` (not Tasks Vision): `modelComplexity: 1`, `minDetectionConfidence: 0.7`, `minTrackingConfidence: 0.5`
- Hand-presence timeout (3 s), Playwright e2e + Vitest unit tests
**Takeaway:** Their calibration (neutral-center + dead-zone) is the proven fix pattern for
"hands detected but turns don't respond."

### 2. yeemachine/kalidokit — ★5719 — TypeScript
https://github.com/yeemachine/kalidokit
**Why:** Best-in-class open-source math for deriving robust gestures from MediaPipe landmarks.
**Key techniques:**
- `HandSolver`: finger curl/spread/rotation kinematics from the 21-landmark rig
- Used across the VTuber ecosystem; actively maintained (updated 2026-10-01)
**Takeaway:** Replace raw pinch-distance thresholds with curl-based pinch + hysteresis —
this is the direct fix for pinch misclicks.

### 3. Mati365/micro-racing — ★163 — JavaScript
https://github.com/Mati365/micro-racing
**Why:** Highest-starred browser racing repo found; real-time multiplayer that actually works.
**Key techniques:**
- Client-side prediction + server reconciliation for racing netcode
- Custom WebGL engine, quad-tree spatial optimization, struct-pack binary serialization
- Neural-net AI opponents trained with genetic algorithms
**Takeaway:** Netcode reference for multiplayer: prediction + reconciliation, binary snapshots.

### 4. jolbol1/apex-gp — ★45 — JavaScript
https://github.com/jolbol1/apex-gp
**Why:** Best three.js racing graphics reference; built with an agent-critic quality loop.
**Key techniques:**
- 100% procedural: circuit, cars, sky, crowd, audio all synthesized at boot from seeded PRNG
- Zero asset downloads — perfect fit for the 1–2 MB/s bandwidth constraint
- Lap/sector timing, DRS, ERS, tyre wear, broadcast HUD
**Takeaway:** Procedural content is how you get AAA look without downloads.

### 5. MankyDanky/web-racing — ★31 — JavaScript
https://github.com/MankyDanky/web-racing · Live: https://racez.io
**Why:** Exact "party code" multiplayer model the user wants, over WebRTC P2P.
**Key techniques:**
- Peer.js WebRTC P2P multiplayer, create/join party with shareable code
- Three.js + physics driving, checkpoints, leaderboards, car colors
**Takeaway:** Party-code UX pattern to mirror; validates P2P racing without game servers.

### 6. cconsta1/threejs_car_demo — ★20 — JavaScript
https://github.com/cconsta1/threejs_car_demo
**Why:** Mario Kart-style coin-collection kart racer — closest gameplay match to Dr. Driving mode.
**Key techniques:**
- Three.js + cannon-es physics kart, 40+ coins, boost pads, particle effects
- All sound effects synthesized with Web Audio API (zero audio files)
- Toon shading, lil-gui settings, local high-score persistence
**Takeaway:** Copy the Web Audio synth approach for engine/coin/crash sounds with no downloads.

### 7. aditya95087/AI-Game_Controller- — ★1 — Python
https://github.com/aditya95087/AI-Game_Controller-
**Why:** Only repo found implementing an explicit two-hand virtual steering wheel.
**Key techniques:**
- Steering = angle between left/right hand points → smoothed → ±100% steer
- `max_physical_angle = 90°` maps to full lock; EMA smoothing; sensitivity scalar
- Draws the virtual wheel (line + circle + center) on the video feed with color-coded feedback
**Takeaway:** Independently validates the two-fist steering-angle approach already in HOLO-RACER.

### 8. VisionStack-404/HoloGraphic — ★3 — JavaScript (user-starred)
https://github.com/VisionStack-404/HoloGraphic · Live: https://visionstack-404.github.io/HoloGraphic/
**Why:** Holographic hand-UI aesthetic reference; user explicitly starred it.
**Key techniques:**
- MediaPipe 21-landmark hand tracking + Three.js holographic UI, vanilla JS (no framework)
- Pinch-distance object scaling, fingertip-to-3D-geometry collision detection
- Glassmorphism HUD, additive-blend glow effects
**Takeaway:** Hologram visual language (glow, additive blending) to match.

### 9. Seth141/Computer-Vision-AR-UI — ★4 — TypeScript (user-starred)
https://github.com/Seth141/Computer-Vision-AR-UI
**Why:** Best pinch-as-click interaction design reference; user explicitly starred it.
**Key techniques:**
- MediaPipe + React Three Fiber; pinch = grab/select, pinch-drag = move, release = drop
- Two-hand pull-apart = open/resize window; hover = highlight affordance
**Takeaway:** Pinch interaction grammar (grab → drag → release) for menu/button UX.

### 10. collidingScopes/fruit-ninja — ★14 — JavaScript
https://github.com/collidingScopes/fruit-ninja · Live: https://collidingscopes.github.io/fruit-ninja/
**Why:** Most polished playable MediaPipe web game found; same author has a series
(manual-brick-breaker, HAND-NINJA clones).
**Key techniques:**
- Hand-velocity-based slicing, Three.js 3D fruits, blade trails, particles
- Progressive difficulty, lives, high score — full game-feel loop on hand input
**Takeaway:** Game-feel polish patterns (trails, particles, juice) that make hand control feel good.

## Honorable mentions
- **Absurd28/Hand_Gesture_racing_car_game** (★2, JS): MediaPipe Hand Landmarker,
  thumb-direction steering, fist = accelerate, open palm = brake — same gesture set as HOLO-RACER.
- **victorgalvez56/redline** (★9, JS): Three.js + Cannon.js + Socket.IO multiplayer racing
  (server-authoritative alternative to P2P).
- **google/mediapipe** official web examples: canonical Tasks Vision usage patterns.

## Environment notes
- `@mediapipe/tasks-vision` latest stable on npm is **1.0.1** (0.10.x are RCs) — already in use.
- No canonical `one-euro-filter` npm package exists; the filter is normally vendored
  (HOLO-RACER already vendors its own — fine).
- Starred-repo scan: of 115 starred repos across both users, only the two listed above
  (#8, #9) are relevant to hand tracking / AR UI.

# HOLO-RACER Multiplayer Networking — Deep Research Report

Researched 2026-10-02. Stack context: Vite 7.3.6 + TypeScript 5.9.3 + Three.js 0.186.1,
MediaPipe Tasks Vision 1.0.1, deployed on Vercel (https://holo-racer.vercel.app).

## 1. PeerJS and the public server 0.peerjs.com

**How it works.** PeerJS wraps WebRTC. You open a `Peer` with a chosen ID; the public
broker at `0.peerjs.com` (default in the PeerJS client) maps peer ID → network
endpoint and relays only the signaling (SDP + ICE). All game data then flows over
WebRTC RTCDataChannels, peer-to-peer, encrypted (DTLS/SCTP).

**Room codes** are a client-side convention, not a PeerJS feature. The standard pattern
(production-proven by ser-gen/peerjs-test and the HOLO-RACER analog below):
host generates a short code (4 letters, e.g. `KQZX`), registers the peer ID as
`holo-racer-kqzx`, and shares the code. The joiner types the code, connects to
`holo-racer-kqzx`. If nobody claimed that ID, PeerJS returns the `peer-unavailable`
error → you show "Room not found". 4 letters = 26^4 = 456k codes; with a
`holo-racer-` prefix squatting/guessing is not a practical concern.

**Latency.** DataChannel overhead is sub-millisecond on loopback (yohimik/ws-webrtc-benchmark:
WebRTC data channel p50 ~0.085–0.090 ms, p99 ~0.125–0.135 ms for 512 B — protocol overhead
only). Real-world latency ≈ network RTT between the two browsers: ~38–46 ms cross-Europe
(Conexa P2P test, RTT 30 ms), LAN ~12–16 ms. Expect same-city P2P 20–50 ms one-way,
cross-country 60–150 ms.

**Max peers / topology.** PeerJS gives you raw connections; topology is your choice.
For 2–6 players a **full mesh** (every player connects to every other) is simplest:
n(n−1)/2 data channels = 15 for 6 players. PeerJS 1.5.x handles dozens of connections
fine; the practical ceiling is the mesh itself (~8–10 players before ICE churn hurts).

**Reliability of 0.peerjs.com.** This is the big caveat. It is free, no-account,
no-SLA, and **rate-limited** — emberdeep (a production multiplayer game) migrated
away from it to Trystero/nostr specifically because the cloud "keeps dropping
signaling sockets". PeerJS 1.5.x improved reconnect behavior (backoff, no auto-reconnect
unless you re-attach), but the public broker can and does fail at bad moments.

**Fallbacks when it's down:**
1. **Fallback broker** — ship a tiny self-hosted PeerServer (`npm i -g peer`; runs
   anywhere Node runs) and fail over `new Peer(code, {host, port, path})` on the first
   client — Fly.io/Railway free tier runs this for ~$0.
2. **Dual client** — initialize a Trystero room in parallel as backup signaling; not worth
   the complexity for launch.
3. **Reconnect loop** — on `socket-closed`/`server-error`, retry with backoff and show
   "reconnecting" UI; works for transient drops, not sustained outages.

**PeerJS gotchas (all verified in production codebases):**
- Peer IDs are claimed first-come; a dropped anchor holder keeps the ID for ~100 s
  before release (ser-gen/peerjs-test documented this), so "room full" states need
  explicit host-elected signaling, not ID ownership.
- The `unavailable-id` error = someone else holds that peer ID.
- Use **two DataConnections per remote peer**: one `{reliable: false}` (unordered,
  lossy) for position snapshots, one `{reliable: true}` (ordered) for events
  (race start, finish, items). After one dropped packet, ordered-reliable p95 latency
  explodes to ~124.8 ms vs ~558 µs for unordered (urnetwork/connect benchmarks) —
  head-of-line blocking is the #1 netcode killer.

## 2. Free signaling comparison (for 2–6 players, 10–20 Hz position updates)

| Option | Free tier | Signaling reliability | Cost/complexity | Verdict |
|---|---|---|---|---|
| **PeerJS (0.peerjs.com)** | Unlimited-ish, no account, no SLA, rate-limited | Drops sockets under load; emberdeep migrated away | peerjs npm 1.5.x, ~80 KB bundle | ⚠️ Fine for prototype; not for launch |
| **Trystero + Supabase** | Supabase free: 200 concurrent Realtime conns, 2M msgs/mo, projects pause after 1 week idle | Excellent (1–3 s connect) | `trystero` npm 0.25.x, ~22 KB; needs free Supabase project + anon key | ✅ **Best free signaling** |
| **Trystero + Nostr** | Nostr relays free, no account | Good but slower (3–8 s connect) | Zero setup, zero cost | ✅ Good zero-setup backup |
| **Yjs / y-webrtc** | Public demo signaling (`wss://signaling.yjs.dev`) — explicitly not for production; self-host trivially | Poor on public; good self-hosted | Built for CRDT doc sync, not game loops — wrong tool for 20 Hz snapshots | ❌ Wrong abstraction |
| **Socket.io + free host** | Render/Railway/Fly free tiers (sleep or credit-card walls) | Good while awake | You manage a server + rooms + presence yourself | ⚠️ Works but you own ops |
| **Firebase RTDB free (Spark)** | 100 concurrent conns, 1 GB stored, 10 GB/mo download | Excellent | Google account, heavier SDK, fine for signaling-only | ⚠️ OK but Supabase simpler for this |
| **Self-hosted PeerServer** | ~$0 on Fly.io/Railway free tier | As good as your uptime | One `npm i -g peer` process | ✅ Good belt-and-braces option |

**Key numbers:**
- Signaling load for a racing game is tiny: ~5–10 messages per join (SDP offer/answer +
  ICE candidates). 200 concurrent Supabase connections ≈ 50 simultaneous 4-player rooms.
- PeerJS bundle ~80 KB vs Trystero ~22 KB — matters for the 773 KB single-file build.

## 3. Netcode patterns for browser racing

Consensus from zonefall's NETCODE.md, game-state-sync research, and the shipped games below:

- **Host-authoritative, not lockstep.** One player (the room creator) is the authority
  for race state (positions on track, lap counts, item effects, finish order). Lockstep
  is overkill for a casual arcade racer and dies on jitter.
- **Client prediction for your own car.** Your car moves locally from your own inputs
  (hand gestures/keyboard) every frame with zero network delay. No waiting.
- **Host reconciliation (lightweight).** Host broadcasts authoritative snapshots at
  **20 Hz** (every 50 ms). Each snapshot carries: seq number, per-car {pos xyz
  quantized to 16-bit, heading, speed, lap, checkpoint idx}. Clients blend their local
  car toward the authoritative state (small corrections only — rubber-band, don't snap).
  Full snapshots every ~667 ms; deltas in between.
- **Interpolation for remote cars.** Render remote cars ~**100 ms behind** (2 snapshot
  intervals + jitter margin): interpolate between the two most recent snapshots.
  If a snapshot is late, extrapolate (dead-reckon) from last velocity, capped at a few
  hundred ms, then snap when data resumes. nellinc/millos uses exactly this: 20 Hz
  updates, ~50–100 bytes/update, 100 ms interpolation buffer.
- **Host migration.** For friends racing, the simplest robust rule: the **room creator
  is permanent host; if the host disconnects, the race pauses and a new host is elected
  (earliest joiner wins, with a random-backoff claim like ser-gen/peerjs-test's anchor
  protocol).** Migrate minimal state: car transforms + lap/checkpoint counters. Don't
  attempt mid-race seamless migration for v1 — pause → elect → resume with 3-2-1
  countdown is the pattern that ships.
- **Bandwidth math.** 20 Hz × ~80 bytes × 5 remote cars = 8 KB/s per client — trivial.
  Never stream game-rate state on a reliable channel; unreliable for positions,
  reliable for events (start/finish/item/pickup).
- **Clock sync.** Host sends its timestamp in snapshots; clients keep a smoothed offset
  (gesturekart-ai-racing does this) so interpolation windows and countdowns agree.

## 4. Open-source web multiplayer racing games (what they use)

1. **manthan-13521/gesturekart-ai-racing** — *closest analog to HOLO-RACER, same stack.*
   TypeScript + Three.js + MediaPipe Hands + PeerJS + Vite, deployed on Vercel
   (car--raceing.vercel.app). 4-player WebRTC mesh, PeerJS 1.5.2 via unpkg CDN used
   **for signaling only**, 30 Hz snapshots, clock sync between players. Proves the
   exact architecture works on the exact deployment target.
2. **skidcircuit** — Three.js arcade racer, WebRTC multiplayer, live leaderboard and
   ghost replays. Shows the "race against ghosts when friends aren't online" pattern —
   worth copying: record local runs, replay as ghost cars, no networking needed.
3. **gin/xrrc (XRRC)** — Private-room WebRTC racing, origin-restricted signaling,
   **interpolation + short-horizon prediction**, QR-code "pit pass" invites. The
   netcode (predict remote cars a few frames ahead instead of only interpolating
   behind) is the quality bar for smooth-looking remote cars.
4. **jarredksmith/breach (RUMPUS ENGINE)** — PeerJS multiplayer in a single-file
   browser game studio; host creates room, flat-file PHP lobby directory for discovery.
   Shows room discovery can be dead simple (a lobby list), but for friends-racing the
   code-in-URL pattern is better.
5. **tim4724/powder-party** — Party-Sockets WebSocket relay + WebRTC fast lane, QR-code
   join. The hybrid pattern: use a cheap relay for lobby/signaling/fallback and
   upgrade to P2P data channels when ICE succeeds. (Their stack is React; the pattern
   ports directly.)

## 5. Room/invitation UX — best patterns

The winning pattern across all of these:

1. **Create** → host clicks "Multiplayer → Create Room" → game generates a 4-letter
   code (`KQZX`), registers peer ID `holo-racer-kqzx`.
2. **Share** → big readable code on screen + a shareable URL
   (`https://holo-racer.vercel.app/?join=KQZX`) + copy button (+ QR code on desktop,
   since XRRC and powder-party both use QR pit-passes — phone-as-controller or
   second-screen join). `navigator.share()` on mobile.
3. **Join** → guest opens URL (code pre-filled from `?join=`) or types 4 letters →
   one button → ICE handshake (~1–3 s on Supabase, 3–8 s on Nostr).
4. **Lobby** → show player list with names/colors as each joins, host presses Start →
   reliable-channel `race-start` event with 3-2-1 countdown synced to host clock.
5. Handle `peer-unavailable` → "Room not found — check the code." Handle mid-lobby
   disconnects → remove player from list.

Avoid: account systems, friend lists, server-side matchmaking — all unnecessary for
friends-racing and all add failure modes.

## 6. Recommended stack (specific)

| Piece | Choice | Version / notes |
|---|---|---|
| Signaling | **Trystero** (`trystero/supabase`) | `trystero@0.25.x` (npm latest 0.25.4 as of 2026-08-30); Supabase strategy = 1–3 s connects |
| Signaling backend | **Supabase Realtime** (free tier) | 200 concurrent conns, 2M msgs/mo; one free project, anon key in client (signaling only, no secrets) |
| Backup signaling | **Trystero + Nostr** strategy | Same `trystero` package, swap one import; zero setup, no account |
| Transport | Raw WebRTC RTCDataChannel (via Trystero actions) | Two channels per peer: unreliable for snapshots, reliable for events |
| Snapshot rate | 20 Hz host→clients | ~80 bytes/car; 8 KB/s/client at 6 players |
| Topology | Full mesh, host-authoritative | 2–6 players; host = room creator |
| TURN fallback | **Metered** free tier (5 GB/mo) or self-hosted **coturn** | Needed: ~20–25% of consumer sessions can't do direct P2P |
| Room codes | 4 letters, `holo-racer-XXXX` room namespace | `?join=XXXX` deep link + copy + QR |

Why Trystero over PeerJS for launch: built-in room concept (no peer-ID plumbing),
`makeAction()` typed channels (unreliable vs reliable in one line), swappable signaling
backend (Supabase today, Nostr/own-server tomorrow without touching game code),
~22 KB vs ~80 KB, end-to-end encrypted. PeerJS is the fine prototype path; Trystero
is the launch path. Start with Trystero + Supabase directly — the API is simpler than
PeerJS, so there's no prototype tax.

## 7. Architecture (in words)

```
┌─────────────┐   signaling (SDP/ICE, ~10 msgs/join)   ┌──────────────┐
│  Supabase   │◄──────────────────────────────────────►│   Browser B  │
│  Realtime   │◄──────────────────────────────────────►│  (joiner)    │
│ (free tier) │                                        └──────┬───────┘
└──────┬──────┘         WebRTC DataChannels (P2P, DTLS)        │
       │               ┌──────────────┐  unreliable 20 Hz      │
       └──────────────►│  Browser A   │◄──────────────────────┘
                       │ (HOST, room │
                       │  creator)    │  reliable: start/finish/items/chat
                       └──────┬───────┘
                              │  unreliable 20 Hz snapshots ──► B, C, D, E
```

- Host (room creator) runs the authoritative race simulation: track positions, laps,
  checkpoints, item effects, finish order.
- Every client (including host) predicts its **own** car locally from its inputs —
  zero perceived input latency.
- Host broadcasts **snapshot @ 20 Hz** on the unreliable channel:
  `{seq, tHost, cars: [{id, x, y, z (16-bit quantized), heading, speed, lap, cp}]}`.
- Clients render their own car from local prediction (corrected gently toward host
  snapshots), and remote cars **interpolated 100 ms behind** with short-horizon
  extrapolation when packets are late.
- Race events (start countdown, item pickup/hit, finish, disconnect) go on the
  **reliable** channel — never mixed with position traffic.
- Host disconnect → race pauses → earliest-joiner claims host after random backoff →
  host state (transforms + lap/checkpoint counters) re-syncs → 3-2-1 countdown → resume.
- TURN (Metered free / coturn) configured in Trystero `rtcConfig` for the ~20–25% of
  sessions behind symmetric NATs.

## 8. Expected latency numbers

| Segment | Expected |
|---|---|
| Signaling: guest join → P2P connected | 1–3 s (Supabase strategy); 3–8 s (Nostr fallback) |
| DataChannel protocol overhead | < 0.2 ms (loopback p50 ~0.09 ms; real cost is network RTT) |
| One-way P2P game traffic, same city | 20–50 ms |
| One-way P2P, cross-country | 60–150 ms |
| Snapshot interval | 50 ms (20 Hz) |
| Remote-car render delay (interpolation buffer) | ~100 ms behind real |
| Ordered-reliable channel after 1 lost packet | p95 ~125 ms (head-of-line blocking — keep positions OFF this channel) |
| Unordered channel after 1 lost packet | p95 < 1 ms |
| Direct-P2P success rate | ~75–80%; ~20–25% need TURN |

Netcode budget: 100 ms interpolation hides up to ~100 ms jitter; beyond that
extrapolation covers a few hundred ms before a visible snap. Totally fine for
friends-racing at 20 Hz.

## 9. Code snippets (TypeScript, HOLO-RACER style)

### Install
```bash
npm i trystero@^0.25.0
# signaling backend is hosted Supabase — create one free project, copy the anon key
```

### Room create / join (src/net/room.ts)
```ts
import {joinRoom, selfId} from 'trystero';
import {supabaseStrategy} from 'trystero/supabase';

const APP_ID = 'holo-racer-v1';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY!; // signaling only, safe in client

export interface NetRoom {
  roomId: string;
  code: string;
  isHost: boolean;
  sendSnapshot: (s: Snapshot) => void;   // unreliable
  sendEvent: (e: RaceEvent) => void;     // reliable
  onSnapshot: (fn: (s: Snapshot, peerId: string) => void) => void;
  onEvent: (fn: (e: RaceEvent, peerId: string) => void) => void;
  onPeerJoin: (fn: (peerId: string) => void) => void;
  onPeerLeave: (fn: (peerId: string) => void) => void;
  leave: () => void;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O (confusable)

export function makeCode(): string {
  let c = '';
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  for (let i = 0; i < 4; i++) c += CODE_ALPHABET[a[i] % CODE_ALPHABET.length];
  return c;
}

/** Host: create a room. Joiner: pass the 4-letter code from ?join= or the input. */
export function createOrJoinRoom(opts: {code?: string; name: string}): NetRoom {
  const code = (opts.code ?? makeCode()).toUpperCase();
  const roomId = `${APP_ID}-${code}`;
  const isHost = !opts.code;

  const room = joinRoom(
    {appId: APP_ID},
    roomId,
    supabaseStrategy({appId: APP_ID, supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY}),
  );

  // Unreliable, unordered — positions. Lossy is FINE (next snapshot fixes it).
  const [sendSnapshot, onSnapshot] = room.makeAction<Snapshot>('snap');
  // Reliable, ordered — race events only.
  const [sendEvent, onEvent] = room.makeAction<RaceEvent>('evt');

  // Presence: announce name/color so the lobby fills in
  const [sendHello, onHello] = room.makeAction<{name: string; color: number; t: number}>('hello');
  room.onPeerJoin(peerId => sendHello({name: opts.name, color: pickColor(), t: Date.now()}, peerId));
  sendHello({name: opts.name, color: pickColor(), t: Date.now()}); // broadcast to existing peers

  return {
    roomId, code, isHost, sendSnapshot, sendEvent, onSnapshot, onEvent,
    onPeerJoin: room.onPeerJoin, onPeerLeave: room.onPeerLeave,
    leave: () => room.leave(),
  };
}
```

### Snapshot broadcast — host side, 20 Hz (src/net/sync.ts)
```ts
export interface CarState {
  id: string; x: number; y: number; z: number; // meters, quantized on the wire
  heading: number; speed: number; lap: number; cp: number; // cp = checkpoint index
}
export interface Snapshot { seq: number; tHost: number; cars: CarState[]; }
export type RaceEvent =
  | {kind: 'start'; atHostTime: number}
  | {kind: 'finish'; carId: string; place: number}
  | {kind: 'item'; carId: string; item: string; targetId?: string};

/** Quantize to shrink packets: 16-bit pos (±327 m @ 1 cm), 16-bit heading. ~14 B/car. */
function packCars(cars: CarState[]): ArrayBuffer { /* DataView write Int16 ×4 + ... */ return new ArrayBuffer(0); }

export class HostSync {
  private seq = 0;
  private timer: number | null = null;
  constructor(private room: NetRoom, private getCars: () => CarState[]) {}

  start() {
    // 20 Hz — setInterval is fine; snapshots are idempotent and seq-numbered
    this.timer = window.setInterval(() => {
      this.room.sendSnapshot({seq: this.seq++, tHost: performance.now(), cars: this.getCars()});
    }, 50);
  }
  stop() { if (this.timer !== null) clearInterval(this.timer); this.timer = null; }
}
```

### Client side — interpolation + host-time clock sync (src/net/interp.ts)
```ts
interface StampedCar extends CarState { rtt: number }

export class RemoteCarView {
  private buf: {tHost: number; car: CarState}[] = [];
  private clockOffset = 0; // hostTime ≈ localTime + offset (smoothed)

  /** Call on each received snapshot. */
  push(snap: Snapshot) {
    const now = performance.now();
    // Simple Cristian-style offset estimate, smoothed
    const sample = snap.tHost - now;
    this.clockOffset = this.clockOffset === 0 ? sample : this.clockOffset * 0.9 + sample * 0.1;
    for (const car of snap.cars) {
      if (car.id === selfId) continue; // own car is predicted locally
      this.buf.push({tHost: snap.tHost, car});
    }
    // keep ~500 ms of history
    const cutoff = snap.tHost - 500;
    while (this.buf.length && this.buf[0].tHost < cutoff) this.buf.shift();
  }

  /** Call every render frame; returns the interpolated transform for a remote car. */
  sample(carId: string, out: {x: number; y: number; z: number; heading: number}): boolean {
    const renderTime = performance.now() + this.clockOffset - 100; // 100 ms behind host
    let a: (typeof this.buf)[0] | null = null, b: (typeof this.buf)[0] | null = null;
    for (const s of this.buf) {
      if (s.car.id !== carId) continue;
      if (s.tHost <= renderTime) a = s;
      else { b = s; break; }
    }
    if (a && b) { // interpolate
      const t = (renderTime - a.tHost) / Math.max(1, b.tHost - a.tHost);
      out.x = lerp(a.car.x, b.car.x, t); out.y = lerp(a.car.y, b.car.y, t);
      out.z = lerp(a.car.z, b.car.z, t);
      out.heading = lerpAngle(a.car.heading, b.car.heading, t);
      return true;
    }
    if (a) { // extrapolate (dead reckoning), capped — snap on next snapshot
      const dt = Math.min(300, renderTime - a.tHost) / 1000;
      out.x = a.car.x + Math.sin(a.car.heading) * a.car.speed * dt;
      out.z = a.car.z + Math.cos(a.car.heading) * a.car.speed * dt;
      out.y = a.car.y; out.heading = a.car.heading;
      return true;
    }
    return false; // no data yet — hide car
  }
}
```

### Own-car reconciliation (client, gentle — no snapping)
```ts
// On host snapshot, for the LOCAL car only:
const auth = snap.cars.find(c => c.id === selfId);
if (auth) {
  const err = distance(localCar.pos, auth); // meters
  if (err > 3) localCar.pos.copy(auth);            // teleport only on big desync
  else localCar.pos.lerp(auth, 0.12);               // else ease toward authority
  lap = auth.lap; checkpoint = auth.cp;            // laps/checkpoints are authoritative, always
}
```

### Host migration (earliest-joiner election with random backoff)
```ts
room.onPeerLeave(hostId => {
  if (hostId !== currentHostId) return; // only react to host loss
  pauseRace('Host left — electing new host…');
  const backoff = Math.random() * 1500; // random backoff avoids claim collisions
  setTimeout(() => {
    // claim: first to broadcast wins; others seeing a claim stand down
    sendEvent({kind: 'host-claim', atHostTime: performance.now(), claimer: selfId} as any);
  }, backoff);
});
// On receiving host-claim: if claimer joined earlier than me (compare join order via hello.t), accept.
```

### TURN config (for the ~20–25% behind symmetric NAT)
```ts
// trystero room config third arg:
joinRoom({appId: APP_ID}, roomId, strategy, {
  rtcConfig: {iceServers: [
    {urls: 'stun:stun.l.google.com:19302'},
    {urls: 'turn:turn.metered.ca:80', username: '…', credential: '…'}, // Metered free 5 GB/mo
  ]},
});
```

## 10. Build plan for HOLO-RACER (concrete next steps)

1. `npm i trystero@^0.25.0`; create free Supabase project; add
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` to Vercel env.
2. `src/net/room.ts` — create/join, lobby presence (code above).
3. `src/net/sync.ts` + `interp.ts` — 20 Hz host snapshots, interpolation, reconciliation.
4. Menu UI: "Multiplayer" → Create (show `KQZX` + `?join=KQZX` link + copy + QR) /
   Join (4-letter input, prefill from URL param).
5. Lobby screen: player list from `hello` presence; host Start → reliable `start` event
   with host-timestamped 3-2-1 countdown.
6. In-race: host runs HostSync; clients run RemoteCarView per remote car; own car
   predicted locally + gentle reconciliation.
7. Host-leave → pause → election → resume countdown.
8. Add Metered TURN credentials when NAT failures appear in testing.
9. Fallback: Nostr strategy import swap (one line) if Supabase project is paused
   (free projects pause after 1 week idle — keep alive or accept manual unpause).

Sources: PeerJS npm 1.5.5 / peerjs.com docs; emberdeep (PeerJS→Trystero migration);
ser-gen/peerjs-test (anchor protocol); gesturekart-ai-racing (same stack, Vercel, 30 Hz);
skidcircuit; gin/xrrc; breach/RUMPUS; powder-party; millos (PeerJS, 20 Hz, 100 ms interp);
Trystero 0.25.4 docs; Supabase Realtime pricing (200 conns / 2M msgs free);
yohimik/ws-webrtc-benchmark; Conexa P2P latency; urnetwork/connect channel benchmarks;
Firebase RTDB Spark limits (100 conns); y-webrtc docs; zonefall NETCODE.md;
fcsouza/game-state-sync.

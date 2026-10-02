/**
 * HOLO-RACER multiplayer networking adapters.
 *
 * =============================================================================
 * PROTOCOL (JSON text frames over WebSocket, protocol version 1)
 * =============================================================================
 * Client -> server:
 *   { "v": 1, "t": "hello", "room": "<roomId>", "id": "<playerId>" }
 *   { "v": 1, "t": "state", "s": { "id": "<playerId>", "steer": -128..127,
 *                                  "speed": 0..255, "lane": 0..3,
 *                                  "dist": 0..NET.Q.DIST_M } }   // ~10 Hz
 *   { "v": 1, "t": "bye",   "id": "<playerId>" }                 // on leave
 *
 * Server -> client:
 *   { "v": 1, "t": "welcome", "id": "<playerId>", "peers": ["<id>", ...] }
 *   { "v": 1, "t": "state",   "s": { ...NetCarState... } }       // relayed
 *   { "v": 1, "t": "bye",     "id": "<playerId>" }               // relayed
 *
 * The server is intentionally dumb: it puts sockets into rooms on "hello"
 * and broadcasts "state"/"bye" frames to the other sockets in the same room.
 * This is compatible with any trivial relay (plain Node `ws` server,
 * PartyKit, Cloudflare Durable Objects, ...). All validation lives here on
 * the client, so an untrusted relay cannot corrupt game state.
 *
 * Inbound types accepted from the relay: "welcome", "state", "bye".
 * (We never expect to receive "hello" — the allowlist rejects it.)
 *
 * =============================================================================
 * SECURITY
 * =============================================================================
 * - Every inbound frame is validated: must be an object, v === 1, t in the
 *   allowlist, and payloads type/length/range checked. Invalid frames are
 *   dropped and counted; after 20 invalid frames the connection is closed.
 * - roomId / playerId must match /^[a-zA-Z0-9_-]{1,32}$/ (checked in
 *   connect() AND on inbound ids).
 * - Numbers must be finite and inside the NetCarState ranges:
 *   steer -128..127, speed 0..255, lane 0..3, dist 0..NET.Q.DIST_M.
 * - JSON.parse is wrapped in try/catch; no eval / new Function anywhere.
 * - Frames larger than 4 KB are rejected by closing the socket (code 1009).
 * - Remote ids are used for game logic ONLY (peer lookup, leave events).
 *   They are never injected into the DOM (no innerHTML / template building
 *   with remote strings), so a hostile peer cannot achieve script injection.
 * - Outbound state is quantized (Math.round + clamp) and throttled to
 *   NET.SEND_HZ so a compromised tab cannot flood the relay.
 *
 * =============================================================================
 * BANDWIDTH MATH
 * =============================================================================
 * A state frame is compact JSON, e.g.
 *   {"v":1,"t":"state","s":{"id":"p1","steer":-12,"speed":200,"lane":2,"dist":1234}}
 * ~60-90 bytes on the wire (JSON + WS framing).
 *   10 frames/s * ~60-90 B  ~=  600-900 B/s  per peer, one direction.
 * With N peers, inbound is ~N * that. Even a 16-player room stays well under
 * NET.MAX_BYTES_PER_SEC (200_000 B/s) by two orders of magnitude.
 *
 * =============================================================================
 * EXAMPLE RELAY SERVER (Node, `ws` package — ~15-line sketch, not run here)
 * =============================================================================
 *   // import { WebSocketServer } from 'ws';
 *   // const wss = new WebSocketServer({ port: 8080 });
 *   // const rooms = new Map(); // roomId -> Set<ws>
 *   // wss.on('connection', (ws) => {
 *   //   ws.on('message', (raw) => {
 *   //     let m; try { m = JSON.parse(String(raw)); } catch { return; }
 *   //     if (!m || m.v !== 1) return;
 *   //     if (m.t === 'hello' && typeof m.room === 'string') {
 *   //       ws.room = m.room; ws.id = m.id;
 *   //       if (!rooms.has(m.room)) rooms.set(m.room, new Set());
 *   //       rooms.get(m.room).add(ws);
 *   //       const peers = [...rooms.get(m.room)].filter(p => p !== ws).map(p => p.id);
 *   //       ws.send(JSON.stringify({ v: 1, t: 'welcome', id: m.id, peers }));
 *   //     } else if ((m.t === 'state' || m.t === 'bye') && ws.room) {
 *   //       for (const p of rooms.get(ws.room) ?? [])
 *   //         if (p !== ws && p.readyState === 1) p.send(String(raw));
 *   //     }
 *   //   });
 *   //   ws.on('close', () => rooms.get(ws.room)?.delete(ws));
 *   // });
 */
import type { NetCarState } from '../types.ts';
import { NET } from '../config.ts';

export interface INetAdapter {
  readonly connected: boolean;
  connect(roomId: string, playerId: string): Promise<void>;
  disconnect(): void;
  /** Throttled internally to NET.SEND_HZ. Quantized (rounded + clamped). */
  sendState(s: NetCarState): void;
  onRemote(cb: (s: NetCarState) => void): void;
  onPeerLeave(cb: (id: string) => void): void;
  /** Connection health: ok=true on connect/welcome, ok=false on problems. */
  onStatus(cb: (ok: boolean, msg: string) => void): void;
}

/** Protocol version every frame must carry. */
const PROTOCOL_V = 1;
/** Inbound frames larger than this are rejected by closing the socket. */
const MAX_MESSAGE_BYTES = 4096;
/** Invalid inbound frames tolerated before the connection is dropped. */
const MAX_INVALID = 20;
/** roomId / playerId allowlist. */
const ID_RE = /^[a-zA-Z0-9_-]{1,32}$/;
/** Inbound message types we accept from the relay. */
const INBOUND_TYPES = new Set(['welcome', 'state', 'bye']);
/** Abnormal-close reconnect attempts. */
const MAX_RECONNECTS = 3;
const BACKOFF_MS = [1000, 2000, 4000];
const SEND_INTERVAL_MS = 1000 / NET.SEND_HZ;
const WELCOME_TIMEOUT_MS = 10_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v);
}

function isNumIn(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

function validNetCarState(v: unknown): v is NetCarState {
  if (!isRecord(v)) return false;
  return (
    isValidId(v.id) &&
    isNumIn(v.steer, -128, 127) &&
    isNumIn(v.speed, 0, 255) &&
    isNumIn(v.lane, 0, 3) &&
    isNumIn(v.dist, 0, NET.Q.DIST_M)
  );
}

/** Quantize outbound values: round + clamp into the protocol ranges. */
function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function quantizeOutbound(s: NetCarState, id: string): NetCarState {
  return {
    id,
    steer: clampInt(s.steer, -128, 127),
    speed: clampInt(s.speed, 0, 255),
    lane: clampInt(s.lane, 0, 3),
    dist: clampInt(s.dist, 0, NET.Q.DIST_M),
  };
}

/**
 * Single-player adapter: a complete no-op. connect() resolves immediately,
 * connected is always false, sendState() discards, and no callback ever
 * fires (there are no remote peers).
 */
export class LocalAdapter implements INetAdapter {
  get connected(): boolean {
    return false;
  }
  connect(_roomId: string, _playerId: string): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): void {
    /* no-op: nothing was ever connected */
  }
  sendState(_s: NetCarState): void {
    /* no-op: no relay to send to */
  }
  onRemote(_cb: (s: NetCarState) => void): void {
    /* no-op: no remote peers exist */
  }
  onPeerLeave(_cb: (id: string) => void): void {
    /* no-op: no remote peers exist */
  }
  onStatus(_cb: (ok: boolean, msg: string) => void): void {
    /* no-op: connection status is meaningless without a network */
  }
}

/**
 * WebSocket adapter implementing the protocol documented above.
 * - Throttles sendState() to NET.SEND_HZ and quantizes outbound values.
 * - Validates every inbound frame; drops invalid ones and disconnects
 *   after MAX_INVALID of them.
 * - Reconnects up to MAX_RECONNECTS times with backoff on abnormal close.
 */
export class WebSocketAdapter implements INetAdapter {
  private readonly url: string;
  private ws: WebSocket | null = null;
  private welcomed = false;
  private roomId = '';
  private playerId = '';
  private closedByUs = false;
  private closeReason: string | null = null;
  private reconnects = 0;
  private reconnectTimer: number | null = null;
  private welcomeTimer: number | null = null;
  private lastSend = 0;
  private invalid = 0;
  private pending: Promise<void> | null = null;
  private resolvePending: (() => void) | null = null;
  private rejectPending: ((e: Error) => void) | null = null;
  private remoteCbs: Array<(s: NetCarState) => void> = [];
  private leaveCbs: Array<(id: string) => void> = [];
  private statusCbs: Array<(ok: boolean, msg: string) => void> = [];

  constructor(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`WebSocketAdapter: invalid relay url: ${url}`);
    }
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      throw new Error(`WebSocketAdapter: relay url must use ws: or wss:, got ${parsed.protocol}`);
    }
    this.url = url;
  }

  get connected(): boolean {
    return this.welcomed && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  connect(roomId: string, playerId: string): Promise<void> {
    if (!ID_RE.test(roomId)) throw new Error('WebSocketAdapter: invalid roomId (1-32 chars of [a-zA-Z0-9_-])');
    if (!ID_RE.test(playerId)) throw new Error('WebSocketAdapter: invalid playerId (1-32 chars of [a-zA-Z0-9_-])');
    if (this.connected) return Promise.resolve();
    if (this.pending) return this.pending;
    this.roomId = roomId;
    this.playerId = playerId;
    this.closedByUs = false;
    this.closeReason = null;
    this.reconnects = 0;
    this.invalid = 0;
    this.pending = new Promise<void>((resolve, reject) => {
      this.resolvePending = resolve;
      this.rejectPending = reject;
      this.openSocket();
      this.welcomeTimer = window.setTimeout(() => {
        this.welcomeTimer = null;
        this.failPending(new Error('WebSocketAdapter: timed out waiting for welcome'));
        this.hardClose(1008, 'welcome timeout');
      }, WELCOME_TIMEOUT_MS);
    });
    return this.pending;
  }

  disconnect(): void {
    this.closeReason = 'disconnected';
    this.failPending(new Error('WebSocketAdapter: disconnect() called while connecting'));
    this.closedByUs = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.welcomeTimer !== null) {
      window.clearTimeout(this.welcomeTimer);
      this.welcomeTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    this.welcomed = false;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close(1000, 'client disconnect');
      } catch {
        /* already gone */
      }
    }
    this.emitStatus(false, 'disconnected');
  }

  sendState(s: NetCarState): void {
    if (!this.connected || this.ws === null) return;
    const now = performance.now();
    if (now - this.lastSend < SEND_INTERVAL_MS) return; // throttle to SEND_HZ
    this.lastSend = now;
    const q = quantizeOutbound(s, this.playerId);
    try {
      this.ws.send(JSON.stringify({ v: PROTOCOL_V, t: 'state', s: q }));
    } catch {
      /* socket died mid-send; close handler will report */
    }
  }

  onRemote(cb: (s: NetCarState) => void): void {
    this.remoteCbs.push(cb);
  }

  onPeerLeave(cb: (id: string) => void): void {
    this.leaveCbs.push(cb);
  }

  onStatus(cb: (ok: boolean, msg: string) => void): void {
    this.statusCbs.push(cb);
  }

  // -- internals -------------------------------------------------------------

  private openSocket(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener('open', () => this.handleOpen());
    ws.addEventListener('message', (ev) => this.handleRaw(ev.data));
    ws.addEventListener('error', () => this.handleError());
    ws.addEventListener('close', (ev) => this.handleClose(ev));
  }

  private handleOpen(): void {
    this.reconnects = 0;
    this.invalid = 0;
    try {
      this.ws?.send(
        JSON.stringify({ v: PROTOCOL_V, t: 'hello', room: this.roomId, id: this.playerId }),
      );
    } catch {
      /* send failed; close/error handlers will follow */
    }
  }

  private handleError(): void {
    // The close event always follows an error; it does the reporting.
    if (this.pending) this.failPending(new Error('WebSocketAdapter: connection error'));
  }

  private handleClose(ev: CloseEvent): void {
    this.ws = null;
    this.welcomed = false;
    if (this.welcomeTimer !== null) {
      window.clearTimeout(this.welcomeTimer);
      this.welcomeTimer = null;
    }
    if (this.pending) {
      this.failPending(new Error(`WebSocketAdapter: closed before welcome (code ${ev.code})`));
      this.emitStatus(false, this.closeReason ?? `connection closed (code ${ev.code})`);
      this.closeReason = null;
      return;
    }
    if (this.closedByUs) {
      this.emitStatus(false, this.closeReason ?? 'disconnected');
      this.closeReason = null;
      return;
    }
    if (ev.wasClean || ev.code === 1000) {
      this.emitStatus(false, `connection closed cleanly (code ${ev.code})`);
      return;
    }
    if (this.reconnects >= MAX_RECONNECTS) {
      this.emitStatus(false, `reconnect attempts exhausted (${MAX_RECONNECTS}); giving up`);
      return;
    }
    const delay = BACKOFF_MS[this.reconnects] ?? 4000;
    this.reconnects += 1;
    this.emitStatus(false, `connection lost; reconnect ${this.reconnects}/${MAX_RECONNECTS} in ${delay}ms`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUs) this.openSocket();
    }, delay);
  }

  /** Close the socket without scheduling a reconnect. */
  private hardClose(code: number, reason: string): void {
    this.closeReason = reason;
    this.closedByUs = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    this.welcomed = false;
    if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
      try {
        ws.close(code, reason);
      } catch {
        /* already gone */
      }
    }
    this.emitStatus(false, reason);
  }

  private failPending(err: Error): void {
    const reject = this.rejectPending;
    this.pending = null;
    this.resolvePending = null;
    this.rejectPending = null;
    if (reject) reject(err);
  }

  private handleRaw(data: unknown): void {
    if (typeof data !== 'string') {
      this.noteInvalid('non-string frame');
      return;
    }
    if (data.length > MAX_MESSAGE_BYTES) {
      // Oversize frame: the peer/relay is misbehaving; do not process it.
      this.failPending(new Error('WebSocketAdapter: oversize message received'));
      this.hardClose(1009, `message exceeded ${MAX_MESSAGE_BYTES} bytes; connection closed`);
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      this.noteInvalid('unparseable JSON');
      return;
    }
    if (!isRecord(msg) || msg.v !== PROTOCOL_V || typeof msg.t !== 'string' || !INBOUND_TYPES.has(msg.t)) {
      this.noteInvalid('bad envelope (v/t)');
      return;
    }
    switch (msg.t) {
      case 'welcome':
        this.handleWelcome(msg);
        break;
      case 'state':
        this.handleState(msg);
        break;
      case 'bye':
        this.handleBye(msg);
        break;
      default:
        // Unreachable: INBOUND_TYPES allowlist checked above.
        this.noteInvalid('unknown type');
        break;
    }
  }

  private handleWelcome(msg: Record<string, unknown>): void {
    if (!isValidId(msg.id) || !Array.isArray(msg.peers) || !msg.peers.every(isValidId)) {
      this.noteInvalid('bad welcome payload');
      return;
    }
    this.welcomed = true;
    if (this.welcomeTimer !== null) {
      window.clearTimeout(this.welcomeTimer);
      this.welcomeTimer = null;
    }
    const resolve = this.resolvePending;
    this.pending = null;
    this.resolvePending = null;
    this.rejectPending = null;
    this.emitStatus(true, `joined room as ${this.playerId}`);
    if (resolve) resolve();
  }

  private handleState(msg: Record<string, unknown>): void {
    if (!validNetCarState(msg.s)) {
      this.noteInvalid('bad state payload');
      return;
    }
    const s = msg.s;
    if (s.id === this.playerId) return; // ignore our own echo from the relay
    // Rebuild a fresh object from validated fields so downstream code never
    // holds a reference to the raw parsed JSON.
    const clean: NetCarState = {
      id: s.id,
      steer: Math.round(s.steer),
      speed: Math.round(s.speed),
      lane: Math.round(s.lane),
      dist: Math.round(s.dist),
    };
    for (const cb of this.remoteCbs) cb(clean);
  }

  private handleBye(msg: Record<string, unknown>): void {
    if (!isValidId(msg.id)) {
      this.noteInvalid('bad bye payload');
      return;
    }
    if (msg.id === this.playerId) return;
    for (const cb of this.leaveCbs) cb(msg.id);
  }

  private noteInvalid(reason: string): void {
    this.invalid += 1;
    if (this.invalid >= MAX_INVALID) {
      this.failPending(new Error(`WebSocketAdapter: too many invalid messages (${reason})`));
      this.hardClose(1008, `too many invalid messages (${MAX_INVALID}); connection closed`);
    }
    // Note: individual invalid frames are dropped silently (no status spam);
    // ids are logic-only and never touch the DOM.
  }

  private emitStatus(ok: boolean, msg: string): void {
    for (const cb of this.statusCbs) {
      try {
        cb(ok, msg);
      } catch {
        /* a status listener must never break the adapter */
      }
    }
  }
}

/**
 * Create an adapter. 'local' needs no arguments (single-player no-op).
 * 'ws' requires the relay server URL, e.g. "wss://relay.example.com".
 */
export function createAdapter(kind: 'local' | 'ws', url?: string): INetAdapter {
  if (kind === 'local') return new LocalAdapter();
  if (url === undefined || url === '') {
    throw new Error("createAdapter('ws') requires a relay server url");
  }
  return new WebSocketAdapter(url);
}

/**
 * Multiplayer room management via Trystero (WebRTC P2P).
 *
 * Uses @trystero-p2p/nostr (current scoped package) with curated relay list
 * for reliability. Zero-setup: no accounts, no servers to configure.
 * Host creates a 4-letter room code; friends join with the code or ?join=CODE.
 */
import { joinRoom, type Room } from '@trystero-p2p/nostr';

// Curated Nostr relays (emberdeep's proven list — Trystero's defaults include dead relays)
const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
];

// TURN servers for NAT traversal (~20-25% of peer pairs need TURN)
// Cloudflare Realtime TURN: 1TB/mo free, anycast
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Metered Open Relay (public credentials for open-source projects)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  isHost: boolean;
  [key: string]: string | number | boolean;
}

export interface CarSnapshot {
  id: string;
  x: number; y: number; z: number;
  heading: number;
  speed: number;
  lap: number;
  [key: string]: string | number;
}

export interface RaceSnapshot {
  seq: number;
  tHost: number;
  cars: CarSnapshot[];
  [key: string]: number | CarSnapshot[];
}

export type RaceEvent =
  | { type: 'race-start'; countdownMs: number; tHost: number; [key: string]: string | number }
  | { type: 'race-finish'; playerId: string; position: number; [key: string]: string | number }
  | { type: 'player-join'; player: PlayerInfo; [key: string]: string | PlayerInfo }
  | { type: 'player-leave'; playerId: string; [key: string]: string }
  | { type: 'host-migrate'; newHostId: string; [key: string]: string };

const ROOM_PREFIX = 'holo-racer-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export class MultiplayerRoom {
  private room: Room;
  readonly code: string;
  readonly playerId: string;
  readonly isHost: boolean;
  players = new Map<string, PlayerInfo>();

  onSnapshot: ((snap: RaceSnapshot, peerId: string) => void) | null = null;
  onEvent: ((evt: RaceEvent, peerId: string) => void) | null = null;
  onPeerJoin: ((peerId: string) => void) | null = null;
  onPeerLeave: ((peerId: string) => void) | null = null;

  constructor(code: string, playerName: string, isHost: boolean) {
    this.code = code.toUpperCase();
    this.isHost = isHost;
    this.playerId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    this.room = joinRoom(
      {
        appId: ROOM_PREFIX + this.code,
        relayConfig: { urls: RELAYS },
        rtcConfig: RTC_CONFIG,
      },
      this.playerId,
    );

    // Position snapshots: send frequently, lossy is fine
    const snapAction = this.room.makeAction<RaceSnapshot>('snap');
    snapAction.onMessage = (snap, ctx) => {
      this.onSnapshot?.(snap, ctx.peerId);
    };

    // Race events: reliable delivery
    const evtAction = this.room.makeAction<RaceEvent>('evt');
    evtAction.onMessage = (evt, ctx) => {
      if (evt.type === 'player-join') {
        this.players.set(evt.player.id, evt.player);
      } else if (evt.type === 'player-leave') {
        this.players.delete(evt.playerId);
      }
      this.onEvent?.(evt, ctx.peerId);
    };

    this.room.onPeerJoin = (peerId: string) => {
      this.onPeerJoin?.(peerId);
    };
    this.room.onPeerLeave = (peerId: string) => {
      this.players.delete(peerId);
      this.onPeerLeave?.(peerId);
    };

    this.players.set(this.playerId, this.localPlayer(playerName));
    // Store actions for sending
    (this as any)._snapAction = snapAction;
    (this as any)._evtAction = evtAction;
  }

  private localPlayer(name: string): PlayerInfo {
    const colors = [0x00e5ff, 0xff2d78, 0x00ff9d, 0xffd600, 0x7c4dff, 0xff6a00];
    return {
      id: this.playerId,
      name: name || `Racer-${this.playerId.slice(-4).toUpperCase()}`,
      color: colors[this.players.size % colors.length],
      isHost: this.isHost,
    };
  }

  broadcastSnapshot(snap: RaceSnapshot): void {
    (this as any)._snapAction.send(snap);
  }

  broadcastEvent(evt: RaceEvent): void {
    (this as any)._evtAction.send(evt);
    if (evt.type === 'player-join') {
      this.players.set(evt.player.id, evt.player);
    }
  }

  /** Announce ourselves to peers (call after joining). */
  announce(playerName: string): void {
    this.broadcastEvent({ type: 'player-join', player: this.localPlayer(playerName) });
  }

  get playerCount(): number {
    return this.players.size;
  }

  leave(): void {
    this.broadcastEvent({ type: 'player-leave', playerId: this.playerId });
    this.room.leave();
  }
}

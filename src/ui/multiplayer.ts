/**
 * Multiplayer UI: create/join room, lobby with player list, room code sharing.
 */
import { MultiplayerRoom, generateRoomCode } from '../net/room.ts';

export interface MultiplayerCallbacks {
  onRoomCreated: (room: MultiplayerRoom) => void;
  onRoomJoined: (room: MultiplayerRoom) => void;
  onStartRace: () => void;
  onLeave: () => void;
}

export class MultiplayerUI {
  private root: HTMLElement;
  private room: MultiplayerRoom | null = null;
  private cb: MultiplayerCallbacks;

  constructor(parent: HTMLElement, cb: MultiplayerCallbacks) {
    this.cb = cb;
    this.root = document.createElement('div');
    this.root.id = 'mp-ui';
    this.root.style.cssText = `
      position: fixed; inset: 0; z-index: 60;
      display: none; align-items: center; justify-content: center;
      background: rgba(4, 8, 20, 0.85); backdrop-filter: blur(8px);
    `;
    parent.appendChild(this.root);
  }

  /** Show the create/join menu. */
  showMenu(): void {
    this.root.style.display = 'flex';
    this.root.innerHTML = `
      <div class="holo-panel" style="max-width: 420px; text-align: center;">
        <h2 class="panel-title">🏁 MULTIPLAYER</h2>
        <p class="hint">Race your friends — no accounts, just a 4-letter code.</p>
        <div class="btn-col">
          <button class="holo-btn primary" data-action="mp-create">
            ➕ CREATE ROOM
          </button>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <input id="mp-join-code" maxlength="4" placeholder="CODE"
              style="flex:1; text-transform:uppercase; text-align:center;
                     font-size:20px; letter-spacing:4px; padding:10px;
                     background:rgba(0,229,255,0.08); border:1px solid #00e5ff;
                     border-radius:8px; color:#fff; outline:none;" />
            <button class="holo-btn" data-action="mp-join">JOIN</button>
          </div>
        </div>
        <p class="hint" style="margin-top:12px;">
          Or share a link: <span style="color:#00e5ff">holo-racer.vercel.app/?join=CODE</span>
        </p>
        <button class="holo-btn" data-action="mp-close" style="margin-top:8px;">← BACK</button>
      </div>
    `;
    this.root.querySelector('[data-action="mp-create"]')?.addEventListener('click', () => {
      const name = this.askName();
      const code = generateRoomCode();
      this.room = new MultiplayerRoom(code, name, true);
      this.setupRoomHandlers();
      this.showLobby();
      this.cb.onRoomCreated(this.room);
    });
    this.root.querySelector('[data-action="mp-join"]')?.addEventListener('click', () => {
      const input = this.root.querySelector('#mp-join-code') as HTMLInputElement;
      const code = input.value.trim().toUpperCase();
      if (code.length !== 4) {
        input.style.borderColor = '#ff2d78';
        return;
      }
      const name = this.askName();
      this.room = new MultiplayerRoom(code, name, false);
      this.setupRoomHandlers();
      this.showLobby();
      this.cb.onRoomJoined(this.room);
    });
    this.root.querySelector('[data-action="mp-close"]')?.addEventListener('click', () => this.hide());
  }

  private askName(): string {
    const saved = localStorage.getItem('holo-racer-name') || '';
    const name = prompt('Your racer name:', saved || 'Racer') || 'Racer';
    localStorage.setItem('holo-racer-name', name.slice(0, 16));
    return name.slice(0, 16);
  }

  private setupRoomHandlers(): void {
    if (!this.room) return;
    this.room.onPeerJoin = () => this.refreshLobby();
    this.room.onPeerLeave = () => this.refreshLobby();
    this.room.onEvent = (evt) => {
      if (evt.type === 'player-join') this.refreshLobby();
      if (evt.type === 'player-leave') this.refreshLobby();
      if (evt.type === 'race-start') this.hide();
    };
  }

  /** Show the lobby with room code and player list. */
  showLobby(): void {
    if (!this.room) return;
    this.root.style.display = 'flex';
    this.refreshLobby();
  }

  private refreshLobby(): void {
    if (!this.room) return;
    const room = this.room;
    const players = [...room.players.values()];
    const joinUrl = `${location.origin}${location.pathname}?join=${room.code}`;

    this.root.innerHTML = `
      <div class="holo-panel" style="max-width: 440px; text-align: center;">
        <h2 class="panel-title">🏁 ROOM ${room.code}</h2>
        <div style="font-size:48px; letter-spacing:12px; font-weight:800;
                    color:#00e5ff; text-shadow:0 0 20px #00e5ff; margin:12px 0;">
          ${room.code}
        </div>
        <div style="display:flex; gap:8px; justify-content:center; margin-bottom:16px;">
          <button class="holo-btn" data-action="mp-copy-code">📋 COPY CODE</button>
          <button class="holo-btn" data-action="mp-copy-link">🔗 COPY LINK</button>
        </div>
        <div style="text-align:left; margin:12px 0;">
          <div style="font-size:12px; color:#8aa; margin-bottom:6px;">
            PLAYERS (${players.length})
          </div>
          ${players.map((p) => `
            <div style="display:flex; align-items:center; gap:8px; padding:6px 0;
                        border-bottom:1px solid rgba(0,229,255,0.15);">
              <div style="width:12px; height:12px; border-radius:50%;
                          background:#${p.color.toString(16).padStart(6, '0')};
                          box-shadow:0 0 8px #${p.color.toString(16).padStart(6, '0')};"></div>
              <span style="flex:1;">${this.esc(p.name)}</span>
              ${p.isHost ? '<span style="font-size:11px; color:#ffd600;">👑 HOST</span>' : ''}
            </div>
          `).join('')}
        </div>
        ${room.isHost ? `
          <button class="holo-btn primary" data-action="mp-start" style="width:100%; margin-top:8px;">
            🏁 START RACE
          </button>
          <p class="hint">Waiting for friends to join...</p>
        ` : `
          <p class="hint">Waiting for host to start...</p>
        `}
        <button class="holo-btn danger" data-action="mp-leave" style="margin-top:8px;">
          ✕ LEAVE ROOM
        </button>
      </div>
    `;

    this.root.querySelector('[data-action="mp-copy-code"]')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(room.code);
    });
    this.root.querySelector('[data-action="mp-copy-link"]')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(joinUrl);
    });
    this.root.querySelector('[data-action="mp-start"]')?.addEventListener('click', () => {
      room.broadcastEvent({ type: 'race-start', countdownMs: 3000, tHost: Date.now() });
      this.hide();
      this.cb.onStartRace();
    });
    this.root.querySelector('[data-action="mp-leave"]')?.addEventListener('click', () => {
      room.leave();
      this.room = null;
      this.hide();
      this.cb.onLeave();
    });
  }

  private esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]!));
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  get currentRoom(): MultiplayerRoom | null {
    return this.room;
  }

  /** Check URL for ?join=CODE on load. */
  static getJoinCodeFromUrl(): string | null {
    const m = new URLSearchParams(location.search).get('join');
    return m && /^[A-Z0-9]{4}$/i.test(m) ? m.toUpperCase() : null;
  }
}

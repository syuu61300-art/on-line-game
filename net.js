// Transport adapters. The game only uses: presence(patch), peers(), myId, leave().
// Peers are normalised to { id, presence, me }.

// ---------- claude.ai artifact room ----------
class ClaudeRoomWrap {
  constructor(r, isLobby) {
    this.r = r;
    this.isLobby = isLobby;
    this._cache = null; this._src = null;
  }
  presence(patch) { return this.r.presence(patch).catch(() => {}); }
  peers() {
    const src = this.r.peers();
    if (src === this._src && this._cache) return this._cache;
    this._src = src;
    this._cache = src.filter((p) => p.kind !== 'agent').map((p) => ({ id: p.peer, presence: p.presence, me: p.sameTab, other: p.isMe && !p.sameTab }));
    return this._cache;
  }
  get myId() {
    for (const p of this.r.peers()) if (p.sameTab) return p.peer;
    return null;
  }
  connected() { try { return this.r.connected(); } catch { return false; } }
  async leave() {
    if (this.isLobby) return;
    try { await this.r.leave(); } catch {}
  }
}

export class ClaudeTransport {
  constructor() { this.kind = 'claude'; this.room = null; this.dead = false; }
  async connect() {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return false;
      const room = await window.claude.use('room');
      if (!room) return false;
      this.room = room;
      this.lobby = new ClaudeRoomWrap(room, true);
      room.onConnection(() => {}, () => { this.dead = true; });
      room.onPeers(() => {}, () => { this.dead = true; });
      return true;
    } catch { return false; }
  }
  connected() { return !this.dead && this.lobby && this.lobby.connected(); }
  async joinRoom(name) {
    try {
      const r = await this.room.join(name);
      return new ClaudeRoomWrap(r, false);
    } catch (e) {
      // named rooms unavailable: play in the shared lobby
      this.fallback = true;
      return this.lobby;
    }
  }
}

// ---------- WebSocket server (Node version) ----------
class WsRoom {
  constructor(t, name) {
    this.t = t; this.name = name;
    this.map = new Map();
    this._arr = null;
    this.mine = {};
  }
  presence(patch) {
    for (const k in patch) { if (patch[k] === null) delete this.mine[k]; else this.mine[k] = patch[k]; }
    this._dirty = true;
    this._mark();
    return Promise.resolve();
  }
  _mark() { this._arr = null; }
  flush() {
    if (!this._dirty) return;
    this._dirty = false;
    this.t.send({ op: 'pres', room: this.name, p: this.mine });
  }
  peers() {
    if (this._arr) return this._arr;
    const out = [];
    if (this.t.myId) out.push({ id: this.t.myId, presence: this.mine, me: true });
    for (const [id, pr] of this.map) if (id !== this.t.myId) out.push({ id, presence: pr, me: false });
    this._arr = out;
    return out;
  }
  get myId() { return this.t.myId; }
  connected() { return this.t.open; }
  async leave() { this.t.send({ op: 'leave', room: this.name }); this.t.rooms.delete(this.name); }
}

export class WsTransport {
  constructor(url) { this.kind = 'ws'; this.url = url; this.rooms = new Map(); this.open = false; this.myId = null; }
  connect() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        const ws = new WebSocket(this.url);
        this.ws = ws;
        const to = setTimeout(() => finish(false), 3500);
        ws.onmessage = (ev) => {
          let m; try { m = JSON.parse(ev.data); } catch { return; }
          if (m.op === 'welcome') {
            this.myId = m.id; this.open = true; clearTimeout(to);
            this.lobby = this._room('lobby');
            this.send({ op: 'join', room: 'lobby' });
            finish(true);
          } else if (m.op === 'p') {
            const r = this.rooms.get(m.room); if (!r) return;
            r.map.set(m.id, Object.freeze(m.p)); r._mark();
          } else if (m.op === 'snap') {
            const r = this.rooms.get(m.room); if (!r) return;
            r.map.clear();
            for (const [id, p] of m.peers) r.map.set(id, Object.freeze(p));
            r._mark();
          } else if (m.op === 'left') {
            const r = this.rooms.get(m.room); if (!r) return;
            r.map.delete(m.id); r._mark();
          }
        };
        ws.onclose = () => { this.open = false; finish(false); };
        ws.onerror = () => finish(false);
        this._timer = setInterval(() => { for (const r of this.rooms.values()) r.flush(); }, 33);
      } catch { finish(false); }
    });
  }
  _room(name) {
    let r = this.rooms.get(name);
    if (!r) { r = new WsRoom(this, name); this.rooms.set(name, r); }
    return r;
  }
  send(o) { if (this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  connected() { return this.open; }
  async joinRoom(name) {
    const r = this._room(name);
    this.send({ op: 'join', room: name });
    return r;
  }
}

// ---------- offline ----------
export class LocalRoom {
  constructor() { this.mine = {}; this.myId = 'me'; this._arr = null; }
  presence(patch) { Object.assign(this.mine, patch); this._arr = null; return Promise.resolve(); }
  peers() { return this._arr || (this._arr = [{ id: 'me', presence: this.mine, me: true }]); }
  connected() { return true; }
  async leave() {}
}

export async function pickTransport() {
  // 1) inside a claude.ai artifact viewer
  if (window.claude && typeof window.claude.use === 'function') {
    const t = new ClaudeTransport();
    if (await t.connect()) return t;
    return null;
  }
  // 2) served by the bundled Node server
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    const t = new WsTransport(url);
    if (await t.connect()) return t;
  }
  return null;
}

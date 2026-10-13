import * as THREE from 'three';
import { NET_VERSION, PLAYER, MATCH, WEAPONS, WEAPON_CODES, PRIMARIES, GRENADE, COLORS, MELEE_BASH, ZONE_HEAD, ZONE_LIMB } from './config.js';
import { buildMap } from './map.js';
import { NavGrid } from './nav.js';
import { Effects } from './effects.js';
import { Sound } from './audio.js';
import { ViewModel } from './viewmodel.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { LocalPlayer } from './player.js';
import { Avatar } from './avatar.js';
import { Bot, isBotId, botName, botColor, botId } from './bots.js';
import { hitboxes, rayBox } from './physics.js';
import { LocalRoom } from './net.js';
import { CROSS_COLORS } from './settings.js';
import { makeGrenadeMesh } from './models.js';
import { clamp, damp, lerp, r1, r2, r3, coneDir, dirFromYawPitch, yawTo, hashStr, fmtTime, sanitizeText, isNum, vec3ok, rand } from './util.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _d = { x: 0, y: 0, z: 0 }, _o = { x: 0, y: 0, z: 0 };

export class Game {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    // antialias is fixed when the renderer is created (changes apply after a reload)
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !!settings.aa, powerPreference: 'high-performance', stencil: false }));
    r.setPixelRatio(1);
    r.shadowMap.enabled = true; // shadows stay on in every preset
    r.shadowMap.type = settings.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.autoClear = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 1600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.map = buildMap(this.scene, r, settings.quality);
    this.world = this.map.world;
    this.textures = this.map.textures;
    this.nav = new NavGrid(this.world);
    this.effects = new Effects(this.scene, this.textures, this.world);
    this.sound = new Sound();
    this.sound.volume = settings.volume;
    this.viewmodel = new ViewModel(this.textures, this.scene.environment);
    this.hud = new Hud(this);
    this.hud.buildMinimap(this.map.mini);
    this.input = new Input(canvas, document.getElementById('touch'), settings);
    this.player = new LocalPlayer(this);

    this.time = 0;
    this.state = 'menu';
    this.mode = 'offline';
    this.paused = false;
    this.chatOpen = false;
    this.zoomRatio = 1;
    this.remotes = new Map();
    this.remoteBots = new Map();
    this.bots = [];
    this.grenades = [];
    this.events = [];
    this.seq = 0;
    this.nadeSeq = 0;
    this.kills = 0; this.deaths = 0;
    this.round = 0;
    this.matchState = 'play';
    this.matchEnd = 0;
    this.interEnd = 0;
    this.isHost = true;
    this.hostId = 'me';
    this.lastHostPres = null;
    this.myId = 'me';
    this.room = null;
    this.transport = null;
    this.blips = new Map();
    this._presT = 0;
    this._combat = [];
    this._combatFrame = -1;
    this.frameNo = 0;
    this.fpsT = 0; this.fpsN = 0;
    this.flyT = 0;
    this.lastPeersCount = 0;

    this._buildPickups();
    this._resize();
    this.applySettings();
    addEventListener('resize', () => this._resize());
    this.last = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // ------------------------------------------------------------ setup
  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel.camera.aspect = w / h;
    this.viewmodel.camera.updateProjectionMatrix();
  }

  // Apply the player's (fair) preferences at runtime.
  applySettings() {
    const S = this.settings;
    const P = { high: { pr: 1.5, shadow: 2048, soft: true }, medium: { pr: 1.25, shadow: 2048, soft: false }, low: { pr: 1, shadow: 1024, soft: false } }[S.quality] || { pr: 1, shadow: 1024, soft: false };
    const pr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, P.pr) * S.renderScale);
    if (Math.abs(this.renderer.getPixelRatio() - pr) > 0.001) { this.renderer.setPixelRatio(pr); this._resize(); }
    const sun = this.map.sun;
    if (sun.shadow.mapSize.x !== P.shadow) {
      sun.shadow.mapSize.set(P.shadow, P.shadow);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    const type = P.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.renderer.shadowMap.type !== type) {
      this.renderer.shadowMap.type = type;
      this.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    }
    this.sound.setMix(S.volume, S.sfxVol, S.ambVol, S.uiVol);
    const root = document.documentElement;
    root.style.setProperty('--cross', CROSS_COLORS[S.crossColor] || CROSS_COLORS.paper);
    root.style.setProperty('--hud', String(S.hudScale));
    document.getElementById('cross').dataset.style = S.crossStyle;
    document.getElementById('chatlog').hidden = !S.showChat;
    this.input.applyTouchLayout();
  }

  _buildPickups() {
    const hpMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.5, emissive: 0x112a26, emissiveIntensity: 0.4 });
    const crossMat = new THREE.MeshStandardMaterial({ color: 0x4fc1b3, emissive: 0x4fc1b3, emissiveIntensity: 0.8 });
    const ammoMat = new THREE.MeshStandardMaterial({ color: 0x4d5440, roughness: 0.7 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf2a541, emissive: 0xf2a541, emissiveIntensity: 0.6 });
    const ringMat = new THREE.MeshBasicMaterial({ map: this.textures.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xf2a541, opacity: 0.6 });
    this.pickups = this.map.pickups.map((p) => {
      const g = new THREE.Group();
      if (p.type === 'hp') {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.32), hpMat));
        const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.34), crossMat);
        const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.34), crossMat);
        g.add(c1, c2);
      } else if (p.type === 'ammo') {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.26, 0.28), ammoMat));
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.05, 0.29), stripeMat);
        g.add(s);
      } else {
        const n1 = makeGrenadeMesh(); n1.position.x = -0.09; g.add(n1);
        const n2 = makeGrenadeMesh(); n2.position.x = 0.09; g.add(n2);
      }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), ringMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, p.y + 0.02, p.z);
      ring.material.color.set(p.type === 'hp' ? 0x4fc1b3 : p.type === 'nade' ? 0xc9a52c : 0xf2a541);
      this.scene.add(ring);
      g.position.set(p.x, p.y + 0.55, p.z);
      this.scene.add(g);
      return { ...p, mesh: g, ring, available: true, respawnAt: 0 };
    });
  }

  // ------------------------------------------------------------ session
  async start(mode, transport, roomName) {
    this.mode = mode;
    this.transport = transport;
    this.sound.init();
    const S = this.settings;
    this.sound.setMix(S.volume, S.sfxVol, S.ambVol, S.uiVol);
    if (mode === 'online' && transport) {
      this.room = await transport.joinRoom(roomName);
      this.roomName = transport.fallback ? 'lobby' : roomName;
    } else {
      this.room = new LocalRoom();
      this.roomName = null;
    }
    this.myId = this.room.myId || 'me';
    this.state = 'play';
    this.kills = 0; this.deaths = 0;
    this.round = 0;
    this.matchState = 'play';
    this.isHost = true;
    this.hostId = this.myId;
    this.lastHostPres = null;
    this.events = [];
    this.seq = 0;
    this.paused = false;
    this.player.setLoadout(this.settings.primary);
    this.viewmodel.setColor(this.myColor());
    this.hud.show(true);
    this.input.enabled = true;
    this.input.clear();
    if (this.input.touch) document.getElementById('touch').classList.add('on');
    document.getElementById('hud').classList.toggle('touchmode', !!this.input.touch);
    for (const p of this.pickups) { p.available = true; p.respawnAt = 0; }
    this.player.alive = false;
    this.player.deathTime = this.time - PLAYER.respawn + 0.6; // spawn shortly
    this.player.killer = null;
    this.spawnPending = true;
    this.startTime = this.time;
    this.hud.chat('', '', mode === 'online' ? `ルーム「${this.roomName}」に参加しました。Enterでチャット。` : 'オフライン練習を開始しました。', true);
    this._sendPresence(true);
  }

  async leave() {
    this.state = 'menu';
    this.input.enabled = false;
    this.input.unlock();
    this.hud.show(false);
    document.getElementById('touch').classList.remove('on');
    for (const id of ['death', 'roundend', 'pause']) document.getElementById(id).hidden = true;
    for (const r of this.remotes.values()) r.avatar.dispose();
    this.remotes.clear();
    for (const a of this.remoteBots.values()) a.dispose();
    this.remoteBots.clear();
    for (const b of this.bots) b.dispose();
    this.bots = [];
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.grenades = [];
    this.player.alive = false;
    if (this.room) {
      try {
        if (this.room.isLobby) await this.room.presence({ st: 'menu', p: null, a: null, ev: null, m: null, b: null, f: null, w: null, rm: null });
        else await this.room.leave();
      } catch {}
    }
    this.room = null;
  }

  myName() { return this.settings.name || 'ゲスト'; }
  myColorIdx() { return hashStr(this.myId + this.myName()) % COLORS.length; }
  myColor() { return COLORS[this.myColorIdx()]; }
  matchRunning() { return this.state === 'play' && this.matchState === 'play'; }

  // ------------------------------------------------------------ entities
  combatants() {
    if (this._combatFrame === this.frameNo) return this._combat;
    this._combatFrame = this.frameNo;
    const out = (this._combat = []);
    const p = this.player;
    if (this.state === 'play') {
      out.push({
        id: this.myId, alive: p.alive, pos: p.body, crouch: p.crouch, yaw: p.yaw, me: true,
        protected: p.spawnProtected,
        getHitboxes: () => hitboxes(p.body.x, p.body.y, p.body.z, p.yaw, p.crouch, []),
      });
    }
    for (const r of this.remotes.values()) {
      if (!r.inGame) continue;
      const a = r.avatar;
      out.push({ id: r.id, alive: a.alive, pos: a.pos, crouch: a.crouch, yaw: a.yaw, getHitboxes: () => a.getHitboxes(), protected: !!(a.flags & 64) });
    }
    if (this.isHost) {
      for (const b of this.bots) {
        out.push({ id: b.id, alive: b.alive, pos: b.body, crouch: b.crouch, yaw: b.yaw, bot: b, getHitboxes: () => hitboxes(b.body.x, b.body.y, b.body.z, b.yaw, b.crouch, []), protected: b.spawnProtected });
      }
    } else {
      for (const [id, a] of this.remoteBots) {
        out.push({ id, alive: a.alive, pos: a.pos, crouch: a.crouch, yaw: a.yaw, getHitboxes: () => a.getHitboxes(), protected: !!(a.flags & 64) });
      }
    }
    return out;
  }

  entityPos(id) {
    if (id === this.myId) return this.player.body;
    const r = this.remotes.get(id);
    if (r) return r.avatar.pos;
    if (this.isHost) { const b = this.botById(id); if (b) return b.body; }
    const a = this.remoteBots.get(id);
    if (a) return a.pos;
    return null;
  }

  entityName(id) {
    if (id === this.myId) return [this.myName(), this.myColor()];
    const r = this.remotes.get(id);
    if (r) return [r.name, r.color];
    if (isBotId(id)) { const i = parseInt(id.slice(2), 10) || 0; return [botName(i), botColor(i)]; }
    return ['???', '#92a3ab'];
  }

  botById(id) { return this.bots.find((b) => b.id === id); }

  avatarOf(id) {
    const r = this.remotes.get(id);
    if (r) return r.avatar;
    if (this.isHost) { const b = this.botById(id); return b ? b.avatar : null; }
    return this.remoteBots.get(id) || null;
  }

  pickSpawn(forId) {
    const enemies = this.combatants().filter((c) => c.alive && c.id !== forId);
    const scored = this.map.spawns.map((s) => {
      let minD = 999, seen = false;
      for (const e of enemies) {
        const d = Math.hypot(e.pos.x - s.x, e.pos.z - s.z);
        if (d < minD) minD = d;
        if (d < 35 && this.world.los(e.pos.x, e.pos.y + 1.5, e.pos.z, s.x, s.y + 1.5, s.z)) seen = true;
      }
      return { s, score: minD - (seen ? 30 : 0) + Math.random() * 8 };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[Math.floor(Math.random() * Math.min(3, scored.length))].s;
  }

  nearestPickup(type, pos) {
    let best = null, bd = Infinity;
    for (const p of this.pickups) {
      if (p.type !== type || !p.available) continue;
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ------------------------------------------------------------ shooting
  traceShot(ox, oy, oz, dx, dy, dz, range, shooterId) {
    const wh = this.world.raycast(ox, oy, oz, dx, dy, dz, range, true);
    let tMax = wh ? wh.t : range;
    let target = null, zone = 0;
    for (const c of this.combatants()) {
      if (c.id === shooterId || !c.alive) continue;
      // cheap reject: closest approach of ray to the body centre
      const cx = c.pos.x - ox, cy = c.pos.y + 0.9 - oy, cz = c.pos.z - oz;
      const along = cx * dx + cy * dy + cz * dz;
      if (along < -1 || along > tMax + 1) continue;
      const px = cx - dx * along, py = cy - dy * along, pz = cz - dz * along;
      if (px * px + py * py + pz * pz > 2.0) continue;
      for (const hb of c.getHitboxes()) {
        const t = rayBox(ox, oy, oz, dx, dy, dz, hb.minx, hb.miny, hb.minz, hb.maxx, hb.maxy, hb.maxz);
        if (t >= 0 && t < tMax) { tMax = t; target = c; zone = hb.zone; }
      }
    }
    return {
      t: tMax,
      x: ox + dx * tMax, y: oy + dy * tMax, z: oz + dz * tMax,
      target, zone,
      wall: !target && wh ? wh : null,
    };
  }

  calcDamage(def, zone, dist) {
    const [f0, f1, fmin] = def.falloff;
    const fall = dist <= f0 ? 1 : dist >= f1 ? fmin : lerp(1, fmin, (dist - f0) / (f1 - f0));
    const zm = zone === ZONE_HEAD ? def.head : zone === ZONE_LIMB ? def.limb : 1;
    return def.dmg * zm * fall;
  }

  // shared by local player and bots
  _fireWeapon(shooterId, def, ox, oy, oz, dir, spread, muzzle, localView) {
    const pellets = def.pellets || 1;
    const hits = new Map();
    const ends = [];
    for (let i = 0; i < pellets; i++) {
      const s = pellets > 1 ? spread : spread;
      coneDir(dir, s, _d);
      const res = this.traceShot(ox, oy, oz, _d.x, _d.y, _d.z, def.range, shooterId);
      if (i < 3) ends.push([r1(res.x), r1(res.y), r1(res.z)]);
      if (res.target) {
        const dmg = this.calcDamage(def, res.zone, res.t);
        const h = hits.get(res.target.id) || { target: res.target, dmg: 0, head: false, count: 0 };
        h.dmg += dmg; h.count++;
        if (res.zone === ZONE_HEAD) h.head = true;
        hits.set(res.target.id, h);
        if (!res.target.protected) this.effects.blood(res.x, res.y, res.z, _d.x, _d.z, res.zone === ZONE_HEAD);
      } else if (res.wall) {
        const w = res.wall;
        this.effects.impact(res.x, res.y, res.z, w.nx, w.ny, w.nz, w.box.mat, true);
      }
      if (i < (pellets > 1 ? 4 : 1)) this.effects.tracer(muzzle.x, muzzle.y, muzzle.z, res.x, res.y, res.z);
    }
    let anyHead = false, anyKill = false, anyHit = false;
    for (const h of hits.values()) {
      if (h.target.protected) continue;
      anyHit = true;
      if (h.head) anyHead = true;
      const killed = this.dealDamage(shooterId, h.target.id, h.dmg, h.head ? ZONE_HEAD : 0, def.id, { x: ox, y: oy, z: oz });
      if (killed) anyKill = true;
    }
    if (localView && anyHit) {
      this.hud.hitmarker(anyHead, anyKill);
      this.sound.hit(anyHead, false);
    }
    return ends;
  }

  localFire(player, w) {
    const def = w.def;
    const cam = this.camera;
    const b = player.body;
    const eyeY = b.y + player.eye;
    dirFromYawPitch(player.yaw + player.punchY, player.pitch + player.punchP, _o);
    const spread = def.pellets > 1
      ? lerp(def.pelletSpread, def.pelletSpreadAds, player.adsT) + (player.body.onGround ? 0 : 0.03)
      : w.spread(player.adsT, player.speed, b.onGround, player.crouch);
    const muzzle = this.viewmodel.muzzleWorld(cam, _v3);
    const ends = this._fireWeapon(this.myId, def, b.x, eyeY, b.z, _o, spread, muzzle, true);
    this.pushEvent({ t: 'f', w: def.id, e: ends });
    this.sound.gun(def, null);
    this.viewmodel.fire(def, player.adsT > 0.5);
    player.applyRecoil(def);
    this.effects.muzzleLight(muzzle.x, muzzle.y, muzzle.z, 1.4);
    this.effects.muzzleSmoke(muzzle.x, muzzle.y, muzzle.z, _o.x, _o.y, _o.z);
    if (!def.pump && !def.bolt) {
      // eject casing to the right
      _v1.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
      _v2.copy(muzzle).addScaledVector(_o, -0.45).addScaledVector(_v1, 0.05);
      this.effects.casing(_v2, _v1.multiplyScalar(rand(1.5, 2.6)).add(_v3.set(0, rand(1.2, 2.2), 0)).addScaledVector(_o, -0.3));
    }
    this.alertBots(b.x, b.y, b.z, this.myId);
  }

  botFire(bot, w) {
    const def = w.def;
    const b = bot.body;
    bot.aimDir(_o);
    const spread = def.pellets > 1 ? def.pelletSpread : w.spread(0, Math.hypot(b.vx, b.vz), b.onGround, bot.crouch);
    const muzzle = bot.avatar.muzzlePos(_v3);
    const ends = this._fireWeapon(bot.id, def, b.x, bot.eye(), b.z, _o, spread, muzzle, false);
    bot.applyRecoil(def);
    bot.avatar.fired();
    this.blip(bot.id);
    this.sound.gun(def, muzzle);
    this.effects.muzzleLight(muzzle.x, muzzle.y, muzzle.z, 1.0);
    this.pushEvent({ t: 'f', a: bot.id, w: def.id, e: ends });
    this.alertBots(b.x, b.y, b.z, bot.id);
  }

  botMelee(bot, target) {
    const b = bot.body;
    if (!this.world.los(b.x, bot.eye(), b.z, target.pos.x, target.pos.y + 1.2, target.pos.z)) return;
    this.dealDamage(bot.id, target.id, 55, 0, 'knife', { x: b.x, y: b.y, z: b.z });
  }

  doMelee(kind) {
    const p = this.player;
    const b = p.body;
    const eyeY = b.y + p.eye;
    dirFromYawPitch(p.yaw, p.pitch, _o);
    const range = kind === 'knife' ? WEAPONS.knife.range : MELEE_BASH.range;
    let best = null;
    // three short rays in a small fan
    for (const off of [0, -0.25, 0.25]) {
      dirFromYawPitch(p.yaw + off, p.pitch, _d);
      const res = this.traceShot(b.x, eyeY, b.z, _d.x, _d.y, _d.z, range, this.myId);
      if (res.target && (!best || res.t < best.t)) best = res;
      if (!best && off === 0 && res.wall) this.effects.impact(res.x, res.y, res.z, res.wall.nx, res.wall.ny, res.wall.nz, res.wall.box.mat, false);
    }
    if (!best || best.target.protected) return;
    let dmg = kind === 'knife' ? WEAPONS.knife.dmg : MELEE_BASH.dmg;
    // backstab: attacker facing roughly the same way as the victim
    const dy = Math.abs(((best.target.yaw - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (kind === 'knife' && dy < 1.05) dmg = WEAPONS.knife.backstab;
    this.effects.blood(best.x, best.y, best.z, _o.x, _o.z, false);
    const killed = this.dealDamage(this.myId, best.target.id, dmg, 0, kind === 'knife' ? 'knife' : 'bash', { x: b.x, y: b.y, z: b.z });
    this.hud.hitmarker(false, killed);
    this.sound.hit(false, false);
  }

  // returns true if the victim died (known locally)
  dealDamage(attackerId, victimId, dmg, zone, weaponId, src) {
    dmg = Math.max(1, Math.round(dmg));
    if (victimId === this.myId) return this.damageLocal(dmg, attackerId, weaponId, zone, src);
    if (isBotId(victimId) && this.isHost) {
      const bot = this.botById(victimId);
      if (!bot) return false;
      return this.damageBot(bot, dmg, attackerId, weaponId, zone, src);
    }
    const e = { t: 'h', v: victimId, d: dmg, z: zone, w: weaponId };
    if (attackerId !== this.myId) e.a = attackerId;
    this.pushEvent(e);
    return false;
  }

  damageBot(bot, dmg, attackerId, weaponId, zone, src) {
    if (!this.matchRunning()) return false;
    if (bot.applyDamage(dmg, attackerId, weaponId, zone, src)) {
      this.botDied(bot, attackerId, weaponId, zone);
      return true;
    }
    return false;
  }

  botDied(bot, attackerId, weaponId, zone) {
    this.pushEvent({ t: 'k', v: bot.id, a: attackerId, w: weaponId, z: zone });
  }

  damageLocal(dmg, attackerId, weaponId, zone, src) {
    const p = this.player;
    if (!p.alive || this.state !== 'play' || !this.matchRunning()) return false;
    if (p.spawnProtected && attackerId !== this.myId) return false;
    dmg = clamp(dmg, 0, 400);
    if (attackerId === this.myId && weaponId === 'grenade') dmg *= 0.6;
    p.hp -= dmg;
    p.lastDamage = this.time;
    let ang = null;
    const sp = src || this.entityPos(attackerId);
    if (sp && attackerId !== this.myId) ang = yawTo(sp.x - p.body.x, sp.z - p.body.z);
    this.hud.damage(dmg, ang);
    this.sound.hurt();
    p.punchP += (Math.random() - 0.3) * 0.02;
    p.punchY += (Math.random() - 0.5) * 0.03;
    if (p.hp <= 0) {
      this.localDeath(attackerId, weaponId, zone);
      return true;
    }
    return false;
  }

  localDeath(attackerId, weaponId, zone) {
    const p = this.player;
    p.alive = false;
    p.hp = 0;
    p.deathTime = this.time;
    p.killer = attackerId;
    p.deathPos = { x: p.body.x, y: p.body.y + p.eye, z: p.body.z };
    this.input.resetToggles();
    this.deaths++;
    this.pushEvent({ t: 'k', v: this.myId, a: attackerId, w: weaponId, z: zone });
    this.viewmodel.cur && (this.viewmodel.cur.group.visible = false);
    this._showDeath(attackerId, weaponId);
  }

  alertBots(x, y, z, sourceId) {
    if (!this.isHost) return;
    for (const b of this.bots) b.hearNoise(x, y, z, sourceId);
  }

  blip(id) { this.blips.set(id, this.time); }

  // ------------------------------------------------------------ grenades
  throwLocalGrenade() {
    const p = this.player;
    dirFromYawPitch(p.yaw, p.pitch + 0.12, _o);
    const pos = new THREE.Vector3(p.body.x + _o.x * 0.5, p.body.y + p.eye - 0.1 + _o.y * 0.5, p.body.z + _o.z * 0.5);
    const vel = new THREE.Vector3(_o.x, _o.y, _o.z).multiplyScalar(GRENADE.throwSpeed);
    vel.y += 2.5;
    vel.x += p.body.vx * 0.5; vel.z += p.body.vz * 0.5;
    // don't spawn inside a wall
    if (this.world.blocked(pos.x - 0.07, pos.y - 0.07, pos.z - 0.07, pos.x + 0.07, pos.y + 0.07, pos.z + 0.07)) pos.set(p.body.x, p.body.y + p.eye - 0.2, p.body.z);
    const id = ++this.nadeSeq;
    this.spawnGrenade(this.myId, id, pos, vel, GRENADE.fuse, true);
    this.pushEvent({ t: 'g', i: id, p: [r2(pos.x), r2(pos.y), r2(pos.z)], v: [r2(vel.x), r2(vel.y), r2(vel.z)] });
  }

  botThrowGrenade(bot, target) {
    const b = bot.body;
    const dx = target.x - b.x, dz = target.z - b.z;
    const d = Math.hypot(dx, dz);
    const ang = 0.6;
    const g = 16;
    const v = clamp(Math.sqrt((d * g) / Math.sin(2 * ang)) * 0.95, 6, 21);
    const pos = new THREE.Vector3(b.x + (dx / d) * 0.4, bot.eye(), b.z + (dz / d) * 0.4);
    const vel = new THREE.Vector3((dx / d) * Math.cos(ang) * v, Math.sin(ang) * v, (dz / d) * Math.cos(ang) * v);
    const id = ++this.nadeSeq;
    this.spawnGrenade(bot.id, id, pos, vel, GRENADE.fuse, true);
    this.pushEvent({ t: 'g', a: bot.id, i: id, p: [r2(pos.x), r2(pos.y), r2(pos.z)], v: [r2(vel.x), r2(vel.y), r2(vel.z)] });
  }

  spawnGrenade(owner, id, pos, vel, fuse, auth) {
    const mesh = makeGrenadeMesh();
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.grenades.push({ key: owner + ':' + id, owner, id, pos: pos.clone(), vel: vel.clone(), fuse, auth, mesh, rest: false });
  }

  _updateGrenades(dt) {
    const R = 0.07;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      if (g.fuse <= 0 && g.auth) {
        this.grenades.splice(i, 1);
        this.scene.remove(g.mesh);
        const e = { t: 'x', i: g.id, p: [r2(g.pos.x), r2(g.pos.y), r2(g.pos.z)] };
        if (g.owner !== this.myId) e.a = g.owner;
        this.pushEvent(e);
        this.explode(g.pos.x, g.pos.y, g.pos.z, g.owner);
        continue;
      }
      if (g.fuse < -1.5) { this.grenades.splice(i, 1); this.scene.remove(g.mesh); continue; }
      if (g.rest) continue;
      const steps = 4, h = dt / steps;
      for (let s = 0; s < steps; s++) {
        g.vel.y -= 16 * h;
        for (const ax of ['x', 'y', 'z']) {
          const old = g.pos[ax];
          g.pos[ax] += g.vel[ax] * h;
          if (this.world.blocked(g.pos.x - R, g.pos.y - R, g.pos.z - R, g.pos.x + R, g.pos.y + R, g.pos.z + R)) {
            g.pos[ax] = old;
            const sp = Math.abs(g.vel[ax]);
            g.vel[ax] *= -0.35;
            for (const o of ['x', 'y', 'z']) if (o !== ax) g.vel[o] *= 0.72;
            if (sp > 2.5) this.sound.bounce(g.pos);
            if (ax === 'y' && Math.abs(g.vel.y) < 0.6 && Math.hypot(g.vel.x, g.vel.z) < 0.4) { g.rest = true; g.vel.set(0, 0, 0); }
          }
        }
      }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += g.vel.length() * dt * 2;
      g.mesh.rotation.z += g.vel.length() * dt * 1.3;
    }
  }

  explode(x, y, z, owner) {
    this.effects.explosion(x, y, z, this.camera.position);
    this.sound.explosion({ x, y, z });
    this.alertBots(x, y, z, owner);
    const R = GRENADE.radius;
    const test = (px, py, pz) => {
      const d = Math.hypot(px - x, py - y, pz - z);
      if (d > R) return 0;
      if (!this.world.los(x, y + 0.25, z, px, py, pz)) return 0;
      return GRENADE.maxDmg * Math.pow(1 - d / R, 1.25);
    };
    const p = this.player;
    if (this.state === 'play' && p.alive) {
      const dmg = Math.max(test(p.body.x, p.body.y + 1.0, p.body.z), test(p.body.x, p.body.y + p.eye, p.body.z));
      if (dmg > 2) this.damageLocal(dmg, owner, 'grenade', 0, { x, y, z });
    }
    if (this.isHost) {
      for (const b of this.bots) {
        if (!b.alive) continue;
        const dmg = Math.max(test(b.body.x, b.body.y + 1.0, b.body.z), test(b.body.x, b.eye(), b.body.z));
        if (dmg > 2) this.damageBot(b, b.id === owner ? dmg * 0.6 : dmg, owner, 'grenade', 0, { x, y, z });
      }
    }
  }

  // ------------------------------------------------------------ events
  pushEvent(e) {
    e.s = ++this.seq;
    e.at = performance.now();
    this.events.push(e);
    this.handleEvent(this.myId, e, true);
  }

  handleEvent(sender, e, local) {
    if (!e || typeof e.t !== 'string') return;
    const attacker = typeof e.a === 'string' ? e.a.slice(0, 40) : sender;
    switch (e.t) {
      case 'f': {
        if (local) return;
        if (isBotId(attacker) && this.isHost) return; // my own bots (shouldn't happen)
        const def = WEAPONS[e.w];
        if (!def || !def.sound) return;
        const av = this.avatarOf(attacker);
        const m = av ? av.muzzlePos(_v1) : null;
        if (av) av.fired();
        this.blip(attacker);
        if (m) {
          this.sound.gun(def, m);
          this.effects.muzzleLight(m.x, m.y, m.z, 0.9);
          if (Array.isArray(e.e)) for (const end of e.e.slice(0, 4)) {
            if (!vec3ok(end)) continue;
            this.effects.tracer(m.x, m.y, m.z, end[0], end[1], end[2]);
            this._remoteImpact(m, end);
          }
          this.alertBots(m.x, m.y, m.z, attacker);
        }
        return;
      }
      case 'h': {
        if (local) return;
        if (!isNum(e.d)) return;
        const dmg = clamp(e.d, 0, 300);
        const src = this.entityPos(attacker);
        if (e.v === this.myId) this.damageLocal(dmg, attacker, WEAPONS[e.w] ? e.w : 'ar', e.z | 0, src ? { x: src.x, y: src.y, z: src.z } : null);
        else if (isBotId(e.v) && this.isHost) {
          const bot = this.botById(e.v);
          if (bot) this.damageBot(bot, dmg, attacker, WEAPONS[e.w] ? e.w : 'ar', e.z | 0, src);
        }
        return;
      }
      case 'k': {
        const victim = typeof e.v === 'string' ? e.v : sender;
        const killer = typeof e.a === 'string' ? e.a : victim;
        const [vn, vc] = this.entityName(victim);
        const [kn, kc] = this.entityName(killer);
        const weapon = WEAPONS[e.w] ? e.w : 'ar';
        const head = e.z === ZONE_HEAD;
        const mine = killer === this.myId || victim === this.myId;
        if (killer === victim) this.hud.killfeed('', '', vn, vc, weapon, false, mine);
        else this.hud.killfeed(kn, kc, vn, vc, weapon, head, mine);
        if (killer === this.myId && victim !== this.myId && this.state === 'play') this._onMyKill(vn, head, weapon);
        if (this.isHost && isBotId(killer) && killer !== victim) {
          const b = this.botById(killer);
          if (b) b.kills++;
        }
        if (this.isHost && isBotId(victim) && local === false) {
          // a bot reported dead by someone else? only host decides bot deaths: ignore
        }
        return;
      }
      case 'g': {
        if (local) return;
        if (!vec3ok(e.p) || !vec3ok(e.v)) return;
        const owner = attacker;
        const key = owner + ':' + e.i;
        if (this.grenades.some((g) => g.key === key)) return;
        this.spawnGrenade(owner, e.i, new THREE.Vector3(...e.p), new THREE.Vector3(...e.v), GRENADE.fuse, false);
        return;
      }
      case 'x': {
        if (local) return;
        if (!vec3ok(e.p)) return;
        const owner = attacker;
        const key = owner + ':' + e.i;
        const idx = this.grenades.findIndex((g) => g.key === key);
        if (idx >= 0) { this.scene.remove(this.grenades[idx].mesh); this.grenades.splice(idx, 1); }
        this.explode(e.p[0], e.p[1], e.p[2], owner);
        return;
      }
      case 'pk': {
        const p = this.pickups[e.i | 0];
        if (!p) return;
        p.available = false;
        p.respawnAt = this.time + (p.type === 'hp' ? 22 : p.type === 'nade' ? 30 : 20);
        return;
      }
      case 'c': {
        const msg = sanitizeText(e.m, 80);
        if (!msg) return;
        const [n, c] = this.entityName(sender);
        this.hud.chat(n, c, msg);
        if (!local) this.sound.chat();
        return;
      }
    }
  }

  _remoteImpact(m, end) {
    // re-trace the last few centimetres to find the surface normal for the spark
    const dx = end[0] - m.x, dy = end[1] - m.y, dz = end[2] - m.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.5) return;
    const hit = this.world.raycast(m.x, m.y, m.z, dx / d, dy / d, dz / d, d + 0.3, true);
    if (hit && Math.abs(hit.t - d) < 0.6) this.effects.impact(m.x + (dx / d) * hit.t, m.y + (dy / d) * hit.t, m.z + (dz / d) * hit.t, hit.nx, hit.ny, hit.nz, hit.box.mat, true);
  }

  _onMyKill(victimName, head, weapon) {
    const p = this.player;
    this.kills++;
    p.streak++;
    p.multi = this.time - p.lastKillTime < 4.5 ? p.multi + 1 : 1;
    p.lastKillTime = this.time;
    this.hud.hitmarker(head, true);
    this.sound.hit(head, true);
    this.hud.toast(`撃破  ${victimName}`, '');
    if (head) this.hud.toast('ヘッドショット', 'sm');
    const multi = ['', '', 'ダブルキル', 'トリプルキル', 'クアドラキル', 'ウルトラキル'];
    if (p.multi >= 2) this.hud.toast(multi[Math.min(p.multi, 5)], 'big');
    if ([3, 5, 8, 12, 16].includes(p.streak)) this.hud.toast(`${p.streak}連続キル`, 'big');
  }

  sendChat(text) {
    const m = sanitizeText(text, 80);
    if (!m) return;
    this.pushEvent({ t: 'c', m });
  }

  // ------------------------------------------------------------ network sync
  _syncNetwork() {
    const room = this.room;
    if (!room) return;
    if (this.myId === 'me' && room.myId) {
      this.myId = room.myId;
      this.hostId = this.myId;
      this.viewmodel.setColor(this.myColor());
    }
    const now = performance.now();
    const peers = room.peers();
    const seen = new Set();
    let hostCandidate = this.myId;
    for (const peer of peers) {
      if (peer.me) continue;
      const pr = peer.presence || {};
      const id = peer.id;
      const inGame = pr.st === 'play' && pr.v === NET_VERSION;
      seen.add(id);
      let rec = this.remotes.get(id);
      if (!rec) {
        if (!inGame) continue;
        const name = sanitizeText(pr.n, 14) || 'プレイヤー';
        const color = COLORS[(pr.c | 0) % COLORS.length] || COLORS[0];
        rec = { id, name, color, avatar: new Avatar(this, id, name, color, false), lastPres: null, lastSeq: -1, k: 0, d: 0, off: Infinity, inGame: true };
        this.remotes.set(id, rec);
        this.hud.chat('', '', `${name} が参加しました`, true);
      }
      rec.inGame = inGame;
      if (inGame && id < hostCandidate) hostCandidate = id;
      if (pr === rec.lastPres) continue;
      rec.lastPres = pr;
      if (!inGame) { rec.avatar.setFlags(0); continue; }
      const name = sanitizeText(pr.n, 14) || 'プレイヤー';
      const color = COLORS[(pr.c | 0) % COLORS.length] || COLORS[0];
      if (name !== rec.name || color !== rec.color) { rec.name = name; rec.color = color; rec.avatar.setName(name, color); }
      rec.k = pr.k | 0; rec.d = pr.d | 0;
      if (isNum(pr.t)) {
        rec.off = Math.min(rec.off + 0.5, now - pr.t); // slow drift allowance
        const t = pr.t + rec.off;
        if (vec3ok(pr.p) && Array.isArray(pr.a)) rec.avatar.pushSnap(t, pr.p[0], pr.p[1], pr.p[2], +pr.a[0] || 0, +pr.a[1] || 0, pr.f | 0, WEAPON_CODES.includes(pr.w) ? pr.w : 'ar');
      }
      // events
      if (Array.isArray(pr.ev)) {
        if (rec.lastSeq < 0) {
          for (const e of pr.ev) if (e && e.s > rec.lastSeq) rec.lastSeq = e.s;
          if (rec.lastSeq < 0) rec.lastSeq = 0;
        } else {
          const list = pr.ev.filter((e) => e && isNum(e.s) && e.s > rec.lastSeq).sort((a, b) => a.s - b.s);
          for (const e of list) { rec.lastSeq = e.s; this.handleEvent(id, e, false); }
        }
      }
      rec.hostPres = pr.m ? pr : null;
    }
    // departures
    for (const [id, rec] of this.remotes) {
      if (!seen.has(id) || !rec.inGame) {
        if (!seen.has(id)) {
          rec.avatar.dispose();
          this.remotes.delete(id);
          this.hud.chat('', '', `${rec.name} が退出しました`, true);
        }
      }
    }
    // ---- host election (lowest id among in-game peers, me included) ----
    const newHost = hostCandidate;
    if (newHost !== this.hostId) {
      const wasHost = this.isHost;
      this.hostId = newHost;
      this.isHost = newHost === this.myId;
      if (this.isHost && !wasHost) this._becomeHost();
      if (!this.isHost && wasHost) this._resignHost();
    }
    if (!this.isHost) {
      const hr = this.remotes.get(this.hostId);
      const hp = hr && hr.lastPres;
      if (hp && hp.m) this._readHostState(hp);
    }
  }

  _becomeHost() {
    // adopt the previous host's bots (positions, scores) if we saw them
    const prev = this.lastHostPres;
    for (const a of this.remoteBots.values()) a.dispose();
    this.remoteBots.clear();
    this._ensureBots(prev && Array.isArray(prev.b) ? prev.b : null);
  }

  _resignHost() {
    for (const b of this.bots) b.dispose();
    this.bots = [];
  }

  _ensureBots(seed) {
    const want = clamp(this.settings.botCount | 0, 0, 8);
    while (this.bots.length > want) this.bots.pop().dispose();
    for (let i = this.bots.length; i < want; i++) {
      const b = new Bot(this, i, this.settings.difficulty);
      const s = seed && seed.find((x) => x[0] === i);
      if (s && vec3ok([s[1], s[2], s[3]])) {
        b.body.x = s[1]; b.body.y = s[2]; b.body.z = s[3]; b.yaw = s[4] || 0;
        b.alive = !!(s[6] & 1); b.kills = s[8] | 0; b.deaths = s[9] | 0;
        if (b.alive) b.spawnTime = this.time - 5;
      }
      this.bots.push(b);
    }
  }

  _readHostState(hp) {
    this.lastHostPres = hp;
    const m = hp.m;
    const now = performance.now();
    if (isNum(m.r) && m.r !== this.round) this._newRound(m.r);
    if (isNum(m.tl)) this.matchEnd = now + clamp(m.tl, 0, MATCH.duration + 5000);
    const st = m.s ? 'end' : 'play';
    if (isNum(m.e)) this.interEnd = now + clamp(m.e, 0, MATCH.intermission + 2000);
    if (st !== this.matchState) this._setMatchState(st);
    // bots
    const hr = this.remotes.get(this.hostId);
    if (Array.isArray(hp.b)) {
      const live = new Set();
      for (const s of hp.b.slice(0, 8)) {
        if (!Array.isArray(s) || s.length < 10) continue;
        const idx = s[0] | 0;
        if (idx < 0 || idx > 15) continue;
        const id = botId(idx);
        live.add(id);
        let a = this.remoteBots.get(id);
        if (!a) { a = new Avatar(this, id, botName(idx), botColor(idx), true); this.remoteBots.set(id, a); }
        if (vec3ok([s[1], s[2], s[3]])) a.pushSnap(hp.t + (hr ? hr.off : 0), s[1], s[2], s[3], +s[4] || 0, +s[5] || 0, s[6] | 0, WEAPON_CODES.includes(s[7]) ? s[7] : 'ar');
        a.kills = s[8] | 0; a.deaths = s[9] | 0;
      }
      for (const [id, a] of this.remoteBots) if (!live.has(id)) { a.dispose(); this.remoteBots.delete(id); }
    }
  }

  _sendPresence(force) {
    if (!this.room || this.state !== 'play') return;
    const now = performance.now();
    if (!force && now - this._presT < 33) return;
    this._presT = now;
    // trim events
    this.events = this.events.filter((e) => now - e.at < 1400).slice(-26);
    const p = this.player, b = p.body;
    const pres = {
      v: NET_VERSION, st: 'play', n: this.myName(), c: this.myColorIdx(),
      t: Math.round(now), p: [r2(b.x), r2(b.y), r2(b.z)], a: [r3(p.yaw), r3(p.pitch)],
      f: p.flags(), w: p.weapon.id, k: this.kills, d: this.deaths, r: this.round,
      ev: this.events.map(({ at, ...rest }) => rest),
    };
    if (this.isHost) {
      pres.m = { r: this.round, tl: Math.max(0, Math.round(this.matchEnd - now)), s: this.matchState === 'end' ? 1 : 0, e: Math.max(0, Math.round(this.interEnd - now)) };
      pres.b = this.bots.map((bt) => [bt.index, r2(bt.body.x), r2(bt.body.y), r2(bt.body.z), r3(bt.yaw), r3(bt.pitch), bt.flags(), bt.weapon.id, bt.kills, bt.deaths]);
    } else { pres.m = null; pres.b = null; }
    const enc = this._enc || (this._enc = new TextEncoder());
    let size = enc.encode(JSON.stringify(pres)).length;
    while (size > 3800 && pres.ev.length) { pres.ev.shift(); size = enc.encode(JSON.stringify(pres)).length; }
    this.room.presence(pres);
  }

  // ------------------------------------------------------------ match flow
  _hostMatch() {
    const now = performance.now();
    if (this.round === 0) {
      const prev = this.lastHostPres && this.lastHostPres.m;
      if (prev && isNum(prev.r) && prev.r > 0) {
        this.round = prev.r;
        this.matchEnd = now + clamp(prev.tl || 0, 0, MATCH.duration);
        this.matchState = prev.s ? 'end' : 'play';
        this.interEnd = now + (prev.e || 0);
      } else {
        this._newRound(1);
        this.matchEnd = now + MATCH.duration;
      }
    }
    if (this.matchState === 'play') {
      let top = this.kills;
      for (const r of this.remotes.values()) if (r.inGame) top = Math.max(top, r.k);
      for (const b of this.bots) top = Math.max(top, b.kills);
      if (now >= this.matchEnd || top >= MATCH.killLimit) {
        this.interEnd = now + MATCH.intermission;
        this._setMatchState('end');
      }
    } else if (now >= this.interEnd) {
      this._newRound(this.round + 1);
      this.matchEnd = now + MATCH.duration;
      this._setMatchState('play');
    }
  }

  _newRound(r) {
    const first = this.round === 0;
    this.round = r;
    this.kills = 0; this.deaths = 0;
    const p = this.player;
    p.streak = 0;
    for (const b of this.bots) { b.kills = 0; b.deaths = 0; if (!first) { b.alive = false; b.respawnT = rand(0.3, 1.5); } }
    for (const pk of this.pickups) { pk.available = true; pk.respawnAt = 0; }
    if (!first && this.state === 'play') {
      this.hud.toast('新しいマッチ開始', 'big');
      p.alive = false;
      p.deathTime = this.time - PLAYER.respawn + 0.3;
      this.spawnPending = true;
      document.getElementById('death').hidden = true;
    }
  }

  _setMatchState(st) {
    if (st === this.matchState) return;
    this.matchState = st;
    const ov = document.getElementById('roundend');
    if (st === 'end') {
      const rows = this._scoreRows();
      const w = rows[0];
      document.getElementById('reTitle').innerHTML = '';
      const t = document.getElementById('reTitle');
      if (w) {
        const s = document.createElement('span'); s.style.color = w.color; s.textContent = w.name;
        t.append(s, document.createTextNode(w.me ? ' の勝利 — あなたです' : ' の勝利'));
      } else t.textContent = 'マッチ終了';
      this.hud.fillTable(document.getElementById('rebody'), rows);
      ov.hidden = false;
      document.getElementById('death').hidden = true;
      this.sound.roundEnd();
    } else {
      ov.hidden = true;
    }
  }

  _scoreRows() {
    const rows = [];
    if (this.state === 'play') rows.push({ name: this.myName(), color: this.myColor(), k: this.kills, d: this.deaths, me: true, bot: false });
    for (const r of this.remotes.values()) if (r.inGame) rows.push({ name: r.name, color: r.color, k: r.k, d: r.d, me: false, bot: false });
    if (this.isHost) for (const b of this.bots) rows.push({ name: b.name, color: b.color, k: b.kills, d: b.deaths, me: false, bot: true });
    else for (const [id, a] of this.remoteBots) rows.push({ name: a.name, color: a.color, k: a.kills, d: a.deaths, me: false, bot: true });
    rows.sort((a, b) => b.k - a.k || a.d - b.d);
    return rows;
  }

  // ------------------------------------------------------------ death screen
  _showDeath(killerId, weaponId) {
    const el = document.getElementById('death');
    const by = document.getElementById('deathBy');
    by.textContent = '';
    if (killerId === this.myId) by.textContent = weaponId === 'fall' ? '転落しました' : '自分のグレネードに巻き込まれた';
    else {
      const [n, c] = this.entityName(killerId);
      const s = document.createElement('b'); s.style.color = c; s.textContent = n;
      const def = WEAPONS[weaponId];
      by.append(s, document.createTextNode(` に倒された（${def ? def.name : '—'}）`));
    }
    this._renderDeathLoadout();
    if (this.matchState === 'play') el.hidden = false;
  }

  _renderDeathLoadout() {
    const grid = document.getElementById('deathLoadout');
    grid.textContent = '';
    PRIMARIES.forEach((id, i) => {
      const d = WEAPONS[id];
      const b = document.createElement('button');
      b.className = 'wcard'; b.type = 'button';
      b.setAttribute('aria-pressed', String(this.settings.primary === id));
      b.innerHTML = `<span class="wk">${i + 1}</span><span class="wn"></span><span class="wc"></span>`;
      b.querySelector('.wn').textContent = d.name.split(' ')[0];
      b.querySelector('.wc').textContent = d.cls;
      b.addEventListener('click', () => this.chooseLoadout(id));
      grid.appendChild(b);
    });
  }

  chooseLoadout(id) {
    if (!PRIMARIES.includes(id)) return;
    this.settings.primary = id;
    this.onSettingsChanged && this.onSettingsChanged();
    this._renderDeathLoadout();
  }

  // ------------------------------------------------------------ pickups
  _updatePickups(dt) {
    const p = this.player;
    for (const pk of this.pickups) {
      if (!pk.available && this.time >= pk.respawnAt) pk.available = true;
      pk.mesh.visible = pk.available;
      pk.ring.visible = pk.available;
      if (!pk.available) continue;
      pk.mesh.rotation.y += dt * 1.4;
      pk.mesh.position.y = pk.y + 0.55 + Math.sin(this.time * 2 + pk.id) * 0.08;
      if (p.alive && this.state === 'play') {
        const d = Math.hypot(p.body.x - pk.x, p.body.z - pk.z);
        if (d < 1.0 && Math.abs(p.body.y - pk.y) < 1.4) {
          let used = false;
          if (pk.type === 'hp' && p.hp < PLAYER.maxHp) { p.hp = Math.min(PLAYER.maxHp, p.hp + 60); used = true; this.hud.toast('+60 HP', 'sm'); }
          if (pk.type === 'ammo' && p.weapons.some((w) => !w.melee && w.reserve < w.def.reserve)) { for (const w of p.weapons) w.refill(); used = true; this.hud.toast('弾薬補給', 'sm'); }
          if (pk.type === 'nade' && p.grenades < GRENADE.count) { p.grenades = GRENADE.count; used = true; this.hud.toast('グレネード補給', 'sm'); }
          if (used) { this.sound.pickup(); this.pushEvent({ t: 'pk', i: pk.id }); }
        }
      }
      if (this.isHost && pk.type === 'hp') {
        for (const b of this.bots) {
          if (!b.alive || b.hp >= 100) continue;
          if (Math.hypot(b.body.x - pk.x, b.body.z - pk.z) < 1.0 && Math.abs(b.body.y - pk.y) < 1.4) {
            b.hp = Math.min(100, b.hp + 60);
            this.pushEvent({ t: 'pk', i: pk.id });
            break;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ main loop
  _loop(t) {
    requestAnimationFrame(this._loop);
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.frameNo++;
    this.fpsN++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsT); this.fpsN = 0; this.fpsT = 0; }
    try {
      if (this.state === 'menu') this._menuFrame(dt);
      else this._playFrame(dt);
    } catch (err) {
      console.error(err);
    }
    this.map.update(this.time);
    this.effects.update(dt, this.camera);
    this._render();
  }

  _menuFrame(dt) {
    this.flyT += dt * 0.035;
    const a = this.flyT;
    const cam = this.camera;
    cam.position.set(Math.sin(a) * 58, 22 + Math.sin(a * 2.3) * 4, Math.cos(a) * 46 + 6);
    cam.lookAt(0, 3, 4);
    if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
    this._updatePickups(dt);
  }

  _playFrame(dt) {
    const p = this.player;
    const blockInput = this.paused || this.chatOpen || this.matchState === 'end' || !document.getElementById('roundend').hidden;
    const inp = this.input.frame();
    if (blockInput || !p.alive) {
      inp.moveX = inp.moveY = 0; inp.fire = inp.ads = inp.jumpPressed = inp.reload = inp.grenade = inp.melee = false;
      inp.sprint = false; inp.slot = -1; inp.wheel = 0;
      if (this.paused || this.chatOpen) { inp.lookX = inp.lookY = 0; }
    }
    this._syncNetwork();
    if (this.isHost) this._hostMatch();

    // local player
    if (p.alive) {
      p.update(dt, inp);
    } else {
      if (inp.lookX || inp.lookY) { /* free look while dead is disabled */ }
      // loadout keys during death
      const e = this.input;
      const elapsed = this.time - p.deathTime;
      const left = Math.max(0, PLAYER.respawn - elapsed);
      document.getElementById('respawnTxt').innerHTML = this.matchState === 'play' ? `<b>${left.toFixed(1)}</b> 秒後に出撃 · 1〜5キーで武器を選択` : '';
      const idReady = this.mode !== 'online' || this.myId !== 'me' || this.time - this.startTime > 3;
      if (elapsed >= PLAYER.respawn && this.matchRunning() && idReady) this._respawn();
    }
    if (!p.alive && this.state === 'play') {
      for (let i = 0; i < 5; i++) if (this.input.keys.has('Digit' + (i + 1))) this.chooseLoadout(PRIMARIES[i]);
    }

    // bots (host)
    if (this.isHost) {
      if (this.bots.length !== clamp(this.settings.botCount | 0, 0, 8)) this._ensureBots(null);
      for (const b of this.bots) b.update(dt);
    }
    // remote avatars
    const now = performance.now();
    const camPos = this.camera.position;
    for (const r of this.remotes.values()) {
      if (!r.inGame) { r.avatar.root.visible = false; r.avatar.tag.visible = false; continue; }
      r.avatar.sample(now);
      r.avatar.update(dt, camPos);
    }
    if (this.isHost) for (const b of this.bots) b.avatar.update(dt, camPos);
    else for (const a of this.remoteBots.values()) { a.sample(now); a.update(dt, camPos); }

    this._updateGrenades(dt);
    this._updatePickups(dt);
    this._updateCamera(dt);
    this._updateViewmodel(dt, inp);
    this._updateHud(dt, inp);
    this._sendPresence(false);
  }

  _respawn() {
    const p = this.player;
    if (p.loadout.primary !== this.settings.primary) p.setLoadout(this.settings.primary);
    const sp = this.pickSpawn(this.myId);
    this.input.resetToggles();
    p.spawn(sp);
    this.spawnPending = false;
    document.getElementById('death').hidden = true;
    this.sound.spawn();
    this._sendPresence(true);
  }

  _updateCamera(dt) {
    const p = this.player, b = p.body, cam = this.camera;
    if (p.alive) {
      const bobAmt = b.onGround ? clamp(p.speed / 5, 0, 1.4) * (1 - p.adsT * 0.85) : 0;
      const bob = Math.sin(p.bobPhase * 2) * 0.022 * bobAmt * this.settings.camBob;
      cam.position.set(b.x, b.y + p.eye + p.stepSmooth - (p.landKick || 0) + bob, b.z);
      const strafe = (b.vx * Math.cos(p.yaw) - b.vz * Math.sin(p.yaw));
      this._roll = damp(this._roll || 0, -strafe * 0.0035, 8, dt);
      cam.rotation.set(p.pitch + p.punchP, p.yaw + p.punchY, this._roll);
    } else {
      // death cam: rise and look at the killer
      const dp = p.deathPos || { x: b.x, y: b.y + 1.6, z: b.z };
      const k = clamp((this.time - p.deathTime) / 1.2, 0, 1);
      cam.position.set(dp.x, dp.y + k * 2.2, dp.z);
      const kp = p.killer && p.killer !== this.myId ? this.entityPos(p.killer) : null;
      if (kp) {
        _v1.set(kp.x, kp.y + 1.2, kp.z);
        const m = new THREE.Matrix4().lookAt(cam.position, _v1, cam.up);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        cam.quaternion.slerp(q, 1 - Math.exp(-4 * dt));
      } else {
        cam.rotation.x = damp(cam.rotation.x, -0.5, 2, dt);
      }
    }
    // shake
    const sh = this.effects.shake;
    if (sh > 0) {
      cam.position.x += (Math.random() - 0.5) * sh * 0.12;
      cam.position.y += (Math.random() - 0.5) * sh * 0.12;
      cam.rotation.z += (Math.random() - 0.5) * sh * 0.02;
    }
    // FOV
    const base = this.settings.fov;
    const def = p.def;
    let target = base;
    if (p.alive) {
      if (p.sprint) target = base + 6;
      const adsFov = (def.adsFov || base) * (base / 75);
      target = lerp(target, Math.min(target, adsFov), p.adsT * p.adsT * (3 - 2 * p.adsT));
    }
    const nf = damp(cam.fov, target, 18, dt);
    if (Math.abs(nf - cam.fov) > 0.01) { cam.fov = nf; cam.updateProjectionMatrix(); }
    this.zoomRatio = cam.fov / base;
    // particles scale with projection
    this.effects.setScale((this.renderer.domElement.height * 0.5) / Math.tan((cam.fov * Math.PI) / 360));
    // audio listener
    cam.getWorldDirection(_v2);
    this.sound.updateListener(cam.position, _v2);
  }

  _updateViewmodel(dt, inp) {
    const p = this.player;
    const w = p.weapon;
    const vm = this.viewmodel;
    vm.camera.fov = lerp(64, 48, p.adsT);
    vm.camera.updateProjectionMatrix();
    vm.update(dt, {
      adsT: p.adsT,
      sprint: p.sprint,
      speed: p.speed,
      bobPhase: p.bobPhase,
      bobScale: 0.3 + 0.7 * this.settings.camBob,
      onGround: p.body.onGround,
      crouchT: p.crouchT,
      lookX: 0, lookDX: inp.lookX, lookDY: inp.lookY,
      reloading: w.reloading,
      reloadFrac: w.reloadFrac,
      shellReload: !!w.def.shellReload,
      actionT: w.actionT,
      actionDur: w.interval,
      ammo: w.ammo,
      scoped: !!w.def.scope && p.adsT > 0.92,
    }, this.camera);
  }

  _updateHud(dt, inp) {
    const p = this.player;
    const w = p.weapon;
    const cam = this.camera;
    const spread = w.def.melee ? 0.02 : w.def.pellets > 1 ? lerp(w.def.pelletSpread, w.def.pelletSpreadAds, p.adsT) : w.spread(p.adsT, p.speed, p.body.onGround, p.crouch);
    const spreadPx = (Math.tan(spread) / Math.tan((cam.fov * Math.PI) / 360)) * (innerHeight / 2);
    const now = performance.now();
    const left = this.matchState === 'play' ? this.matchEnd - now : this.interEnd - now;
    const rows = this._scoreRows();
    const leader = rows[0];
    let leadText = '';
    if (leader) {
      const myRank = rows.findIndex((r) => r.me) + 1;
      const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      leadText = this.matchState === 'end' ? '次のマッチまで' : `首位 <b>${esc(leader.name)}</b> ${leader.k}キル · 目標${MATCH.killLimit}`;
      this._rankText = `${myRank}位 / ${rows.length}人`;
    }
    this.hud.update(dt, {
      hp: p.alive ? p.hp : 0,
      weapon: w,
      slot: p.cur,
      grenades: p.grenades,
      spreadPx,
      adsT: p.alive ? p.adsT : 1,
      scoped: p.alive && !!w.def.scope && p.adsT > 0.92,
      yaw: p.yaw,
      protected: p.alive && p.spawnProtected,
      timer: fmtTime(left),
      leadText,
      kills: this.kills, deaths: this.deaths,
      rankText: this._rankText || '—',
      chatOpen: this.chatOpen,
    });
    this.hud.scoreboard(inp.score && !this.chatOpen, rows, this.mode === 'online' ? `ルーム ${this.roomName} · ${rows.filter((r) => !r.bot).length}人 + Bot ${rows.filter((r) => r.bot).length}` : 'オフライン練習');
    // minimap blips: enemies that fired recently
    const blips = [];
    for (const [id, t0] of this.blips) {
      const age = this.time - t0;
      if (age > 1.6) { this.blips.delete(id); continue; }
      const pos = this.entityPos(id);
      if (pos && id !== this.myId) blips.push({ x: pos.x, z: pos.z, a: 1 - age / 1.6 });
    }
    const me = p.alive ? p.body : (p.deathPos || p.body);
    this.hud.drawMinimap(me, p.yaw, blips, this.pickups);
    const fpsEl = document.getElementById('fps');
    fpsEl.hidden = !this.settings.showFps;
    if (this.settings.showFps) fpsEl.textContent = `${this.fps || 0} FPS`;
    // net pill
    const online = this.mode === 'online';
    const peers = [...this.remotes.values()].filter((r) => r.inGame).length;
    const txt = online ? `${this.roomName} · ${peers + 1}人${this.isHost ? ' · ホスト' : ''}` : 'オフライン';
    if (txt !== this._netTxt) {
      this._netTxt = txt;
      document.getElementById('nettext').textContent = txt;
      document.getElementById('netdot').className = 'dot ' + (online ? 'ok' : 'warn');
    }
  }

  _render() {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.state === 'play' && this.player.alive) this.viewmodel.render(r);
  }
}

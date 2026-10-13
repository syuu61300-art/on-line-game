// Host-simulated AI soldiers.
import { PLAYER, WEAPONS, BOT_NAMES, COLORS, DIFFICULTY, GRENADE, FORCED_RECOIL } from './config.js';
import { WeaponState } from './weapons.js';
import { Avatar } from './avatar.js';
import { clamp, rand, pick, wrapAngle, yawTo, dirFromYawPitch } from './util.js';

const PREF_DIST = { ar: 20, smg: 10, sg: 5, sr: 38, lmg: 24, pistol: 12 };
const MAX_ENGAGE = { ar: 80, smg: 45, sg: 20, sr: 140, lmg: 85, pistol: 40 };
const LOADOUTS = ['ar', 'smg', 'ar', 'sg', 'lmg', 'smg', 'sr', 'ar'];

export function botId(i) { return 'B#' + i; }
export function isBotId(id) { return typeof id === 'string' && id.startsWith('B#'); }
export function botName(i) { return BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? ' ' + (Math.floor(i / BOT_NAMES.length) + 1) : ''); }
export function botColor(i) { return COLORS[(i * 5 + 3) % COLORS.length]; }

export class Bot {
  constructor(game, index, difficulty) {
    this.game = game;
    this.index = index;
    this.id = botId(index);
    this.name = botName(index);
    this.color = botColor(index);
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: PLAYER.radius, h: PLAYER.height, onGround: false, stepped: 0 };
    this.yaw = 0; this.pitch = 0;
    this.hp = 100;
    this.alive = false;
    this.respawnT = rand(0.2, 1.5);
    this.kills = 0; this.deaths = 0;
    this.primary = LOADOUTS[index % LOADOUTS.length];
    this.weapon = new WeaponState(this.primary, true);
    this.avatar = new Avatar(game, this.id, this.name, this.color, true);
    this.avatar.setWeapon(this.primary);
    this.crouch = false;
    this.spawnTime = -10;
    this.lastDamage = -10;
    this.lastAttacker = null;
    this._dir = { x: 0, y: 0, z: 0 };
    this.reset();
  }

  reset() {
    this.target = null; this.targetId = null;
    this.lastSeen = null;
    this.reactT = 0; this.trackT = 0;
    this.path = null; this.pathI = 0; this.goal = null;
    this.thinkT = 0;
    this.strafe = 1; this.strafeT = 0;
    this.burst = 0; this.pauseT = 0;
    this.errX = 0; this.errY = 0;
    this.crouchT = 0;
    this.stuckT = 0;
    this.investigate = null;
    this.nade = 1;
    this.aimHead = false;
    this.repathT = 0;
    this.meleeCd = 0;
    this.recP = 0; this.recY = 0;
  }

  // same recoil a player gets (weapon pattern + forced share)
  applyRecoil(def) {
    const k = def.recoil || { v: 0, h: 0 };
    const F = FORCED_RECOIL;
    this.recP += k.v * (0.85 + Math.random() * 0.3) + F.v * (0.9 + Math.random() * 0.2);
    this.recY += k.h * (Math.random() * 2 - 1) + F.h * (Math.random() * 2 - 1);
  }

  setDifficulty(d) { this.diff = DIFFICULTY[d] || DIFFICULTY.normal; }

  get spawnProtected() { return this.game.time - this.spawnTime < PLAYER.spawnProtect; }
  get pos() { return this.body; }

  spawn(sp) {
    const b = this.body;
    b.x = sp.x; b.y = sp.y + 0.05; b.z = sp.z; b.vx = b.vy = b.vz = 0;
    this.yaw = sp.yaw; this.pitch = 0;
    this.hp = 100;
    this.alive = true;
    this.spawnTime = this.game.time;
    // occasionally change loadout between lives
    if (Math.random() < 0.3) {
      this.primary = pick(LOADOUTS);
      this.weapon = new WeaponState(this.primary, true);
    } else this.weapon.reset();
    this.reset();
  }

  flags() {
    let f = 0;
    if (this.alive) f |= 1;
    if (this.crouch) f |= 2;
    if (this.weapon.reloading) f |= 8;
    if (this.body.onGround) f |= 32;
    if (this.spawnProtected) f |= 64;
    return f;
  }

  eye() { return this.body.y + (this.crouch ? 1.05 : 1.6); }

  // ---- damage (host side) ----
  applyDamage(dmg, attackerId, weapon, zone, src) {
    if (!this.alive || this.spawnProtected) return false;
    this.hp -= dmg;
    this.lastDamage = this.game.time;
    this.lastAttacker = attackerId;
    // turn toward the threat
    if (src && !this.target) {
      this.investigate = { x: src.x, y: src.y, z: src.z };
      this.goal = null;
    }
    if (this.hp <= 0) {
      this.alive = false;
      this.deaths++;
      this.respawnT = PLAYER.respawn;
      return true;
    }
    return false;
  }

  hearNoise(x, y, z, sourceId) {
    if (!this.alive || this.target || sourceId === this.id) return;
    const d = Math.hypot(x - this.body.x, z - this.body.z);
    if (d < 38 && Math.random() < 0.7) {
      this.investigate = { x, y, z };
      this.goal = null; this.path = null;
    }
  }

  update(dt) {
    const g = this.game;
    const b = this.body;
    this.weapon.update(dt);
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    // recoil is pulled back down over time, faster on harder difficulties
    const rc = Math.exp(-dt * (this.diff.recoilComp || 6));
    this.recP *= rc; this.recY *= rc;
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0 && g.matchRunning()) this.spawn(g.pickSpawn(this.id));
      this.avatar.setDirect(b.x, b.y, b.z, this.yaw, this.pitch, this.flags(), this.weapon.id);
      return;
    }
    // regen like players
    if (this.hp < 100 && g.time - this.lastDamage > PLAYER.regenDelay) this.hp = Math.min(100, this.hp + PLAYER.regenRate * dt);

    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = rand(0.12, 0.2); this._think(); }

    // ---- aim & shoot ----
    let wantX = 0, wantZ = 0, speed = PLAYER.walk;
    const t = this.target;
    const D = this.diff;
    if (t && t.alive && this.targetVisible) {
      this.trackT += dt;
      this.reactT -= dt;
      const tp = t.pos;
      const aimY = tp.y + (t.crouch ? (this.aimHead ? 1.12 : 0.75) : (this.aimHead ? 1.63 : 1.15));
      const ex = b.x, ey = this.eye(), ez = b.z;
      const dx = tp.x - ex, dy = aimY - ey, dz = tp.z - ez;
      const dist = Math.hypot(dx, dz);
      // aim error random walk shrinks while tracking
      const errMag = D.aimErr * clamp(1.7 - this.trackT * 0.7, 0.45, 1.7) * (1 + dist / 70);
      this.errX += (Math.random() - 0.5) * errMag * dt * 10 - this.errX * dt * 2.5;
      this.errY += (Math.random() - 0.5) * errMag * dt * 6 - this.errY * dt * 2.5;
      this.errX = clamp(this.errX, -errMag, errMag); this.errY = clamp(this.errY, -errMag, errMag);
      const wantYaw = yawTo(dx, dz) + this.errX;
      const wantPitch = Math.atan2(dy, dist) + this.errY;
      const dyaw = wrapAngle(wantYaw - this.yaw);
      const maxTurn = D.turn * dt;
      this.yaw = wrapAngle(this.yaw + clamp(dyaw, -maxTurn, maxTurn) * (Math.abs(dyaw) < 0.3 ? 0.6 : 1));
      this.pitch += clamp(wantPitch - this.pitch, -maxTurn, maxTurn) * 0.7;
      const err = Math.abs(wrapAngle(yawTo(dx, dz) - this.yaw)) + Math.abs(Math.atan2(dy, dist) - this.pitch);
      const w = this.weapon;
      const range = MAX_ENGAGE[w.id] || 60;
      this.pauseT -= dt;
      if (dist < 2.2 && this.meleeCd <= 0) {
        this.meleeCd = 0.7;
        g.botMelee(this, t);
      } else if (this.reactT <= 0 && err < 0.16 + 1.2 / Math.max(4, dist) && dist < range && this.pauseT <= 0) {
        if (w.ammo <= 0) { w.startReload(); }
        else if (w.canFire()) {
          w.fire();
          g.botFire(this, w);
          if (w.def.auto) {
            this.burst--;
            if (this.burst <= 0) { this.burst = Math.round(rand(D.burst[0], D.burst[1])); this.pauseT = rand(D.pause[0], D.pause[1]); this.aimHead = Math.random() < D.hsChance; }
          } else {
            this.pauseT = rand(0.05, 0.25) + (w.id === 'sr' ? 0.4 : 0);
            this.aimHead = Math.random() < D.hsChance * (w.id === 'sr' ? 1.6 : 1);
          }
        }
      }
      // movement while fighting: strafe + keep preferred distance
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = rand(0.35, 1.3); if (Math.random() < 0.15 && w.id !== 'sg') this.crouchT = rand(0.6, 1.6); }
      const pref = PREF_DIST[w.id] || 18;
      const nx = dx / Math.max(0.01, dist), nz = dz / Math.max(0.01, dist);
      let fwd = dist > pref + 6 ? 1 : dist < pref - 4 ? -0.8 : 0;
      if (this.hp < 35 && w.id !== 'sg') fwd = Math.min(fwd, -0.6);
      wantX = nx * fwd + -nz * this.strafe * 0.9;
      wantZ = nz * fwd + nx * this.strafe * 0.9;
      speed = PLAYER.walk * (WEAPONS[w.id].moveMul || 1) * 0.85;
      if (w.ammo === 0) w.startReload();
    } else {
      this.trackT = 0;
      this.burst = 0;
      // follow path
      const p = this.path;
      if (p && this.pathI < p.length) {
        let n = p[this.pathI];
        const dx = n.x - b.x, dz = n.z - b.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.55 || (d < 1.2 && this.pathI < p.length - 1 && Math.abs(n.y - b.y) < 0.7)) {
          this.pathI++;
          if (this.pathI >= p.length) { this.path = null; this.goal = null; this.investigate = null; }
        }
        if (this.path) {
          n = p[Math.min(this.pathI, p.length - 1)];
          const ddx = n.x - b.x, ddz = n.z - b.z, dd = Math.hypot(ddx, ddz) || 1;
          wantX = ddx / dd; wantZ = ddz / dd;
          if (Math.abs(n.y - b.y) > 2.2 && n.y > b.y) this.path = null; // fell off
        }
      }
      speed = this.lastSeen && g.time - this.lastSeen.t < 6 ? PLAYER.walk : PLAYER.walk * 0.92;
      if (!this.lastSeen && !this.investigate && this.hp > 60 && Math.random() < 0.002) this.sprinting = true;
      if (this.sprinting) speed = PLAYER.sprint * 0.9;
      if (Math.random() < 0.004) this.sprinting = false;
      // face movement direction
      if (wantX || wantZ) {
        const wy = yawTo(wantX, wantZ);
        this.yaw = wrapAngle(this.yaw + clamp(wrapAngle(wy - this.yaw), -4 * dt, 4 * dt));
      }
      this.pitch *= 1 - dt * 3;
      if (!this.weapon.reloading && this.weapon.ammo < this.weapon.def.mag * 0.4) this.weapon.startReload();
    }

    // crouch timer
    this.crouchT -= dt;
    const wantCrouch = this.crouchT > 0;
    if (wantCrouch !== this.crouch) {
      if (wantCrouch) { this.crouch = true; b.h = PLAYER.crouchHeight; }
      else if (!g.world.blocked(b.x - b.r + 0.01, b.y + 0.05, b.z - b.r + 0.01, b.x + b.r - 0.01, b.y + PLAYER.height, b.z + b.r - 0.01)) { this.crouch = false; b.h = PLAYER.height; }
    }
    if (this.crouch) speed = PLAYER.crouchSpeed;

    // ---- physics ----
    const wl = Math.hypot(wantX, wantZ);
    if (wl > 1) { wantX /= wl; wantZ /= wl; }
    const tvx = wantX * speed, tvz = wantZ * speed;
    if (b.onGround) {
      const a = PLAYER.accel * dt;
      let dx = tvx - b.vx, dz = tvz - b.vz;
      const dl = Math.hypot(dx, dz);
      if (dl > a) { dx *= a / dl; dz *= a / dl; }
      b.vx += dx; b.vz += dz;
    }
    b.vy -= PLAYER.gravity * dt;
    g.world.moveBody(b, dt);
    if (b.y < -8) { this.applyDamage(999, this.id, 'fall', 0, null); g.botDied(this, this.id, 'fall', 0); }

    // stuck → hop / repath
    const hs = Math.hypot(b.vx, b.vz);
    if (wl > 0.3 && hs < 0.6) {
      this.stuckT += dt;
      if (this.stuckT > 0.5 && b.onGround) { b.vy = PLAYER.jump; b.onGround = false; }
      if (this.stuckT > 1.4) { this.path = null; this.goal = null; this.stuckT = 0; this.strafe *= -1; }
    } else this.stuckT = 0;

    this.avatar.setDirect(b.x, b.y, b.z, this.yaw + this.recY, this.pitch + this.recP, this.flags(), this.weapon.id);
  }

  _think() {
    const g = this.game;
    const b = this.body;
    const D = this.diff;
    const ex = b.x, ey = this.eye(), ez = b.z;
    // ---- perception ----
    let best = null, bestScore = Infinity;
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    for (const c of g.combatants()) {
      if (c.id === this.id || !c.alive) continue;
      const dx = c.pos.x - ex, dz = c.pos.z - ez;
      const dist = Math.hypot(dx, dz);
      if (dist > 95) continue;
      const cosA = (dx * fwdX + dz * fwdZ) / Math.max(0.01, dist);
      const inFov = cosA > Math.cos(D.fov) || dist < 5 || (this.lastAttacker === c.id && g.time - this.lastDamage < 3) || c.id === this.targetId;
      if (!inFov) continue;
      const cy = c.pos.y + (c.crouch ? 0.8 : 1.25);
      const vis = g.world.los(ex, ey, ez, c.pos.x, cy, c.pos.z) || g.world.los(ex, ey, ez, c.pos.x, c.pos.y + (c.crouch ? 1.15 : 1.65), c.pos.z);
      if (!vis) continue;
      // recently-firing targets are noticed faster at range
      const score = dist - (c.id === this.targetId ? 12 : 0) - (this.lastAttacker === c.id ? 10 : 0);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (best) {
      if (best.id !== this.targetId) {
        this.reactT = rand(D.react[0], D.react[1]) * (Math.hypot(best.pos.x - ex, best.pos.z - ez) > 40 ? 1.3 : 1);
        this.burst = Math.round(rand(D.burst[0], D.burst[1]));
        this.trackT = 0;
      }
      this.target = best; this.targetId = best.id;
      this.targetVisible = true;
      this.lastSeen = { x: best.pos.x, y: best.pos.y, z: best.pos.z, t: g.time };
      this.path = null; this.goal = null;
      return;
    }
    this.targetVisible = false;
    if (this.target && (!this.target.alive || g.time - (this.lastSeen ? this.lastSeen.t : 0) > 6)) { this.target = null; this.targetId = null; }

    // grenade at last-known position behind cover
    if (this.lastSeen && this.nade > 0 && g.time - this.lastSeen.t < 2.5) {
      const d = Math.hypot(this.lastSeen.x - b.x, this.lastSeen.z - b.z);
      if (d > 9 && d < 26 && Math.random() < 0.08) {
        this.nade--;
        g.botThrowGrenade(this, this.lastSeen);
      }
    }

    // ---- navigation goal ----
    this.repathT -= 0.15;
    if (!this.path || this.repathT <= 0) {
      let goal = null;
      if (this.lastSeen && g.time - this.lastSeen.t < 6) goal = this.lastSeen;
      else if (this.investigate) goal = this.investigate;
      else if (this.hp < 55) {
        const hp = g.nearestPickup('hp', b);
        if (hp && Math.hypot(hp.x - b.x, hp.z - b.z) < 35) goal = hp;
      }
      if (goal) {
        this._pathTo(goal.x, goal.y, goal.z);
      } else if (!this.path) {
        // roam to a random node, biased toward the middle & enemies
        const n = g.nav.randomNode();
        if (n) this._pathTo(n.x, n.y, n.z);
      }
      this.repathT = this.path ? 2.5 : 0.6;
    }
  }

  _pathTo(x, y, z) {
    const nav = this.game.nav;
    const s = nav.nearest(this.body.x, this.body.y, this.body.z);
    const e = nav.nearest(x, y, z);
    const p = nav.path(s, e);
    if (p && p.length) {
      this.path = p;
      this.pathI = Math.min(1, p.length - 1);
      this.goal = { x, y, z };
    } else {
      this.path = null;
      this.investigate = null;
    }
  }

  aimDir(out) {
    return dirFromYawPitch(this.yaw + this.recY, this.pitch + this.recP, out);
  }

  dispose() { this.avatar.dispose(); }
}

export { GRENADE };

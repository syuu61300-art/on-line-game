// Local player: input → movement physics, weapon actions, camera state.
import { PLAYER, WEAPONS, GRENADE, FORCED_RECOIL } from './config.js';
import { WeaponState } from './weapons.js';
import { clamp, damp, wrapAngle } from './util.js';

const METAL = new Set(['container', 'tread', 'dark', 'paint', 'roof', 'siding', 'hazard']);

export class LocalPlayer {
  constructor(game) {
    this.game = game;
    this.body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: PLAYER.radius, h: PLAYER.height, onGround: false, stepped: 0 };
    this.yaw = 0; this.pitch = 0;
    this.punchP = 0; this.punchY = 0;
    this.hp = PLAYER.maxHp;
    this.alive = false;
    this.crouch = false; this.crouchT = 0;
    this.sprint = false;
    this.adsT = 0;
    this.eye = PLAYER.eye;
    this.stepSmooth = 0;
    this.bobPhase = 0;
    this.stepDist = 0;
    this.speed = 0;
    this.loadout = { primary: 'ar', secondary: 'pistol' };
    this.weapons = [];
    this.cur = 0;
    this.switchT = 0;
    this.grenades = GRENADE.count;
    this.lastDamage = -100;
    this.spawnTime = -100;
    this.deathTime = -100;
    this.killer = null;
    this.meleeT = 0; this.meleePending = null;
    this.throwT = 0;
    this.airTime = 0;
    this.fallV = 0;
    this.triggerLatch = false;
    this.streak = 0;
    this.lastKillTime = -100;
    this.multi = 0;
    this.setLoadout('ar');
  }

  setLoadout(primary) {
    this.loadout.primary = primary;
    this.weapons = [new WeaponState(primary), new WeaponState('pistol'), new WeaponState('knife')];
    this.cur = 0;
  }

  get weapon() { return this.weapons[this.cur]; }
  get def() { return this.weapons[this.cur].def; }
  get spawnProtected() { return this.game.time - this.spawnTime < PLAYER.spawnProtect; }

  spawn(sp) {
    const b = this.body;
    b.x = sp.x; b.y = sp.y + 0.05; b.z = sp.z;
    b.vx = b.vy = b.vz = 0;
    b.h = PLAYER.height;
    b.onGround = false;
    this.yaw = sp.yaw; this.pitch = 0;
    this.punchP = this.punchY = 0;
    this.hp = PLAYER.maxHp;
    this.alive = true;
    this.crouch = false; this.crouchT = 0;
    this.adsT = 0;
    this.grenades = GRENADE.count;
    for (const w of this.weapons) w.reset();
    this.cur = 0;
    this.spawnTime = this.game.time;
    this.lastDamage = -100;
    this.streak = 0;
    this.multi = 0;
    this.game.viewmodel.setWeapon(this.def.id, this.def.draw);
  }

  switchTo(i) {
    if (i === this.cur || i < 0 || i >= this.weapons.length || this.throwT > 0) return;
    this.weapon.cancelReload();
    this.game.input.adsLatch = false;
    this.cur = i;
    this.switchT = this.def.draw;
    this.game.viewmodel.setWeapon(this.def.id, this.def.draw);
    this.game.sound.swap();
  }

  update(dt, input) {
    const g = this.game;
    const b = this.body;
    const sens = g.settings.sens * 0.0022 * (1 - this.adsT * (1 - g.settings.adsSens * g.zoomRatio));
    // ---- look ----
    this.yaw = wrapAngle(this.yaw - input.lookX * sens);
    this.pitch = clamp(this.pitch - input.lookY * sens * (g.settings.invertY ? -1 : 1), -1.52, 1.52);
    this.punchP = damp(this.punchP, 0, 9, dt);
    this.punchY = damp(this.punchY, 0, 9, dt);

    const w = this.weapon;
    const def = w.def;

    // ---- crouch ----
    const wantCrouch = input.crouch;
    if (wantCrouch && !this.crouch) { this.crouch = true; b.h = PLAYER.crouchHeight; }
    else if (!wantCrouch && this.crouch) {
      if (!g.world.blocked(b.x - b.r + 0.01, b.y + 0.05, b.z - b.r + 0.01, b.x + b.r - 0.01, b.y + PLAYER.height, b.z + b.r - 0.01)) {
        this.crouch = false; b.h = PLAYER.height;
      }
    }
    this.crouchT = damp(this.crouchT, this.crouch ? 1 : 0, 12, dt);

    // ---- movement ----
    const mx = input.moveX, mz = input.moveY;
    const ml = Math.hypot(mx, mz);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    let wx = 0, wz = 0;
    if (ml > 0.01) {
      const nx = mx / Math.max(1, ml), nz = mz / Math.max(1, ml);
      wx = -sin * nz + cos * nx;
      wz = -cos * nz - sin * nx;
    }
    const firing = w.sinceShot < 0.25 || this.meleeT > 0;
    this.sprint = input.sprint && mz > 0.5 && !this.crouch && this.adsT < 0.3 && !firing && this.throwT <= 0 && b.onGround;
    if (this.sprint && w.reloading && !def.shellReload) { /* allowed */ }
    let speed = this.sprint ? PLAYER.sprint : this.crouch ? PLAYER.crouchSpeed : PLAYER.walk;
    speed = speed + (PLAYER.adsSpeed - speed) * this.adsT * (this.crouch ? 0 : 1);
    speed *= def.moveMul || 1;
    const tvx = wx * speed, tvz = wz * speed;
    if (b.onGround) {
      const a = PLAYER.accel * dt;
      let dx = tvx - b.vx, dz = tvz - b.vz;
      const dl = Math.hypot(dx, dz);
      if (dl > a) { dx *= a / dl; dz *= a / dl; }
      b.vx += dx; b.vz += dz;
      if (input.jumpPressed) {
        if (this.crouch) {
          if (!g.world.blocked(b.x - b.r + 0.01, b.y + 0.05, b.z - b.r + 0.01, b.x + b.r - 0.01, b.y + PLAYER.height, b.z + b.r - 0.01)) {
            this.crouch = false; b.h = PLAYER.height;
          }
        } else {
          b.vy = PLAYER.jump;
          b.onGround = false;
          g.sound.jump();
        }
      }
    } else {
      // air control
      const a = PLAYER.airAccel * dt;
      const along = b.vx * wx + b.vz * wz;
      if (along < speed) { b.vx += wx * a; b.vz += wz * a; }
      const hs = Math.hypot(b.vx, b.vz);
      const cap = Math.max(speed, PLAYER.sprint) * 1.05;
      if (hs > cap) { b.vx *= cap / hs; b.vz *= cap / hs; }
    }
    b.vy -= PLAYER.gravity * dt;
    if (b.vy < -40) b.vy = -40;
    const wasGround = b.onGround;
    const preVy = b.vy;
    g.world.moveBody(b, dt);
    if (b.stepped) this.stepSmooth -= b.stepped;
    this.stepSmooth = damp(this.stepSmooth, 0, 14, dt);
    if (!wasGround && b.onGround) {
      const v = -preVy;
      if (v > 4) {
        g.sound.land(this._metalUnder());
        g.viewmodel.land(v);
        this.landKick = Math.min(0.12, v * 0.008);
      }
      if (v > 17) {
        const dmg = Math.round((v - 17) * 9);
        g.damageLocal(dmg, g.myId, 'fall', 0, null);
      }
    }
    this.landKick = damp(this.landKick || 0, 0, 8, dt);
    if (b.y < -8) g.damageLocal(500, g.myId, 'fall', 0, null);

    this.speed = Math.hypot(b.vx, b.vz);
    // footsteps & bob
    if (b.onGround && this.speed > 0.6) {
      this.bobPhase += dt * this.speed * (this.sprint ? 1.25 : 1.5);
      this.stepDist += this.speed * dt;
      const stride = this.sprint ? 2.0 : 1.55;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        if (!this.crouch) g.sound.step(null, this._metalUnder(), this.sprint ? 0.32 : 0.22);
      }
    }

    // ---- eye ----
    const eyeT = PLAYER.eye + (PLAYER.crouchEye - PLAYER.eye) * this.crouchT;
    this.eye = eyeT;

    // ---- weapon ----
    this.switchT = Math.max(0, this.switchT - dt);
    const ev = w.update(dt);
    if (ev === 'shell') g.sound.shell();
    if (ev === 'done' && def.shellReload) g.sound.pump(0.05);
    for (const other of this.weapons) if (other !== w) other.update(dt);

    // weapon selection
    if (input.slot >= 0) this.switchTo(input.slot);
    if (input.wheel) this.switchTo((this.cur + (input.wheel > 0 ? 1 : 2)) % 3);

    // ADS
    const canAds = !def.melee && this.switchT <= 0 && !this.sprint && this.throwT <= 0 && !(w.reloading && !def.shellReload) && this.meleeT <= 0;
    const adsTarget = input.ads && canAds ? 1 : 0;
    const adsRate = 1 / (def.adsTime || 0.2);
    this.adsT = adsTarget ? Math.min(1, this.adsT + dt * adsRate) : Math.max(0, this.adsT - dt * adsRate * 1.4);
    // sniper unscopes while cycling the bolt
    if (def.bolt && w.actionT > w.interval * 0.15) this.adsT = Math.min(this.adsT, 0.55);

    // reload
    if (input.reload && !def.melee && this.throwT <= 0) {
      if (w.startReload()) g.sound.reload(def, w.reloadDur);
    }
    // auto reload when empty and trigger released
    if (!def.melee && w.ammo === 0 && !w.reloading && w.reserve > 0 && !input.fire && w.cooldown <= 0) {
      if (w.startReload()) g.sound.reload(def, w.reloadDur);
    }

    // melee (V) / knife
    if (this.meleeT > 0) {
      this.meleeT -= dt;
      if (this.meleePending && this.meleeT <= this.meleePending.at) {
        g.doMelee(this.meleePending.kind);
        this.meleePending = null;
      }
    }
    if (input.melee && this.meleeT <= 0 && this.throwT <= 0) this.startMelee(def.melee ? 'knife' : 'bash');

    // grenade
    if (this.throwT > 0) {
      this.throwT -= dt;
      if (this.throwPending && this.throwT <= 0.3) { this.throwPending = false; g.throwLocalGrenade(); }
    }
    if (input.grenade && this.grenades > 0 && this.throwT <= 0 && this.meleeT <= 0) {
      this.grenades--;
      this.throwT = 0.55;
      this.throwPending = true;
      w.cancelReload();
      g.viewmodel.throwNade();
      g.sound.pin();
    }

    // fire
    const canShoot = this.switchT <= 0 && this.throwT <= 0 && this.meleeT <= 0 && !this.sprintBlock;
    if (input.fire && canShoot) {
      if (def.melee) {
        if (w.canFire()) { w.fire(); this.startMelee('knife', true); }
      } else if (def.auto || !this.triggerLatch) {
        if (w.canFire()) {
          if (this.sprint) this.sprint = false;
          g.input.sprintLatch = false;
          w.fire();
          g.localFire(this, w);
          this.triggerLatch = true;
          if (def.pump) g.sound.pump(0.22);
          if (def.bolt) g.sound.bolt(0.2);
        } else if (w.ammo === 0 && !this.triggerLatch && !w.reloading) {
          g.sound.empty();
          this.triggerLatch = true;
          if (w.reserve > 0 && w.startReload()) g.sound.reload(def, w.reloadDur);
        }
      }
    }
    if (!input.fire) this.triggerLatch = false;

    // regen
    if (this.hp < PLAYER.maxHp && g.time - this.lastDamage > PLAYER.regenDelay) {
      this.hp = Math.min(PLAYER.maxHp, this.hp + PLAYER.regenRate * dt);
    }
  }

  startMelee(kind, fromKnife = false) {
    if (!fromKnife && this.weapon.def.melee) { this.weapon.fire(); }
    this.meleeT = kind === 'knife' ? 0.42 : 0.5;
    this.meleePending = { kind, at: this.meleeT - 0.12 };
    this.weapon.cancelReload();
    this.adsT = 0;
    this.game.viewmodel.melee(kind);
    this.game.sound.swing();
  }

  applyRecoil(def) {
    const k = def.recoil;
    const w = this.weapon;
    let mul = 1 - this.adsT * 0.25;
    if (this.crouch) mul *= 0.85;
    const v = k.v * (0.85 + Math.random() * 0.3) * mul;
    const bias = Math.sin(w.shotIndex * 0.45) * 0.6;
    const h = k.h * ((Math.random() * 2 - 1) + bias) * mul;
    // forced share: same for everyone, not reduced by ADS or crouching, no setting
    const F = FORCED_RECOIL;
    const fv = F.v * (0.9 + Math.random() * 0.2);
    const fh = F.h * (Math.random() * 2 - 1);
    this.pitch = clamp(this.pitch + v * (1 - k.punch) + fv * (1 - F.punch), -1.52, 1.52);
    this.yaw = wrapAngle(this.yaw + h * (1 - k.punch) + fh * (1 - F.punch));
    this.punchP += v * k.punch + fv * F.punch;
    this.punchY += h * k.punch + fh * F.punch;
  }

  _metalUnder() {
    const b = this.body;
    const arr = this.game.world.query(b.x - 0.1, b.y - 0.1, b.z - 0.1, b.x + 0.1, b.y + 0.01, b.z + 0.1, []);
    for (const o of arr) if (Math.abs(o.maxy - b.y) < 0.05 && METAL.has(o.mat)) return true;
    return false;
  }

  flags() {
    let f = 0;
    if (this.alive) f |= 1;
    if (this.crouch) f |= 2;
    if (this.adsT > 0.5) f |= 4;
    if (this.weapon.reloading) f |= 8;
    if (this.sprint) f |= 16;
    if (this.body.onGround) f |= 32;
    if (this.spawnProtected) f |= 64;
    return f;
  }
}

export { WEAPONS };

import { WEAPONS } from './config.js';

export class WeaponState {
  constructor(id, infiniteReserve = false) {
    this.id = id;
    this.def = WEAPONS[id];
    this.infinite = infiniteReserve;
    this.reset();
  }
  reset() {
    const d = this.def;
    this.ammo = d.mag || 0;
    this.reserve = this.infinite ? Infinity : d.reserve || 0;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.nextShell = 0;
    this.bloom = 0;
    this.shotIndex = 0;
    this.sinceShot = 10;
    this.actionT = 0; // pump / bolt animation timer
  }
  get melee() { return !!this.def.melee; }
  get interval() { return this.def.melee ? this.def.swing : 60 / this.def.rpm; }

  canFire() {
    if (this.melee) return this.cooldown <= 0;
    if (this.cooldown > 0 || this.ammo <= 0) return false;
    if (this.reloading && !this.def.shellReload) return false;
    return true;
  }

  fire() {
    const d = this.def;
    if (this.reloading && d.shellReload) this.reloading = false;
    if (!this.melee) this.ammo--;
    this.cooldown = this.interval;
    this.shotIndex++;
    this.sinceShot = 0;
    if (!this.melee) this.bloom = Math.min(d.spread.bloomMax, this.bloom + d.spread.bloom);
    if (d.pump || d.bolt) this.actionT = this.interval;
  }

  startReload() {
    const d = this.def;
    if (this.melee || this.reloading || this.ammo >= d.mag || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadT = 0;
    if (d.shellReload) {
      this.nextShell = d.reloadStart + d.reloadShell;
      this.reloadDur = d.reloadStart + d.reloadShell * Math.min(d.mag - this.ammo, this.reserve) + 0.25;
    } else {
      this.reloadDur = this.ammo === 0 ? d.reloadEmpty : d.reload;
    }
    return true;
  }

  cancelReload() { this.reloading = false; }

  // returns event string or null: 'shell', 'done'
  update(dt) {
    const d = this.def;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.sinceShot += dt;
    if (this.sinceShot > 0.28) this.shotIndex = 0;
    if (!this.melee) this.bloom = Math.max(0, this.bloom - d.spread.recover * dt);
    if (!this.reloading) return null;
    this.reloadT += dt;
    if (d.shellReload) {
      if (this.reloadT >= this.nextShell) {
        this.nextShell += d.reloadShell;
        if (this.ammo < d.mag && this.reserve > 0) {
          this.ammo++;
          this.reserve--;
          if (this.ammo >= d.mag || this.reserve <= 0) { this.reloading = false; return 'done'; }
          return 'shell';
        }
        this.reloading = false;
        return 'done';
      }
      return null;
    }
    if (this.reloadT >= this.reloadDur) {
      const need = d.mag - this.ammo;
      const take = Math.min(need, this.reserve);
      this.ammo += take;
      this.reserve -= take;
      this.reloading = false;
      return 'done';
    }
    return null;
  }

  get reloadFrac() {
    return this.reloading ? Math.min(1, this.reloadT / this.reloadDur) : 0;
  }

  spread(ads, speed, onGround, crouch) {
    const s = this.def.spread;
    let b = s.hip + (s.ads - s.hip) * ads;
    b += s.move * Math.min(1.3, speed / 5) * (1 - 0.65 * ads);
    if (!onGround) b += s.air;
    if (crouch) b *= s.crouch;
    b += this.bloom * (1 - 0.5 * ads);
    return b;
  }

  refill() {
    if (this.melee) return;
    this.reserve = this.infinite ? Infinity : this.def.reserve;
  }
}

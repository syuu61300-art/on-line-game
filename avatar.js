// Third-person character: snapshot interpolation + procedural animation.
import * as THREE from 'three';
import { makeCharacter } from './models.js';
import { makeLabelTexture } from './textures.js';
import { hitboxes } from './physics.js';
import { clamp, damp, dampAngle, wrapAngle, lerp } from './util.js';

const INTERP_DELAY = 110; // ms

export class Avatar {
  constructor(game, id, name, color, isBot = false) {
    this.game = game;
    this.id = id;
    this.isBot = isBot;
    this.name = name;
    this.color = color;
    this.char = makeCharacter(color);
    this.root = this.char.root;
    this.root.rotation.order = 'YXZ';
    game.scene.add(this.root);
    this.char.setWeapon('ar');
    this.weapon = 'ar';
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.crouch = false; this.crouchT = 0;
    this.alive = false;
    this.flags = 0;
    this.snaps = [];
    this.phase = 0;
    this.stepDist = 0;
    this.deathT = 0;
    this.lastFire = -10;
    this.hb = [];
    this.visibleTag = false;
    this._tagCheck = 0;
    this.kills = 0; this.deaths = 0;
    // name tag
    this.tagMat = new THREE.SpriteMaterial({ map: makeLabelTexture(name, color), depthTest: true, transparent: true });
    this.tag = new THREE.Sprite(this.tagMat);
    this.tag.scale.set(1.3, 0.325, 1);
    this.tag.visible = false;
    this.tag.renderOrder = 6;
    game.scene.add(this.tag);
    // muzzle flash sprite
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: game.textures.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.flash.scale.set(0.5, 0.5, 1);
    game.scene.add(this.flash);
    this.flashT = 0;
    this.root.visible = false;
  }

  setName(name, color) {
    if (name === this.name && color === this.color) return;
    this.name = name;
    if (color !== this.color) {
      this.color = color;
      const c = new THREE.Color(color);
      this.char.mats[0].color.copy(c).multiplyScalar(0.75);
      this.char.mats[1].color.copy(c); this.char.mats[1].emissive.copy(c);
      this.char.mats[2].emissive.copy(c);
    }
    this.tagMat.map.dispose();
    this.tagMat.map = makeLabelTexture(name, color);
    this.tagMat.needsUpdate = true;
  }

  // network snapshot (t in local ms)
  pushSnap(t, x, y, z, yaw, pitch, flags, weapon) {
    const s = this.snaps;
    if (s.length && t <= s[s.length - 1].t) t = s[s.length - 1].t + 1;
    s.push({ t, x, y, z, yaw, pitch, flags, weapon });
    if (s.length > 30) s.shift();
    if (!this.alive && (flags & 1)) {
      // respawn: snap
      this.pos.set(x, y, z); this.prev.copy(this.pos);
      this.yaw = yaw; this.pitch = pitch;
      this.deathT = 0;
    }
  }

  // sample interpolation buffer
  sample(now) {
    const s = this.snaps;
    if (!s.length) return;
    const rt = now - INTERP_DELAY;
    let a = s[0], b = null;
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].t <= rt) { a = s[i]; b = s[i + 1] || null; break; }
    }
    let x, y, z, yaw, pitch;
    if (b) {
      const k = clamp((rt - a.t) / Math.max(1, b.t - a.t), 0, 1);
      x = lerp(a.x, b.x, k); y = lerp(a.y, b.y, k); z = lerp(a.z, b.z, k);
      yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * k;
      pitch = lerp(a.pitch, b.pitch, k);
    } else {
      // newest snapshot older than render time: small extrapolation
      const last = s[s.length - 1], pre = s[s.length - 2];
      x = last.x; y = last.y; z = last.z; yaw = last.yaw; pitch = last.pitch;
      if (pre && (last.flags & 1)) {
        const dtm = Math.min(120, rt - last.t);
        const span = Math.max(1, last.t - pre.t);
        if (dtm > 0) {
          const k = dtm / span;
          x += (last.x - pre.x) * k * 0.6; z += (last.z - pre.z) * k * 0.6;
        }
      }
      a = last;
    }
    // teleport detection (respawn)
    if (Math.hypot(x - this.pos.x, z - this.pos.z) > 6) this.prev.set(x, y, z);
    this.pos.set(x, y, z);
    this.yaw = yaw; this.pitch = pitch;
    this.setFlags(a.flags);
    this.setWeapon(a.weapon);
  }

  setFlags(f) {
    const wasAlive = this.alive;
    this.flags = f;
    this.alive = !!(f & 1);
    this.crouch = !!(f & 2);
    if (wasAlive && !this.alive) this.deathT = 0.0001;
  }

  setWeapon(id) {
    if (!id || id === this.weapon) return;
    this.weapon = id;
    this.char.setWeapon(id);
  }

  // direct state set for host-simulated bots
  setDirect(x, y, z, yaw, pitch, flags, weapon) {
    this.pos.set(x, y, z);
    this.yaw = yaw; this.pitch = pitch;
    this.setFlags(flags);
    this.setWeapon(weapon);
  }

  muzzlePos(out) {
    const g = this.char.gun;
    if (g && this.root.visible) {
      this.root.updateMatrixWorld(true);
      g.muzzle.getWorldPosition(out);
    } else {
      out.set(this.pos.x, this.pos.y + (this.crouch ? 1.05 : 1.45), this.pos.z);
    }
    return out;
  }

  fired() {
    this.lastFire = this.game.time;
    this.flashT = 0.05;
  }

  getHitboxes() {
    return hitboxes(this.pos.x, this.pos.y, this.pos.z, this.yaw, this.crouch, this.hb);
  }

  update(dt, camPos) {
    const c = this.char;
    // velocity estimate for animation
    this.vel.subVectors(this.pos, this.prev).divideScalar(Math.max(dt, 1e-3));
    this.prev.copy(this.pos);
    const hs = Math.min(9, Math.hypot(this.vel.x, this.vel.z));
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.crouchT = damp(this.crouchT, this.crouch ? 1 : 0, 10, dt);

    if (!this.alive) {
      if (this.deathT > 0) {
        this.deathT += dt;
        const k = clamp(this.deathT / 0.55, 0, 1);
        const e = 1 - Math.pow(1 - k, 3);
        this.root.rotation.x = -e * 1.45;
        this.root.position.y = this.pos.y + Math.sin(e * Math.PI) * 0.15 - e * 0.1;
        c.legL.thigh.rotation.x = -e * 0.4; c.legR.thigh.rotation.x = e * 0.2;
        c.aim.rotation.x = -e * 0.8;
        this.root.visible = this.deathT < 4;
      } else {
        this.root.visible = false;
      }
      this.tag.visible = false;
      this.flash.visible = false;
      return;
    }
    this.root.visible = true;
    this.root.rotation.x = 0;

    // walk cycle
    const moving = hs > 0.4;
    const ground = !!(this.flags & 32) || this.isBot;
    this.phase += dt * hs * 1.65;
    const amp = moving ? clamp(hs / 5, 0.3, 1.25) : 0;
    const sw = Math.sin(this.phase) * 0.62 * amp;
    const cr = this.crouchT;
    c.hips.position.y = lerp(0.92, 0.58, cr) - Math.abs(Math.cos(this.phase)) * 0.03 * amp;
    c.legL.thigh.rotation.x = lerp(sw, -1.15 + sw * 0.3, cr);
    c.legR.thigh.rotation.x = lerp(-sw, -0.75 - sw * 0.3, cr);
    c.legL.knee.rotation.x = lerp(Math.max(0, -Math.sin(this.phase + 0.6)) * 0.9 * amp, 1.7, cr);
    c.legR.knee.rotation.x = lerp(Math.max(0, Math.sin(this.phase + 0.6)) * 0.9 * amp, 1.45, cr);
    if (!ground) { c.legL.thigh.rotation.x = -0.5; c.legR.thigh.rotation.x = 0.1; c.legL.knee.rotation.x = 0.9; c.legR.knee.rotation.x = 0.5; }
    c.torso.rotation.x = -cr * 0.18 - (this.flags & 16 ? 0.12 : 0);
    c.torso.rotation.y = Math.sin(this.phase) * 0.06 * amp;
    c.aim.rotation.x = this.pitch + cr * 0.18;
    c.head.rotation.x = this.pitch * 0.5;
    // reload pose
    if (this.flags & 8) c.aim.rotation.x = -0.5;
    // spawn protection shimmer
    const prot = !!(this.flags & 64);
    c.mats[1].emissiveIntensity = prot ? 0.6 + Math.sin(this.game.time * 14) * 0.5 : 0.35;

    // muzzle flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.muzzlePos(this.flash.position);
      this.flash.visible = true;
      this.flash.material.rotation = Math.random() * 6;
    } else this.flash.visible = false;

    // footsteps (positional)
    if (moving && ground && !this.crouch && camPos) {
      this.stepDist += hs * dt;
      if (this.stepDist > 1.7) {
        this.stepDist = 0;
        const d = this.pos.distanceTo(camPos);
        if (d < 32) this.game.sound.step(this.pos, false, (this.flags & 16 ? 0.45 : 0.3));
      }
    }

    // name tag with line-of-sight check (no seeing names through walls)
    this.tag.position.set(this.pos.x, this.pos.y + (this.crouch ? 1.6 : 2.12), this.pos.z);
    this._tagCheck -= dt;
    if (this._tagCheck <= 0 && camPos) {
      this._tagCheck = 0.2;
      const d = this.pos.distanceTo(camPos);
      this.visibleTag = d < 45 && this.game.world.los(camPos.x, camPos.y, camPos.z, this.pos.x, this.pos.y + 1.5, this.pos.z);
    }
    this.tag.visible = this.visibleTag;
  }

  dispose() {
    this.game.scene.remove(this.root, this.tag, this.flash);
  }
}

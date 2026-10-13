// Axis-aligned box world: collision queries, swept body movement, raycasts.
import { PLAYER } from './config.js';

const EPS = 1e-4;

export class World {
  constructor() {
    this.boxes = [];
    this.cell = 4;
    this.grid = new Map();
    this._stamp = 0;
    this._tmp = [];
  }

  add(minx, miny, minz, maxx, maxy, maxz, opts = {}) {
    const b = {
      minx, miny, minz, maxx, maxy, maxz,
      shoot: opts.shoot !== false, // blocks bullets & sight
      walk: opts.walk !== false,   // blocks movement
      mat: opts.mat || '',
      id: this.boxes.length,
      _s: 0,
    };
    this.boxes.push(b);
    return b;
  }

  finalize() {
    const c = this.cell;
    for (const b of this.boxes) {
      const x0 = Math.floor(b.minx / c), x1 = Math.floor(b.maxx / c);
      const z0 = Math.floor(b.minz / c), z1 = Math.floor(b.maxz / c);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 2000) { // giant (ground) box → global list
        (this.big || (this.big = [])).push(b);
        continue;
      }
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x * 73856093 ^ z * 19349663;
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(b);
      }
    }
    if (!this.big) this.big = [];
  }

  // collect boxes overlapping an AABB (movement boxes only unless all=true)
  query(minx, miny, minz, maxx, maxy, maxz, out, all = false) {
    out.length = 0;
    if (!(Number.isFinite(minx) && Number.isFinite(maxx) && Number.isFinite(minz) && Number.isFinite(maxz)) || maxx - minx > 400 || maxz - minz > 400) return out;
    const stamp = ++this._stamp;
    const c = this.cell;
    const x0 = Math.floor(minx / c), x1 = Math.floor(maxx / c);
    const z0 = Math.floor(minz / c), z1 = Math.floor(maxz / c);
    for (const b of this.big) {
      if (!all && !b.walk) continue;
      if (b.minx < maxx && b.maxx > minx && b.miny < maxy && b.maxy > miny && b.minz < maxz && b.maxz > minz) out.push(b);
    }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const arr = this.grid.get(x * 73856093 ^ z * 19349663);
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        if (b._s === stamp) continue;
        b._s = stamp;
        if (!all && !b.walk) continue;
        if (b.minx < maxx && b.maxx > minx && b.miny < maxy && b.maxy > miny && b.minz < maxz && b.maxz > minz) out.push(b);
      }
    }
    return out;
  }

  blocked(minx, miny, minz, maxx, maxy, maxz) {
    return this.query(minx, miny, minz, maxx, maxy, maxz, this._tmp).length > 0;
  }

  // Ray vs boxes (slab test). Returns nearest hit {t, nx, ny, nz, box} or null.
  raycast(ox, oy, oz, dx, dy, dz, maxT, forSight = true) {
    let best = maxT, hit = null, bnx = 0, bny = 0, bnz = 0;
    const ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
    const test = (b) => {
      if (forSight ? !b.shoot : !b.walk) return;
      let t1 = (b.minx - ox) * ix, t2 = (b.maxx - ox) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), ax = 0;
      t1 = (b.miny - oy) * iy; t2 = (b.maxy - oy) * iy;
      let n = Math.min(t1, t2);
      if (n > tmin) { tmin = n; ax = 1; }
      tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (b.minz - oz) * iz; t2 = (b.maxz - oz) * iz;
      n = Math.min(t1, t2);
      if (n > tmin) { tmin = n; ax = 2; }
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax < Math.max(tmin, 0) || tmin > best) return;
      if (tmin < 0) return; // origin inside box: ignore
      best = tmin; hit = b;
      bnx = ax === 0 ? -Math.sign(dx) : 0;
      bny = ax === 1 ? -Math.sign(dy) : 0;
      bnz = ax === 2 ? -Math.sign(dz) : 0;
    };
    for (const b of this.big) test(b);
    // traverse grid cells along ray (2D DDA over XZ)
    const c = this.cell;
    let cx = Math.floor(ox / c), cz = Math.floor(oz / c);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(c / (dx || 1e-12)), tdz = Math.abs(c / (dz || 1e-12));
    let tmx = dx > 0 ? ((cx + 1) * c - ox) / dx : dx < 0 ? (cx * c - ox) / dx : Infinity;
    let tmz = dz > 0 ? ((cz + 1) * c - oz) / dz : dz < 0 ? (cz * c - oz) / dz : Infinity;
    const stamp = ++this._stamp;
    let tCell = 0;
    for (let guard = 0; guard < 400; guard++) {
      const arr = this.grid.get(cx * 73856093 ^ cz * 19349663);
      if (arr) for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        if (b._s === stamp) continue;
        b._s = stamp;
        test(b);
      }
      if (best < tCell) break;
      if (tmx < tmz) { tCell = tmx; tmx += tdx; cx += stepX; } else { tCell = tmz; tmz += tdz; cz += stepZ; }
      if (tCell > best || tCell > maxT) break;
    }
    if (!hit) return null;
    return { t: best, nx: bnx, ny: bny, nz: bnz, box: hit };
  }

  // Is there a clear line between two points?
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-3) return true;
    return !this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, true);
  }

  // Ground height under a point (top of the highest walkable box below y)
  groundAt(x, y, z, r = 0.25) {
    const arr = this.query(x - r, y - 50, z - r, x + r, y + 0.01, z + r, this._tmp);
    let best = -Infinity;
    for (const b of arr) if (b.maxy <= y + 0.01 && b.maxy > best) best = b.maxy;
    return best;
  }

  // ---- swept body movement with step-up ----
  // body: {x,y,z (feet), vx,vy,vz, r, h, onGround}
  moveBody(b, dt, allowStep = true) {
    const disp = Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt;
    const n = Math.min(10, Math.max(1, Math.ceil(disp / 0.18)));
    const h = dt / n;
    const wasGround = b.onGround;
    b.onGround = false;
    b.stepped = 0;
    let hitWall = false;
    for (let i = 0; i < n; i++) {
      b.y += b.vy * h;
      this._resolveY(b);
      b.x += b.vx * h;
      if (this._resolveH(b, 0, allowStep && (wasGround || b.onGround))) hitWall = true;
      b.z += b.vz * h;
      if (this._resolveH(b, 2, allowStep && (wasGround || b.onGround))) hitWall = true;
    }
    // ground snap when walking down stairs / slopes
    if (!b.onGround && wasGround && b.vy <= 0.01) {
      const g = this.groundAt(b.x, b.y + 0.01, b.z, b.r - 0.02);
      if (g > -Infinity && b.y - g < 0.42 && b.y - g >= 0) {
        if (!this.blocked(b.x - b.r + EPS, g + EPS, b.z - b.r + EPS, b.x + b.r - EPS, g + b.h, b.z + b.r - EPS)) {
          b.stepped = g - b.y;
          b.y = g;
          b.onGround = true;
          b.vy = 0;
        }
      }
    }
    // resting contact
    if (!b.onGround && b.vy <= 0) {
      if (this.blocked(b.x - b.r + EPS, b.y - 0.03, b.z - b.r + EPS, b.x + b.r - EPS, b.y, b.z + b.r - EPS)) b.onGround = true;
    }
    return hitWall;
  }

  _resolveY(b) {
    const arr = this.query(b.x - b.r + EPS, b.y, b.z - b.r + EPS, b.x + b.r - EPS, b.y + b.h, b.z + b.r - EPS, this._tmp);
    if (!arr.length) return;
    if (b.vy <= 0) {
      // land on the highest surface that is actually under the feet
      let top = -Infinity;
      for (const o of arr) if (o.maxy - b.y < 0.6 && o.maxy > top) top = o.maxy;
      if (top > -Infinity) {
        b.y = top;
        b.vy = 0;
        b.onGround = true;
        return;
      }
    }
    let bottom = Infinity;
    for (const o of arr) if (o.miny < bottom) bottom = o.miny;
    if (bottom > b.y + 0.3) {
      b.y = bottom - b.h - EPS;
      if (b.vy > 0) b.vy = 0;
    }
  }

  _resolveH(b, axis, canStep) {
    const arr = this.query(b.x - b.r, b.y + EPS, b.z - b.r, b.x + b.r, b.y + b.h, b.z + b.r, this._tmp);
    if (!arr.length) return false;
    // try step-up first
    if (canStep) {
      let top = -Infinity;
      for (const o of arr) if (o.maxy > top) top = o.maxy;
      const rise = top - b.y;
      if (rise > 0 && rise <= PLAYER.step) {
        if (!this.blocked(b.x - b.r + EPS, top + EPS, b.z - b.r + EPS, b.x + b.r - EPS, top + b.h, b.z + b.r - EPS)) {
          b.stepped += rise;
          b.y = top;
          if (b.vy < 0) b.vy = 0;
          return false;
        }
      }
    }
    // push out along axis
    const list = arr.slice();
    let hit = false;
    for (const o of list) {
      if (!(o.minx < b.x + b.r && o.maxx > b.x - b.r && o.miny < b.y + b.h && o.maxy > b.y + EPS && o.minz < b.z + b.r && o.maxz > b.z - b.r)) continue;
      if (o.maxy <= b.y + 0.02) continue; // surface under the feet, not a wall
      hit = true;
      if (axis === 0) {
        const v = b.vx;
        const dirPos = v > 0 || (v === 0 && b.x < (o.minx + o.maxx) / 2);
        const nx = dirPos ? o.minx - b.r - EPS : o.maxx + b.r + EPS;
        if (Math.abs(nx - b.x) < 2.2) b.x = nx; // never teleport out of huge boxes
        b.vx = 0;
      } else {
        const v = b.vz;
        const dirPos = v > 0 || (v === 0 && b.z < (o.minz + o.maxz) / 2);
        const nz = dirPos ? o.minz - b.r - EPS : o.maxz + b.r + EPS;
        if (Math.abs(nz - b.z) < 2.2) b.z = nz;
        b.vz = 0;
      }
    }
    return hit;
  }
}

// Ray vs AABB helper for entity hitboxes: returns t or -1
export function rayBox(ox, oy, oz, dx, dy, dz, minx, miny, minz, maxx, maxy, maxz) {
  const ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
  let t1 = (minx - ox) * ix, t2 = (maxx - ox) * ix;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (miny - oy) * iy; t2 = (maxy - oy) * iy;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (minz - oz) * iz; t2 = (maxz - oz) * iz;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  if (tmax < Math.max(tmin, 0)) return -1;
  return tmin < 0 ? 0 : tmin;
}

// Hitboxes for a character standing at (x,y,z) facing yaw
export function hitboxes(x, y, z, yaw, crouch, out) {
  out.length = 0;
  const fx = -Math.sin(yaw) * 0.05, fz = -Math.cos(yaw) * 0.05;
  if (!crouch) {
    out.push({ zone: 2, minx: x - 0.24, miny: y, minz: z - 0.24, maxx: x + 0.24, maxy: y + 0.86, maxz: z + 0.24 });
    out.push({ zone: 0, minx: x - 0.29, miny: y + 0.86, minz: z - 0.29, maxx: x + 0.29, maxy: y + 1.47, maxz: z + 0.29 });
    out.push({ zone: 1, minx: x + fx - 0.16, miny: y + 1.47, minz: z + fz - 0.16, maxx: x + fx + 0.16, maxy: y + 1.8, maxz: z + fz + 0.16 });
  } else {
    out.push({ zone: 2, minx: x - 0.3, miny: y, minz: z - 0.3, maxx: x + 0.3, maxy: y + 0.5, maxz: z + 0.3 });
    out.push({ zone: 0, minx: x - 0.29, miny: y + 0.5, minz: z - 0.29, maxx: x + 0.29, maxy: y + 0.98, maxz: z + 0.29 });
    out.push({ zone: 1, minx: x + fx * 2 - 0.16, miny: y + 0.98, minz: z + fz * 2 - 0.16, maxx: x + fx * 2 + 0.16, maxy: y + 1.28, maxz: z + fz * 2 + 0.16 });
  }
  return out;
}

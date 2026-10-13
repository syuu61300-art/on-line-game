// PIER 7 — container port map. Every solid box here is both rendered and collided.
import * as THREE from 'three';
import { World } from './physics.js';
import { makeTextures } from './textures.js';
import { mulberry32 } from './util.js';

export const BOUNDS = { minX: -50, maxX: 50, minZ: -40, maxZ: 40 };
export const SUN_DIR = new THREE.Vector3(-0.55, 0.24, 0.8).normalize();

// ---------- geometry builder: boxes with world-space UVs, batched per material ----------
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], u: (x, y, z) => [-z, y] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], u: (x, y, z) => [z, y] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], u: (x, y, z) => [x, -z] },
  { n: [0, -1, 0], c: [[1, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0]], u: (x, y, z) => [-x, -z] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], u: (x, y, z) => [x, y] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], u: (x, y, z) => [-x, y] },
];
const FACE_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

class GeoBuilder {
  constructor() { this.groups = new Map(); }
  _g(mat) {
    let g = this.groups.get(mat);
    if (!g) this.groups.set(mat, (g = { p: [], n: [], uv: [], c: [], i: [] }));
    return g;
  }
  box(x0, y0, z0, x1, y1, z1, mat, opt = {}) {
    const g = this._g(mat);
    const [su, sv] = opt.scale || [4, 4];
    const col = opt.color || [1, 1, 1];
    const skip = opt.skip || 0; // bitmask of faces to skip
    const X = [x0, x1], Y = [y0, y1], Z = [z0, z1];
    for (let f = 0; f < 6; f++) {
      if (skip & (1 << f)) continue;
      const F = FACES[f];
      const base = g.p.length / 3;
      for (let k = 0; k < 4; k++) {
        const cc = F.c[k];
        const x = X[cc[0]], y = Y[cc[1]], z = Z[cc[2]];
        g.p.push(x, y, z);
        g.n.push(F.n[0], F.n[1], F.n[2]);
        if (opt.uv === 'face') {
          g.uv.push(FACE_UV[k][0], FACE_UV[k][1]);
        } else {
          const [u, v] = F.u(x + (opt.ox || 0), y + (opt.oy || 0), z + (opt.oz || 0));
          g.uv.push(u / su, v / sv);
        }
        g.c.push(col[0], col[1], col[2]);
      }
      g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  quadY(x0, z0, x1, z1, y, mat, opt = {}) {
    const g = this._g(mat);
    const [su, sv] = opt.scale || [4, 4];
    const col = opt.color || [1, 1, 1];
    const base = g.p.length / 3;
    const pts = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
    pts.forEach(([x, z], k) => {
      g.p.push(x, y, z); g.n.push(0, 1, 0);
      if (opt.uv === 'face') g.uv.push(FACE_UV[k][0] * (opt.ru || 1), FACE_UV[k][1] * (opt.rv || 1));
      else g.uv.push(x / su, -z / sv);
      g.c.push(col[0], col[1], col[2]);
    });
    g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(materials, parent, opts = {}) {
    const meshes = [];
    for (const [mat, g] of this.groups) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.c, 3));
      geo.setIndex(g.i);
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, materials[mat]);
      m.castShadow = opts.castShadow !== false && !materials[mat].userData.noShadow;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      parent.add(m);
      meshes.push(m);
    }
    return meshes;
  }
}

function linColor(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

// ---------- sky ----------
function makeSky() {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sunDir: { value: SUN_DIR.clone() },
      top: { value: new THREE.Color('#1c2a4a') },
      mid: { value: new THREE.Color('#6b6f8f') },
      horizon: { value: new THREE.Color('#f0a46a') },
      sunCol: { value: new THREE.Color('#ffd9a0') },
      ground: { value: new THREE.Color('#2a2f36') },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      uniform vec3 sunDir, top, mid, horizon, sunCol, ground; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        float s = max(dot(d, sunDir), 0.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, top, smoothstep(0.15, 0.7, h));
        // warm glow around the sun, stronger near the horizon
        col += sunCol * pow(s, 8.0) * 0.55 * (1.0 - smoothstep(0.0, 0.6, h));
        col += sunCol * pow(s, 64.0) * 0.8;
        col += vec3(1.0, 0.95, 0.85) * smoothstep(0.9975, 0.9988, s) * 3.0;
        // thin cloud bands
        float band = sin(d.x * 9.0 + d.z * 4.0) * sin(d.z * 13.0 - d.x * 3.0);
        col = mix(col, col * 0.82 + vec3(0.06, 0.03, 0.05), smoothstep(0.35, 0.9, band) * smoothstep(0.03, 0.12, h) * (1.0 - smoothstep(0.25, 0.45, h)));
        col = mix(col, ground, smoothstep(0.0, -0.08, h));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

// ---------- main build ----------
export function buildMap(scene, renderer, quality = 'high') {
  const T = makeTextures(renderer);
  const world = new World();
  const geo = new GeoBuilder();
  const deco = new GeoBuilder(); // non-colliding detail
  const rng = mulberry32(42);
  const root = new THREE.Group();
  root.name = 'map';
  scene.add(root);

  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, envMapIntensity: 0.55 }, o));
  const M = {
    asphalt: std({ map: T.asphalt, roughness: 0.95, metalness: 0.0 }),
    concrete: std({ map: T.concrete, roughness: 0.9 }),
    wall: std({ map: T.wall, roughness: 0.92 }),
    container: std({ map: T.corrugated, roughness: 0.55, metalness: 0.35 }),
    siding: std({ map: T.siding, roughness: 0.7, metalness: 0.25 }),
    roof: std({ map: T.roof, roughness: 0.6, metalness: 0.4 }),
    crate: std({ map: T.crate, roughness: 0.85 }),
    tread: std({ map: T.tread, roughness: 0.45, metalness: 0.6 }),
    hazard: std({ map: T.hazard, roughness: 0.75 }),
    blocks: std({ map: T.blocks, roughness: 0.9 }),
    dark: std({ color: 0x2a2e33, roughness: 0.6, metalness: 0.55 }),
    paint: std({ color: 0xffffff, roughness: 0.7, metalness: 0.2 }),
    rubber: std({ color: 0x18191b, roughness: 0.95 }),
    glass: std({ color: 0x40505a, roughness: 0.15, metalness: 0.8, envMapIntensity: 1.2 }),
    lampHead: new THREE.MeshBasicMaterial({ color: 0xffd18a }),
    marking: std({ map: T.paint, roughness: 0.8, transparent: false }),
  };
  M.lampHead.userData.noShadow = true;
  M.lampHead.vertexColors = true;

  // helpers ----------------------------------------------------------------
  const solid = (x0, y0, z0, x1, y1, z1, mat, opt = {}) => {
    if (opt.collide !== false) world.add(Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1), { shoot: opt.shoot, walk: opt.walk, mat });
    if (mat) (opt.deco ? deco : geo).box(Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1), mat, opt);
  };
  const decor = (x0, y0, z0, x1, y1, z1, mat, opt = {}) => deco.box(x0, y0, z0, x1, y1, z1, mat, opt);

  const CONT = {
    red: linColor('#9a3d2f'), blue: linColor('#2e5f8f'), green: linColor('#3f6e4c'), orange: linColor('#c5692a'),
    white: linColor('#c9c4b8'), yellow: linColor('#c9a52c'), teal: linColor('#2f7a7a'), grey: linColor('#7a7f86'),
  };
  // container: centre x,z, stack level, length (6.1|12.2), along x?, colour
  const container = (cx, cz, lvl, len, alongX, col) => {
    const w = 2.44, h = 2.6;
    const hx = alongX ? len / 2 : w / 2, hz = alongX ? w / 2 : len / 2;
    const y0 = lvl * h;
    const c = CONT[col] || CONT.grey;
    solid(cx - hx, y0, cz - hz, cx + hx, y0 + h, cz + hz, 'container', { scale: [2.4, 2.6], color: c });
    // door end: lock bars + frame
    const endPos = alongX ? cx + hx : cz + hz;
    for (let k = 0; k < 4; k++) {
      const o = -0.9 + k * 0.6;
      if (alongX) decor(endPos, y0 + 0.15, cz + o - 0.025, endPos + 0.04, y0 + h - 0.15, cz + o + 0.025, 'dark');
      else decor(cx + o - 0.025, y0 + 0.15, endPos, cx + o + 0.025, y0 + h - 0.15, endPos + 0.04, 'dark');
    }
    if (alongX) decor(endPos, y0 + 0.02, cz - hz + 0.02, endPos + 0.03, y0 + h - 0.02, cz + hz - 0.02, 'container', { scale: [2.4, 2.6], color: c.map((v) => v * 0.7), skip: 0b000010 });
    else decor(cx - hx + 0.02, y0 + 0.02, endPos, cx + hx - 0.02, y0 + h - 0.02, endPos + 0.03, 'container', { scale: [2.4, 2.6], color: c.map((v) => v * 0.7), skip: 0b100000 });
  };
  // solid stair: rectangle [x0,x1]×[z0,z1], rising toward dir, from y0 to y1
  const stairs = (x0, x1, z0, z1, dir, y0, y1, mat = 'tread') => {
    const rise = 0.2;
    const n = Math.round((y1 - y0) / rise);
    for (let i = 0; i < n; i++) {
      const top = y0 + (i + 1) * ((y1 - y0) / n);
      const f0 = i / n, f1 = (i + 1) / n;
      let a0, a1, b0, b1;
      if (dir === '+x') { a0 = x0 + (x1 - x0) * f0; a1 = x0 + (x1 - x0) * f1; b0 = z0; b1 = z1; solid(a0, y0, b0, a1, top, b1, mat, { scale: [1, 1] }); }
      if (dir === '-x') { a1 = x1 - (x1 - x0) * f0; a0 = x1 - (x1 - x0) * f1; b0 = z0; b1 = z1; solid(a0, y0, b0, a1, top, b1, mat, { scale: [1, 1] }); }
      if (dir === '+z') { b0 = z0 + (z1 - z0) * f0; b1 = z0 + (z1 - z0) * f1; solid(x0, y0, b0, x1, top, b1, mat, { scale: [1, 1] }); }
      if (dir === '-z') { b1 = z1 - (z1 - z0) * f0; b0 = z1 - (z1 - z0) * f1; solid(x0, y0, b0, x1, top, b1, mat, { scale: [1, 1] }); }
    }
    // hazard nosing on the side faces for readability
  };
  // railing: thin, blocks movement but not bullets
  const railing = (x0, z0, x1, z1, y, h = 1.0) => {
    const t = 0.05;
    const minx = Math.min(x0, x1) - (x0 === x1 ? t : 0), maxx = Math.max(x0, x1) + (x0 === x1 ? t : 0);
    const minz = Math.min(z0, z1) - (z0 === z1 ? t : 0), maxz = Math.max(z0, z1) + (z0 === z1 ? t : 0);
    world.add(minx, y, minz, maxx, y + h, maxz, { shoot: false });
    decor(minx, y + h - 0.06, minz, maxx, y + h, maxz, 'hazard', { scale: [1, 1] });
    decor(minx + 0.01, y + h * 0.5 - 0.02, minz + 0.01, maxx - 0.01, y + h * 0.5 + 0.02, maxz - 0.01, 'dark');
    const len = Math.hypot(x1 - x0, z1 - z0);
    const posts = Math.max(2, Math.ceil(len / 1.5) + 1);
    for (let i = 0; i < posts; i++) {
      const f = i / (posts - 1);
      const px = x0 + (x1 - x0) * f, pz = z0 + (z1 - z0) * f;
      decor(px - 0.035, y, pz - 0.035, px + 0.035, y + h, pz + 0.035, 'dark');
    }
  };
  // wall along an axis with rectangular openings
  const wall = (axis, a0, a1, t0, t1, y0, y1, openings, mat, opt = {}) => {
    const cuts = new Set([a0, a1]);
    for (const o of openings) { if (o[0] > a0 && o[0] < a1) cuts.add(o[0]); if (o[1] > a0 && o[1] < a1) cuts.add(o[1]); }
    const cs = [...cuts].sort((p, q) => p - q);
    for (let i = 0; i < cs.length - 1; i++) {
      const s0 = cs[i], s1 = cs[i + 1], mid = (s0 + s1) / 2;
      const holes = openings.filter((o) => o[0] < mid && o[1] > mid).map((o) => [o[2], o[3]]).sort((p, q) => p[0] - q[0]);
      let y = y0;
      const spans = [];
      for (const [h0, h1] of holes) { if (h0 > y) spans.push([y, h0]); y = Math.max(y, h1); }
      if (y < y1) spans.push([y, y1]);
      for (const [p0, p1] of spans) {
        if (p1 - p0 < 0.01) continue;
        if (axis === 'x') solid(s0, p0, t0, s1, p1, t1, mat, opt);
        else solid(t0, p0, s0, t1, p1, s1, mat, opt);
      }
    }
  };
  const crate = (cx, cz, y0, s, rot = 0) => {
    const tint = 0.85 + rng() * 0.25;
    solid(cx - s / 2, y0, cz - s / 2, cx + s / 2, y0 + s, cz + s / 2, 'crate', { uv: 'face', color: [tint, tint * 0.97, tint * 0.92] });
  };
  const barrier = (cx, cz, len, alongX) => { // jersey barrier
    const hx = alongX ? len / 2 : 0.3, hz = alongX ? 0.3 : len / 2;
    solid(cx - hx, 0, cz - hz, cx + hx, 0.85, cz + hz, 'concrete', { scale: [2, 2] });
    decor(cx - hx - 0.01, 0.58, cz - hz - 0.01, cx + hx + 0.01, 0.7, cz + hz + 0.01, 'hazard', { scale: [0.6, 0.6] });
  };
  const pallet = (cx, cz, y0 = 0) => {
    decor(cx - 0.6, y0, cz - 0.5, cx + 0.6, y0 + 0.14, cz + 0.5, 'crate', { uv: 'face', color: [0.75, 0.7, 0.6] });
  };

  // ---------------- ground ----------------
  world.add(-200, -6, -200, 200, 0, 40, { mat: 'asphalt' });
  geo.quadY(-160, -160, 160, 40, 0, 'asphalt', { scale: [9, 9] });
  // concrete quay apron
  decor(-50, 0, 30.5, 50, 0.012, 40, 'concrete', { scale: [5, 5], skip: 0b111011 });
  // quay edge (concrete face down to the water)
  decor(-160, -3.5, 40, 160, 0.0, 40.6, 'wall', { scale: [4, 4] });
  // curb along the quay edge (stepable)
  for (let x = -50; x < 50; x += 10) solid(x + 0.05, 0, 39.3, x + 9.95, 0.18, 39.8, 'hazard', { scale: [1.2, 1.2] });
  // invisible barrier over the water edge
  world.add(-60, 0, 39.8, 60, 30, 41, { shoot: false });

  // lane markings
  const mark = (x0, z0, x1, z1) => deco.box(x0, 0, z0, x1, 0.015, z1, 'marking', { scale: [1, 4], skip: 0b111011 });
  for (let z = -36; z < 30; z += 6) mark(14.9, z, 15.1, z + 3.5);
  for (let x = -46; x < 46; x += 6) mark(x, 15.4, x + 3.5, 15.6);
  mark(-50, 30.3, 50, 30.5);
  for (let x = -28; x < 0; x += 4) mark(x, -24.2, x + 0.2, -21);

  // ---------------- perimeter walls ----------------
  const WH = 4.5;
  solid(-50.6, 0, -40.6, 50.6, WH, -40, 'wall', { scale: [6, WH] });
  solid(-50.6, 0, -40, -50, WH, 39.8, 'wall', { scale: [6, WH] });
  solid(50, 0, -40, 50.6, WH, 39.8, 'wall', { scale: [6, WH] });
  // wall caps
  decor(-50.8, WH, -40.8, 50.8, WH + 0.15, -39.9, 'dark');
  decor(-50.8, WH, -40, -49.9, WH + 0.15, 39.8, 'dark');
  decor(49.9, WH, -40, 50.8, WH + 0.15, 39.8, 'dark');
  // wall buttresses
  for (let x = -45; x <= 45; x += 10) decor(x - 0.3, 0, -40, x + 0.3, WH, -39.6, 'wall', { scale: [2, WH] });

  // ---------------- central warehouse ----------------
  {
    const X0 = -12, X1 = 12, Z0 = -9, Z1 = 7, H = 8, t = 0.4;
    const sid = { scale: [4, 4] };
    // west / east walls with large door
    wall('z', Z0, Z1, X0, X0 + t, 0, H, [[-2.5, 2.5, 0, 5]], 'siding', sid);
    wall('z', Z0, Z1, X1 - t, X1, 0, H, [[-2.5, 2.5, 0, 5]], 'siding', sid);
    // north wall: small door + upper windows
    wall('x', X0, X1, Z0, Z0 + t, 0, H, [[-7, -5.6, 0, 2.4], [-9.5, -7.5, 4.4, 5.8], [-3, 0, 4.4, 5.8], [3, 6, 4.4, 5.8], [8, 10, 4.4, 5.8]], 'siding', sid);
    // south wall: wide roller door opening + small door
    wall('x', X0, X1, Z1 - t, Z1, 0, H, [[-3, 3, 0, 4.4], [7, 8.4, 0, 2.4]], 'siding', sid);
    // half-open roller door
    decor(-3, 4.4, Z1 - 0.15, 3, 5.2, Z1 + 0.15, 'roof', { scale: [2, 1] });
    // door frames
    for (const x of [-3, 3]) decor(x - 0.12, 0, Z1 - 0.25, x + 0.12, 4.5, Z1 + 0.25, 'hazard', { scale: [0.8, 0.8] });
    for (const z of [-2.5, 2.5]) { decor(X0 - 0.2, 0, z - 0.12, X0 + 0.5, 5.05, z + 0.12, 'hazard', { scale: [0.8, 0.8] }); decor(X1 - 0.5, 0, z - 0.12, X1 + 0.2, 5.05, z + 0.12, 'hazard', { scale: [0.8, 0.8] }); }
    // roof (gabled look)
    solid(X0 - 0.4, H, Z0 - 0.4, X1 + 0.4, H + 0.3, Z1 + 0.4, 'roof', { scale: [3, 3] });
    decor(X0 - 0.2, H + 0.3, Z0 - 0.2, X1 + 0.2, H + 1.0, Z1 + 0.2, 'roof', { scale: [3, 3] });
    decor(X0, H + 1.0, -1.4, X1, H + 1.5, 0.2, 'roof', { scale: [3, 3] });
    // interior concrete floor
    decor(X0 + t, 0, Z0 + t, X1 - t, 0.01, Z1 - t, 'concrete', { scale: [4, 4], skip: 0b111011 });
    // mezzanine along north wall (top y = 3.8)
    solid(X0 + t, 3.6, Z0 + t, X1 - t, 3.8, -5.2, 'tread', { scale: [2, 2] });
    for (const x of [-8, -2, 4]) solid(x - 0.15, 0, -5.55, x + 0.15, 3.6, -5.25, 'dark');
    decor(X0 + t, 3.4, -5.4, X1 - t, 3.6, -5.2, 'hazard', { scale: [1, 1] });
    railing(X0 + t, -5.2, 7.8, -5.2, 3.8);
    railing(9.8, -5.2, X1 - t, -5.2, 3.8);
    // stairs up to mezzanine: x 8..9.6, from z 2.6 (bottom) to z -5.2 (top)
    stairs(8, 9.6, -5.2, 2.6, '-z', 0, 3.8);
    railing(7.95, 2.6, 7.95, -5.2, 0.4, 3.5);
    // interior cover
    crate(-6.5, -0.5, 0, 2.0); crate(-6.4, -0.4, 2.0, 1.2); crate(-4.6, -0.8, 0, 1.2);
    crate(4, 1, 0, 2.0); crate(5.6, 1.2, 0, 1.2); crate(3.6, 2.8, 0, 1.2);
    crate(-2.4, 3.6, 0, 1.2); crate(-0.9, 3.8, 0, 1.2); crate(-1.6, 3.7, 1.2, 1.2);
    crate(-9.8, -3.2, 0, 1.2);
    // shelving rack along south interior wall
    solid(-11.4, 0, 5.0, -5.4, 2.9, 6.3, 'crate', { uv: 'face', color: [0.7, 0.66, 0.6] });
    decor(-11.5, 2.9, 4.95, -5.3, 3.0, 6.35, 'dark');
    for (const x of [-11.45, -8.4, -5.35]) decor(x - 0.05, 0, 4.9, x + 0.05, 3.0, 6.4, 'dark');
    // crates on the mezzanine
    crate(-9.5, -7.2, 3.8, 1.2); crate(-1.5, -6.6, 3.8, 1.2); crate(5.5, -7.4, 3.8, 1.2);
    // hanging lamps (decor)
    for (const x of [-6, 0, 6]) decor(x - 0.4, 7.0, -1.6, x + 0.4, 7.15, -1.0, 'lampHead');
  }

  // ---------------- office / control building (NW) ----------------
  {
    const X0 = -47, X1 = -35, Z0 = -38, Z1 = -29, t = 0.3;
    const bl = { scale: [3, 3] };
    // north wall
    wall('x', X0, X1, Z0, Z0 + t, 0, 6.6, [[-45, -43, 4.6, 5.8], [-40, -38, 4.6, 5.8]], 'blocks', bl);
    // south wall
    wall('x', X0, X1, Z1 - t, Z1, 0, 6.6, [[-43, -41.5, 0, 2.4], [-39, -37, 1.1, 2.2], [-45.5, -42.5, 4.6, 5.8], [-40, -36.5, 4.6, 5.8]], 'blocks', bl);
    // west wall
    wall('z', Z0 + t, Z1 - t, X0, X0 + t, 0, 6.6, [[-35, -33, 4.6, 5.8], [-34, -32.6, 1.1, 2.2]], 'blocks', bl);
    // east wall: ground door + upper door to landing
    wall('z', Z0 + t, Z1 - t, X1 - t, X1, 0, 6.6, [[-36.6, -35.2, 0, 2.4], [-33.4, -32.0, 3.6, 6.0], [-31.5, -30.2, 4.6, 5.8]], 'blocks', bl);
    // floor slab 2F (top 3.6) and roof
    solid(X0 + t, 3.4, Z0 + t, X1 - t, 3.6, Z1 - t, 'concrete', { scale: [3, 3] });
    solid(X0 - 0.3, 6.6, Z0 - 0.3, X1 + 0.3, 6.95, Z1 + 0.3, 'roof', { scale: [3, 3] });
    decor(X0 - 0.35, 6.95, Z0 - 0.35, X1 + 0.35, 7.1, Z1 + 0.35, 'dark');
    // rooftop AC unit + antenna
    decor(-44, 7.1, -36, -41.5, 8.2, -34, 'paint', { color: linColor('#9aa1a6') });
    decor(-37.2, 7.1, -31.2, -37.0, 11.5, -31.0, 'dark');
    // external stairs + landing (east side)
    stairs(-34.6, -33.2, -31.6, -24.4, '-z', 0, 3.6);
    solid(-35.0, 3.4, -33.6, -33.1, 3.6, -31.6, 'tread', { scale: [1, 1] });
    for (const z of [-33.5, -31.7]) solid(-33.25, 0, z - 0.08, -33.1, 3.4, z + 0.08, 'dark');
    railing(-33.1, -33.6, -33.1, -31.6, 3.6);
    railing(-35.0, -33.6, -33.1, -33.6, 3.6);
    railing(-33.15, -31.6, -33.15, -24.4, 0.6, 3.4);
    // interior: desks / lockers
    solid(-46.5, 0, -37.5, -44.5, 0.85, -36.6, 'paint', { color: linColor('#6b5a48') });
    solid(-40, 0, -34.5, -38, 0.85, -33.4, 'paint', { color: linColor('#6b5a48') });
    solid(-46.6, 3.6, -37.6, -45.9, 5.6, -34.6, 'paint', { color: linColor('#55636e') });
    solid(-42, 3.6, -33, -39.6, 4.45, -31.8, 'paint', { color: linColor('#6b5a48') });
    crate(-37.2, -36.8, 3.6, 1.0);
    // inner partition on 1F
    wall('z', Z0 + t, Z1 - t, -41.1, -40.9, 0, 3.4, [[-35.5, -34.0, 0, 2.3]], 'blocks', bl);
  }

  // ---------------- north lot: trailers, truck, tanks ----------------
  const trailer = (x0, x1, z0, z1) => {
    // body: bullets pass under (skirt only blocks movement)
    solid(x0, 1.15, z0, x1, 3.9, z1, 'container', { scale: [2.4, 2.6], color: CONT.white, oy: 0.25 });
    world.add(x0 + 0.1, 0, z0 + 0.1, x1 - 0.1, 1.15, z1 - 0.1, { shoot: false });
    decor(x0 + 0.2, 0.95, z0 + 0.15, x1 - 0.2, 1.15, z1 - 0.15, 'dark');
    const L = x1 - x0;
    for (const fx of [0.08, 0.16]) for (const zz of [z0 + 0.1, z1 - 0.45]) decor(x1 - L * fx - 0.5, 0, zz, x1 - L * fx + 0.5, 1.0, zz + 0.35, 'rubber');
    for (const zz of [z0 + 0.3, z1 - 0.4]) decor(x0 + L * 0.25 - 0.08, 0, zz, x0 + L * 0.25 + 0.08, 1.0, zz + 0.1, 'dark');
    decor(x0 + 0.5, 1.6, z0 - 0.01, x0 + 3.5, 2.2, z0, 'hazard', { scale: [1, 1] });
  };
  trailer(-26, -14, -34, -31.5);
  trailer(-8, 4, -30, -27.5);
  // tractor cab for second trailer
  solid(4.2, 0, -30.2, 6.4, 3.3, -27.3, 'paint', { color: linColor('#a2331f') });
  solid(6.4, 0, -30.0, 7.6, 1.8, -27.5, 'paint', { color: linColor('#a2331f') });
  decor(5.3, 2.0, -30.25, 6.45, 3.0, -27.25, 'glass');
  decor(6.42, 1.0, -30.05, 7.62, 1.6, -27.45, 'dark');
  // fuel tanks on saddles (cylinders drawn separately)
  const tanks = [];
  for (const tz of [-35.2, -31]) {
    solid(26, 0.0, tz - 1.55, 38, 3.4, tz + 1.55, null);
    tanks.push(tz);
    for (const sx of [27.5, 32, 36.5]) decor(sx - 0.3, 0, tz - 1.3, sx + 0.3, 0.8, tz + 1.3, 'concrete', { scale: [1, 1] });
  }
  // pipe rack between tanks and wall
  solid(39.5, 0, -38, 40, 2.5, -27, 'dark');
  decor(26, 2.8, -38.4, 40, 3.0, -38.2, 'dark');
  decor(26, 2.4, -38.6, 40, 2.6, -38.4, 'paint', { color: linColor('#b8862e') });
  // barriers & crates around the north lot
  barrier(-30, -22, 4, true); barrier(-10, -20, 4, true); barrier(16.5, -20.5, 3.2, false);
  barrier(16.5, -11.5, 3.2, false); barrier(13, -36, 3.2, false);
  crate(-18, -24, 0, 1.4); crate(-16.6, -23.6, 0, 1.2); crate(-17.4, -23.9, 1.4, 1.0);
  crate(10, -24, 0, 1.4); crate(11.3, -25.1, 0, 1.2);
  crate(20, -36.5, 0, 1.4); crate(21.4, -37.0, 0, 1.2); crate(20.2, -36.5, 1.4, 1.2);
  pallet(-3, -36); crate(-3, -36, 0.14, 1.1);
  container(-26.5, -38.6, 0, 6.1, true, 'teal');
  container(-0.5, -38.6, 0, 12.2, true, 'grey');
  container(-0.5, -38.6, 1, 6.1, true, 'red');

  // NE stack against the east wall
  container(46.5, -28, 0, 12.2, false, 'blue');
  container(46.5, -28, 1, 12.2, false, 'orange');
  container(43.9, -31, 0, 6.1, false, 'white');

  // ---------------- east yard ----------------
  container(25, -17.5, 0, 12.2, true, 'red');
  container(25, -17.5, 1, 12.2, true, 'blue');
  container(40, -17.5, 0, 12.2, true, 'green');
  container(25, -14.94, 0, 12.2, true, 'orange');
  container(40, -14.94, 0, 12.2, true, 'white');
  container(40, -14.94, 1, 12.2, true, 'red');
  container(23.5, -4, 0, 6.1, true, 'yellow');
  container(37, -4, 0, 12.2, true, 'blue');
  container(37, -4, 1, 12.2, true, 'green');
  container(23, 6, 0, 12.2, true, 'red');
  container(23, 6, 1, 12.2, true, 'white');
  container(37, 6, 0, 12.2, true, 'orange');
  container(37, 6, 1, 12.2, true, 'blue');
  container(37, 8.5, 0, 12.2, true, 'green');
  container(26, 18, 0, 12.2, true, 'blue');
  container(42, 18, 0, 6.1, true, 'red');
  container(42, 20.56, 0, 6.1, true, 'teal');
  container(42, 20.56, 1, 6.1, true, 'yellow');
  // climb route: ground → green container (2.6) → blue stack top (5.2)
  stairs(43.1, 48.4, 7.4, 9.0, '-x', 0, 2.6);
  railing(43.1, 9.05, 48.4, 9.05, 0.3, 2.6);
  solid(30.95, 2.6, 7.28, 32.6, 5.2, 9.05, 'tread', { scale: [1, 1] }); // top landing
  stairs(32.6, 36.9, 7.28, 9.05, '-x', 2.6, 5.2);
  railing(32.6, 9.1, 36.9, 9.1, 2.8, 2.4);
  // catwalk bridge between the two 2-high stacks (top 5.2)
  solid(33, 5.0, -2.78, 34.6, 5.2, 4.78, 'tread', { scale: [1, 1] });
  decor(33.05, 4.7, -2.7, 33.2, 5.0, 4.7, 'dark'); decor(34.4, 4.7, -2.7, 34.55, 5.0, 4.7, 'dark');
  railing(33, -2.78, 33, 4.78, 5.2);
  railing(34.6, -2.78, 34.6, 4.78, 5.2);
  // cover in the east lanes
  crate(30.5, -9.5, 0, 1.4); crate(31.9, -9.9, 0, 1.2); crate(31, -9.6, 1.4, 1.0);
  crate(45, -8, 0, 1.4); crate(46.3, -7.6, 0, 1.2);
  crate(19.5, 12, 0, 1.4); crate(20.8, 12.4, 0, 1.0);
  barrier(30, 13, 4, true); barrier(44, -1, 3.2, false);
  pallet(27, -9); pallet(46, 13); crate(46, 13, 0.14, 1.1);

  // ---------------- west yard ----------------
  container(-45.5, -15, 0, 12.2, false, 'blue');
  container(-45.5, -15, 1, 12.2, false, 'red');
  container(-42.9, -15, 0, 12.2, false, 'green');
  container(-45.5, 2, 0, 6.1, false, 'orange');
  container(-45.5, 16, 0, 12.2, false, 'white');
  container(-45.5, 16, 1, 12.2, false, 'yellow');
  container(-42.9, 16, 0, 12.2, false, 'red');
  container(-34, -12, 0, 12.2, false, 'red');
  container(-34, -12, 1, 12.2, false, 'blue');
  container(-31.4, -12, 0, 12.2, false, 'orange');
  // climb route onto the west stack
  stairs(-32.2, -30.6, -5.86, -0.56, '-z', 0, 2.6);
  railing(-30.55, -5.86, -30.55, -0.56, 0.3, 2.6);
  stairs(-32.6, -31.0, -12.3, -7.0, '-z', 2.6, 5.2);
  container(-34, 6, 0, 12.2, false, 'green');
  container(-26, -2, 0, 6.1, true, 'blue');
  container(-24, 14, 0, 12.2, false, 'red');
  container(-21.4, 14, 0, 12.2, false, 'white');
  container(-21.4, 14, 1, 12.2, false, 'orange');
  container(-34, 24, 0, 6.1, false, 'yellow');
  crate(-38.5, 1, 0, 1.4); crate(-37.2, 1.4, 0, 1.2); crate(-38.2, 1.1, 1.4, 1.0);
  crate(-27, 6, 0, 1.4); crate(-28.4, 5.6, 0, 1.0);
  crate(-40, -24, 0, 1.4); crate(-38.6, -24.4, 0, 1.2);
  barrier(-18, -6, 3.2, false); barrier(-29, 18.5, 3.2, true);
  pallet(-24, -14); crate(-24, -14, 0.14, 1.1);

  // ---------------- south dock ----------------
  // gantry crane legs (collide) + superstructure (decor)
  const legs = [[-9, 23], [-9, 37], [9, 23], [9, 37]];
  for (const [lx, lz] of legs) {
    solid(lx - 0.6, 0, lz - 0.6, lx + 0.6, 24, lz + 0.6, 'paint', { color: linColor('#c58a1c'), scale: [2, 2] });
    solid(lx - 1.0, 0, lz - 1.6, lx + 1.0, 1.1, lz + 1.6, 'paint', { color: linColor('#4b4f55') });
  }
  for (const lx of [-9, 9]) decor(lx - 0.5, 22, 22.4, lx + 0.5, 24, 37.6, 'paint', { color: linColor('#c58a1c') });
  for (const lz of [23, 37]) decor(-9.6, 23, lz - 0.5, 9.6, 24.6, lz + 0.5, 'paint', { color: linColor('#c58a1c') });
  decor(-1.2, 24.6, 10, 1.2, 26.4, 85, 'paint', { color: linColor('#c58a1c') }); // boom over the water
  decor(-2.4, 22.2, 28, 2.4, 25.0, 32, 'paint', { color: linColor('#d9d4c8') }); // trolley house
  decor(-1.4, 21.0, 32, 1.4, 22.8, 34.2, 'glass');
  decor(-1.0, 26.4, 14, 1.0, 34, 16, 'paint', { color: linColor('#c58a1c') }); // A-frame
  // cross bracing is added as rotated beams after the batched build (see below)
  const braces = [];
  for (const lx of [-9, 9]) {
    braces.push([lx, 1.2, 23.6, lx, 11.5, 36.4], [lx, 1.2, 36.4, lx, 11.5, 23.6], [lx, 11.5, 23.6, lx, 21.8, 36.4], [lx, 11.5, 36.4, lx, 21.8, 23.6]);
    decor(lx - 0.35, 11.3, 23, lx + 0.35, 11.7, 37, 'paint', { color: linColor('#b07a18') });
  }
  // crane rails
  for (const lx of [-9, 9]) decor(lx - 0.1, 0, 18, lx + 0.1, 0.05, 40, 'dark');
  // bollards along the edge (cylinders drawn separately)
  const bollards = [];
  for (let x = -45; x <= 45; x += 7.5) { solid(x - 0.3, 0, 38.6, x + 0.3, 0.7, 39.2, null); bollards.push([x, 38.9]); }
  // dock cargo
  container(-30, 33, 0, 12.2, true, 'orange');
  container(-31.5, 35.56, 0, 6.1, true, 'red');
  container(29, 33, 0, 12.2, true, 'green');
  container(29, 33, 1, 12.2, true, 'blue');
  container(27, 35.56, 0, 6.1, true, 'white');
  barrier(-15, 19, 4, true); barrier(15, 22, 3.2, false); barrier(0, 34, 4, true); barrier(-22, 26, 3.2, false);
  crate(-3, 25.5, 0, 1.4); crate(-1.6, 25.9, 0, 1.2); crate(-2.6, 25.6, 1.4, 1.0);
  crate(4, 30, 0, 1.4); crate(5.4, 29.6, 0, 1.2);
  crate(18, 28, 0, 1.4); crate(19.4, 28.4, 0, 1.4); crate(18.7, 28.2, 1.4, 1.2);
  crate(-40, 28, 0, 1.4); crate(-41.4, 28.5, 0, 1.0);
  pallet(-12, 31); crate(-12, 31, 0.14, 1.1);
  // forklift (simple)
  solid(21, 0, 21, 22.6, 1.6, 23.4, 'paint', { color: linColor('#d4a017') });
  decor(21.1, 1.6, 21.3, 22.5, 2.6, 22.6, 'dark');
  decor(20.4, 0.05, 21.4, 21.0, 1.9, 21.5, 'dark'); decor(20.4, 0.05, 22.9, 21.0, 1.9, 23.0, 'dark');
  decor(19.6, 0.1, 21.5, 21.0, 0.16, 21.7, 'dark'); decor(19.6, 0.1, 22.7, 21.0, 0.16, 22.9, 'dark');

  // ---------------- road cover between the zones ----------------
  barrier(-15.5, -12, 3.2, false);
  barrier(-15.5, 4, 3.2, false);
  crate(14, 2, 0, 1.4); crate(15.3, 2.5, 0, 1.0);
  crate(-15, 12, 0, 1.4);
  barrier(6, 13, 4, true); barrier(-6, 13, 4, true);
  barrier(0, -16, 4, true);

  // ---------------- lamp posts ----------------
  const lampPos = [[-16, -16], [16, -16], [-16, 16.5], [16.5, 16.5], [-30, -27], [31, -24.5], [-37, 30], [37, 29], [0, -21], [0, 21]];
  const lamps = [];
  for (const [lx, lz] of lampPos) {
    solid(lx - 0.14, 0, lz - 0.14, lx + 0.14, 8, lz + 0.14, 'dark');
    decor(lx - 0.35, 0, lz - 0.35, lx + 0.35, 0.35, lz + 0.35, 'concrete', { scale: [1, 1] });
    decor(lx - 0.08, 7.8, lz - 0.08, lx + 1.3, 7.95, lz + 0.08, 'dark');
    decor(lx + 0.7, 7.6, lz - 0.22, lx + 1.4, 7.8, lz + 0.22, 'dark');
    decor(lx + 0.75, 7.55, lz - 0.17, lx + 1.35, 7.6, lz + 0.17, 'lampHead');
    lamps.push(new THREE.Vector3(lx + 1.05, 7.5, lz));
  }

  // ---------------- distant scenery (no collision) ----------------
  const far = new GeoBuilder();
  const farMat = {
    city: new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.9, emissive: 0xffffff, emissiveMap: T.windows, emissiveIntensity: 0.9, vertexColors: true }),
    land: new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 1, vertexColors: true }),
    shed: std({ map: T.siding, roughness: 0.8 }),
  };
  for (let i = 0; i < 46; i++) {
    const x = -420 + i * 18 + rng() * 8, z = 230 + rng() * 80;
    const w = 10 + rng() * 14, d = 10 + rng() * 14, h = 18 + rng() * rng() * 110;
    far.box(x, -2, z, x + w, h, z + d, 'city', { scale: [24, 24], ox: rng() * 100 });
  }
  far.box(-600, -3, 220, 600, 1.5, 420, 'land', { scale: [50, 50] });
  // outer warehouses beyond the walls (visible from high points)
  for (const [x0, z0, x1, z1, h] of [[-110, -90, -60, -50, 14], [-110, -30, -66, 20, 10], [60, -95, 120, -55, 16], [64, -30, 110, 25, 12], [-30, -110, 40, -60, 18]]) {
    far.box(x0, 0, z0, x1, h, z1, 'shed', { scale: [4, 4] });
  }
  far.build(farMat, root, { castShadow: false });

  // ---------------- build batched meshes ----------------
  geo.build(M, root);
  deco.build(M, root);

  // crane bracing beams
  {
    const bm = new THREE.MeshStandardMaterial({ color: 0xb07a18, roughness: 0.55, metalness: 0.4 });
    for (const [x0, y0, z0, x1, y1, z1] of braces) {
      const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, len), bm);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.lookAt(b);
      m.castShadow = true;
      root.add(m);
    }
  }

  // cylinders: tanks, bollards
  {
    const tankGeo = new THREE.CylinderGeometry(1.55, 1.55, 11.6, 24, 1);
    tankGeo.rotateZ(Math.PI / 2);
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.45, metalness: 0.5, envMapIntensity: 0.8 });
    for (const tz of tanks) {
      const m = new THREE.Mesh(tankGeo, tankMat);
      m.position.set(32, 1.9, tz);
      m.castShadow = m.receiveShadow = true;
      root.add(m);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.55, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), tankMat);
      cap.scale.set(0.35, 1, 1);
      cap.rotation.z = -Math.PI / 2; cap.position.set(37.8, 1.9, tz); root.add(cap);
      const cap2 = cap.clone(); cap2.rotation.z = Math.PI / 2; cap2.position.x = 26.2; root.add(cap2);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.57, 1.57, 0.5, 24), new THREE.MeshStandardMaterial({ color: 0xb8862e, roughness: 0.6 }));
      band.rotation.z = Math.PI / 2; band.position.set(32, 1.9, tz); root.add(band);
    }
    const bGeo = new THREE.CylinderGeometry(0.22, 0.3, 0.7, 12);
    const bMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.6 });
    const inst = new THREE.InstancedMesh(bGeo, bMat, bollards.length);
    const mm = new THREE.Matrix4();
    bollards.forEach(([x, z], i) => { mm.makeTranslation(x, 0.35, z); inst.setMatrixAt(i, mm); });
    inst.castShadow = true;
    root.add(inst);
  }

  // water
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x16313a, roughness: 0.08, metalness: 0.15, normalMap: T.waterNormal,
    normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.3,
  });
  T.waterNormal.repeat.set(60, 30);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 600), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -1.3, 340);
  water.receiveShadow = true;
  root.add(water);

  // sky + fog
  const sky = makeSky();
  scene.add(sky);
  scene.fog = new THREE.Fog(0x8a7f86, 90, 520);
  scene.background = new THREE.Color(0x6b6f8f);

  // environment map from the sky
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(makeSky());
  const env = pmrem.fromScene(envScene, 0.04, 0.1, 2000).texture;
  scene.environment = env;
  pmrem.dispose();

  // lights
  const hemi = new THREE.HemisphereLight(0xa9b8d6, 0x4a3f36, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc999, 3.1);
  sun.position.copy(SUN_DIR).multiplyScalar(140);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  const sm = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = -78; sc.right = 78; sc.top = 70; sc.bottom = -70; sc.near = 20; sc.far = 320;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // warm lamp glow (a few real lights, the rest are sprites)
  const lightPos = [lamps[2], lamps[1], new THREE.Vector3(-4, 6.6, -1.3), new THREE.Vector3(5, 6.6, -1.3)];
  for (const p of lightPos) {
    const l = new THREE.PointLight(0xffb867, 60, 26, 2);
    l.position.copy(p);
    scene.add(l);
  }
  const glowMat = new THREE.SpriteMaterial({ map: T.glow, color: 0xffc37a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7, fog: true });
  for (const p of lamps) {
    const s = new THREE.Sprite(glowMat);
    s.position.copy(p);
    s.scale.set(3.2, 3.2, 1);
    root.add(s);
  }
  for (const x of [-6, 0, 6]) {
    const s = new THREE.Sprite(glowMat);
    s.position.set(x, 6.95, -1.3);
    s.scale.set(2.2, 2.2, 1);
    root.add(s);
  }
  // red aviation lights on the crane
  const redMat = new THREE.SpriteMaterial({ map: T.glow, color: 0xff3020, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const aviation = [];
  for (const p of [[0, 34.4, 15], [-9, 24.8, 23], [9, 24.8, 37], [0, 26.8, 84]]) {
    const s = new THREE.Sprite(redMat);
    s.position.set(p[0], p[1], p[2]);
    s.scale.set(2.4, 2.4, 1);
    root.add(s);
    aviation.push(s);
  }

  world.finalize();

  // spawn points (validated in tests)
  const spawns = [
    [-40, 0, -22, 0], [-26, 0, -28, 0], [-8, 0, -23, 0], [9, 0, -33, 0], [22, 0, -28, 0], [44, 0, -37, 0.8],
    [-46, 0, 6, -1.57], [-28, 0, 27, 3.14], [-14, 0, 33, 3.14], [3, 0, 37, 3.14], [16, 0, 25, 2.4], [36, 0, 26, 2.6],
    [46, 0, 4, 1.57], [17, 0, -4, 1.57], [-1, 0, 0, 0], [-18, 0, 9, -1.57], [44, 0, -10, 1.2], [-38, 0, -3, -1.57],
    [-41, 3.6, -36, 0.6], [28, 0, -8, 0.5],
  ].map(([x, y, z, yaw]) => ({ x, y, z, yaw }));

  const pickups = [
    { id: 0, type: 'hp', x: 0, y: 0, z: -2.2 },
    { id: 1, type: 'hp', x: -42, y: 3.6, z: -31 },
    { id: 2, type: 'hp', x: 37.5, y: 5.2, z: 6 },
    { id: 3, type: 'hp', x: 0, y: 0, z: 30 },
    { id: 4, type: 'hp', x: -38, y: 0, z: 8.5 },
    { id: 5, type: 'ammo', x: -20, y: 0, z: -27 },
    { id: 6, type: 'ammo', x: 30.5, y: 0, z: -7.4 },
    { id: 7, type: 'ammo', x: -7, y: 0, z: 23 },
    { id: 8, type: 'ammo', x: 12, y: 0, z: -22 },
    { id: 9, type: 'ammo', x: 1.5, y: 3.8, z: -7 },
    { id: 10, type: 'ammo', x: -34, y: 5.2, z: -16 },
    { id: 11, type: 'nade', x: 22, y: 0, z: 1 },
    { id: 12, type: 'nade', x: -22, y: 0, z: 3 },
  ];

  // minimap source rectangles (anything taller than a curb)
  const mini = world.boxes.filter((b) => b.walk && b.maxy > 0.5 && b.maxy < 30 && b.maxx - b.minx < 120).map((b) => ({ x0: b.minx, z0: b.minz, x1: b.maxx, z1: b.maxz, h: b.maxy }));

  const update = (t) => {
    T.waterNormal.offset.set(t * 0.004, t * 0.009);
    const blink = (Math.sin(t * 2.2) > 0.2) ? 1 : 0.15;
    for (const s of aviation) s.material.opacity = blink;
  };

  return { world, spawns, pickups, mini, lamps, update, textures: T, sun, root };
}

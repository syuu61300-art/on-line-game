export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export function wrapAngle(a) {
  if (!Number.isFinite(a)) return 0;
  if (a >= -Math.PI && a <= Math.PI) return a;
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
export function dampAngle(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const r1 = (v) => Math.round(v * 10) / 10;
export const r2 = (v) => Math.round(v * 100) / 100;
export const r3 = (v) => Math.round(v * 1000) / 1000;

// yaw 0 looks toward -Z, positive yaw turns left (three.js convention, order YXZ)
export function dirFromYawPitch(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}
export function yawTo(dx, dz) {
  return Math.atan2(-dx, -dz);
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
// random direction inside a cone around dir (unit), radius = angle in radians
export function coneDir(dir, angle, out) {
  if (angle <= 0) {
    out.x = dir.x; out.y = dir.y; out.z = dir.z;
    return out;
  }
  // build orthonormal basis
  let ux, uy, uz;
  if (Math.abs(dir.y) < 0.99) { ux = 0; uy = 1; uz = 0; } else { ux = 1; uy = 0; uz = 0; }
  // right = dir x up
  let rx = dir.y * uz - dir.z * uy, ry = dir.z * ux - dir.x * uz, rz = dir.x * uy - dir.y * ux;
  let rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
  // up2 = right x dir
  const vx = ry * dir.z - rz * dir.y, vy = rz * dir.x - rx * dir.z, vz = rx * dir.y - ry * dir.x;
  const r = angle * Math.sqrt(Math.random());
  const th = Math.random() * Math.PI * 2;
  const a = Math.tan(r) * Math.cos(th), b = Math.tan(r) * Math.sin(th);
  out.x = dir.x + rx * a + vx * b;
  out.y = dir.y + ry * a + vy * b;
  out.z = dir.z + rz * a + vz * b;
  const l = Math.hypot(out.x, out.y, out.z);
  out.x /= l; out.y /= l; out.z /= l;
  return out;
}
export function fmtTime(ms) {
  ms = Math.max(0, ms);
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
export function sanitizeText(s, max) {
  if (typeof s !== 'string') return '';
  // strip control and invisible format chars
  s = s.replace(/[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁯﻿-]/g, '');
  return s.slice(0, max).trim();
}
export function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}
export function vec3ok(a) {
  return Array.isArray(a) && a.length === 3 && isNum(a[0]) && isNum(a[1]) && isNum(a[2]) &&
    Math.abs(a[0]) < 2000 && Math.abs(a[1]) < 2000 && Math.abs(a[2]) < 2000;
}

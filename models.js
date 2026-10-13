// Low-poly procedural models: guns (shared by viewmodel + third person) and soldiers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Merge sibling meshes that share a material into one mesh (per group, recursively),
// keeping animated sub-groups and anchor objects intact. Cuts draw calls ~3-4x.
export function mergeStatic(group) {
  const byMat = new Map();
  for (const c of [...group.children]) {
    if (c.isMesh && !c.userData.keep) {
      c.updateMatrix();
      const g = c.geometry.clone().applyMatrix4(c.matrix);
      if (!byMat.has(c.material)) byMat.set(c.material, []);
      byMat.get(c.material).push(g);
      group.remove(c);
      c.geometry.dispose();
    } else if (c.isGroup || (c.isObject3D && c.children.length)) {
      mergeStatic(c);
    }
  }
  for (const [mat, geos] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos.map((g) => (g.index ? g : g)), false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true;
    group.add(m);
  }
  return group;
}

const MAT = {};
function mats() {
  if (MAT.ready) return MAT;
  const s = (o) => new THREE.MeshStandardMaterial(Object.assign({ envMapIntensity: 0.9 }, o));
  MAT.gunmetal = s({ color: 0x2c3035, roughness: 0.35, metalness: 0.75 });
  MAT.polymer = s({ color: 0x1d1f22, roughness: 0.65, metalness: 0.1 });
  MAT.tan = s({ color: 0x8f7752, roughness: 0.7, metalness: 0.05 });
  MAT.olive = s({ color: 0x4d5440, roughness: 0.7, metalness: 0.05 });
  MAT.wood = s({ color: 0x6a4325, roughness: 0.6, metalness: 0.0 });
  MAT.steel = s({ color: 0x8b9096, roughness: 0.3, metalness: 0.9 });
  MAT.brass = s({ color: 0xc9a14a, roughness: 0.3, metalness: 0.9 });
  MAT.lens = s({ color: 0x223844, roughness: 0.05, metalness: 0.9, envMapIntensity: 2 });
  MAT.dot = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  MAT.knife = s({ color: 0xb8bec4, roughness: 0.18, metalness: 1.0 });
  MAT.uniform = s({ color: 0x3a4148, roughness: 0.85 });
  MAT.uniformDark = s({ color: 0x2a2f35, roughness: 0.85 });
  MAT.skin = s({ color: 0xb98e6e, roughness: 0.75 });
  MAT.boot = s({ color: 0x1a1b1d, roughness: 0.8 });
  MAT.glove = s({ color: 0x24272b, roughness: 0.8 });
  MAT.helmet = s({ color: 0x30363c, roughness: 0.6, metalness: 0.2 });
  MAT.nade = s({ color: 0x45502f, roughness: 0.6, metalness: 0.2 });
  MAT.ready = true;
  return MAT;
}

function box(parent, w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
function cyl(parent, r, len, x, y, z, mat, seg = 10, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, len, seg);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Returns { group, muzzle, eject, mag, pump, bolt, sightY, sightZ, scope, length }
export function makeGun(id) {
  const M = mats();
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  const eject = new THREE.Object3D();
  const mag = new THREE.Group();
  let pump = null, bolt = null, sightY = 0.1, sightZ = -0.1, scope = false;
  g.add(muzzle, eject, mag);

  if (id === 'ar') {
    box(g, 0.06, 0.085, 0.36, 0, 0.03, -0.08, M.gunmetal);
    box(g, 0.026, 0.012, 0.34, 0, 0.078, -0.12, M.polymer);
    box(g, 0.066, 0.072, 0.27, 0, 0.026, -0.39, M.tan);
    for (let i = 0; i < 5; i++) box(g, 0.068, 0.01, 0.025, 0, 0.026, -0.29 - i * 0.05, M.polymer);
    cyl(g, 0.011, 0.2, 0, 0.03, -0.62, M.gunmetal);
    cyl(g, 0.017, 0.06, 0, 0.03, -0.74, M.polymer, 8);
    box(g, 0.012, 0.05, 0.012, 0, 0.07, -0.5, M.polymer);
    box(g, 0.04, 0.11, 0.05, 0, -0.065, 0.04, M.polymer, -0.3);
    box(g, 0.05, 0.075, 0.2, 0, 0.012, 0.2, M.tan);
    box(g, 0.054, 0.09, 0.02, 0, 0.0, 0.31, M.polymer);
    box(g, 0.02, 0.03, 0.12, 0, -0.025, 0.12, M.polymer);
    box(mag, 0.044, 0.11, 0.075, 0, -0.07, -0.13, M.polymer, 0.12);
    box(mag, 0.044, 0.1, 0.07, 0, -0.165, -0.115, M.polymer, 0.35);
    // reflex sight
    box(g, 0.036, 0.012, 0.08, 0, 0.09, -0.12, M.polymer);
    box(g, 0.006, 0.05, 0.05, -0.016, 0.115, -0.13, M.polymer);
    box(g, 0.006, 0.05, 0.05, 0.016, 0.115, -0.13, M.polymer);
    box(g, 0.038, 0.006, 0.05, 0, 0.142, -0.13, M.polymer);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 6, 4), M.dot);
    dot.position.set(0, 0.117, -0.16); g.add(dot);
    sightY = 0.117; sightZ = -0.12;
    muzzle.position.set(0, 0.03, -0.78);
    eject.position.set(0.035, 0.05, -0.08);
  } else if (id === 'smg') {
    box(g, 0.055, 0.08, 0.3, 0, 0.03, -0.06, M.olive);
    box(g, 0.025, 0.012, 0.22, 0, 0.076, -0.08, M.polymer);
    cyl(g, 0.024, 0.18, 0, 0.032, -0.3, M.polymer, 12);
    cyl(g, 0.01, 0.04, 0, 0.032, -0.41, M.gunmetal);
    box(g, 0.038, 0.1, 0.045, 0, -0.06, 0.04, M.polymer, -0.25);
    box(g, 0.035, 0.07, 0.04, 0, -0.03, -0.24, M.polymer, 0.2); // foregrip
    box(g, 0.01, 0.01, 0.2, 0.022, 0.03, 0.17, M.steel);
    box(g, 0.01, 0.01, 0.2, -0.022, 0.03, 0.17, M.steel);
    box(g, 0.054, 0.06, 0.015, 0, 0.02, 0.27, M.polymer);
    box(mag, 0.038, 0.2, 0.05, 0, -0.1, -0.1, M.polymer, 0.05);
    box(g, 0.03, 0.03, 0.05, 0, 0.098, -0.07, M.polymer);
    box(g, 0.03, 0.006, 0.05, 0, 0.115, -0.07, M.polymer);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.002, 6, 4), M.dot);
    dot.position.set(0, 0.1, -0.096); g.add(dot);
    sightY = 0.1; sightZ = -0.07;
    muzzle.position.set(0, 0.032, -0.44);
    eject.position.set(0.03, 0.05, -0.05);
  } else if (id === 'sg') {
    box(g, 0.06, 0.08, 0.24, 0, 0.03, -0.04, M.gunmetal);
    cyl(g, 0.014, 0.52, 0, 0.052, -0.42, M.gunmetal);
    cyl(g, 0.012, 0.42, 0, 0.018, -0.36, M.gunmetal);
    pump = new THREE.Group(); g.add(pump);
    box(pump, 0.052, 0.05, 0.16, 0, 0.016, -0.36, M.wood);
    for (let i = 0; i < 4; i++) box(pump, 0.054, 0.006, 0.01, 0, 0.016, -0.31 - i * 0.03, M.polymer);
    box(g, 0.04, 0.11, 0.05, 0, -0.055, 0.08, M.wood, -0.35);
    box(g, 0.05, 0.085, 0.28, 0, -0.005, 0.24, M.wood, 0.12);
    box(g, 0.054, 0.09, 0.02, 0, -0.025, 0.38, M.polymer, 0.12);
    box(g, 0.008, 0.012, 0.008, 0, 0.072, -0.67, M.brass);
    box(g, 0.02, 0.012, 0.02, 0, 0.075, -0.02, M.gunmetal);
    sightY = 0.078; sightZ = -0.02;
    muzzle.position.set(0, 0.052, -0.69);
    eject.position.set(0.035, 0.045, -0.02);
  } else if (id === 'sr') {
    box(g, 0.06, 0.08, 0.34, 0, 0.03, -0.04, M.olive);
    cyl(g, 0.013, 0.6, 0, 0.04, -0.5, M.gunmetal);
    cyl(g, 0.02, 0.09, 0, 0.04, -0.82, M.gunmetal, 10);
    // scope
    cyl(g, 0.02, 0.28, 0, 0.118, -0.08, M.polymer, 14);
    cyl(g, 0.028, 0.06, 0, 0.118, -0.25, M.polymer, 14, 0.02);
    cyl(g, 0.026, 0.05, 0, 0.118, 0.07, M.polymer, 14, 0.02);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.025, 14), M.lens);
    lens.position.set(0, 0.118, 0.096); g.add(lens);
    box(g, 0.026, 0.04, 0.02, 0, 0.088, -0.17, M.polymer);
    box(g, 0.026, 0.04, 0.02, 0, 0.088, 0.02, M.polymer);
    bolt = new THREE.Group(); g.add(bolt);
    cyl(bolt, 0.008, 0.05, 0.045, 0.045, 0.06, M.steel).rotation.set(0, Math.PI / 2, 0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), M.steel);
    knob.position.set(0.07, 0.045, 0.06); bolt.add(knob);
    box(g, 0.04, 0.11, 0.05, 0, -0.06, 0.1, M.olive, -0.3);
    box(g, 0.055, 0.1, 0.34, 0, 0.0, 0.3, M.olive, 0.05);
    box(g, 0.045, 0.04, 0.16, 0, 0.065, 0.28, M.olive);
    box(g, 0.058, 0.11, 0.02, 0, -0.01, 0.47, M.polymer, 0.05);
    box(mag, 0.04, 0.07, 0.07, 0, -0.04, -0.06, M.polymer);
    box(g, 0.012, 0.03, 0.18, 0.02, -0.02, -0.55, M.gunmetal); // folded bipod
    box(g, 0.012, 0.03, 0.18, -0.02, -0.02, -0.55, M.gunmetal);
    sightY = 0.118; sightZ = -0.08; scope = true;
    muzzle.position.set(0, 0.04, -0.87);
    eject.position.set(0.035, 0.05, -0.04);
  } else if (id === 'lmg') {
    box(g, 0.08, 0.11, 0.42, 0, 0.035, -0.06, M.gunmetal);
    box(g, 0.06, 0.06, 0.3, 0, 0.04, -0.42, M.polymer);
    for (let i = 0; i < 6; i++) box(g, 0.062, 0.025, 0.02, 0, 0.04, -0.3 - i * 0.045, M.gunmetal);
    cyl(g, 0.016, 0.3, 0, 0.04, -0.65, M.gunmetal);
    cyl(g, 0.022, 0.07, 0, 0.04, -0.82, M.polymer, 8);
    box(g, 0.012, 0.05, 0.16, -0.034, 0.1, -0.12, M.polymer); // carry handle (offset left of the sight line)
    box(g, 0.012, 0.012, 0.18, -0.034, 0.128, -0.12, M.polymer);
    box(g, 0.042, 0.11, 0.05, 0, -0.07, 0.06, M.polymer, -0.3);
    box(g, 0.06, 0.09, 0.22, 0, 0.01, 0.24, M.polymer);
    box(mag, 0.1, 0.12, 0.13, -0.03, -0.08, -0.1, M.olive);
    box(mag, 0.03, 0.03, 0.06, -0.01, -0.02, -0.1, M.olive);
    box(g, 0.014, 0.03, 0.2, 0.024, -0.02, -0.55, M.gunmetal);
    box(g, 0.014, 0.03, 0.2, -0.024, -0.02, -0.55, M.gunmetal);
    box(g, 0.02, 0.03, 0.012, 0, 0.11, -0.7, M.polymer);
    box(g, 0.03, 0.025, 0.012, 0, 0.105, 0.08, M.polymer);
    sightY = 0.112; sightZ = 0.08;
    muzzle.position.set(0, 0.04, -0.86);
    eject.position.set(0.045, 0.05, -0.1);
  } else if (id === 'pistol') {
    bolt = new THREE.Group(); g.add(bolt); // slide
    box(bolt, 0.034, 0.04, 0.2, 0, 0.045, -0.06, M.gunmetal);
    for (let i = 0; i < 5; i++) box(bolt, 0.036, 0.03, 0.006, 0, 0.045, 0.01 + i * 0.012, M.polymer);
    box(g, 0.03, 0.03, 0.16, 0, 0.012, -0.05, M.polymer);
    box(g, 0.032, 0.11, 0.048, 0, -0.04, 0.02, M.polymer, -0.22);
    box(mag, 0.026, 0.04, 0.036, 0, -0.1, 0.035, M.gunmetal, -0.22);
    box(g, 0.006, 0.01, 0.006, 0, 0.07, -0.15, M.dot);
    box(g, 0.022, 0.01, 0.008, 0, 0.07, 0.03, M.polymer);
    box(g, 0.01, 0.02, 0.04, 0, -0.005, -0.02, M.polymer);
    sightY = 0.074; sightZ = 0.03;
    muzzle.position.set(0, 0.045, -0.17);
    eject.position.set(0.02, 0.06, -0.04);
  } else if (id === 'knife') {
    const blade = box(g, 0.005, 0.032, 0.17, 0, 0.0, -0.13, M.knife);
    blade.scale.set(1, 1, 1);
    box(g, 0.003, 0.012, 0.15, 0, 0.018, -0.12, M.knife);
    box(g, 0.05, 0.012, 0.016, 0, 0, -0.04, M.gunmetal);
    box(g, 0.024, 0.03, 0.11, 0, -0.004, 0.02, M.polymer);
    sightY = 0; sightZ = 0;
    muzzle.position.set(0, 0, -0.22);
  } else if (id === 'grenade') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), M.nade);
    b.scale.set(1, 1.2, 1); g.add(b);
    box(g, 0.02, 0.03, 0.02, 0, 0.06, 0, M.steel);
    box(g, 0.012, 0.06, 0.006, 0.02, 0.03, 0, M.steel, 0, 0, 0.3);
  }

  mergeStatic(g);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { group: g, muzzle, eject, mag, pump, bolt, sightY, sightZ, scope };
}

// ---------------- character ----------------
function limb(parent, from, to, w, d, mat) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function makeCharacter(color) {
  const M = mats();
  const col = new THREE.Color(color);
  const vest = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.75), roughness: 0.75 });
  const accent = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, emissive: col, emissiveIntensity: 0.35 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.1, metalness: 0.6, emissive: col, emissiveIntensity: 0.9 });

  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
  const mk = (p, w, h, d, x, y, z, m) => { const b = box(p, w, h, d, x, y, z, m); b.castShadow = true; return b; };

  const leg = (side) => {
    const thigh = new THREE.Group(); thigh.position.set(0.11 * side, 0, 0); hips.add(thigh);
    mk(thigh, 0.17, 0.46, 0.19, 0, -0.23, 0, M.uniform);
    mk(thigh, 0.18, 0.12, 0.2, 0, -0.1, 0, M.uniformDark);
    const knee = new THREE.Group(); knee.position.y = -0.46; thigh.add(knee);
    mk(knee, 0.15, 0.4, 0.17, 0, -0.2, 0, M.uniform);
    mk(knee, 0.17, 0.1, 0.19, 0, -0.02, -0.01, vest); // knee pad
    mk(knee, 0.16, 0.08, 0.27, 0, -0.42, -0.04, M.boot);
    return { thigh, knee };
  };
  const L = leg(-1), Rg = leg(1);

  const torso = new THREE.Group(); hips.add(torso);
  mk(torso, 0.42, 0.56, 0.24, 0, 0.29, 0, M.uniform);
  mk(torso, 0.46, 0.4, 0.3, 0, 0.32, 0, vest);
  mk(torso, 0.44, 0.07, 0.27, 0, 0.03, 0, M.boot); // belt
  mk(torso, 0.1, 0.1, 0.06, -0.12, 0.25, -0.17, M.uniformDark); // pouches
  mk(torso, 0.1, 0.1, 0.06, 0.0, 0.25, -0.17, M.uniformDark);
  mk(torso, 0.1, 0.1, 0.06, 0.12, 0.25, -0.17, M.uniformDark);
  mk(torso, 0.3, 0.32, 0.12, 0, 0.32, 0.19, M.uniformDark); // backpack
  mk(torso, 0.31, 0.04, 0.13, 0, 0.42, 0.19, accent);

  const neck = new THREE.Group(); neck.position.y = 0.6; torso.add(neck);
  const head = new THREE.Group(); neck.add(head);
  mk(head, 0.22, 0.25, 0.23, 0, 0.13, 0, M.skin);
  mk(head, 0.27, 0.13, 0.28, 0, 0.25, 0.01, M.helmet);
  mk(head, 0.28, 0.03, 0.29, 0, 0.2, 0.01, accent);
  mk(head, 0.2, 0.06, 0.03, 0, 0.15, -0.115, visor);
  mk(head, 0.22, 0.08, 0.04, 0, 0.04, -0.105, M.uniformDark); // face wrap

  const aim = new THREE.Group(); aim.position.set(0, 0.5, 0); torso.add(aim);
  const gunMount = new THREE.Group(); gunMount.position.set(0.1, -0.1, -0.24); aim.add(gunMount);
  // arms (static pose in aim space)
  const shR = new THREE.Vector3(0.24, 0.0, 0), shL = new THREE.Vector3(-0.24, 0.0, 0);
  const handR = new THREE.Vector3(0.1, -0.16, -0.22), handL = new THREE.Vector3(0.06, -0.08, -0.5);
  const elbR = new THREE.Vector3(0.27, -0.26, -0.06), elbL = new THREE.Vector3(-0.12, -0.24, -0.3);
  limb(aim, shR, elbR, 0.11, 0.12, M.uniform);
  limb(aim, elbR, handR, 0.09, 0.1, M.uniform);
  limb(aim, shL, elbL, 0.11, 0.12, M.uniform);
  limb(aim, elbL, handL, 0.09, 0.1, M.uniform);
  mk(aim, 0.07, 0.07, 0.08, handR.x, handR.y, handR.z, M.glove);
  mk(aim, 0.07, 0.07, 0.08, handL.x, handL.y, handL.z, M.glove);
  mk(aim, 0.14, 0.12, 0.14, 0.24, 0.0, 0, vest); // shoulder pads
  mk(aim, 0.14, 0.12, 0.14, -0.24, 0.0, 0, vest);

  mergeStatic(root);

  let gun = null, gunId = '';
  const setWeapon = (id) => {
    if (id === gunId) return;
    gunId = id;
    if (gun) gunMount.remove(gun.group);
    gun = makeGun(id === 'grenade' ? 'pistol' : id);
    gun.group.scale.setScalar(1.05);
    gunMount.add(gun.group);
  };

  const charMats = [vest, accent, visor];
  return {
    root, hips, torso, head, neck, aim, gunMount,
    legL: L, legR: Rg, mats: charMats, accent, visor,
    setWeapon,
    get gun() { return gun; },
  };
}

export function makeGrenadeMesh() {
  const M = mats();
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), M.nade);
  b.scale.set(1, 1.2, 1); g.add(b);
  box(g, 0.025, 0.035, 0.025, 0, 0.075, 0, M.steel);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function sharedMats() { return mats(); }

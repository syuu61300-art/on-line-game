// ===== PIER 7 — game constants =====
export const NET_VERSION = 3;

export const PLAYER = {
  radius: 0.3,
  height: 1.8,
  crouchHeight: 1.25,
  eye: 1.62,
  crouchEye: 1.08,
  walk: 5.0,
  sprint: 7.3,
  crouchSpeed: 2.5,
  adsSpeed: 3.1,
  jump: 6.7,
  gravity: 20,
  accel: 52,
  airAccel: 9,
  friction: 11,
  step: 0.46,
  maxHp: 100,
  regenDelay: 5.0,
  regenRate: 24,
  respawn: 3.6,
  spawnProtect: 1.6,
};

export const MATCH = {
  duration: 8 * 60 * 1000,
  killLimit: 30,
  intermission: 12000,
};

// Damage zones
export const ZONE_BODY = 0, ZONE_HEAD = 1, ZONE_LIMB = 2;

// All weapon names are fictional.
// spread values are cone radii in radians.
export const WEAPONS = {
  ar: {
    id: 'ar', name: 'KR-7 ストーム', cls: 'アサルトライフル', slot: 0, auto: true,
    rpm: 660, dmg: 27, head: 1.9, limb: 0.85, falloff: [24, 55, 0.72], pellets: 1,
    mag: 30, reserve: 150, reload: 2.05, reloadEmpty: 2.55,
    spread: { hip: 0.030, ads: 0.0035, move: 0.028, air: 0.08, crouch: 0.75, bloom: 0.0055, bloomMax: 0.028, recover: 0.11 },
    recoil: { v: 0.0105, h: 0.0042, punch: 0.45 },
    adsFov: 52, adsTime: 0.2, moveMul: 0.95, range: 260, draw: 0.45,
    sound: { crack: 1500, body: 95, tail: 0.42, gain: 0.9 },
    stats: { 威力: 0.55, 連射: 0.7, 精度: 0.7, 機動: 0.65, 射程: 0.7 },
    desc: '癖が少なく中距離で強い。迷ったらこれ。',
  },
  smg: {
    id: 'smg', name: 'VX-9 ワスプ', cls: 'サブマシンガン', slot: 0, auto: true,
    rpm: 920, dmg: 19, head: 1.6, limb: 0.9, falloff: [10, 32, 0.6], pellets: 1,
    mag: 34, reserve: 170, reload: 1.7, reloadEmpty: 2.1,
    spread: { hip: 0.024, ads: 0.0075, move: 0.012, air: 0.05, crouch: 0.8, bloom: 0.0035, bloomMax: 0.022, recover: 0.13 },
    recoil: { v: 0.0062, h: 0.0058, punch: 0.5 },
    adsFov: 60, adsTime: 0.15, moveMul: 1.06, range: 160, draw: 0.35,
    sound: { crack: 2100, body: 120, tail: 0.28, gain: 0.75 },
    stats: { 威力: 0.38, 連射: 0.95, 精度: 0.5, 機動: 0.92, 射程: 0.35 },
    desc: '高速連射と機動力。近距離の撃ち合いに。',
  },
  sg: {
    id: 'sg', name: 'BR-12 ブルドッグ', cls: 'ショットガン', slot: 0, auto: false,
    rpm: 72, dmg: 13, head: 1.35, limb: 0.9, falloff: [7, 22, 0.25], pellets: 9, pelletSpread: 0.068, pelletSpreadAds: 0.052,
    mag: 7, reserve: 35, shellReload: true, reloadStart: 0.35, reloadShell: 0.47, reload: 0.47, reloadEmpty: 0.47,
    spread: { hip: 0.012, ads: 0.006, move: 0.01, air: 0.03, crouch: 0.9, bloom: 0, bloomMax: 0, recover: 0.2 },
    recoil: { v: 0.05, h: 0.012, punch: 0.65 },
    adsFov: 64, adsTime: 0.2, moveMul: 0.98, range: 60, draw: 0.5, pump: true,
    sound: { crack: 900, body: 70, tail: 0.6, gain: 1.1 },
    stats: { 威力: 1.0, 連射: 0.2, 精度: 0.3, 機動: 0.75, 射程: 0.15 },
    desc: '至近距離なら一撃。ポンプアクション。',
  },
  sr: {
    id: 'sr', name: 'LX-50 ファルコン', cls: 'スナイパーライフル', slot: 0, auto: false,
    rpm: 46, dmg: 92, head: 2.3, limb: 0.85, falloff: [90, 220, 0.9], pellets: 1,
    mag: 5, reserve: 25, reload: 2.8, reloadEmpty: 3.3,
    spread: { hip: 0.095, ads: 0.0, move: 0.07, air: 0.15, crouch: 0.85, bloom: 0, bloomMax: 0, recover: 0.2 },
    recoil: { v: 0.065, h: 0.01, punch: 0.75 },
    adsFov: 17, adsTime: 0.32, moveMul: 0.88, range: 400, draw: 0.6, bolt: true, scope: true,
    sound: { crack: 1100, body: 60, tail: 1.1, gain: 1.25 },
    stats: { 威力: 1.0, 連射: 0.1, 精度: 1.0, 機動: 0.4, 射程: 1.0 },
    desc: '4倍スコープ。頭なら一撃、体でもほぼ一撃。',
  },
  lmg: {
    id: 'lmg', name: 'HG-80 ハンマー', cls: 'ライトマシンガン', slot: 0, auto: true,
    rpm: 620, dmg: 30, head: 1.7, limb: 0.85, falloff: [30, 65, 0.75], pellets: 1,
    mag: 80, reserve: 160, reload: 4.3, reloadEmpty: 4.9,
    spread: { hip: 0.044, ads: 0.0065, move: 0.04, air: 0.1, crouch: 0.65, bloom: 0.004, bloomMax: 0.03, recover: 0.08 },
    recoil: { v: 0.0115, h: 0.0062, punch: 0.4 },
    adsFov: 54, adsTime: 0.3, moveMul: 0.83, range: 260, draw: 0.75,
    sound: { crack: 1250, body: 80, tail: 0.5, gain: 1.0 },
    stats: { 威力: 0.62, 連射: 0.68, 精度: 0.55, 機動: 0.3, 射程: 0.75 },
    desc: '80発の大容量。足は遅いが押し切れる。',
  },
  pistol: {
    id: 'pistol', name: 'P-11 ホーネット', cls: 'ハンドガン', slot: 1, auto: false,
    rpm: 400, dmg: 29, head: 1.9, limb: 0.9, falloff: [14, 40, 0.65], pellets: 1,
    mag: 13, reserve: 65, reload: 1.35, reloadEmpty: 1.6,
    spread: { hip: 0.016, ads: 0.003, move: 0.012, air: 0.04, crouch: 0.85, bloom: 0.006, bloomMax: 0.02, recover: 0.15 },
    recoil: { v: 0.02, h: 0.005, punch: 0.6 },
    adsFov: 62, adsTime: 0.14, moveMul: 1.06, range: 150, draw: 0.3,
    sound: { crack: 1800, body: 110, tail: 0.3, gain: 0.7 },
    stats: { 威力: 0.5, 連射: 0.45, 精度: 0.7, 機動: 0.95, 射程: 0.4 },
    desc: 'サブウェポン。',
  },
  knife: {
    id: 'knife', name: 'タクティカルナイフ', cls: '近接', slot: 2, melee: true,
    dmg: 55, backstab: 120, range: 2.2, swing: 0.55, moveMul: 1.1, draw: 0.25,
    spread: { hip: 0, ads: 0, move: 0, air: 0, crouch: 1, bloom: 0, bloomMax: 0, recover: 1 },
    recoil: { v: 0, h: 0, punch: 0 }, adsFov: 80, adsTime: 0.1,
    stats: {}, desc: '背後からなら一撃。',
  },
  grenade: { id: 'grenade', name: 'フラグ', cls: '投擲' },
  bash: { id: 'bash', name: '銃床打撃', cls: '近接' },
  fall: { id: 'fall', name: '落下', cls: '' },
};

export const PRIMARIES = ['ar', 'smg', 'sg', 'sr', 'lmg'];
export const WEAPON_CODES = ['ar', 'smg', 'sg', 'sr', 'lmg', 'pistol', 'knife', 'grenade', 'bash', 'fall'];

// Recoil every firearm gets on top of its own pattern, for players and bots alike.
// It is not reduced by ADS or crouching and there is no setting that changes it.
export const FORCED_RECOIL = { v: 0.0036, h: 0.0018, punch: 0.5 };

export const GRENADE = { count: 2, fuse: 2.3, radius: 6.8, maxDmg: 120, throwSpeed: 17.5 };
export const MELEE_BASH = { dmg: 50, range: 2.0, time: 0.5 };

export const COLORS = [
  '#e8a33d', '#3fb8a8', '#e0604e', '#8796e0', '#9cc95a', '#cf7fc0',
  '#efe2c4', '#5bb6e8', '#e49162', '#93dcbf', '#f2cf4e', '#c08a6a',
];

export const BOT_NAMES = ['アンカー', 'ボラード', 'ブイ', 'ガントリー', 'タグボート', 'ホーサー', 'ドック', 'リーファー'];

export const DIFFICULTY = {
  easy:   { label: 'やさしい', react: [0.55, 0.9], aimErr: 0.11, turn: 3.2, burst: [2, 5], pause: [0.45, 0.9], hsChance: 0.05, fov: 0.9, recoilComp: 4 },
  normal: { label: 'ふつう',   react: [0.32, 0.55], aimErr: 0.065, turn: 5.0, burst: [3, 7], pause: [0.28, 0.6], hsChance: 0.15, fov: 1.05, recoilComp: 6 },
  hard:   { label: 'つよい',   react: [0.18, 0.32], aimErr: 0.035, turn: 8.0, burst: [4, 10], pause: [0.15, 0.35], hsChance: 0.32, fov: 1.25, recoilComp: 9 },
};

export const DEFAULT_SETTINGS = {
  name: '',
  sens: 1.0,
  adsSens: 0.75,
  fov: 75,
  volume: 0.8,
  quality: 'high',
  showFps: false,
  invertY: false,
  primary: 'ar',
  botCount: 4,
  difficulty: 'normal',
  room: 'pier7',
  mode: 'online',
};

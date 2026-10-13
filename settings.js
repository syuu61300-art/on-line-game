// Player settings: schema with allowed ranges, validation, key bindings, touch layout.
// Only preferences that do not change the balance between players live here.
// Everything loaded from storage is clamped back into these ranges, so editing
// saved data cannot unlock values the menu does not offer.
import { PRIMARIES } from './config.js';
import { sanitizeText } from './util.js';

const KEY = 'pier7.settings.v1';

// ---------- actions that can be rebound ----------
export const ACTIONS = [
  { id: 'forward', label: '前進', def: 'KeyW' },
  { id: 'back', label: '後退', def: 'KeyS' },
  { id: 'left', label: '左へ移動', def: 'KeyA' },
  { id: 'right', label: '右へ移動', def: 'KeyD' },
  { id: 'fire', label: '射撃', def: 'Mouse0' },
  { id: 'ads', label: 'エイム（ADS）', def: 'Mouse2' },
  { id: 'jump', label: 'ジャンプ', def: 'Space' },
  { id: 'crouch', label: 'しゃがむ', def: 'KeyC' },
  { id: 'sprint', label: 'ダッシュ', def: 'ShiftLeft' },
  { id: 'reload', label: 'リロード', def: 'KeyR' },
  { id: 'grenade', label: 'グレネード', def: 'KeyG' },
  { id: 'melee', label: '近接攻撃', def: 'KeyV' },
  { id: 'slot1', label: 'メイン武器', def: 'Digit1' },
  { id: 'slot2', label: 'サブ武器', def: 'Digit2' },
  { id: 'slot3', label: 'ナイフ', def: 'Digit3' },
  { id: 'next', label: '武器を持ち替え', def: 'KeyQ' },
  { id: 'score', label: 'スコア表示', def: 'Tab' },
  { id: 'chat', label: 'チャット', def: 'Enter' },
];
export const DEFAULT_BINDS = Object.fromEntries(ACTIONS.map((a) => [a.id, a.def]));

const BINDABLE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9A-Za-z]+|F([1-9]|1[0-2])|Mouse[0-4]|Space|Enter|Tab|Backspace|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|CapsLock|ShiftLeft|ShiftRight|AltLeft|AltRight|Arrow(Up|Down|Left|Right)|Insert|Delete|Home|End|PageUp|PageDown|IntlRo|IntlYen|IntlBackslash|Lang[12]|NonConvert|Convert|KanaMode)$/;

// why a key cannot be used, or '' if it can
export function bindRefusal(code) {
  if (code === 'Escape') return 'Esc はメニュー用に固定されています';
  if (/^(Control|Meta|OS)/.test(code)) return 'Ctrl / ⌘ はブラウザのショートカット（Ctrl+W でタブが閉じる等）と重なるため使えません';
  if (!BINDABLE.test(code)) return 'このキーは割り当てできません';
  return '';
}

const NAMES = {
  Mouse0: '左クリック', Mouse1: 'ホイールクリック', Mouse2: '右クリック', Mouse3: 'マウス4', Mouse4: 'マウス5',
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'BackSpace', CapsLock: 'CapsLock',
  ShiftLeft: '左Shift', ShiftRight: '右Shift', AltLeft: '左Alt', AltRight: '右Alt',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  IntlRo: 'ろ', IntlYen: '¥', IntlBackslash: '\\', Lang1: 'かな', Lang2: '英数', NonConvert: '無変換', Convert: '変換', KanaMode: 'カナ',
  Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
};
export function keyName(code) {
  if (!code) return '未設定';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'テンキー' + code.slice(6);
  return code;
}

// ---------- touch buttons (centre position measured from the nearest screen edges) ----------
export const TOUCH_BUTTONS = [
  { id: 'fire', label: '射撃', size: 84, def: { h: 'r', x: 76, v: 'b', y: 162 } },
  { id: 'fire2', label: '射撃', size: 64, def: { h: 'l', x: 62, v: 'b', y: 232 } },
  { id: 'ads', label: 'ADS', size: 58, def: { h: 'r', x: 163, v: 'b', y: 181 } },
  { id: 'jump', label: 'ジャンプ', size: 58, def: { h: 'r', x: 163, v: 'b', y: 105 } },
  { id: 'crouch', label: 'しゃがむ', size: 58, def: { h: 'r', x: 95, v: 'b', y: 64 } },
  { id: 'reload', label: 'リロード', size: 58, def: { h: 'r', x: 66, v: 'b', y: 252 } },
  { id: 'swap', label: '武器', size: 58, def: { h: 'r', x: 134, v: 'b', y: 258 } },
  { id: 'nade', label: '投擲', size: 58, def: { h: 'r', x: 200, v: 'b', y: 258 } },
  { id: 'sprint', label: 'ダッシュ', size: 58, def: { h: 'l', x: 58, v: 'b', y: 152 } },
  { id: 'pause', label: 'II', size: 44, def: { h: 'r', x: 38, v: 't', y: 222 } },
];

// ---------- schema ----------
const num = (min, max, def) => ({ t: 'n', min, max, def });
const en = (vals, def) => ({ t: 'e', vals, def });
const bool = (def) => ({ t: 'b', def });
const str = (max, def) => ({ t: 's', max, def });

export const SCHEMA = {
  // profile / match setup
  name: str(14, ''),
  room: str(40, 'pier7'),
  mode: en(['online', 'offline'], 'online'),
  primary: en(PRIMARIES, 'ar'),
  botCount: en([0, 1, 2, 3, 4, 5, 6, 8], 4),     // offline, or room host only
  difficulty: en(['easy', 'normal', 'hard'], 'normal'),
  // controls
  sens: num(0.2, 3, 1),
  adsSens: num(0.3, 1.5, 0.75),
  invertY: bool(false),
  adsMode: en(['hold', 'toggle'], 'hold'),
  crouchMode: en(['hold', 'toggle'], 'hold'),
  sprintMode: en(['hold', 'toggle'], 'hold'),
  touchSens: num(0.4, 2.5, 1),
  touchScale: num(0.7, 1.4, 1),
  touchOpacity: num(0.3, 1, 0.85),
  // video (shadows, smoke and fog stay on in every preset)
  quality: en(['high', 'medium', 'low'], 'high'),
  renderScale: num(0.5, 1, 1),
  aa: bool(true),
  fov: num(65, 90, 75),
  camBob: num(0, 1, 1),
  showFps: bool(false),
  // audio (no separate footsteps volume)
  volume: num(0, 1, 0.8),
  sfxVol: num(0, 1, 1),
  ambVol: num(0, 1, 0.6),
  uiVol: num(0, 1, 0.8),
  // HUD
  crossColor: en(['paper', 'yellow', 'cyan', 'green', 'magenta'], 'paper'),
  crossStyle: en(['both', 'cross', 'dot'], 'both'),
  hudScale: num(0.8, 1.2, 1),
  showChat: bool(true),
};

export const CROSS_COLORS = { paper: '#ece4d2', yellow: '#ffd23f', cyan: '#5fe3ff', green: '#7dff8a', magenta: '#ff6ad5' };

export function defaults() {
  const out = {};
  for (const [k, d] of Object.entries(SCHEMA)) out[k] = d.def;
  out.binds = { ...DEFAULT_BINDS };
  out.touchLayout = {};
  let coarse = false;
  try { coarse = matchMedia('(pointer: coarse)').matches; } catch {}
  if (coarse) { out.quality = 'low'; out.aa = false; }
  return out;
}

function cleanBinds(raw) {
  const out = {};
  const used = new Set();
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const a of ACTIONS) {
    let c = typeof src[a.id] === 'string' ? src[a.id] : a.def;
    if (c && (bindRefusal(c) || used.has(c))) c = '';
    out[a.id] = c;
    if (c) used.add(c);
  }
  // give unbound actions their default back when that key is free
  for (const a of ACTIONS) if (!out[a.id] && !used.has(a.def)) { out[a.id] = a.def; used.add(a.def); }
  return out;
}

function cleanLayout(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const b of TOUCH_BUTTONS) {
    const L = raw[b.id];
    if (!L || typeof L !== 'object') continue;
    const x = Number(L.x), y = Number(L.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out[b.id] = { h: L.h === 'l' ? 'l' : 'r', x: Math.max(0, Math.min(3000, x)), v: L.v === 't' ? 't' : 'b', y: Math.max(0, Math.min(3000, y)) };
  }
  return out;
}

export function sanitize(raw) {
  const base = defaults();
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [k, d] of Object.entries(SCHEMA)) {
    const v = src[k];
    if (d.t === 'n') { const n = Number(v); out[k] = Number.isFinite(n) ? Math.min(d.max, Math.max(d.min, n)) : base[k]; }
    else if (d.t === 'e') out[k] = d.vals.includes(v) ? v : base[k];
    else if (d.t === 'b') out[k] = typeof v === 'boolean' ? v : base[k];
    else if (d.t === 's') out[k] = typeof v === 'string' ? sanitizeText(v, d.max) : base[k];
  }
  out.binds = cleanBinds(src.binds);
  out.touchLayout = cleanLayout(src.touchLayout);
  return out;
}

export function loadSettings() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  return sanitize(raw);
}

export function saveSettings(s) {
  // write back only clean values
  const clean = sanitize(s);
  Object.assign(s, clean);
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch {}
}

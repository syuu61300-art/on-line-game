import { Game } from './game.js';
import { WEAPONS, PRIMARIES, DIFFICULTY, NET_VERSION } from './config.js';
import { pickTransport } from './net.js';
import { sanitizeText } from './util.js';
import { loadSettings, saveSettings, sanitize, ACTIONS, keyName } from './settings.js';
import { createSettingsUI } from './settings-ui.js';

const $ = (id) => document.getElementById(id);
function roomSlug(s) {
  s = String(s || '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 40);
  return s || 'pier7';
}
const CALLSIGNS = ['カモメ', 'ウミネコ', 'クレーン', 'ボラード', 'ガントリー', 'タグ', 'ブイ', 'アンカー', 'ハーバー', 'リーファー'];

async function start(hotData) {
  // every value is validated and clamped to the allowed ranges
  const settings = hotData && hotData.settings ? sanitize(hotData.settings) : loadSettings();
  let transport = null;
  if (!settings.name) settings.name = CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)] + Math.floor(10 + Math.random() * 89);
  try { window.claude && window.claude.hot && window.claude.hot.snapshot && window.claude.hot.snapshot(() => ({ settings })); } catch {}

  let game;
  try {
    game = new Game($('game'), settings);
  } catch (e) {
    console.error(e);
    $('loadmsg').textContent = 'WebGLを初期化できませんでした。ハードウェアアクセラレーションを有効にしてください。';
    return;
  }
  window.__pier7 = game;
  const save = () => saveSettings(settings);
  game.onSettingsChanged = save;

  // ---------------- menu ----------------
  const nameIn = $('nameIn');
  nameIn.value = settings.name;
  nameIn.addEventListener('input', () => { settings.name = sanitizeText(nameIn.value, 14); save(); });

  const wcards = $('wcards');
  const renderDetail = () => {
    const d = WEAPONS[settings.primary];
    const det = $('wdetail');
    det.textContent = '';
    const desc = document.createElement('div'); desc.className = 'wd-desc';
    desc.textContent = `${d.name} — ${d.desc}`;
    det.appendChild(desc);
    for (const [k, v] of Object.entries(d.stats)) {
      const s = document.createElement('div'); s.className = 'stat';
      const lab = document.createElement('span'); lab.textContent = k;
      const bar = document.createElement('div'); bar.className = 'bar';
      const fill = document.createElement('i'); fill.style.width = Math.round(v * 100) + '%';
      bar.appendChild(fill); s.append(lab, bar); det.appendChild(s);
    }
  };
  const renderCards = () => {
    wcards.textContent = '';
    PRIMARIES.forEach((id, i) => {
      const d = WEAPONS[id];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'wcard';
      b.setAttribute('aria-pressed', String(settings.primary === id));
      const k = document.createElement('span'); k.className = 'wk'; k.textContent = String(i + 1).padStart(2, '0');
      const n = document.createElement('span'); n.className = 'wn'; n.textContent = d.name.split(' ')[0];
      const c = document.createElement('span'); c.className = 'wc'; c.textContent = d.cls;
      b.append(k, n, c);
      b.addEventListener('click', () => { settings.primary = id; save(); renderCards(); });
      wcards.appendChild(b);
    });
    renderDetail();
  };
  renderCards();

  const seg = (el, items, key, after) => {
    el.textContent = '';
    for (const [val, label] of items) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.setAttribute('aria-pressed', String(settings[key] === val));
      b.addEventListener('click', () => { settings[key] = val; save(); seg(el, items, key, after); after && after(); });
      el.appendChild(b);
    }
  };
  const updateDeploySub = () => {
    $('deploySub').textContent = settings.mode === 'online' && transport ? `ROOM · ${roomSlug($('roomIn').value).toUpperCase()}` : `BOT × ${settings.botCount}`;
  };
  seg($('segBots'), [0, 1, 2, 3, 4, 5, 6, 8].map((n) => [n, String(n)]), 'botCount', updateDeploySub);
  seg($('segDiff'), Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]), 'difficulty', () => { for (const b of game.bots) b.setDifficulty(settings.difficulty); });

  const roomIn = $('roomIn');
  roomIn.value = settings.room || 'pier7';
  roomIn.addEventListener('input', () => { settings.room = roomIn.value; save(); updateDeploySub(); });

  const setMode = (m) => {
    settings.mode = m; save();
    $('tabOnline').setAttribute('aria-selected', String(m === 'online'));
    $('tabOffline').setAttribute('aria-selected', String(m === 'offline'));
    $('panelOnline').hidden = m !== 'online';
    $('panelOffline').hidden = m !== 'offline';
    updateDeploySub();
  };
  $('tabOnline').addEventListener('click', () => setMode('online'));
  $('tabOffline').addEventListener('click', () => setMode('offline'));

  // controls help follows the player's own bindings
  const renderKeyHelp = () => {
    const el = $('keyHelp');
    el.textContent = '';
    const add = (label, keys) => {
      const d = document.createElement('div');
      const a = document.createElement('span'); a.textContent = label;
      const b = document.createElement('span');
      for (const k of keys) { const kb = document.createElement('kbd'); kb.textContent = k; b.appendChild(kb); }
      d.append(a, b); el.appendChild(d);
    };
    const B = settings.binds;
    const name = (id) => keyName(B[id]);
    add('移動', ['forward', 'left', 'back', 'right'].map(name));
    add('視点', ['マウス']);
    for (const a of ACTIONS) if (!['forward', 'back', 'left', 'right'].includes(a.id)) add(a.label, [name(a.id)]);
    add('武器切替', ['ホイール']);
    add('メニュー', ['Esc']);
  };
  renderKeyHelp();
  const settingsUI = createSettingsUI({ settings, game, save });
  $('openSettings').addEventListener('click', () => settingsUI.open(null, renderKeyHelp));

  $('loading').hidden = true;
  $('menu').hidden = false;

  // ---------------- transport ----------------
  const status = (cls, text) => {
    const el = $('netStatus');
    el.textContent = '';
    const d = document.createElement('span'); d.className = 'dot ' + cls;
    const t = document.createElement('span'); t.textContent = text;
    el.append(d, t);
  };
  setMode(settings.mode === 'offline' ? 'offline' : 'online');
  status('warn', 'オンライン接続を確認中…');
  pickTransport().then((t) => {
    transport = t;
    if (t) {
      status('ok', t.kind === 'claude' ? 'オンライン — このページを開いている人と同じルームで対戦できます' : 'オンライン — サーバーに接続しました');
    } else {
      status('bad', 'オンラインに接続できません。オフライン練習でBotと戦えます。');
      if (settings.mode === 'online') setMode('offline');
    }
    updateDeploySub();
  });

  // lobby presence + active room list
  const roomList = $('roomList');
  setInterval(() => {
    if (!transport || !transport.lobby) return;
    const lobby = transport.lobby;
    const playing = game.state === 'play' && game.mode === 'online';
    if (!(playing && transport.fallback)) {
      lobby.presence({ v: NET_VERSION, n: settings.name, st: playing ? 'play' : 'menu', rm: playing ? game.roomName : null });
    }
    if (game.state !== 'menu') return;
    const counts = new Map();
    for (const p of lobby.peers()) {
      if (p.me) continue;
      const pr = p.presence || {};
      if (pr.st !== 'play') continue;
      const rm = transport.fallback ? 'lobby' : roomSlug(pr.rm);
      counts.set(rm, (counts.get(rm) || 0) + 1);
    }
    const key = [...counts].map(([a, b]) => a + b).join('|');
    if (roomList._key === key) return;
    roomList._key = key;
    roomList.textContent = '';
    if (!counts.size) {
      const d = document.createElement('div'); d.className = 'fineprint'; d.textContent = '現在プレイ中のルームはありません。ルーム名を決めて出撃すると、同じ名前を入れた人と合流できます。';
      roomList.appendChild(d);
    }
    for (const [rm, n] of counts) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'room-item';
      const a = document.createElement('span'); a.className = 'rn'; a.textContent = rm;
      const c = document.createElement('span'); c.className = 'rc'; c.textContent = `${n}人がプレイ中 · 参加`;
      b.append(a, c);
      b.addEventListener('click', () => { roomIn.value = rm; settings.room = rm; save(); updateDeploySub(); });
      roomList.appendChild(b);
    }
  }, 700);

  // ---------------- deploy ----------------
  $('deployBtn').addEventListener('click', async () => {
    settings.name = sanitizeText(nameIn.value, 14) || settings.name;
    nameIn.value = settings.name;
    save();
    game.sound.init();
    game.input.enabled = true;
    game.input.lock(); // must happen inside the click
    $('menu').hidden = true;
    const online = settings.mode === 'online' && transport;
    await game.start(online ? 'online' : 'offline', online ? transport : null, roomSlug(roomIn.value));
  });

  // ---------------- pause / chat ----------------
  const pause = (on) => {
    if (game.state !== 'play') return;
    game.paused = on;
    $('pause').hidden = !on;
    $('pauseSub').textContent = game.mode === 'online' ? 'オンライン中はゲームは止まりません。' : '練習中もBotは動き続けます。';
    if (!on) { game.input.clear(); game.input.lock(); }
  };
  game.input.onUnlock = () => { if (game.state === 'play') { closeChat(); pause(true); } };
  game.input.onEsc = () => { if (!settingsUI.isOpen) pause(!game.paused); };
  game.input.onPause = () => { if (!settingsUI.isOpen) pause(!game.paused); };
  $('resumeBtn').addEventListener('click', () => pause(false));
  $('pauseSettings').addEventListener('click', () => settingsUI.open(null, renderKeyHelp));
  $('leaveBtn').addEventListener('click', async () => {
    game.paused = false;
    await game.leave();
    $('menu').hidden = false;
    roomList._key = null;
  });

  const chatbox = $('chatbox'), chatin = $('chatin');
  const closeChat = () => {
    if (!game.chatOpen) return;
    game.chatOpen = false;
    game.input.typing = false;
    chatbox.hidden = true;
    chatin.value = '';
    chatin.blur();
  };
  game.input.onChat = () => {
    if (game.state !== 'play' || game.chatOpen || game.paused) return;
    game.chatOpen = true;
    game.input.typing = true;
    game.input.keys.clear();
    chatbox.hidden = false;
    setTimeout(() => chatin.focus(), 0);
  };
  chatin.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); game.sendChat(chatin.value); closeChat(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
  });
  $('game').addEventListener('click', () => {
    if (game.state === 'play' && !game.paused && !game.input.locked && !game.input.freeMouse && !game.input.touch) game.input.lock();
  });
}

const hot = window.claude && window.claude.hot;
if (hot && hot.ready) hot.ready(start);
else start((hot && hot.data) || {});

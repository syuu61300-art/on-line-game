// Settings overlay: controls, key bindings, touch layout, video, audio, HUD.
import { SCHEMA, ACTIONS, DEFAULT_BINDS, TOUCH_BUTTONS, CROSS_COLORS, keyName, bindRefusal } from './settings.js';

const $ = (id) => document.getElementById(id);

const TABS = [
  ['controls', '操作'],
  ['keys', 'キー割り当て'],
  ['touch', 'タッチ'],
  ['video', '映像'],
  ['audio', 'サウンド'],
  ['hud', 'HUD'],
];

export function createSettingsUI({ settings, game, save }) {
  const el = $('settings');
  const body = $('setBody');
  const tabsEl = $('setTabs');
  let tab = 'controls';
  let waiting = null; // action id waiting for a key

  const changed = () => { save(); game.applySettings(); };

  // ---------- control builders ----------
  const row = (labelText, id) => {
    const r = document.createElement('div'); r.className = 'set-row';
    const l = document.createElement('label'); l.textContent = labelText; if (id) l.htmlFor = id;
    r.appendChild(l);
    body.appendChild(r);
    return r;
  };
  const slider = (key, label, fmt, step) => {
    const d = SCHEMA[key];
    const id = 'set-' + key;
    const r = row(label, id);
    const inp = document.createElement('input');
    inp.type = 'range'; inp.id = id; inp.min = d.min; inp.max = d.max; inp.step = step; inp.value = settings[key];
    const v = document.createElement('span'); v.className = 'v'; v.textContent = fmt(+settings[key]);
    inp.addEventListener('input', () => { settings[key] = +inp.value; v.textContent = fmt(+inp.value); changed(); });
    r.append(inp, v);
  };
  const seg = (key, label, items, note) => {
    const r = row(label);
    const g = document.createElement('div'); g.className = 'seg'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    const draw = () => {
      g.textContent = '';
      for (const [val, text] of items) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
        b.setAttribute('aria-pressed', String(settings[key] === val));
        b.addEventListener('click', () => { settings[key] = val; changed(); draw(); if (note) note(); });
        g.appendChild(b);
      }
    };
    draw();
    r.append(g, document.createElement('span'));
  };
  const toggle = (key, label) => seg(key, label, [[true, 'オン'], [false, 'オフ']]);
  const hint = (text) => { const p = document.createElement('p'); p.className = 'set-hint'; p.textContent = text; body.appendChild(p); return p; };
  const heading = (text) => { const h = document.createElement('div'); h.className = 'label'; h.textContent = text; body.appendChild(h); };
  const pct = (v) => Math.round(v * 100) + '%';

  // ---------- tabs ----------
  const renderTabs = () => {
    tabsEl.textContent = '';
    for (const [id, label] of TABS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'set-tab'; b.setAttribute('role', 'tab'); b.textContent = label;
      b.dataset.nocapture = '';
      b.setAttribute('aria-selected', String(tab === id));
      b.addEventListener('click', () => { stopCapture(); tab = id; render(); });
      tabsEl.appendChild(b);
    }
  };

  const render = () => {
    renderTabs();
    body.textContent = '';
    body.scrollTop = 0;
    if (tab === 'controls') {
      slider('sens', 'マウス感度', (v) => v.toFixed(2), 0.05);
      slider('adsSens', 'ADS中の感度（倍率）', (v) => v.toFixed(2), 0.05);
      toggle('invertY', '上下反転');
      seg('adsMode', 'エイム（ADS）', [['hold', '押している間'], ['toggle', '押して切り替え']]);
      seg('crouchMode', 'しゃがむ', [['hold', '押している間'], ['toggle', '押して切り替え']]);
      seg('sprintMode', 'ダッシュ', [['hold', '押している間'], ['toggle', '押して切り替え']]);
      hint('切り替え式のダッシュは、前進をやめるか撃つと解除されます。');
    } else if (tab === 'keys') {
      const list = document.createElement('div'); list.className = 'bind-list';
      for (const a of ACTIONS) {
        const r = document.createElement('div'); r.className = 'bind-row';
        const l = document.createElement('span'); l.textContent = a.label;
        const k = document.createElement('button'); k.type = 'button'; k.className = 'bind-key';
        k.dataset.nocapture = '';
        const code = settings.binds[a.id];
        k.textContent = waiting === a.id ? '入力待ち…' : keyName(code);
        if (waiting === a.id) k.classList.add('wait');
        if (!code) k.classList.add('none');
        k.addEventListener('click', () => startCapture(a.id));
        r.append(l, k);
        list.appendChild(r);
      }
      body.appendChild(list);
      const msg = hint(waiting ? 'キーかマウスボタンを押してください。Esc で取り消し。' : '変更したい操作のキーを押して、新しいキーかマウスボタンを入力します。');
      msg.id = 'bindMsg';
      hint('同じキーを選ぶと、元の操作と入れ替わります。Esc はメニュー用、マウスホイールは武器切替用に固定です。1つのキーには1つの操作だけ割り当てられます。');
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn'; reset.textContent = 'キー割り当てを初期設定に戻す';
      reset.dataset.nocapture = '';
      reset.addEventListener('click', () => { stopCapture(); settings.binds = { ...DEFAULT_BINDS }; changed(); render(); });
      body.appendChild(reset);
    } else if (tab === 'touch') {
      slider('touchSens', '視点の感度（タッチ）', (v) => v.toFixed(2), 0.05);
      slider('touchScale', 'ボタンの大きさ', pct, 0.05);
      slider('touchOpacity', 'ボタンの不透明度', pct, 0.05);
      const r = document.createElement('div'); r.className = 'btnrow';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn primary'; edit.textContent = 'ボタン配置を編集';
      edit.addEventListener('click', openTouchEditor);
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn'; reset.textContent = '配置を初期化';
      reset.addEventListener('click', () => { settings.touchLayout = {}; changed(); });
      r.append(edit, reset);
      body.appendChild(r);
      hint('編集中はボタンをドラッグして好きな位置へ動かせます。射撃とADSのボタンは、押したまま指を滑らせると視点も動かせます。');
    } else if (tab === 'video') {
      seg('quality', '画質', [['high', '高'], ['medium', '標準'], ['low', '軽量']]);
      slider('renderScale', '描画解像度', pct, 0.05);
      const aaWas = settings.aa;
      seg('aa', 'アンチエイリアス', [[true, 'オン'], [false, 'オフ']], () => { aaNote.hidden = settings.aa === aaWas; });
      const aaNote = hint('アンチエイリアスの変更はページの再読み込み後に反映されます。');
      aaNote.hidden = true;
      slider('fov', '視野角', (v) => v + '°', 1);
      slider('camBob', '歩行時のカメラの揺れ', pct, 0.05);
      toggle('showFps', 'FPSを表示');
      hint('どの画質でも影・煙・霧は表示されます（見え方の有利不利が出ないように）。重いときは描画解像度を下げてください。');
    } else if (tab === 'audio') {
      slider('volume', '全体の音量', pct, 0.05);
      slider('sfxVol', '効果音（銃声・足音・爆発）', pct, 0.05);
      slider('ambVol', '環境音（風・波）', pct, 0.05);
      slider('uiVol', '通知音（ヒット音・チャット）', pct, 0.05);
      hint('足音だけを大きくする設定はありません。');
    } else if (tab === 'hud') {
      const r = row('クロスヘアの色');
      const sw = document.createElement('div'); sw.className = 'swatches'; sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'クロスヘアの色');
      const drawSw = () => {
        sw.textContent = '';
        for (const [k, c] of Object.entries(CROSS_COLORS)) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'swatch'; b.style.background = c;
          b.setAttribute('aria-label', k); b.setAttribute('aria-pressed', String(settings.crossColor === k));
          b.addEventListener('click', () => { settings.crossColor = k; changed(); drawSw(); });
          sw.appendChild(b);
        }
      };
      drawSw();
      r.append(sw, document.createElement('span'));
      seg('crossStyle', 'クロスヘアの形', [['both', '十字＋点'], ['cross', '十字'], ['dot', '点']]);
      slider('hudScale', 'HUDの大きさ', pct, 0.05);
      toggle('showChat', 'チャットを表示');
      hint('クロスヘアの十字は、弾の散らばりに合わせて開閉します（どの形でも同じ精度です）。');
    }
  };

  // ---------- key capture ----------
  function startCapture(action) {
    waiting = action;
    render();
    game.input.capture = (code) => {
      if (code === 'Escape') { stopCapture(); render(); return; }
      const why = bindRefusal(code);
      if (why) { const m = $('bindMsg'); if (m) m.textContent = `${keyName(code)}：${why}。別のキーを押すか Esc で取り消し。`; return; }
      const B = settings.binds;
      const prev = B[action];
      for (const a in B) if (a !== action && B[a] === code) B[a] = prev; // swap
      B[action] = code;
      stopCapture();
      changed();
      render();
    };
  }
  function stopCapture() { waiting = null; game.input.capture = null; }

  // ---------- touch editor ----------
  const bar = $('touchEdit');
  function openTouchEditor() {
    stopCapture();
    el.hidden = true;
    bar.hidden = false;
    game.input.startTouchEdit();
  }
  const closeTouchEditor = (keep) => {
    game.input.finishTouchEdit(keep);
    bar.hidden = true;
    if (keep) changed();
    el.hidden = false;
    render();
  };
  $('teSave').addEventListener('click', () => closeTouchEditor(true));
  $('teCancel').addEventListener('click', () => closeTouchEditor(false));
  $('teReset').addEventListener('click', () => game.input.resetTouchEdit());

  // ---------- open / close ----------
  let onCloseCb = null;
  const close = () => {
    stopCapture();
    el.hidden = true;
    onCloseCb && onCloseCb();
  };
  $('setClose').addEventListener('click', close);
  $('setClose').dataset.nocapture = '';
  addEventListener('keydown', (e) => {
    if (el.hidden || game.input.capture) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);

  return {
    open(startTab, onClose) {
      if (startTab) tab = startTab;
      onCloseCb = onClose || null;
      el.hidden = false;
      render();
      $('setClose').focus();
    },
    close,
    get isOpen() { return !el.hidden || !bar.hidden; },
  };
}

export { TOUCH_BUTTONS };

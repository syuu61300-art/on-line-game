// DOM HUD: only touches the DOM when a value actually changes.
import { WEAPONS } from './config.js';
import { BOUNDS } from './map.js';
import { fmtTime, clamp } from './util.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = $('hud');
    this.cache = {};
    this.cross = $('cross');
    this.crossParts = ['c-t', 'c-b', 'c-l', 'c-r'].map((c) => this.cross.querySelector('.' + c));
    this.hit = $('hitmark');
    this.hitT = 0;
    this.vig = $('vignette');
    this.vigT = 0;
    this.dmgEl = $('dmgind');
    this.dmgArcs = [];
    this.feed = $('killfeed');
    this.toasts = $('toasts');
    this.chatlog = $('chatlog');
    this.scope = $('scope');
    this.mm = $('mmc');
    this.mmx = this.mm.getContext('2d');
    this.sb = $('scoreboard');
    this.shield = $('spawnshield');
    this._buildMil();
  }

  _buildMil() {
    const mil = $('mil');
    for (let i = 1; i <= 5; i++) {
      for (const s of [-1, 1]) {
        const a = document.createElement('i');
        a.style.cssText = `left:${s * i * 22 - 1}px;top:-4px;width:2px;height:8px`;
        mil.appendChild(a);
        const b = document.createElement('i');
        b.style.cssText = `top:${s * i * 22 - 1}px;left:-4px;height:2px;width:8px`;
        mil.appendChild(b);
      }
    }
  }

  // pre-render the static top-down map
  buildMinimap(rects) {
    const S = 4; // px per metre
    const W = (BOUNDS.maxX - BOUNDS.minX) * S, H = (BOUNDS.maxZ - BOUNDS.minZ) * S;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(40,52,58,0.85)';
    g.fillRect(0, 0, W, H);
    const sorted = rects.slice().sort((a, b) => a.h - b.h);
    for (const r of sorted) {
      const v = clamp(r.h / 6, 0, 1);
      g.fillStyle = `rgb(${Math.round(110 + v * 90)},${Math.round(120 + v * 85)},${Math.round(124 + v * 70)})`;
      g.fillRect((r.x0 - BOUNDS.minX) * S, (r.z0 - BOUNDS.minZ) * S, Math.max(1, (r.x1 - r.x0) * S), Math.max(1, (r.z1 - r.z0) * S));
    }
    // water edge
    g.fillStyle = 'rgba(40,110,120,0.9)';
    g.fillRect(0, H - 2, W, 2);
    this.mmImg = c;
    this.mmScale = S;
  }

  show(on) { this.el.hidden = !on; }

  set(key, val, fn) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    fn(val);
  }

  update(dt, s) {
    // s: snapshot from game
    const g = this.game;
    // HP
    const hp = Math.max(0, Math.ceil(s.hp));
    this.set('hp', hp, (v) => {
      $('hpnum').innerHTML = v + '<small>HP</small>';
      $('hpbar').style.width = v + '%';
      $('hp').classList.toggle('low', v <= 35);
    });
    // ammo
    const w = s.weapon;
    const def = w.def;
    this.set('wname', def.name, (v) => ($('wname').textContent = v + ' · ' + def.cls));
    const ammoKey = def.melee ? 'melee' : w.ammo + '/' + w.reserve;
    this.set('ammo', ammoKey, () => {
      const el = $('ammocount');
      if (def.melee) { el.innerHTML = '<span class="mag">—</span>'; el.classList.remove('low'); return; }
      el.innerHTML = `<span class="mag">${w.ammo}</span><span class="res">/ ${w.reserve === Infinity ? '∞' : w.reserve}</span>`;
      el.classList.toggle('low', w.ammo <= Math.ceil(def.mag * 0.25));
    });
    this.set('slot', s.slot, (v) => {
      const slots = $('slots').children;
      for (let i = 0; i < slots.length; i++) slots[i].classList.toggle('on', i === v);
    });
    this.set('nades', s.grenades, (v) => ($('nades').textContent = (v > 0 ? '◆'.repeat(v) : '—') + ' グレネード'));
    // reload bar
    const rf = w.reloading ? w.reloadFrac : 0;
    const rkey = Math.round(rf * 50);
    this.set('reload', rkey, () => {
      $('reloadbar').classList.toggle('on', rf > 0);
      $('reloadbar').firstChild.style.width = (rf * 100).toFixed(0) + '%';
    });
    // hint
    let hint = '';
    if (!def.melee && w.ammo === 0 && w.reserve <= 0) hint = '弾切れ — 弾薬箱を探すか武器を持ち替え';
    else if (!def.melee && w.ammo <= Math.ceil(def.mag * 0.2) && !w.reloading) hint = 'R でリロード';
    this.set('hint', hint, (v) => ($('hint').textContent = v));

    // crosshair: gap follows spread
    const gap = clamp(Math.round(s.spreadPx), 3, 90);
    const hideCross = s.adsT > 0.6 || def.melee && false;
    this.set('cross', hideCross ? -1 : gap, (v) => {
      this.cross.classList.toggle('hide', v < 0);
      if (v < 0) return;
      const [t, b, l, r] = this.crossParts;
      t.style.top = -(v + 9) + 'px'; b.style.top = v + 'px';
      l.style.left = -(v + 9) + 'px'; r.style.left = v + 'px';
    });
    // scope
    this.set('scope', s.scoped, (v) => this.scope.classList.toggle('on', v));

    // hitmarker fade
    if (this.hitT > 0) { this.hitT -= dt; this.hit.style.opacity = Math.max(0, this.hitT / 0.25).toFixed(2); }
    // damage vignette
    const low = hp > 0 && hp < 40 ? (0.25 + Math.sin(g.time * 4) * 0.1) * (1 - hp / 40) : 0;
    this.vigT = Math.max(0, this.vigT - dt * 1.6);
    this.vig.style.opacity = Math.min(1, this.vigT + low).toFixed(2);
    // damage arcs
    for (let i = this.dmgArcs.length - 1; i >= 0; i--) {
      const a = this.dmgArcs[i];
      a.t -= dt;
      if (a.t <= 0) { a.el.remove(); this.dmgArcs.splice(i, 1); continue; }
      const rel = a.world - s.yaw;
      a.el.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
      a.el.style.opacity = Math.min(1, a.t / 0.6).toFixed(2);
    }
    // spawn shield
    this.set('shield', s.protected, (v) => (this.shield.style.opacity = v ? '1' : '0'));

    // timer + leader
    this.set('timer', s.timer, (v) => ($('timer').textContent = v));
    this.set('lead', s.leadText, (v) => ($('lead').innerHTML = v));
    this.set('kd', s.kills + '/' + s.deaths, () => ($('kd').textContent = `${s.kills} キル / ${s.deaths} デス`));
    this.set('rank', s.rankText, (v) => ($('rank').textContent = v));

    // chat fade
    const now = performance.now();
    for (const el of this.chatlog.children) {
      const age = now - el._t;
      el.style.opacity = s.chatOpen ? 1 : age > 9000 ? 0 : 1;
    }
    while (this.chatlog.children.length > 8) this.chatlog.firstChild.remove();
    while (this.feed.children.length > 6) this.feed.lastChild.remove();
    for (const el of this.feed.children) if (now - el._t > 7000) el.remove();
  }

  hitmarker(head, kill) {
    this.hit.className = kill ? 'kill' : head ? 'head' : '';
    this.hitT = kill ? 0.45 : 0.25;
    this.hit.style.opacity = '1';
  }

  damage(amount, worldAngle) {
    this.vigT = Math.min(0.9, this.vigT + amount / 60);
    if (worldAngle === null || worldAngle === undefined) return;
    const el = document.createElement('div');
    el.className = 'arc';
    this.dmgEl.appendChild(el);
    this.dmgArcs.push({ el, t: 1.6, world: worldAngle });
    if (this.dmgArcs.length > 5) { this.dmgArcs[0].el.remove(); this.dmgArcs.shift(); }
  }

  killfeed(kName, kCol, vName, vCol, weaponId, head, mine) {
    const d = document.createElement('div');
    d.className = 'kf' + (mine ? ' me' : '');
    d._t = performance.now();
    const k = document.createElement('span'); k.textContent = kName; k.style.color = kCol;
    const w = document.createElement('span'); w.className = 'w';
    const def = WEAPONS[weaponId];
    w.textContent = def ? def.name.split(' ')[0] : '—';
    const v = document.createElement('span'); v.textContent = vName; v.style.color = vCol;
    if (kName) d.append(k, w); else d.append(w);
    if (head) { const h = document.createElement('span'); h.className = 'hs'; h.textContent = 'HS'; d.append(h); }
    d.append(v);
    this.feed.prepend(d);
  }

  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = text;
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 1850);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
  }

  chat(name, color, text, sys = false) {
    const d = document.createElement('div');
    d.className = 'cl' + (sys ? ' sys' : '');
    d._t = performance.now();
    if (!sys) {
      const b = document.createElement('b'); b.textContent = name; b.style.color = color;
      d.appendChild(b);
    }
    d.appendChild(document.createTextNode(text));
    this.chatlog.appendChild(d);
  }

  scoreboard(show, rows, meta) {
    this.sb.hidden = !show;
    if (!show) return;
    const key = JSON.stringify(rows) + meta;
    if (this._sbKey === key) return;
    this._sbKey = key;
    $('sbmeta').textContent = meta;
    this.fillTable($('sbbody'), rows);
  }

  fillTable(tbody, rows) {
    tbody.textContent = '';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.me) tr.className = 'me';
      const td = (txt, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = txt; tr.appendChild(c); return c; };
      td(String(i + 1), 'r');
      const n = td('', 'n');
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = r.color; n.appendChild(sw);
      n.appendChild(document.createTextNode(r.name));
      if (r.bot) { const t = document.createElement('span'); t.className = 'tagbot'; t.textContent = 'BOT'; n.appendChild(t); }
      td(String(r.k)); td(String(r.d)); td(r.d ? (r.k / r.d).toFixed(2) : r.k.toFixed(2));
      tbody.appendChild(tr);
    });
  }

  drawMinimap(me, yaw, blips, pickups) {
    const g = this.mmx, W = this.mm.width, H = this.mm.height;
    const scale = 2.2; // canvas px per metre (canvas is 2x CSS)
    const S = this.mmScale;
    g.save();
    g.clearRect(0, 0, W, H);
    g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); g.clip();
    g.translate(W / 2, H / 2);
    g.rotate(yaw);
    g.scale(scale / S * 1, scale / S * 1);
    g.translate(-(me.x - BOUNDS.minX) * S, -(me.z - BOUNDS.minZ) * S);
    g.globalAlpha = 0.95;
    if (this.mmImg) g.drawImage(this.mmImg, 0, 0);
    g.globalAlpha = 1;
    const toPx = (x, z) => [(x - BOUNDS.minX) * S, (z - BOUNDS.minZ) * S];
    // pickups
    for (const p of pickups) {
      if (!p.available) continue;
      const [px, pz] = toPx(p.x, p.z);
      g.fillStyle = p.type === 'hp' ? '#4fc1b3' : p.type === 'nade' ? '#c9a52c' : '#ece4d2';
      g.fillRect(px - 5, pz - 5, 10, 10);
    }
    // enemy blips
    for (const b of blips) {
      const [px, pz] = toPx(b.x, b.z);
      g.fillStyle = `rgba(255,90,71,${b.a.toFixed(2)})`;
      g.beginPath(); g.arc(px, pz, 9, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // self arrow
    g.save();
    g.translate(W / 2, H / 2);
    g.fillStyle = '#f2a541';
    g.beginPath(); g.moveTo(0, -14); g.lineTo(10, 11); g.lineTo(0, 6); g.lineTo(-10, 11); g.closePath(); g.fill();
    // view cone
    g.fillStyle = 'rgba(242,165,65,0.12)';
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, W / 2, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); g.closePath(); g.fill();
    g.restore();
    // compass N
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(yaw);
    g.fillStyle = '#92a3ab';
    g.font = '600 22px "IBM Plex Mono", monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', 0, -W / 2 + 18);
    g.restore();
  }
}

export { fmtTime };

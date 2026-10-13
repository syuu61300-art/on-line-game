// Multi-level navigation grid built automatically from the collision boxes.
// Each 1m column may hold several walkable floors (ground, container tops, mezzanines...).
import { BOUNDS } from './map.js';

const CELL = 1;
const R = 0.33; // body half width (+margin) used for clearance

export class NavGrid {
  constructor(world) {
    this.world = world;
    this.nx = Math.round((BOUNDS.maxX - BOUNDS.minX) / CELL);
    this.nz = Math.round((BOUNDS.maxZ - BOUNDS.minZ) / CELL);
    this.nodes = []; // {i, x, y, z, cx, cz, n: [{to, cost}]}
    this.columns = new Array(this.nx * this.nz);
    this._build();
  }

  cx(x) { return Math.floor((x - BOUNDS.minX) / CELL); }
  cz(z) { return Math.floor((z - BOUNDS.minZ) / CELL); }

  _build() {
    const w = this.world;
    const tmp = [];
    for (let i = 0; i < this.nx; i++) for (let j = 0; j < this.nz; j++) {
      const x = BOUNDS.minX + (i + 0.5) * CELL, z = BOUNDS.minZ + (j + 0.5) * CELL;
      // candidate floors: tops of walkable boxes covering the centre
      const boxes = w.query(x - 0.01, -1, z - 0.01, x + 0.01, 40, z + 0.01, tmp);
      const tops = new Set();
      for (const b of boxes) if (b.maxy >= 0 && b.maxy < 30) tops.add(Math.round(b.maxy * 100) / 100);
      const col = [];
      for (const h of [...tops].sort((a, b) => a - b)) {
        // clearance for a standing body above this floor
        if (w.blocked(x - R, h + 0.35, z - R, x + R, h + 1.75, z + R)) continue;
        // floor must actually be the highest support at this point (not under another floor)
        const node = { i: this.nodes.length, x, y: h, z, ci: i, cj: j, n: [] };
        this.nodes.push(node);
        col.push(node);
      }
      this.columns[i * this.nz + j] = col;
    }
    // links
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    for (const a of this.nodes) {
      for (const [di, dj, c] of dirs) {
        const bi = a.ci + di, bj = a.cj + dj;
        if (bi < 0 || bj < 0 || bi >= this.nx || bj >= this.nz) continue;
        const col = this.columns[bi * this.nz + bj];
        if (!col) continue;
        for (const b of col) {
          const dh = b.y - a.y;
          if (dh > 0.65) continue;            // too high to step
          if (dh < -3.1) continue;            // too far to drop
          const top = Math.max(a.y, b.y);
          const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
          if (w.blocked(mx - R, top + 0.35, mz - R, mx + R, top + 1.7, mz + R)) continue;
          if (di && dj) {
            // no corner cutting
            const c1 = this.columns[bi * this.nz + a.cj], c2 = this.columns[a.ci * this.nz + bj];
            if (!c1 || !c2 || !c1.some((n) => Math.abs(n.y - a.y) < 0.66) || !c2.some((n) => Math.abs(n.y - a.y) < 0.66)) continue;
          }
          const drop = dh < -0.65;
          if (drop && (di && dj)) continue;
          // a drop must not have floor directly between (otherwise it's a wall top etc.)
          a.n.push({ to: b.i, cost: c + (drop ? 2.5 : 0) + Math.max(0, dh) * 0.6 });
        }
      }
    }
    // keep only nodes that can both be reached from the open ground and lead back to it
    const N = this.nodes.length;
    const fwd = new Uint8Array(N), back = new Uint8Array(N);
    const rev = this.nodes.map(() => []);
    for (const a of this.nodes) for (const l of a.n) rev[l.to].push(a.i);
    const seedCol = this.columns[this.cx(-1) * this.nz + this.cz(0.5)];
    const seed = seedCol && seedCol.find((n) => n.y < 0.1);
    if (seed) {
      let st = [seed.i]; fwd[seed.i] = 1;
      while (st.length) { const k = st.pop(); for (const l of this.nodes[k].n) if (!fwd[l.to]) { fwd[l.to] = 1; st.push(l.to); } }
      st = [seed.i]; back[seed.i] = 1;
      while (st.length) { const k = st.pop(); for (const f of rev[k]) if (!back[f]) { back[f] = 1; st.push(f); } }
    }
    this.mainComp = 1;
    this.comp = new Int32Array(N);
    for (let i = 0; i < N; i++) this.comp[i] = fwd[i] && back[i] ? 1 : 0;
    this.walkable = this.nodes.filter((n) => this.comp[n.i] === 1);
    // drop links into dead ends
    for (const a of this.nodes) a.n = a.n.filter((l) => this.comp[l.to] === 1);
  }

  nearest(x, y, z) {
    const ci = this.cx(x), cj = this.cz(z);
    let best = null, bd = Infinity;
    for (let r = 0; r <= 3; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const col = this.columns[i * this.nz + j];
        if (!col) continue;
        for (const n of col) {
          if (this.comp[n.i] !== this.mainComp) continue;
          const dy = n.y - y;
          if (dy > 0.8) continue;
          const d = (n.x - x) ** 2 + (n.z - z) ** 2 + (dy < -0.5 ? dy * dy * 4 : 0);
          if (d < bd) { bd = d; best = n; }
        }
      }
      if (best) return best;
    }
    return best;
  }

  randomNode(rng = Math.random) {
    return this.walkable[Math.floor(rng() * this.walkable.length)];
  }

  // A* — returns array of nodes from start to goal (inclusive) or null
  path(start, goal, maxIter = 6000) {
    if (!start || !goal) return null;
    if (start === goal) return [goal];
    const N = this.nodes.length;
    const g = this._g || (this._g = new Float32Array(N));
    const from = this._from || (this._from = new Int32Array(N));
    const seen = this._seen || (this._seen = new Int32Array(N));
    const closed = this._closed || (this._closed = new Int32Array(N));
    this._run = (this._run || 0) + 1;
    const run = this._run;
    const heap = [];
    const h = (n) => Math.hypot(n.x - goal.x, n.z - goal.z) + Math.abs(n.y - goal.y) * 0.5;
    const push = (i, f) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]]; k = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    g[start.i] = 0; seen[start.i] = run; from[start.i] = -1;
    push(start.i, h(start));
    let iter = 0;
    while (heap.length && iter++ < maxIter) {
      const [, ci] = pop();
      if (closed[ci] === run) continue;
      closed[ci] = run;
      if (ci === goal.i) {
        const out = [];
        for (let k = ci; k >= 0; k = from[k]) out.push(this.nodes[k]);
        out.reverse();
        return out;
      }
      const cn = this.nodes[ci];
      for (const l of cn.n) {
        const ng = g[ci] + l.cost;
        if (seen[l.to] !== run || ng < g[l.to]) {
          seen[l.to] = run; g[l.to] = ng; from[l.to] = ci;
          push(l.to, ng + h(this.nodes[l.to]));
        }
      }
    }
    return null;
  }
}

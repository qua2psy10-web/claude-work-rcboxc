/**
 * SVG による図化
 *   - 断面図(ハンチ・配筋・寸法)
 *   - 荷重図
 *   - 断面力図(M / S / N)
 * いずれも SVG 文字列を返す。
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmt = (v, d = 1) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(d));

/** モデル座標(m, y上向き)→ SVG座標への変換器 */
function makeMapper(xmin, xmax, ymin, ymax, w, h, pad) {
  const sx = (w - 2 * pad) / Math.max(1e-9, xmax - xmin);
  const sy = (h - 2 * pad) / Math.max(1e-9, ymax - ymin);
  const k = Math.min(sx, sy);
  const ox = pad + ((w - 2 * pad) - k * (xmax - xmin)) / 2;
  const oy = pad + ((h - 2 * pad) - k * (ymax - ymin)) / 2;
  return {
    k,
    X: (x) => ox + (x - xmin) * k,
    Y: (y) => oy + (ymax - y) * k,
  };
}

/** 内空(ハンチ付き)の輪郭 */
function voidPath(geo, m) {
  const { L, Hc } = geo;
  const { t1, t2, t3, hTh, hTv, hBh, hBv } = geo.dims;
  const x0 = t3 / 2, x1 = L - t3 / 2;
  const y0 = t2 / 2, y1 = Hc - t1 / 2;
  const pts = [
    [x0 + hBh, y0], [x1 - hBh, y0], [x1, y0 + hBv],
    [x1, y1 - hTv], [x1 - hTh, y1], [x0 + hTh, y1],
    [x0, y1 - hTv], [x0, y0 + hBv],
  ];
  return 'M' + pts.map(([x, y]) => `${m.X(x).toFixed(2)},${m.Y(y).toFixed(2)}`).join('L') + 'Z';
}

function outerPath(geo, m) {
  const { L, Hc } = geo;
  const { t1, t2, t3 } = geo.dims;
  const x0 = -t3 / 2, x1 = L + t3 / 2;
  const y0 = -t2 / 2, y1 = Hc + t1 / 2;
  return `M${m.X(x0).toFixed(2)},${m.Y(y1).toFixed(2)}`
    + `L${m.X(x1).toFixed(2)},${m.Y(y1).toFixed(2)}`
    + `L${m.X(x1).toFixed(2)},${m.Y(y0).toFixed(2)}`
    + `L${m.X(x0).toFixed(2)},${m.Y(y0).toFixed(2)}Z`;
}

/** 寸法線 */
function dimLine(m, x1, y1, x2, y2, text, offset = 0, vertical = false) {
  const nx = vertical ? offset : 0;
  const ny = vertical ? 0 : offset;
  const ax = m.X(x1 + nx), ay = m.Y(y1 + ny);
  const bx = m.X(x2 + nx), by = m.Y(y2 + ny);
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const rot = vertical ? ` transform="rotate(-90 ${mx} ${my - 5})"` : '';
  return `<g class="dim">
    <line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>
    <line x1="${m.X(x1)}" y1="${m.Y(y1)}" x2="${ax}" y2="${ay}" class="ext"/>
    <line x1="${m.X(x2)}" y1="${m.Y(y2)}" x2="${bx}" y2="${by}" class="ext"/>
    <circle cx="${ax}" cy="${ay}" r="2"/><circle cx="${bx}" cy="${by}" r="2"/>
    <text x="${mx}" y="${my - 5}" text-anchor="middle"${rot}>${esc(text)}</text>
  </g>`;
}

/** 断面図(配筋を含む) */
export function sectionSVG(result, w = 520, h = 460) {
  const geo = result.geo;
  const { L, Hc } = geo;
  const { t1, t2, t3 } = geo.dims;
  const pad = 80;
  const m = makeMapper(-t3 / 2, L + t3 / 2, -t2 / 2, Hc + t1 / 2, w, h, pad);
  const mm = (v) => Math.round(v * 1000);

  let rebarLayer = '';
  const plan = new Map(result.rebarPlan.map((p) => [`${p.member}:${p.face}`, p]));
  const layers = [
    ['top', 'inner', [t3 / 2, Hc - t1 / 2], [L - t3 / 2, Hc - t1 / 2], [0, 1]],
    ['top', 'outer', [-t3 / 2, Hc + t1 / 2], [L + t3 / 2, Hc + t1 / 2], [0, -1]],
    ['bottom', 'inner', [t3 / 2, t2 / 2], [L - t3 / 2, t2 / 2], [0, -1]],
    ['bottom', 'outer', [-t3 / 2, -t2 / 2], [L + t3 / 2, -t2 / 2], [0, 1]],
    ['left', 'inner', [t3 / 2, t2 / 2], [t3 / 2, Hc - t1 / 2], [1, 0]],
    ['left', 'outer', [-t3 / 2, -t2 / 2], [-t3 / 2, Hc + t1 / 2], [-1, 0]],
    ['right', 'inner', [L - t3 / 2, t2 / 2], [L - t3 / 2, Hc - t1 / 2], [-1, 0]],
    ['right', 'outer', [L + t3 / 2, -t2 / 2], [L + t3 / 2, Hc + t1 / 2], [1, 0]],
  ];
  for (const [member, face, a, b, n] of layers) {
    const p = plan.get(`${member}:${face}`);
    if (!p || !p.selected) continue;
    const c = p.cover / 1000;
    const ax = a[0] + n[0] * c, ay = a[1] + n[1] * c;
    const bx = b[0] + n[0] * c, by = b[1] + n[1] * c;
    rebarLayer += `<line class="rebar" x1="${m.X(ax)}" y1="${m.Y(ay)}" x2="${m.X(bx)}" y2="${m.Y(by)}"/>`;
  }

  // 配筋の凡例
  let legend = '';
  const order = [['top', 'outer'], ['top', 'inner'], ['bottom', 'outer'], ['bottom', 'inner'],
    ['left', 'outer'], ['left', 'inner']];
  order.forEach(([member, face], i) => {
    const p = plan.get(`${member}:${face}`);
    if (!p || !p.selected) return;
    legend += `<text class="note" x="8" y="${13 + i * 12}">${esc(p.memberName)}${face === 'outer' ? '外' : '内'}: ${esc(p.selected.label)}</text>`;
  });

  return `<svg viewBox="0 0 ${w} ${h}" class="fig" role="img" aria-label="断面図">
  <defs>
    <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="6" stroke="#c7d2df" stroke-width="1.6"/>
    </pattern>
  </defs>
  <path d="${outerPath(geo, m)} ${voidPath(geo, m)}" fill="url(#hatch)" fill-rule="evenodd"
        stroke="#25405c" stroke-width="1.8"/>
  ${rebarLayer}
  ${dimLine(m, -t3 / 2, Hc + t1 / 2, L + t3 / 2, Hc + t1 / 2, `外幅 ${mm(geo.outerW)}`, 0.45)}
  ${dimLine(m, t3 / 2, t2 / 2, L - t3 / 2, t2 / 2, `内空幅 ${mm(geo.dims.B)}`, -0.55)}
  ${dimLine(m, -t3 / 2, -t2 / 2, -t3 / 2, Hc + t1 / 2, `外高 ${mm(geo.outerH)}`, -0.45, true)}
  ${dimLine(m, t3 / 2, t2 / 2, t3 / 2, Hc - t1 / 2, `内空高 ${mm(geo.dims.H)}`, 0.30, true)}
  <text class="note" x="${m.X(L / 2)}" y="${m.Y(Hc + t1 / 2) - 26}" text-anchor="middle">頂版 t=${mm(t1)}</text>
  <text class="note" x="${m.X(L / 2)}" y="${m.Y(-t2 / 2) + 58}" text-anchor="middle">底版 t=${mm(t2)}</text>
  <text class="note" x="${m.X(L + t3 / 2) + 6}" y="${m.Y(Hc / 2)}">側壁 t=${mm(t3)}</text>
  <text class="note" x="${m.X(t3 / 2) + 4}" y="${m.Y(Hc - t1 / 2) + 22}">ハンチ ${mm(geo.dims.hTh)}×${mm(geo.dims.hTv)}</text>
  ${legend}
</svg>`;
}

/** 荷重図 */
export function loadSVG(result, w = 520, h = 460) {
  const geo = result.geo;
  const s = result.loads.summary;
  const { L, Hc } = geo;
  const { t1, t2, t3 } = geo.dims;
  const pad = 86;
  const m = makeMapper(-t3 / 2, L + t3 / 2, -t2 / 2, Hc + t1 / 2, w, h, pad);

  const pmax = Math.max(s.qTop, s.lateralBottomLeft, s.lateralBottomRight,
    result.ana.maxReactionPressure, s.uBottom, 1);
  const A = 46 / pmax; // kN/m2 → px

  const arrow = (x1, y1, x2, y2, cls = '') =>
    `<line class="arrow ${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ah)"/>`;

  // 頂版上の鉛直荷重
  let g = '';
  const yTop = m.Y(Hc + t1 / 2);
  const nTop = 7;
  for (let i = 0; i <= nTop; i++) {
    const x = m.X(-t3 / 2 + ((L + t3) * i) / nTop);
    g += arrow(x, yTop - s.qTop * A, x, yTop - 3);
  }
  g += `<line class="lvl" x1="${m.X(-t3 / 2)}" y1="${yTop - s.qTop * A}" x2="${m.X(L + t3 / 2)}" y2="${yTop - s.qTop * A}"/>`;
  g += `<text class="note" x="${m.X(L / 2)}" y="${yTop - s.qTop * A - 8}" text-anchor="middle">鉛直荷重 ${fmt(s.qTop)} kN/m²(土圧 ${fmt(s.earthTop)} + 活荷重 ${fmt(s.live.q)})</text>`;

  // 側方土圧(台形)
  for (const [side, pTop, pBot] of [
    ['left', s.lateralTopLeft, s.lateralBottomLeft],
    ['right', s.lateralTopRight, s.lateralBottomRight]]) {
    const xw = side === 'left' ? -t3 / 2 : L + t3 / 2;
    const dir = side === 'left' ? -1 : 1;
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const y = (Hc + t1 / 2) - ((Hc + (t1 + t2) / 2) * i) / n;
      const p = pTop + (pBot - pTop) * (i / n);
      const xa = m.X(xw) + dir * p * A;
      g += arrow(xa, m.Y(y), m.X(xw) + dir * 3, m.Y(y), 'lat');
    }
    g += `<line class="lvl" x1="${m.X(xw) + dir * pTop * A}" y1="${m.Y(Hc + t1 / 2)}" x2="${m.X(xw) + dir * pBot * A}" y2="${m.Y(-t2 / 2)}"/>`;
    if (side === 'left') {
      g += `<text class="note" x="${m.X(xw) - pTop * A - 4}" y="${m.Y(Hc + t1 / 2) - 6}" text-anchor="end">${fmt(pTop)}</text>`;
      g += `<text class="note" x="${m.X(xw) - pBot * A - 4}" y="${m.Y(-t2 / 2) + 14}" text-anchor="end">${fmt(pBot)} kN/m²</text>`;
    }
  }

  // 底版反力
  const yBot = m.Y(-t2 / 2);
  const rp = result.ana.reactionProfile;
  const nR = 7;
  for (let i = 0; i <= nR; i++) {
    const s0 = (geo.L * i) / nR;
    const p = rp.reduce((b, q) => (Math.abs(q.s - s0) < Math.abs(b.s - s0) ? q : b)).pressure;
    const x = m.X(s0);
    g += arrow(x, yBot + p * A, x, yBot + 3, 'react');
  }
  g += `<text class="note" x="${m.X(L / 2)}" y="${yBot + result.ana.maxReactionPressure * A + 16}" text-anchor="middle">地盤反力 最大 ${fmt(result.ana.maxReactionPressure)} kN/m²</text>`;

  if (s.uBottom > 0) {
    g += `<text class="note" x="${m.X(L / 2)}" y="${yBot + result.ana.maxReactionPressure * A + 30}" text-anchor="middle">揚圧力 ${fmt(s.uBottom)} kN/m²</text>`;
  }

  return `<svg viewBox="0 0 ${w} ${h}" class="fig" role="img" aria-label="荷重図">
  <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M0,1L9,5L0,9z" fill="#c2410c"/></marker></defs>
  <path d="${outerPath(geo, m)} ${voidPath(geo, m)}" fill="#eef2f7" fill-rule="evenodd" stroke="#25405c" stroke-width="1.6"/>
  ${g}
</svg>`;
}

const DIAGRAM_META = {
  M: { title: '曲げモーメント図 M', unit: 'kN·m/m', digits: 1 },
  S: { title: 'せん断力図 S', unit: 'kN/m', digits: 1 },
  N: { title: '軸力図 N(圧縮正)', unit: 'kN/m', digits: 1 },
};

/** 断面力図。値は部材の内空側法線方向に取る。 */
export function diagramSVG(result, kind, w = 520, h = 460) {
  const geo = result.geo;
  const { L, Hc } = geo;
  const { t1, t2, t3 } = geo.dims;
  const meta = DIAGRAM_META[kind];

  // 曲げモーメントは引張側(内空側を正)に、せん断力・軸力は外側に描く
  const INWARD = { top: [0, -1], bottom: [0, 1], left: [1, 0], right: [-1, 0] };
  const dirSign = kind === 'M' ? 1 : -1;
  const NORMAL = Object.fromEntries(Object.entries(INWARD)
    .map(([k, [a, b]]) => [k, [a * dirSign, b * dirSign]]));

  let vmax = 0;
  for (const key of Object.keys(NORMAL)) {
    for (const p of result.ana.diagrams[key]) vmax = Math.max(vmax, Math.abs(p[kind]));
  }
  // 図の振幅(モデル座標)。外側に張り出す分だけ描画範囲を広げて収める。
  const amp = 0.26 * Math.min(L, Hc);
  const scale = vmax > 0 ? amp / vmax : 0;
  const m = makeMapper(
    -t3 / 2 - amp, L + t3 / 2 + amp,
    -t2 / 2 - amp, Hc + t1 / 2 + amp,
    w, h - 26, 24,
  );

  let paths = '';
  let labels = '';
  for (const key of Object.keys(NORMAL)) {
    const mem = geo.memberMap[key];
    const [nx, ny] = NORMAL[key];
    const pts = result.ana.diagrams[key];
    const base = [];
    const val = [];
    for (const p of pts) {
      const bx = mem.start.x + mem.dir.ux * p.s;
      const by = mem.start.y + mem.dir.uy * p.s;
      base.push([bx, by]);
      val.push([bx + nx * p[kind] * scale, by + ny * p[kind] * scale]);
    }
    const d = 'M' + [...base.slice(0, 1), ...val, ...base.slice(-1).reverse()]
      .map(([x, y]) => `${m.X(x).toFixed(1)},${m.Y(y).toFixed(1)}`).join('L') + 'Z';
    paths += `<path class="diag ${kind}" d="${d}"/>`;

    // 極値の注記
    let iMax = 0; let iMin = 0;
    pts.forEach((p, i) => {
      if (p[kind] > pts[iMax][kind]) iMax = i;
      if (p[kind] < pts[iMin][kind]) iMin = i;
    });
    for (const i of new Set([iMax, iMin])) {
      const p = pts[i];
      if (Math.abs(p[kind]) < vmax * 0.08) continue;
      const [vx, vy] = val[i];
      labels += `<text class="val" x="${m.X(vx) + nx * 6}" y="${m.Y(vy) - ny * 4}" text-anchor="${nx > 0 ? 'start' : nx < 0 ? 'end' : 'middle'}">${fmt(p[kind], meta.digits)}</text>`;
    }
  }

  return `<svg viewBox="0 0 ${w} ${h}" class="fig" role="img" aria-label="${esc(meta.title)}">
  <path d="${outerPath(geo, m)} ${voidPath(geo, m)}" fill="#f6f8fb" fill-rule="evenodd" stroke="#93a5b8" stroke-width="1"/>
  <path class="axis" d="M${m.X(0)},${m.Y(0)}L${m.X(L)},${m.Y(0)}L${m.X(L)},${m.Y(Hc)}L${m.X(0)},${m.Y(Hc)}Z"/>
  ${paths}${labels}
  <text class="title" x="10" y="${h - 12}">${esc(meta.title)} (${meta.unit}) 最大 ${fmt(vmax, meta.digits)}</text>
</svg>`;
}

/** 底版反力の分布図(縦横は独立にスケールする) */
export function reactionSVG(result, w = 520, h = 220) {
  const geo = result.geo;
  const rp = result.ana.reactionProfile;
  const padL = 52, padR = 18, padT = 30, padB = 34;
  const pmax = Math.max(...rp.map((p) => p.pressure), 1);
  const pmin = Math.min(...rp.map((p) => p.pressure));
  const floor = Math.min(0, pmin);
  const top = pmax * 1.12;
  const X = (v) => padL + (v / geo.L) * (w - padL - padR);
  const Y = (v) => h - padB - ((v - floor) / (top - floor)) * (h - padT - padB);
  const d = 'M' + rp.map((p) => `${X(p.s).toFixed(1)},${Y(p.pressure).toFixed(1)}`).join('L');
  const ticks = [0, pmax / 2, pmax].map((v) =>
    `<line class="axis" x1="${padL}" y1="${Y(v)}" x2="${w - padR}" y2="${Y(v)}"/>`
    + `<text class="note" x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="fig" role="img" aria-label="底版反力分布">
    ${ticks}
    <path class="diag react" d="${d}L${X(geo.L)},${Y(0)}L${X(0)},${Y(0)}Z"/>
    <line class="axis" x1="${padL}" y1="${Y(0)}" x2="${w - padR}" y2="${Y(0)}"/>
    <text class="title" x="10" y="16">底版の地盤反力度 (kN/m²)</text>
    <text class="note" x="${X(0)}" y="${h - 12}" text-anchor="middle">0</text>
    <text class="note" x="${X(geo.L)}" y="${h - 12}" text-anchor="middle">${fmt(geo.L, 2)} m</text>
    <text class="val" x="${X(geo.L / 2)}" y="${Y(pmax) - 6}" text-anchor="middle">最大 ${fmt(pmax)} / 最小 ${fmt(pmin)}</text>
  </svg>`;
}

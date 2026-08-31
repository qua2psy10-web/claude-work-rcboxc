/**
 * 形状モデルの生成
 *
 * 単室ボックスカルバートを部材軸線(中心線)の閉合ラーメンとしてモデル化し、
 * ハンチによる断面変化を含む要素分割まで行う。
 *
 * 入力の寸法はすべて mm、内部では m に換算して扱う。
 *
 *      ┌──────────────┐   ← 頂版 (top)
 *      │ ╲          ╱ │      ハンチ
 *      │              │   ← 側壁 (left / right)
 *      │ ╱          ╲ │
 *      └──────────────┘   ← 底版 (bottom)
 */

import { GAMMA_C, concreteProps } from './units.js';

export const MEMBER_LABELS = {
  top: '頂版',
  bottom: '底版',
  left: '左側壁',
  right: '右側壁',
};

/**
 * 部材の任意位置 s(部材始点からの距離, m)における断面高さを返す関数を作る。
 * 隅角部(直交部材の板厚の半分)ではハンチ込みの全高、
 * そこからハンチ長にわたって基本厚まで直線的に変化する。
 */
function makeHeightFn(t, L, e1, e2) {
  return (s) => {
    const from1 = s;
    const from2 = L - s;
    const h1 =
      from1 <= e1.joint
        ? t + e1.add
        : from1 <= e1.joint + e1.taper && e1.taper > 0
          ? t + e1.add * (1 - (from1 - e1.joint) / e1.taper)
          : t;
    const h2 =
      from2 <= e2.joint
        ? t + e2.add
        : from2 <= e2.joint + e2.taper && e2.taper > 0
          ? t + e2.add * (1 - (from2 - e2.joint) / e2.taper)
          : t;
    return Math.max(h1, h2);
  };
}

/** 分割位置の候補を整理する(重複除去・範囲内へ丸め) */
function cleanBreakpoints(list, L) {
  const eps = 1e-9;
  const out = [];
  for (const v of list) {
    if (!Number.isFinite(v)) continue;
    if (v < eps || v > L - eps) continue;
    if (out.some((x) => Math.abs(x - v) < 1e-6)) continue;
    out.push(v);
  }
  out.sort((a, b) => a - b);
  return [0, ...out, L];
}

/**
 * @param {object} dims 寸法(mm)
 *   clearWidth, clearHeight, topThickness, bottomThickness, wallThickness,
 *   haunchTopH, haunchTopV, haunchBottomH, haunchBottomV
 * @param {object} opts { sigmaCk, divisions, extraWallBreaks:[m] }
 */
export function buildGeometry(dims, opts = {}) {
  const mm = (v) => (v || 0) / 1000;
  const B = mm(dims.clearWidth);
  const H = mm(dims.clearHeight);
  const t1 = mm(dims.topThickness);
  const t2 = mm(dims.bottomThickness);
  const t3 = mm(dims.wallThickness);
  const hTh = mm(dims.haunchTopH);
  const hTv = mm(dims.haunchTopV);
  const hBh = mm(dims.haunchBottomH);
  const hBv = mm(dims.haunchBottomV);

  if (!(B > 0 && H > 0 && t1 > 0 && t2 > 0 && t3 > 0)) {
    throw new Error('内空寸法および部材厚はすべて正の値としてください。');
  }

  const L = B + t3;              // 設計スパン(側壁中心間距離)
  const Hc = H + (t1 + t2) / 2;  // 設計高さ(頂版・底版中心間距離)
  const outerW = B + 2 * t3;
  const outerH = H + t1 + t2;

  const divisions = opts.divisions || 24;
  const sigmaCk = opts.sigmaCk ?? 24;
  const E = concreteProps(sigmaCk).Ec * 1000; // N/mm2 → kN/m2
  const width = 1.0;                          // 奥行 1m 当たり

  // 隅角部の節点(左下・右下・左上・右上)
  const nodes = [
    { x: 0, y: 0, tag: 'BL' },
    { x: L, y: 0, tag: 'BR' },
    { x: 0, y: Hc, tag: 'TL' },
    { x: L, y: Hc, tag: 'TR' },
  ];
  const elements = [];

  const defs = [
    {
      key: 'bottom', from: 0, to: 1, length: L, t: t2,
      e1: { joint: t3 / 2, taper: hBh, add: hBv },
      e2: { joint: t3 / 2, taper: hBh, add: hBv },
      breaks: [L / 2],
    },
    {
      key: 'top', from: 2, to: 3, length: L, t: t1,
      e1: { joint: t3 / 2, taper: hTh, add: hTv },
      e2: { joint: t3 / 2, taper: hTh, add: hTv },
      breaks: [L / 2],
    },
    {
      key: 'left', from: 0, to: 2, length: Hc, t: t3,
      e1: { joint: t2 / 2, taper: hBv, add: hBh },
      e2: { joint: t1 / 2, taper: hTv, add: hTh },
      breaks: [Hc / 2, ...(opts.extraWallBreaks || [])],
    },
    {
      key: 'right', from: 1, to: 3, length: Hc, t: t3,
      e1: { joint: t2 / 2, taper: hBv, add: hBh },
      e2: { joint: t1 / 2, taper: hTv, add: hTh },
      breaks: [Hc / 2, ...(opts.extraWallBreaks || [])],
    },
  ];

  const members = defs.map((d) => {
    const a = nodes[d.from];
    const b = nodes[d.to];
    const ux = (b.x - a.x) / d.length;
    const uy = (b.y - a.y) / d.length;
    const heightAt = makeHeightFn(d.t, d.length, d.e1, d.e2);

    // ハンチ端・支点前面などを分割の切れ目として必ず含める
    const key = [
      d.e1.joint, d.e1.joint + d.e1.taper,
      d.length - d.e2.joint - d.e2.taper, d.length - d.e2.joint,
      ...d.breaks,
    ];
    const bp = cleanBreakpoints(key, d.length);
    const target = d.length / divisions;

    const sList = [0];
    for (let i = 0; i < bp.length - 1; i++) {
      const seg = bp[i + 1] - bp[i];
      const n = Math.max(1, Math.round(seg / target));
      for (let k = 1; k <= n; k++) sList.push(bp[i] + (seg * k) / n);
    }

    const nodeIds = [d.from];
    for (let i = 1; i < sList.length - 1; i++) {
      nodeIds.push(nodes.length);
      nodes.push({ x: a.x + ux * sList[i], y: a.y + uy * sList[i] });
    }
    nodeIds.push(d.to);

    const elemIds = [];
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const sMid = (sList[i] + sList[i + 1]) / 2;
      const h = heightAt(sMid);
      elemIds.push(elements.length);
      elements.push({
        n1: nodeIds[i], n2: nodeIds[i + 1],
        E, A: width * h, I: (width * h ** 3) / 12,
        member: d.key, s1: sList[i], s2: sList[i + 1], sMid, h,
      });
    }

    return {
      key: d.key,
      name: MEMBER_LABELS[d.key],
      length: d.length,
      t: d.t,
      e1: d.e1,
      e2: d.e2,
      dir: { ux, uy },
      start: { x: a.x, y: a.y },
      end: { x: b.x, y: b.y },
      heightAt,
      sList,
      nodeIds,
      elemIds,
      /** ハンチ端位置(端1側・端2側)。せん断・曲げの照査位置に用いる */
      haunchEnd1: d.e1.joint + d.e1.taper,
      haunchEnd2: d.length - d.e2.joint - d.e2.taper,
      /** 支点前面(直交部材の内面)位置 */
      face1: d.e1.joint,
      face2: d.length - d.e2.joint,
    };
  });

  const memberMap = Object.fromEntries(members.map((m) => [m.key, m]));

  // 実断面積からコンクリート体積(奥行1m当たり)を求める
  let concreteArea = 0;
  for (const m of members) {
    for (const id of m.elemIds) {
      const e = elements[id];
      // 側壁の隅角部は頂版・底版と重複するため自重の対象から外す
      if ((m.key === 'left' || m.key === 'right')) {
        const inJoint = e.sMid < m.e1.joint || e.sMid > m.length - m.e2.joint;
        if (inJoint) continue;
      }
      concreteArea += e.h * (e.s2 - e.s1);
    }
  }

  // 実形状から求めた正確なコンクリート断面積(外形 − 内空 + ハンチ4か所)
  const solidArea = outerW * outerH - B * H + (hTh * hTv) + (hBh * hBv);
  // 部材軸線モデルでは隅角部の形状を厳密には表せないため、自重の総量が
  // 実形状と一致するよう分布自重に補正係数を掛ける。
  const weightFactor = concreteArea > 0 ? solidArea / concreteArea : 1;

  return {
    dims: { B, H, t1, t2, t3, hTh, hTv, hBh, hBv },
    L, Hc, outerW, outerH,
    width,
    E,
    nodes, elements, members, memberMap,
    concreteArea,
    solidArea,
    weightFactor,
    selfWeight: solidArea * GAMMA_C, // kN/m(奥行1m当たりの総重量)
  };
}

/** 部材上の位置 s に最も近い要素境界の情報を返す */
export function locate(member, s) {
  let best = 0;
  let bestDiff = Infinity;
  member.sList.forEach((v, i) => {
    const d = Math.abs(v - s);
    if (d < bestDiff) { bestDiff = d; best = i; }
  });
  return { index: best, s: member.sList[best] };
}

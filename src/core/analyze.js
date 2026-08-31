/**
 * 形状と荷重から骨組解析を行い、設計に必要な断面力を取り出す。
 *
 * 断面力の符号(設計用)
 *   M: 内側(内空側)引張を正、外側引張を負
 *   S: 絶対値で照査する
 *   N: 圧縮を正(部材軸方向)
 */

import { solveFrame } from './frame.js';

/** M>0 が内空側引張となる部材は +1、外側引張となる部材は -1 */
const INNER_SIGN = { top: 1, bottom: -1, left: 1, right: -1 };

export function analyze(geo, loads) {
  const result = solveFrame({
    nodes: geo.nodes,
    elements: geo.elements,
    elementLoads: loads.elementLoads,
    springs: loads.springs,
  });

  // 底版には離散化した地盤バネの集中反力が作用するため、節点でせん断力・軸力が
  // 不連続になる。実際の反力は連続分布であり、その位置の真の値は左右の平均に
  // 一致するので、節点値は前後の要素端の平均をとって平滑化する。
  const diagrams = {};
  for (const m of geo.members) {
    const sign = INNER_SIGN[m.key];
    const pts = [];
    const n = m.elemIds.length;
    m.elemIds.forEach((id, i) => {
      const f = result.members[id];
      const e = geo.elements[id];
      if (i === 0) {
        pts.push({ s: e.s1, M: sign * f.M[0], S: sign * f.S[0], N: -f.N[0], h: e.h });
      }
      if (i === n - 1) {
        pts.push({ s: e.s2, M: sign * f.M[1], S: sign * f.S[1], N: -f.N[1], h: e.h });
      } else {
        const g = result.members[m.elemIds[i + 1]];
        pts.push({
          s: e.s2,
          M: sign * f.M[1],
          S: (sign * f.S[1] + sign * g.S[0]) / 2,
          N: -(f.N[1] + g.N[0]) / 2,
          h: e.h,
        });
      }
    });
    diagrams[m.key] = pts;
  }

  const forceAt = (key, s) => {
    const pts = diagrams[key];
    let best = pts[0];
    let bd = Infinity;
    for (const p of pts) {
      const d = Math.abs(p.s - s);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  // 底版の地盤反力(上向き正、kN/m2)
  const bottom = geo.memberMap.bottom;
  const reactionProfile = bottom.nodeIds.map((nodeId, i) => {
    const sp = loads.springs.find((x) => x.node === nodeId);
    const sPrev = i === 0 ? bottom.sList[0] : bottom.sList[i - 1];
    const sNext = i === bottom.sList.length - 1 ? bottom.sList[i] : bottom.sList[i + 1];
    const trib = (sNext - sPrev) / 2;
    const R = result.springReactions.find((x) => x.node === nodeId);
    return {
      s: bottom.sList[i],
      settlement: -result.disp[nodeId * 3 + 1],   // 沈下量 m(下向き正)
      force: R ? R.fy : 0,                         // kN
      pressure: trib > 0 && R ? R.fy / (trib * geo.width) : 0, // kN/m2
    };
  });

  const totalReaction = result.springReactions.reduce((s, r) => s + r.fy, 0);
  const totalHorizontal = result.springReactions.reduce((s, r) => s + r.fx, 0);

  return {
    frame: result,
    diagrams,
    forceAt,
    reactionProfile,
    totalReaction,
    totalHorizontal,
    maxReactionPressure: Math.max(...reactionProfile.map((p) => p.pressure)),
    minReactionPressure: Math.min(...reactionProfile.map((p) => p.pressure)),
  };
}

/**
 * 照査断面の一覧を作る。
 * 各断面について、断面高さ・断面力・引張側の面(内側/外側)を持つ。
 */
export function checkSections(geo, ana) {
  const out = [];
  const add = (key, label, s, purpose) => {
    const m = geo.memberMap[key];
    const f = ana.forceAt(key, s);
    out.push({
      member: key,
      memberName: m.name,
      label,
      s,
      purpose,                       // 'span'(支間部) / 'end'(端部)
      h: m.heightAt(s),
      M: f.M,
      S: f.S,
      N: f.N,
      tensionSide: f.M >= 0 ? 'inner' : 'outer',
    });
  };

  for (const key of ['top', 'bottom', 'left', 'right']) {
    const m = geo.memberMap[key];
    add(key, `${m.name} 支間中央`, m.length / 2, 'span');
    add(key, `${m.name} ハンチ端(始)`, m.haunchEnd1, 'end');
    add(key, `${m.name} ハンチ端(終)`, m.haunchEnd2, 'end');
  }
  return out;
}

/**
 * せん断力の照査断面(τ点)。
 *
 * 照査位置は支点前面(直交部材の内面)から h/2 の位置とする。
 * その位置がハンチ内にある場合、部材断面の高さはハンチ高さ C' の 1/3 まで
 * 大きくとってよい(参照した実務の計算書による)。
 *
 *   h' = T + C'/3      C' はその位置におけるハンチの高さ
 *
 * ハンチが T/2 以下の場合、照査位置がハンチ端の外に出るため C' = 0 となり、
 * 基本厚 T のままとなる。
 */
export function shearSections(geo, ana) {
  const out = [];
  for (const key of ['top', 'bottom', 'left', 'right']) {
    const m = geo.memberMap[key];
    const T = m.t;
    const spots = [
      { label: `${m.name} τ点(始端)`, s: Math.min(m.face1 + T / 2, m.length / 2) },
      { label: `${m.name} τ点(終端)`, s: Math.max(m.face2 - T / 2, m.length / 2) },
    ];
    for (const spot of spots) {
      const f = ana.forceAt(key, spot.s);
      const hAt = m.heightAt(spot.s);
      const haunch = Math.max(0, hAt - T);   // C'
      const hEff = T + haunch / 3;           // h'
      out.push({
        member: key, memberName: m.name, label: spot.label, s: spot.s,
        T, haunch, hEff, h: hEff,
        M: f.M, S: f.S, N: f.N,
      });
    }
  }
  return out;
}

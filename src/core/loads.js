/**
 * 荷重の算定(道路土工 カルバート工指針の考え方による)
 *
 * 算定する荷重
 *   1. 躯体自重
 *   2. 鉛直土圧(埋戻し形式による鉛直土圧係数 α を考慮)
 *   3. 活荷重による鉛直土圧(T-25 後輪荷重の分布、衝撃を含む)
 *   4. 側方土圧(静止土圧、地下水位以下は有効応力+水圧)
 *   5. 活荷重による側方土圧
 *
 * 活荷重の載荷位置(live.mode)
 *   'top'  上載 … 輪荷重がカルバート直上にある。頂版に鉛直活荷重が載り、
 *                 側壁には活荷重による上載荷重を考慮しない。
 *   'side' 側載 … 荷重がカルバート側方にある。頂版に鉛直活荷重は載らず、
 *                 背面の上載荷重 Q(群集荷重)による側方土圧のみを考慮する。
 *   6. 外水圧・揚圧力(浮力)、内水重・内水圧
 *   7. 底版反力 → 弾性床(鉛直バネ)として与えるため荷重としては扱わない
 *
 * 深さ z(地表面から下向き)における応力
 *   σv(z)  = γ·min(z,dw) + γsat·max(0, z-dw)      全鉛直応力
 *   u(z)   = γw·max(0, z-dw)                       間隙水圧
 *   σh(z)  = K·(σv(z) - u(z)) + u(z)               側方応力
 */

import { GAMMA_W, GAMMA_C } from './units.js';

/** 衝撃係数(カルバート工指針: 土被りに応じた値) */
export function impactFactor(cover) {
  if (cover <= 1.5) return 0.5;
  if (cover >= 6.5) return 0;
  return 0.65 - 0.1 * cover;
}

/**
 * 活荷重による鉛直土圧
 *
 * 実務の設計計算書で用いられる式による。
 *   輪分布幅   ｕ ＝ a + 2H·tanθ      (進行方向)
 *              ｖ ＝ b + 2H·tanθ      (車両直角方向。参考値)
 *   活荷重     Ｐl  ＝ Ｐ(1+i)·β
 *              Ｐvl ＝ 2·Ｐl / Ｗ / ｕ
 * ここに Ｐ は後輪1輪の荷重(T-25 で 0.4×T ＝ 100 kN)、Ｗ は車両の占有幅(2.75 m)、
 * i は衝撃係数、β は断面力低減係数。
 *
 * @returns {{q:number, impact:number, beta:number, u:number, v:number,
 *            Pl:number, occupancy:number, note:string}}
 */
export function liveLoadPressure(cover, o = {}) {
  const P = o.wheelLoad ?? 100;           // 後輪1輪の荷重 kN(T-25 で 0.4×250)
  const a = o.contactA ?? 0.2;            // 接地長(進行方向) m
  const b = o.contactB ?? 0.5;            // 接地幅(車両直角方向) m
  const tanTheta = o.tanTheta ?? 1.0;     // 分布角(既定 45°)
  const W = o.occupancyWidth ?? 2.75;     // 車両の占有幅 m
  const beta = o.beta ?? 1.0;             // 断面力低減係数
  const i = o.impact ?? impactFactor(cover);

  const u = a + 2 * cover * tanTheta;
  const v = b + 2 * cover * tanTheta;
  const Pl = P * (1 + i) * beta;
  const q = (2 * Pl) / W / u;

  let note = '';
  if (cover < 0.5) {
    note = '土被りが 0.5m 未満です。分布荷重への置換は適用範囲外のため、'
      + '輪荷重の直接載荷による別途検討が必要です。';
  } else if (cover >= 6.5) {
    note = '土被りが大きく衝撃を考慮しない範囲です。';
  }
  return { q, impact: i, beta, u, v, Pl, occupancy: W, note };
}

/** 深さ z における全鉛直応力・間隙水圧 */
export function verticalStress(z, soil) {
  const dw = soil.waterDepth;                       // 地表面から地下水位までの深さ m
  const above = Math.min(Math.max(z, 0), dw);
  const below = Math.max(0, z - dw);
  return {
    sigmaV: soil.gamma * above + soil.gammaSat * below,
    u: GAMMA_W * below,
  };
}

/** 深さ z における側方応力(静止土圧 + 水圧) */
export function lateralStress(z, soil, K) {
  const { sigmaV, u } = verticalStress(z, soil);
  return K * (sigmaV - u) + u;
}

/**
 * 骨組モデルに載せる荷重群を組み立てる。
 *
 * @param {object} geo buildGeometry の戻り値
 * @param {object} cond 設計条件
 * @returns {{elementLoads:Array, springs:Array, summary:object, warnings:string[]}}
 */
export function buildLoads(geo, cond) {
  const warnings = [];
  const soil = {
    gamma: cond.soil.gamma,
    gammaSat: cond.soil.gammaSat ?? cond.soil.gamma + 1.0,
    waterDepth: cond.soil.waterLevel === null || cond.soil.waterLevel === undefined
      ? Infinity
      : cond.soil.waterLevel,
  };
  const cover = cond.soil.cover;                 // 土被り(頂版上面まで) m
  const alpha = cond.soil.alpha ?? 1.0;          // 鉛直土圧係数(突出形で 1.0 超)
  const Kl = cond.soil.K0Left ?? cond.soil.K0;
  const Kr = cond.soil.K0Right ?? cond.soil.K0;
  const gammaC = cond.material.gammaC ?? GAMMA_C;

  const { t1, t2 } = geo.dims;
  const zTop = cover;                     // 頂版上面の深さ
  const zBottom = cover + geo.outerH;     // 底版下面の深さ
  const zTopAxis = cover + t1 / 2;        // 頂版中心線の深さ
  const zBottomAxis = zBottom - t2 / 2;   // 底版中心線の深さ

  const elementLoads = [];
  const push = (elem, wx1, wy1, wx2, wy2) =>
    elementLoads.push({ elem, wx1, wy1, wx2, wy2 });

  // ---- 1. 自重 ----------------------------------------------------------
  let selfWeightTotal = 0;
  for (const m of geo.members) {
    for (const id of m.elemIds) {
      const e = geo.elements[id];
      if (m.key === 'left' || m.key === 'right') {
        // 隅角部は頂版・底版の自重に含まれるため二重計上しない
        if (e.sMid < m.e1.joint || e.sMid > m.length - m.e2.joint) continue;
      }
      const w = e.A * gammaC * geo.weightFactor; // kN/m(隅角部の形状差を補正)
      push(id, 0, -w, 0, -w);
      selfWeightTotal += w * (e.s2 - e.s1);
    }
  }

  // ---- 2. 鉛直土圧 ------------------------------------------------------
  const { sigmaV: sigmaVTop, u: uTop } = verticalStress(zTop, soil);
  const earthTop = alpha * sigmaVTop;  // 頂版上面に作用する全鉛直圧 kN/m2

  // ---- 3. 活荷重 --------------------------------------------------------
  const mode = cond.live.mode ?? 'top';
  const live = cond.live.enabled && mode === 'top'
    ? liveLoadPressure(cover, cond.live)
    : { q: 0, impact: 0, La: 0, Lb: 0, overlap: false, note: '' };
  if (cond.live.enabled && mode === 'top' && live.note) warnings.push(live.note);
  // 側載時は背面の上載荷重(群集荷重)のみを考慮する
  const surcharge = cond.live.enabled && mode === 'side'
    ? (cond.live.surcharge ?? 10)
    : 0;

  const qTop = earthTop + live.q; // 頂版に載る鉛直荷重 kN/m2
  for (const id of geo.memberMap.top.elemIds) push(id, 0, -qTop, 0, -qTop);

  // ---- 4,5. 側方土圧(側載時の上載荷重ぶんを含む) ------------------------
  const liveLateral = surcharge;
  const wallPressure = (z, K) =>
    lateralStress(z, soil, K) + K * alpha * liveLateral;

  for (const [key, K, sign] of [['left', Kl, +1], ['right', Kr, -1]]) {
    const m = geo.memberMap[key];
    for (const id of m.elemIds) {
      const e = geo.elements[id];
      // 側壁は下から上へ向かう部材。s から深さへ変換
      const z1 = zBottomAxis - e.s1;
      const z2 = zBottomAxis - e.s2;
      const p1 = wallPressure(z1, K);
      const p2 = wallPressure(z2, K);
      // 左側壁は右向き(+x)、右側壁は左向き(-x)に押す
      push(id, sign * p1, 0, sign * p2, 0);
    }
  }

  // ---- 6. 揚圧力・内水 --------------------------------------------------
  const uBottom = verticalStress(zBottom, soil).u; // 底版下面の揚圧力 kN/m2
  if (uBottom > 0) {
    for (const id of geo.memberMap.bottom.elemIds) push(id, 0, +uBottom, 0, +uBottom);
  }

  const innerWater = cond.water?.innerLevel ?? 0; // 内空底面からの内水位 m
  let innerWeight = 0;
  if (innerWater > 0) {
    const hw = Math.min(innerWater, geo.dims.H);
    const pw = GAMMA_W * hw;
    // 内水は内空幅の範囲にのみ載る(側壁の直上には水はない)
    innerWeight = pw * geo.dims.B;
    const bm = geo.memberMap.bottom;
    for (const id of bm.elemIds) {
      const e = geo.elements[id];
      if (e.sMid < geo.dims.t3 / 2 || e.sMid > bm.length - geo.dims.t3 / 2) continue;
      push(id, 0, -pw, 0, -pw);
    }
    // 内水圧は側壁を外向きに押す
    const yInnerBottom = t2 / 2; // 底版内面(部材座標)
    for (const [key, sign] of [['left', -1], ['right', +1]]) {
      const m = geo.memberMap[key];
      for (const id of m.elemIds) {
        const e = geo.elements[id];
        const d1 = yInnerBottom + hw - e.s1;
        const d2 = yInnerBottom + hw - e.s2;
        const p1 = GAMMA_W * Math.max(0, d1);
        const p2 = GAMMA_W * Math.max(0, d2);
        if (p1 === 0 && p2 === 0) continue;
        push(id, sign * p1, 0, sign * p2, 0);
      }
    }
  }

  // ---- 7. 基礎バネ ------------------------------------------------------
  const kv = cond.ground.kv;                  // 鉛直地盤反力係数 kN/m3
  const kh = cond.ground.kh ?? kv / 3;        // 水平方向のせん断バネ kN/m3
  const bottom = geo.memberMap.bottom;
  const springs = bottom.nodeIds.map((nodeId, i) => {
    const sPrev = i === 0 ? bottom.sList[0] : bottom.sList[i - 1];
    const sNext = i === bottom.sList.length - 1
      ? bottom.sList[i] : bottom.sList[i + 1];
    const trib = (sNext - sPrev) / 2;
    return { node: nodeId, ky: kv * trib * geo.width, kx: kh * trib * geo.width };
  });

  const summary = {
    cover, alpha, Kl, Kr,
    zTop, zBottom, zTopAxis, zBottomAxis,
    waterDepth: soil.waterDepth,
    sigmaVTop, uTop, earthTop,
    live, liveMode: mode, surcharge,
    qTop,
    lateralTopLeft: wallPressure(zTopAxis, Kl),
    lateralBottomLeft: wallPressure(zBottomAxis, Kl),
    lateralTopRight: wallPressure(zTopAxis, Kr),
    lateralBottomRight: wallPressure(zBottomAxis, Kr),
    uBottom,
    innerWater,
    innerWeight,
    selfWeight: selfWeightTotal,
    // 鉛直方向の総荷重(下向き正)= 底版が受け持つべき力
    totalVertical:
      selfWeightTotal + qTop * geo.L + innerWeight - uBottom * geo.L,
    kv, kh,
  };

  if (soil.waterDepth < zBottom && !cond.water?.acknowledged) {
    warnings.push('地下水位が底版下面より浅いため、浮上りの検討が必要です。');
  }

  return { elementLoads, springs, summary, warnings };
}

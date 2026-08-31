/**
 * 安定・基礎の検討
 *
 *   1. 鉛直支持力  … 底版下面の最大地盤反力度 ≦ 許容支持力度
 *   2. 浮上り      … (躯体自重 + 上載土重 + 内水重) / 揚圧力 ≧ 所要安全率
 *   3. 水平力      … 左右の土圧差に対する底面摩擦抵抗の安全率
 *   4. 底版反力の偏り … 反力が負(浮き)となる範囲がないこと
 */

import { verticalStress } from './loads.js';
import { GAMMA_W } from './units.js';

export function checkStability(geo, loads, ana, cond) {
  const s = loads.summary;
  const items = [];

  // ---- 1. 鉛直支持力 ----------------------------------------------------
  const qa = cond.ground.qa;
  const qMax = ana.maxReactionPressure;
  items.push({
    key: 'bearing',
    label: '鉛直支持力',
    detail: '底版下面の最大地盤反力度 ≦ 許容支持力度',
    value: qMax, allow: qa, unit: 'kN/m²',
    ratio: qa > 0 ? qMax / qa : Infinity,
    ok: qMax <= qa,
    text: `最大反力度 ${qMax.toFixed(1)} kN/m² ≦ 許容支持力度 ${qa.toFixed(1)} kN/m²`,
  });

  // ---- 2. 浮上り --------------------------------------------------------
  const soil = {
    gamma: cond.soil.gamma,
    gammaSat: cond.soil.gammaSat ?? cond.soil.gamma + 1.0,
    waterDepth: cond.soil.waterLevel ?? Infinity,
  };
  const coverWeight = verticalStress(s.zTop, soil).sigmaV * geo.outerW; // kN/m
  const uplift = s.uBottom * geo.outerW;
  const resisting = s.selfWeight + coverWeight + s.innerWeight;
  const fsRequired = cond.ground.upliftSafety ?? 1.2;
  const fsUplift = uplift > 0 ? resisting / uplift : Infinity;
  items.push({
    key: 'uplift',
    label: '浮上りに対する安定',
    detail: '(躯体自重 + 上載土重 + 内水重) / 揚圧力 ≧ 所要安全率',
    value: fsUplift, allow: fsRequired, unit: '',
    ratio: fsUplift > 0 ? fsRequired / fsUplift : Infinity,
    ok: fsUplift >= fsRequired,
    text: uplift > 0
      ? `抵抗力 ${resisting.toFixed(1)} kN/m ÷ 揚圧力 ${uplift.toFixed(1)} kN/m = ${fsUplift.toFixed(2)} ≧ ${fsRequired.toFixed(2)}`
      : '地下水位が底版下面より深く、揚圧力は生じません。',
    parts: { selfWeight: s.selfWeight, coverWeight, innerWeight: s.innerWeight, uplift },
  });

  // ---- 3. 水平力 --------------------------------------------------------
  const netH = -ana.totalHorizontal;                 // 構造に作用する正味の水平力 kN/m
  const mu = cond.ground.friction ?? 0.6;
  const V = ana.totalReaction;                       // 底面の鉛直反力合計 kN/m
  const resistH = mu * Math.max(0, V);
  const fsSlide = Math.abs(netH) > 1e-6 ? resistH / Math.abs(netH) : Infinity;
  const fsSlideRequired = cond.ground.slideSafety ?? 1.5;
  items.push({
    key: 'slide',
    label: '水平力の釣合い',
    detail: '底面摩擦抵抗 / 左右土圧の不均衡力 ≧ 所要安全率',
    value: fsSlide, allow: fsSlideRequired, unit: '',
    ratio: fsSlide > 0 ? fsSlideRequired / fsSlide : Infinity,
    ok: fsSlide >= fsSlideRequired,
    text: Math.abs(netH) > 1e-6
      ? `摩擦抵抗 ${resistH.toFixed(1)} kN/m ÷ 不均衡力 ${Math.abs(netH).toFixed(1)} kN/m = ${fsSlide.toFixed(2)}`
      : '左右対称の荷重条件のため、不均衡水平力は生じません。',
  });

  // ---- 4. 底版反力の偏り ------------------------------------------------
  const qMin = ana.minReactionPressure;
  items.push({
    key: 'reaction',
    label: '底版反力の分布',
    detail: '底版下面に浮き(負の反力)が生じないこと',
    value: qMin, allow: 0, unit: 'kN/m²',
    ratio: qMin >= 0 ? 0 : Infinity,
    ok: qMin >= -1e-6,
    text: `最小反力度 ${qMin.toFixed(1)} kN/m²`,
  });

  // ---- 検算: 鉛直方向の釣合い -------------------------------------------
  const balance = {
    applied: s.totalVertical,
    reaction: ana.totalReaction,
    error: Math.abs(s.totalVertical - ana.totalReaction),
  };

  return {
    items,
    balance,
    ok: items.every((i) => i.ok),
    detail: { coverWeight, uplift, resisting, netH, V, mu, gammaW: GAMMA_W },
  };
}

/**
 * 許容応力度法による鉄筋コンクリート断面の照査
 *
 * 単鉄筋長方形断面(奥行 1000mm)を対象とし、ヤング係数比 n の弾性理論による。
 *   中立軸:  b·x²/2 = n·As·(d − x)
 *   応力度:  σc = 2M/(b·x·j·d),  σs = M/(As·j·d),  j = 1 − x/(3d)
 *   せん断:  τm = S/(b·j·d)
 *
 * 軸力(圧縮)は曲げによるコンクリート圧縮応力度に N/Ag を加算する形で
 * 付加的に考慮する(引張鉄筋側には安全側となるよう考慮しない)。
 * 単位は N・mm 系(M: N·mm、S: N、寸法: mm、応力度: N/mm2)。
 */

import { YOUNG_RATIO } from './units.js';

/** 中立軸位置 x(mm)。単鉄筋長方形断面。 */
export function neutralAxis(b, d, As, n = YOUNG_RATIO) {
  if (As <= 0) return 0;
  const k = (n * As) / b;
  return k * (Math.sqrt(1 + (2 * b * d) / (n * As)) - 1);
}

/**
 * 断面の応力度照査
 * @param {object} p
 *   M  曲げモーメント (kN·m/m、絶対値)
 *   S  せん断力 (kN/m、絶対値)
 *   N  軸圧縮力 (kN/m、圧縮正)
 *   h  部材厚 (mm)、b 幅 (mm、既定 1000)
 *   As 引張鉄筋量 (mm2/m)、cover かぶり (mm)、barDia 鉄筋径 (mm)
 *   allow { sigmaCa, sigmaSa, tauA1 }
 */
export function checkSection(p) {
  const b = p.b ?? 1000;
  const n = p.n ?? YOUNG_RATIO;
  const d = p.h - p.cover - p.barDia / 2;
  const M = Math.abs(p.M) * 1e6;   // kN·m → N·mm
  const S = Math.abs(p.S) * 1e3;   // kN → N
  const N = (p.N || 0) * 1e3;      // kN → N(圧縮正)
  const As = p.As;

  const x = neutralAxis(b, d, As, n);
  const j = 1 - x / (3 * d);
  const z = j * d;

  const sigmaCBending = As > 0 && x > 0 ? (2 * M) / (b * x * z) : Infinity;
  const sigmaCAxial = N / (b * p.h);
  const sigmaC = sigmaCBending + sigmaCAxial;
  const sigmaS = As > 0 ? M / (As * z) : Infinity;
  const tau = S / (b * z);

  const ratio = (v, a) => (a > 0 ? v / a : Infinity);
  const checks = {
    concrete: {
      label: 'コンクリート圧縮応力度',
      value: sigmaC, allow: p.allow.sigmaCa, unit: 'N/mm²',
      ratio: ratio(sigmaC, p.allow.sigmaCa),
    },
    steel: {
      label: '鉄筋引張応力度',
      value: sigmaS, allow: p.allow.sigmaSa, unit: 'N/mm²',
      ratio: ratio(sigmaS, p.allow.sigmaSa),
    },
    shear: {
      label: '平均せん断応力度',
      value: tau, allow: p.allow.tauA1, unit: 'N/mm²',
      ratio: ratio(tau, p.allow.tauA1),
    },
  };
  for (const c of Object.values(checks)) c.ok = c.ratio <= 1.0 + 1e-9;

  return {
    b, d, x, j, z, As,
    sigmaCBending, sigmaCAxial, sigmaC, sigmaS, tau,
    checks,
    ok: Object.values(checks).every((c) => c.ok),
    maxRatio: Math.max(...Object.values(checks).map((c) => c.ratio)),
  };
}

/**
 * 必要鉄筋量 As (mm2/m) を求める。
 * j が As に依存するため反復して収束させる。
 */
export function requiredAs(M, h, cover, barDia, sigmaSa, b = 1000, n = YOUNG_RATIO) {
  const d = h - cover - barDia / 2;
  const Mn = Math.abs(M) * 1e6;
  if (Mn <= 0 || d <= 0) return 0;
  let As = Mn / (sigmaSa * 0.875 * d);
  for (let i = 0; i < 30; i++) {
    const x = neutralAxis(b, d, As, n);
    const j = 1 - x / (3 * d);
    const next = Mn / (sigmaSa * j * d);
    if (Math.abs(next - As) < 1e-6 * Math.max(1, As)) { As = next; break; }
    As = next;
  }
  return As;
}

/** 最小鉄筋量(既定: 有効断面 b·d の 0.2%) */
export function minimumAs(h, cover, barDia, ratio = 0.002, b = 1000) {
  const d = h - cover - barDia / 2;
  return ratio * b * d;
}

/**
 * コンクリート断面が曲げ圧縮応力度で決まる場合に必要な最小の部材厚を返す。
 * 鉄筋量を無制限に増やしても σc ≦ σca とならない場合の判定に用いる。
 */
export function concreteCapacityMoment(h, cover, barDia, sigmaCa, sigmaSa, b = 1000, n = YOUNG_RATIO) {
  const d = h - cover - barDia / 2;
  // 釣合い中立軸比
  const kb = 1 / (1 + sigmaSa / (n * sigmaCa));
  const jb = 1 - kb / 3;
  return (0.5 * sigmaCa * b * kb * d * jb * d) / 1e6; // kN·m/m
}

/**
 * 材料定数・許容応力度テーブル・単位換算
 *
 * 応力度は N/mm2、力は kN、長さは m を基本とする。
 * 骨組解析では E を kN/m2 に換算して用いる。
 */

/** コンクリートの設計基準強度ごとの諸値(道路橋示方書に基づく) */
export const CONCRETE_TABLE = {
  21: { Ec: 23500, sigmaCa: 7.0, tauA1: 0.22, tauA2: 1.6, bondA: 1.4 },
  24: { Ec: 25000, sigmaCa: 8.0, tauA1: 0.23, tauA2: 1.7, bondA: 1.6 },
  27: { Ec: 26500, sigmaCa: 9.0, tauA1: 0.24, tauA2: 1.8, bondA: 1.7 },
  30: { Ec: 28000, sigmaCa: 10.0, tauA1: 0.25, tauA2: 1.9, bondA: 1.8 },
  40: { Ec: 31000, sigmaCa: 14.0, tauA1: 0.28, tauA2: 2.1, bondA: 2.0 },
};
// Ec: N/mm2、sigmaCa: 許容曲げ圧縮応力度、tauA1: 斜引張鉄筋を用いない場合の
// 許容せん断応力度、tauA2: 斜引張鉄筋を用いる場合の上限、bondA: 異形鉄筋の許容付着応力度

/** 鉄筋の許容引張応力度(N/mm2)。一般部材の値。 */
export const REBAR_TABLE = {
  SD295: { sigmaSa: 140, fy: 295 },
  SD345: { sigmaSa: 180, fy: 345 },
  SD390: { sigmaSa: 200, fy: 390 },
};

/** 異形鉄筋の呼び径ごとの公称断面積(mm2)と呼び径(mm) */
export const BAR_TABLE = {
  D10: { area: 71.33, d: 9.53 },
  D13: { area: 126.7, d: 12.7 },
  D16: { area: 198.6, d: 15.9 },
  D19: { area: 286.5, d: 19.1 },
  D22: { area: 387.1, d: 22.2 },
  D25: { area: 506.7, d: 25.4 },
  D29: { area: 642.4, d: 28.6 },
  D32: { area: 794.2, d: 31.8 },
};

export const GAMMA_W = 9.8;      // 水の単位体積重量 kN/m3
export const GAMMA_C = 24.5;     // 鉄筋コンクリートの単位体積重量 kN/m3
export const YOUNG_RATIO = 15;   // ヤング係数比 n = Es/Ec(設計上の標準値)

/** 設計基準強度から材料諸値を取り出す(表にない値は線形補間) */
export function concreteProps(sigmaCk) {
  if (CONCRETE_TABLE[sigmaCk]) return { ...CONCRETE_TABLE[sigmaCk], sigmaCk };
  const keys = Object.keys(CONCRETE_TABLE).map(Number).sort((a, b) => a - b);
  const lo = keys.filter((k) => k <= sigmaCk).pop() ?? keys[0];
  const hi = keys.find((k) => k >= sigmaCk) ?? keys[keys.length - 1];
  if (lo === hi) return { ...CONCRETE_TABLE[lo], sigmaCk };
  const r = (sigmaCk - lo) / (hi - lo);
  const a = CONCRETE_TABLE[lo];
  const b = CONCRETE_TABLE[hi];
  const mix = {};
  for (const k of Object.keys(a)) mix[k] = a[k] + (b[k] - a[k]) * r;
  return { ...mix, sigmaCk };
}

/** 鉄筋種別から許容応力度を取り出す */
export function rebarProps(grade) {
  const p = REBAR_TABLE[grade];
  if (!p) throw new Error(`未知の鉄筋種別: ${grade}`);
  return { ...p, grade };
}

export const mm2m = (v) => v / 1000;
export const m2mm = (v) => v * 1000;
/** N/mm2 → kN/m2 */
export const nmm2ToKnm2 = (v) => v * 1000;
/** kN/m2 → N/mm2 */
export const knm2ToNmm2 = (v) => v / 1000;

/** 表示用の丸め */
export const round = (v, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

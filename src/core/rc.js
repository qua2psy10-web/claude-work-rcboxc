/**
 * 許容応力度法による鉄筋コンクリート断面の照査
 *
 * 単鉄筋長方形断面(奥行 1000mm)を対象とし、ヤング係数比 n の弾性理論による。
 * 軸力を考慮した偏心圧縮として解く。
 *
 *   偏位量        e  = M / N
 *   鉄筋位置      c  = d − T/2        (部材中心軸と鉄筋間距離)
 *   軸力考慮曲げ  Ms = M + N·c        (引張鉄筋まわりのモーメント)
 *
 *   中立軸 x は次式の解として求める(N を掛けた形にして N=0 でも安定に解ける)。
 *     N·x³ − 3(N·T/2 − M)·x² + 6n·As/b·Ms·(x − d) = 0
 *
 *   応力度   σc = 2·Ms / (b·x·(d − x/3))
 *            σs = n·σc·(d − x) / x
 *   せん断   τm = S / (b·j·d),  j = 1 − x/(3d)
 *
 * N = 0 のとき中立軸の式は b·x²/2 = n·As·(d − x) に、
 * σc は 2M/(b·x·j·d) に一致し、軸力を無視した従来式に退化する。
 *
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
 * 軸力を考慮した中立軸 x(mm) を二分法で求める。
 * @param {number} M 曲げモーメント (N·mm、絶対値)
 * @param {number} N 軸圧縮力 (N、圧縮正)
 * @returns {{x:number, full:boolean}} full=true は断面全圧縮(引張が生じない)
 */
export function neutralAxisAxial(b, h, d, As, M, N, n = YOUNG_RATIO) {
  if (As <= 0) return { x: 0, full: false };
  const c = d - h / 2;
  const Ms = M + N * c;
  if (Ms <= 0) return { x: d, full: true };
  const k = (6 * n * As) / b;
  const f = (x) => N * x ** 3 - 3 * (N * h / 2 - M) * x ** 2 + k * Ms * (x - d);
  // f(0) = -k·Ms·d < 0。f(d) > 0 なら (0, d) に解がある。
  if (f(d) <= 0) return { x: d, full: true };
  let lo = 1e-9;
  let hi = d;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  return { x: (lo + hi) / 2, full: false };
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

  const c = d - p.h / 2;              // 部材中心軸と鉄筋間距離
  const Ms = M + N * c;               // 軸力を考慮した曲げモーメント
  const { x, full } = neutralAxisAxial(b, p.h, d, As, M, N, n);
  const j = 1 - x / (3 * d);
  const z = j * d;

  const sigmaC = As > 0 && x > 0 ? (2 * Ms) / (b * x * z) : Infinity;
  const sigmaS = full ? 0 : (As > 0 && x > 0 ? (n * sigmaC * (d - x)) / x : Infinity);
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
  };
  // せん断はハンチを考慮した別の照査位置で行うため、既定では曲げのみを判定する
  if (!p.skipShear) {
    checks.shear = {
      label: '平均せん断応力度',
      value: tau, allow: p.allow.tauA1, unit: 'N/mm²',
      ratio: ratio(tau, p.allow.tauA1),
    };
  }
  for (const c of Object.values(checks)) c.ok = c.ratio <= 1.0 + 1e-9;

  return {
    b, d, x, j, z, As, c, Ms: Ms / 1e6, e: N > 0 ? M / N : Infinity, full,
    sigmaC, sigmaS, tau,
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

/**
 * 軸力を考慮した必要鉄筋量 As (mm2/m)。
 * 鉄筋応力度が許容値 σsa にちょうど達する As を二分法で求める。
 * 軸圧縮は鉄筋応力度を下げるため、N を無視した値より小さくなる。
 */
export function requiredAsAxial(M, N, h, cover, barDia, sigmaSa, b = 1000, n = YOUNG_RATIO) {
  const d = h - cover - barDia / 2;
  const Mn = Math.abs(M) * 1e6;
  const Nn = (N || 0) * 1e3;
  if (d <= 0) return 0;
  const c = d - h / 2;
  if (Mn + Nn * c <= 0) return 0;

  const stress = (As) => {
    const { x, full } = neutralAxisAxial(b, h, d, As, Mn, Nn, n);
    if (full || x <= 0) return 0;
    const sc = (2 * (Mn + Nn * c)) / (b * x * (d - x / 3));
    return (n * sc * (d - x)) / x;
  };

  let lo = 1e-3;
  let hi = 0.1 * b * d; // 鉄筋比 10% を上限とする
  if (stress(hi) > sigmaSa) return hi;   // この断面では満たせない
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (stress(mid) > sigmaSa) lo = mid; else hi = mid;
  }
  return hi;
}

/**
 * せん断応力度の照査。
 * 有効断面高 h は呼び出し側で決める(ハンチ部では h' = T + C'/3)。
 * 中立軸は曲げのみの式で求め、τm = S / (b·j·d) とする。
 */
export function checkShear(p) {
  const b = p.b ?? 1000;
  const n = p.n ?? YOUNG_RATIO;
  const d = p.h - p.cover - p.barDia / 2;
  const S = Math.abs(p.S) * 1e3; // kN → N
  const x = neutralAxis(b, d, p.As, n);
  const j = 1 - x / (3 * d);
  const z = j * d;
  const tau = z > 0 ? S / (b * z) : Infinity;
  const ratio = p.allow.tauA1 > 0 ? tau / p.allow.tauA1 : Infinity;
  return {
    d, x, j, z, tau,
    check: {
      label: '平均せん断応力度',
      value: tau, allow: p.allow.tauA1, unit: 'N/mm²',
      ratio, ok: ratio <= 1.0 + 1e-9,
    },
    ok: ratio <= 1.0 + 1e-9,
  };
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { solveFrame, consistentLoad, solveLinearSystem } from '../src/core/frame.js';

const E = 25e6;      // kN/m2
const A = 0.3;       // m2 (幅1m × 高0.3m)
const I = 0.3 ** 3 / 12;

/** x軸上に等分割した梁モデルを作る */
function beamModel(L, n) {
  const nodes = [];
  for (let i = 0; i <= n; i++) nodes.push({ x: (L * i) / n, y: 0 });
  const elements = [];
  for (let i = 0; i < n; i++) elements.push({ n1: i, n2: i + 1, E, A, I });
  return { nodes, elements };
}

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} と ${b} の差が許容 ${tol} を超えます`);

test('LU分解: 既知の連立方程式を解く', () => {
  const x = solveLinearSystem([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]);
  close(x[0], 2, 1e-9, 'x1');
  close(x[1], 3, 1e-9, 'x2');
  close(x[2], -1, 1e-9, 'x3');
});

test('等価節点力: 等分布荷重の固定端モーメントは wL^2/12', () => {
  const L = 6, w = -10;
  const Q = consistentLoad(0, w, 0, w, L);
  close(Q[1], (w * L) / 2, 1e-9, '節点1のせん断');
  close(Q[2], (w * L * L) / 12, 1e-9, '節点1のモーメント');
  close(Q[5], -(w * L * L) / 12, 1e-9, '節点2のモーメント');
});

test('単純梁 + 等分布荷重: 中央モーメント wL^2/8 とたわみ 5wL^4/384EI', () => {
  const L = 10, n = 20, q = 20; // kN/m 下向き
  const { nodes, elements } = beamModel(L, n);
  const elementLoads = elements.map((_, i) => ({ elem: i, wy1: -q, wy2: -q }));
  const r = solveFrame({
    nodes, elements, elementLoads,
    supports: [{ node: 0, dx: true, dy: true }, { node: n, dy: true }],
  });

  const mid = n / 2;
  close(r.members[mid - 1].M[1], (q * L * L) / 8, 1e-6, '中央曲げモーメント');
  close(r.disp[mid * 3 + 1], -(5 * q * L ** 4) / (384 * E * I), 1e-9, '中央たわみ');
  close(r.members[0].S[0], (q * L) / 2, 1e-6, '支点せん断力');
  close(r.reactions[0].fy, (q * L) / 2, 1e-6, '支点反力');
  // 端部モーメントはゼロ
  close(r.members[0].M[0], 0, 1e-6, '端部モーメント');
});

test('両端固定梁 + 等分布荷重: 端部 wL^2/12、中央 wL^2/24', () => {
  const L = 8, n = 24, q = 15;
  const { nodes, elements } = beamModel(L, n);
  const elementLoads = elements.map((_, i) => ({ elem: i, wy1: -q, wy2: -q }));
  const r = solveFrame({
    nodes, elements, elementLoads,
    supports: [
      { node: 0, dx: true, dy: true, rz: true },
      { node: n, dx: true, dy: true, rz: true },
    ],
  });
  close(r.members[0].M[0], -(q * L * L) / 12, 1e-6, '端部モーメント(上側引張で負)');
  close(r.members[n / 2 - 1].M[1], (q * L * L) / 24, 1e-6, '中央モーメント');
  close(r.disp[(n / 2) * 3 + 1], -(q * L ** 4) / (384 * E * I), 1e-9, '中央たわみ');
});

test('片持ち梁 + 先端集中荷重: 先端たわみ PL^3/3EI、基部モーメント PL', () => {
  const L = 5, n = 10, P = 30;
  const { nodes, elements } = beamModel(L, n);
  const r = solveFrame({
    nodes, elements,
    nodalLoads: [{ node: n, fy: -P }],
    supports: [{ node: 0, dx: true, dy: true, rz: true }],
  });
  close(r.disp[n * 3 + 1], -(P * L ** 3) / (3 * E * I), 1e-9, '先端たわみ');
  close(r.members[0].M[0], -P * L, 1e-6, '基部モーメント');
  close(r.reactions[0].fy, P, 1e-6, '基部鉛直反力');
  close(r.reactions[0].mz, P * L, 1e-6, '基部モーメント反力');
});

test('L形骨組(座標変換の検証): 先端鉛直たわみが解析解と一致', () => {
  // 高さ h の柱(基部固定)+ 長さ a の水平梁、先端に鉛直荷重 P
  const h = 4, a = 3, P = 20, n = 12;
  const nodes = [];
  for (let i = 0; i <= n; i++) nodes.push({ x: 0, y: (h * i) / n });      // 0..n : 柱
  for (let i = 1; i <= n; i++) nodes.push({ x: (a * i) / n, y: h });      // n+1.. : 梁
  const elements = [];
  for (let i = 0; i < n; i++) elements.push({ n1: i, n2: i + 1, E, A, I });
  elements.push({ n1: n, n2: n + 1, E, A, I });
  for (let i = 1; i < n; i++) elements.push({ n1: n + i, n2: n + i + 1, E, A, I });
  const tip = 2 * n;

  const r = solveFrame({
    nodes, elements,
    nodalLoads: [{ node: tip, fy: -P }],
    supports: [{ node: 0, dx: true, dy: true, rz: true }],
  });

  // 梁自身のたわみ + 柱頭回転による付加たわみ + 柱の軸縮み
  const expected = -((P * a ** 3) / (3 * E * I) + (P * a * h * a) / (E * I) + (P * h) / (E * A));
  close(r.disp[tip * 3 + 1], expected, Math.abs(expected) * 1e-6, '先端鉛直たわみ');
  close(r.members[0].M[0], -P * a, 1e-6, '柱基部モーメント');
  close(r.members[0].N[0], -P, 1e-6, '柱軸力(圧縮で負)');
});

test('三角形分布荷重の単純梁: 最大モーメント位置と値', () => {
  // 0 から w まで直線変化する荷重(全荷重 W = wL/2)
  const L = 9, n = 36, w = 12;
  const { nodes, elements } = beamModel(L, n);
  const elementLoads = elements.map((_, i) => {
    const x1 = (L * i) / n, x2 = (L * (i + 1)) / n;
    return { elem: i, wy1: -(w * x1) / L, wy2: -(w * x2) / L };
  });
  const r = solveFrame({
    nodes, elements, elementLoads,
    supports: [{ node: 0, dx: true, dy: true }, { node: n, dy: true }],
  });
  const W = (w * L) / 2;
  close(r.reactions[0].fy, W / 3, 1e-6, '左支点反力 W/3');
  close(r.reactions[1].fy, (2 * W) / 3, 1e-6, '右支点反力 2W/3');
  // 最大モーメント = W*L/(9*sqrt(3)) = 0.06415 wL^2
  let maxM = 0;
  for (const m of r.members) maxM = Math.max(maxM, m.M[0], m.M[1]);
  close(maxM, (w * L * L) / (9 * Math.sqrt(3)), (w * L * L) * 1e-4, '最大曲げモーメント');
});

test('バネ支持: 剛体的な梁を弾性支承で受けたときの沈下と反力', () => {
  const L = 4, n = 8, q = 10, kv = 5000; // kN/m3 相当の分布バネ
  const { nodes, elements } = beamModel(L, n);
  const elementLoads = elements.map((_, i) => ({ elem: i, wy1: -q, wy2: -q }));
  const springs = nodes.map((_, i) => ({
    node: i,
    ky: kv * (L / n) * (i === 0 || i === n ? 0.5 : 1),
    kx: i === 0 ? 1e9 : 0,
  }));
  const r = solveFrame({ nodes, elements, elementLoads, springs });
  const totalSpring = r.springReactions.reduce((s, x) => s + x.fy, 0);
  close(totalSpring, q * L, 1e-6, 'バネ反力の合計 = 載荷重');
  // 一様な弾性床では沈下は一様に近い: δ ≒ q/kv
  close(r.disp[(n / 2) * 3 + 1], -q / kv, (q / kv) * 0.05, '中央沈下');
});

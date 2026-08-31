import test from 'node:test';
import assert from 'node:assert/strict';
import { impactFactor, liveLoadPressure, verticalStress, lateralStress, buildLoads } from '../src/core/loads.js';
import { buildGeometry } from '../src/core/geometry.js';
import { defaultInput } from '../src/core/design.js';
import { GAMMA_W } from '../src/core/units.js';

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} と ${b} の差が許容 ${tol} を超えます`);

test('衝撃係数: 土被りによる区分', () => {
  close(impactFactor(0), 0.5, 1e-12, 'h=0');
  close(impactFactor(1.5), 0.5, 1e-12, 'h=1.5');
  close(impactFactor(3.0), 0.35, 1e-12, 'h=3.0');
  close(impactFactor(6.5), 0, 1e-12, 'h=6.5');
  close(impactFactor(10), 0, 1e-12, 'h=10');
});

test('活荷重: 参照帳票と同条件で分布幅・輪荷重・鉛直土圧が一致する', () => {
  // 帳票の値: a=0.20 b=0.50 H=0.200 i=0.300 β=0.9 P=100 → u=0.600 v=0.900
  //           Pl=117.000 kN、Pvl=141.818 kN/m2
  const r = liveLoadPressure(0.2, { impact: 0.3, beta: 0.9 });
  close(r.u, 0.6, 1e-12, '輪分布幅 u = a + 2H·tanθ');
  close(r.v, 0.9, 1e-12, '輪分布幅 v = b + 2H·tanθ');
  close(r.Pl, 117.0, 1e-9, '活荷重 Pl = P(1+i)β');
  close(r.q, (2 * 117.0) / 2.75 / 0.6, 1e-9, '鉛直土圧 Pvl = 2Pl/W/u');
  close(r.q, 141.818, 1e-3, '帳票の Pvl');
});

test('活荷重: 断面力低減係数と占有幅が効く', () => {
  const base = liveLoadPressure(1.0, { impact: 0.5, beta: 1.0 });
  const withBeta = liveLoadPressure(1.0, { impact: 0.5, beta: 0.9 });
  close(withBeta.q, base.q * 0.9, 1e-9, 'β に比例して低減される');
  const wide = liveLoadPressure(1.0, { impact: 0.5, occupancyWidth: 5.5 });
  close(wide.q, base.q / 2, 1e-9, '占有幅に反比例する');
});

test('土中応力: 地下水位を挟んだ全応力・水圧・側方応力', () => {
  const soil = { gamma: 19, gammaSat: 20, waterDepth: 2.0 };
  const a = verticalStress(1.0, soil);
  close(a.sigmaV, 19, 1e-12, 'GL-1m の全鉛直応力');
  close(a.u, 0, 1e-12, 'GL-1m の水圧');
  const b = verticalStress(4.0, soil);
  close(b.sigmaV, 19 * 2 + 20 * 2, 1e-12, 'GL-4m の全鉛直応力');
  close(b.u, GAMMA_W * 2, 1e-12, 'GL-4m の水圧');
  // σh = K(σv - u) + u
  close(lateralStress(4.0, soil, 0.5), 0.5 * (78 - GAMMA_W * 2) + GAMMA_W * 2, 1e-9, '側方応力');
});

test('荷重算定: 頂版荷重と側壁土圧が手計算と一致する', () => {
  const input = defaultInput();
  input.soil.cover = input.soil.coverMin; // 1ケース分の条件に落とす
  input.live.mode = 'top';
  const geo = buildGeometry(input.dims, { sigmaCk: input.material.sigmaCk, divisions: 8 });
  const { summary } = buildLoads(geo, input);

  close(summary.earthTop, 19 * 1.0, 1e-9, '頂版上面の鉛直土圧 γ·h');
  close(summary.qTop, 19 + summary.live.q, 1e-9, '頂版の鉛直荷重');

  // 上載ケースでは側方に活荷重ぶんの上載荷重を考慮しない(側載ケースで考慮する)
  const zTopAxis = 1.0 + 0.15;
  close(summary.lateralTopLeft, 0.5 * 19 * zTopAxis, 1e-9, '側壁上端の側方土圧');

  // 底版中心線の深さ = 1.0 + 外形高 - 底版厚/2
  const zBotAxis = 1.0 + geo.outerH - 0.15;
  close(summary.lateralBottomLeft, 0.5 * 19 * zBotAxis, 1e-9, '側壁下端の側方土圧');
});

test('荷重算定: 側載では鉛直活荷重が載らず、側方に上載荷重が加わる', () => {
  const input = defaultInput();
  input.soil.cover = input.soil.coverMin;
  input.live.mode = 'side';
  input.live.surcharge = 10;
  const geo = buildGeometry(input.dims, { sigmaCk: input.material.sigmaCk, divisions: 8 });
  const { summary } = buildLoads(geo, input);

  close(summary.qTop, 19 * 1.0, 1e-9, '頂版には土圧のみが載る');
  close(summary.live.q, 0, 1e-12, '鉛直活荷重はゼロ');
  const zTopAxis = 1.0 + 0.15;
  close(summary.lateralTopLeft, 0.5 * 19 * zTopAxis + 0.5 * 10, 1e-9, '側方に上載荷重 K·Q が加わる');
});

test('荷重算定: 地下水位以下では揚圧力と浮力が計上される', () => {
  const input = defaultInput();
  input.soil.cover = input.soil.coverMin;
  input.live.mode = 'top';
  input.soil.waterLevel = 0.5; // GL-0.5m
  const geo = buildGeometry(input.dims, { sigmaCk: input.material.sigmaCk, divisions: 8 });
  const { summary } = buildLoads(geo, input);
  const zBottom = 1.0 + geo.outerH;
  close(summary.uBottom, GAMMA_W * (zBottom - 0.5), 1e-9, '底版下面の揚圧力');
  assert.ok(summary.totalVertical < summary.selfWeight + summary.qTop * geo.L,
    '揚圧力のぶん鉛直荷重が減じられること');
});

test('荷重算定: 自重が実断面から求めた重量と整合する', () => {
  const input = defaultInput();
  input.soil.cover = input.soil.coverMin;
  input.live.mode = 'top';
  const geo = buildGeometry(input.dims, { sigmaCk: input.material.sigmaCk, divisions: 24 });
  const { summary } = buildLoads(geo, input);
  close(summary.selfWeight, geo.selfWeight, 1e-6, '自重の合計');
  // 外形断面積 − 内空断面積 + ハンチ4か所 に一致すること
  const solid = geo.outerW * geo.outerH - geo.dims.B * geo.dims.H
    + 2 * (geo.dims.hTh * geo.dims.hTv) / 2 + 2 * (geo.dims.hBh * geo.dims.hBv) / 2;
  close(geo.solidArea, solid, 1e-12, 'コンクリート断面積');
  close(summary.selfWeight, solid * input.material.gammaC, 1e-6, '自重の総量');
});

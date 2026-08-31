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

test('活荷重: 分布幅と圧力が手計算と一致する(土被り1.0m)', () => {
  const r = liveLoadPressure(1.0);
  // La = 0.2 + 2*1.0*1.0 = 2.2 / 1輪の分布幅 Lb0 = 0.5 + 2.0 = 2.5 > 1.75 → 重なる
  close(r.La, 2.2, 1e-12, '進行方向の分布長');
  close(r.Lb, 1.75 + 2.5, 1e-12, '直角方向の合成分布幅');
  assert.equal(r.overlap, true);
  close(r.q, (2 * 100 * 1.5) / (2.2 * 4.25), 1e-9, '活荷重圧');
});

test('活荷重: 分布幅が重ならない浅い土被り', () => {
  const r = liveLoadPressure(0.5);
  close(r.Lb, 2 * (0.5 + 1.0), 1e-12, '重ならない場合は2輪分の幅');
  assert.ok(r.note.includes('0.5m 未満') === false);
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

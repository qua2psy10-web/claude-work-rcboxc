import test from 'node:test';
import assert from 'node:assert/strict';
import { design, defaultInput, validate } from '../src/core/design.js';
import { requiredAs, checkSection, neutralAxis } from '../src/core/rc.js';
import { selectRebar, arrangement } from '../src/core/rebar.js';

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} と ${b} の差が許容 ${tol} を超えます`);

const at = (r, key, s) =>
  r.ana.diagrams[key].reduce((best, p) => (Math.abs(p.s - s) < Math.abs(best.s - s) ? p : best));

/** 代表的な荷重条件のバリエーション */
const cases = {
  '標準(土被り1m)': (i) => i,
  '地下水位あり': (i) => { i.soil.waterLevel = 0.5; return i; },
  '内水位あり': (i) => { i.water.innerLevel = 1.5; return i; },
  '活荷重なし・土被り5m': (i) => { i.soil.cover = 5.0; i.live.enabled = false; return i; },
  '偏土圧': (i) => { i.soil.K0Left = 0.6; i.soil.K0Right = 0.4; return i; },
  '突出形(α=1.2)': (i) => { i.soil.alpha = 1.2; return i; },
};

for (const [name, mod] of Object.entries(cases)) {
  test(`鉛直方向の釣合い検算: ${name}`, () => {
    const r = design(mod(defaultInput()));
    assert.ok(r.ok, '計算が成立すること');
    const s = r.loads.summary;
    close(r.ana.totalReaction, s.totalVertical, Math.abs(s.totalVertical) * 1e-6 + 1e-6,
      '底版バネ反力の合計と載荷重の合計');
    assert.ok(r.stability.balance.error < 1e-6 * Math.max(1, Math.abs(s.totalVertical)),
      '釣合い誤差が十分小さいこと');
  });
}

test('隅角部で接合する2部材の曲げモーメントが釣り合う', () => {
  const r = design(defaultInput());
  const { L, Hc } = r.geo;
  close(at(r, 'bottom', 0).M, at(r, 'left', 0).M, 1e-6, '左下隅角');
  close(at(r, 'bottom', L).M, at(r, 'right', 0).M, 1e-6, '右下隅角');
  close(at(r, 'top', 0).M, at(r, 'left', Hc).M, 1e-6, '左上隅角');
  close(at(r, 'top', L).M, at(r, 'right', Hc).M, 1e-6, '右上隅角');
});

test('左右対称な条件では断面力も対称になる', () => {
  const r = design(defaultInput());
  const { L } = r.geo;
  for (const key of ['top', 'bottom']) {
    for (const p of r.ana.diagrams[key]) {
      const q = at(r, key, L - p.s);
      close(q.M, p.M, 1e-6, `${key} の曲げモーメントの対称性 (s=${p.s.toFixed(3)})`);
      close(q.S, -p.S, 1e-6, `${key} のせん断力の逆対称性 (s=${p.s.toFixed(3)})`);
    }
  }
  const l = r.ana.diagrams.left;
  const rt = r.ana.diagrams.right;
  assert.equal(l.length, rt.length, '左右側壁の分割数');
  l.forEach((p, i) => {
    close(rt[i].M, p.M, 1e-6, '左右側壁の曲げモーメント');
    close(rt[i].S, p.S, 1e-6, '左右側壁のせん断力');
  });
  // 支間中央のせん断力はゼロ
  close(at(r, 'top', L / 2).S, 0, 1e-6, '頂版中央のせん断力');
  close(at(r, 'bottom', L / 2).S, 0, 1e-6, '底版中央のせん断力');
});

test('偏土圧では不均衡水平力が生じ、水平力照査が意味を持つ', () => {
  const r = design(cases['偏土圧'](defaultInput()));
  const slide = r.stability.items.find((i) => i.key === 'slide');
  assert.ok(Number.isFinite(slide.value), '安全率が有限値になること');
  assert.ok(Math.abs(r.ana.totalHorizontal) > 1, '正味の水平力が生じること');
  // 左右の曲げモーメントに差が出る
  const dl = at(r, 'left', r.geo.Hc / 2).M;
  const dr = at(r, 'right', r.geo.Hc / 2).M;
  assert.ok(Math.abs(dl - dr) > 1e-3, '左右の側壁で断面力が異なること');
});

test('地下水位が高い場合は揚圧力と浮上り安全率が計算される', () => {
  const input = defaultInput();
  input.soil.waterLevel = 0.0; // 地表面まで地下水
  const r = design(input);
  const uplift = r.stability.items.find((i) => i.key === 'uplift');
  assert.ok(uplift.value > 0 && Number.isFinite(uplift.value), '浮上り安全率が算定されること');
  assert.ok(r.loads.summary.uBottom > 0, '揚圧力が生じること');
  // 抵抗力 = 自重 + 上載土重 + 内水重
  const p = uplift.parts;
  close(p.selfWeight + p.coverWeight + p.innerWeight, uplift.value * p.uplift, 1e-6, '安全率の内訳');
});

test('土被りを増やすと断面力が増え、活荷重の寄与は減る', () => {
  const shallow = design((() => { const i = defaultInput(); i.soil.cover = 1.0; return i; })());
  const deep = design((() => { const i = defaultInput(); i.soil.cover = 5.0; return i; })());
  assert.ok(deep.loads.summary.live.q < shallow.loads.summary.live.q, '活荷重圧は土被りとともに減少');
  assert.ok(deep.loads.summary.qTop > shallow.loads.summary.qTop, '頂版の全荷重は増加');
  assert.ok(Math.abs(at(deep, 'top', deep.geo.L / 2).M) > Math.abs(at(shallow, 'top', shallow.geo.L / 2).M),
    '頂版の曲げモーメントが増加');
});

test('必要鉄筋量で配筋すると鉄筋応力度が許容値付近に収まる', () => {
  const M = 45, h = 300, cover = 60, dia = 16, sigmaSa = 180;
  const As = requiredAs(M, h, cover, dia, sigmaSa);
  const r = checkSection({
    M, S: 0, N: 0, h, cover, barDia: dia, As,
    allow: { sigmaCa: 8, sigmaSa, tauA1: 0.23 },
  });
  close(r.sigmaS, sigmaSa, 0.1, '必要鉄筋量に対する鉄筋応力度');
  // 中立軸のつり合い条件を直接確認
  const x = neutralAxis(1000, r.d, As);
  close((1000 * x * x) / 2, 15 * As * (r.d - x), 1e-6 * 15 * As * r.d, '中立軸のつり合い');
});

test('配筋選定: 必要量以上で最小の鋼材量が選ばれる', () => {
  const need = arrangement('D16', 200).As - 1;
  const list = selectRebar(need);
  assert.ok(list.length > 0, '候補が存在すること');
  assert.ok(list[0].As >= need, '必要量を満たすこと');
  assert.equal(list[0].label, 'D16 @200');
  assert.ok(list.every((c) => c.clear >= 40), 'あきの制約を満たすこと');
});

test('入力チェック: 不正な入力はエラーとして返る', () => {
  const bad = defaultInput();
  bad.dims.wallThickness = 0;
  assert.ok(validate(bad).length > 0, '部材厚0はエラー');
  const bad2 = defaultInput();
  bad2.material.coverOuter = 200;
  bad2.material.coverInner = 200;
  assert.ok(validate(bad2).some((e) => e.includes('かぶり')), 'かぶり過大はエラー');
  assert.equal(design(bad).ok, false, 'design はエラーを返す');
});

test('標準ケースの回帰(ゴールデン値)', () => {
  const r = design(defaultInput());
  const s = r.loads.summary;
  close(s.selfWeight, 68.7225, 1e-3, '自重');
  close(s.live.q, 32.0856, 1e-3, '活荷重圧');
  close(s.qTop, 51.0856, 1e-3, '頂版鉛直荷重');
  close(s.totalVertical, 186.2193, 1e-3, '全鉛直荷重');
  close(r.ana.maxReactionPressure, 85.043, 1e-2, '最大地盤反力度');

  close(at(r, 'top', r.geo.L / 2).M, 16.103, 1e-2, '頂版中央の曲げモーメント');
  close(at(r, 'bottom', r.geo.L / 2).M, 19.203, 1e-2, '底版中央の曲げモーメント');
  close(at(r, 'top', 0).M, -22.717, 1e-2, '頂版隅角の曲げモーメント');
  close(at(r, 'bottom', 0).M, -28.444, 1e-2, '底版隅角の曲げモーメント');
  close(at(r, 'left', r.geo.Hc / 2).M, -0.524, 1e-2, '側壁中央の曲げモーメント');

  assert.equal(r.sections.length, 12, '照査断面の数');
  assert.equal(r.verdict.stability, true, '安定照査は成立');
});

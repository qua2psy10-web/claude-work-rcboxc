import test from 'node:test';
import assert from 'node:assert/strict';
import { design, defaultInput, validate, buildCases, normalizeInput } from '../src/core/design.js';
import { requiredAs, checkSection, neutralAxis } from '../src/core/rc.js';
import { selectRebar, arrangement } from '../src/core/rebar.js';

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} と ${b} の差が許容 ${tol} を超えます`);

const at = (r, key, s) =>
  r.ana.diagrams[key].reduce((best, p) => (Math.abs(p.s - s) < Math.abs(best.s - s) ? p : best));

/** 代表的な荷重条件のバリエーション */
const cases = {
  '標準': (i) => i,
  '地下水位あり': (i) => { i.soil.waterLevel = 0.5; return i; },
  '内水位あり': (i) => { i.water.innerLevel = 1.5; return i; },
  '活荷重なし・土被り5m': (i) => { i.soil.coverMin = 5.0; i.soil.coverMax = 5.0; i.live.enabled = false; return i; },
  '偏土圧': (i) => { i.soil.K0Left = 0.6; i.soil.K0Right = 0.4; return i; },
  '突出形(α=1.2)': (i) => { i.soil.alpha = 1.2; return i; },
};

for (const [name, mod] of Object.entries(cases)) {
  test(`鉛直方向の釣合い検算(全ケース): ${name}`, () => {
    const r = design(mod(defaultInput()));
    assert.ok(r.ok, '計算が成立すること');
    for (const c of r.cases) {
      const s = c.loads.summary;
      close(c.ana.totalReaction, s.totalVertical, Math.abs(s.totalVertical) * 1e-6 + 1e-6,
        `CASE-${c.id} の底版バネ反力の合計と載荷重の合計`);
      assert.ok(c.stability.balance.error < 1e-6 * Math.max(1, Math.abs(s.totalVertical)),
        `CASE-${c.id} の釣合い誤差が十分小さいこと`);
    }
  });
}

test('荷重ケース: 3軸の組合せが参照帳票の番号順で生成される', () => {
  const i = defaultInput();
  const c = buildCases(i);
  assert.equal(c.length, 4, '地下水を考慮しなければ4ケース');
  assert.deepEqual(c.map((x) => [x.id, x.mode, x.cover]),
    [[1, 'top', 1.0], [2, 'side', 1.0], [3, 'top', 3.0], [4, 'side', 3.0]]);

  i.soil.waterLevel = 0.5;
  const c8 = buildCases(i);
  assert.equal(c8.length, 8, '地下水を考慮すると8ケース');
  assert.deepEqual(c8.slice(4).map((x) => x.water), [true, true, true, true],
    'CASE-5〜8 が地下水ありであること');
});

test('荷重ケース: 土被りが最小=最大なら重複ケースを畳む', () => {
  const i = defaultInput();
  i.soil.coverMax = i.soil.coverMin;
  assert.equal(buildCases(i).length, 2, '上載・側載の2ケースになる');
  i.live.enabled = false;
  assert.equal(buildCases(i).length, 1, '活荷重なしなら1ケース');
});

test('包絡: 各断面の設計値は全ケースの値以上で、支配CASEが一致する', () => {
  const r = design(defaultInput());
  for (const sec of r.sections) {
    let maxAbs = 0;
    let argmax = null;
    for (const c of r.cases) {
      const m = c.sections.find((x) => x.label === sec.label && x.tensionSide === sec.face);
      if (m && Math.abs(m.M) > maxAbs) { maxAbs = Math.abs(m.M); argmax = c.id; }
    }
    close(Math.abs(sec.M), maxAbs, 1e-9, `${sec.label}(${sec.face}) の包絡値`);
    assert.equal(sec.caseId, argmax, `${sec.label}(${sec.face}) の支配CASE`);
  }
});

test('後方互換: 旧形式の soil.cover のみの入力でも動作する', () => {
  const old = defaultInput();
  delete old.soil.coverMin;
  delete old.soil.coverMax;
  delete old.project;
  old.soil.cover = 1.5;
  const n = normalizeInput(old);
  close(n.soil.coverMin, 1.5, 1e-12, 'coverMin に読み替え');
  close(n.soil.coverMax, 1.5, 1e-12, 'coverMax に読み替え');
  assert.ok(n.project, 'project が補われること');
  assert.equal(design(n).ok, true, '計算が成立すること');
});

test('軸力を考慮した曲げモーメント Ms = M + N·c が成り立つ', () => {
  const r = design(defaultInput());
  for (const sec of r.sections) {
    const c = sec.check.d - (sec.h * 1000) / 2;   // 部材中心軸と鉄筋間距離 mm
    const expected = Math.abs(sec.M) + (sec.N * c) / 1000; // kN·m
    close(sec.check.Ms, expected, 1e-6 * Math.max(1, expected), `${sec.label} の Ms`);
  }
});

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
  assert.ok(Math.abs(r.cases[0].ana.totalHorizontal) > 1, '正味の水平力が生じること');
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
  const wet = r.cases.filter((c) => c.water);
  assert.equal(wet.length, 4, '地下水ありのケースが4つ生成されること');
  assert.ok(wet.every((c) => c.loads.summary.uBottom > 0), '地下水ありのケースで揚圧力が生じること');
  assert.ok(r.cases.filter((c) => !c.water).every((c) => c.loads.summary.uBottom === 0),
    '地下水なしのケースでは揚圧力が生じないこと');
  // 抵抗力 = 自重 + 上載土重 + 内水重
  const p = uplift.parts;
  close(p.selfWeight + p.coverWeight + p.innerWeight, uplift.value * p.uplift, 1e-6, '安全率の内訳');
});

test('土被りを増やすと鉛直荷重が増え、活荷重の寄与は減る', () => {
  const one = (cover) => {
    const i = defaultInput();
    i.soil.coverMin = cover; i.soil.coverMax = cover;
    return design(i).cases[0].loads.summary; // 上載ケース
  };
  const shallow = one(1.0);
  const deep = one(5.0);
  assert.ok(deep.live.q < shallow.live.q, '活荷重圧は土被りとともに減少');
  assert.ok(deep.qTop > shallow.qTop, '頂版の全荷重は増加');
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
  const c1 = r.cases[0]; // CASE-1: 上載・土被り1.0m
  const s = c1.loads.summary;
  const m = (key, pos) =>
    c1.ana.diagrams[key].reduce((b, p) => (Math.abs(p.s - pos) < Math.abs(b.s - pos) ? p : b)).M;

  close(s.selfWeight, 68.7225, 1e-3, '自重');
  close(s.live.q, 32.0856, 1e-3, '活荷重圧');
  close(s.qTop, 51.0856, 1e-3, '頂版鉛直荷重');
  close(s.totalVertical, 186.2193, 1e-3, '全鉛直荷重');
  close(c1.ana.maxReactionPressure, 86.495, 1e-2, '最大地盤反力度');

  close(m('top', r.geo.L / 2), 20.051, 1e-2, '頂版中央の曲げモーメント');
  close(m('bottom', r.geo.L / 2), 23.024, 1e-2, '底版中央の曲げモーメント');
  close(m('top', 0), -18.769, 1e-2, '頂版隅角の曲げモーメント');
  close(m('bottom', 0), -24.373, 1e-2, '底版隅角の曲げモーメント');
  close(m('left', r.geo.Hc / 2), -7.122, 1e-2, '側壁中央の曲げモーメント');

  assert.equal(r.cases.length, 4, '荷重ケースの数');
  assert.equal(r.sections.length, 14, '包絡した照査断面の数');
  assert.equal(r.verdict.stability, true, '安定照査は成立');
});

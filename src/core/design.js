/**
 * 設計計算のエントリポイント
 *
 *   入力条件 → 形状 → 荷重ケースの生成 → ケースごとの骨組解析
 *            → 断面力の包絡 → 配筋設計 → 応力度照査 → 安定検討
 *
 * 荷重ケースは実務の計算書にならい、次の3軸の組合せで生成する。
 *   載荷位置  上載(荷重がカルバート直上) / 側載(荷重がカルバート側方)
 *   土被り    H1(最小) / H2(最大)
 *   地下水    影響なし / 影響あり
 *
 * 番号は次の順に振る(地下水を考慮しない場合は CASE-1〜4 のみ)。
 *   CASE-1 上載 H1 水無   CASE-2 側載 H1 水無
 *   CASE-3 上載 H2 水無   CASE-4 側載 H2 水無
 *   CASE-5 上載 H1 水有   CASE-6 側載 H1 水有
 *   CASE-7 上載 H2 水有   CASE-8 側載 H2 水有
 *
 * この関数は DOM に依存しない純粋な計算であり、テストから直接呼び出せる。
 */

import { buildGeometry } from './geometry.js';
import { buildLoads } from './loads.js';
import { analyze, checkSections, shearSections } from './analyze.js';
import { checkSection, checkShear, requiredAsAxial, minimumAs, concreteCapacityMoment } from './rc.js';
import { selectRebar, distributionRebar, arrangement } from './rebar.js';
import { checkStability } from './stability.js';
import { concreteProps, rebarProps, GAMMA_C } from './units.js';

/** 既定の設計条件(内空 2.0×2.0m、土被り 1.0〜3.0m) */
export function defaultInput() {
  return {
    title: 'RCボックスカルバート 設計計算',
    project: {
      name: '',       // 工事名
      section: '',    // 工区名
      designer: '',   // 設計者
      date: '',       // 作成日(空欄なら計算書生成時の日付)
      code: '',       // 製品No. / 型式
    },
    dims: {
      clearWidth: 2000, clearHeight: 2000,
      topThickness: 300, bottomThickness: 300, wallThickness: 300,
      haunchTopH: 150, haunchTopV: 150,
      haunchBottomH: 150, haunchBottomV: 150,
    },
    soil: {
      coverMin: 1.0,     // 土被り H1(最小) m
      coverMax: 3.0,     // 土被り H2(最大) m
      gamma: 19.0,       // 地下水位以浅の単位体積重量 kN/m3
      gammaSat: 20.0,    // 地下水位以深の飽和単位体積重量 kN/m3
      K0: 0.5,           // 静止土圧係数
      K0Left: null, K0Right: null, // 偏土圧を考慮する場合に個別指定
      alpha: 1.0,        // 鉛直土圧係数(突出形で 1.0 超)
      waterLevel: null,  // 地表面からの地下水位深さ m(null で地下水を考慮しない)
    },
    live: {
      enabled: true,
      wheelLoad: 100, contactA: 0.2, contactB: 0.5,
      tanTheta: 1.0,
      impact: null,      // null で土被りから自動算定
      occupancyWidth: 2.75, // 車両の占有幅 m
      beta: 1.0,         // 断面力低減係数
      surcharge: 10.0,   // 側載時の上載荷重(群集荷重) kN/m2
    },
    water: { innerLevel: 0 }, // 内水位(内空底面から)m
    material: {
      sigmaCk: 24, rebarGrade: 'SD345', gammaC: GAMMA_C,
      coverOuter: 60, coverInner: 50, // かぶり mm
      minAsRatio: 0.002,              // 最小鉄筋量(b·d に対する比)
      allowIncrease: 1.0,             // 許容応力度の割増係数
      shearCe: 1.0,                   // 有効高に関する補正係数(道示による)
      shearCpt: 1.0,                  // 引張鉄筋比に関する補正係数(道示による)
    },
    ground: {
      kv: 50000,          // 鉛直地盤反力係数 kN/m3
      kh: null,           // 水平せん断バネ kN/m3(null で kv/3)
      qa: 200,            // 許容支持力度 kN/m2
      friction: 0.6,      // 底面摩擦係数
      upliftSafety: 1.2, slideSafety: 1.5,
    },
    options: { divisions: 24 },
  };
}

/**
 * 旧形式の入力(単一の soil.cover)を現行の coverMin / coverMax に読み替える。
 * 保存済みJSONの読込で使う。
 */
export function normalizeInput(input) {
  const s = input.soil;
  if (s && s.cover !== undefined && s.cover !== null) {
    if (s.coverMin === undefined || s.coverMin === null) s.coverMin = s.cover;
    if (s.coverMax === undefined || s.coverMax === null) s.coverMax = s.cover;
  }
  if (s && (s.coverMax === undefined || s.coverMax === null)) s.coverMax = s.coverMin;
  if (!input.project) input.project = defaultInput().project;
  return input;
}

/** 入力値の妥当性を確認し、問題があればメッセージを返す */
export function validate(input) {
  const errors = [];
  const d = input.dims;
  if (!(d.clearWidth > 0 && d.clearHeight > 0)) errors.push('内空寸法を正の値で入力してください。');
  for (const [k, label] of [['topThickness', '頂版厚'], ['bottomThickness', '底版厚'], ['wallThickness', '側壁厚']]) {
    if (!(d[k] > 0)) errors.push(`${label}を正の値で入力してください。`);
  }
  if (d.haunchTopH > d.clearWidth / 2) errors.push('頂版ハンチが内空幅に対して大きすぎます。');
  if (d.haunchTopV > d.clearHeight / 2) errors.push('頂版ハンチが内空高に対して大きすぎます。');
  const { coverMin, coverMax } = input.soil;
  if (!(coverMin >= 0)) errors.push('土被り H1(最小)は 0 以上としてください。');
  if (!(coverMax >= 0)) errors.push('土被り H2(最大)は 0 以上としてください。');
  if (coverMin >= 0 && coverMax >= 0 && coverMax < coverMin) {
    errors.push('土被り H2(最大)は H1(最小)以上としてください。');
  }
  if (!(input.ground.kv > 0)) errors.push('鉛直地盤反力係数は正の値としてください。');
  if (!(input.ground.qa > 0)) errors.push('許容支持力度は正の値としてください。');
  const cMax = Math.min(d.topThickness, d.bottomThickness, d.wallThickness);
  if (input.material.coverOuter + input.material.coverInner >= cMax) {
    errors.push('かぶりの合計が部材厚以上です。かぶりまたは部材厚を見直してください。');
  }
  return errors;
}

const MODE_LABEL = { top: '上載', side: '側載' };

/**
 * 荷重ケースの一覧を作る。
 * 土被りの最小と最大が等しい場合、または活荷重を考慮しない場合は
 * 重複するケースを畳んで無駄なページを出さない。
 */
export function buildCases(input) {
  const { coverMin, coverMax, waterLevel } = input.soil;
  const sameCover = Math.abs(coverMax - coverMin) < 1e-9;
  const hasWater = waterLevel !== null && waterLevel !== undefined;
  const covers = sameCover
    ? [{ key: 'H', cover: coverMin }]
    : [{ key: 'H1', cover: coverMin }, { key: 'H2', cover: coverMax }];
  // 活荷重を考慮しない設定なら上載・側載を分ける意味がない
  const modes = input.live.enabled ? ['top', 'side'] : ['top'];
  const waters = hasWater ? [false, true] : [false];

  const cases = [];
  for (const water of waters) {
    for (const c of covers) {
      for (const mode of modes) {
        const parts = [];
        if (input.live.enabled) parts.push(MODE_LABEL[mode]);
        parts.push(`土被り ${c.cover.toFixed(3)} m`);
        if (hasWater) parts.push(water ? '地下水あり' : '地下水なし');
        cases.push({
          id: cases.length + 1,
          cover: c.cover,
          coverKey: c.key,
          mode,
          modeLabel: MODE_LABEL[mode],
          water,
          label: parts.join(' / '),
        });
      }
    }
  }
  return cases;
}

/** 1ケース分の設計条件を組み立てる */
function caseCondition(input, c) {
  return {
    ...input,
    soil: {
      ...input.soil,
      cover: c.cover,
      waterLevel: c.water ? input.soil.waterLevel : null,
    },
    live: { ...input.live, mode: c.mode },
  };
}

/** 1つの照査断面グループについて配筋を決める */
function designGroup(group, allow, material, options) {
  const cover = group.face === 'outer' ? material.coverOuter : material.coverInner;
  const h = group.h * 1000; // m → mm
  let dia = 16;
  let selected = null;
  let asReq = 0;
  let asMin = 0;

  for (let i = 0; i < 4; i++) {
    asReq = requiredAsAxial(group.M, group.N, h, cover, dia, allow.sigmaSa);
    asMin = minimumAs(h, cover, dia, material.minAsRatio);
    const need = Math.max(asReq, asMin);
    const list = selectRebar(need, options.rebar);
    if (!list.length) { selected = null; break; }
    if (selected && list[0].bar === selected.bar && list[0].pitch === selected.pitch) {
      selected = list[0];
      break;
    }
    selected = list[0];
    dia = selected.dia;
  }

  const capacity = concreteCapacityMoment(h, cover, dia, allow.sigmaCa, allow.sigmaSa);
  return {
    ...group,
    cover, hmm: h,
    asRequired: asReq,
    asMinimum: asMin,
    asDesign: Math.max(asReq, asMin),
    governedByMinimum: asMin > asReq,
    selected,
    candidates: selectRebar(Math.max(asReq, asMin), options.rebar).slice(0, 4),
    concreteCapacity: capacity,
    sectionAdequate: Math.abs(group.M) <= capacity,
  };
}

const FACE_LABEL = { inner: '内側(内空側)', outer: '外側(土側)' };

export function design(rawInput) {
  const input = normalizeInput(rawInput);
  const errors = validate(input);
  if (errors.length) return { ok: false, errors };

  const warnings = [];
  const conc = concreteProps(input.material.sigmaCk);
  const bar = rebarProps(input.material.rebarGrade);
  const inc = input.material.allowIncrease ?? 1.0;
  const allow = {
    sigmaCa: conc.sigmaCa * inc,
    sigmaSa: bar.sigmaSa * inc,
    tauA1: conc.tauA1 * inc
      * (input.material.shearCe ?? 1.0) * (input.material.shearCpt ?? 1.0),
    tauA2: conc.tauA2 * inc,
  };

  // 形状は荷重ケースに依存しないので一度だけ作る。
  // 地下水位が側壁の途中にある場合はそこを分割の切れ目にして折れ点を再現する。
  const extraWallBreaks = [];
  const geoTmp = buildGeometry(input.dims, { sigmaCk: input.material.sigmaCk, divisions: 4 });
  if (input.soil.waterLevel !== null && input.soil.waterLevel !== undefined) {
    for (const cover of [input.soil.coverMin, input.soil.coverMax]) {
      const zBottomAxis = cover + geoTmp.outerH - geoTmp.dims.t2 / 2;
      const sAtWater = zBottomAxis - input.soil.waterLevel;
      if (sAtWater > 0 && sAtWater < geoTmp.Hc) extraWallBreaks.push(sAtWater);
    }
  }

  const geo = buildGeometry(input.dims, {
    sigmaCk: input.material.sigmaCk,
    divisions: input.options?.divisions ?? 24,
    extraWallBreaks,
  });

  // ---- 各ケースを解く --------------------------------------------------
  const cases = buildCases(input);
  const solved = cases.map((c) => {
    const cond = caseCondition(input, c);
    const loads = buildLoads(geo, cond);
    const ana = analyze(geo, loads);
    const sections = checkSections(geo, ana);
    const shear = shearSections(geo, ana);
    const stability = checkStability(geo, loads, ana, cond);
    return { ...c, cond, loads, ana, sections, shear, stability };
  });
  for (const s of solved) {
    for (const w of s.loads.warnings) warnings.push(`CASE-${s.id}: ${w}`);
  }

  // ---- 断面力の包絡 ----------------------------------------------------
  // 照査断面 × 引張面 ごとに、全ケース中の最大 |M| とそのときの軸力・ケースを採る。
  const envelope = new Map();
  const shearEnvelope = new Map();
  for (const s of solved) {
    for (const sec of s.sections) {
      const key = `${sec.member}|${sec.label}|${sec.tensionSide}`;
      const prev = envelope.get(key);
      if (!prev || Math.abs(sec.M) > Math.abs(prev.M)) {
        envelope.set(key, {
          member: sec.member, memberName: sec.memberName, label: sec.label,
          s: sec.s, h: sec.h, purpose: sec.purpose, face: sec.tensionSide,
          faceLabel: FACE_LABEL[sec.tensionSide],
          M: sec.M, N: sec.N, S: sec.S, caseId: s.id, caseLabel: s.label,
        });
      }
    }
    // せん断は τ点(支点前面から h/2、ハンチ考慮の h')で別に包絡する
    for (const t of s.shear) {
      const skey = `${t.member}|${t.label}`;
      const prev = shearEnvelope.get(skey);
      if (!prev || Math.abs(t.S) > Math.abs(prev.S)) {
        shearEnvelope.set(skey, { ...t, caseId: s.id, perCase: prev ? prev.perCase : {} });
      }
    }
  }
  // ケース別の値も帳票に出すため保持する
  for (const s of solved) {
    for (const t of s.shear) {
      const e = shearEnvelope.get(`${t.member}|${t.label}`);
      if (e) e.perCase[s.id] = t.S;
    }
  }
  const enveloped = [...envelope.values()];

  // ---- 配筋の決定(部材 × 引張面) --------------------------------------
  const groups = new Map();
  for (const key of ['top', 'bottom', 'left', 'right']) {
    for (const face of ['inner', 'outer']) {
      groups.set(`${key}:${face}`, {
        member: key,
        memberName: geo.memberMap[key].name,
        face,
        faceLabel: FACE_LABEL[face],
        M: 0, S: 0, N: 0,
        h: geo.memberMap[key].t,
        governing: null, caseId: null,
      });
    }
  }
  for (const e of enveloped) {
    const g = groups.get(`${e.member}:${e.face}`);
    if (Math.abs(e.M) >= Math.abs(g.M)) {
      g.M = Math.abs(e.M);
      g.S = Math.abs(e.S);
      g.N = e.N;
      g.h = e.h;
      g.governing = e.label;
      g.caseId = e.caseId;
    }
  }

  const options = input.options || {};
  const designed = [...groups.values()].map((g) => designGroup(g, allow, input.material, options));
  const designMap = new Map(designed.map((d) => [`${d.member}:${d.face}`, d]));

  // ---- 決定した配筋で包絡断面力を照査 ----------------------------------
  const results = enveloped.map((e) => {
    const d = designMap.get(`${e.member}:${e.face}`);
    const As = d.selected ? d.selected.As : 0;
    const chk = checkSection({
      M: e.M, S: e.S, N: e.N,
      h: e.h * 1000, cover: d.cover, barDia: d.selected ? d.selected.dia : 16,
      As, allow, skipShear: true,
    });
    return { ...e, rebar: d.selected, cover: d.cover, check: chk };
  });
  results.sort((a, b) => {
    const order = ['top', 'bottom', 'left', 'right'];
    return order.indexOf(a.member) - order.indexOf(b.member) || a.s - b.s;
  });

  for (const d of designed) {
    if (!d.selected) {
      warnings.push(`${d.memberName} ${d.faceLabel}: 必要鉄筋量 ${d.asRequired.toFixed(0)} mm²/m を満たす配筋が候補内にありません。部材厚の増加を検討してください。`);
    } else if (!d.sectionAdequate) {
      warnings.push(`${d.memberName} ${d.faceLabel}: 曲げモーメント ${d.M.toFixed(1)} kN·m/m が単鉄筋断面の抵抗上限 ${d.concreteCapacity.toFixed(1)} kN·m/m を超えます。部材厚の増加または圧縮鉄筋の配置が必要です。`);
    }
  }
  // ---- せん断の照査(τ点) -----------------------------------------------
  const shearResults = [...shearEnvelope.values()].map((t) => {
    const face = t.M >= 0 ? 'inner' : 'outer';
    const d = designMap.get(`${t.member}:${face}`);
    const As = d && d.selected ? d.selected.As : 0;
    const chk = checkShear({
      S: t.S, h: t.hEff * 1000, cover: d.cover,
      barDia: d.selected ? d.selected.dia : 16, As, allow,
    });
    return { ...t, face, rebar: d.selected, cover: d.cover, check: chk };
  });
  shearResults.sort((a, b) => {
    const order = ['top', 'bottom', 'left', 'right'];
    return order.indexOf(a.member) - order.indexOf(b.member) || a.s - b.s;
  });
  for (const t of shearResults) {
    if (!t.check.ok) {
      warnings.push(`${t.label}: 平均せん断応力度 ${t.check.tau.toFixed(3)} N/mm² が許容値 ${allow.tauA1.toFixed(3)} N/mm² を超えます。部材厚の増加またはハンチの拡大を検討してください。`);
    }
  }

  // ---- 安定検討は全ケース中の最も厳しい結果を採る ----------------------
  const stability = mergeStability(solved);
  for (const s of solved) {
    const b = s.stability.balance;
    if (b.error > 1e-3 * Math.max(1, Math.abs(b.applied))) {
      warnings.push(`CASE-${s.id}: 鉛直方向の釣合い誤差が大きくなっています(載荷 ${b.applied.toFixed(2)} kN/m に対し反力 ${b.reaction.toFixed(2)} kN/m)。`);
    }
  }

  const mainAsMax = Math.max(...designed.map((d) => (d.selected ? d.selected.As : 0)));
  const distribution = distributionRebar(mainAsMax, options.rebar);
  const bendingOk = results.every((r) => r.check.ok);
  const shearOk = shearResults.every((t) => t.check.ok);

  return {
    ok: true,
    input,
    allow,
    concrete: conc,
    rebarGrade: bar,
    geo,
    cases: solved,
    // 既定の表示対象(最も断面力が大きいケース)
    governingCase: solved.reduce((a, b) =>
      maxAbsMoment(b.sections) > maxAbsMoment(a.sections) ? b : a).id,
    loads: solved[0].loads,
    ana: solved[0].ana,
    sections: results,
    shear: shearResults,
    rebarPlan: designed,
    distribution,
    stability,
    warnings: [...new Set(warnings)],
    verdict: {
      bending: bendingOk,
      shear: shearOk,
      section: bendingOk && shearOk,
      stability: stability.ok,
      overall: bendingOk && shearOk && stability.ok,
      maxRatio: Math.max(
        ...results.map((r) => r.check.maxRatio),
        ...shearResults.map((t) => t.check.check.ratio),
      ),
    },
  };
}

const maxAbsMoment = (sections) =>
  sections.reduce((m, s) => Math.max(m, Math.abs(s.M)), 0);

/** 全ケースの安定照査から最も厳しい結果を選ぶ */
function mergeStability(solved) {
  const merged = [];
  const keys = solved[0].stability.items.map((i) => i.key);
  for (const key of keys) {
    let worst = null;
    let worstCase = null;
    for (const s of solved) {
      const item = s.stability.items.find((i) => i.key === key);
      if (!worst || item.ratio > worst.ratio || (worst.ok && !item.ok)) {
        worst = item;
        worstCase = s;
      }
    }
    merged.push({ ...worst, caseId: worstCase.id, caseLabel: worstCase.label });
  }
  const worstBalance = solved.reduce((a, b) =>
    b.stability.balance.error > a.stability.balance.error ? b : a).stability.balance;
  return {
    items: merged,
    balance: worstBalance,
    ok: merged.every((i) => i.ok),
    perCase: solved.map((s) => ({ id: s.id, label: s.label, ok: s.stability.ok })),
  };
}

export { arrangement };

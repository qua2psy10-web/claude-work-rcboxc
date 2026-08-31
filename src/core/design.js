/**
 * 設計計算のエントリポイント
 *
 *   入力条件 → 形状 → 荷重 → 骨組解析 → 断面力 → 配筋設計 → 照査 → 安定検討
 *
 * この関数は DOM に依存しない純粋な計算であり、テストから直接呼び出せる。
 */

import { buildGeometry } from './geometry.js';
import { buildLoads } from './loads.js';
import { analyze, checkSections } from './analyze.js';
import { checkSection, requiredAs, minimumAs, concreteCapacityMoment } from './rc.js';
import { selectRebar, distributionRebar, arrangement } from './rebar.js';
import { checkStability } from './stability.js';
import { concreteProps, rebarProps, GAMMA_C } from './units.js';

/** 既定の設計条件(内空 2.0×2.0m、土被り 1.0m の標準的なケース) */
export function defaultInput() {
  return {
    title: 'RCボックスカルバート 設計計算',
    dims: {
      clearWidth: 2000, clearHeight: 2000,
      topThickness: 300, bottomThickness: 300, wallThickness: 300,
      haunchTopH: 150, haunchTopV: 150,
      haunchBottomH: 150, haunchBottomV: 150,
    },
    soil: {
      cover: 1.0,        // 土被り m
      gamma: 19.0,       // 地下水位以浅の単位体積重量 kN/m3
      gammaSat: 20.0,    // 地下水位以深の飽和単位体積重量 kN/m3
      K0: 0.5,           // 静止土圧係数
      K0Left: null, K0Right: null, // 偏土圧を考慮する場合に個別指定
      alpha: 1.0,        // 鉛直土圧係数(突出形で 1.0 超)
      waterLevel: null,  // 地表面からの地下水位深さ m(null で地下水なし)
    },
    live: {
      enabled: true,
      wheelLoad: 100, contactA: 0.2, contactB: 0.5,
      wheelSpacing: 1.75, tanTheta: 1.0,
      impact: null,      // null で土被りから自動算定
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
  if (input.soil.cover < 0) errors.push('土被りは 0 以上としてください。');
  if (!(input.ground.kv > 0)) errors.push('鉛直地盤反力係数は正の値としてください。');
  if (!(input.ground.qa > 0)) errors.push('許容支持力度は正の値としてください。');
  const cMax = Math.min(d.topThickness, d.bottomThickness, d.wallThickness);
  if (input.material.coverOuter + input.material.coverInner >= cMax) {
    errors.push('かぶりの合計が部材厚以上です。かぶりまたは部材厚を見直してください。');
  }
  return errors;
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
    asReq = requiredAs(group.M, h, cover, dia, allow.sigmaSa);
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

export function design(input) {
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

  // 地下水位が側壁の途中にある場合は、そこを分割の切れ目にして折れ点を再現する
  const extraWallBreaks = [];
  const geoTmp = buildGeometry(input.dims, { sigmaCk: input.material.sigmaCk, divisions: 4 });
  if (input.soil.waterLevel !== null && input.soil.waterLevel !== undefined) {
    const zBottomAxis = input.soil.cover + geoTmp.outerH - geoTmp.dims.t2 / 2;
    const sAtWater = zBottomAxis - input.soil.waterLevel;
    if (sAtWater > 0 && sAtWater < geoTmp.Hc) extraWallBreaks.push(sAtWater);
  }

  const geo = buildGeometry(input.dims, {
    sigmaCk: input.material.sigmaCk,
    divisions: input.options?.divisions ?? 24,
    extraWallBreaks,
  });

  const loads = buildLoads(geo, input);
  warnings.push(...loads.warnings);

  const ana = analyze(geo, loads);
  const sections = checkSections(geo, ana);

  // 部材 × 引張面 でグループ化し、最大曲げモーメントで配筋を決める
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
        governing: null,
      });
    }
  }
  for (const sec of sections) {
    const g = groups.get(`${sec.member}:${sec.tensionSide}`);
    if (Math.abs(sec.M) >= Math.abs(g.M)) {
      g.M = Math.abs(sec.M);
      g.S = Math.abs(sec.S);
      g.N = sec.N;
      g.h = sec.h;
      g.governing = sec.label;
    }
  }

  const options = input.options || {};
  const designed = [...groups.values()].map((g) => designGroup(g, allow, input.material, options));
  const designMap = new Map(designed.map((d) => [`${d.member}:${d.face}`, d]));

  // 決定した配筋で全断面を照査する
  const results = sections.map((sec) => {
    const d = designMap.get(`${sec.member}:${sec.tensionSide}`);
    const As = d.selected ? d.selected.As : 0;
    const chk = checkSection({
      M: sec.M, S: sec.S, N: sec.N,
      h: sec.h * 1000, cover: d.cover, barDia: d.selected ? d.selected.dia : 16,
      As, allow,
    });
    return { ...sec, rebar: d.selected, cover: d.cover, check: chk };
  });

  for (const d of designed) {
    if (!d.selected) {
      warnings.push(`${d.memberName} ${d.faceLabel}: 必要鉄筋量 ${d.asRequired.toFixed(0)} mm²/m を満たす配筋が候補内にありません。部材厚の増加を検討してください。`);
    } else if (!d.sectionAdequate) {
      warnings.push(`${d.memberName} ${d.faceLabel}: 曲げモーメント ${d.M.toFixed(1)} kN·m/m が単鉄筋断面の抵抗上限 ${d.concreteCapacity.toFixed(1)} kN·m/m を超えます。部材厚の増加または圧縮鉄筋の配置が必要です。`);
    }
  }
  for (const r of results) {
    if (!r.check.checks.shear.ok) {
      warnings.push(`${r.label}: 平均せん断応力度 ${r.check.tau.toFixed(3)} N/mm² が許容値 ${allow.tauA1.toFixed(3)} N/mm² を超えます。部材厚の増加またはハンチの拡大を検討してください。`);
    }
  }

  const stability = checkStability(geo, loads, ana, input);
  if (stability.balance.error > 1e-3 * Math.max(1, Math.abs(stability.balance.applied))) {
    warnings.push(`鉛直方向の釣合い誤差が大きくなっています(載荷 ${stability.balance.applied.toFixed(2)} kN/m に対し反力 ${stability.balance.reaction.toFixed(2)} kN/m)。`);
  }

  const mainAsMax = Math.max(...designed.map((d) => (d.selected ? d.selected.As : 0)));
  const distribution = distributionRebar(mainAsMax, options.rebar);

  const sectionOk = results.every((r) => r.check.ok);

  return {
    ok: true,
    input,
    allow,
    concrete: conc,
    rebarGrade: bar,
    geo, loads, ana,
    sections: results,
    rebarPlan: designed,
    distribution,
    stability,
    warnings: [...new Set(warnings)],
    verdict: {
      section: sectionOk,
      stability: stability.ok,
      overall: sectionOk && stability.ok,
      maxRatio: Math.max(...results.map((r) => r.check.maxRatio)),
    },
  };
}

export { arrangement };

/**
 * 計算書(印刷用)の生成
 * 算定の根拠が追えるよう、用いた式と数値を併記する。
 */

import { sectionSVG, loadSVG, diagramSVG } from './draw.js';

const n = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function table(rows, head) {
  return `<table class="rp">${head ? `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` : ''}
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) =>
      (!head && i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</tbody></table>`;
}

export function buildReport(r) {
  const i = r.input;
  const s = r.loads.summary;
  const g = r.geo;
  const mm = (v) => Math.round(v * 1000);
  const today = new Date().toLocaleDateString('ja-JP');

  const conditions = `
  <h2>1. 設計条件</h2>
  <h3>1.1 形状</h3>
  ${table([
    ['内空寸法', `幅 ${mm(g.dims.B)} mm × 高 ${mm(g.dims.H)} mm`],
    ['部材厚', `頂版 ${mm(g.dims.t1)} / 底版 ${mm(g.dims.t2)} / 側壁 ${mm(g.dims.t3)} mm`],
    ['ハンチ', `頂版 ${mm(g.dims.hTh)}×${mm(g.dims.hTv)} / 底版 ${mm(g.dims.hBh)}×${mm(g.dims.hBv)} mm`],
    ['外形寸法', `幅 ${mm(g.outerW)} mm × 高 ${mm(g.outerH)} mm`],
    ['設計スパン', `L = B + t3 = ${n(g.L, 3)} m、設計高さ H0 = ${n(g.Hc, 3)} m`],
    ['コンクリート断面積', `${n(g.solidArea, 4)} m²/m`],
  ])}
  <h3>1.2 土質・荷重条件</h3>
  ${table([
    ['土被り', `${n(i.soil.cover, 2)} m`],
    ['単位体積重量', `γ = ${n(i.soil.gamma)} kN/m³、γsat = ${n(i.soil.gammaSat)} kN/m³`],
    ['静止土圧係数', `K0 = ${n(s.Kl, 2)}(左) / ${n(s.Kr, 2)}(右)`],
    ['鉛直土圧係数', `α = ${n(s.alpha, 2)}`],
    ['地下水位', Number.isFinite(s.waterDepth) ? `地表面から ${n(s.waterDepth, 2)} m` : 'なし'],
    ['内水位', `${n(s.innerWater, 2)} m`],
    ['活荷重', i.live.enabled ? `T-25(後輪 ${n(i.live.wheelLoad, 0)} kN/輪)` : '考慮しない'],
  ])}
  <h3>1.3 材料・地盤</h3>
  ${table([
    ['コンクリート', `σck = ${i.material.sigmaCk} N/mm²、Ec = ${n(r.concrete.Ec, 0)} N/mm²`],
    ['鉄筋', `${i.material.rebarGrade}`],
    ['許容応力度', `σca = ${n(r.allow.sigmaCa)}、σsa = ${n(r.allow.sigmaSa)}、τa1 = ${n(r.allow.tauA1, 3)} N/mm²`],
    ['かぶり', `外側 ${i.material.coverOuter} mm / 内側 ${i.material.coverInner} mm`],
    ['地盤', `kv = ${n(i.ground.kv, 0)} kN/m³、qa = ${n(i.ground.qa, 1)} kN/m²、μ = ${n(i.ground.friction, 2)}`],
  ])}`;

  const liveDetail = i.live.enabled ? `
    <p class="formula">q<sub>L</sub> = 2P(1+i) / (L<sub>a</sub>·L<sub>b</sub>)
      = 2 × ${n(i.live.wheelLoad, 0)} × (1 + ${n(s.live.impact, 3)})
      / (${n(s.live.La, 3)} × ${n(s.live.Lb, 3)}) = <b>${n(s.live.q)} kN/m²</b></p>
    <p class="note">L<sub>a</sub> = a + 2h·tanθ = ${n(i.live.contactA, 2)} + 2 × ${n(i.soil.cover, 2)} × ${n(i.live.tanTheta, 2)} = ${n(s.live.La, 3)} m、
      L<sub>b</sub> = ${s.live.overlap ? '左右輪の分布が重なるため 輪間隔 + 1輪の分布幅' : '2輪分の分布幅'} = ${n(s.live.Lb, 3)} m、
      衝撃係数 i = ${n(s.live.impact, 3)}</p>` : '<p>活荷重は考慮しない。</p>';

  const loads = `
  <h2>2. 荷重の算定</h2>
  <h3>2.1 躯体自重</h3>
  <p class="formula">W = A<sub>c</sub> · γ<sub>c</sub> = ${n(g.solidArea, 4)} × ${n(i.material.gammaC)}
    = <b>${n(s.selfWeight)} kN/m</b></p>
  <h3>2.2 鉛直土圧</h3>
  <p class="formula">q<sub>V</sub> = α · σ<sub>v</sub>(h) = ${n(s.alpha, 2)} × ${n(s.sigmaVTop)}
    = <b>${n(s.earthTop)} kN/m²</b></p>
  <h3>2.3 活荷重による鉛直土圧</h3>
  ${liveDetail}
  <h3>2.4 頂版に作用する鉛直荷重</h3>
  <p class="formula">q = q<sub>V</sub> + q<sub>L</sub> = ${n(s.earthTop)} + ${n(s.live.q)}
    = <b>${n(s.qTop)} kN/m²</b></p>
  <h3>2.5 側方土圧</h3>
  <p class="formula">σ<sub>h</sub>(z) = K·(σ<sub>v</sub>(z) − u(z)) + u(z) + K·α·q<sub>L</sub></p>
  ${table([
    ['側壁上端(頂版中心)', `深さ ${n(s.zTopAxis, 3)} m: 左 ${n(s.lateralTopLeft)} / 右 ${n(s.lateralTopRight)} kN/m²`],
    ['側壁下端(底版中心)', `深さ ${n(s.zBottomAxis, 3)} m: 左 ${n(s.lateralBottomLeft)} / 右 ${n(s.lateralBottomRight)} kN/m²`],
  ])}
  <h3>2.6 水圧・浮力</h3>
  ${table([
    ['底版下面の揚圧力', `${n(s.uBottom)} kN/m²`],
    ['内水重', `${n(s.innerWeight)} kN/m`],
  ])}
  <h3>2.7 鉛直方向の釣合い</h3>
  <p class="formula">ΣV = W + q·L + 内水重 − 揚圧力 = <b>${n(s.totalVertical)} kN/m</b>
    (底版バネ反力の合計 ${n(r.ana.totalReaction)} kN/m、差 ${n(r.stability.balance.error, 6)})</p>`;

  const forces = `
  <h2>3. 骨組解析と断面力</h2>
  <p>部材軸線による閉合ラーメンとしてモデル化し、底版は鉛直地盤反力係数
     k<sub>v</sub> = ${n(i.ground.kv, 0)} kN/m³ の弾性床上の梁として解いた。
     曲げモーメントは内空側引張を正とする。</p>
  <div class="figrow">${diagramSVG(r, 'M', 420, 380)}${diagramSVG(r, 'S', 420, 380)}</div>
  ${table(r.sections.map((x) => [
    esc(x.label), n(x.M, 1), n(Math.abs(x.S), 1), n(x.N, 1),
    x.tensionSide === 'inner' ? '内側' : '外側', `${mm(x.h)}`,
  ]), ['照査断面', 'M (kN·m/m)', 'S (kN/m)', 'N (kN/m)', '引張側', '部材厚 (mm)'])}`;

  const rebar = `
  <h2>4. 配筋の決定</h2>
  <p class="formula">A<sub>s</sub> = M / (σ<sub>sa</sub> · j · d)、
     j = 1 − x/3d、b·x²/2 = n·A<sub>s</sub>(d − x)、n = 15</p>
  ${table(r.rebarPlan.map((p) => [
    `${p.memberName} ${p.faceLabel}`, n(p.M, 1), `${mm(p.h)}`, n(p.cover, 0),
    n(p.asRequired, 0), n(p.asMinimum, 0),
    p.selected ? p.selected.label : '候補なし',
    p.selected ? n(p.selected.As, 0) : '—',
  ]), ['部材・面', '設計 M', '部材厚 mm', 'かぶり mm', '必要 As', '最小 As', '採用', '配置 As'])}
  <p class="note">配力鉄筋: 必要 ${n(r.distribution.required, 0)} mm²/m →
     ${r.distribution.selected ? r.distribution.selected.label : '—'}</p>`;

  const check = `
  <h2>5. 応力度の照査</h2>
  <p class="formula">σ<sub>c</sub> = 2M/(b·x·j·d) + N/(b·h)、σ<sub>s</sub> = M/(A<sub>s</sub>·j·d)、
     τ<sub>m</sub> = S/(b·j·d)</p>
  ${table(r.sections.map((x) => [
    esc(x.label), x.rebar ? x.rebar.label : '—',
    `${n(x.check.d, 1)}`, `${n(x.check.x, 1)}`, `${n(x.check.j, 3)}`,
    `${n(x.check.sigmaC)} / ${n(r.allow.sigmaCa)}`,
    `${n(x.check.sigmaS, 1)} / ${n(r.allow.sigmaSa, 1)}`,
    `${n(x.check.tau, 3)} / ${n(r.allow.tauA1, 3)}`,
    x.check.ok ? 'OK' : 'NG',
  ]), ['照査断面', '配筋', 'd mm', 'x mm', 'j', 'σc/σca', 'σs/σsa', 'τm/τa1', '判定'])}`;

  const stability = `
  <h2>6. 安定・基礎の検討</h2>
  ${table(r.stability.items.map((x) => [x.label, esc(x.text), x.ok ? 'OK' : 'NG']),
    ['照査項目', '内容', '判定'])}`;

  const warn = r.warnings.length ? `
  <h2>7. 確認事項</h2><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '';

  return `<article class="report">
    <header class="rp-head">
      <h1>${esc(i.title)}</h1>
      <p>単室ボックスカルバート(1連) / 道路土工 カルバート工指針 準拠 / 許容応力度法</p>
      <p class="rp-meta">作成日 ${today} ・ 総合判定 <b>${r.verdict.overall ? 'OK' : 'NG'}</b></p>
    </header>
    <div class="figrow">${sectionSVG(r, 420, 380)}${loadSVG(r, 420, 380)}</div>
    ${conditions}${loads}${forces}${rebar}${check}${stability}${warn}
    <footer class="rp-foot">本計算書は設計の一次検討を目的としたものです。実施設計にあたっては有資格者による確認を行ってください。</footer>
  </article>`;
}

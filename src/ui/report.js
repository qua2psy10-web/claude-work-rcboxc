/**
 * 計算書(印刷用)の生成
 *
 * 章立てと体裁は実務のボックスカルバート設計計算書にならう。
 *
 *   表紙
 *   1 設計条件      1.1 一般条件 1.2 単位体積重量 1.3 土圧係数 1.4 活荷重
 *                   1.5 衝撃係数 1.6 鉄筋かぶり 1.7 許容応力度
 *                   1.8 標準断面図 1.9 荷重の組合せ
 *   2 断面力計算    2.n.1 設計荷重 / 2.n.2 構造解析 / 2.n.3 各部材の断面力
 *   3 断面力集計表  各ケースから最大値を抽出(M・N・e・c・Ms・CASE)
 *   4 必要鉄筋量
 *   5 配筋及び実応力度
 *   6 せん断力に対する検討
 *   7 安定・基礎の検討
 *   8 確認事項
 *
 * 算定の根拠が追えるよう、用いた式と数値を併記する。
 */

import { sectionSVG, loadSVG, diagramSVG } from './draw.js';

const n = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const mm = (v) => Math.round(v * 1000);

/** 「記号 : 値 [単位]」の整列行 */
function defRows(rows) {
  return `<table class="rp def">${rows.map(([label, sym, val, unit]) => `<tr>
    <td class="lbl">${label}</td><td class="sym">${sym}</td>
    <td class="eq">${val === '' ? '' : '＝'}</td><td class="val">${val}</td>
    <td class="unit">${unit ? `[${unit}]` : ''}</td></tr>`).join('')}</table>`;
}

function table(rows, head, cls = '') {
  return `<table class="rp ${cls}">${head ? `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` : ''}
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/** 断面力一覧表(部材の各点における M・S・N) */
function forceTable(geo, ana) {
  const rows = [];
  for (const key of ['top', 'bottom', 'left', 'right']) {
    const m = geo.memberMap[key];
    const pts = [
      ['端部(始点)', 0],
      ['ハンチ端(始点側)', m.haunchEnd1],
      ['中央', m.length / 2],
      ['ハンチ端(終点側)', m.haunchEnd2],
      ['端部(終点)', m.length],
    ];
    pts.forEach(([name, s], i) => {
      const p = ana.forceAt(key, s);
      rows.push([
        i === 0 ? `<b>${esc(m.name)}</b>` : '', name, n(s, 3),
        n(p.M, 2), n(p.S, 2), n(p.N, 2),
      ]);
    });
  }
  return table(rows, ['部材', '点', 'x (m)', 'M (kN·m/m)', 'S (kN/m)', 'N (kN/m)'], 'num');
}

/** 1ケース分の章 */
function caseChapter(r, c, idx) {
  const s = c.loads.summary;
  const no = `2.${idx + 1}`;
  const live = s.liveMode === 'top' && s.live.q > 0 ? `
    <p class="formula">(3) 活荷重 Ｐvl ＝ 2Ｐ(1+i) / (Ｌa · Ｌb)
      ＝ 2 × ${n(r.input.live.wheelLoad, 0)} × (1 + ${n(s.live.impact, 3)})
      / (${n(s.live.La, 3)} × ${n(s.live.Lb, 3)}) ＝ <b>${n(s.live.q)} kＮ/m²</b></p>
    <p class="note">Ｌa ＝ a + 2h·tanθ ＝ ${n(s.live.La, 3)} m、
      Ｌb ＝ ${s.live.overlap ? '左右輪の分布が重なるため 輪間隔 + 1輪の分布幅' : '2輪分の分布幅'}
      ＝ ${n(s.live.Lb, 3)} m、衝撃係数 i ＝ ${n(s.live.impact, 3)}</p>`
    : s.liveMode === 'side' && s.surcharge > 0 ? `
    <p class="formula">(3) 活荷重 側載のため頂版に鉛直活荷重は載らない。背面の上載荷重
      Ｑ ＝ <b>${n(s.surcharge)} kＮ/m²</b> による側方土圧として考慮する。</p>`
    : '<p class="formula">(3) 活荷重 このケースでは考慮しない。</p>';

  return `
  <section class="chapter">
  <h2>${no} 荷重ケース CASE-${c.id}(${esc(c.label)})</h2>

  <h3>${no}.1 設計荷重</h3>
  <p class="formula">(1) 躯体自重 Ｗ ＝ Ａc × γc
     ＝ ${n(r.geo.solidArea, 4)} × ${n(r.input.material.gammaC)} ＝ <b>${n(s.selfWeight)} kＮ/m</b></p>
  <p class="formula">(2) 鉛直土圧 Ｐvd ＝ α × σv(h)
     ＝ ${n(s.alpha, 3)} × ${n(s.sigmaVTop)} ＝ <b>${n(s.earthTop)} kＮ/m²</b></p>
  ${live}
  <p class="formula">(4) 頂版の鉛直荷重 ｑ ＝ Ｐvd${s.liveMode === 'top' && s.live.q > 0 ? ' + Ｐvl' : ''}
     ＝ <b>${n(s.qTop)} kＮ/m²</b></p>
  <p class="formula">(5) 水平土圧 σh(z) ＝ Ｋ(σv(z) − u(z)) + u(z) + Ｋ·α·Ｑ</p>
  ${table([
    ['側壁上端(頂版中心)', n(s.zTopAxis, 3), n(s.lateralTopLeft), n(s.lateralTopRight)],
    ['側壁下端(底版中心)', n(s.zBottomAxis, 3), n(s.lateralBottomLeft), n(s.lateralBottomRight)],
  ], ['位置', '深さ (m)', '左 (kN/m²)', '右 (kN/m²)'], 'num')}
  ${s.uBottom > 0 ? `<p class="formula">(6) 底版下面の揚圧力 ｕ ＝ <b>${n(s.uBottom)} kＮ/m²</b></p>` : ''}
  <p class="formula">(7) 鉛直方向の釣合い ΣＶ ＝ <b>${n(s.totalVertical)} kＮ/m</b>
     (底版反力の合計 ${n(c.ana.totalReaction)} kＮ/m、差 ${n(c.stability.balance.error, 6)})</p>
  <div class="figrow">${loadSVG({ ...r, loads: c.loads, ana: c.ana }, 400, 360)}</div>

  <h3>${no}.2 構造解析</h3>
  <p>部材軸線による閉合ラーメンとしてモデル化し、底版は鉛直地盤反力係数
     ｋv ＝ ${n(r.input.ground.kv, 0)} kＮ/m³ の弾性床上の梁として直接剛性法で解く。
     曲げモーメントは内空側引張を正とする。</p>
  <div class="figrow">${diagramSVG({ ...r, ana: c.ana }, 'M', 400, 360)}${diagramSVG({ ...r, ana: c.ana }, 'S', 400, 360)}</div>

  <h3>${no}.3 各部材の断面力</h3>
  ${forceTable(r.geo, c.ana)}
  </section>`;
}

export function buildReport(r) {
  const i = r.input;
  const g = r.geo;
  const p = i.project || {};
  const today = p.date || new Date().toLocaleDateString('ja-JP');
  const title = p.name || i.title;

  // ---- 表紙 ------------------------------------------------------------
  const cover = `
  <section class="cover">
    <div class="cover-code">${p.code ? `台帳 No. ${esc(p.code)}` : ''}</div>
    <h1>ＲＣボックスカルバート<br>設 計 計 算 書</h1>
    <p class="cover-sub">単室(1連) / 道路土工 カルバート工指針 / 許容応力度法</p>
    <div class="cover-box">
      ${defRows([
        ['内空寸法', '内 幅(Ｂ)', `${mm(g.dims.B)}`, 'mm'],
        ['', '内 高(Ｈ)', `${mm(g.dims.H)}`, 'mm'],
        ['部材厚', '頂版 Ｔ1', `${mm(g.dims.t1)}`, 'mm'],
        ['', '底版 Ｔ2', `${mm(g.dims.t2)}`, 'mm'],
        ['', '側壁 Ｔ3', `${mm(g.dims.t3)}`, 'mm'],
        ['土被り', 'Ｈ1', n(i.soil.coverMin, 3), 'm'],
        ['', 'Ｈ2', n(i.soil.coverMax, 3), 'm'],
        ['活荷重', '', i.live.enabled ? `Ｔ荷重(後輪 ${n(i.live.wheelLoad, 0)} kＮ/輪)` : '考慮しない', ''],
      ])}
    </div>
    <div class="figrow">${sectionSVG(r, 420, 400)}</div>
    ${table([
      ['工事名', esc(p.name || '')],
      ['工区名', esc(p.section || '')],
      ['設計者', esc(p.designer || '')],
      ['作成日', esc(today)],
    ], null, 'meta')}
    <p class="cover-verdict ${r.verdict.overall ? 'ok' : 'ng'}">
      総合判定 ${r.verdict.overall ? 'ＯＫ' : 'ＮＧ'}</p>
  </section>`;

  // ---- 1 設計条件 ------------------------------------------------------
  const conditions = `
  <section class="chapter">
  <h2>1 設計条件</h2>

  <h3>1.1 一般条件</h3>
  ${defRows([
    ['構造形式', '', '一径間ボックスラーメン', ''],
    ['内空寸法', '(Ｂ)×(Ｈ)', `${mm(g.dims.B)} × ${mm(g.dims.H)}`, 'mm'],
    ['外形寸法', '', `${mm(g.outerW)} × ${mm(g.outerH)}`, 'mm'],
    ['設計スパン', 'Ｌ', n(g.L, 3), 'm'],
    ['設計高さ', 'Ｈo', n(g.Hc, 3), 'm'],
    ['土被り', 'Ｈ1 〜 Ｈ2', `${n(i.soil.coverMin, 3)} 〜 ${n(i.soil.coverMax, 3)}`, 'm'],
    ['コンクリート断面積', 'Ａc', n(g.solidArea, 4), 'm²/m'],
  ])}

  <h3>1.2 単位体積重量</h3>
  ${defRows([
    ['鉄筋コンクリート', 'γc', n(i.material.gammaC), 'kＮ/m³'],
    ['土(地下水位以上)', 'γs', n(i.soil.gamma), 'kＮ/m³'],
    ['土(地下水位以下)', 'γsat', n(i.soil.gammaSat), 'kＮ/m³'],
    ['水', 'γw', n(9.8), 'kＮ/m³'],
  ])}

  <h3>1.3 土圧係数</h3>
  ${defRows([
    ['(水 平)', 'Ｋa', n(i.soil.K0, 3), ''],
    ['(鉛 直)', 'α', n(i.soil.alpha, 3), ''],
  ])}

  <h3>1.4 活荷重</h3>
  ${defRows([
    ['(上 載)', '', i.live.enabled
      ? `Ｔ荷重 横断通行 (輪接地幅 a ＝ ${n(i.live.contactA, 2)}m  b ＝ ${n(i.live.contactB, 2)}m)`
      : '考慮しない', ''],
    ['(側 載)', 'Ｑ', n(i.live.surcharge), 'kＮ/m²'],
  ])}

  <h3>1.5 衝撃係数</h3>
  ${defRows([['', 'ｉ', i.live.impact === null || i.live.impact === undefined
    ? '土被りに応じて自動算定' : n(i.live.impact, 3), '']])}

  <h3>1.6 鉄筋かぶり</h3>
  ${defRows([
    ['(内 側)', '', `${i.material.coverInner}`, 'mm'],
    ['(外 側)', '', `${i.material.coverOuter}`, 'mm'],
  ])}

  <h3>1.7 許容応力度</h3>
  ${defRows([
    ['鉄筋引張応力度', 'σsa', n(r.allow.sigmaSa, 1), 'Ｎ/mm²'],
    ['鉄筋降伏点応力度', 'σsy', n(r.rebarGrade.fy, 0), 'Ｎ/mm²'],
    ['コンクリート 設計基準強度', 'σck', n(i.material.sigmaCk, 1), 'Ｎ/mm²'],
    ['       曲げ圧縮応力度', 'σca', n(r.allow.sigmaCa, 1), 'Ｎ/mm²'],
    ['       せん断応力度', 'τa', n(r.allow.tauA1, 3), 'Ｎ/mm²'],
    ['ヤング係数比', 'ｎ', '15', ''],
  ])}

  <h3>1.8 標準断面図</h3>
  <div class="figrow">${sectionSVG(r, 420, 400)}</div>

  <h3>1.9 荷重の組合せ</h3>
  <p>［荷重 CASE］</p>
  ${table(r.cases.map((c) => [
    `CASE-${c.id}`, c.modeLabel, `${n(c.cover, 3)} m`,
    c.water ? '影響あり' : '影響なし',
  ]), ['ケース', '載荷位置', '土被り', '地下水'], 'num')}
  <p class="note">上載 … 荷重がカルバート上載の場合。頂版に鉛直活荷重が載る。<br>
     側載 … 荷重がカルバート側載の場合。背面の上載荷重 Ｑ による側方土圧のみを考慮する。<br>
     本計算書は上表の ${r.cases.length} ケースについて行い、断面力の最大値で照査する。</p>
  </section>`;

  // ---- 2 断面力計算 ----------------------------------------------------
  const forces = `
  <section class="chapter">
  <h2>2 断面力計算</h2>
  <p>各荷重ケースについて設計荷重を算定し、閉合ラーメンとして構造解析を行って
     部材の断面力を求める。曲げモーメントの照査位置は支間中央およびハンチ端、
     せん断力の照査位置はハンチ端とする。</p>
  </section>
  ${r.cases.map((c, k) => caseChapter(r, c, k)).join('')}`;

  // ---- 3 断面力集計表 --------------------------------------------------
  const summary = `
  <section class="chapter">
  <h2>3 断面力集計表</h2>
  <p>各ケースより断面力の最大値を抽出する。</p>
  ${defRows([
    ['部材モーメント', 'Ｍ', '', 'kＮ·m'],
    ['軸力', 'Ｎ', '', 'kＮ'],
    ['偏位量', 'ｅ ＝ Ｍ/Ｎ', '', 'cm'],
    ['部材中心軸と鉄筋間距離', 'ｃ', '', 'cm'],
    ['軸力を考慮した曲げモーメント', 'Ｍs ＝ Ｎ(ｅ+ｃ)/100 ＝ Ｍ + Ｎ·ｃ/100', '', 'kＮ·m'],
  ])}
  ${table(r.sections.map((x) => [
    esc(x.memberName),
    esc(x.label.replace(x.memberName, '').trim()),
    x.face === 'inner' ? '内側' : '外側',
    n(x.M, 3), n(x.N, 3),
    Number.isFinite(x.check.e) ? n(x.check.e / 10, 2) : '—',
    n(x.check.c / 10, 2), n(x.check.Ms, 3),
    `CASE-${x.caseId}`,
  ]), ['部材', '点', '引張側', 'Ｍ (kN·m)', 'Ｎ (kN)', 'ｅ (cm)', 'ｃ (cm)', 'Ｍs (kN·m)', 'CASE'], 'num')}
  <p class="note">CASE の列は曲げモーメントを抽出したケースを示す。</p>
  </section>`;

  // ---- 4 必要鉄筋量 ----------------------------------------------------
  const rebar = `
  <section class="chapter">
  <h2>4 必要鉄筋量</h2>
  <p class="formula">鉄筋の曲げ引張応力度が許容値 σsa に達するときの必要鉄筋量 Ａs を求める。<br>
     中立軸 ｘ:  Ｎ·ｘ³ − 3(Ｎ·Ｔ/2 − Ｍ)·ｘ² + 6ｎＡs/ｂ·Ｍs·(ｘ − ｄ) ＝ 0<br>
     σc ＝ 2Ｍs / (ｂ·ｘ·(ｄ − ｘ/3))、  σs ＝ ｎ·σc·(ｄ − ｘ)/ｘ</p>
  ${table(r.rebarPlan.map((x) => [
    esc(x.memberName), esc(x.faceLabel),
    n(x.M, 2), n(x.N, 2), `${mm(x.h)}`, n(x.cover, 0),
    n(x.asRequired, 0), n(x.asMinimum, 0),
    x.selected ? esc(x.selected.label) : '<span class="ng">候補なし</span>',
    x.selected ? n(x.selected.As, 0) : '—',
    x.caseId ? `CASE-${x.caseId}` : '—',
  ]), ['部材', '面', '設計Ｍ', 'Ｎ', 'Ｔ (mm)', 'かぶり', '必要Ａs', '最小Ａs', '採用', '配置Ａs', 'CASE'], 'num')}
  <p class="note">配力鉄筋: 必要 ${n(r.distribution.required, 0)} mm²/m →
     ${r.distribution.selected ? esc(r.distribution.selected.label) : '—'}(主鉄筋の 1/3 以上)</p>
  </section>`;

  // ---- 5 配筋及び実応力度 ----------------------------------------------
  const stress = `
  <section class="chapter">
  <h2>5 配筋及び実応力度</h2>
  ${table(r.sections.map((x) => [
    esc(x.memberName),
    esc(x.label.replace(x.memberName, '').trim()),
    x.rebar ? esc(x.rebar.label) : '—',
    n(x.check.d, 1), n(x.check.x, 1),
    n(x.check.sigmaC, 2), n(r.allow.sigmaCa, 2),
    n(x.check.sigmaS, 1), n(r.allow.sigmaSa, 1),
    x.check.checks.concrete.ok && x.check.checks.steel.ok
      ? '<b class="ok">CHECK OK</b>' : '<b class="ng">CHECK NG</b>',
  ]), ['部材', '点', '配筋', 'ｄ (mm)', 'ｘ (mm)', 'σc', 'σca', 'σs', 'σsa', '判定'], 'num')}
  </section>`;

  // ---- 6 せん断力に対する検討 ------------------------------------------
  const shearRows = r.shear.map((x) => {
    const sec = r.sections.find((y) => y.member === x.member && y.label === x.label);
    const chk = sec ? sec.check : null;
    return [
      esc(x.memberName), esc(x.label.replace(x.memberName, '').trim()),
      ...r.cases.map((c) => n(x.perCase[c.id] ?? 0, 2)),
      `<b>${n(Math.abs(x.S), 2)}</b>`,
      `CASE-${x.caseId}`,
      chk ? n(chk.tau, 3) : '—', n(r.allow.tauA1, 3),
      chk ? (chk.checks.shear.ok ? '<b class="ok">CHECK OK</b>' : '<b class="ng">CHECK NG</b>') : '—',
    ];
  });
  const shear = `
  <section class="chapter">
  <h2>6 せん断力に対する検討</h2>
  <h3>6.1 せん断力照査点の断面力と最大値抽出</h3>
  ${table(shearRows,
    ['部材', '点', ...r.cases.map((c) => `CASE-${c.id}`), '最大 Ｓ', 'CASE', 'τm', 'τa', '判定'], 'num')}
  <h3>6.2 せん断応力度の照査</h3>
  <p class="formula">τm ＝ Ｓ / (ｂ·ｊ·ｄ) ≦ τa ＝ ${n(r.allow.tauA1, 3)} Ｎ/mm²</p>
  <p class="note">照査位置はハンチ端とし、部材厚は基本厚を用いる(ハンチによる増加は見込まない)。</p>
  </section>`;

  // ---- 7 安定・基礎の検討 ----------------------------------------------
  const stability = `
  <section class="chapter">
  <h2>7 安定・基礎の検討</h2>
  ${table(r.stability.items.map((x) => [
    esc(x.label), esc(x.text), `CASE-${x.caseId}`,
    x.ok ? '<b class="ok">CHECK OK</b>' : '<b class="ng">CHECK NG</b>',
  ]), ['照査項目', '内容', '支配CASE', '判定'])}
  <p class="note">各荷重ケースについて照査し、最も厳しい結果を示す。</p>
  </section>`;

  const warn = r.warnings.length ? `
  <section class="chapter">
  <h2>8 確認事項</h2><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
  </section>` : '';

  return `<div class="print-header"><span>${esc(title)}</span><span>${esc(p.code || '')}</span></div>
  <article class="report" data-title="${esc(title)}" data-code="${esc(p.code || '')}">
    ${cover}${conditions}${forces}${summary}${rebar}${stress}${shear}${stability}${warn}
    <footer class="rp-foot">本計算書は設計の一次検討を目的としたものです。実施設計にあたっては有資格者による確認を行ってください。</footer>
  </article>`;
}

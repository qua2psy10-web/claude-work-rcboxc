/**
 * 画面の組み立てと再計算
 */

import { design, defaultInput } from '../core/design.js';
import { sectionSVG, loadSVG, diagramSVG, reactionSVG } from './draw.js';
import { buildReport } from './report.js';

const STORAGE_KEY = 'rc-box-culvert-input-v1';

const num = (v, digits = 2) =>
  (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits));

/** 入力欄の定義。path は入力オブジェクトのキー経路。 */
const FIELDS = [
  {
    group: '形状(mm)', open: true, items: [
      { path: 'dims.clearWidth', label: '内空幅 B', step: 50 },
      { path: 'dims.clearHeight', label: '内空高 H', step: 50 },
      { path: 'dims.topThickness', label: '頂版厚 t1', step: 10 },
      { path: 'dims.bottomThickness', label: '底版厚 t2', step: 10 },
      { path: 'dims.wallThickness', label: '側壁厚 t3', step: 10 },
      { path: 'dims.haunchTopH', label: '頂版ハンチ 水平', step: 10 },
      { path: 'dims.haunchTopV', label: '頂版ハンチ 鉛直', step: 10 },
      { path: 'dims.haunchBottomH', label: '底版ハンチ 水平', step: 10 },
      { path: 'dims.haunchBottomV', label: '底版ハンチ 鉛直', step: 10 },
    ],
  },
  {
    group: '土質・土被り', open: true, items: [
      { path: 'soil.cover', label: '土被り', unit: 'm', step: 0.1 },
      { path: 'soil.gamma', label: '単位体積重量 γ', unit: 'kN/m³', step: 0.5 },
      { path: 'soil.gammaSat', label: '飽和単位体積重量 γsat', unit: 'kN/m³', step: 0.5 },
      { path: 'soil.K0', label: '静止土圧係数 K0', step: 0.05 },
      { path: 'soil.alpha', label: '鉛直土圧係数 α', step: 0.05, help: '突出形で 1.0 を超える値を入力' },
      { path: 'soil.waterLevel', label: '地下水位(地表面から)', unit: 'm', step: 0.1, nullable: true, help: '空欄で地下水なし' },
      { path: 'soil.K0Left', label: '左側 K0(偏土圧)', step: 0.05, nullable: true, help: '空欄で K0 と同じ' },
      { path: 'soil.K0Right', label: '右側 K0(偏土圧)', step: 0.05, nullable: true },
    ],
  },
  {
    group: '活荷重(T-25)', items: [
      { path: 'live.enabled', label: '活荷重を考慮する', type: 'checkbox' },
      { path: 'live.wheelLoad', label: '後輪1輪の荷重 P', unit: 'kN', step: 5 },
      { path: 'live.contactA', label: '接地長 a(進行方向)', unit: 'm', step: 0.05 },
      { path: 'live.contactB', label: '接地幅 b(直角方向)', unit: 'm', step: 0.05 },
      { path: 'live.wheelSpacing', label: '左右輪の間隔', unit: 'm', step: 0.05 },
      { path: 'live.tanTheta', label: '分布角 tanθ', step: 0.1, help: '1.0 で 45°' },
      { path: 'live.impact', label: '衝撃係数 i', step: 0.05, nullable: true, help: '空欄で土被りから自動算定' },
    ],
  },
  {
    group: '材料', items: [
      { path: 'material.sigmaCk', label: '設計基準強度 σck', unit: 'N/mm²', type: 'select', options: [21, 24, 27, 30, 40] },
      { path: 'material.rebarGrade', label: '鉄筋種別', type: 'select', options: ['SD295', 'SD345', 'SD390'] },
      { path: 'material.coverOuter', label: 'かぶり(外側)', unit: 'mm', step: 5 },
      { path: 'material.coverInner', label: 'かぶり(内側)', unit: 'mm', step: 5 },
      { path: 'material.gammaC', label: 'コンクリート単位体積重量', unit: 'kN/m³', step: 0.5 },
      { path: 'material.minAsRatio', label: '最小鉄筋量比(b·d に対して)', step: 0.0005 },
      { path: 'material.allowIncrease', label: '許容応力度の割増係数', step: 0.05 },
      { path: 'material.shearCe', label: 'せん断補正係数 ce(有効高)', step: 0.05, help: '道示による補正を行う場合に入力' },
      { path: 'material.shearCpt', label: 'せん断補正係数 cpt(鉄筋比)', step: 0.05 },
    ],
  },
  {
    group: '地盤・水位', items: [
      { path: 'ground.kv', label: '鉛直地盤反力係数 kv', unit: 'kN/m³', step: 1000 },
      { path: 'ground.kh', label: '水平せん断バネ kh', unit: 'kN/m³', step: 1000, nullable: true, help: '空欄で kv/3' },
      { path: 'ground.qa', label: '許容支持力度 qa', unit: 'kN/m²', step: 10 },
      { path: 'ground.friction', label: '底面摩擦係数 μ', step: 0.05 },
      { path: 'ground.upliftSafety', label: '浮上りの所要安全率', step: 0.05 },
      { path: 'ground.slideSafety', label: '水平力の所要安全率', step: 0.05 },
      { path: 'water.innerLevel', label: '内水位(内空底面から)', unit: 'm', step: 0.1 },
    ],
  },
  {
    group: '計算条件', items: [
      { path: 'options.divisions', label: '部材の分割数', step: 4, help: '大きいほど断面力の精度が上がる' },
    ],
  },
];

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
const setPath = (obj, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  const t = keys.reduce((o, k) => (o[k] ??= {}), obj);
  t[last] = value;
};

let input = defaultInput();
let current = null;
let activeTab = 'section';

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    input = mergeInput(defaultInput(), saved);
  } catch { /* 保存値が壊れている場合は既定値のまま */ }
}

function mergeInput(base, saved) {
  if (!saved || typeof saved !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (!(k in saved)) continue;
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      base[k] = mergeInput(base[k], saved[k]);
    } else {
      base[k] = saved[k];
    }
  }
  return base;
}

function store() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(input)); } catch { /* 保存できなくても継続 */ }
}

function buildForm() {
  const host = document.getElementById('form');
  host.innerHTML = FIELDS.map((g) => `
    <details ${g.open ? 'open' : ''}>
      <summary>${g.group}</summary>
      <div class="fields">
        ${g.items.map((f) => fieldHTML(f)).join('')}
      </div>
    </details>`).join('');

  host.addEventListener('input', (ev) => {
    const el = ev.target;
    if (!el.dataset.path) return;
    const f = allFields().find((x) => x.path === el.dataset.path);
    let v;
    if (f.type === 'checkbox') v = el.checked;
    else if (f.type === 'select') v = Number.isNaN(Number(el.value)) ? el.value : Number(el.value);
    else if (el.value.trim() === '') v = f.nullable ? null : NaN;
    else v = Number(el.value);
    setPath(input, f.path, v);
    store();
    recalc();
  });
}

const allFields = () => FIELDS.flatMap((g) => g.items);

function fieldHTML(f) {
  const v = getPath(input, f.path);
  const id = `f_${f.path.replace(/\./g, '_')}`;
  const help = f.help ? `<span class="help">${f.help}</span>` : '';
  if (f.type === 'checkbox') {
    return `<label class="field check" for="${id}">
      <input type="checkbox" id="${id}" data-path="${f.path}" ${v ? 'checked' : ''}>
      <span>${f.label}</span>${help}</label>`;
  }
  if (f.type === 'select') {
    return `<label class="field" for="${id}"><span>${f.label}${f.unit ? ` <em>${f.unit}</em>` : ''}</span>
      <select id="${id}" data-path="${f.path}">
        ${f.options.map((o) => `<option value="${o}" ${o === v ? 'selected' : ''}>${o}</option>`).join('')}
      </select>${help}</label>`;
  }
  return `<label class="field" for="${id}"><span>${f.label}${f.unit ? ` <em>${f.unit}</em>` : ''}</span>
    <input type="number" id="${id}" data-path="${f.path}" step="${f.step ?? 'any'}"
      value="${v === null || v === undefined || Number.isNaN(v) ? '' : v}">${help}</label>`;
}

function syncForm() {
  for (const f of allFields()) {
    const el = document.getElementById(`f_${f.path.replace(/\./g, '_')}`);
    if (!el) continue;
    const v = getPath(input, f.path);
    if (f.type === 'checkbox') el.checked = !!v;
    else el.value = v === null || v === undefined || Number.isNaN(v) ? '' : v;
  }
}

function recalc() {
  const out = design(input);
  const banner = document.getElementById('messages');
  if (!out.ok) {
    current = null;
    banner.innerHTML = `<div class="msg error"><strong>入力を確認してください</strong><ul>${
      out.errors.map((e) => `<li>${e}</li>`).join('')}</ul></div>`;
    document.getElementById('figure').innerHTML = '';
    document.getElementById('results').innerHTML = '';
    return;
  }
  current = out;
  banner.innerHTML = renderVerdict(out) + renderWarnings(out);
  renderFigure();
  document.getElementById('results').innerHTML = renderResults(out);
  document.getElementById('report').innerHTML = buildReport(out);
}

function renderVerdict(r) {
  const cls = r.verdict.overall ? 'ok' : 'ng';
  const text = r.verdict.overall ? '全ての照査を満足しています' : '満足しない照査項目があります';
  return `<div class="msg verdict ${cls}">
    <strong>総合判定: ${r.verdict.overall ? 'OK' : 'NG'}</strong>
    <span>${text}(断面照査の最大比率 ${num(r.verdict.maxRatio, 2)})</span></div>`;
}

function renderWarnings(r) {
  if (!r.warnings.length) return '';
  return `<div class="msg warn"><strong>確認事項</strong><ul>${
    r.warnings.map((w) => `<li>${w}</li>`).join('')}</ul></div>`;
}

const TABS = [
  ['section', '断面図'],
  ['load', '荷重図'],
  ['M', 'M図'],
  ['S', 'S図'],
  ['N', 'N図'],
  ['react', '底版反力'],
];

function renderFigure() {
  const host = document.getElementById('figure');
  if (!current) { host.innerHTML = ''; return; }
  const tabs = TABS.map(([k, l]) =>
    `<button class="tab ${k === activeTab ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('');
  let svg = '';
  if (activeTab === 'section') svg = sectionSVG(current);
  else if (activeTab === 'load') svg = loadSVG(current);
  else if (activeTab === 'react') svg = reactionSVG(current, 520, 300);
  else svg = diagramSVG(current, activeTab);
  host.innerHTML = `<div class="tabs">${tabs}</div><div class="figwrap">${svg}</div>`;
}

function renderResults(r) {
  const badge = (ok) => `<span class="badge ${ok ? 'ok' : 'ng'}">${ok ? 'OK' : 'NG'}</span>`;
  const cell = (c) => {
    const d = c.allow < 1 ? 3 : 2; // せん断応力度のように小さい値は桁を増やす
    return `<td class="${c.ok ? '' : 'bad'}">${num(c.value, d)} / ${num(c.allow, d)}<br><small>${num(c.ratio, 2)}</small></td>`;
  };

  const sections = `
  <h3>断面照査</h3>
  <div class="tablewrap"><table>
    <thead><tr>
      <th>照査断面</th><th>引張側</th><th>M<br><small>kN·m/m</small></th><th>S<br><small>kN/m</small></th>
      <th>配筋</th><th>σc / σca</th><th>σs / σsa</th><th>τm / τa1</th><th>判定</th>
    </tr></thead>
    <tbody>${r.sections.map((s) => `<tr>
      <td>${s.label}</td>
      <td>${s.tensionSide === 'inner' ? '内側' : '外側'}</td>
      <td>${num(s.M, 1)}</td><td>${num(Math.abs(s.S), 1)}</td>
      <td>${s.rebar ? s.rebar.label : '—'}</td>
      ${cell(s.check.checks.concrete)}${cell(s.check.checks.steel)}${cell(s.check.checks.shear)}
      <td>${badge(s.check.ok)}</td></tr>`).join('')}</tbody>
  </table></div>`;

  const plan = `
  <h3>配筋(主鉄筋)</h3>
  <div class="tablewrap"><table>
    <thead><tr><th>部材</th><th>面</th><th>設計 M<br><small>kN·m/m</small></th><th>必要 As<br><small>mm²/m</small></th>
      <th>最小 As</th><th>採用</th><th>配置 As</th><th>備考</th></tr></thead>
    <tbody>${r.rebarPlan.map((p) => `<tr>
      <td>${p.memberName}</td><td>${p.faceLabel}</td>
      <td>${num(p.M, 1)}</td><td>${num(p.asRequired, 0)}</td><td>${num(p.asMinimum, 0)}</td>
      <td>${p.selected ? p.selected.label : '<span class="bad">候補なし</span>'}</td>
      <td>${p.selected ? num(p.selected.As, 0) : '—'}</td>
      <td>${p.governedByMinimum ? '最小鉄筋量で決定' : ''}${p.sectionAdequate ? '' : ' 断面不足'}</td>
    </tr>`).join('')}</tbody>
  </table></div>
  <p class="note">配力鉄筋: 必要 ${num(r.distribution.required, 0)} mm²/m →
     ${r.distribution.selected ? r.distribution.selected.label : '—'}(主鉄筋の 1/3 以上)</p>`;

  const stability = `
  <h3>安定・基礎の検討</h3>
  <div class="tablewrap"><table>
    <thead><tr><th>照査項目</th><th>内容</th><th>判定</th></tr></thead>
    <tbody>${r.stability.items.map((i) => `<tr>
      <td>${i.label}</td><td>${i.text}</td><td>${badge(i.ok)}</td></tr>`).join('')}</tbody>
  </table></div>
  <p class="note">鉛直方向の釣合い検算: 載荷重 ${num(r.stability.balance.applied)} kN/m,
     底版反力 ${num(r.stability.balance.reaction)} kN/m(差 ${num(r.stability.balance.error, 6)})</p>`;

  const loadsInfo = `
  <h3>荷重の算定</h3>
  <div class="tablewrap"><table>
    <tbody>
      <tr><th>躯体自重</th><td>${num(r.loads.summary.selfWeight)} kN/m</td></tr>
      <tr><th>頂版上面の鉛直土圧</th><td>${num(r.loads.summary.earthTop)} kN/m²
        (α=${num(r.loads.summary.alpha)})</td></tr>
      <tr><th>活荷重による鉛直土圧</th><td>${num(r.loads.summary.live.q)} kN/m²
        (i=${num(r.loads.summary.live.impact, 3)}、分布 ${num(r.loads.summary.live.La)}×${num(r.loads.summary.live.Lb)} m)</td></tr>
      <tr><th>頂版の鉛直荷重</th><td>${num(r.loads.summary.qTop)} kN/m²</td></tr>
      <tr><th>側方土圧(上端 / 下端)</th><td>左 ${num(r.loads.summary.lateralTopLeft)} / ${num(r.loads.summary.lateralBottomLeft)} kN/m²、
        右 ${num(r.loads.summary.lateralTopRight)} / ${num(r.loads.summary.lateralBottomRight)} kN/m²</td></tr>
      <tr><th>底版下面の揚圧力</th><td>${num(r.loads.summary.uBottom)} kN/m²</td></tr>
      <tr><th>許容応力度</th><td>σca=${num(r.allow.sigmaCa)}、σsa=${num(r.allow.sigmaSa)}、
        τa1=${num(r.allow.tauA1, 3)} N/mm²</td></tr>
    </tbody>
  </table></div>`;

  return sections + plan + stability + loadsInfo;
}

function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wireActions() {
  document.getElementById('figure').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tab]');
    if (!t) return;
    activeTab = t.dataset.tab;
    renderFigure();
  });
  document.getElementById('btn-print').addEventListener('click', () => window.print());
  document.getElementById('btn-save').addEventListener('click', () => {
    download('box-culvert-input.json', JSON.stringify(input, null, 2));
  });
  document.getElementById('btn-load').addEventListener('click', () => {
    document.getElementById('file').click();
  });
  document.getElementById('file').addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      input = mergeInput(defaultInput(), JSON.parse(await f.text()));
      store(); syncForm(); recalc();
    } catch (e) {
      alert(`読み込みに失敗しました: ${e.message}`);
    }
    ev.target.value = '';
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    input = defaultInput();
    store(); syncForm(); recalc();
  });
}

export function start() {
  loadStored();
  buildForm();
  wireActions();
  recalc();
}

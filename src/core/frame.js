/**
 * 汎用2次元骨組ソルバ(直接剛性法)
 *
 * 座標系・符号の約束
 *  - 全体座標: x 右向き正、y 上向き正、モーメントは反時計回り正
 *  - 部材局所座標: 局所x は節点1→節点2 の向き、局所y はそれを90°反時計回りに回した向き
 *  - 部材端力 f = [f1x, f1y, m1, f2x, f2y, m2] は「節点が部材端に及ぼす力」(局所座標)
 *  - 断面力は次の定義で返す
 *      M(x) = m1 + f1y*x + ∫0^x wy(ξ)(x-ξ)dξ   (下側引張を正 = 一般的な曲げモーメント図の正)
 *      S(x) = dM/dx = f1y + ∫0^x wy(ξ)dξ
 *      N(x) = -(f1x + ∫0^x wx(ξ)dξ)             (引張を正)
 *    これより端部では M(0)=m1, S(0)=f1y, N(0)=-f1x / M(L)=-m2, S(L)=-f2y, N(L)=f2x
 *
 * 入力モデル
 *   nodes:    [{x, y}]
 *   elements: [{n1, n2, E, A, I}]                    E:kN/m2, A:m2, I:m4
 *   elementLoads: [{elem, wx1, wy1, wx2, wy2}]       全体座標の分布荷重(kN/m、部材長さ当り)
 *   nodalLoads:   [{node, fx, fy, mz}]               kN, kN・m
 *   supports:     [{node, dx, dy, rz}]               true で固定
 *   springs:      [{node, kx, ky, krz}]              kN/m, kN・m/rad
 */

/** 密行列のLU分解(部分ピボット選択)による連立一次方程式の求解 */
export function solveLinearSystem(Ain, bin) {
  const n = bin.length;
  const A = Ain.map((row) => Float64Array.from(row));
  const b = Float64Array.from(bin);
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;

  for (let k = 0; k < n; k++) {
    let max = Math.abs(A[k][k]);
    let pr = k;
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i][k]);
      if (v > max) { max = v; pr = i; }
    }
    if (max < 1e-12) {
      throw new Error(
        `剛性行列が特異です(自由度 ${k})。支点条件が不足しているか、構造が不安定です。`
      );
    }
    if (pr !== k) {
      const t = A[k]; A[k] = A[pr]; A[pr] = t;
      const tb = b[k]; b[k] = b[pr]; b[pr] = tb;
    }
    const akk = A[k][k];
    for (let i = k + 1; i < n; i++) {
      const m = A[i][k] / akk;
      if (m === 0) continue;
      A[i][k] = 0;
      for (let j = k + 1; j < n; j++) A[i][j] -= m * A[k][j];
      b[i] -= m * b[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return Array.from(x);
}

/** 部材の幾何量(長さ・方向余弦) */
function memberGeom(nodes, el) {
  const a = nodes[el.n1];
  const b = nodes[el.n2];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-12) throw new Error('部材長がゼロです');
  return { L, c: dx / L, s: dy / L };
}

/** 局所座標系の部材剛性行列(6x6) */
export function localStiffness(E, A, I, L) {
  const ea = (E * A) / L;
  const a1 = (12 * E * I) / L ** 3;
  const a2 = (6 * E * I) / L ** 2;
  const a3 = (4 * E * I) / L;
  const a4 = (2 * E * I) / L;
  return [
    [ea, 0, 0, -ea, 0, 0],
    [0, a1, a2, 0, -a1, a2],
    [0, a2, a3, 0, -a2, a4],
    [-ea, 0, 0, ea, 0, 0],
    [0, -a1, -a2, 0, a1, -a2],
    [0, a2, a4, 0, -a2, a3],
  ];
}

/** 局所→全体の変換行列(6x6) */
function transform(c, s) {
  return [
    [c, -s, 0, 0, 0, 0],
    [s, c, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 0, c, -s, 0],
    [0, 0, 0, s, c, 0],
    [0, 0, 0, 0, 0, 1],
  ];
}

/**
 * 台形分布荷重(局所座標)に対する等価節点力ベクトル Q(局所座標)
 * 部材に作用する荷重を節点荷重に置き換えたもの。部材端力は f = k*u - Q で求まる。
 */
export function consistentLoad(wx1, wy1, wx2, wy2, L) {
  // 軸方向
  const q1x = (L * (2 * wx1 + wx2)) / 6;
  const q2x = (L * (wx1 + 2 * wx2)) / 6;
  // 曲げ方向: 等分布成分 wy1 + 三角形成分 (wy2-wy1)
  const w = wy1;
  const d = wy2 - wy1;
  const q1y = (w * L) / 2 + (3 * d * L) / 20;
  const m1 = (w * L * L) / 12 + (d * L * L) / 30;
  const q2y = (w * L) / 2 + (7 * d * L) / 20;
  const m2 = -(w * L * L) / 12 - (d * L * L) / 20;
  return [q1x, q1y, m1, q2x, q2y, m2];
}

function matVec(M, v) {
  const n = M.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < v.length; j++) s += M[i][j] * v[j];
    out[i] = s;
  }
  return out;
}

function matTVec(M, v) {
  const cols = M[0].length;
  const out = new Array(cols).fill(0);
  for (let j = 0; j < cols; j++) {
    let s = 0;
    for (let i = 0; i < M.length; i++) s += M[i][j] * v[i];
    out[j] = s;
  }
  return out;
}

/**
 * 骨組を解く。
 * @returns {{
 *   disp: number[],                       // 全自由度変位 [u,v,θ] × 節点数
 *   reactions: {node:number,fx:number,fy:number,mz:number}[],  // 支点反力(構造に作用する力)
 *   springReactions: {node:number,fx:number,fy:number,mz:number}[], // バネ反力(同上)
 *   members: {elem:number, L:number, endForces:number[],
 *             N:[number,number], S:[number,number], M:[number,number]}[]
 * }}
 */
export function solveFrame(model) {
  const { nodes, elements } = model;
  const elementLoads = model.elementLoads || [];
  const nodalLoads = model.nodalLoads || [];
  const supports = model.supports || [];
  const springs = model.springs || [];

  const nn = nodes.length;
  const ndof = nn * 3;
  const K = Array.from({ length: ndof }, () => new Float64Array(ndof));
  const F = new Float64Array(ndof);

  // 部材ごとの局所荷重を集約(1部材に複数の荷重が載る場合に加算)
  const localLoads = elements.map(() => [0, 0, 0, 0]); // [wx1, wy1, wx2, wy2] 局所座標
  const geoms = elements.map((el) => memberGeom(nodes, el));

  for (const ld of elementLoads) {
    const { c, s } = geoms[ld.elem];
    const gx1 = ld.wx1 || 0, gy1 = ld.wy1 || 0;
    const gx2 = ld.wx2 === undefined ? gx1 : ld.wx2;
    const gy2 = ld.wy2 === undefined ? gy1 : ld.wy2;
    const t = localLoads[ld.elem];
    t[0] += gx1 * c + gy1 * s;
    t[1] += -gx1 * s + gy1 * c;
    t[2] += gx2 * c + gy2 * s;
    t[3] += -gx2 * s + gy2 * c;
  }

  const elemData = elements.map((el, i) => {
    const { L, c, s } = geoms[i];
    const kl = localStiffness(el.E, el.A, el.I, L);
    const T = transform(c, s);
    // kg = T * kl * T^T
    const klT = kl.map((row) => matVec(T, row)); // (kl * T^T) の各行
    const kg = [];
    for (let r = 0; r < 6; r++) {
      const row = new Array(6).fill(0);
      for (let cc = 0; cc < 6; cc++) {
        let sum = 0;
        for (let m = 0; m < 6; m++) sum += T[r][m] * klT[m][cc];
        row[cc] = sum;
      }
      kg.push(row);
    }
    const [wx1, wy1, wx2, wy2] = localLoads[i];
    const Ql = consistentLoad(wx1, wy1, wx2, wy2, L);
    const Qg = matVec(T, Ql);
    return { L, c, s, kl, T, kg, Ql, Qg, wx1, wy1, wx2, wy2 };
  });

  const dofsOf = (el) => [
    el.n1 * 3, el.n1 * 3 + 1, el.n1 * 3 + 2,
    el.n2 * 3, el.n2 * 3 + 1, el.n2 * 3 + 2,
  ];

  elements.forEach((el, i) => {
    const d = dofsOf(el);
    const { kg, Qg } = elemData[i];
    for (let r = 0; r < 6; r++) {
      F[d[r]] += Qg[r];
      for (let c2 = 0; c2 < 6; c2++) K[d[r]][d[c2]] += kg[r][c2];
    }
  });

  for (const nl of nodalLoads) {
    F[nl.node * 3] += nl.fx || 0;
    F[nl.node * 3 + 1] += nl.fy || 0;
    F[nl.node * 3 + 2] += nl.mz || 0;
  }

  for (const sp of springs) {
    K[sp.node * 3][sp.node * 3] += sp.kx || 0;
    K[sp.node * 3 + 1][sp.node * 3 + 1] += sp.ky || 0;
    K[sp.node * 3 + 2][sp.node * 3 + 2] += sp.krz || 0;
  }

  // 支点条件(大きな数を対角に足す方式ではなく、行列の縮約で厳密に処理)
  const fixed = new Uint8Array(ndof);
  for (const sup of supports) {
    if (sup.dx) fixed[sup.node * 3] = 1;
    if (sup.dy) fixed[sup.node * 3 + 1] = 1;
    if (sup.rz) fixed[sup.node * 3 + 2] = 1;
  }
  const free = [];
  for (let i = 0; i < ndof; i++) if (!fixed[i]) free.push(i);

  const Kr = free.map((i) => free.map((j) => K[i][j]));
  const Fr = free.map((i) => F[i]);
  const dr = solveLinearSystem(Kr, Fr);

  const disp = new Array(ndof).fill(0);
  free.forEach((dofIndex, k) => { disp[dofIndex] = dr[k]; });

  // 支点反力: R = K*D - F (拘束自由度のみ)
  const reactions = [];
  for (const sup of supports) {
    const r = { node: sup.node, fx: 0, fy: 0, mz: 0 };
    const comps = [['dx', 0, 'fx'], ['dy', 1, 'fy'], ['rz', 2, 'mz']];
    for (const [flag, off, key] of comps) {
      if (!sup[flag]) continue;
      const row = sup.node * 3 + off;
      let s = 0;
      for (let j = 0; j < ndof; j++) s += K[row][j] * disp[j];
      r[key] = s - F[row];
    }
    reactions.push(r);
  }

  // バネ反力(構造に作用する向き。上向き正)
  const springReactions = springs.map((sp) => ({
    node: sp.node,
    fx: -(sp.kx || 0) * disp[sp.node * 3],
    fy: -(sp.ky || 0) * disp[sp.node * 3 + 1],
    mz: -(sp.krz || 0) * disp[sp.node * 3 + 2],
  }));

  // 部材端力と断面力
  const members = elements.map((el, i) => {
    const d = dofsOf(el);
    const ug = d.map((k) => disp[k]);
    const ul = matTVec(elemData[i].T, ug); // T^T * ug
    const kl = elemData[i].kl;
    const Ql = elemData[i].Ql;
    const f = matVec(kl, ul).map((v, k) => v - Ql[k]);
    const L = elemData[i].L;
    return {
      elem: i,
      L,
      endForces: f,
      N: [-f[0], f[3]],
      S: [f[1], -f[4]],
      M: [-f[2], f[5]],
    };
  });

  return { disp, reactions, springReactions, members };
}

/**
 * 鉄筋の自動選定
 *
 * 呼び径 × 配置ピッチの組合せから、必要鉄筋量を満たす最小の鋼材量となる案を選ぶ。
 * あき(鉄筋間の純間隔)と最小鉄筋量の制約でふるいにかける。
 */

import { BAR_TABLE } from './units.js';

export const DEFAULT_BARS = ['D13', 'D16', 'D19', 'D22', 'D25', 'D29'];
export const DEFAULT_PITCHES = [125, 150, 200, 250];

/** 配筋 1 案の諸量(1m 当たり) */
export function arrangement(bar, pitch) {
  const t = BAR_TABLE[bar];
  if (!t) throw new Error(`未知の鉄筋径: ${bar}`);
  return {
    bar, pitch,
    dia: t.d,
    As: (t.area * 1000) / pitch, // mm2/m
    clear: pitch - t.d,          // あき mm
    label: `${bar} @${pitch}`,
  };
}

/**
 * 必要鉄筋量を満たす配筋案を鋼材量の少ない順に返す。
 * @param {number} asRequired 必要鉄筋量 mm2/m
 * @param {object} o { bars, pitches, minClear, maxPitchByThickness }
 */
export function selectRebar(asRequired, o = {}) {
  const bars = o.bars || DEFAULT_BARS;
  const pitches = o.pitches || DEFAULT_PITCHES;
  const minClear = o.minClear ?? 40;          // あきの最小値 mm(粗骨材寸法などから)
  const maxPitch = o.maxPitch ?? 250;

  const candidates = [];
  for (const bar of bars) {
    for (const pitch of pitches) {
      if (pitch > maxPitch) continue;
      const a = arrangement(bar, pitch);
      if (a.clear < minClear) continue;
      if (a.As < asRequired) continue;
      candidates.push({ ...a, surplus: a.As / asRequired });
    }
  }
  candidates.sort((p, q) => p.As - q.As || p.pitch - q.pitch);
  return candidates;
}

/** 配力鉄筋の目安(主鉄筋の 1/3 以上、かつ D13@250 以上) */
export function distributionRebar(mainAs, o = {}) {
  const need = Math.max(mainAs / 3, arrangement('D13', 250).As);
  const list = selectRebar(need, o);
  return { required: need, selected: list[0] || null };
}

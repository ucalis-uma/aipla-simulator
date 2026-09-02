/** data/stages/combo_advantage.json の1行（旧方式・互換のため残置） */
export interface ComboAdvantageRow {
  /** 閾値（コンボ数がこの値以上のとき適用） */
  combo: number;
  /** 合計係数 permil（1000 + ボーナス‰）。例: 1050 = +5% */
  advantagePermil: number;
}

/**
 * 既定テーブル（data/stages/combo_advantage.json と同期）。
 * 【2026-09-01 旧方式】B2 実測改訂に伴い実際の計算には使用しない（互換エクスポート）。
 */
export const COMBO_ADVANTAGE_TABLE: readonly ComboAdvantageRow[] = [
  { combo: 10, advantagePermil: 1050 },
  { combo: 20, advantagePermil: 1100 },
  { combo: 30, advantagePermil: 1150 },
  { combo: 40, advantagePermil: 1200 },
  { combo: 50, advantagePermil: 1250 },
  { combo: 70, advantagePermil: 1300 },
  { combo: 100, advantagePermil: 1500 },
];

/**
 * 【2026-09-01 旧方式】閾値テーブルによる基本ボーナス（増分‰）。
 * 実測改訂後も indexComboBonusTable は古いテーブルを参照するため、本関数は互換のため残置。
 */
export function baseComboBonusPermil(
  combo: number,
  table: readonly ComboAdvantageRow[] = COMBO_ADVANTAGE_TABLE,
): number {
  if (!Number.isInteger(combo) || combo < 0) {
    throw new Error(`combo must be a non-negative integer, got ${combo}`);
  }
  let bonus = 0;
  for (const row of table) {
    if (combo >= row.combo) {
      bonus = row.advantagePermil - 1000;
    } else {
      break;
    }
  }
  return bonus;
}

/**
 * コンボファクター（B2）。
 *
 * 【2026-09-01 確定】やるキ士 docs「コンボのボーナス」gid=0 が一次資料。
 *   B2 = 1000 + コンボ範囲テーブル(‰) × (1000 + 100×csu) / 1000
 *   （docs 原文: 「コンボスコア上昇効果がある場合、このスコアボーナスが上昇する。
 *     1段階で+10%増えて、最大20段階で3倍」。Table: 0-9:+0% / 10-19:+5% / 20-29:+10% /
 *     30-39:+15% / 40-49:+20% / 50-69:+25% / 70-99:+30% / 100+:+50%）
 *
 * 実測照合（全て一致）:
 * - T5 A 星見プロ b69（combo 69 → 50-69 行 25%、csu 19 段 → ×2.9）: 1250×2900/1000 = 3625‰…❌
 *   —— いや、旧式。**訂正**（IMG_1512 実測ノート）: 100＋25×(100＋10×19)/100 = 172.5% → 1725‰。
 *   → 注: docs の「+10%/段（乗算）」表記と実測ノートの「25%×(100+10×csu)/100」は
 *   combo 50-69 の 25% 行で同値（25%×2.9 = 72.5%）。docs のテーブルは
 *   「+10%/段 → (100+10×csu)/100 の増分」をボーナス分に乗算する形式（= 実測ノート同値）。
 * - SP 成宮すず（CJPH5507・combo 124 → 100+行 50%、csu 19 → ×2.9）: 100＋50×2.9 = 245% ✓
 * - 簡易検証（b115・combo 50/51 → 50-69 行 25%・csu 0）: 100＋25×1 = 125% = 1250‰ ✓（r=0.9475）
 *
 * @param combo ビート前の表示コンボ（0 以上の整数）
 * @param csu コンボスコア上昇効果の段数（0 以上の整数）
 */
export function comboFactorPermil(combo: number, csu: number): number {
  if (!Number.isInteger(combo) || combo < 0) {
    throw new Error(`combo must be a non-negative integer, got ${combo}`);
  }
  if (!Number.isInteger(csu) || csu < 0) {
    throw new Error(`csu must be a non-negative integer, got ${csu}`);
  }
  const base = baseComboBonusPermil(combo);
  // docs: 「コンボスコア上昇はスコアボーナス（増分）を上昇させる」（100%行には掛けない）
  // B2 = 1000 + base×(1000+100×csu)/1000
  return 1000 + Math.trunc((base * (1000 + 100 * csu)) / 1000);
}

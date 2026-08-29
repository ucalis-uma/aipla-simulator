/**
 * コンボボーナス（B2）。
 *
 * 出典:
 * - テーブル本体: data/stages/combo_advantage.json（マスタ ComboAdvantage.json・全7行）。
 *   research/07_master_lookup.md §3【確度: Confirmed】。
 *   適用規則: 「コンボ数が行の閾値以上のとき適用」（コンボ 155 → 閾値100行 → 1,500‰ = +50.0%）。
 *   F1 マスタ照合で実測のコンボ155=+50%と確認（PLAN.md 附録 F1）。境界（0始まり/1始まり）の
 *   ±1曖昧さはこの「以上」解釈で解決（PLAN.md §5-3）。
 * - 係数式: PLAN.md §3.3「(1+基本ボーナス)に(1+10%×段)を乗算」/ research/02 §1.7。
 *   確度: Confirmed。ただし表記対立あり → comboFactorPermil の JSDoc と
 *   tests/unit/formula/combo.test.ts の記録コメントを参照（ゴールデン段階で最終判定）。
 *
 * データファイルの advantagePermil は「合計係数（1000 + ボーナス‰）」を格納する。
 * 本モジュールの baseComboBonusPermil は「ボーナス増分（0〜500‰）」を返す。
 */
import { mulPermil } from "../rounding.js";

/** data/stages/combo_advantage.json の1行 */
export interface ComboAdvantageRow {
  /** 閾値（コンボ数がこの値以上のとき適用） */
  combo: number;
  /** 合計係数 permil（1000 + ボーナス‰）。例: 1050 = +5% */
  advantagePermil: number;
}

/**
 * 既定テーブル（data/stages/combo_advantage.json と同期）。
 * 同期は tests/unit/formula/combo.test.ts の照合テストで担保する（単一ソースはデータファイル）。
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
 * コンボ数に対する基本コンボボーナス（増分‰）。
 *
 * 期待値（data/stages/combo_advantage.json 由来・Confirmed）:
 *   0-9→0, 10-19→50, 20-29→100, 30-39→150, 40-49→200,
 *   50-69→250, 70-99→300, 100+→500
 *
 * @param combo ビート前のコンボ数（0 以上の整数）
 * @param table 閾値テーブル（昇順）。省略時は COMBO_ADVANTAGE_TABLE
 * @returns ボーナス増分 permil（0〜500）
 */
export function baseComboBonusPermil(
  combo: number,
  table: readonly ComboAdvantageRow[] = COMBO_ADVANTAGE_TABLE,
): number {
  if (!Number.isInteger(combo) || combo < 0) {
    throw new Error(`combo must be a non-negative integer, got ${combo}`);
  }
  if (table.length === 0) {
    throw new Error("combo advantage table is empty");
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
 * コンボファクター（コンボボーナス × コンボスコア上昇バフ）。
 *
 *   factor = (1000 + 基本ボーナス) × (1000 + 100 × 段) / 1000  （切り捨て）
 *
 * 【表記対立の記録（ゴールデン段階で判定すること）】
 * - (A) 本実装 = PLAN.md §3.3 / research/02 §1.7: factor = (1+base)×(1+0.1×段)。
 *   research/02 §3.3 の Aスキル検算（ビート156・コンボ155）は「×6.0(1.5×(1+30段×10%))」
 *   で、本式に 30段 を入れた値と一致し、乱数 r=97.7% が ±5% 内に収まる。
 * - (B) research/01 §3.4 の例記述「+50%×3=+150%」: ボーナス増分だけに乗算する説
 *   （factor = 1 + base×(1+0.1×段)）。コンボ155・30段 なら ×3.0。
 *   この説だとビート156 の乱数が r≈0.49 となり ±5% から大きく外れるため非有力。
 * - (C) ×10.0（= (1+1.5)×(1+3.0)）: テーブルの合計係数 1500‰ を「ボーナス」と
 *   誤認して二重加算した場合の値で、式として不整合（却下）。
 *   ×7.5（=(1+1.5)×(1+2.0)）も同様の二重加算による値。
 * - research/01 §3.4 の [T1]「20段で2.5倍」と [S1]「20段=3倍係数」の対立は
 *   research/01 内で「[S1] の数値表を正とする」と結論済み（§3.4・§5-7）。
 *
 * @param combo ビート前のコンボ数（0 以上の整数）
 * @param comboScoreUpStages コンボスコア上昇バフの段数（0 以上の整数。
 *   基本上限20、LimitBreakComboScoreUp(86) で解放・実測30段階を観測。
 *   それ以上の厳密上限は Unknown。クランプは呼び出し側（エンジン）の責務）
 * @param table 閾値テーブル（昇順）。省略時は COMBO_ADVANTAGE_TABLE
 * @returns コンボファクター permil（1000 = ×1.0）
 */
export function comboFactorPermil(
  combo: number,
  comboScoreUpStages: number,
  table: readonly ComboAdvantageRow[] = COMBO_ADVANTAGE_TABLE,
): number {
  if (!Number.isInteger(comboScoreUpStages) || comboScoreUpStages < 0) {
    throw new Error(
      `comboScoreUpStages must be a non-negative integer, got ${comboScoreUpStages}`,
    );
  }
  const base = baseComboBonusPermil(combo, table);
  return mulPermil(1000 + base, 1000 + 100 * comboScoreUpStages);
}

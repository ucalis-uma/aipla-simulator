/**
 * 来場ファンボーナス（B3）。
 *
 * 出典:
 * - テーブル本体: data/stages/audience_advantage.json（マスタ QuestAudienceAdvantage.json・
 *   1000行・audience 昇順・advantagePermil は累積係数 1000+ボーナス‰）。
 * - research/02 §1.8【確度: Confirmed】: 実測「会場容量 80,000人 / +62.0%」に対し、
 *   個人割当 16,000人（容量÷5 が上限）→ 1620‰ = +62.0% が完全一致。
 * - 個人来場ファン数そのものの算出式は Unknown（S1 と S2 が矛盾し S2 自身が否定）。
 *   実装ではゲーム表示の来場者数（または容量÷5）→ 本テーブル引きで代替する。
 *
 * テーブルは audience 昇順・advantagePermil 非減少を前提とする
 * （data-integrity T0 の単調性検査で担保。本関数は検証を省略して O(log n) を守る）。
 */

/** data/stages/audience_advantage.json の1行 */
export interface AudienceAdvantageRow {
  /** 来場ファン数（この値以上の最小の行まで適用） */
  audience: number;
  /** 累積係数 permil（1000 + ボーナス‰）。例: 1620 = +62.0% */
  advantagePermil: number;
}

/**
 * 個人来場ファン数に対するファンファクターを二分探索で取得する。
 *
 * 挙動:
 * - audience 以下の最大の行の advantagePermil（累積係数）を返す。
 * - 最小行（audience=10）未満（0〜9人）は 1000（ボーナス0%）を返す。
 *   【Estimate】テーブル最小行未満の挙動は実測がなく未確定（10人未満はボーナスなしと解釈）。
 * - 最大行（audience=50,000）超過は最大行にクランプする。
 *   【Estimate】表上限超過の実挙動は未観測（容量÷5 の上限機構が実データでは先に効く）。
 *
 * @param audience 個人来場ファン数（0 以上の整数）
 * @param table audience 昇順のテーブル（data/stages/audience_advantage.json を注入）
 * @returns ファンファクター permil（1000 = ×1.0）。例: 16000 → 1620
 */
export function fanBonusPermil(
  audience: number,
  table: readonly AudienceAdvantageRow[],
): number {
  if (!Number.isInteger(audience) || audience < 0) {
    throw new Error(`audience must be a non-negative integer, got ${audience}`);
  }
  if (table.length === 0) {
    throw new Error("audience advantage table is empty");
  }
  // 二分探索: audience 以下の最大の行のインデックス（見つからなければ -1）
  let lo = 0;
  let hi = table.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = table[mid];
    if (row === undefined) {
      throw new Error("audience advantage table access out of range");
    }
    if (row.audience <= audience) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) {
    return 1000;
  }
  const row = table[found];
  if (row === undefined) {
    throw new Error("audience advantage table access out of range");
  }
  return row.advantagePermil;
}

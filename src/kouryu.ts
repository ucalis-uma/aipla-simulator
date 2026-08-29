/**
 * 交流Lv（アイドル単位・上限60）のステータス上昇テーブル。
 *
 * 出典: prompt_plan.md「既知の交流Lv仕様」（ユーザー提供）
 * 検証: 実測5レーン（交流Lv 28/22/51/25/22）の基礎ステータス20/20項目が
 *       1の位まで一致（PLAN.md §3.1 / PM検証ログ）。
 * 確度: Confirmed
 *
 * - Lv.1 は補正なし（0%）
 * - Lv.2〜60 の各レベルで下記59個の値が順に1つずつ上昇する（単位 %）
 * - 計算上は「デッキ値式の%加算プール」に入る（乗算ではない）
 */

export const KOURYU_LEVEL_MAX = 60;

/** Lv.2〜60 の順に適用される59個の上昇値（%）。6値1組 = Vo, Da, Vi, Sta, Cri, Men */
export const KOURYU_INCREMENTS_PCT: readonly number[] = [
  2, 2, 2, 6, 5, 5,
  2, 2, 4, 3, 5, 5,
  2, 4, 2, 3, 5, 5,
  4, 2, 2, 3, 5, 10,
  2, 2, 2, 3, 10, 5,
  2, 2, 2, 6, 5, 5,
  2, 2, 4, 3, 5, 5,
  2, 4, 4, 6, 10, 10,
  4, 4, 4, 6, 10, 10,
  4, 4, 4, 6, 10,
] as const;

export interface KouryuBonusPct {
  vocal: number;
  dance: number;
  visual: number;
  stamina: number;
  mental: number;
  critical: number;
}

/** 交流Lvごとの累積上昇（%）。Lv1 = 全0。Lv60: Vo+26/Da+28/Vi+30/Sta+45/Cri+70/Men+60 */
export function kouryuCumulativePct(level: number): KouryuBonusPct {
  if (!Number.isInteger(level) || level < 1 || level > KOURYU_LEVEL_MAX) {
    throw new Error(`kouryu level out of range: ${level}`);
  }
  const applied = level - 1;
  const bonus: KouryuBonusPct = { vocal: 0, dance: 0, visual: 0, stamina: 0, mental: 0, critical: 0 };
  const keys = ["vocal", "dance", "visual", "stamina", "critical", "mental"] as const;
  for (let i = 0; i < applied; i++) {
    const key = keys[i % 6];
    const inc = KOURYU_INCREMENTS_PCT[i];
    if (key === undefined || inc === undefined) {
      throw new Error(`kouryu table out of sync at index ${i}`);
    }
    bonus[key] += inc;
  }
  return bonus;
}

/** 交流Lvの累積%を permil へ変換 */
export function kouryuCumulativePermil(level: number): KouryuBonusPct {
  const pct = kouryuCumulativePct(level);
  return {
    vocal: pct.vocal * 10,
    dance: pct.dance * 10,
    visual: pct.visual * 10,
    stamina: pct.stamina * 10,
    mental: pct.mental * 10,
    critical: pct.critical * 10,
  };
}

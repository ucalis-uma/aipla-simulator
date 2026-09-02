/**
 * コンボファクター（B2）の単体テスト。
 *
 * 【2026-09-01 確定】やるキ士 docs「コンボのボーナス」gid=0（一次資料）:
 *   B2 = 1000 + テーブル(‰) × (1000＋100×csu)/1000
 *   テーブル: 0-9:+0% / 10-19:+5% / 20-29:+10% / 30-39:+15% / 40-49:+20% /
 *             50-69:+25% / 70-99:+30% / 100+:+50%
 *   （docs: 「コンボスコア上昇効果がある場合、このスコアボーナスが上昇します。
 *     1段階で+10%増えて、最大20段階で3倍」＝ 増分へ乗算）
 *
 * 実測照合:
 * - T5 A 星見プロ b69（combo 69→50-69 行 25%、csu 19→×2.9）: 250‰×2.9 = 725 → 1725‰
 *   （IMG_1512 実測ノートと一致。実測 219M = 215,861,327×r ✓）
 * - SP 成宮すず（CJPH5507・combo 124→100+ 行 50%、csu 19）: 500×2.9 = 1450 → 2450‰ ✓
 * - 簡易検証（b115・combo 50/51→25%、csu 0）: 250‰ → 1250‰ ✓（r=0.9475）
 */
import { describe, expect, it } from "vitest";
import { comboFactorPermil } from "../../../src/formula/combo.js";

describe("comboFactorPermil（コンボファクター・2026-09-01 docs 確定式）", () => {
  it("combo=69, csu=19 → 1725（T5 実測メモ・星見プロ b69）", () => {
    expect(comboFactorPermil(69, 19)).toBe(1725);
  });

  it("combo=124, csu=19 → 2450（CJPH5507・SP 実測 245%＝2450‰）", () => {
    expect(comboFactorPermil(124, 19)).toBe(2450);
  });

  it("combo=50, csu=0 → 1250（簡易検証・ハイスコア1 b115）", () => {
    expect(comboFactorPermil(50, 0)).toBe(1250);
  });

  it("combo=0, csu=0 → 1000", () => {
    expect(comboFactorPermil(0, 0)).toBe(1000);
  });

  it("combo=100+, csu=20 → 2500（docs 表の +20 段階行 = 100+150%）", () => {
    expect(comboFactorPermil(150, 20)).toBe(2500);
  });

  it.each([[-1], [1.5], [NaN]])("不正な combo=%j は throw", (combo) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => comboFactorPermil(combo as any, 0)).toThrow();
  });
});

/**
 * critical.ts 単体テスト。
 *
 * 出典: research/02 §1.9【Confirmed】
 *   発生時 = 150% + 係数上昇段×5% + エール/フォト クリスコ%（加算）。非発生時 100%。
 *   発生確率（率）の式は Unknown（ScoreRng 側の責務）。
 */
import { describe, expect, it } from "vitest";
import {
  CRITICAL_BASE_PERMIL,
  criticalFactorPermil,
} from "../../../src/formula/critical.js";

describe("criticalFactorPermil", () => {
  it("stages=0, extras=0 → 1500（基本 150%）", () => {
    expect(criticalFactorPermil()).toBe(1500);
    expect(criticalFactorPermil(0, 0)).toBe(1500);
  });

  it("stages=20, extras=255 → 2755（実測エール クリスコ+25.5% + 係数上昇20段）", () => {
    expect(criticalFactorPermil(255, 20)).toBe(2755);
  });

  it("extras のみ → 1755", () => {
    expect(criticalFactorPermil(255, 0)).toBe(1755);
  });

  it("stages のみ（10段）→ 2000", () => {
    expect(criticalFactorPermil(0, 10)).toBe(2000);
  });

  it("上限解放で30段（LimitBreakCriticalBonusPermilUp・research/02 §1.9）→ 3000", () => {
    expect(criticalFactorPermil(0, 30)).toBe(3000);
  });

  it("基本定数は 1500（= 1000 + 500）", () => {
    expect(CRITICAL_BASE_PERMIL).toBe(1500);
  });

  it.each([
    [-1, 0],
    [1.5, 0],
    [0, -1],
    [0, 2.5],
  ])("不正な入力 (extras=%j, stages=%j) は throw", (extras, stages) => {
    expect(() => criticalFactorPermil(extras, stages)).toThrow();
  });
});

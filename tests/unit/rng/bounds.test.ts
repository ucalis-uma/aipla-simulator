/**
 * bounds.ts（MinRng / MaxRng）単体テスト。
 *
 * research/06_test_plan.md Mode D（min ≤ 実測 ≤ max のレンジ照合用）。
 */
import { describe, expect, it } from "vitest";
import { MaxRng, MinRng } from "../../../src/rng/bounds.js";

describe("MinRng", () => {
  it("常に 950（−5%）を返す", () => {
    const rng = new MinRng();
    for (let i = 0; i < 1000; i++) {
      expect(rng.nextScoreRoll()).toBe(950);
    }
  });

  it("常に非クリティカルを返す", () => {
    const rng = new MinRng();
    for (let i = 0; i < 1000; i++) {
      expect(rng.nextCritical()).toBe(false);
    }
  });
});

describe("MaxRng", () => {
  it("常に 1050（+5%）を返す", () => {
    const rng = new MaxRng();
    for (let i = 0; i < 1000; i++) {
      expect(rng.nextScoreRoll()).toBe(1050);
    }
  });

  it("常にクリティカルを返す", () => {
    const rng = new MaxRng();
    for (let i = 0; i < 1000; i++) {
      expect(rng.nextCritical()).toBe(true);
    }
  });
});

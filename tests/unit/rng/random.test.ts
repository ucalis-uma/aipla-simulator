/**
 * ContinuousRng（連続値スコア乱数・Phase 4 モンテカルロ用）と
 * NeutralRng（確定値ラン用）の単体テスト。
 */
import { describe, expect, it } from "vitest";
import { ContinuousRng } from "../../../src/rng/random.js";
import { NeutralRng } from "../../../src/rng/neutral.js";
import { SCORE_ROLL_MIN_PERMIL, SCORE_ROLL_MAX_PERMIL } from "../../../src/rng/types.js";

describe("ContinuousRng", () => {
  it("同一シードは同一系列を返す（決定論）", () => {
    const a = new ContinuousRng(42);
    const b = new ContinuousRng(42);
    const seqA = Array.from({ length: 32 }, () => a.nextScoreRoll());
    const seqB = Array.from({ length: 32 }, () => b.nextScoreRoll());
    expect(seqA).toEqual(seqB);
  });

  it("異なるシードは異なる系列を返す", () => {
    const a = new ContinuousRng(1);
    const b = new ContinuousRng(2);
    const seqA = Array.from({ length: 16 }, () => a.nextScoreRoll());
    const seqB = Array.from({ length: 16 }, () => b.nextScoreRoll());
    expect(seqA).not.toEqual(seqB);
  });

  it("全ロールが [950, 1050] に収まる", () => {
    const rng = new ContinuousRng(7);
    for (let i = 0; i < 10000; i++) {
      const r = rng.nextScoreRoll();
      expect(r).toBeGreaterThanOrEqual(SCORE_ROLL_MIN_PERMIL);
      expect(r).toBeLessThanOrEqual(SCORE_ROLL_MAX_PERMIL);
    }
  });

  it("連続値（非整数）を発生させる（T5確定仕様）", () => {
    const rng = new ContinuousRng(123);
    const rolls = Array.from({ length: 1000 }, () => rng.nextScoreRoll());
    const nonInteger = rolls.filter((r) => !Number.isInteger(r)).length;
    // 整数値の発生確率は 0（u32/2^32×100 が整数になる測度はゼロ）
    expect(nonInteger).toBe(1000);
  });

  it("一様性: 平均が区間中央付近（±2 permil）に収まる", () => {
    const rng = new ContinuousRng(2026);
    const n = 50000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += rng.nextScoreRoll();
    }
    const mean = sum / n;
    expect(Math.abs(mean - 1000)).toBeLessThan(2);
  });

  it("critProbability=0 ではクリティカル不発生", () => {
    const rng = new ContinuousRng(5);
    for (let i = 0; i < 1000; i++) {
      expect(rng.nextCritical()).toBe(false);
    }
  });

  it("critProbability=1 では常時クリティカル", () => {
    const rng = new ContinuousRng(5, 1);
    for (let i = 0; i < 1000; i++) {
      expect(rng.nextCritical()).toBe(true);
    }
  });

  it("critProbability=0.5 で発生率が約 50%", () => {
    const rng = new ContinuousRng(11, 0.5);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      if (rng.nextCritical()) hits++;
    }
    expect(Math.abs(hits / n - 0.5)).toBeLessThan(0.02);
  });

  it("非整数シード・範囲外 critProbability はエラー", () => {
    expect(() => new ContinuousRng(1.5)).toThrow();
    expect(() => new ContinuousRng(1, -0.1)).toThrow();
    expect(() => new ContinuousRng(1, 1.1)).toThrow();
  });

  it("nextFloat は [0, 1) の一様実数（動的クリティカル抽選用）", () => {
    const rng = new ContinuousRng(9);
    const n = 20000;
    let sum = 0;
    let inRange = 0;
    for (let i = 0; i < n; i++) {
      const f = rng.nextFloat();
      if (f >= 0 && f < 1) inRange++;
      sum += f;
    }
    expect(inRange).toBe(n);
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.01);
  });

  it("nextFloat は同一シードで決定論的", () => {
    const a = new ContinuousRng(77);
    const b = new ContinuousRng(77);
    const seqA = Array.from({ length: 16 }, () => a.nextFloat());
    const seqB = Array.from({ length: 16 }, () => b.nextFloat());
    expect(seqA).toEqual(seqB);
  });

  it("nextFloat で 50% しきい値抽選が約 50% 成立する", () => {
    const rng = new ContinuousRng(31);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      if (rng.nextFloat() < 0.5) hits++;
    }
    expect(Math.abs(hits / n - 0.5)).toBeLessThan(0.02);
  });
});

describe("NeutralRng", () => {
  it("スコア乱数は常に 1000", () => {
    const rng = new NeutralRng();
    for (let i = 0; i < 100; i++) {
      expect(rng.nextScoreRoll()).toBe(1000);
    }
  });

  it("nextCritical は常に true（確率ゲート必通過用。クリティカル係数は criticalProvider 側で無効化）", () => {
    const rng = new NeutralRng();
    for (let i = 0; i < 100; i++) {
      expect(rng.nextCritical()).toBe(true);
    }
  });
});

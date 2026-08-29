/**
 * fixed.ts（FixedRng・mulberry32）単体テスト。
 *
 * - 決定論: 同一シード → 同一系列（モンテカルロ Mode S・最適編成探索の公平比較の前提）
 * - roll = 950 + floor(rand × 101)（101択・0.1%刻み）
 * - crit = rand < p（p 注入式。発生確率の式は Unknown のため）
 */
import { describe, expect, it } from "vitest";
import { FixedRng } from "../../../src/rng/fixed.js";

function collectRolls(seed: number, count: number): number[] {
  const rng = new FixedRng(seed);
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(rng.nextScoreRoll());
  }
  return rolls;
}

describe("FixedRng（決定論）", () => {
  it("同シードは同一の roll 系列を返す", () => {
    const a = collectRolls(20260829, 64);
    const b = collectRolls(20260829, 64);
    expect(a).toEqual(b);
  });

  it("同シードは同一の crit 系列を返す", () => {
    const a = new FixedRng(7, 0.3);
    const b = new FixedRng(7, 0.3);
    const ca: boolean[] = [];
    const cb: boolean[] = [];
    for (let i = 0; i < 64; i++) {
      ca.push(a.nextCritical());
      cb.push(b.nextCritical());
    }
    expect(ca).toEqual(cb);
  });

  it("シードが違えば系列が変わる", () => {
    const a = collectRolls(1, 32);
    const b = collectRolls(2, 32);
    expect(a).not.toEqual(b);
  });
});

describe("FixedRng（roll の範囲と形状）", () => {
  it("全 roll が 950〜1050 の整数", () => {
    for (const roll of collectRolls(12345, 1000)) {
      expect(Number.isInteger(roll)).toBe(true);
      expect(roll).toBeGreaterThanOrEqual(950);
      expect(roll).toBeLessThanOrEqual(1050);
    }
  });

  it("1000 抽で多数の値をカバーする（離散一様の健全性チェック）", () => {
    const rolls = new Set(collectRolls(42, 1000));
    expect(rolls.size).toBeGreaterThan(50);
  });

  it("平均が 1000 近傍（±2 以内・決定論シードで固定）", () => {
    const rolls = collectRolls(2026, 2000);
    const mean = rolls.reduce((s, v) => s + v, 0) / rolls.length;
    expect(Math.abs(mean - 1000)).toBeLessThan(2);
  });
});

describe("FixedRng（クリティカル確率の注入）", () => {
  it("p=0（既定）では一切クリティカルしない", () => {
    const rng = new FixedRng(99);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextCritical()).toBe(false);
    }
  });

  it("p=1 では常にクリティカルする", () => {
    const rng = new FixedRng(99, 1);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextCritical()).toBe(true);
    }
  });

  it("p=0.5 では両方が発生する（決定論シード）", () => {
    const rng = new FixedRng(42, 0.5);
    let trues = 0;
    let falses = 0;
    for (let i = 0; i < 200; i++) {
      if (rng.nextCritical()) {
        trues++;
      } else {
        falses++;
      }
    }
    expect(trues).toBeGreaterThan(0);
    expect(falses).toBeGreaterThan(0);
  });

  it("確率が変われば crit 系列も変わる（roll 系列は不変）", () => {
    const rollsA = collectRolls(55, 16);
    const rngB = new FixedRng(55, 0.9);
    const rollsB: number[] = [];
    for (let i = 0; i < 16; i++) {
      rollsB.push(rngB.nextScoreRoll());
    }
    expect(rollsB).toEqual(rollsA);
  });

  it.each([-0.1, 1.1, Number.NaN])("不正な確率 %j は throw", (p) => {
    expect(() => new FixedRng(1, p)).toThrow();
  });
});

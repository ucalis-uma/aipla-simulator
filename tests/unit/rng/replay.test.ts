/**
 * replay.ts（ReplayRng）単体テスト。
 *
 * research/06_test_plan.md Mode R（実測系列注入・累積完全照合の要）。
 */
import { describe, expect, it } from "vitest";
import { ReplayRng } from "../../../src/rng/replay.js";

describe("ReplayRng（消費順）", () => {
  it("rolls / crits を独立した列として先頭から順に消費する", () => {
    const rng = new ReplayRng([950, 1000, 1050], [true, false]);
    expect(rng.nextScoreRoll()).toBe(950);
    expect(rng.nextCritical()).toBe(true);
    expect(rng.nextScoreRoll()).toBe(1000);
    expect(rng.nextCritical()).toBe(false);
    expect(rng.nextScoreRoll()).toBe(1050);
  });

  it("roll と crit の消費回数は互いに独立", () => {
    const rng = new ReplayRng([1000, 1001, 1002], [true]);
    expect(rng.nextCritical()).toBe(true);
    expect(rng.nextScoreRoll()).toBe(1000);
    expect(rng.nextScoreRoll()).toBe(1001);
  });
});

describe("ReplayRng（枯渇エラー）", () => {
  it("rolls 枯渇で throw", () => {
    const rng = new ReplayRng([1000], []);
    rng.nextScoreRoll();
    expect(() => rng.nextScoreRoll()).toThrow(/exhausted/);
  });

  it("crits 枯渇で throw", () => {
    const rng = new ReplayRng([], [false]);
    rng.nextCritical();
    expect(() => rng.nextCritical()).toThrow(/exhausted/);
  });
});

describe("ReplayRng（コンストラクタ検証・fail-closed）", () => {
  it.each([949, 1051, 999.5])("範囲外の roll %j で throw", (roll) => {
    expect(() => new ReplayRng([roll], [])).toThrow();
  });

  it.each([0.5, 1, 949.9])("crits に boolean 以外 (%j) が混入したら throw", (crit) => {
    expect(() => new ReplayRng([], [crit as unknown as boolean])).toThrow();
  });

  it("境界値 950 / 1050 は許容される", () => {
    const rng = new ReplayRng([950, 1050], []);
    expect(rng.nextScoreRoll()).toBe(950);
    expect(rng.nextScoreRoll()).toBe(1050);
  });
});

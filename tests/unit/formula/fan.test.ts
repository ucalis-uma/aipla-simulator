/**
 * fan.ts 単体テスト。
 *
 * 出典: research/02 §1.8（16,000人 → +62.0% が実測完全一致・Confirmed）、
 *       data/stages/audience_advantage.json（マスタ QuestAudienceAdvantage.json・1000行）。
 */
import { describe, expect, it } from "vitest";
import {
  fanBonusPermil,
  type AudienceAdvantageRow,
} from "../../../src/formula/fan.js";
import { readUnitJson } from "../helpers.js";

const table = readUnitJson<AudienceAdvantageRow[]>("data/stages/audience_advantage.json");

/** 線形探索の参照実装（二分探索の正答照合用） */
function fanBonusReference(audience: number, rows: readonly AudienceAdvantageRow[]): number {
  let result = 1000;
  for (const row of rows) {
    if (row.audience <= audience) {
      result = row.advantagePermil;
    } else {
      break;
    }
  }
  return result;
}

describe("fanBonusPermil（ファンファクター・実データ）", () => {
  it("テーブルは1000行・audience 昇順・advantagePermil 非減少", () => {
    expect(table).toHaveLength(1000);
    for (let i = 1; i < table.length; i++) {
      const prev = table[i - 1];
      const row = table[i];
      expect(prev).toBeDefined();
      expect(row).toBeDefined();
      expect(row!.audience).toBeGreaterThan(prev!.audience);
      expect(row!.advantagePermil).toBeGreaterThanOrEqual(prev!.advantagePermil);
    }
  });

  it.each([
    [0, 1000], // 表未満は +0%（Estimate: 実測未観測）
    [1, 1000],
    [9, 1000],
    [10, 1001],
    [20, 1002],
    [1000, 1100],
    [1001, 1100],
    [5000, 1300],
    [9800, 1420],
    [10000, 1500],
    [16000, 1620], // 実測検証点: 容量80,000÷5 → +62.0%（Confirmed）
    [16001, 1620],
    [20000, 1700],
    [25000, 1750],
    [50000, 2000], // 表上限
    [50001, 2000], // 上端クランプ（Estimate）
  ])("audience=%i → %i‰", (audience, expected) => {
    expect(fanBonusPermil(audience, table)).toBe(expected);
  });

  it("16,000人 → 1620‰ = +62.0%（research/02 §1.8 の実測一致点）", () => {
    expect(fanBonusPermil(16000, table)).toBe(1620);
  });

  it("二分探索が線形探索の参照実装と一致（代表区間の全点）", () => {
    for (let a = 0; a <= 3000; a++) {
      expect(fanBonusPermil(a, table)).toBe(fanBonusReference(a, table));
    }
    for (let a = 15000; a <= 16500; a++) {
      expect(fanBonusPermil(a, table)).toBe(fanBonusReference(a, table));
    }
  });

  it("0〜50,000人で単調非減少・範囲 [1000, 2000]", () => {
    let prev = -1;
    for (let a = 0; a <= 50000; a += 37) {
      const v = fanBonusPermil(a, table);
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(2000);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("テーブル注入が効く（小規模テーブル）", () => {
    const custom: AudienceAdvantageRow[] = [
      { audience: 100, advantagePermil: 1010 },
      { audience: 200, advantagePermil: 1020 },
    ];
    expect(fanBonusPermil(0, custom)).toBe(1000);
    expect(fanBonusPermil(99, custom)).toBe(1000);
    expect(fanBonusPermil(100, custom)).toBe(1010);
    expect(fanBonusPermil(199, custom)).toBe(1010);
    expect(fanBonusPermil(200, custom)).toBe(1020);
    expect(fanBonusPermil(999999, custom)).toBe(1020);
  });

  it("空テーブルは throw", () => {
    expect(() => fanBonusPermil(100, [])).toThrow();
  });

  it.each([-1, 1.5])("不正な audience=%j は throw", (audience) => {
    expect(() => fanBonusPermil(audience, table)).toThrow();
  });
});

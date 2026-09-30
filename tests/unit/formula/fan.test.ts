/**
 * fan.ts 単体テスト。
 *
 * 出典: research/02 §1.8（16,000人 → +62.0% が実測完全一致・Confirmed）、
 *       data/stages/audience_advantage.json（マスタ QuestAudienceAdvantage.json・1000行）。
 */
import { describe, expect, it } from "vitest";
import {
  fanBonusPermil,
  laneFanFactorsPermil,
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

/**
 * 【Phase 16-A4・2026-09-30】レーン別来場数 → 満員ガード付きファンファクター。
 *
 * 実測 5 サンプル 25/25 完全一致の規則（phase16_action3b_fan_full_house.md）:
 * 来場合計 >= 会場キャパなら全レーン一律 f(cap/5)（= fan.png の「※最大」値）、
 * 空席ありなら各レーンの来場数で表引き f(lane_fans[i])。
 * レーン別来場数は research/23_beat_score_analysis/tmp_lane_fans_out.txt（fan.png 読取）。
 */
describe("laneFanFactorsPermil（満員ガード付きレーン別ファンファクター）", () => {
  const S1 = [19, 19, 18, 22, 22]; // 合計 100 = cap 100（満員）
  const S2 = [11996, 13543, 13741, 13255, 13496]; // 合計 66,031 < cap 70,000（空席）
  const S3 = [8515, 7748, 8535, 8518, 6684]; // 合計 40,000 = cap 40,000（満員）
  const S5 = [13835, 10782, 13840, 11817, 11290]; // 合計 61,564 < cap 80,000（空席）

  it("満員（S3: 合計 = cap）は全レーン一律 f(cap/5) = 1375‰（+37.5%）", () => {
    expect(laneFanFactorsPermil(S3, table, 40000)).toEqual([1375, 1375, 1375, 1375, 1375]);
  });

  it("満員（S1: 合計 = cap）は全レーン一律 f(20) = 1002‰（+0.2%）", () => {
    expect(laneFanFactorsPermil(S1, table, 100)).toEqual([1002, 1002, 1002, 1002, 1002]);
  });

  it("満員ガードなしの素朴なレーン別表引きでは S3 L5 が −2.4% の後退（1342‰）", () => {
    const naive = laneFanFactorsPermil(S3, table);
    expect(naive).toEqual([1387, 1368, 1388, 1387, 1342]);
    expect(naive[4]! / 1375 - 1).toBeCloseTo(-0.024, 3);
  });

  it("空席（S2: 合計 66,031 < cap 70,000）はレーン別表引き = fan.png 表示値", () => {
    const v = laneFanFactorsPermil(S2, table, 70000);
    expect(v).toEqual([1539, 1570, 1574, 1565, 1569]);
    // fan.png のレーン別スコアボーナス +53.9 / +57.0 / +57.4 / +56.5 / +56.9%
    expect(v.map((x) => (x - 1000) / 10)).toEqual([53.9, 57.0, 57.4, 56.5, 56.9]);
  });

  it("空席（S5: 合計 61,564 < cap 80,000）はレーン別表引き = fan.png 表示値", () => {
    const v = laneFanFactorsPermil(S5, table, 80000);
    expect(v).toEqual([1576, 1515, 1576, 1536, 1525]);
    expect(v.map((x) => (x - 1000) / 10)).toEqual([57.6, 51.5, 57.6, 53.6, 52.5]);
  });

  it("単一 audience（レーン平均）に対する相対精度の改善幅: S2 最大 ±1.6% / S5 最大 ±2.0%", () => {
    const maxRelDeviation = (laneFans: number[], cap: number): number => {
      const avg = fanBonusPermil(
        Math.floor(laneFans.reduce((a, b) => a + b, 0) / 5),
        table,
      );
      return Math.max(
        ...laneFanFactorsPermil(laneFans, table, cap).map((v) => Math.abs(v / avg - 1)),
      );
    };
    // 単一 audience（平均 13,206 → 1564‰）では L1 が −1.6%（1539‰）ずれる
    expect(maxRelDeviation(S2, 70000)).toBeCloseTo(0.016, 3);
    // 単一 audience（平均 12,312 → 1546‰）では L2 が −2.0%（1515‰）ずれる
    expect(maxRelDeviation(S5, 80000)).toBeCloseTo(0.020, 3);
  });

  it("要素数 5・0 以上の整数・正の capacity を検証する", () => {
    expect(() => laneFanFactorsPermil([1, 2, 3, 4], table)).toThrow();
    expect(() => laneFanFactorsPermil([1, 2, 3, 4, -5], table)).toThrow();
    expect(() => laneFanFactorsPermil([1, 2, 3, 4, 5], table, 0)).toThrow();
    expect(() => laneFanFactorsPermil([1, 2, 3, 4, 5], table, 2.5)).toThrow();
  });
});

/**
 * 集目/ステルス引力度（docs「来場ファン数のボーナス」gid=969532646）の単体テスト。
 *
 * docs 原文: 「全員が「引力度」を持って、最初の設定が「100%」です。集目効果とステルス効果で
 *   1段階にあたり±5%の変動があります。ファン数が「自分の引力度」と「全5人の引力度」の
 *   割合で分布されています。…「18,400人 + 集目10段階」は 25,091人 → 75.0%」
 * 累積セグメント: 0.1% あたり 10/20/40/2.5/50/100 人。確認値: 20=0.2% / 200=2.0% /
 *   1,000=10.0% / 16,000=62.0% / 20,000=70.0% / 25,091=75.0%
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FAN_BONUS_SEGMENTS,
  attractPermil,
  fanBonusPermilFromCount,
  fanFactorPermilByAttraction,
} from "../../../src/timeline/buffs.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("ファン数 → ボーナス%（docs 累積セグメント）", () => {
  const checks: Array<[number, number]> = [
    [20, 0.2], [30, 0.3], [44, 0.4], [72, 0.7], [200, 2.0], [1000, 10.0],
    [2000, 15.0], [16000, 62.0], [18400, 66.8], [20000, 70.0], [25091, 75.0],
  ];
  it.each(checks)("%d 人 → %.1f%%", (fans, pct) => {
    expect(fanBonusPermilFromCount(fans) / 10).toBeCloseTo(pct, 1);
  });
});

describe("fanBonusPermilFromCount の ‰ 減分", () => {
  it("20 人 → 2‰（+0.2%・ハイスコア1 の上限値）", () => {
    expect(fanBonusPermilFromCount(20)).toBe(2);
  });
  it("16,000 人 → 620‰（+62.0%・T5 動員 80000）", () => {
    expect(fanBonusPermilFromCount(16000)).toBe(620);
  });
});

describe("data/stages/fan_bonus.json との同期", () => {
  it("セグメント定義が一致する", () => {
    const json = JSON.parse(
      readFileSync(path.join(repoRoot, "data/stages/fan_bonus.json"), "utf-8"),
    );
    expect(json.segments).toEqual(FAN_BONUS_SEGMENTS);
  });
});

describe("引力度（集目 ±5%/段・ステルス −5%/段）", () => {
  it("基準 1000・集目 10 段で 1500・ステルス 10 段で 500", () => {
    expect(attractPermil(0, 0)).toBe(1000);
    expect(attractPermil(10, 0)).toBe(1500);
    expect(attractPermil(0, 10)).toBe(500);
  });
});

describe("fanFactorPermilByAttraction（docs 引力式）", () => {
  it("T5: 16,000 人・集目 10 段（他 4 人効果なし）→ 1768‰（71.8%+5.0%）", () => {
    const others = [
      { focus: 0, stealth: 0 },
      { focus: 0, stealth: 0 },
      { focus: 0, stealth: 0 },
      { focus: 0, stealth: 0 },
    ];
    expect(fanFactorPermilByAttraction(16000, 10, 0, others)).toBe(1768);
  });
  it("集目なし・16,000 人 → 1620‰（従来値と一致）", () => {
    const others = [
      { focus: 0, stealth: 0 },
      { focus: 0, stealth: 0 },
      { focus: 0, stealth: 0 },
      { focus: 0, stealth: 0 },
    ];
    expect(fanFactorPermilByAttraction(16000, 0, 0, others)).toBe(1620);
  });
});

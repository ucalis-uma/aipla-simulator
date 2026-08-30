/**
 * 最適編成探索（src/optimizer）のユニットテスト。
 * 合成データ（6カード・10ビート譜面）で高速に検証する:
 *   - 最強スキル保有カードが TOP1 編成に含まれる
 *   - レーン固定（センター固定等）・属性縛りが尊重される
 *   - 同一シードで決定論的・カード重複なし・スコア降順
 */
import { describe, expect, it } from "vitest";
import { optimizeLineup } from "../../../src/optimizer/index.js";
import type { MasterSkillDef, SimSourceData } from "../../../src/sim/build.js";
import type { CardDef } from "../../../src/types.js";

function makeData(): SimSourceData {
  const cards: CardDef[] = [1, 2, 3, 4, 5, 6].map((i) => ({
    id: `card-c${i}`,
    name: `C${i}`,
    characterId: "char-x",
    initialRarity: 5,
    cardParameterId: `param-c${i}`,
    ratiosPermil:
      i === 6
        ? { vocal: 200, dance: 900, visual: 100, stamina: 1000 }
        : { vocal: 340, dance: 330, visual: 330, stamina: 1000 },
    skillIds: [`sk-c${i}-1`],
  }));
  const cardParameters = cards.flatMap((c) =>
    [1, 6].map((lv) => ({ id: c.cardParameterId, level: lv, value: 100 + lv, staminaValue: 1000 })),
  );
  const skillsByCard: Record<string, MasterSkillDef[]> = {};
  for (const c of cards) {
    skillsByCard[c.id] = [
      {
        id: `sk-${c.id.slice(5)}-1`,
        name: "s",
        kind: "A",
        level: 6,
        lane: null,
        ct: 20,
        staminaCost: 100,
        probabilityPermil: 1000,
        limitPerLive: null,
        conditionalNote: null,
        effects: [
          {
            type: "score_get",
            target: "self",
            condition: "none",
            durationBeats: null,
            // c5 だけ最強（探索で選ばれるべきカード）
            powerPermil: c.id === "card-c5" ? 5000 : 3000,
          },
        ],
      },
    ];
  }
  return {
    cards,
    cardParameters,
    skillsGolden: [],
    stages: {
      st: {
        beatWeightsPermil: { vocal: 600, dance: 250, visual: 150 },
        skillWeightsPermil: { active: 800, special: 800 },
        laneAttributes: [2, 2, 1, 2, 2],
      },
    },
    charts: {
      ch: {
        notes: Array.from({ length: 10 }, (_, i) => ({
          beat: i + 1,
          type: 1 as const,
          position: (i % 5) as 0 | 1 | 2 | 3 | 4,
        })),
      },
    },
    skillsByCard,
  };
}

const BASE = {
  stageFile: "st",
  chartFile: "ch",
  laneAttributes: [2, 2, 1, 2, 2],
  poolSize: 6,
  screenRuns: 1,
  finalRuns: 2,
  seed: 1,
  topN: 3,
  maxPasses: 2,
  timeBudgetMs: 20000,
} as const;

describe("optimizer", () => {
  it("最強スキル保有カードが TOP1 に含まれ、スコア降順で重複なし", async () => {
    const res = await optimizeLineup({ ...BASE, data: makeData() });
    expect(res.entries.length).toBeGreaterThan(0);
    expect(res.entries.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < res.entries.length; i++) {
      expect(res.entries[i]!.score).toBeLessThanOrEqual(res.entries[i - 1]!.score);
    }
    const best = res.entries[0]!;
    expect(best.cardIds).toHaveLength(5);
    expect(new Set(best.cardIds).size).toBe(5);
    expect(best.cardIds).toContain("card-c5");
    expect(best.score).toBeGreaterThanOrEqual(best.confirmed);
    expect(res.pool.length).toBeGreaterThan(0);
    expect(res.evaluations).toBeGreaterThan(0);
  });

  it("レーン固定（センター固定）が尊重される", async () => {
    const res = await optimizeLineup({
      ...BASE,
      data: makeData(),
      lockedCardIds: [null, null, "card-c1", null, null],
    });
    expect(res.entries[0]!.cardIds[2]).toBe("card-c1");
  });

  it("属性縛り（Vo限定）で Da 得意カード（c6）が選ばれない", async () => {
    const res = await optimizeLineup({
      ...BASE,
      data: makeData(),
      attrFilter: ["vocal", "vocal", "vocal", "vocal", "vocal"],
    });
    for (const e of res.entries) {
      for (const cid of e.cardIds) {
        expect(cid).not.toBe("card-c6");
      }
    }
  });

  it("同一シードで決定論的（同一結果）", async () => {
    const a = await optimizeLineup({ ...BASE, data: makeData() });
    const b = await optimizeLineup({ ...BASE, data: makeData() });
    expect(a.entries.map((e) => e.cardIds.join("|"))).toEqual(
      b.entries.map((e) => e.cardIds.join("|")),
    );
  });

  it("存在しないステージ/譜面はエラー", async () => {
    await expect(
      optimizeLineup({ ...BASE, data: makeData(), stageFile: "unknown" }),
    ).rejects.toThrow(/stage not found/);
    await expect(
      optimizeLineup({ ...BASE, data: makeData(), chartFile: "unknown" }),
    ).rejects.toThrow(/chart not found/);
  });
});

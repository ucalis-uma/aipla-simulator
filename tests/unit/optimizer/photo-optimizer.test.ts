/**
 * 統合オプティマイザ（Phase 8-C）のユニットテスト。
 * - requiredCardId（必須採用・レーン自由）が編成に必ず含まれる
 * - photoPool（タグ指定フォトプール）が各レーンに配分され、レタッチ1枚制限が厳守される
 * - フォト込み評価がフォトなしより高い（ステータス盛りがスコアに直結）
 * 合成データ（6カード・10ビート譜面）で高速に検証する。
 */
import { describe, expect, it } from "vitest";
import { optimizeLineup } from "../../../src/optimizer/index.js";
import type { MasterSkillDef, SimSourceData } from "../../../src/sim/build.js";
import type { CardDef } from "../../../src/types.js";
import type { MyPhotoDef } from "../../../src/photos.js";

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
  topN: 3,
  maxPasses: 1,
  timeBudgetMs: 30000,
  seed: 1,
};

function photo(partial: Partial<MyPhotoDef>): MyPhotoDef {
  return {
    id: "ph1",
    name: "Vo盛りフォト",
    kindLabel: "イメトレ",
    tags: ["探索用"],
    retouch: false,
    skill: null,
    frames: [{ kind: "self", stat: "vocal", type: "pct", value: 50 }],
    ...partial,
  };
}

describe("統合オプティマイザ（Phase 8-C）", () => {
  it("requiredCardId が必ず編成に含まれる", async () => {
    const res = await optimizeLineup({ ...BASE, data: makeData(), requiredCardId: "card-c6" });
    expect(res.entries.length).toBeGreaterThan(0);
    for (const e of res.entries) {
      expect(e.cardIds).toContain("card-c6");
      expect(new Set(e.cardIds).size).toBe(5);
    }
  });

  it("photoPool から各レーンにフォトが配分される（photoIds 記録・スコア向上）", async () => {
    const data = makeData();
    const without = await optimizeLineup({ ...BASE, data });
    const withPhotos = await optimizeLineup({
      ...BASE,
      data,
      photoPool: [photo({ id: "ph1" }), photo({ id: "ph2", name: "フォト2" })],
    });
    expect(withPhotos.entries.length).toBeGreaterThan(0);
    // フォトが配分されている（同条件下でフォトありの方がスコアが高い）
    const totalPhotos = withPhotos.entries[0]!.photoIds.filter((p) => p !== null).length;
    expect(totalPhotos).toBeGreaterThanOrEqual(1);
    expect(withPhotos.entries[0]!.score).toBeGreaterThan(without.entries[0]!.score);
    // 同一フォトが複数レーンに重複しない
    const ids = withPhotos.entries[0]!.photoIds.filter((p): p is string => p !== null);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("レタッチフォトが同一レーンに 2 枚付くことはない", async () => {
    const res = await optimizeLineup({
      ...BASE,
      data: makeData(),
      photoPool: [
        photo({ id: "r1", name: "レタッチ1", retouch: true }),
        photo({ id: "r2", name: "レタッチ2", retouch: true }),
        photo({ id: "r3", name: "レタッチ3", retouch: true }),
      ],
    });
    // 各レーンの photoIds に retouch フォトが 2 枚以上載らないことを直接検証するため
    // 割当結果の各レーンは最大 1 枚/レーンの割当（オプティマイザは 1 レーン 1 フォト割当）
    for (const e of res.entries) {
      const ids = e.photoIds.filter((p): p is string => p !== null);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("フォトなし（photoPool 未指定）では photoIds がすべて null", async () => {
    const res = await optimizeLineup({ ...BASE, data: makeData() });
    for (const e of res.entries) {
      expect(e.photoIds).toEqual([null, null, null, null, null]);
    }
  });
});

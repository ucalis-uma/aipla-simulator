/**
 * フォト装備 ↔ フォトスキルの連動（Phase 8-B5）の単体テスト。
 *
 * golden フォトスキルの photoIndex=i は「i 番目に装着した実測/JSON フォト」に対応する。
 * 装備数を減らすと対応するスキルも注入されなくなる（装備解除でステータスとスキルが
 * 同時に外れる）。T5 実測（photoIndex 1-4 ↔ photos 4 枚）は全件該当で不変。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSimulateInput, type DeckJsonV2, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { NeutralRng } from "../../src/rng/neutral.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(path.join(repoRoot, p), "utf-8"));

const data: SimSourceData = {
  cards: (readJson("data/cards.json") as { cards: never[] }).cards as never,
  cardParameters: (readJson("data/card_parameters.json") as { rows: never[] }).rows as never,
  skillsGolden: (readJson("data/skills_golden.json") as { skills: never[] }).skills as never,
  skillsByCard: (readJson("data/skills_master.json") as { byCard: never }).byCard as never,
  stages: {
    st: {
      beatWeightsPermil: { vocal: 600, dance: 250, visual: 150 },
      skillWeightsPermil: { active: 1000, special: 1000 },
      laneAttributes: [2, 2, 1, 2, 2],
    },
  },
  charts: {
    ch: {
      notes: Array.from({ length: 40 }, (_, i) => ({
        beat: i + 1,
        type: 1 as const,
        position: 3 as const,
      })),
    },
  },
};

const dummyPhoto = (name: string): unknown => ({
  name,
  structured: [{ stat: "vocal", type: "pct", value: 5 }],
});

const deckOf = (l1Photos: unknown[]): DeckJsonV2 => ({
  staff_bonus: { vocal: 0, dance: 0, visual: 0, stamina: 0, mental: 0, critical: 0 },
  yale_bonus: {
    vocal_pct: 0,
    dance_pct: 0,
    visual_pct: 0,
    stamina: 0,
    mental: 0,
    critical: 0,
    beat_score_pct: 0,
    a_skill_score_pct: 0,
    sp_skill_score_pct: 0,
    critical_score_pct: 0,
  },
  characters: [1, 2, 3, 4, 5].map((lane) => ({
    lane,
    card_id: "card-yu-05-birt-02",
    level: 215,
    rarity: 10,
    role: "Scorer" as const,
    kouryu_level: 1,
    stats: {
      base: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
      total_after_non_skill_modifiers: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
    },
    // L1 だけフォトを装備（golden フォトスキルはレーンスコープのため L1 に注入される）
    photos: lane === 1 ? l1Photos : [],
    accessories: [],
  })) as DeckJsonV2["characters"],
});

const OPTS = { stageFile: "st", chartFile: "ch", data } as const;
/**
 * 【Phase 16-A9c F3】golden フォトスキル（photo-L*）の注入ゲート。
 * F3 で「未指定＝注入しない」が既定になったため、L1 のダミーフォト名を T5 実測名の
 * 代わりに渡す（装着位置フォトの名前一致で注入＝Phase 8-B5 の連動を検証する意図は不変）。
 */
const GOLDEN_PHOTO_NAMES: string[][] = [["a", "b", "c", "d"]];
const photoSkillIdsOf = (input: ReturnType<typeof buildSimulateInput>): string[] =>
  input.lanes
    .find((l) => l.lane === 1)!
    .photos.map((s) => s.id)
    .filter((id) => id.startsWith("photo-"));
const run = (input: ReturnType<typeof buildSimulateInput>): number =>
  simulateTimeline({
    ...input.base,
    baseCritRate: undefined,
    rng: new NeutralRng(),
    criticalProvider: () => false,
  }).totalScore;

describe("フォト装備 ↔ フォトスキルの連動（Phase 8-B5）", () => {
  it("golden フォトスキル photoIndex は装備数以下のみ注入される", () => {
    // L1 の golden フォトスキル: photo-L1-1(idx1)〜photo-L1-3(idx3)
    const full = buildSimulateInput({
      ...OPTS,
      deck: deckOf([dummyPhoto("a"), dummyPhoto("b"), dummyPhoto("c"), dummyPhoto("d")]),
      goldenPhotoNames: GOLDEN_PHOTO_NAMES,
    });
    expect(photoSkillIdsOf(full)).toEqual(["photo-L1-1", "photo-L1-2", "photo-L1-3"]);
    // 2 枚まで装備を減らす → idx3 の photo-L1-3 も外れる
    const two = buildSimulateInput({
      ...OPTS,
      deck: deckOf([dummyPhoto("a"), dummyPhoto("b")]),
      goldenPhotoNames: GOLDEN_PHOTO_NAMES,
    });
    expect(photoSkillIdsOf(two)).toEqual(["photo-L1-1", "photo-L1-2"]);
    // 全外し → フォトスキルは 1 つも注入されない
    const none = buildSimulateInput({
      ...OPTS,
      deck: deckOf([]),
      goldenPhotoNames: GOLDEN_PHOTO_NAMES,
    });
    expect(photoSkillIdsOf(none)).toEqual([]);
    // 【F3】ゲートを渡さない（未指定）場合は、装着位置が一致していても注入しない（既定 off）
    const ungated = buildSimulateInput({
      ...OPTS,
      deck: deckOf([dummyPhoto("a"), dummyPhoto("b"), dummyPhoto("c"), dummyPhoto("d")]),
    });
    expect(photoSkillIdsOf(ungated)).toEqual([]);
  });

  it("装備を減らすとステータスとスキルの両方が外れてスコアが下がる", () => {
    const full = run(
      buildSimulateInput({
        ...OPTS,
        deck: deckOf([dummyPhoto("a"), dummyPhoto("b"), dummyPhoto("c"), dummyPhoto("d")]),
        goldenPhotoNames: GOLDEN_PHOTO_NAMES,
      }),
    );
    const none = run(
      buildSimulateInput({ ...OPTS, deck: deckOf([]), goldenPhotoNames: GOLDEN_PHOTO_NAMES }),
    );
    expect(none).toBeLessThan(full);
  });
});

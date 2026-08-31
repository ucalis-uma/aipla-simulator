/**
 * スキルレベル選択（Phase 8-B3）の単体テスト。
 * - data/skills_levels.json（コンパクト codec）の復元整合（最大レベル = skills_master と一致）
 * - skill_levels 上書きが buildSimulateInput に反映される（効果値・CT・消費がレベルごとに変化）
 * - golden 較正スキルのレベル互換（T5 実測レベル = 要求カードレベル表の許可最大と一致）
 * - unlocks.json の解放テーブル（スキル枠 Lv1/20/80・フォト枠 2/65/105）
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSimulateInput,
  type DeckJsonV2,
  type SimSourceData,
} from "../../src/sim/build.js";
import { buildSkillLevelIndex, decodeSkillLevel, maxSkillLevelOf } from "../../src/skillLevels.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { NeutralRng } from "../../src/rng/neutral.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(path.join(repoRoot, p), "utf-8"));

const data: SimSourceData = {
  cards: (readJson("data/cards.json") as { cards: never[] }).cards as never,
  cardParameters: (readJson("data/card_parameters.json") as { rows: never[] }).rows as never,
  skillsGolden: (readJson("data/skills_golden.json") as { skills: never[] }).skills as never,
  skillsByCard: (readJson("data/skills_master.json") as { byCard: never }).byCard as never,
  skillLevels: readJson("data/skills_levels.json") as never,
  stages: {
    st: {
      beatWeightsPermil: { vocal: 600, dance: 250, visual: 150 },
      skillWeightsPermil: { active: 1000, special: 1000 },
      laneAttributes: [2, 2, 1, 2, 2],
    },
  },
  charts: {
    // 10 ビート譜面（ビート 8 + A ノート 1 + SP ノート 1）。
    // A/SP ノートがないと A スキル（score_get）が発動せずレベル差がスコアに出ない
    ch: {
      notes: [
        ...Array.from({ length: 8 }, (_, i) => ({
          beat: i + 1,
          type: 1 as const,
          position: 0 as const,
        })),
        { beat: 9, type: 2 as const, position: 1 as const },
        { beat: 10, type: 3 as const, position: 1 as const },
      ],
    },
  },
};

const unlocks = readJson("data/unlocks.json") as {
  skillSlotUnlockLevels: number[];
  photoSlotUnlockLevels: number[];
  accessorySlotUnlockLevels: number[];
  skillLevelRequirements: Record<string, number[]>;
};

// A ノートはセンター（L3）が発動するため上書きレーンの既定は 3
const deckOf = (skillLevels: Record<string, number>, laneOverride = 3): DeckJsonV2 => ({
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
    role: "Scorer",
    kouryu_level: 1,
    stats: {
      base: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
      total_after_non_skill_modifiers: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
    },
    photos: [],
    accessories: [],
    skill_levels: lane === laneOverride ? skillLevels : undefined,
  })),
});

const OPTS = { stageFile: "st", chartFile: "ch", data } as const;

describe("skills_levels codec（復元整合）", () => {
  it("最大レベルの復元結果が skills_master（マスタ最大レベル解析）と一致する", () => {
    const master = data.skillsByCard as unknown as Record<string, Array<Record<string, unknown>>>;
    const index = buildSkillLevelIndex(data.skillLevels!);
    let checked = 0;
    for (const [cardId, skills] of Object.entries(master)) {
      for (const s of skills) {
        const id = String(s.id);
        const decoded = decodeSkillLevel(data.skillLevels!, id, 6, index);
        expect(decoded, id).not.toBeNull();
        expect(decoded!.effects).toEqual(s.effects);
        expect(decoded!.ct).toEqual(s.ct);
        expect(decoded!.staminaCost).toEqual(s.staminaCost);
        checked++;
        if (checked >= 40) return;
      }
      void cardId;
    }
  });

  it("Lv1 の復元で効果値が弱まる（birt-02 の A: 340% @Lv1 ↔ 450% @Lv6）", () => {
    const lv1 = decodeSkillLevel(data.skillLevels!, "sk-yu-05-birt-02-1", 1)!;
    expect(lv1.effects[0]).toMatchObject({ type: "score_get", powerPermil: 3400 });
    const lv6 = decodeSkillLevel(data.skillLevels!, "sk-yu-05-birt-02-1", 6)!;
    expect(lv6.effects[0]).toMatchObject({ type: "score_get", powerPermil: 4500 });
  });
});

describe("skill_levels 上書き（buildSimulateInput）", () => {
  it("上書きなしでは golden（実測較正）スキルが使われ警告も出ない", () => {
    const built = buildSimulateInput({ ...OPTS, deck: deckOf({}) });
    const l1 = built.lanes.find((l) => l.lane === 1)!;
    expect(l1.skills.length).toBeGreaterThan(0);
    expect(l1.skills.every((s) => s.cardId != null)).toBe(true);
    expect(built.warnings).toEqual([]);
  });

  it("golden スキルを Lv1 へ下げるとマスタ解析値に置き換わり警告が出る（L1 = golden birt 保持）", () => {
    const built = buildSimulateInput({ ...OPTS, deck: deckOf({ "sk-yu-05-birt-02-1": 1 }, 1) });
    const l1 = built.lanes.find((l) => l.lane === 1)!;
    const a = l1.skills.find((s) => s.id === "sk-yu-05-birt-02-1")!;
    expect(a.level).toBe(1);
    expect(a.effects[0]).toMatchObject({ type: "score_get", powerPermil: 3400 });
    expect(built.warnings.some((w) => w.includes("golden-calibrated"))).toBe(true);
  });

  it("スキルLvを下げるとスコアが下がる（golden Lv6 ↔ Lv1）", () => {
    const base = buildSimulateInput({ ...OPTS, deck: deckOf({}) });
    const weak = buildSimulateInput({ ...OPTS, deck: deckOf({ "sk-yu-05-birt-02-1": 1 }) });
    const run = (input: ReturnType<typeof buildSimulateInput>): number =>
      simulateTimeline({
        ...input.base,
        baseCritRate: undefined,
        rng: new NeutralRng(),
        criticalProvider: () => false,
      }).totalScore;
    expect(run(weak)).toBeLessThan(run(base));
  });
});

describe("解放テーブル（unlocks.json・裏取り済み）", () => {
  it("スキルLv要求カードレベル表（枠1: Lv2=40・Lv6=180 / 枠3: Lv2=100・Lv6=230）", () => {
    expect(unlocks.skillLevelRequirements["1"]).toEqual([0, 40, 60, 90, 150, 180]);
    expect(unlocks.skillLevelRequirements["2"]).toEqual([0, 50, 70, 110, 160, 200]);
    expect(unlocks.skillLevelRequirements["3"]).toEqual([0, 100, 130, 170, 210, 230]);
    expect(unlocks.skillLevelRequirements["4"]).toEqual([0, 120, 140, 190, 220, 240]);
  });

  it("カードレベルから選択できる最大スキルLv（Lv215 の枠3 = Lv5・T5 実測と一致）", () => {
    const req3 = unlocks.skillLevelRequirements["3"]!;
    expect(maxSkillLevelOf(req3, 215)).toBe(5);
    expect(maxSkillLevelOf(req3, 230)).toBe(6);
    expect(maxSkillLevelOf(unlocks.skillLevelRequirements["1"]!, 215)).toBe(6);
    expect(maxSkillLevelOf(unlocks.skillLevelRequirements["1"]!, 39)).toBe(1);
    expect(maxSkillLevelOf(unlocks.skillLevelRequirements["1"]!, 40)).toBe(2);
    // 絆覚醒枠（slot4）は Lv6 に 240 必要 → 現行キャップ 230 では Lv5 まで
    expect(maxSkillLevelOf(unlocks.skillLevelRequirements["4"]!, 230)).toBe(5);
  });

  it("スキル枠/フォト枠の解放レベル（スキル 3 枠目=Lv80・フォト 3 枠目=Lv65・4 枠目=Lv105）", () => {
    expect(unlocks.skillSlotUnlockLevels).toEqual([1, 20, 80]);
    expect(unlocks.photoSlotUnlockLevels).toEqual([1, 1, 65, 105]);
    // フォト枠数の導出（UI photoSlotLimitOf と同一規則）
    const limitOf = (level: number): number =>
      unlocks.photoSlotUnlockLevels.filter((lv) => level >= lv).length;
    expect(limitOf(64)).toBe(2);
    expect(limitOf(65)).toBe(3);
    expect(limitOf(105)).toBe(4);
  });

  it("T5 実測の golden スキルレベルが要求テーブルの許可最大と一致する（裏取り検証）", () => {
    const golden = (
      data.skillsGolden as Array<{ id: string; lane: number; level: number; kind: string }>
    ).filter((s) => s.lane === 1 && s.kind !== "photo" && s.kind !== "live_bonus");
    const levels = Object.fromEntries(golden.map((s) => [s.id.slice(-1), s.level]));
    // L1 = Lv215: slot1=6（要求180✓）・slot2=6（要求200✓）・slot3=5（要求210✓・Lv6 は 230）
    expect(levels["1"]).toBe(maxSkillLevelOf(unlocks.skillLevelRequirements["1"]!, 215));
    expect(levels["2"]).toBe(maxSkillLevelOf(unlocks.skillLevelRequirements["2"]!, 215));
    expect(levels["3"]).toBe(maxSkillLevelOf(unlocks.skillLevelRequirements["3"]!, 215));
  });
});

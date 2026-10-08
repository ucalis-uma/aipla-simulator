/**
 * Phase 16-A14 / タスク B3: **属性上昇超化（`*_up_extreme` 独立キー経路）と capExtend（基本キー加算経路）の
 * gate 同一性**を回帰テストで固定する。
 *
 * 規則（`src/timeline/buffs.ts`）: 超化は「基本キーの段数が 0 でない間だけ」加算される。
 * - 独立キー経路: `liveStatusMultiplierPermil` が `upStages > 0` のときだけ extreme 段を数える（L441-448）
 * - capExtend 経路: `aggregateBuffs` が `snapshot[key] > 0` のときだけ超化段を加算する（L404-409）
 *   ＝【Phase 16-A13 実測確定 2026-10-07】で後者に前者と同じ gate を入れた（S3 の
 *   ビジュアル上昇超化 26 セル: b40–50 / b98–110 で基本 visual_up が 0 → stat がデッキ素値 305,202 のまま）。
 *
 * 合成入力のみで検証する（実測データは読まない）。
 */
import { describe, expect, it } from "vitest";
import { aggregateBuffs, liveStatusMultiplierPermil, type ActiveEffect } from "../../../src/timeline/buffs.js";
import { simulateTimeline } from "../../../src/timeline/engine.js";
import type {
  ChartNote,
  EffectType,
  LaneInput,
  LaneNumber,
  SimulateInput,
  SkillDef,
  StageInput,
} from "../../../src/timeline/types.js";
import type { ScoreRng } from "../../../src/rng/types.js";
import type { StatValues } from "../../../src/types.js";

class ConstRng implements ScoreRng {
  nextScoreRoll(): number {
    return 1000;
  }
  nextCritical(): boolean {
    return false;
  }
  nextFloat(): number {
    return 0;
  }
}

function deck(overrides: Partial<StatValues<number>> = {}): StatValues<number> {
  return {
    vocal: 100000,
    dance: 50000,
    visual: 25000,
    stamina: 100000,
    mental: 1000,
    critical: 0,
    ...overrides,
  };
}

function lane(laneNum: LaneNumber, overrides: Partial<LaneInput> = {}): LaneInput {
  return {
    lane: laneNum,
    attribute: "visual",
    deck: deck(),
    skills: [],
    photos: [],
    scoreBonusPct: { beat: 0, active: 0, special: 0, passive: 0 },
    critExtrasPermil: 0,
    ...overrides,
  };
}

function stage(overrides: Partial<StageInput> = {}): StageInput {
  return {
    id: "test-stage",
    laneAttributes: [1, 1, 1, 1, 1],
    beatWeightsPermil: { vocal: 600, dance: 250, visual: 150 },
    skillWeightsPermil: { active: 1000, special: 1000 },
    stageFactorPermil: 1000,
    ...overrides,
  };
}

function note(beat: number, noteType: 1 | 2 | 3, position: 0 | 1 | 2 | 3 | 4 | 5): ChartNote {
  return { beat, noteType, position };
}

function skill(partial: Partial<SkillDef> & { id: string }): SkillDef {
  return {
    name: partial.id,
    kind: "P",
    level: 6,
    lane: 1,
    ct: null,
    staminaCost: 0,
    probabilityPermil: 1000,
    limitPerLive: null,
    effects: [],
    ...partial,
  };
}

/** 合成 ActiveEffect（stages>0 / remainingBeats>0 が前提） */
function eff(type: EffectType, stages: number, extra: Partial<ActiveEffect> = {}): ActiveEffect {
  return { type, stages, remainingBeats: 10, sourceSkillId: "sk-test", sourceLane: 1, ...extra };
}

/** 超化の段数は 1 段 = 50‰（`EXTREME_GRANT_STAGES` = +5段 = +250‰・capExtend も +5 段） */
const UP_PER_STAGE = 50;

describe("Phase 16-A14/B3: 属性上昇超化と capExtend の gate 同一性", () => {
  it("独立キー経路: 基本 visual_up = 0 のとき visual_up_extreme は倍率に寄与しない（実測: S3 の 26 セル）", () => {
    const snap = aggregateBuffs([eff("visual_up_extreme", 5)]);
    // 段数そのものはスナップショットに載る（表示・スナップショット互換のため）
    expect(snap.visual_up_extreme).toBe(5);
    expect(snap.visual_up).toBe(0);
    // しかしライブ中ステータス倍率には入らない
    expect(liveStatusMultiplierPermil(snap, "visual")).toBe(1000);
  });

  it("独立キー経路: 基本 visual_up が 1 段でもあると超化 5 段ぶんが乗る", () => {
    const snap = aggregateBuffs([eff("visual_up_extreme", 5), eff("visual_up", 3)]);
    expect(liveStatusMultiplierPermil(snap, "visual")).toBe(1000 + UP_PER_STAGE * 3 + UP_PER_STAGE * 5);
  });

  it("capExtend 経路: 基本 visual_up = 0 のとき超化段は加算されない（A13 で入れた gate）", () => {
    const snap = aggregateBuffs([eff("visual_up", 5, { capExtend: true })]);
    expect(snap.visual_up).toBe(0);
    expect(liveStatusMultiplierPermil(snap, "visual")).toBe(1000);
  });

  it("capExtend 経路: 基本 visual_up があると超化段が基本キーへ加算される", () => {
    const snap = aggregateBuffs([eff("visual_up", 3), eff("visual_up", 5, { capExtend: true })]);
    expect(snap.visual_up).toBe(8);
    expect(liveStatusMultiplierPermil(snap, "visual")).toBe(1000 + UP_PER_STAGE * 8);
  });

  it("両経路の同一性: 同じ (基本 n 段, 超化 5 段) でライブ中ステータス倍率が一致する", () => {
    for (const n of [0, 1, 3, 10, 17, 20]) {
      const viaExtremeKey = aggregateBuffs([
        ...(n > 0 ? [eff("visual_up", n)] : []),
        eff("visual_up_extreme", 5),
      ]);
      const viaCapExtend = aggregateBuffs([
        ...(n > 0 ? [eff("visual_up", n)] : []),
        eff("visual_up", 5, { capExtend: true }),
      ]);
      const a = liveStatusMultiplierPermil(viaExtremeKey, "visual");
      const b = liveStatusMultiplierPermil(viaCapExtend, "visual");
      expect(a, `基本 ${n} 段での両経路一致`).toBe(b);
      // 基本 0 のときは両経路とも無効
      if (n === 0) expect(a).toBe(1000);
      // 基本があるときは +250‰（+5段相当）
      else expect(a).toBe(1000 + UP_PER_STAGE * n + UP_PER_STAGE * 5);
    }
  });

  it("上限拡張も両経路で同値（基本 20 段 = 通常上限 + 超化 5）", () => {
    const viaExtremeKey = aggregateBuffs([eff("visual_up", 20), eff("visual_up_extreme", 5)]);
    const viaCapExtend = aggregateBuffs([eff("visual_up", 20), eff("visual_up", 5, { capExtend: true })]);
    expect(liveStatusMultiplierPermil(viaCapExtend, "visual")).toBe(1000 + UP_PER_STAGE * 25);
    expect(liveStatusMultiplierPermil(viaCapExtend, "visual")).toBe(liveStatusMultiplierPermil(viaExtremeKey, "visual"));
  });
});

/* ------------------------------------------------------------------ */
/* engine 経由の同一性（合成入力・visual_up 0 + 超化）                  */
/* ------------------------------------------------------------------ */

function input(notes: ChartNote[], lanes: LaneInput[], overrides: Partial<SimulateInput> = {}): SimulateInput {
  return {
    lanes,
    notes,
    stage: stage(),
    fanFactorPermil: 1000,
    criticalProvider: () => false,
    rng: new ConstRng(),
    ...overrides,
  };
}

function visualLanes(skills: SkillDef[]): LaneInput[] {
  return [lane(1, { skills }), lane(2), lane(3), lane(4), lane(5)];
}

function chart(totalBeats: number): ChartNote[] {
  return Array.from({ length: totalBeats }, (_, i) => note(i + 1, 1, 0));
}

/** ビジュアル上昇（基本）または超化を付与する合成 P スキル */
function visualSkill(id: string, type: EffectType, stages: number): SkillDef {
  return skill({
    id,
    lane: 1,
    condition: "none",
    ct: 60,
    effects: [{ type, stages, durationBeats: 60, target: "self", condition: "none" }],
  });
}

describe("Phase 16-A14/B3: engine 経由でも超化の gate が両経路で同一", () => {
  it("visual_up = 0 のまま visual_up_extreme だけを付与しても総スコアが変わらない（gate 有効）", () => {
    const notes = chart(20);
    const withoutSkill = simulateTimeline(input(notes, visualLanes([])));
    const withExtreme = simulateTimeline(
      input(notes, visualLanes([visualSkill("sk-test-extreme", "visual_up_extreme", 5)])),
    );
    // 付与自体は起きている（スナップショットに載る）
    expect(withExtreme.activations.some((a) => a.skillId === "sk-test-extreme" && a.success)).toBe(true);
    expect(withExtreme.beats.some((b) => (b.buffSnapshots[0]?.visual_up_extreme ?? 0) > 0)).toBe(true);
    // 基本 visual_up が 0 なのでスコアは 1 点も動かない
    expect(withExtreme.totalScore).toBe(withoutSkill.totalScore);
  });

  it("capExtend 経路も同じ（基本 0 の超化はスコアを動かさない）", () => {
    const notes = chart(20);
    const withoutSkill = simulateTimeline(input(notes, visualLanes([])));
    // 超化行（capExtend=true）: engine は同キーの独立インスタンスとして付与し capExtend を記録する
    const capExtendSkill = skill({
      id: "sk-test-capextend",
      lane: 1,
      condition: "none",
      ct: 60,
      effects: [
        { type: "visual_up", stages: 5, durationBeats: 60, capExtend: true, target: "self", condition: "none" },
      ],
    });
    const withCapExtend = simulateTimeline(input(notes, visualLanes([capExtendSkill])));
    expect(withCapExtend.activations.some((a) => a.skillId === "sk-test-capextend" && a.success)).toBe(true);
    // 基本 visual_up が 0 なのでスコアは 1 点も動かない（A13 の gate）
    expect(withCapExtend.totalScore).toBe(withoutSkill.totalScore);
  });

  it("基本 visual_up があれば超化はスコアを増やす（gate が「常時無効」ではないことの確認）", () => {
    const notes = chart(20);
    const baseOnly = simulateTimeline(input(notes, visualLanes([visualSkill("sk-test-base", "visual_up", 3)])));
    const basePlusExtreme = simulateTimeline(
      input(
        notes,
        visualLanes([
          visualSkill("sk-test-base", "visual_up", 3),
          visualSkill("sk-test-extreme", "visual_up_extreme", 5),
        ]),
      ),
    );
    expect(basePlusExtreme.totalScore).toBeGreaterThan(baseOnly.totalScore);
  });
});

/**
 * 延長による直前満了インスタンスの復活ルール（2026-09-21 Phase 14-F・実機確定）のテスト。
 *
 * 実機確認済みの挙動:
 * - 【T5 b86】A スキル（ステップ8）の延長は、**前ビート終了時に満了した**バフを復活させる:
 *   sk-ski-05-onep-00-2「私が恋をするのなら」（vocal_high_1 +10 延長）が b85 終了時満了の
 *   photo-L2-1 vocal_boost 4段を復活させ、実機は b86〜b99 でボーカルブースト 20段を表示。
 * - 【S1 b136】P 後半（ステップ11）の延長は、前ビート終了時満了のバフを復活させ**ない**:
 *   sk-rio-05-fest-01-3「過去の私へ」（全員 +7 延長・b136 後半発動）の対象に
 *   b135 終了時満了の vocal_up 3段は含まれず、実機は b136 で消滅。
 * - 【S3 b60・既存規則】P 後半（ステップ11）の延長は、**当ビート**のステップ10で満了した
 *   バフ（rem=0）は対象に含める（+7 で b61〜b67 まで残存・実機画面完全一致）。
 *
 * 合成ミニフィクスチャのみで検証する（skill-trigger-gate.test.ts と同じパターン）。
 */
import { describe, expect, it } from "vitest";
import { simulateTimeline } from "../../../src/timeline/engine.js";
import type {
  ChartNote,
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

function lane(lane: LaneNumber, overrides: Partial<LaneInput> = {}): LaneInput {
  return {
    lane,
    attribute: "vocal",
    deck: deck(),
    skills: [],
    photos: [],
    scoreBonusPct: { beat: 0, active: 0, special: 0, passive: 0 },
    critExtrasPermil: 0,
    ...overrides,
  };
}

function defaultLanes(): LaneInput[] {
  return [lane(1), lane(2), lane(3), lane(4), lane(5)];
}

function stage(overrides: Partial<StageInput> = {}): StageInput {
  return {
    id: "test-stage",
    laneAttributes: [2, 2, 1, 2, 2],
    beatWeightsPermil: { vocal: 600, dance: 250, visual: 150 },
    skillWeightsPermil: { active: 1000, special: 1000 },
    stageFactorPermil: 1000,
    ...overrides,
  };
}

function note(beat: number, noteType: 1 | 2 | 3, position: 0 | 1 | 2 | 3 | 4 | 5): ChartNote {
  return { beat, noteType, position };
}

function beatNotes(count: number): ChartNote[] {
  return Array.from({ length: count }, (_, i) => note(i + 1, 1, 0));
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

function input(
  notes: ChartNote[],
  lanes: LaneInput[] = defaultLanes(),
  overrides: Partial<SimulateInput> = {},
): SimulateInput {
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

const vbAt = (res: ReturnType<typeof simulateTimeline>, beat: number, laneIdx = 0): number =>
  res.beats[beat - 1]!.buffSnapshots[laneIdx]!.vocal_boost;

const vuAt = (res: ReturnType<typeof simulateTimeline>, beat: number, laneIdx = 0): number =>
  res.beats[beat - 1]!.buffSnapshots[laneIdx]!.vocal_up;

describe("延長による直前満了インスタンスの復活（Phase 14-F）", () => {
  it("A スキル（ステップ8）の延長は前ビート満了インスタンスを復活させる（T5 b86 型）", () => {
    // L1 P（開幕型）: vocal_boost 3段 [3ビート] → b1 前半に付与、b2 終了時に満了（rem=0）
    const grantP = skill({
      id: "sk-test-grant",
      lane: 1,
      condition: "none",
      ct: 50, // 【2026-09-27 テスト修正】ct なしだと毎ビート再発動して段数が重ね掛けになる
      effects: [
        { type: "vocal_boost", stages: 3, durationBeats: 3, target: "self", condition: "none" },
      ],
    });
    // L1 A: 全強化効果 +10 延長（b3 の A ノートでステップ8発動）
    const extA = skill({
      id: "sk-test-ext-a",
      lane: 1,
      kind: "A",
      effects: [{ type: "effect_extension", value: 10, target: "self", condition: "none" }],
    });
    const lanes = defaultLanes();
    lanes[0] = lane(1, { skills: [grantP, extA] });
    // b3 が L1 の A ノート（POSITION_TO_LANE=[3,2,4,1,5] により position=4 → L1）
    const notes = [
      note(1, 1, 0),
      note(2, 1, 0),
      note(3, 2, 4),
      ...beatNotes(12).map((n) => ({ ...n, beat: n.beat + 3 })),
    ];
    const res = simulateTimeline(input(notes, lanes));

    const extAct = res.activations.find((a) => a.skillId === "sk-test-ext-a" && a.success);
    expect(extAct).toBeDefined();
    expect(extAct!.beat).toBe(3);
    expect(extAct!.phase).toBe("main");

    // b1/b2: 付与中（b1 前半発動はスナップショットに乗る）
    expect(vbAt(res, 1)).toBe(3);
    expect(vbAt(res, 2)).toBe(3);
    // b3: スナップショットはステップ8開始時（延長発動前）のため 0（満了済み）
    expect(vbAt(res, 3)).toBe(0);
    // b4 以降: 復活したインスタンスが乗る（0+10 → b3 ステップ10 で 9 → b4..b12 で表示）
    expect(vbAt(res, 4)).toBe(3);
    expect(vbAt(res, 12)).toBe(3);
    expect(vbAt(res, 13)).toBe(0); // 復活後の 10 ビート経過で消滅
  });

  it("P 後半（ステップ11）の延長は前ビート満了インスタンスを復活させない（S1 b136 型）", () => {
    // L1 P（開幕型）: vocal_up 3段 [3ビート] → b1 前半に付与、b2 終了時に満了
    const grantP = skill({
      id: "sk-test-grant2",
      lane: 1,
      condition: "none",
      ct: 50, // 【2026-09-27 テスト修正】毎ビート再発動の防止（1回だけの付与に固定）
      effects: [
        { type: "vocal_up", stages: 3, durationBeats: 3, target: "self", condition: "none" },
      ],
    });
    // L2 P（条件型=後半）: 全員 +7 延長。combo>=3 で b3 の後半に発動
    const extP = skill({
      id: "sk-test-ext-p",
      lane: 2,
      ct: 50,
      condition: "combo>=3",
      effects: [{ type: "effect_extension", value: 7, target: "all", condition: "combo>=3" }],
    });
    const lanes = defaultLanes();
    lanes[0] = lane(1, { skills: [grantP] });
    lanes[1] = lane(2, { skills: [extP] });
    const res = simulateTimeline(input(beatNotes(10), lanes));

    const extAct = res.activations.find((a) => a.skillId === "sk-test-ext-p" && a.success);
    expect(extAct).toBeDefined();
    expect(extAct!.beat).toBe(3);
    expect(extAct!.phase).toBe("last");

    // b1/b2: 付与中。b3 以降: 後半延長では復活せず消滅したまま（実機は b136 で消滅と一致）
    expect(vuAt(res, 1)).toBe(3);
    expect(vuAt(res, 2)).toBe(3);
    expect(vuAt(res, 3)).toBe(0);
    expect(vuAt(res, 4)).toBe(0);
    expect(vuAt(res, 10)).toBe(0);
  });

  it("P 後半（ステップ11）の延長は当ビート満了（rem=0）インスタンスを従来どおり延長する（S3 b60 型）", () => {
    // L1 P（開幕型）: vocal_up 3段 [2ビート] → b1 前半に付与（rem=1）、b1 ステップ10で満了（rem=0）
    const grantP = skill({
      id: "sk-test-grant3",
      lane: 1,
      condition: "none",
      ct: 50, // 【2026-09-27 テスト修正】毎ビート再発動の防止（b1 の 1 回だけの付与に固定）
      effects: [
        { type: "vocal_up", stages: 3, durationBeats: 2, target: "self", condition: "none" },
      ],
    });
    // L2 P（条件型=後半）: 全員 +7 延長。combo>=1 で b1 の後半に発動
    const extP = skill({
      id: "sk-test-ext-p2",
      lane: 2,
      ct: 50,
      condition: "combo>=1",
      effects: [{ type: "effect_extension", value: 7, target: "all", condition: "combo>=1" }],
    });
    const lanes = defaultLanes();
    lanes[0] = lane(1, { skills: [grantP] });
    lanes[1] = lane(2, { skills: [extP] });
    const res = simulateTimeline(input(beatNotes(12), lanes));

    const extAct = res.activations.find((a) => a.skillId === "sk-test-ext-p2" && a.success);
    expect(extAct).toBeDefined();
    expect(extAct!.beat).toBe(1);
    expect(extAct!.phase).toBe("last");

    // b1 スナップショット（ステップ8開始時）では 3（延長はまだ乗らない）
    expect(vuAt(res, 1)).toBe(3);
    // b2〜b8: rem=0+7 で 7 ビート残存（S3 b60 の b61〜b67 残存と同型）
    expect(vuAt(res, 2)).toBe(3);
    expect(vuAt(res, 8)).toBe(3);
    expect(vuAt(res, 9)).toBe(0); // b9 で消滅（S3 の b68 消滅と同型）
  });
});

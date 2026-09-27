/**
 * スキル単位トリガー（SkillDef.condition）の全体ゲート仕様テスト（2026-09-21 ユーザー確定）。
 *
 * 実機確認済みの挙動（祭りに光る一番星 白石千紗 = card-chs-05-yukt-00・サンプル外の観測）:
 * - P「一生懸命、金魚すくい」（sk-chs-05-yukt-00-2・スロット2）:
 *   1行目「自身がビジュアルレーンの時」【改行あり】→ 後発動型かつ**スキル全体の発動ゲート**。
 *   3行目「自身が低下効果状態の時 …」（改行なし条件式）は行単位の適用条件であり、
 *   ビジュアルレーン以外では 3行目条件が成立してもスキル自体は発動しない。
 * - P「わたあめ、半分こ」（sk-chs-05-yukt-00-3・スロット3）:
 *   1行目無条件 + 2行目「自身がビジュアルレーンの時」（改行なし）→ 開幕型（b1 前半発動）。
 *   非ビジュアルレーンでは 1行目のみ適用。ビジュアルレーンでは わたあめ → 金魚すくい の順に発動。
 * - 対照（実測済み）: 「過去の私へ」（sk-rio-05-fest-01-3）= 1行目「80コンボ以上時」改行あり
 *   → 条件監視型（S1 実測 b136 のみ発動）。「ゆらゆらドボーン！」（sk-kkr-05-mizg-02-3）=
 *   改行なし条件のみ → 開幕型（S1 実測 b1/b50/b100/b150）。
 *
 * 合成ミニフィクスチャのみで検証する（sample2/3-specs.test.ts と同じパターン）。
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


/** 金魚すくい型: スキル単位=ビジュアルレーン条件 / 行1=スコア上昇（ビジュアル条件）/ 行2=成功率上昇（低下状態条件） */
function kingyoSkill(laneNumber: LaneNumber): SkillDef {
  return skill({
    id: "sk-test-kingyo",
    lane: laneNumber,
    kind: "P",
    ct: 50,
    condition: "self_visual_lane", // スキル単位トリガー（1行目条件＋改行相当）
    effects: [
      { type: "score_up", stages: 5, durationBeats: 30, target: "self", condition: "self_visual_lane" },
      { type: "skill_success_up", stages: 3, durationBeats: 30, target: "self", condition: "self_down_group" },
    ],
  });
}

/** 低下状態を自レーンに付与するだけの無条件フォト（行2条件を成立させるための道具） */
function downPhoto(laneNumber: LaneNumber): SkillDef {
  return skill({
    id: "photo-test-down",
    lane: laneNumber,
    kind: "photo",
    ct: 60, // CT 必須（null だと毎ビート発動して段数が重複加算される）
    effects: [
      { type: "visual_down", stages: 5, durationBeats: 90, target: "self", condition: "none" },
    ],
  });
}

describe("スキル単位トリガーの全体ゲート（2026-09-21 ユーザー確定・金魚すくい型）", () => {
  it("ゲート不成立: 非ビジュアルレーンでは行2条件（低下効果状態）が成立してもスキル自体が不発", () => {
    const lanes = defaultLanes();
    lanes[0] = lane(1, {
      attribute: "dance", // ゲート（self_visual_lane）が恒常不成立
      skills: [kingyoSkill(1)],
      photos: [downPhoto(1)], // 行2条件（self_down_group）は成立しうる状態を作る
    });
    const res = simulateTimeline(input(beatNotes(60), lanes));
    // フォトは発動して visual_down が乗る（= 行2条件が成立しうることの証明）
    const b5 = res.beats[4]!;
    expect(b5.buffSnapshots[0]!.visual_down).toBe(5);
    // しかしゲート不成立のためスキルは全ビート不発
    expect(res.activations.filter((a) => a.skillId === "sk-test-kingyo" && a.success)).toEqual([]);
    // 行2の skill_success_up も一切付与されない
    for (const b of res.beats) {
      expect(b.buffSnapshots[0]!.skill_success_up).toBe(0);
      expect(b.buffSnapshots[0]!.score_up).toBe(0);
    }
  });

  it("ゲート成立・行2不成立: 後発動型として発動し、行1（ビジュアル条件）のみ適用", () => {
    const lanes = defaultLanes();
    lanes[0] = lane(1, {
      attribute: "visual", // ゲート成立
      skills: [kingyoSkill(1)],
    });
    const res = simulateTimeline(input(beatNotes(10), lanes));
    // 後発動型（スキル単位条件つき）なので b1 後半に発動する
    const act = res.activations.find((a) => a.skillId === "sk-test-kingyo" && a.success);
    expect(act).toBeDefined();
    expect(act!.beat).toBe(1);
    expect(act!.phase).toBe("last");
    // 適用は行1のみ（score_up=5・skill_success_up=0）
    const b2 = res.beats[1]!;
    expect(b2.buffSnapshots[0]!.score_up).toBe(5);
    expect(b2.buffSnapshots[0]!.skill_success_up).toBe(0);
  });

  it("ゲート成立・行2成立: 両行が適用される", () => {
    const lanes = defaultLanes();
    lanes[0] = lane(1, {
      attribute: "visual",
      skills: [kingyoSkill(1)],
      photos: [downPhoto(1)],
    });
    const res = simulateTimeline(input(beatNotes(10), lanes));
    const act = res.activations.find((a) => a.skillId === "sk-test-kingyo" && a.success);
    expect(act).toBeDefined();
    expect(act!.beat).toBe(1);
    expect(act!.phase).toBe("last");
    const b2 = res.beats[1]!;
    expect(b2.buffSnapshots[0]!.score_up).toBe(5);
    expect(b2.buffSnapshots[0]!.skill_success_up).toBe(3);
  });
});

describe("コンボゲート型（過去の私へ型）", () => {
  it("combo>=80 が成立するまで不発・成立ビートの後半で発動", () => {
    const pastSkill = skill({
      id: "sk-test-past",
      lane: 1,
      kind: "P",
      ct: 50,
      condition: "combo>=80", // スキル単位トリガー（tg-combo-80 相当）
      effects: [
        { type: "combo_score_up", stages: 3, durationBeats: 50, target: "all", condition: "combo>=80" },
      ],
    });
    const lanes = defaultLanes();
    lanes[0] = lane(1, { skills: [pastSkill] });
    const res = simulateTimeline(input(beatNotes(90), lanes));
    const acts = res.activations.filter((a) => a.skillId === "sk-test-past" && a.success);
    // ビートノートは全成功で globalCombo が毎ビート +1 → b80 の後半（ステップ11）で初めて成立
    // （b79 時点では 79。次回は b80+51=b131 だが譜面は 90 まで）
    expect(acts.map((a) => [a.beat, a.phase])).toEqual([[80, "last"]]);
  });
});

describe("開幕型の行個別適用（わたあめ、半分こ型）", () => {
  /** わたあめ型: スキル単位=無条件 / 行1=無条件 / 行2=ビジュアルレーン条件（改行なし） */
  const wataameSkill = (laneNumber: LaneNumber): SkillDef =>
    skill({
      id: "sk-test-wataame",
      lane: laneNumber,
      kind: "P",
      ct: 45,
      condition: "none", // スキル単位トリガーなし（改行あり条件を持たない）
      effects: [
        { type: "skill_success_up", stages: 5, durationBeats: 30, target: "self", condition: "none" },
        { type: "visual_up", stages: 3, durationBeats: 30, target: "self", condition: "self_visual_lane" },
      ],
    });

  it("非ビジュアルレーン: b1 前半に発動し、1行目（無条件行）のみ適用", () => {
    const lanes = defaultLanes();
    lanes[0] = lane(1, { attribute: "dance", skills: [wataameSkill(1)] });
    const res = simulateTimeline(input(beatNotes(10), lanes));
    const act = res.activations.find((a) => a.skillId === "sk-test-wataame" && a.success);
    expect(act).toBeDefined();
    expect(act!.beat).toBe(1);
    expect(act!.phase).toBe("first"); // 開幕型
    const b1 = res.beats[0]!;
    expect(b1.buffSnapshots[0]!.skill_success_up).toBe(5); // 行1は適用
    expect(b1.buffSnapshots[0]!.visual_up).toBe(0); // 行2はレーン条件不一致で不適用
  });

  it("ビジュアルレーン: b1 前半に発動し、両行が適用される", () => {
    const lanes = defaultLanes();
    lanes[0] = lane(1, { attribute: "visual", skills: [wataameSkill(1)] });
    const res = simulateTimeline(input(beatNotes(10), lanes));
    const b1 = res.beats[0]!;
    expect(b1.buffSnapshots[0]!.skill_success_up).toBe(5);
    expect(b1.buffSnapshots[0]!.visual_up).toBe(3);
  });

  it("発動順: 開幕型（わたあめ型）→ 条件型（金魚すくい型）の順に発動する", () => {
    const lanes = defaultLanes();
    lanes[0] = lane(1, {
      attribute: "visual",
      skills: [wataameSkill(1), kingyoSkill(1)],
    });
    const res = simulateTimeline(input(beatNotes(10), lanes));
    const wAct = res.activations.find((a) => a.skillId === "sk-test-wataame" && a.success)!;
    const kAct = res.activations.find((a) => a.skillId === "sk-test-kingyo" && a.success)!;
    // 開幕型が先（b1 前半）。条件型は 1レーン1ビート1P の予算で b1 には発動できず b2 後半
    // （実機で b1 に同レーン2スキルが連続発動するかは未観測【要追加実測】。
    //  ユーザー確定は「P2,P1の順番」までで、順序はこちらのモデルでも保存される）
    expect(wAct.beat).toBe(1);
    expect(wAct.phase).toBe("first");
    expect(kAct.beat).toBeGreaterThan(wAct.beat);
    expect(kAct.phase).toBe("last");
  });
});

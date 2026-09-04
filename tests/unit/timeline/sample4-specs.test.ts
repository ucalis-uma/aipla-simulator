/**
 * サンプル4実測（2026-09-04〜05）で確定・対応した仕様の単体テスト（合成ミニフィクスチャのみ）。
 *
 * 検証観点（research/22_sample4_gap_analysis・fable 5.1 解析結果）:
 * - S4-1: 強化効果譲渡（effect_passing / strength_effect_assignment_all）は「移動（move）」
 *   発動レーンから有効な強化効果（isEnhancementEffect）が除去され、対象レーンへ移行する。
 *   低下効果（vocal_down 等）は移動せず発動レーンに残る。
 * - S4-2: 強化効果延長（effect_extension）は強化効果のみを延長する。
 *   低下効果（vocal_down, dance_down, visual_down, stamina_cost_up）は延長されない。
 * - S4-3: isEnhancementEffect の判定
 *   強化系バフ（dance_up, tension_up, critical_rate_up, combo_continue等）は true、
 *   低下効果（dance_down, stamina_cost_up等）および非段階型は false。
 * - S4-4: ダンス上限解放（limitRelease: true）による 30 段クランプ
 *   通常上限 20 段（×2.0）に対し、limitRelease があれば 30 段（×2.5 = 2500‰）まで有効。
 * - S4-5: スキルノーツ FAIL（SP未習得 no_skill / CT中 in_ct）によるコンボ切断
 *   コンボ継続バフがない場合、全レーンのコンボが 0 にリセットされるが MISS は加算されない。
 */
import { describe, expect, it } from "vitest";
import { aggregateBuffs, isEnhancementEffect } from "../../../src/timeline/buffs.js";
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
    vocal: 50000,
    dance: 100000,
    visual: 50000,
    stamina: 100000,
    mental: 1000,
    critical: 0,
    ...overrides,
  };
}

function lane(lane: LaneNumber, overrides: Partial<LaneInput> = {}): LaneInput {
  return {
    lane,
    attribute: "dance",
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
    id: "stage-sample4-spec",
    laneAttributes: [2, 2, 2, 2, 2],
    beatWeightsPermil: { vocal: 250, dance: 600, visual: 150 },
    skillWeightsPermil: { active: 1000, special: 1000 },
    stageFactorPermil: 1000,
    skillStaminaWeightPermil: 1000,
    ...overrides,
  };
}

function noteForLane(beat: number, noteType: 1 | 2 | 3, laneNum: LaneNumber): ChartNote {
  const laneToPos: Record<LaneNumber, number> = {
    3: 1,
    2: 2,
    4: 3,
    1: 4,
    5: 5,
  };
  return { beat, noteType, position: laneToPos[laneNum] as any };
}

function runSim(
  lanes: LaneInput[],
  chartNotes: ChartNote[],
  stg: StageInput = stage(),
) {
  const input: SimulateInput = {
    stage: stg,
    lanes,
    notes: chartNotes,
    liveBonusSkills: [],
    criticalProvider: () => false,
    rng: new ConstRng(),
    comboAdvantageTable: [],
    fanFactorPermil: 1000,
  };
  return simulateTimeline(input);
}

describe("Sample 4 Specs: isEnhancementEffect", () => {
  it("enhancement effects return true and debuffs return false", () => {
    // 強化系
    expect(isEnhancementEffect("dance_up")).toBe(true);
    expect(isEnhancementEffect("vocal_up")).toBe(true);
    expect(isEnhancementEffect("visual_up")).toBe(true);
    expect(isEnhancementEffect("score_up")).toBe(true);
    expect(isEnhancementEffect("a_skill_score_up")).toBe(true);
    expect(isEnhancementEffect("sp_skill_score_up")).toBe(true);
    expect(isEnhancementEffect("beat_score_up")).toBe(true);
    expect(isEnhancementEffect("critical_rate_up")).toBe(true);
    expect(isEnhancementEffect("critical_coeff_up")).toBe(true);
    expect(isEnhancementEffect("tension_up")).toBe(true);
    expect(isEnhancementEffect("combo_continue")).toBe(true);
    expect(isEnhancementEffect("dance_boost")).toBe(true);

    // デバフ系
    expect(isEnhancementEffect("dance_down")).toBe(false);
    expect(isEnhancementEffect("vocal_down")).toBe(false);
    expect(isEnhancementEffect("visual_down")).toBe(false);
    expect(isEnhancementEffect("stamina_cost_up")).toBe(false);

    // 即時系・非段階型
    expect(isEnhancementEffect("score_get")).toBe(false);
    expect(isEnhancementEffect("stamina_recovery")).toBe(false);
  });
});

describe("Sample 4 Specs: Dance Limit Release (30 stages clamp)", () => {
  it("clamps dance_up at 20 stages normally, but allows up to 30 with limitRelease", () => {
    // limitRelease なし: 25段あっても20段（×2.0 = 2000‰）にクランプ
    const normalAgg = aggregateBuffs([
      {
        type: "dance_up",
        stages: 25,
        remainingBeats: 10,
        sourceSkillId: "s1",
        sourceLane: 1,
        limitRelease: false,
      },
    ]);
    expect(normalAgg.dance_up).toBe(20);

    // limitRelease あり: 上限が30段になり、25段まで有効
    const lrAgg = aggregateBuffs([
      {
        type: "dance_up",
        stages: 10,
        remainingBeats: 10,
        sourceSkillId: "s1",
        sourceLane: 1,
        limitRelease: true,
      },
      {
        type: "dance_up",
        stages: 25,
        remainingBeats: 10,
        sourceSkillId: "s2",
        sourceLane: 1,
        limitRelease: false,
      },
    ]);
    expect(lrAgg.dance_up).toBe(25);

    // 35段あっても30段にクランプ
    const lrAggMax = aggregateBuffs([
      {
        type: "dance_up",
        stages: 10,
        remainingBeats: 10,
        sourceSkillId: "s1",
        sourceLane: 1,
        limitRelease: true,
      },
      {
        type: "dance_up",
        stages: 35,
        remainingBeats: 10,
        sourceSkillId: "s2",
        sourceLane: 1,
        limitRelease: false,
      },
    ]);
    expect(lrAggMax.dance_up).toBe(30);
  });
});

describe("Sample 4 Specs: effect_passing moves buffs and excludes debuffs", () => {
  it("moves enhancement effects to target lane and leaves debuffs on source lane", () => {
    // L2 が自身に dance_up と dance_down を持っている状態で、SP で target=center (L3) へ譲渡
    const l2PassSp: SkillDef = {
      id: "sk-pass-sp",
      name: "Passing SP",
      kind: "SP",
      level: 1,
      lane: 2,
      ct: 0,
      staminaCost: 100,
      effects: [
        {
          type: "effect_passing",
          target: "center",
          condition: "none",
          durationBeats: null,
        },
      ],
    };

    const l2SelfBuffP: SkillDef = {
      id: "sk-self-buff",
      name: "Self Buff P",
      kind: "P",
      level: 1,
      lane: 2,
      ct: 50,
      staminaCost: 0,
      effects: [
        {
          type: "dance_up",
          target: "self",
          condition: "none",
          durationBeats: 20,
          stages: 8,
        },
        {
          type: "dance_down",
          target: "self",
          condition: "none",
          durationBeats: 20,
          stages: 3,
        },
      ],
    };

    const lanes: LaneInput[] = [
      lane(1),
      lane(2, { skills: [l2PassSp, l2SelfBuffP] }),
      lane(3, { role: "Scorer" }),
      lane(4),
      lane(5),
    ];

    // b1: P発動（L2に dance_up と dance_down 付与）
    // b5: L2 SPノーツ（effect_passing 発動）
    // b6: 次のビート（移動後のバフ状態がスナップショットに現れる）
    const notes: ChartNote[] = [
      noteForLane(1, 1, 2),
      noteForLane(5, 3, 2), // SP note on lane 2
      noteForLane(6, 1, 3), // beat note on lane 3
    ];

    const result = runSim(lanes, notes);

    // b6 のビートトレース（b5 SP で移動した結果が反映されている）を確認
    const b6Trace = result.beats.find((b) => b.beat === 6);
    expect(b6Trace).toBeDefined();

    // L2 (index 1): dance_up は移動したので 0、dance_down は残る（3段）
    expect(b6Trace!.buffSnapshots[1]!.dance_up).toBe(0);
    expect(b6Trace!.buffSnapshots[1]!.dance_down).toBe(3);

    // L3 (index 2): dance_up が移動してきたので 8、dance_down は移動しないので 0
    expect(b6Trace!.buffSnapshots[2]!.dance_up).toBe(8);
    expect(b6Trace!.buffSnapshots[2]!.dance_down).toBe(0);
  });
});

describe("Sample 4 Specs: effect_extension only extends enhancement effects", () => {
  it("extends dance_up but does not extend dance_down", () => {
    const l1ExtendA: SkillDef = {
      id: "sk-extend-a",
      name: "Extend A",
      kind: "A",
      level: 1,
      lane: 1,
      ct: 30,
      staminaCost: 100,
      effects: [
        {
          type: "effect_extension",
          target: "center",
          condition: "none",
          durationBeats: null,
          value: 10,
        },
      ],
    };

    const l3BuffP: SkillDef = {
      id: "sk-l3-buff",
      name: "L3 Buffs",
      kind: "P",
      level: 1,
      lane: 3,
      ct: 50,
      staminaCost: 0,
      effects: [
        {
          type: "dance_up",
          target: "self",
          condition: "none",
          durationBeats: 15,
          stages: 5,
        },
        {
          type: "dance_down",
          target: "self",
          condition: "none",
          durationBeats: 15,
          stages: 2,
        },
      ],
    };

    const lanes: LaneInput[] = [
      lane(1, { skills: [l1ExtendA] }),
      lane(2),
      lane(3, { skills: [l3BuffP] }),
      lane(4),
      lane(5),
    ];

    // b1: P発動（L3 に dance_up: 15b, dance_down: 15b）
    // b5: L1 Aノーツ（L3 の強化効果を +10b 延長）
    // b1〜b17 までノーツを生成
    const notes: ChartNote[] = [];
    for (let b = 1; b <= 17; b++) {
      if (b === 5) {
        notes.push(noteForLane(5, 2, 1)); // A note on L1
      } else {
        notes.push(noteForLane(b, 1, 3)); // beat note on L3
      }
    }

    const result = runSim(lanes, notes);

    // b16 時点（元の 15b が切れるタイミング）
    // dance_down は延長されず 15b で切れているため b16 では 0
    // dance_up は +10b 延長（計25b）されたため b16 でも残存（5段）
    const b16Trace = result.beats.find((b) => b.beat === 16);
    expect(b16Trace).toBeDefined();
    expect(b16Trace!.buffSnapshots[2]!.dance_up).toBe(5);
    expect(b16Trace!.buffSnapshots[2]!.dance_down).toBe(0);
  });
});

describe("Sample 4 Specs: Skill note fail causes combo reset without miss count", () => {
  it("resets combo to 0 on no_skill SP note and in_ct A note, keeping miss count at 0", () => {
    const l2SkillA: SkillDef = {
      id: "sk-l2-a",
      name: "L2 A Skill",
      kind: "A",
      level: 1,
      lane: 2,
      ct: 30,
      staminaCost: 50,
      effects: [],
    };

    const lanes: LaneInput[] = [
      lane(1),
      lane(2, { skills: [l2SkillA] }), // SPスキル未所持
      lane(3),
      lane(4),
      lane(5),
    ];

    // b1〜b4: ビートノーツ（コンボ 1→2→3→4）
    // b5: L2 に SP ノーツ → SP未習得のため FAIL（failReason: "no_skill", combo 4→0）
    // b6〜b7: ビートノーツ（コンボ 1→2）
    // b8: L2 に A ノーツ発動（CT 30 設定、combo 3）
    // b10: L2 に 再び A ノーツ → CT中のため FAIL（failReason: "in_ct", combo 3+1→0）
    const notes: ChartNote[] = [
      noteForLane(1, 1, 1),
      noteForLane(2, 1, 1),
      noteForLane(3, 1, 1),
      noteForLane(4, 1, 1),
      noteForLane(5, 3, 2), // SP note on L2 (no_skill)
      noteForLane(6, 1, 1),
      noteForLane(7, 1, 1),
      noteForLane(8, 2, 2), // A note on L2 (success)
      noteForLane(9, 1, 1),
      noteForLane(10, 2, 2), // A note on L2 (in_ct)
    ];

    const result = runSim(lanes, notes);

    // b5 (SP fail) のアクティベーション確認
    const spAct = result.activations.find((a) => a.beat === 5 && a.lane === 2);
    expect(spAct).toBeDefined();
    expect(spAct?.success).toBe(false);
    expect(spAct?.failReason).toBe("no_skill");
    expect(spAct?.comboReset).toBe(true);

    // b5 のコンボは全レーンリセットされて 0
    const b5 = result.beats.find((b) => b.beat === 5);
    expect(b5?.comboAfter).toEqual([0, 0, 0, 0, 0]);

    // b8 (A success) のコンボ確認: b6(1), b7(2) の後、b8 で成功して 3
    const b8 = result.beats.find((b) => b.beat === 8);
    expect(b8?.comboAfter[1]).toBe(3);

    // b10 (A in_ct fail) のアクティベーション確認
    const aAct = result.activations.find((a) => a.beat === 10 && a.lane === 2);
    expect(aAct).toBeDefined();
    expect(aAct?.success).toBe(false);
    expect(aAct?.failReason).toBe("in_ct");
    expect(aAct?.comboReset).toBe(true);

    // b10 のコンボは全レーンリセットされて 0
    const b10 = result.beats.find((b) => b.beat === 10);
    expect(b10?.comboAfter).toEqual([0, 0, 0, 0, 0]);
  });
});

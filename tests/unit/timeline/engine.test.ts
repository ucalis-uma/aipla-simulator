/**
 * タイムラインエンジンの単体テスト（合成ミニフィクスチャのみ・実測大ファイルは使用しない）。
 *
 * 検証観点（research/13_engine_spec.md の規則対応）:
 * - ビートスコアの数値（§5.1）/ 11段階の順序（§3）/ 実効ビート数の窓ずれ（§3-10）
 * - CT 規則: 最小再使用間隔 = CT−1（§3-9・research/08 §2.3 実測則）
 * - コンボ（成功+1/MISSリセット/コンボ継続免除・§5.2）/ 消費スタミナ（§3-4・§6）
 * - P前半の選択順（メンタル降順・同値 [4,2,1,3,5]・§4）/ 対象解決（§7）
 * - 割合型のコンボ/ファン不適用（§5.2）/ type36 scaling（§5.2）/ 集目ファンボーナス（§5.1）
 * - トレース整合（§8）
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

/** 常に固定値を返す RNG（数値検証用・スコア乱数 1000=中立・クリティカルなし） */
class ConstRng implements ScoreRng {
  constructor(
    private readonly roll: number = 1000,
    private readonly crit: boolean = false,
  ) {}
  nextScoreRoll(): number {
    return this.roll;
  }
  nextCritical(): boolean {
    return this.crit;
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
  return [
    lane(1),
    lane(2),
    lane(3, { deck: deck({ vocal: 120000 }) }),
    lane(4, { attribute: "dance" }),
    lane(5),
  ];
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

function note(beat: number, noteType: 1 | 2 | 3, position: 0 | 1 | 2 | 3 | 4): ChartNote {
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

/** position → レーンの確認用（research/13 §5・POSITION_TO_LANE [3,2,4,1,5]） */
describe("simulateTimeline: ビートスコア（§5.1）", () => {
  it("重み込み基本スコア×係数でレーン別に計算される（バフなし・中立乱数）", () => {
    const result = simulateTimeline(input([note(1, 1, 3)]));
    // 総和式: vocal×600‰ + dance×250‰ + visual×150‰、さらに λ=8/140。
    // L1: 60000+12500+3750 = 76250 → ×8/140 = 4357。L3 は vocal 120000 → 88250 → 5042。
    // L4 も総和式のため L1 と同一（属性は dance だが基本スコアは3統計の混成）。
    expect(result.totalScore).toBe(3 * 4357 + 5042 + 4357);
    expect(result.beats[0]?.events).toHaveLength(5);
    const l1 = result.beats[0]?.events.find((e) => e.lane === 1);
    const l3 = result.beats[0]?.events.find((e) => e.lane === 3);
    const l4 = result.beats[0]?.events.find((e) => e.lane === 4);
    expect(l1?.basicScore).toBe(4357);
    expect(l1?.gainedScore).toBe(4357);
    expect(l3?.basicScore).toBe(5042);
    expect(l4?.basicScore).toBe(4357);
    expect(l4?.gainedScore).toBe(4357);
    // コンボはビートノートで全レーン +1
    expect(result.beats[0]?.comboAfter).toEqual([1, 1, 1, 1, 1]);
  });

  it("来場ファンボーナスが乗算される", () => {
    const result = simulateTimeline(input([note(1, 1, 3)], undefined, { fanFactorPermil: 1620 }));
    // 4357 × 1620‰ = 7058（sequential 丸め）
    const l1 = result.beats[0]?.events.find((e) => e.lane === 1);
    expect(l1?.gainedScore).toBe(7058);
  });

  it("集目10段のファンボーナス副効果がファンファクターに加算される", () => {
    const lanes = defaultLanes();
    const l2 = lanes[1];
    if (l2 === undefined) {
      throw new Error("fixture broken");
    }
    l2.photos = [
      skill({
        id: "photo-focus",
        kind: "photo",
        lane: 2,
        ct: null,
        staminaCost: 0,
        effects: [
          {
            type: "focus",
            stages: 10,
            durationBeats: 10,
            target: "self",
            condition: "none",
          },
        ],
      }),
    ];
    const result = simulateTimeline(input([note(1, 1, 3)], lanes, { fanFactorPermil: 1620 }));
    // L2 のみ ファン 1620 + 50（10段）= 1670 → 4357×1.67 = 7276
    const l2Event = result.beats[0]?.events.find((e) => e.lane === 2);
    expect(l2Event?.gainedScore).toBe(7276);
    expect(result.beats[0]?.buffSnapshots[1]?.focus).toBe(10);
  });
});

describe("simulateTimeline: 処理順と実効ビート数（§3）", () => {
  it("前半発動バフは同一ビートのスコアに乗る（表記-1の窓: 付与ビート〜付与+表記-2）", () => {
    const lanes = defaultLanes();
    const l3 = lanes[2];
    if (l3 === undefined) {
      throw new Error("fixture broken");
    }
    l3.skills = [
      skill({
        id: "p-first",
        kind: "P",
        lane: 3,
        ct: 100,
        effects: [
          { type: "vocal_up", stages: 5, durationBeats: 3, target: "self", condition: "none" },
        ],
      }),
    ];
    const result = simulateTimeline(
      input([note(1, 1, 0), note(2, 1, 0), note(3, 1, 0), note(4, 1, 0)], lanes),
    );
    const beat1 = result.beats[0];
    const beat4 = result.beats[3];
    expect(beat1).toBeDefined();
    expect(beat4).toBeDefined();
    // 前半発動（L3 の target self）→ L3 のスナップショット・スコアに反映
    // （L3: vocal 120000×1.25×0.6 = 90000 + 12500 + 3750 = 106250 → ×8/140 = 6071）
    expect(beat1?.buffSnapshots[2]?.vocal_up).toBe(5);
    expect(beat1?.events.find((e) => e.lane === 3)?.basicScore).toBe(6071);
    // ビート2・3も有効（残り2→1）
    expect(result.beats[1]?.buffSnapshots[2]?.vocal_up).toBe(5);
    expect(result.beats[2]?.buffSnapshots[2]?.vocal_up).toBe(5);
    // ビート4は期限切れ（残り0→除去）
    expect(beat4?.buffSnapshots[2]?.vocal_up).toBe(0);
    expect(beat4?.events.find((e) => e.lane === 3)?.basicScore).toBe(5042);
  });

  it("後半発動バフは翌ビートから乗る（表記どおりの窓）", () => {
    const lanes = defaultLanes();
    const l3 = lanes[2];
    if (l3 === undefined) {
      throw new Error("fixture broken");
    }
    l3.skills = [
      skill({
        id: "p-last",
        kind: "P",
        lane: 3,
        ct: 100,
        effects: [
          {
            type: "vocal_up",
            stages: 5,
            durationBeats: 3,
            target: "self",
            condition: "self_vocal_lane", // L3 は vocal → 条件成立・後半発動
          },
        ],
      }),
    ];
    const notes = [1, 2, 3, 4, 5].map((b) => note(b, 1, 0));
    const result = simulateTimeline(input(notes, lanes));
    const activation = result.activations.find((a) => a.skillId === "p-last");
    expect(activation?.phase).toBe("last");
    expect(activation?.beat).toBe(1);
    // ビート1のスコアには乗らない
    expect(result.beats[0]?.buffSnapshots[2]?.vocal_up).toBe(0);
    expect(result.beats[0]?.events.find((e) => e.lane === 3)?.basicScore).toBe(5042);
    // ビート2〜4 で有効（表記どおり3ビート）
    expect(result.beats[1]?.buffSnapshots[2]?.vocal_up).toBe(5);
    expect(result.beats[2]?.buffSnapshots[2]?.vocal_up).toBe(5);
    expect(result.beats[3]?.buffSnapshots[2]?.vocal_up).toBe(5);
    // ビート5は期限切れ
    expect(result.beats[4]?.buffSnapshots[2]?.vocal_up).toBe(0);
  });
});

describe("simulateTimeline: CT 規則（§3-9・research/08 §2.3）", () => {
  it("Aスキルの最小再使用間隔は CT（CT10 → gap10・【T5実測確定】CT満タンセット+ステップ9減算）", () => {
    const lanes = defaultLanes();
    const l1 = lanes[0];
    if (l1 === undefined) {
      throw new Error("fixture broken");
    }
    l1.skills = [
      skill({
        id: "a1",
        kind: "A",
        lane: 1,
        ct: 10,
        staminaCost: 0,
        effects: [
          { type: "score_get", powerPermil: 1000, target: "self", condition: "none", durationBeats: null },
        ],
      }),
    ];
    // pos4 → L1 のAノート（position 1始まり: pos1→L3, 2→L2, 3→L4, 4→L1, 5→L5）
    const notes = Array.from({ length: 12 }, (_, i) => note(i + 1, 2, 4));
    const result = simulateTimeline(input(notes, lanes));
    const successes = result.activations.filter((a) => a.success);
    // 発動時 CT満タン → ステップ9減算で b10 開始時に残1 → b10 のステップ9で0になるが
    // A ノートはステップ8発動のため b10 は不発、b11 から再使用可（gap CT=10）。
    // Pスキル前半発動の場合は CT0 到達ビートの step11 で発火するため gap CT−1（実測 b1→b50）。
    expect(successes.map((a) => a.beat)).toEqual([1, 11]);
    // 中間ビートは in_ct で FAIL
    const ctFails = result.activations.filter((a) => !a.success && a.failReason === "in_ct");
    expect(ctFails.map((a) => a.beat)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
  });
});

describe("simulateTimeline: コンボとA/SPノートのレーン归属（§5.2）", () => {
  it("A/SPノートは該当レーンのみ挑戦し、成功+1 / no_skill リセット / コンボ継続で免除", () => {
    const lanes = defaultLanes();
    const l1 = lanes[0];
    const l2 = lanes[1];
    if (l1 === undefined || l2 === undefined) {
      throw new Error("fixture broken");
    }
    l1.skills = [
      skill({
        id: "a1",
        kind: "A",
        lane: 1,
        ct: 50,
        effects: [
          { type: "score_get", powerPermil: 1000, target: "self", condition: "none", durationBeats: null },
        ],
      }),
    ];
    // L2: コンボ継続を付与する Pスキル（b1 前半発動）
    l2.skills = [
      skill({
        id: "pc",
        kind: "P",
        lane: 2,
        effects: [
          { type: "combo_continue", durationBeats: 50, target: "self", condition: "none" },
        ],
      }),
    ];
    const result = simulateTimeline(
      input(
        [note(1, 1, 0), note(2, 2, 4), note(3, 2, 2), note(4, 2, 3)],
        lanes,
      ),
    );
    // b1 ビート: 全レーン +1 → [1,1,1,1,1]
    expect(result.beats[0]?.comboAfter).toEqual([1, 1, 1, 1, 1]);
    // b2 A(pos4→L1): L1 成功 +1。他レーンは挑戦しないためコンボは変化しない
    expect(result.beats[1]?.comboAfter).toEqual([2, 1, 1, 1, 1]);
    // b3 A(pos2→L2): L2 は no_skill だがコンボ継続で維持
    expect(result.beats[2]?.comboAfter).toEqual([2, 1, 1, 1, 1]);
    // b4 A(pos3→L4): L4 は no_skill・コンボ継続なし → リセット
    expect(result.beats[3]?.comboAfter).toEqual([2, 1, 1, 0, 1]);
    // 挑戦しないレーンの FAIL は記録されない（L1/L2/L4 のみトレース存在）
    expect(result.activations.filter((a) => !a.success).map((a) => a.lane).sort()).toEqual([2, 4]);
  });
});

describe("simulateTimeline: スタミナ（§3-4・§6）", () => {
  it("消費低減バフが消費スタミナに乗算される", () => {
    const lanes = defaultLanes();
    const l1 = lanes[0];
    if (l1 === undefined) {
      throw new Error("fixture broken");
    }
    l1.skills = [
      skill({
        id: "pd",
        kind: "P",
        lane: 1,
        ct: 100, // テスト中に再発動しない（発動ビートで消費バフは残存する）
        effects: [
          { type: "stamina_cost_down", stages: 10, durationBeats: 50, target: "self", condition: "none" },
        ],
      }),
      skill({
        id: "pe",
        kind: "P",
        lane: 1,
        staminaCost: 1000,
        effects: [
          { type: "vocal_up", stages: 1, durationBeats: 5, target: "self", condition: "none" },
        ],
      }),
    ];
    const result = simulateTimeline(input([note(1, 1, 3), note(2, 1, 3)], lanes));
    // b1 前半: pd 発動（cost 0）。pe は前半予算で未発火。b2 前半: pe 発動 → 消費 1000×(1000−500)‰=500
    const pe = result.activations.find((a) => a.skillId === "pe");
    expect(pe?.success).toBe(true);
    expect(pe?.staminaCost).toBe(500);
    expect(result.finalStamina[0]).toBe(100000 - 500);
  });

  it("スタミナ不足は FAIL stamina_short で発動しない", () => {
    const lanes = defaultLanes();
    const l1 = lanes[0];
    if (l1 === undefined) {
      throw new Error("fixture broken");
    }
    l1.skills = [
      skill({
        id: "p-expensive",
        kind: "P",
        lane: 1,
        staminaCost: 200000,
        effects: [
          { type: "vocal_up", stages: 1, durationBeats: 5, target: "self", condition: "none" },
        ],
      }),
    ];
    const result = simulateTimeline(input([note(1, 1, 3)], lanes));
    const attempt = result.activations.find((a) => a.skillId === "p-expensive");
    expect(attempt?.success).toBe(false);
    expect(attempt?.failReason).toBe("stamina_short");
  });
});

describe("simulateTimeline: P前半の選択順（§4）", () => {
  it("メンタル降順・同値は [4,2,1,3,5] 順で発動する", () => {
    const lanes: LaneInput[] = [
      lane(1, { deck: deck({ mental: 400 }) }),
      lane(2, { deck: deck({ mental: 500 }) }),
      lane(3, { deck: deck({ mental: 300 }) }),
      lane(4, { deck: deck({ mental: 500 }) }),
      lane(5, { deck: deck({ mental: 200 }) }),
    ];
    for (const l of lanes) {
      l.skills = [
        skill({
          id: `p-${l.lane}`,
          kind: "P",
          lane: l.lane,
          effects: [
            { type: "vocal_up", stages: 1, durationBeats: 2, target: "self", condition: "none" },
          ],
        }),
      ];
    }
    const result = simulateTimeline(input([note(1, 1, 0)], lanes));
    const firstHalf = result.activations
      .filter((a) => a.phase === "first" && a.success)
      .map((a) => a.lane);
    // メンタル: L4=L2(500・同値→[4,2]順) > L1(400) > L3(300) > L5(200)
    expect(firstHalf).toEqual([4, 2, 1, 3, 5]);
  });
});

describe("simulateTimeline: 対象解決（§7）", () => {
  it("neighbors は左右隣レーンに付与される", () => {
    const lanes = defaultLanes();
    const l2 = lanes[1];
    if (l2 === undefined) {
      throw new Error("fixture broken");
    }
    l2.skills = [
      skill({
        id: "p-neighbors",
        kind: "P",
        lane: 2,
        effects: [
          { type: "vocal_up", stages: 5, durationBeats: 3, target: "neighbors", condition: "none" },
        ],
      }),
    ];
    const result = simulateTimeline(input([note(1, 1, 0)], lanes));
    const snaps = result.beats[0]?.buffSnapshots;
    expect(snaps?.[0]?.vocal_up).toBe(5); // L1
    expect(snaps?.[1]?.vocal_up).toBe(0); // L2 発動者自身には乗らない
    expect(snaps?.[2]?.vocal_up).toBe(5); // L3
    expect(snaps?.[3]?.vocal_up).toBe(0);
    expect(snaps?.[4]?.vocal_up).toBe(0);
  });

  it("all は全5レーンに付与される", () => {
    const lanes = defaultLanes();
    const l3 = lanes[2];
    if (l3 === undefined) {
      throw new Error("fixture broken");
    }
    l3.skills = [
      skill({
        id: "p-all",
        kind: "P",
        lane: 3,
        effects: [
          { type: "score_up", stages: 2, durationBeats: 3, target: "all", condition: "none" },
        ],
      }),
    ];
    const result = simulateTimeline(input([note(1, 1, 0)], lanes));
    const snaps = result.beats[0]?.buffSnapshots;
    expect(snaps?.every((s) => s.score_up === 2)).toBe(true);
  });
});

describe("simulateTimeline: 割合型・スケーリング（§5.2）", () => {
  it("割合型はコンボ・ファンボーナスを適用しない", () => {
    const lanes = defaultLanes();
    const l3 = lanes[2];
    if (l3 === undefined) {
      throw new Error("fixture broken");
    }
    l3.skills = [
      skill({
        id: "sp-ratio",
        kind: "SP",
        lane: 3,
        ct: 50,
        effects: [
          {
            type: "score_get_by_score_ratio",
            powerPermil: 120,
            target: "self",
            condition: "none",
            durationBeats: null,
          },
        ],
      }),
    ];
    // b1 ビート（ファン1620）で 4×7058+8168 = 36400 積算 → b2 SP(pos1→L3):
    // 基本スコア = floor(36400×120/1000) = 4368
    const result = simulateTimeline(
      input([note(1, 1, 0), note(2, 3, 1)], lanes, { fanFactorPermil: 1620 }),
    );
    const ratioEvent = result.beats[1]?.events.find((e) => e.lane === 3);
    expect(ratioEvent?.basicScore).toBe(4368);
    // ファンが適用されるなら 4368×1.62=7076 になるため、4368 のまま = 不適用の証明
    expect(ratioEvent?.gainedScore).toBe(4368);
  });

  it("type36 scaling で SkillPower が段数に応じて増加する", () => {
    const lanes = defaultLanes();
    const l3 = lanes[2];
    const l1 = lanes[0];
    if (l3 === undefined || l1 === undefined) {
      throw new Error("fixture broken");
    }
    l1.skills = [
      skill({
        id: "p-vup",
        kind: "P",
        lane: 1,
        ct: 100,
        effects: [
          { type: "vocal_up", stages: 5, durationBeats: 5, target: "all", condition: "none" },
        ],
      }),
    ];
    l3.skills = [
      skill({
        id: "sp-scaled",
        kind: "SP",
        lane: 3,
        ct: 50,
        effects: [
          {
            type: "score_get",
            powerPermil: 1000,
            target: "self",
            condition: "none",
            durationBeats: null,
            scaling: { ref: "vocal_up_stages", perStagePermil: 100, fitted: false },
          },
        ],
      }),
    ];
    // b1: ビート+P前半（vocal_up 5段付与）。b2: SP(pos1→L3) → 有効SkillPower = 1000×(1000+500)/1000 = 1500
    const result = simulateTimeline(input([note(1, 1, 0), note(2, 3, 1)], lanes));
    const spEvent = result.beats[1]?.events.find((e) => e.lane === 3);
    expect(spEvent?.skillPowerPermil).toBe(1500);
  });
});

describe("simulateTimeline: トレース整合（§8）", () => {
  it("activations フラット列と totalScore がビート列と一致する", () => {
    const lanes = defaultLanes();
    const l1 = lanes[0];
    if (l1 === undefined) {
      throw new Error("fixture broken");
    }
    l1.skills = [
      skill({
        id: "a1",
        kind: "A",
        lane: 1,
        ct: 50,
        effects: [
          { type: "score_get", powerPermil: 4500, target: "self", condition: "none", durationBeats: null },
        ],
      }),
    ];
    const result = simulateTimeline(input([note(1, 1, 3), note(2, 2, 4)], lanes));
    const flat = result.beats.flatMap((b) => b.activations);
    expect(flat).toEqual(result.activations);
    const sum = result.beats.reduce((acc, b) => acc + b.gainedScore, 0);
    expect(sum).toBe(result.totalScore);
    // Aスキル発動の獲得スコア: L1 vocal 100000×1000‰=100000 基本で
    // SkillPower 4500‰ → b1 スコア後の B1/combo で算出される（トレースは行単位）
    const aEvent = result.beats[1]?.events.find((e) => e.lane === 1);
    expect(aEvent).toBeDefined();
    expect(aEvent?.skillPowerPermil).toBe(4500);
  });
});

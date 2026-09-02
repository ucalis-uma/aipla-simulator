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
  LaneScoreEventTrace,
  SimulateInput,
  SkillDef,
  SkillEffect,
  StageInput,
} from "../../../src/timeline/types.js";
import type { ScoreRng } from "../../../src/rng/types.js";
import type { StatValues } from "../../../src/types.js";

/** 常に固定値を返す RNG（数値検証用・スコア乱数 1000=中立・クリティカルなし） */
class ConstRng implements ScoreRng {
  constructor(
    private readonly roll: number = 1000,
    private readonly crit: boolean = false,
    private readonly float: number = 0,
  ) {}
  nextScoreRoll(): number {
    return this.roll;
  }
  nextCritical(): boolean {
    return this.crit;
  }
  nextFloat(): number {
    return this.float;
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

describe("simulateTimeline: over-cap 内部保持（【ユーザー確定 2026-08-30】）", () => {
  it("上限超過の付与は切り捨てず、期限切れ後も内部段数が上限以上なら上限を維持する", () => {
    // L3 に vocal_up を 19段[5b] + 2段[2b] + 2段[3b]（後半発動）で付与:
    //   b1: 19+2=21 → 表示20（超過分は切り捨てない）
    //   b2: 21 → 20
    //   b3: 2段[2b]が期限切れ → 内部21 → 表示20を維持（旧仕様の付与時切り捨てなら19に落ちる）
    //   b4/b5: 21 → 20
    //   b6: 全インスタンス期限切れ → 0
    const lanes = defaultLanes();
    const l3 = lanes[2];
    if (l3 === undefined) {
      throw new Error("fixture broken");
    }
    l3.skills = [
      skill({
        id: "p-19",
        kind: "P",
        lane: 3,
        ct: 100,
        effects: [
          { type: "vocal_up", stages: 19, durationBeats: 5, target: "self", condition: "none" },
        ],
      }),
      skill({
        id: "p-2",
        kind: "P",
        lane: 3,
        ct: 100,
        effects: [
          {
            type: "vocal_up",
            stages: 2,
            durationBeats: 3,
            target: "self",
            condition: "self_vocal_lane", // L3 は vocal → 後半発動
          },
        ],
      }),
    ];
    l3.photos = [
      skill({
        id: "ph-2",
        kind: "photo",
        lane: 3,
        limitPerLive: 1, // b1 のみ発動（ct:null のフォトの毎ビート再発動を防止）
        effects: [
          { type: "vocal_up", stages: 2, durationBeats: 2, target: "self", condition: "none" },
        ],
      }),
    ];
    const notes = [1, 2, 3, 4, 5, 6].map((b) => note(b, 1, 0));
    const result = simulateTimeline(input(notes, lanes));
    const snaps = result.beats.map((bt) => bt.buffSnapshots[2]?.vocal_up);
    expect(snaps).toEqual([20, 20, 20, 20, 20, 0]);
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
    // b4 A(pos3→L4): L4 は no_skill・コンボ継続なし → 全レーンの表示コンボがリセット
    // （サンプル1実測確定 2026-09-01・b56 の COMBO 55→0。旧仕様「失敗レーンのみリセット」は T5 では
    // 全レーンがコンボ継続を持つため検証機会がなく、サンプル1で棄却された）
    expect(result.beats[3]?.comboAfter).toEqual([0, 0, 0, 0, 0]);
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
  it("メンタル降順・同値は [3,2,4,1,5]（発動優先位置①〜⑤順）で発動する", () => {
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
    // メンタル: L4=L2(500・同値→タイブレーク [3,2,4,1,5] で L2 が先) > L1(400) > L3(300) > L5(200)
    expect(firstHalf).toEqual([2, 4, 1, 3, 5]);
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
    // b1 ビートで L3 自身 4×7058+8168 = 36400、そのうち同レーンの累積は 8168
    // （割合行の基準 = 自身レーンの累積。旧基準の全体累積 36400 ではない）
    const result = simulateTimeline(
      input([note(1, 1, 0), note(2, 3, 1)], lanes, { fanFactorPermil: 1620 }),
    );
    const ratioEvent = result.beats[1]?.events.find((e) => e.lane === 3);
    expect(ratioEvent?.basicScore).toBe(980);
    // ファンが適用されるなら 980×1.62=1588 になるため、980 のまま = 不適用の証明
    expect(ratioEvent?.gainedScore).toBe(980);
  });

  it("SP は A と同様にマスタ順で処理され、スコアは自身バフ適用前のステータス（PRE）を参照する", () => {
    const lanes = defaultLanes();
    const l3 = lanes[2];
    if (l3 === undefined) {
      throw new Error("fixture broken");
    }
    l3.skills = [
      skill({
        id: "sp-order",
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
          },
          // 技能文の並び: スコア獲得 → 自身のステータスアップ（vb はスコア後に適用）
          { type: "vocal_boost", stages: 3, durationBeats: 5, target: "self", condition: "none" },
        ],
      }),
    ];
    // b1 ビートで L3（vocal 120000）を発動させる; SP の基本スコアは vb 適用前の 120,000 のまま
    const result = simulateTimeline(input([note(1, 3, 1), note(2, 1, 1)], lanes));
    const spEvent = result.beats[0]?.events.find((e) => e.lane === 3);
    expect(spEvent?.basicScore).toBe(120000);
    expect(spEvent?.gainedScore).toBe(120000);
    // その後、自身の vb3 が付与されている（次ビートのスナップに反映 = スコア行が先）
    const snap = result.beats[1]?.buffSnapshots?.[2];
    expect(snap?.vocal_boost ?? 0).toBe(3);
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

/**
 * 【Phase 6】マスタ一般化: dance/visual バフ・beat_score_up・拡張ターゲット。
 * 【Estimate】実測ゴールデンに同型なし（vocal 対称の実装検証）。
 */
describe("simulateTimeline: Phase 6 マスタ一般化", () => {
  it("dance_up は dance 属性レーンのビート基本スコア（dance 成分）を倍増させる", () => {
    const lanes = defaultLanes();
    const l4 = lanes[3];
    if (l4 === undefined) throw new Error("fixture broken");
    l4.skills = [
      skill({
        id: "p-dup",
        kind: "P",
        lane: 4,
        effects: [
          { type: "dance_up", stages: 10, durationBeats: 5, target: "self", condition: "none" },
        ],
      }),
    ];
    // L4 基本値（バフなし・dance 属性でも総和式）: vocal 60000 + dance 12500 + visual 3750 = 76250
    // dance_up 10段 → dance 成分 12500×(1000+500)/1000 = 18750 → 76250+6250 = 82500
    const withBuff = simulateTimeline(input([note(1, 1, 0)], lanes));
    const ev = withBuff.beats[0]?.events.find((e) => e.lane === 4);
    // 基本スコア = floor(82500×8/140) = 4714
    expect(ev?.basicScore).toBe(Math.floor((82500 * 8) / 140));
  });

  it("beat_score_up はビート B1 に 100‰/段で乗る", () => {
    const lanes = defaultLanes();
    const l1 = lanes[0];
    if (l1 === undefined) throw new Error("fixture broken");
    l1.skills = [
      skill({
        id: "p-bsu",
        kind: "P",
        lane: 1,
        effects: [
          { type: "beat_score_up", stages: 3, durationBeats: 5, target: "all", condition: "none" },
        ],
      }),
    ];
    const res = simulateTimeline(input([note(1, 1, 0)], lanes));
    const ev = res.beats[0]?.events.find((e) => e.lane === 1);
    // b1 = 1000 + 100×3 = 1300
    expect(ev?.b1Permil).toBe(1300);
  });

  it("dance_type_1 / buffer_type_1 の対象解決", () => {
    const lanes = defaultLanes();
    const l3 = lanes[2];
    if (l3 === undefined) throw new Error("fixture broken");
    lanes[0]!.role = "Buffer";
    lanes[4]!.role = "Buffer";
    lanes[3]!.role = "Buffer";
    l3.skills = [
      skill({
        id: "p-tgt",
        kind: "P",
        lane: 3,
        effects: [
          // dance_type_1 → dance 属性は L4 のみ（ct 用の発動可否とは無関係・スナップショットで確認）
          { type: "vocal_up", stages: 2, durationBeats: 5, target: "dance_type_1", condition: "none" },
        ],
      }),
      skill({
        id: "p-tgt2",
        kind: "P",
        lane: 3,
        // buffer_type_1 → Buffer ロールの中で属性ステータス最大（L4 dance 280000? → deck[attribute]）
        effects: [
          { type: "score_up", stages: 2, durationBeats: 5, target: "buffer_type_1", condition: "none" },
        ],
      }),
    ];
    const res = simulateTimeline(input([note(1, 1, 0)], lanes));
    const snap = res.beats[0]?.buffSnapshots[3]; // L4
    // dance_type_1 = L4 → vocal_up が L4 に付与される
    expect(snap?.vocal_up).toBe(2);
  });
});

/**
 * 【Peing確定 2026-08-30】動的クリティカル発生率（質問箱 id=1189080032 / id=1186806688）。
 * effectiveCritRate = min(0.50, baseCritRate) + critical_rate_up段 × 5%。
 * - >= 1.0 → 確定（抽選なし）
 * - それ以外 → rng.nextFloat() < effectiveCritRate
 */
describe("simulateTimeline: 動的クリティカル発生率（Peing確定 2026-08-30）", () => {
  /** クリティカル判定のみ観測する RNG（スコア乱数は中立） */
  class CritProbeRng implements ScoreRng {
    readonly floats: number[] = [];
    constructor(private readonly value: () => number) {}
    nextScoreRoll(): number {
      return 1000;
    }
    nextCritical(): boolean {
      return false;
    }
    nextFloat(): number {
      const v = this.value();
      this.floats.push(v);
      return v;
    }
  }

  function oneBeatWithRate(
    baseCritRate: number | undefined,
    float: number,
    effect?: SkillEffect,
  ): { events: LaneScoreEventTrace[]; floats: number[] } {
    const lanes = defaultLanes();
    const l1 = lanes[0];
    if (l1 === undefined) throw new Error("fixture broken");
    if (effect) {
      l1.skills = [skill({ id: "p-crit", kind: "P", lane: 1, effects: [effect] })];
    }
    const rng = new CritProbeRng(() => float);
    const res = simulateTimeline(
      input([note(1, 1, 0)], lanes, {
        rng,
        baseCritRate,
        // baseCritRate 未指定時のフォールバックが呼ばれたことを検出できるように
        criticalProvider: () => {
          throw new Error("criticalProvider should not be called in dynamic mode");
        },
      }),
    );
    return { events: res.beats[0]?.events ?? [], floats: rng.floats };
  }

  it("baseCritRate=0.5・バフなし → 抽選（float < 0.5 で発生）", () => {
    const crit = oneBeatWithRate(0.5, 0.499).events.find((e) => e.lane === 1);
    expect(crit?.critFactorPermil).toBeGreaterThan(1000);
    const noCrit = oneBeatWithRate(0.5, 0.5).events.find((e) => e.lane === 1);
    // 境界: float === rate は不発生（厳密な <）
    expect(noCrit?.critFactorPermil).toBe(1000);
  });

  it("基礎率は 0.50 で頭打ち（0.8 を指定しても 0.5 相当）", () => {
    // 0.5 < float < 0.8 の値で発生しなければクランプの証明
    const ev = oneBeatWithRate(0.8, 0.6).events.find((e) => e.lane === 1);
    expect(ev?.critFactorPermil).toBe(1000);
    const ev2 = oneBeatWithRate(0.8, 0.499).events.find((e) => e.lane === 1);
    expect(ev2?.critFactorPermil).toBeGreaterThan(1000);
  });

  it("critical_rate_up 10段で 0.5+0.5=100% → 確定（抽選呼び出しなし）", () => {
    const { events, floats } = oneBeatWithRate(0.5, 0.999, {
      type: "critical_rate_up",
      stages: 10,
      durationBeats: 5,
      target: "all",
      condition: "none",
    });
    expect(events.find((e) => e.lane === 1)?.critFactorPermil).toBeGreaterThan(1000);
    // 確定クリティカルは nextFloat を消費しない
    expect(floats).toHaveLength(0);
  });

  it("baseCritRate=0 でも critical_rate_up 20段で 100% 確定", () => {
    const ev = oneBeatWithRate(0, 0.999, {
      type: "critical_rate_up",
      stages: 20,
      durationBeats: 5,
      target: "all",
      condition: "none",
    }).events.find((e) => e.lane === 1);
    expect(ev?.critFactorPermil).toBeGreaterThan(1000);
  });

  it("未指定時は criticalProvider にフォールバック（ゴールデン互換）", () => {
    const lanes = defaultLanes();
    const res = simulateTimeline(
      input([note(1, 1, 0)], lanes, { criticalProvider: () => true }),
    );
    // 全レーン crit → critF > 1000
    for (const e of res.beats[0]?.events ?? []) {
      expect(e.critFactorPermil).toBeGreaterThan(1000);
    }
  });

  it("フォトのスコア行は動的モードでもクリティカル判定の対象外", () => {
    const lanes = defaultLanes();
    const l1 = lanes[0];
    if (l1 === undefined) throw new Error("fixture broken");
    l1.photos = [
      skill({
        id: "photo-x",
        kind: "photo",
        lane: 1,
        ct: null,
        effects: [
          { type: "score_get", powerPermil: 400, target: "self", condition: "none", durationBeats: null },
        ],
      }),
    ];
    // P 前半でフォト発動 → score_get 行は crit にならない（確定クリティカル条件でも）
    const res = simulateTimeline(input([note(1, 1, 0)], lanes, { baseCritRate: 0.5 }));
    const photoEv = res.beats[0]?.events.find((e) => e.sourceKind === "photo");
    expect(photoEv).toBeDefined();
    expect(photoEv?.critFactorPermil).toBe(1000);
  });
});

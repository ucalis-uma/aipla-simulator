/**
 * 包括的未対応スキルトリガー実装（ステップA）の単体テスト。
 *
 * 検証対象:
 * 1. 配置レーン条件 (self_center, self_most_left, self_most_right)
 * 2. 自身の状態条件 (status_vocal_up, status_focus 等)
 * 3. スタミナ割合条件 (stamina>=N, stamina<=N, someone_stamina<=N)
 * 4. 編成人数・特定キャラ条件 (count_<key>>=N)
 * 5. 段階数条件 (someone_<status>>=N)
 * 6. 行動直前条件 (self_before_special, someone_before_active)
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
    return true;
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
    stamina: 10000,
    mental: 1000,
    critical: 0,
    ...overrides,
  };
}

function lane(laneNum: LaneNumber, overrides: Partial<LaneInput> = {}): LaneInput {
  return {
    lane: laneNum,
    attribute: "vocal",
    deck: deck(),
    skills: [],
    photos: [],
    scoreBonusPct: { beat: 0, active: 0, special: 0, passive: 0 },
    critExtrasPermil: 0,
    ...overrides,
  };
}

function note(beat: number, laneNum: LaneNumber, type: 1 | 2 | 3 = 1): ChartNote {
  return {
    beat,
    position: (laneNum - 1) as 0 | 1 | 2 | 3 | 4,
    noteType: type,
  };
}

function stage(): StageInput {
  return {
    id: "test-stage",
    laneAttributes: [1, 1, 1, 1, 1],
    beatWeightsPermil: { vocal: 1000, dance: 0, visual: 0 },
    skillWeightsPermil: { active: 1000, special: 1000 },
    stageFactorPermil: 1000,
  };
}

function createSkill(partial: Partial<SkillDef> & { id: string }): SkillDef {
  return {
    name: partial.id,
    kind: "P",
    level: 6,
    lane: 1,
    ct: 50,
    staminaCost: 0,
    effects: [],
    ...partial,
  };
}

function createInput(overrides: Partial<SimulateInput>): SimulateInput {
  return {
    lanes: [lane(1), lane(2), lane(3), lane(4), lane(5)],
    notes: [note(1, 1)],
    stage: stage(),
    fanFactorPermil: 1000,
    criticalProvider: () => false,
    rng: new ConstRng(),
    ...overrides,
  };
}

describe("未対応条件スキルの包括的判定テスト", () => {
  it("配置レーン条件: self_center は L3 でのみ発動し他レーンでは不発", () => {
    const centerSkill = createSkill({
      id: "test-center-p",
      name: "センター限定P",
      kind: "P",
      effects: [
        {
          type: "vocal_up",
          target: "self",
          condition: "self_center",
          stages: 5,
          durationBeats: 10,
        },
      ],
    });

    // L3 に装備
    const lanesL3: LaneInput[] = [
      lane(1),
      lane(2),
      lane(3, { skills: [centerSkill] }),
      lane(4),
      lane(5),
    ];
    const resL3 = simulateTimeline(createInput({ lanes: lanesL3, notes: [note(1, 3)] }));
    const actL3 = resL3.activations.find((a) => a.skillId === "test-center-p");
    expect(actL3).toBeDefined();
    expect(actL3?.success).toBe(true);

    // L1 に装備（不発となること）
    const lanesL1: LaneInput[] = [
      lane(1, { skills: [centerSkill] }),
      lane(2),
      lane(3),
      lane(4),
      lane(5),
    ];
    const resL1 = simulateTimeline(createInput({ lanes: lanesL1, notes: [note(1, 1)] }));
    const actL1 = resL1.activations.find((a) => a.skillId === "test-center-p");
    expect(actL1).toBeUndefined();
  });

  it("配置レーン条件: self_most_left は L1 でのみ発動、self_most_right は L5 でのみ発動", () => {
    const leftSkill = createSkill({
      id: "test-left-p",
      name: "左端限定P",
      kind: "P",
      effects: [
        {
          type: "dance_up",
          target: "self",
          condition: "self_most_left",
          stages: 3,
          durationBeats: 10,
        },
      ],
    });
    const rightSkill = createSkill({
      id: "test-right-p",
      name: "右端限定P",
      kind: "P",
      effects: [
        {
          type: "visual_up",
          target: "self",
          condition: "self_most_right",
          stages: 3,
          durationBeats: 10,
        },
      ],
    });

    const lanes: LaneInput[] = [
      lane(1, { skills: [leftSkill] }),
      lane(2, { skills: [rightSkill] }), // L2 に右端スキル（不発期待）
      lane(3),
      lane(4),
      lane(5, { skills: [rightSkill] }), // L5 に右端スキル（発動期待）
    ];
    const res = simulateTimeline(createInput({ lanes, notes: [note(1, 1), note(1, 5)] }));
    expect(res.activations.some((a) => a.lane === 1 && a.skillId === "test-left-p")).toBe(true);
    expect(res.activations.some((a) => a.lane === 2 && a.skillId === "test-right-p")).toBe(false);
    expect(res.activations.some((a) => a.lane === 5 && a.skillId === "test-right-p")).toBe(true);
  });

  it("自身の状態条件: status_focus は集目状態のときのみ発動", () => {
    // b1 で自身に集目を付与するPスキル
    const grantFocus = createSkill({
      id: "grant-focus",
      name: "集目付与",
      kind: "P",
      effects: [{ type: "focus", target: "self", condition: "none", stages: 5, durationBeats: 5 }],
    });
    // 集目状態の時にのみ発動するPスキル
    const reqFocus = createSkill({
      id: "req-focus",
      name: "集目条件P",
      kind: "P",
      effects: [
        { type: "score_up", target: "self", condition: "status_focus", stages: 5, durationBeats: 5 },
      ],
    });

    // L1 に両方装備
    const lanes: LaneInput[] = [
      lane(1, { skills: [grantFocus, reqFocus] }),
      lane(2),
      lane(3),
      lane(4),
      lane(5),
    ];
    const res = simulateTimeline(createInput({ lanes, notes: [note(1, 1), note(2, 1)] }));
    // b1 で grant-focus が発動し、b2 で req-focus が集目状態のため発動
    const actReq = res.activations.find((a) => a.skillId === "req-focus");
    expect(actReq).toBeDefined();
    expect(actReq?.success).toBe(true);
  });

  it("スタミナ割合条件: stamina>=80 と stamina<=50 の境界判定", () => {
    const highStamSkill = createSkill({
      id: "high-stam",
      name: "高スタミナP",
      kind: "P",
      effects: [
        { type: "vocal_up", target: "self", condition: "stamina>=80", stages: 3, durationBeats: 5 },
      ],
    });
    const lowStamSkill = createSkill({
      id: "low-stam",
      name: "低スタミナP",
      kind: "P",
      effects: [
        { type: "vocal_up", target: "self", condition: "stamina<=50", stages: 3, durationBeats: 5 },
      ],
    });

    // スタミナ満タン (100%) のレーン
    const lanes: LaneInput[] = [
      lane(1, { skills: [highStamSkill, lowStamSkill] }),
      lane(2),
      lane(3),
      lane(4),
      lane(5),
    ];
    const res = simulateTimeline(createInput({ lanes, notes: [note(1, 1)] }));
    expect(res.activations.some((a) => a.skillId === "high-stam")).toBe(true);
    expect(res.activations.some((a) => a.skillId === "low-stam")).toBe(false);
  });

  it("編成人数・キャラ条件: count_ktn>=1 と count_moon>=2 の判定", () => {
    const ktnSkill = createSkill({
      id: "req-ktn",
      name: "琴乃編成条件",
      kind: "P",
      ct: 50,
      staminaCost: 50,
      effects: [
        { type: "vocal_up", target: "self", condition: "count_ktn>=1", stages: 3, durationBeats: 5 },
      ],
    });
    const moonSkill = createSkill({
      id: "req-moon2",
      name: "月スト2人以上条件",
      kind: "P",
      ct: 50,
      staminaCost: 50,
      effects: [
        { type: "dance_up", target: "self", condition: "count_moon>=2", stages: 3, durationBeats: 5 },
      ],
    });
    const ruiSkill = createSkill({
      id: "req-rui",
      name: "瑠衣編成条件",
      kind: "P",
      ct: 50,
      staminaCost: 50,
      effects: [
        { type: "visual_up", target: "self", condition: "count_rui>=1", stages: 3, durationBeats: 5 },
      ],
    });

    // 編成キャラ: 長瀬琴乃(char-ktn), 伊吹渚(char-ngs) = 月スト2人。天動瑠衣(char-rui)は不在。
    const lanes: LaneInput[] = [
      lane(1, { skills: [ktnSkill] }),
      lane(2, { skills: [moonSkill, ruiSkill] }),
      lane(3),
      lane(4),
      lane(5),
    ];
    const res = simulateTimeline(
      createInput({
        lanes,
        notes: [note(1, 1)],
        formationCharacterIds: ["char-ktn", "char-ngs", "char-rio", "char-aoi", "char-ai"],
      }),
    );
    expect(res.activations.some((a) => a.skillId === "req-ktn")).toBe(true);
    expect(res.activations.some((a) => a.skillId === "req-moon2")).toBe(true);
    expect(res.activations.some((a) => a.skillId === "req-rui")).toBe(false); // 瑠衣不在のため不発
  });

  it("段階数条件: someone_vocal_up>=20 は20段階以上が存在する場合のみ成立", () => {
    // 20段ボーカルバフを付与するスキル
    const grant20 = createSkill({
      id: "grant-vo-20",
      name: "20段付与",
      kind: "P",
      ct: 50,
      staminaCost: 10,
      effects: [{ type: "vocal_up", target: "self", condition: "none", stages: 20, durationBeats: 5 }],
    });
    // 誰かのボーカル上昇が20段以上のとき発動するスキル
    const reqVo20 = createSkill({
      id: "req-vo-20",
      name: "20段条件P",
      kind: "P",
      ct: 50,
      staminaCost: 10,
      effects: [
        {
          type: "score_up",
          target: "all",
          condition: "someone_vocal_up>=20",
          stages: 5,
          durationBeats: 5,
        },
      ],
    });

    const lanes: LaneInput[] = [
      lane(1, { skills: [grant20] }),
      lane(2, { skills: [reqVo20] }),
      lane(3),
      lane(4),
      lane(5),
    ];
    const res = simulateTimeline(createInput({ lanes, notes: [note(1, 1), note(2, 2)] }));
    // b1 で L1 が 20段付与、b2 で L2 がそれを検知して発動
    const act = res.activations.find((a) => a.skillId === "req-vo-20");
    expect(act).toBeDefined();
    expect(act?.success).toBe(true);
  });

  it("自身のSP直前条件: self_before_special は自レーンのSPノート精算直前（前半）に発動", () => {
    const spSkill = createSkill({
      id: "my-sp",
      name: "自身SP",
      kind: "SP",
      staminaCost: 500,
      effects: [{ type: "score_get", target: "self", condition: "none", powerPermil: 10000 }],
    });
    const beforeSpSkill = createSkill({
      id: "before-my-sp",
      name: "自身SP直前バフ",
      kind: "P",
      ct: 50,
      staminaCost: 50,
      effects: [
        {
          type: "critical_rate_up",
          target: "self",
          condition: "self_before_special",
          stages: 5,
          durationBeats: 5,
        },
      ],
    });

    // L3 に SPスキル と SP直前バフを装備
    const lanes: LaneInput[] = [
      lane(1),
      lane(2),
      lane(3, { skills: [spSkill, beforeSpSkill] }),
      lane(4),
      lane(5),
    ];
    // b3 に L3（ランク1）の SP ノート（noteType 3, position: 1）
    const spNote: ChartNote = { beat: 3, noteType: 3, position: 1 };
    const res = simulateTimeline(createInput({ lanes, notes: [note(1, 1), spNote] }));
    // b3 で SP直前バフが発動していること
    const act = res.activations.find((a) => a.skillId === "before-my-sp");
    expect(act).toBeDefined();
    expect(act?.beat).toBe(3);
    expect(act?.success).toBe(true);
  });
});

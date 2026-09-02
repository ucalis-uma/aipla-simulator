/**
 * サンプル1実測（2026-09-01）で確定した仕様の単体テスト（合成ミニフィクスチャのみ）。
 *
 * 検証観点（aipura_nox/サンプル1/issues.md §1 確定分）:
 * - 1-2: SP FAIL のコンボ処理（コンボ継続なし=全リセット / あり=表示コンボのみ +1）
 * - 1-4: someone_before_special（誰かがSPスキル発動前・前半発動・対象=SPレーン）
 * - 1-1: フォト装着制限（restriction: <サポータータイプのみ> 等のロール不一致で不発）
 * - 1-3: <属性>レーンN人対象（target-position_attribute_X-N → *_lane_N・レーン番号順先頭N）
 * - ビートCB基準 = 表示コンボ（T5 では beat-1 と一致・リセット譜面では逸脱する）
 */
import { describe, expect, it } from "vitest";
import { simulateTimeline } from "../../../src/timeline/engine.js";
import type {
  ChartNote,
  LaneInput,
  LaneNumber,
  SimulateInput,
  SkillDef,
  SkillEffect,
  StageInput,
} from "../../../src/timeline/types.js";
import type { ComboAdvantageRow } from "../../../src/formula/combo.js";
import type { ScoreRng } from "../../../src/rng/types.js";
import type { StatValues } from "../../../src/types.js";

/** 常に固定値を返す RNG（数値検証用・スコア乱数 1000=中立・クリティカルなし） */
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

/**
 * コンボ閾値を小さくしたテーブル（表示コンボの差を comboFactorPermil で観測する用）。
 * 実テーブル（10/20/30...）では小コンボ帯の係数が同一のため区別できない。
 */
const SMALL_COMBO_TABLE: readonly ComboAdvantageRow[] = [
  { combo: 1, advantagePermil: 1100 },
  { combo: 2, advantagePermil: 1200 },
  { combo: 3, advantagePermil: 1300 },
];

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

/** position → レーン写像の確認用（POSITION_TO_LANE [3,2,4,1,5]: pos1→L3, pos2→L2） */

/** 1-2（サンプル1 b56）: SP FAIL・コンボ継続なし → 全レーンのコンボと表示コンボがリセット */
describe("サンプル1確定仕様: SP FAIL のコンボ処理", () => {
  it("コンボ継続バフなしの SP FAIL は全レーンのコンボ・表示コンボを 0 にリセットする", () => {
    // b3 = SP ノート（pos2 → L2）。L2 は SP スキル未所持 → no_skill FAIL。
    // b4 のビート CB がリセット後の表示コンボ 0 基準（factor 1000）になることを確認。
    const result = simulateTimeline(
      input(
        [note(1, 1, 3), note(2, 1, 3), note(3, 3, 2), note(4, 1, 3)],
        undefined,
        { comboAdvantageTable: SMALL_COMBO_TABLE },
      ),
    );
    const fail = result.beats[2]?.activations[0];
    expect(fail).toMatchObject({ beat: 3, lane: 2, kind: "SP", success: false, failReason: "no_skill" });
    // b3 後: 全レーンのコンボが 0 にリセット
    expect(result.beats[2]?.comboAfter).toEqual([0, 0, 0, 0, 0]);
    // b2 のビート CB はリセット前の表示コンボ 1 基準。docs「コンボのボーナス」表では
    // 0-9 → +0% のため B2 = 1000‰（旧実装の「1100 = 全体×csu 乗算」は廃止）
    const b2l1 = result.beats[1]?.events.find((e) => e.lane === 1);
    expect(b2l1?.comboFactorPermil).toBe(1000);
    // b4 のビート CB はリセット後の表示コンボ 0 基準（+0‰・リセットなしなら +200‰）
    const b4l1 = result.beats[3]?.events.find((e) => e.lane === 1);
    expect(b4l1?.comboFactorPermil).toBe(1000);
    // b4 でコンボは 1 から再構築
    expect(result.finalCombo).toEqual([1, 1, 1, 1, 1]);
  });

  it("コンボ継続バフありの SP FAIL（T5 b49）はリセットせず表示コンボのみ +1 する", () => {
    // L2 にコンボ継続 Pスキル（b1 前半発動・40ビート）。b2 SP FAIL でもリセットされない。
    const lanes: LaneInput[] = defaultLanes();
    const ccEffect: SkillEffect = {
      type: "combo_continue",
      stages: 1,
      durationBeats: 40,
      target: "self",
      condition: "none",
    };
    lanes[1] = lane(2, { skills: [skill({ id: "cc", lane: 2, ct: 50, effects: [ccEffect] })] });
    const result = simulateTimeline(
      input([note(1, 1, 3), note(2, 3, 2), note(3, 1, 3), note(4, 1, 3)], lanes, {
        comboAdvantageTable: SMALL_COMBO_TABLE,
      }),
    );
    // b1 前半でコンボ継続が発動
    expect(result.beats[0]?.activations).toContainEqual(
      expect.objectContaining({ lane: 2, skillId: "cc", success: true }),
    );
    // b2 SP FAIL（no_skill）後もレーン別コンボは 1 のまま（リセットされず・加算もされない）
    expect(result.beats[1]?.activations[0]).toMatchObject({
      beat: 2,
      lane: 2,
      kind: "SP",
      success: false,
      failReason: "no_skill",
    });
    expect(result.beats[1]?.comboAfter).toEqual([1, 1, 1, 1, 1]);
    // b3 のビート CB は表示コンボ 2 基準。docs 表 0-9 → +0% のため B2 = 1000‰
    const b3l1 = result.beats[2]?.events.find((e) => e.lane === 1);
    expect(b3l1?.comboFactorPermil).toBe(1000);
    // b4 は表示コンボ 3 基準（docs 表 0-9 → +0% のため B2 = 1000‰）
    const b4l1 = result.beats[3]?.events.find((e) => e.lane === 1);
    expect(b4l1?.comboFactorPermil).toBe(1000);
  });
});

/** 1-4（サンプル1 b143）: 誰かがSPスキル発動前（someone_before_special） */
describe("サンプル1確定仕様: someone_before_special", () => {
  /** L4 の SP前置き Pスキル（発動対象は trigger=SPレーン） */
  const beforeSpecialSkill = (lane: LaneNumber): SkillDef =>
    skill({
      id: "before-special",
      lane,
      ct: 50,
      effects: [
        {
          type: "critical_rate_up",
          stages: 7,
          durationBeats: 37,
          target: "trigger",
          condition: "someone_before_special",
        },
      ],
    });

  it("SPノート到来ビートの前半に発動し、SPレーンへ事前バフを付与する（b143）", () => {
    // b2 = SP ノート（pos1 → L3）。L3 は SP スキル所持 → 発動可能 → L4 の前置きが成立。
    const lanes: LaneInput[] = defaultLanes();
    lanes[2] = lane(3, {
      deck: deck({ vocal: 120000 }),
      skills: [
        skill({
          id: "sp-l3",
          kind: "SP",
          lane: 3,
          ct: 40,
          effects: [{ type: "score_get", powerPermil: 500, target: "self", condition: "none" }],
        }),
      ],
    });
    lanes[3] = lane(4, { skills: [beforeSpecialSkill(4)] });
    const result = simulateTimeline(input([note(1, 1, 3), note(2, 3, 1), note(3, 1, 3)], lanes));
    const acts = result.beats[1]?.activations ?? [];
    // 前半（first）で発動
    expect(acts).toContainEqual(
      expect.objectContaining({ lane: 4, phase: "first", skillId: "before-special", success: true }),
    );
    // L3 の SP が発動（main）
    expect(acts).toContainEqual(expect.objectContaining({ lane: 3, phase: "main", kind: "SP", success: true }));
    // 対象 = trigger（SPレーン L3）のみ。クリティカル率上昇 7 段がスコア計算前に付与
    expect(result.beats[1]?.buffSnapshots[2]?.critical_rate_up).toBe(7);
    expect(result.beats[1]?.buffSnapshots[3]?.critical_rate_up).toBe(0);
    // SP ノートのないビートでは発動しない
    expect(result.activations.filter((a) => a.skillId === "before-special")).toHaveLength(1);
  });

  it("SPレーンが SP スキルを発動できないビートでは成立しない（b56・L2 SP 未所持）", () => {
    // b2 = SP ノート（pos2 → L2）。L2 は SP 未所持 → 前置き条件は不成立。
    const lanes: LaneInput[] = defaultLanes();
    lanes[3] = lane(4, { skills: [beforeSpecialSkill(4)] });
    const result = simulateTimeline(input([note(1, 1, 3), note(2, 3, 2), note(3, 1, 3)], lanes));
    expect(result.activations.filter((a) => a.skillId === "before-special")).toHaveLength(0);
  });
});

/** 1-1（サンプル1実測）: フォト装着制限（restriction） */
describe("サンプル1確定仕様: フォト装着制限", () => {
  const restrictedPhoto = (lane: LaneNumber, id: string): SkillDef =>
    skill({
      id,
      kind: "photo",
      lane,
      restriction: "supporter_only",
      effects: [{ type: "vocal_up", stages: 3, durationBeats: 30, target: "self", condition: "none" }],
    });

  it("ロール不一致レーンのフォトは不発・一致レーンのみ発動する", () => {
    const lanes: LaneInput[] = defaultLanes();
    lanes[0] = lane(1, { role: "Supporter", photos: [restrictedPhoto(1, "photo-l1")] });
    lanes[3] = lane(4, { role: "Buffer", attribute: "dance", photos: [restrictedPhoto(4, "photo-l4")] });
    const result = simulateTimeline(input([note(1, 1, 3), note(2, 1, 3)], lanes));
    // L1（Supporter）は発動、L4（Buffer）は常時不発（トレースにも出ない）
    expect(result.activations.filter((a) => a.skillId === "photo-l1").length).toBeGreaterThanOrEqual(1);
    expect(result.activations.filter((a) => a.skillId === "photo-l4")).toHaveLength(0);
    expect(result.beats[0]?.buffSnapshots[0]?.vocal_up).toBe(3);
    expect(result.beats[0]?.buffSnapshots[3]?.vocal_up).toBe(0);
  });
});

/** 1-3（サンプル1実測・麻奈も立った大舞台）: <属性>レーンN人（*_lane_N） */
describe("サンプル1確定仕様: 属性レーンN人対象", () => {
  const laneTargetSkill = (lane: LaneNumber, id: string, target: SkillEffect["target"]): SkillDef =>
    skill({
      id,
      lane,
      ct: 50,
      effects: [{ type: "score_up", stages: 3, durationBeats: 20, target, condition: "none" }],
    });

  it("vocal_lane_3 はボーカルレーンの先頭3レーン（L1,L2,L3）に解決される", () => {
    // 既定レーン属性: L1,L2,L3,L5 = vocal・L4 = dance → 先頭3 = L1,L2,L3
    const lanes: LaneInput[] = defaultLanes();
    lanes[0] = lane(1, { skills: [laneTargetSkill(1, "mana-stage", "vocal_lane_3")] });
    const result = simulateTimeline(input([note(1, 1, 3)], lanes));
    const snaps = result.beats[0]?.buffSnapshots ?? [];
    expect(snaps[0]?.score_up).toBe(3);
    expect(snaps[1]?.score_up).toBe(3);
    expect(snaps[2]?.score_up).toBe(3);
    expect(snaps[3]?.score_up).toBe(0); // dance レーン
    expect(snaps[4]?.score_up).toBe(0); // vocal だが4番目
  });

  it("dance_lane_2 はダンスレーンの先頭2レーン（レーン番号順）に解決される", () => {
    const lanes: LaneInput[] = [
      lane(1, { attribute: "dance" }),
      lane(2, { attribute: "vocal" }),
      lane(3, { attribute: "dance" }),
      lane(4, { attribute: "visual" }),
      lane(5, { attribute: "vocal" }),
    ];
    lanes[0] = lane(1, {
      attribute: "dance",
      skills: [laneTargetSkill(1, "dance-lane2", "dance_lane_2")],
    });
    const result = simulateTimeline(input([note(1, 1, 3)], lanes));
    const snaps = result.beats[0]?.buffSnapshots ?? [];
    expect(snaps[0]?.score_up).toBe(3);
    expect(snaps[2]?.score_up).toBe(3);
    expect(snaps[1]?.score_up).toBe(0);
    expect(snaps[3]?.score_up).toBe(0);
    expect(snaps[4]?.score_up).toBe(0);
  });
});

/** 1-4（サンプル1実測・殻をやぶる）: <属性>タイプN人 = メンバータイプ × レーン優先度順 */
describe("サンプル1確定仕様: 属性タイプN人対象", () => {
  const typeTargetSkill = (lane: LaneNumber, id: string, target: SkillEffect["target"]): SkillDef =>
    skill({
      id,
      lane,
      ct: 50,
      effects: [{ type: "score_up", stages: 3, durationBeats: 20, target, condition: "none" }],
    });

  it("vocal_type_2 はメンバータイプ vocal のレーンをレーン優先度順（L3>L2>L4>L1>L5）で先頭2に解決される", () => {
    // サンプル1実測: L1=こころ(vocalカード), L2=莉央(vocal), L3=愛(vocal), L4=千紗(visual),
    // L5=沙季(vocal)。プール {L1,L2,L3,L5} → 優先度順 L3>L2 → {L3,L2}。
    // レーン属性（L2=ダンスレーン・L4=ボーカルレーン）とは独立。デッキvocal降順説（L3,L1）は棄却。
    const lanes: LaneInput[] = defaultLanes();
    const cardType: Record<LaneNumber, "vocal" | "visual"> = {
      1: "vocal",
      2: "vocal",
      3: "vocal",
      4: "visual",
      5: "vocal",
    };
    for (const l of lanes) {
      l.cardType = cardType[l.lane]!;
    }
    lanes[4] = lane(5, {
      attribute: "vocal",
      cardType: "vocal",
      skills: [typeTargetSkill(5, "kara-o-yaburu", "vocal_type_2")],
    });
    const result = simulateTimeline(input([note(1, 1, 3)], lanes));
    const snaps = result.beats[0]?.buffSnapshots ?? [];
    expect(snaps[2]?.score_up).toBe(3); // L3（優先度1位）
    expect(snaps[1]?.score_up).toBe(3); // L2（優先度2位・ダンスレーンだが vocal カード）
    expect(snaps[0]?.score_up).toBe(0); // L1（vocal カードだが優先度4位）
    expect(snaps[3]?.score_up).toBe(0); // L4（visual カード・プール外）
    expect(snaps[4]?.score_up).toBe(0); // L5（発動者・優先度5位）
  });
});

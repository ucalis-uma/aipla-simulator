/**
 * サンプル3実測（2026-09-03）で確定・対応した仕様の単体テスト（合成ミニフィクスチャのみ）。
 *
 * 検証観点（aipura_nox/サンプル3/issues.md・research/21_sample3_gap_analysis）:
 * - S3-1: ステージのスタミナ消費倍率（Quest.skillStaminaWeightPermil。STAGE045 は 3000=3.0倍。
 *   8 件以上の発動で 1 の位一致・F1）。省略時は 1000（T5/S1/S2 不変）。
 * - S3-2: battle_only 行は通常ライブで適用不能のため「無条件行」に数えない
 *   （[combo>=50, battle_only] 型の P が b1 前半発動して limit を消費する誤りを修正。
 *   S3 L2「誰も知らない雲の向こうへ」は b50（combo>=50 成立）に発動）。
 * - S3-3: <属性>が高いN人（*_high_N）はライブ中ステータス降順で解決
 *   （STAGE045 ライボ「ビジュアルが高い2人」: b1 {L4,L3} / b61 {L4,L1}。
 *   deck 順では b61 にさらけ出すも発動してしまい実測と矛盾）。
 * - S3-4: 継続回復 tick = 15 × 段階 × ライブ特徴（research/02 §1.8。
 *   S3 実測: のんびり/泥酔とも +45/beat = 15×3×1.0。100+ デルタで確定）。
 * - S3-5: ライブボーナスの CT 短縮による早期再発動の回帰ロック（issues #1 の棄却記録）。
 *   開幕 P 発動は CT を消費しないのではなく、b1 ライボ（CT-47）が CT を削った結果
 *   b3/b13 に再発動する（頑固 b1→b3・さらけ出す b1→b13 を現行エンジンが再現）。
 */
import { describe, expect, it } from "vitest";
import { aggregateBuffs } from "../../../src/timeline/buffs.js";
import { applySkillCtCuts } from "../../../src/sim/build.js";
import { simulateTimeline } from "../../../src/timeline/engine.js";
import type {
  ChartNote,
  LaneInput,
  LaneNumber,
  LiveBonusSkillDef,
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

function liveBonus(partial: Partial<LiveBonusSkillDef> & { id: string }): LiveBonusSkillDef {
  return {
    name: partial.id,
    kind: "live_bonus",
    level: 5,
    lane: null,
    ct: 60,
    staminaCost: 0,
    probabilityPermil: 1000,
    limitPerLive: null,
    condition: "none",
    effects: [],
    ...partial,
  } as LiveBonusSkillDef;
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

/** S3-1: ステージのスタミナ消費倍率 */
describe("サンプル3確定仕様: スタミナ消費倍率（skillStaminaWeightPermil）", () => {
  const costSkill = (laneNumber: LaneNumber): SkillDef =>
    skill({
      id: "sk-test-cost",
      lane: laneNumber,
      kind: "P",
      ct: null,
      staminaCost: 100,
      effects: [{ type: "score_up", stages: 1, durationBeats: 10, target: "self", condition: "none" }],
    });
  const oneBeat = [note(1, 1, 0)];

  it("3000 のステージでは消費が 3 倍になる（STAGE045・424×3=1272 型）", () => {
    const lanes = defaultLanes();
    lanes[0] = lane(1, { skills: [costSkill(1)] });
    const res = simulateTimeline(
      input(oneBeat, lanes, { stage: stage({ skillStaminaWeightPermil: 3000 }) }),
    );
    expect(res.beats[0]!.staminaAfter[0]).toBe(100000 - 300);
  });

  it("省略時・1000 のステージでは等倍のまま（T5/S1/S2 不変）", () => {
    const lanes = defaultLanes();
    lanes[0] = lane(1, { skills: [costSkill(1)] });
    const resDefault = simulateTimeline(input(oneBeat, lanes));
    expect(resDefault.beats[0]!.staminaAfter[0]).toBe(100000 - 100);
    const res1000 = simulateTimeline(
      input(oneBeat, lanes, { stage: stage({ skillStaminaWeightPermil: 1000 }) }),
    );
    expect(res1000.beats[0]!.staminaAfter[0]).toBe(100000 - 100);
  });
});

/** S3-2: battle_only 行は無条件扱いしない */
describe("サンプル3確定仕様: battle_only 行は無条件行に数えない", () => {
  // S3 L2「誰も知らない雲の向こうへ」型: [条件行, battle_only 行]・limit=1
  const condSkill = (laneNumber: LaneNumber): SkillDef =>
    skill({
      id: "sk-test-cond",
      lane: laneNumber,
      kind: "P",
      ct: 0,
      staminaCost: 100,
      limitPerLive: 1,
      effects: [
        { type: "vocal_up", stages: 9, durationBeats: 64, target: "self", condition: "someone_score_up" },
        { type: "vocal_down", stages: 10, durationBeats: 64, target: "self", condition: "battle_only" },
      ],
    });
  const granter = (laneNumber: LaneNumber): SkillDef =>
    skill({
      id: "sk-test-grant",
      lane: laneNumber,
      kind: "P",
      ct: null,
      staminaCost: 0,
      effects: [{ type: "score_up", stages: 1, durationBeats: 10, target: "self", condition: "none" }],
    });

  it("b1 前半には発動しない（旧実装は発動してスタミナ+limit を消費した）", () => {
    const lanes = defaultLanes();
    lanes[4] = lane(5, { skills: [condSkill(5)] });
    const res = simulateTimeline(input([note(1, 1, 0)], lanes));
    const firstPhase = res.beats[0]!.activations.filter(
      (a) => a.skillId === "sk-test-cond" && a.phase === "first",
    );
    expect(firstPhase).toHaveLength(0);
    // スタミナも limit も消費されていない
    expect(res.beats[0]!.staminaAfter[4]).toBe(100000);
  });

  it("条件成立ビートの後半に発動する（前発動型ではない）", () => {
    const lanes = defaultLanes();
    lanes[0] = lane(1, { skills: [granter(1)] });
    lanes[4] = lane(5, { skills: [condSkill(5)] });
    const res = simulateTimeline(input([note(1, 1, 0)], lanes));
    const fired = res.beats[0]!.activations.filter((a) => a.skillId === "sk-test-cond" && a.success);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.phase).toBe("last");
  });
});

/** S3-3: *_high_N はライブ中ステータス降順 */
describe("サンプル3確定仕様: <属性>が高いN人はライブ中値で順位付け", () => {
  it("バフで逆転したレーンが上位になる（b61 {L4,L1} 型）", () => {
    // L1/L3 とも visual レーン。deck は L3 > L1 だが、L1 のみ visual_up で逆転させる。
    // waiter（CT 仕込み用 P・b1 発動で CT50）と booster（visual_up フォト・P 予算と独立）
    const booster = (laneNumber: LaneNumber): SkillDef =>
      skill({
        id: "sk-test-boost",
        lane: laneNumber,
        kind: "photo",
        ct: null,
        staminaCost: 0,
        effects: [{ type: "visual_up", stages: 10, durationBeats: 10, target: "self", condition: "none" }],
      });
    const waiter = (laneNumber: LaneNumber): SkillDef =>
      skill({
        id: "sk-test-wait",
        lane: laneNumber,
        kind: "P",
        ct: 50,
        staminaCost: 0,
        effects: [{ type: "score_up", stages: 1, durationBeats: 10, target: "self", condition: "none" }],
      });
    const lanes = [
      lane(1, { attribute: "visual", deck: deck({ visual: 150000 }), skills: [waiter(1), booster(1)] }),
      lane(2),
      lane(3, { attribute: "visual", deck: deck({ visual: 160000 }), skills: [waiter(3)] }),
      lane(4),
      lane(5),
    ];
    const lb = liveBonus({
      id: "sk-test-lb",
      ct: 1,
      effects: [{ type: "ct_reduction", target: "visual_high_1", condition: "none", value: 50 }],
    });
    // b1: L1 が visual_up（+50% → 225000 で逆転）。b2: ライボ発動で上位1人の CT-50
    const res = simulateTimeline(input([note(1, 1, 0), note(2, 1, 0)], lanes, { liveBonusSkills: [lb] }));
    const b2 = res.beats[1]!;
    const l1fired = b2.activations.some((a) => a.skillId === "sk-test-wait" && a.lane === 1 && a.success);
    const l3fired = b2.activations.some((a) => a.skillId === "sk-test-wait" && a.lane === 3 && a.success);
    // waiter は b1 に発動済み（CT50）。b2 時点で CT が残るのはライボ対象外のみ
    expect(l1fired).toBe(true);
    expect(l3fired).toBe(false);
  });
});

/** S3-4: 継続回復 tick = 15 × 段階 × ライブ特徴 */
describe("サンプル3確定仕様: 継続回復 tick（15×段階×特徴）", () => {
  const recSkill = (laneNumber: LaneNumber): SkillDef =>
    skill({
      id: "sk-test-rec",
      lane: laneNumber,
      kind: "P",
      ct: 100,
      staminaCost: 0,
      effects: [
        { type: "stamina_recovery", value: 2, durationBeats: 3, target: "self", condition: "none" },
      ],
    });

  it("tick 量・持続を中間値で確認する（60×3 beats・burner 併用）", () => {
    // burner はフォト枠（P 予算と独立）にし、毎ビート -100 消費させて tick を読む
    const burner = (laneNumber: LaneNumber): SkillDef =>
      skill({
        id: "sk-test-burn",
        lane: laneNumber,
        kind: "photo",
        ct: 1,
        staminaCost: 100,
        effects: [{ type: "score_up", stages: 1, durationBeats: 10, target: "self", condition: "none" }],
      });
    const lanes2 = defaultLanes();
    // burner を配列先頭に置き、毎ビート -100 消費させて tick を読む
    lanes2[2] = lane(3, { deck: deck({ stamina: 10000 }), skills: [burner(3), recSkill(3)] });
    const res = simulateTimeline(
      input([note(1, 1, 0), note(2, 1, 0), note(3, 1, 0), note(4, 1, 0), note(5, 1, 0)], lanes2, {
        stage: stage({ staminaRecoveryWeightPermil: 2000 }),
      }),
    );
    // b1: rec 付与（tick +60）・burn -100 → 9960。以降 burn -100 + tick +60（b1-b3）
    // b4 以降は回復期限切れ（duration 3）で burn -100 のみ
    const after = res.beats.map((b) => b.staminaAfter[2]);
    expect(after).toEqual([9960, 9920, 9880, 9780, 9680]);
  });

  it("特徴 0・省略時は 1000 扱い（15×2 = 30/beat）", () => {
    // burner はフォト枠（P 予算と独立）。burn は配列2番目でもフォト予算で発動する
    const burner = (laneNumber: LaneNumber): SkillDef =>
      skill({
        id: "sk-test-burn",
        lane: laneNumber,
        kind: "photo",
        ct: null,
        staminaCost: 100,
        effects: [{ type: "score_up", stages: 1, durationBeats: 10, target: "self", condition: "none" }],
      });
    const lanesB = defaultLanes();
    lanesB[2] = lane(3, { deck: deck({ stamina: 10000 }), skills: [recSkill(3), burner(3)] });
    const r0 = simulateTimeline(
      input([note(1, 1, 0)], lanesB, { stage: stage({ staminaRecoveryWeightPermil: 0 }) }),
    );
    expect(r0.beats[0]!.staminaAfter[2]).toBe(10000 - 100 + 30);
    const rOmit = simulateTimeline(input([note(1, 1, 0)], lanesB));
    expect(rOmit.beats[0]!.staminaAfter[2]).toBe(10000 - 100 + 30);
  });
});

/** S3-5: ライボ CT 短縮による早期再発動（issues #1 棄却の回帰ロック） */
describe("サンプル3検証: b1 ライボ CT-47 による b3 再発動", () => {
  it("CT50 の P が b1→b3 に再発動する（頑固 b1→b3 型）", () => {
    const pSkill = (laneNumber: LaneNumber): SkillDef =>
      skill({
        id: "sk-test-p",
        lane: laneNumber,
        kind: "P",
        ct: 50,
        staminaCost: 0,
        effects: [{ type: "score_up", stages: 1, durationBeats: 60, target: "self", condition: "none" }],
      });
    const lanes = defaultLanes();
    lanes[3] = lane(4, { attribute: "visual", deck: deck({ visual: 500000 }), skills: [pSkill(4)] });
    const lb = liveBonus({
      id: "sk-test-lb",
      ct: 60,
      effects: [{ type: "ct_reduction", target: "visual_high_2", condition: "someone_score_up", value: 47 }],
    });
    const res = simulateTimeline(
      input([note(1, 1, 0), note(2, 1, 0), note(3, 1, 0)], lanes, { liveBonusSkills: [lb] }),
    );
    const b1 = res.beats[0]!.activations.filter((a) => a.skillId === "sk-test-p" && a.success);
    expect(b1).toHaveLength(1);
    expect(b1[0]!.phase).toBe("first");
    const b3 = res.beats[2]!.activations.filter((a) => a.skillId === "sk-test-p" && a.success);
    expect(b3).toHaveLength(1);
    expect(b3[0]!.phase).toBe("last");
    const lbFired = res.beats[0]!.activations.filter((a) => a.skillId === "sk-test-lb" && a.success);
    expect(lbFired).toHaveLength(1);
  });
});

/** S3-6: limit_break 行は上限解放のみ（段数不加算。b53 上昇11 型） */describe("サンプル3確定仕様: limit_break 行は段数を加算しない", () => {
  it("頑固4 + 五人3 + 手を伸ばす4 + 上限解放10 → 上昇11（S3 L4 b53 実測）", () => {
    const inst = (stages: number, limitRelease?: boolean) =>
      ({
        type: "visual_up",
        stages,
        remainingBeats: 30,
        sourceSkillId: "test",
        ...(limitRelease === true ? { limitRelease: true as const } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
    const snap = aggregateBuffs([inst(4), inst(3), inst(4), inst(10, true)]);
    expect(snap.visual_up).toBe(11);
  });
});

/** S3-7: フォト付与の静的 CT 短縮（S3 L4・CTカット2nd→A の CT30→25） */
describe("サンプル3確定仕様: ct_cuts（静的 CT 短縮）", () => {
  const mkSkills = () => [
    skill({ id: "sk-test-card-1", lane: 1, kind: "SP", ct: 0 }),
    skill({ id: "sk-test-card-2", lane: 1, kind: "A", ct: 30 }),
    skill({ id: "sk-test-card-3", lane: 1, kind: "P", ct: 50 }),
  ];

  it("2 枠目の CT が 5 短縮される（30→25・他枠不変）", () => {
    const warned: string[] = [];
    const out = applySkillCtCuts(mkSkills(), [{ skill: 2, value: 5 }], (m) => warned.push(m));
    expect(out.map((s) => s.ct)).toEqual([0, 25, 50]);
    expect(warned).toHaveLength(0);
  });

  it("短縮量が CT を上回れば 0 でクランプ・指定なしは不変", () => {
    const warned: string[] = [];
    const out = applySkillCtCuts(mkSkills(), [{ skill: 3, value: 99 }], (m) => warned.push(m));
    expect(out.map((s) => s.ct)).toEqual([0, 30, 0]);
    const same = applySkillCtCuts(mkSkills(), undefined, (m) => warned.push(m));
    expect(same.map((s) => s.ct)).toEqual([0, 30, 50]);
  });

  it("CT25 なら gap 28 で再発動できる（S3 L4A b14→b42 型）", () => {    // CT25 の P: b1 前半発動 → step9 で 24 → b25 開始時 1 → step9 で 0 → b25 後半発動（gap 24）
    // CT30 の対照は b26 後半（gap 25）。gap 28 の A ノート発動はいずれも可能
    const p25 = (laneNumber: LaneNumber): SkillDef =>
      skill({
        id: "sk-test-p25",
        lane: laneNumber,
        kind: "P",
        ct: 25,
        staminaCost: 0,
        effects: [{ type: "score_up", stages: 1, durationBeats: 60, target: "self", condition: "none" }],
      });
    const lanes = defaultLanes();
    lanes[0] = lane(1, { skills: [p25(1)] });
    // CT は処理ビートごとに減るため連番 26 ビートで検証する
    const beats = Array.from({ length: 26 }, (_, i) => note(i + 1, 1, 0));
    const res = simulateTimeline(input(beats, lanes));
    const fired = res.beats
      .filter((b) => b.activations.some((a) => a.skillId === "sk-test-p25" && a.success))
      .map((b) => b.beat);
    // b1 → b25（gap 24 = CT-1）
    expect(fired).toEqual([1, 25]);
  });
});

/** S3-8: キャラ優位は全スコアに乗る（STAGE045 の ⅢX メンバー×2250） */
describe("サンプル3確定仕様: characterAdvantagePermil", () => {
  it("優位レーンのビートが advantagePermil 倍になる（2250 → ×2.25）", () => {
    const bigDeck = deck({ vocal: 100000, dance: 100000, visual: 100000, stamina: 100000 });
    const lanes = defaultLanes();
    lanes[4] = lane(5, { deck: bigDeck, characterAdvantagePermil: 2250 });
    const res = simulateTimeline(input([note(1, 1, 0)], lanes));
    const plainLanes = defaultLanes();
    plainLanes[4] = lane(5, { deck: bigDeck });
    const plain = simulateTimeline(input([note(1, 1, 0)], plainLanes));
    const adv = res.beats[0]!.events.find((e) => e.lane === 5)!.gainedScore;
    const base = plain.beats[0]!.events.find((e) => e.lane === 5)!.gainedScore;
    expect(adv).toBe(Math.floor((base * 2250) / 1000));
    expect(adv).toBeGreaterThan(base * 2);
  });
});

/** S3-9: 延長は継続回復の予約にも効く（S3 のんびり 36→43b） */describe("サンプル3確定仕様: effect_extension は scheduledRecoveries を延長する", () => {
  it("回復予約の残りが +value される（3→8 beats）", () => {
    // 回復+延長の2行を持つ P と、毎ビート消費の burner フォト（予算が独立）
    const recExt = (laneNumber: LaneNumber): SkillDef =>
      skill({
        id: "sk-test-recext",
        lane: laneNumber,
        kind: "P",
        ct: 100,
        staminaCost: 0,
        effects: [
          { type: "stamina_recovery", value: 2, durationBeats: 3, target: "self", condition: "none" },
          { type: "effect_extension", value: 5, target: "self", condition: "none" },
        ],
      });
    const burner = (laneNumber: LaneNumber): SkillDef =>
      skill({
        id: "sk-test-burn",
        lane: laneNumber,
        kind: "photo",
        ct: 1,
        staminaCost: 100,
        effects: [{ type: "score_up", stages: 1, durationBeats: 10, target: "self", condition: "none" }],
      });
    const lanes = defaultLanes();
    lanes[2] = lane(3, { deck: deck({ stamina: 10000 }), skills: [recExt(3), burner(3)] });
    const beats = Array.from({ length: 9 }, (_, i) => note(i + 1, 1, 0));
    const res = simulateTimeline(
      input(beats, lanes, { stage: stage({ staminaRecoveryWeightPermil: 2000 }) }),
    );
    // b1: -100+60 = 9960。以降 burn -100 + tick +60 が b1-b8（8 beats）。b9 は回復切れ
    const after = res.beats.map((b) => b.staminaAfter[2]);
    expect(after).toEqual([9960, 9920, 9880, 9840, 9800, 9760, 9720, 9680, 9580]);
  });
});

/** S3-10: 消費のブースト副効果は属性不問（F1・2026-10-02 実測確定。旧「自属性のみ」は撤回） */describe("サンプル3確定仕様: consumptionMultiplier は属性不問のブースト段数合計", () => {
  it("visual レーンの visual_boost 3 → 1030・他属性ブーストも同じ係数（多属性は足し算）", async () => {
    const { consumptionMultiplierPermil } = await import("../../../src/timeline/buffs.js");
    const snap = (overrides: Record<string, number>) => ({
      vocal_up: 0,
      vocal_boost: 0,
      vocal_up_extreme: 0,
      vocal_down: 0,
      dance_up: 0,
      dance_boost: 0,
      dance_down: 0,
      visual_up: 0,
      visual_boost: 0,
      visual_down: 0,
      beat_score_up: 0,
      tension_up: 0,
      score_up: 0,
      a_skill_score_up: 0,
      sp_skill_score_up: 0,
      p_skill_score_up: 0,
      combo_score_up: 0,
      critical_coeff_up: 0,
      critical_rate_up: 0,
      stamina_cost_down: 0,
      stamina_cost_up: 0,
      skill_success_up: 0,
      focus: 0,
      stealth: 0,
      combo_continue: 0,
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    // S3 L4（visual レーン）: visual_boost 3 → 1030（1884 = floor(610×3)×1.03 と1の位一致）
    expect(consumptionMultiplierPermil(snap({ visual_boost: 3 }))).toBe(1030);
    // 他属性ブーストも同じく +1%/段（S3 L3 の visual レーンに vocal ブースト 5 段 →
    // 実測 2,085 = floor(662×3)×1.05。旧・自属性のみでは 1,986 で不一致だった。）
    // 旧テストの「vocal レーンの dance_boost 3 は無視 → 1000」は実測により撤回（F1）。
    expect(consumptionMultiplierPermil(snap({ vocal_boost: 5 }))).toBe(1050);
    expect(consumptionMultiplierPermil(snap({ dance_boost: 3 }))).toBe(1030);
    // vocal レーンの vocal_boost 4 → 1040（従来どおり）
    expect(consumptionMultiplierPermil(snap({ vocal_boost: 4 }))).toBe(1040);
    // 多属性同時は**足し算**（ユーザー確認 2026-10-02・2 件サンプル）: 3+3+4 = 10 段 → +100‰
    expect(
      consumptionMultiplierPermil(snap({ visual_boost: 3, dance_boost: 3, vocal_boost: 4 })),
    ).toBe(1100);
  });
});

/** S3-11: 残スタミナ参照のスコア変動（佐伯遙子・80%×残率²のdocs式） */
describe("サンプル3確定仕様: score_get の staminaRatioQuad", () => {
  const staminaPhoto = (laneNumber: LaneNumber, cost: number): SkillDef =>
    skill({
      id: "sk-test-stamp",
      lane: laneNumber,
      kind: "photo",
      ct: null,
      staminaCost: cost,
      effects: [
        {
          type: "score_get",
          powerPermil: 1000,
          durationBeats: null,
          target: "self",
          condition: "none",
          scaling: {
            ref: "stamina_remaining",
            perStagePermil: null,
            formula: "staminaRatioQuad",
            maxPermil: 800,
            remainingRatio: true,
          },
        },
      ],
    });
  it("残率100%で×1.8・残率50%で×1.2（発動後スタミナ基準）", () => {
    const mk = (cost: number) => {
      const lanes = defaultLanes();
      lanes[4] = lane(5, {
        deck: deck({ vocal: 100000, dance: 100000, visual: 100000, stamina: 10000 }),
        photos: [staminaPhoto(5, cost)],
      });
      return simulateTimeline(input([note(1, 1, 0)], lanes));
    };
    // cost 0 → 発動後残率 1.0 → power 1800 → basic 100000 × 1.8 = 180000
    const full = mk(0);
    expect(
      full.beats[0]!.events.find((e) => e.lane === 5 && e.sourceKind === "photo")!.gainedScore,
    ).toBe(180000);
    // cost 5000 → 発動後残率 0.5 → power floor(1000×1.2) = 1200 → 120000
    const half = mk(5000);
    expect(
      half.beats[0]!.events.find((e) => e.lane === 5 && e.sourceKind === "photo")!.gainedScore,
    ).toBe(120000);
  });
});

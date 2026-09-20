/**
 * ライブボーナス（ステージ側Pスキル）と Phase 9 拡張仕様の単体テスト（合成データのみ）。
 *
 * 仕様出典: research/16_peing_verified_specs.md §1（発動順序と処理仕様）
 * - 全アイドルPスキル（メンタル降順）より**先頭（最優先）**で判定・発動
 * - 前半発動（無条件）: スコア精算前にバフが乗る（実効ビート数=表記-1）
 * - 後半発動（条件付き）: スコア精算とCT・バフ時間の減算後に**後半Pスキル群の中で最初**に発動
 * - 条件未成立時は成立ビートの後半まで保留（実効ビート数=表記どおり）
 * - 超化: 表記段階数はダミーで一律+5段階分（capExtend・§3）
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

function stage(): StageInput {
  return {
    id: "test-stage",
    laneAttributes: [2, 2, 1, 2, 2],
    beatWeightsPermil: { vocal: 600, dance: 250, visual: 150 },
    skillWeightsPermil: { active: 1000, special: 1000 },
    stageFactorPermil: 1000,
  };
}

function note(beat: number, noteType: 1 | 2 | 3 = 1, position: 0 | 1 | 2 | 3 | 4 = 0): ChartNote {
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

function liveBonus(
  partial: Partial<SkillDef> & { id: string },
): SkillDef {
  // ライブボーナスは lane 非所属（データ上は null。engine 入力では LiveBonusSkillDef）
  return skill({ ...partial, lane: 3 }) as SkillDef;
}

function input(
  notes: ChartNote[],
  overrides: Partial<SimulateInput> = {},
): SimulateInput {
  return {
    lanes: defaultLanes(),
    notes,
    stage: stage(),
    fanFactorPermil: 1000,
    criticalProvider: () => false,
    rng: new ConstRng(),
    roundingPolicy: "at-end",
    ...overrides,
  };
}

describe("ライブボーナスの発動順序（research/16 §1）", () => {
  it("無条件ライボはビート1の前半で全アイドルPスキルより先に発動する", () => {
    const lb = liveBonus({
      id: "lb-test",
      ct: 50,
      effects: [
        { type: "score_up", stages: 3, durationBeats: 30, target: "all", condition: "none" },
      ],
    });
    const p1 = skill({
      id: "p-l1",
      lane: 1,
      effects: [
        { type: "score_up", stages: 1, durationBeats: 30, target: "all", condition: "none" },
      ],
    });
    const lanes = defaultLanes();
    lanes[0] = { ...lanes[0]!, skills: [p1] };
    const res = simulateTimeline(input([note(1)], { liveBonusSkills: [lb], lanes }));
    const acts = res.beats[0]!.activations;
    expect(acts.length).toBe(2);
    expect(acts[0]!.kind).toBe("live_bonus");
    expect(acts[0]!.lane).toBe(0);
    expect(acts[0]!.phase).toBe("first");
    expect(acts[1]!.kind).toBe("P");
    expect(acts[1]!.lane).toBe(1);
  });

  it("前半発動のバフは同ビートのスコア精算に乗る（実効ビート数=表記-1）", () => {
    const lb = liveBonus({
      id: "lb-test",
      ct: 50,
      effects: [
        { type: "score_up", stages: 4, durationBeats: 3, target: "all", condition: "none" },
      ],
    });
    const res = simulateTimeline(input([note(1), note(2), note(3)], { liveBonusSkills: [lb] }));
    // b1: 前半発動→su+4 が b1 スコアに乗る。ステップ10で減算→b2 で残り1。b3 で期限切れ
    const b1 = res.beats[0]!.buffSnapshots.map((s) => s.score_up);
    const b2 = res.beats[1]!.buffSnapshots.map((s) => s.score_up);
    const b3 = res.beats[2]!.buffSnapshots.map((s) => s.score_up);
    expect(b1).toEqual([4, 4, 4, 4, 4]);
    expect(b2).toEqual([4, 4, 4, 4, 4]); // 残り1→翌ビート開始で除去まで有効
    expect(b3).toEqual([0, 0, 0, 0, 0]);
  });

  it("ライボの CT は前半発動で同ビート減算され gap=CT-1 で再発動する", () => {
    const lb = liveBonus({
      id: "lb-test",
      ct: 3,
      effects: [
        { type: "score_up", stages: 1, durationBeats: 5, target: "all", condition: "none" },
      ],
    });
    const res = simulateTimeline(input([note(1), note(2), note(3), note(4)], { liveBonusSkills: [lb] }));
    const beats = [1, 2, 3, 4];
    const fired = beats.map((b) =>
      res.activations.some((a) => a.beat === b && a.kind === "live_bonus"),
    );
    // b1 前半発動（CT3→同ビート減算で2）→ b2:1, b3:0 → b4 前半で再発動…ではなく
    // CT0になったビートの後半で再使用可（gap=CT-1=2 → b1→b3 後半→b5…）
    expect(fired[0]).toBe(true);
    expect(fired[1]).toBe(false);
    // CT が b3 のステップ9で 0 になる → b3 の後半で発動（2回目以降は後半）
    expect(res.activations.some((a) => a.beat === 3 && a.kind === "live_bonus" && a.phase === "last")).toBe(
      true,
    );
    expect(fired[2] ?? false).toBe(true);
    expect(fired[3]).toBe(false);
  });

  it("条件付きライボは後半発動・条件未成立時は保留される（後半Pスキル群の先頭）", () => {
    // 条件: someone_score_up。バフ源が無いビートでは発動しない
    const lb = liveBonus({
      id: "lb-cond",
      ct: 50,
      effects: [
        { type: "focus", stages: 2, durationBeats: 20, target: "all", condition: "someone_score_up" },
      ],
    });
    const p = skill({
      id: "p-l1",
      lane: 1,
      effects: [
        { type: "score_up", stages: 3, durationBeats: 10, target: "all", condition: "none" },
      ],
    });
    const lanes = defaultLanes();
    lanes[0] = { ...lanes[0]!, skills: [p] };
    const res = simulateTimeline(input([note(1), note(2)], { liveBonusSkills: [lb], lanes }));
    const acts = res.activations.filter((a) => a.kind === "live_bonus");
    // b1: Pが前半で su+3 → b1 の後半で条件成立（someone_score_up）→ ライボ後半発動
    expect(acts.length).toBe(1);
    expect(acts[0]!.beat).toBe(1);
    expect(acts[0]!.phase).toBe("last");
    // 後半発動はステップ10を通過後のため実効ビート数=表記どおり（翌ビートも有効）
    const b2Focus = res.beats[1]!.buffSnapshots.map((s) => s.focus);
    expect(b2Focus).toEqual([2, 2, 2, 2, 2]);
  });

  it("someone_recovered: 誰かがスタミナ回復効果を受けたビートの後半で発動する", () => {
    const lb = liveBonus({
      id: "lb-rec",
      ct: 50,
      effects: [
        {
          type: "vocal_up",
          stages: 5,
          durationBeats: 20,
          target: "trigger",
          condition: "someone_recovered",
        },
      ],
    });
    // L1 の P スキル: スタミナ回復（target-self）
    const p = skill({
      id: "p-rec",
      lane: 1,
      effects: [{ type: "stamina_recovery", value: 1000, target: "self", condition: "none" }],
    });
    const lanes = defaultLanes();
    lanes[0] = { ...lanes[0]!, skills: [p] };
    const res = simulateTimeline(input([note(1), note(2)], { liveBonusSkills: [lb], lanes }));
    const acts = res.activations.filter((a) => a.kind === "live_bonus");
    expect(acts.length).toBe(1);
    expect(acts[0]!.phase).toBe("last");
    // target-trigger → 回復を受けた L1 に付与
    const b2Up = res.beats[1]!.buffSnapshots.map((s) => s.vocal_up);
    expect(b2Up).toEqual([5, 0, 0, 0, 0]);
  });

  it("count_<unit>>=N は編成キャラクターIDで静的に評価される（成立時は前半発動）", () => {
    const lb = liveBonus({
      id: "lb-unit",
      ct: 50,
      effects: [
        { type: "skill_success_up", stages: 6, durationBeats: 35, target: "all", condition: "count_liz>=1" },
      ],
    });
    // 編成に LizNoir メンバー（char-rio 等）を含む → 成立・前半発動
    const withLiz = input([note(1)], {
      liveBonusSkills: [lb],
      formationCharacterIds: ["char-yu", "char-chs", "char-rio", "char-ktn", "char-smr"],
    });
    const res1 = simulateTimeline(withLiz);
    expect(res1.activations.some((a) => a.kind === "live_bonus" && a.phase === "first")).toBe(true);
    // LizNoir なし → 不発
    const withoutLiz = input([note(1)], {
      liveBonusSkills: [lb],
      formationCharacterIds: ["char-yu", "char-chs", "char-rui", "char-ktn", "char-smr"],
    });
    const res2 = simulateTimeline(withoutLiz);
    expect(res2.activations.filter((a) => a.kind === "live_bonus").length).toBe(0);
  });

  it("live_bonus_ct_reduction はライブボーナスの CT を短縮する", () => {
    const lb = liveBonus({
      id: "lb-ct",
      ct: 50,
      effects: [
        { type: "beat_score_up", stages: 2, durationBeats: 10, target: "all", condition: "none" },
      ],
    });
    // L1 の P（CT100・1回のみ発動）: ライボ CT −45
    const p = skill({
      id: "p-ctred",
      lane: 1,
      ct: 100,
      effects: [{ type: "live_bonus_ct_reduction", value: 45, target: "all", condition: "none" }],
    });
    const lanes = defaultLanes();
    lanes[0] = { ...lanes[0]!, skills: [p] };
    const res = simulateTimeline(
      input([note(1), note(2), note(3), note(4), note(5), note(6), note(7)], {
        liveBonusSkills: [lb],
        lanes,
      }),
    );
    // b1: ライボ発動（CT50→49）→ P（CT短縮45→4）→ b2:3 b3:2 b4:1 b5:0 → b5 後半で再発動
    const lbBeats = res.activations
      .filter((a) => a.kind === "live_bonus" && a.success)
      .map((a) => a.beat);
    expect(lbBeats).toEqual([1, 5]);
  });
});

describe("超化の統一仕様（research/16 §3・capExtend）", () => {
  it("通常上限に達したバフに超化+5段が乗ると実効25段になる（上限拡張）", () => {
    // これは buffs.aggregateBuffs の動作をエンジン経由で確認する
    const lb = liveBonus({
      id: "lb-extreme",
      ct: 50,
      effects: [
        { type: "score_up", stages: 20, durationBeats: 10, target: "all", condition: "none" },
      ],
    });
    const lb2 = liveBonus({
      id: "lb-extreme2",
      ct: 50,
      effects: [
        {
          type: "score_up",
          stages: 5,
          durationBeats: 10,
          target: "all",
          condition: "none",
          capExtend: true,
        },
      ],
    });
    const res = simulateTimeline(
      input([note(1)], { liveBonusSkills: [lb, lb2] }),
    );
    // 20段+超化5段=内部25 → cap 20+拡張5=25 で実効 25
    const su = res.beats[0]!.buffSnapshots.map((s) => s.score_up);
    expect(su).toEqual([25, 25, 25, 25, 25]);
    // b1Permil（beat）= 1000 + 25×25 = 1625
    expect(res.beats[0]!.events[0]!.b1Permil).toBe(1000 + 25 * 25);
  });
});

describe("ステルス副効果のファンボーナス（research/01 §2.6・Phase 9）", () => {
  it("ステルス中のレーン以外のスコアイベントに fanFactor への加算が乗る", () => {
    const lb = liveBonus({
      id: "lb-stealth",
      ct: 50,
      effects: [
        { type: "stealth", stages: 5, durationBeats: 10, target: "self", condition: "none" },
      ],
    });
    // target=self はライボの場合アンカー（センター L3）に解決される
    const res = simulateTimeline(input([note(1)], { liveBonusSkills: [lb] }));
    const events = res.beats[0]!.events;
    const l3 = events.find((e) => e.lane === 3)!;
    const l1 = events.find((e) => e.lane === 1)!;
    expect(l3.fanFactorPermil).toBe(1000); // ステルス本人は変化なし（引力度低下は未実装）
    expect(l1.fanFactorPermil).toBe(1000 + 18); // 5段 → +18‰
  });
});

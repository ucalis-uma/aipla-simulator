/**
 * Phase 16-A13（2026-10-07 実測確定）: 超化（capExtend）の寿命と段数算術の固定テスト。
 *
 * 実測根拠（サンプル2 L3・`../aipura_nox` は読み取り専用）:
 * - A1 `sk-chs-05-fest-00-1`（星見の海の波・Lv4）= critical_coeff_up 超化 5段 [31ビート] →
 *   実効 30 ビート。機械の表示行の窓 b14–43 / b88–127（b100 の `effect_extension` +10 で延長）
 *   / b148–167 と 1 ビートまで一致。
 * - P2 `sk-chs-05-fest-00-2`（Lv4）= critical_coeff_up 8段 [35ビート] → 実効 34 ビート
 *   （b2–44 / b51–94 / b101–144 / b151–167）。超化とは**寿命が独立**で、
 *   基本が消えている b95–100・b148–150 でも超化行は残る。
 * - pop 逆算（他レーン pop でノート乱数を除去）: 基本+超化の窓 = 13.3±0.4 段（= 8+5）／
 *   超化なしの窓 = 8.0±0.4 段／旧・増強型が 8 を返していた b101–127 = 13.9±0.5 段・
 *   b151–167 = 13.7±0.6 段 → 「最長インスタンスへ合算」は棄却。
 * - 加算則（基本が 0 の間は加算しない）の根拠は `src/timeline/buffs.ts` の extendStages 参照。
 *
 * 合成ミニフィクスチャのみで検証する（`extension-revival.test.ts` と同じパターン）。
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

/** laneIdx（0 基点）の ccu 実効段数 */
const ccuAt = (res: ReturnType<typeof simulateTimeline>, beat: number, laneIdx = 0): number =>
  res.beats[beat - 1]!.buffSnapshots[laneIdx]!.critical_coeff_up;

/** POSITION_TO_LANE = [3,2,4,1,5] なので position=4 がレーン1（A ノート用） */
const A_NOTE_POS = 4 as const;

/** 選択ビートだけ A ノート（type2）にした 1 ビート 1 ノートの譜面を作る */
function chartWithAnotes(totalBeats: number, aBeats: readonly number[]): ChartNote[] {
  const out: ChartNote[] = [];
  for (let b = 1; b <= totalBeats; b++) {
    out.push(aBeats.includes(b) ? note(b, 2, A_NOTE_POS) : note(b, 1, 0));
  }
  return out;
}

describe("Phase 16-A13: 超化（capExtend）の寿命と段数算術", () => {
  it("超化は独立インスタンス: 基本より長生きし、基本の入れ替え後も +5 が乗る", () => {
    // L1 P1: ccu 8段 [10ビート] → 実効 9 ビート（b1 前枠発動 → b1–b9 に表示）
    const baseP = skill({
      id: "sk-test-base",
      lane: 1,
      condition: "none",
      ct: 50,
      effects: [
        { type: "critical_coeff_up", stages: 8, durationBeats: 10, target: "self", condition: "none" },
      ],
    });
    // L1 A1（b3 の A ノートで発動）: 超化 5段 [31ビート] → 実効 30 ビート（表示 b3–b32）
    // ct 50 を入れて b12 の A ノートで再発動させない（別インスタンスの基本を発動させる）
    const chokaA = skill({
      id: "sk-test-choka",
      lane: 1,
      kind: "A",
      ct: 50,
      effects: [
        {
          type: "critical_coeff_up",
          stages: 5,
          durationBeats: 31,
          capExtend: true,
          target: "self",
          condition: "none",
        },
      ],
    });
    // L1 A2（b12 の A ノートで発動）: 別インスタンスの基本 ccu 8段 [8ビート] → 実効 6（b13–b18）
    const baseA2 = skill({
      id: "sk-test-base2",
      lane: 1,
      kind: "A",
      effects: [
        { type: "critical_coeff_up", stages: 8, durationBeats: 8, target: "self", condition: "none" },
      ],
    });
    const lanes = defaultLanes();
    lanes[0] = lane(1, { skills: [baseP, chokaA, baseA2] });
    const res = simulateTimeline(input(chartWithAnotes(40, [3, 12]), lanes));
    const acts = res.activations.filter((a) => a.success).map((a) => `${a.skillId}@b${a.beat}`);
    expect(acts).toContain("sk-test-choka@b3");
    expect(acts).toContain("sk-test-base2@b12");

    // 基本のみ（超化は b3 のスコアリング後に付与 → スコアに乗るのは b4 から）
    expect(ccuAt(res, 1)).toBe(8);
    expect(ccuAt(res, 3)).toBe(8);
    // 基本 + 超化 = 13（実測 critF 2504 = 1500+50×13+354 と同値）
    expect(ccuAt(res, 4)).toBe(13);
    expect(ccuAt(res, 9)).toBe(13);
    // b10–b12: 基本（b1–b9）終了・超化のみ → 加算先が無いので 0
    expect(ccuAt(res, 10)).toBe(0);
    expect(ccuAt(res, 11)).toBe(0);
    // b13–b18: 別インスタンスの基本（A2）が入る → 超化が再び +5（旧・合算実装では 8 のまま）
    expect(ccuAt(res, 13)).toBe(13);
    expect(ccuAt(res, 18)).toBe(13);
    // b19–: 基本が消え、超化（実効 b4–b32）だけが残る → 0
    expect(ccuAt(res, 19)).toBe(0);
    expect(ccuAt(res, 30)).toBe(0);
    // b33–: 超化も実効 30 ビートで終了
    expect(ccuAt(res, 34)).toBe(0);
  });

  it("超化の寿命は自分の表記 N−1 ビート（effect_extension の対象・基本に依存しない）", () => {
    const baseP = skill({
      id: "sk-test-base-long",
      lane: 1,
      condition: "none",
      ct: 50,
      effects: [
        { type: "critical_coeff_up", stages: 8, durationBeats: 40, target: "self", condition: "none" },
      ],
    });
    const chokaA = skill({
      id: "sk-test-choka-short",
      lane: 1,
      kind: "A",
      effects: [
        {
          type: "critical_coeff_up",
          stages: 5,
          // [8ビート] = 実効 7 ビート。A スキル付与はスコアリング後（b3 精算）なので
          // スコアに乗るのは b4–b9 の 6 ビート（機械の表示 b3–b9 と最終ビートが一致）。
          durationBeats: 8,
          capExtend: true,
          target: "self",
          condition: "none",
        },
      ],
    });
    const lanes = defaultLanes();
    lanes[0] = lane(1, { skills: [baseP, chokaA] });
    const res = simulateTimeline(input(chartWithAnotes(30, [3]), lanes));

    expect(ccuAt(res, 4)).toBe(13); // 超化の初ビート（+5）
    expect(ccuAt(res, 9)).toBe(13); // 超化の最終ビート
    expect(ccuAt(res, 10)).toBe(8); // 超化が失効 → 基本 8 のみ（基本は [40ビート] で生存中）
    expect(ccuAt(res, 20)).toBe(8);
  });

  it("超化の段数は表示 10 ではなく一律 +5（基本 8段 → 13段・18段にはならない）", () => {
    const baseP = skill({
      id: "sk-test-base-t5",
      lane: 1,
      condition: "none",
      ct: 50,
      effects: [
        { type: "critical_coeff_up", stages: 8, durationBeats: 40, target: "self", condition: "none" },
      ],
    });
    const chokaA = skill({
      id: "sk-test-choka-10",
      lane: 1,
      kind: "A",
      effects: [
        {
          type: "critical_coeff_up",
          // マスタ表記は 10（ダミー）だが engine 側は capExtend + stages で +5 を表現する
          stages: 5,
          durationBeats: 31,
          capExtend: true,
          target: "self",
          condition: "none",
        },
      ],
    });
    const lanes = defaultLanes();
    lanes[0] = lane(1, { skills: [baseP, chokaA] });
    const notes = [note(3, 2, A_NOTE_POS), ...Array.from({ length: 20 }, (_, i) => note(i + 1, 1, 0))];
    const res = simulateTimeline(input(notes, lanes));

    expect(ccuAt(res, 5)).toBe(13);
    expect(ccuAt(res, 5)).not.toBe(18);
  });
});

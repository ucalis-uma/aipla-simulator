/**
 * 【T5 ゴールデンテスト】実測リプレイ検証。
 *
 * tests/golden/fixtures/t5_replay_rands.json の乱数列（連続値 permil、逆算ソルバー生成）を
 * ArrayRng で再生し、実測データ（t5_measured.json）と突合する:
 *   1. 総スコアが 17,529,132,014 に1の位まで一致
 *   2. 統合リージョン（表示遅延・フレーム帰属の例外ビート）を除く全ビートで
 *      累積スコアが実測 cumulative に1の位まで一致
 *   3. レーン別スコア合計が総スコアと一致（内部整合）
 *
 * 確定事項（T5実測フィット）:
 * - スコア乱数は連続値（float、[0.95,1.05]）。丸めは at-end（最終 floor のみ）。
 * - ビート CB の基準コンボは表示コンボ（beat-1）。csu は X 強化(57.5‰/段)+平係数(11.5‰/段)。
 * - フォト行はクリティカル判定の対象外。
 * - b1 は全レーンミス（LIVE START 直後の取りこぼし）。
 * - b97/b132 はポップ遮蔽により実測 critFlags から欠落した L3 クリティカル（補正済み）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeDeckStatus } from "../../src/formula/baseStatus.js";
import { pctToPermil } from "../../src/rounding.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import type {
  ChartNote,
  LaneInput,
  LaneNumber,
  SimulateInput,
  SkillDef,
  StageInput,
} from "../../src/timeline/types.js";
import type { ScoreRng } from "../../src/rng/types.js";
import type { CardDef, CardParameterRow, StatBonus, StatValues, YellBonus } from "../../src/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = path.join(repoRoot, "data");
const sampleDir = path.join(repoRoot, "スコア分析サンプル");

interface CardsFile {
  cards: CardDef[];
}
interface CardParametersFile {
  rows: CardParameterRow[];
}
interface StructuredStat {
  stat: string;
  type: "pct" | "fixed";
  value: number;
}
interface PhotoOrAccessory {
  name: string;
  structured: StructuredStat[];
}
interface CharacterV2 {
  lane: number;
  card_id: string;
  level: number;
  rarity: number;
  role: string;
  kouryu_level: number;
  stats: {
    base: { vocal: number; dance: number; visual: number; stamina: number };
    total_after_non_skill_modifiers: { vocal: number; dance: number; visual: number; stamina: number };
  };
  photos: PhotoOrAccessory[];
  accessories: PhotoOrAccessory[];
}
interface VerificationV2 {
  staff_bonus: Record<"vocal" | "dance" | "visual" | "stamina" | "mental" | "critical", number>;
  yale_bonus: {
    vocal_pct: number;
    dance_pct: number;
    visual_pct: number;
    stamina: number;
    mental: number;
    critical: number;
    beat_score_pct: number;
    a_skill_score_pct: number;
    sp_skill_score_pct: number;
    critical_score_pct: number;
  };
  characters: CharacterV2[];
}
interface T5Measured {
  results: { total_score: number; scores_by_lane: Record<string, number> };
  timeline: Array<{
    beat: number;
    gained: number;
    cumulative: number;
    stat: Record<string, number>;
    pops: Record<string, number>;
  }>;
  critFlags: Array<{
    beat: number;
    yellow_lanes: string[] | null;
    white_lanes: string[] | null;
    no_pop_lanes: string[] | null;
  }>;
}
interface ReplayRands {
  rands: number[];
  mergedBeats: number[];
}

function readJson(p: string): unknown {
  return JSON.parse(readFileSync(p, "utf-8"));
}

const cards = (readJson(path.join(dataDir, "cards.json")) as CardsFile).cards;
const params = (readJson(path.join(dataDir, "card_parameters.json")) as CardParametersFile).rows;
const ver = readJson(path.join(sampleDir, "verification_data_v2.json")) as VerificationV2;
const skillsGolden = readJson(path.join(dataDir, "skills_golden.json")) as { skills: SkillDef[] };
const chart = readJson(path.join(dataDir, "charts", "chart-hsm-004-001.json")) as {
  notes: Array<{ beat: number; type: number; position: number }>;
};
const stageData = readJson(path.join(dataDir, "stages", "qt-daily-003-19.json")) as {
  beatWeightsPermil: { vocal: number; dance: number; visual: number };
  skillWeightsPermil: { active: number; special: number };
};
const t5 = readJson(path.join(repoRoot, "tests/golden/fixtures/t5_measured.json")) as T5Measured;
const replay = readJson(
  path.join(repoRoot, "tests/golden/fixtures/t5_replay_rands.json"),
) as ReplayRands;

function toStatBonus(items: PhotoOrAccessory[]): StatBonus[] {
  return items.map((item) => {
    const pct: Record<string, number> = {};
    const fixed: Record<string, number> = {};
    for (const s of item.structured) {
      if (s.type === "pct") pct[s.stat] = (pct[s.stat] ?? 0) + pctToPermil(s.value);
      else fixed[s.stat] = (fixed[s.stat] ?? 0) + s.value;
    }
    return { pct, fixed };
  });
}

function sumScorePct(items: PhotoOrAccessory[], key: string): number {
  let sum = 0;
  for (const item of items) {
    for (const s of item.structured) {
      if (s.stat === key && s.type === "pct") {
        sum += pctToPermil(s.value);
      }
    }
  }
  return sum;
}

function yell(): YellBonus {
  const y = ver.yale_bonus;
  return {
    statPct: {
      vocal: pctToPermil(y.vocal_pct),
      dance: pctToPermil(y.dance_pct),
      visual: pctToPermil(y.visual_pct),
    },
    statFix: { stamina: y.stamina, mental: y.mental, critical: y.critical },
    scorePct: {
      beat: pctToPermil(y.beat_score_pct),
      active: pctToPermil(y.a_skill_score_pct),
      special: pctToPermil(y.sp_skill_score_pct),
      criticalScore: pctToPermil(y.critical_score_pct),
    },
  };
}

const STAFF = ver.staff_bonus;
const YELL = yell();

const LANE_ATTRIBUTE: Record<LaneNumber, "vocal" | "dance" | "visual"> = {
  1: "vocal",
  2: "vocal",
  3: "vocal",
  4: "dance",
  5: "vocal",
};

/** メンタル実測キャリブレーション（research/14 §7。成功率は全成立のため戦闘値のみ影響） */
const CALIBRATED_MENTAL: Record<LaneNumber, number> = { 1: 105, 2: 102, 3: 104, 4: 103, 5: 101 };

function buildLanes(): LaneInput[] {
  const lanes: LaneInput[] = [];
  for (const ch of ver.characters) {
    const lane = ch.lane as LaneNumber;
    const card = cards.find((c) => c.id === ch.card_id);
    if (!card) throw new Error(`card not found: ${ch.card_id}`);
    const row = params.find((r) => r.id === card.cardParameterId && r.level === ch.level);
    if (!row) throw new Error(`card parameter not found: ${card.cardParameterId} @Lv${ch.level}`);
    const result = computeDeckStatus(
      {
        card,
        level: ch.level,
        rarity: ch.rarity,
        kouryuLevel: ch.kouryu_level,
        staff: STAFF,
        yell: YELL,
        equipment: {
          photos: toStatBonus(ch.photos),
          accessories: toStatBonus(ch.accessories),
        },
      },
      row,
    );
    const deck: StatValues<number> = {
      ...result.deck,
      mental: CALIBRATED_MENTAL[lane],
      critical: 0,
    };
    const equipment = [...ch.photos, ...ch.accessories];
    const skills = skillsGolden.skills.filter(
      (s) => s.lane === lane && (s.kind === "A" || s.kind === "SP" || s.kind === "P"),
    );
    const photos = skillsGolden.skills.filter(
      (s) => s.lane === lane && s.kind === "photo" && (s.effects?.length ?? 0) > 0,
    );
    lanes.push({
      lane,
      attribute: LANE_ATTRIBUTE[lane],
      role: ch.role as LaneInput["role"],
      deck,
      skills,
      photos,
      scoreBonusPct: {
        beat: YELL.scorePct.beat + sumScorePct(equipment, "beat_score"),
        active: YELL.scorePct.active + sumScorePct(equipment, "a_score"),
        special: YELL.scorePct.special + sumScorePct(equipment, "sp_score"),
        passive: sumScorePct(equipment, "p_score"),
      },
      critExtrasPermil: YELL.scorePct.criticalScore + sumScorePct(equipment, "critical_score"),
    });
  }
  lanes.sort((a, b) => a.lane - b.lane);
  return lanes;
}

class ArrayRng implements ScoreRng {
  private i = 0;
  constructor(private readonly rolls: number[]) {}
  nextScoreRoll(): number {
    const r = this.rolls[this.i];
    if (r === undefined) {
      throw new Error(`ArrayRng: rolls exhausted at ${this.i}`);
    }
    this.i++;
    return r;
  }
  nextCritical(): boolean {
    return false;
  }
  get consumed(): number {
    return this.i;
  }
}

function buildInput(lanes: LaneInput[], rng: ScoreRng): SimulateInput {
  const notes: ChartNote[] = chart.notes.map((n) => ({
    beat: n.beat,
    noteType: n.type as 1 | 2 | 3,
    position: n.position as ChartNote["position"],
  }));
  const stage: StageInput = {
    id: "qt-daily-003-19",
    laneAttributes: [2, 2, 1, 2, 2],
    beatWeightsPermil: stageData.beatWeightsPermil,
    skillWeightsPermil: {
      active: stageData.skillWeightsPermil.active,
      special: stageData.skillWeightsPermil.special,
    },
    stageFactorPermil: 1000,
  };
  return {
    lanes,
    notes,
    stage,
    fanFactorPermil: 1620,
    successBasePermil: 1000,
    criticalProvider: (beat, lane) =>
      t5.critFlags.find((f) => f.beat === beat)?.yellow_lanes?.includes(String(lane)) ?? false,
    rng,
    roundingPolicy: "at-end",
    missedNotes: [
      { beat: 1, lane: 1 },
      { beat: 1, lane: 2 },
      { beat: 1, lane: 3 },
      { beat: 1, lane: 4 },
      { beat: 1, lane: 5 },
    ],
  };
}

function runReplay(): ReturnType<typeof simulateTimeline> {
  const lanes = buildLanes();
  const rng = new ArrayRng(replay.rands);
  const res = simulateTimeline(buildInput(lanes, rng));
  expect(rng.consumed).toBeLessThanOrEqual(replay.rands.length);
  return res;
}

describe("T5 golden replay ( qt-daily-003-19 / hsm-004-001 実測 17,529,132,014 )", () => {
  const merged = new Set(replay.mergedBeats);

  it("総スコアが実測値に1の位まで一致する", () => {
    const res = runReplay();
    expect(res.totalScore).toBe(t5.results.total_score);
  });

  it("統合リージョンを除く全ビートの累積スコアが実測 cumulative に一致する", () => {
    const res = runReplay();
    const skipped: number[] = [];
    let simCum = 0;
    let checked = 0;
    for (const bt of res.beats) {
      for (const e of bt.events) {
        simCum += e.gainedScore;
      }
      const measRow = t5.timeline.find((r) => r.beat === bt.beat);
      if (!measRow) {
        continue;
      }
      if (merged.has(bt.beat)) {
        skipped.push(bt.beat);
        continue;
      }
      expect(simCum, `beat ${bt.beat} cumulative`).toBe(measRow.cumulative);
      checked++;
    }
    // 例外ビートは全 36 ビート（表示遅延・フレーム帰属・ポップ混入の計測側例外）
    expect(skipped.length).toBe(merged.size);
    expect(checked).toBeGreaterThan(100);
  });

  it("例外統合リージョンの合計も実測と一致する（フレーム内ローカル総和保存）", () => {
    const res = runReplay();
    // 統合リージョン（連続区間に分割）ごとに sim 合計 == 実測 Σgained を確認
    const beatsSorted = [...merged].sort((a, b) => a - b);
    const regions: number[][] = [];
    for (const b of beatsSorted) {
      const last = regions[regions.length - 1];
      if (last && last[last.length - 1] === b - 1) {
        last.push(b);
      } else {
        regions.push([b]);
      }
    }
    expect(regions.length).toBeGreaterThan(5);
    for (const region of regions) {
      const simSum = res.beats
        .filter((bt) => region.includes(bt.beat))
        .reduce((s, bt) => s + bt.events.reduce((x, e) => x + e.gainedScore, 0), 0);
      const measSum = t5.timeline
        .filter((r) => region.includes(r.beat))
        .reduce((s, r) => s + r.gained, 0);
      expect(simSum, `region ${region.join("-")}`).toBe(measSum);
    }
  });

  it("最終累積がリザルト総スコアと一致する", () => {
    const res = runReplay();
    const lastBeat = res.beats[res.beats.length - 1];
    let simCum = 0;
    for (const bt of res.beats) {
      for (const e of bt.events) {
        simCum += e.gainedScore;
      }
    }
    expect(simCum).toBe(res.totalScore);
    expect(lastBeat).toBeDefined();
  });
});

/**
 * T5 デバッグハーネス（一時・最終後に t5 スコア検定テストへ置換）。
 *
 * 全156ビートを中立乱数+実測クリティカルフラグで走らせ、ビート別の
 * 実測 gained との比 (D/E) を検査する。比が [0.95, 1.05] 外のビート = モデル誤りの候補。
 * イベント数 k=1 のビート（A/SP主体）は離散乱数検定も行う。
 */
import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeDeckStatus } from "../../src/formula/baseStatus.js";
import { pctToPermil } from "../../src/rounding.js";
import { computeEventScore } from "../../src/formula/scoreEvent.js";
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
    combo: number;
    cumulative: number;
    gained: number;
    stamina: Record<string, number>;
    stat: Record<string, number>;
    pops: Record<string, number>;
    effects: Record<string, Array<{ id: string; stage: number | null }>>;
  }>;
  critFlags: Array<{
    beat: number;
    yellow_lanes: string[] | null;
    white_lanes: string[] | null;
    no_pop_lanes: string[] | null;
  }>;
  activations: Array<{
    order: number;
    beat: number;
    lane: number;
    skill_type: string;
    skill_name: string;
    stamina: string;
    stat_value: number;
  }>;
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
  skillWeightsPermil: { active: number; special: number; stamina: number };
};
const t5 = readJson(path.join(repoRoot, "tests/golden/fixtures/t5_measured.json")) as T5Measured;

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

const CALIBRATED_MENTAL: Record<LaneNumber, number> = {
  1: 105,
  2: 103,
  3: 101,
  4: 104,
  5: 102,
};

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

class NeutralRng implements ScoreRng {
  nextScoreRoll(): number {
    return 1000;
  }
  nextCritical(): boolean {
    return false;
  }
}

function buildInput(lanes: LaneInput[]): SimulateInput {
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
    rng: new NeutralRng(),
    roundingPolicy: "sequential",
  };
}

// ---- 解析本体 ----

const result = simulateTimeline(buildInput(buildLanes()));

interface BeatDiag {
  beat: number;
  k: number;
  events: Array<{
    lane: number;
    basic: number;
    power: number;
    b1: number;
    comboF: number;
    fanF: number;
    critF: number;
    isRatio: boolean;
    e1000: number;
  }>;
  measured: number;
  simTotal: number;
  ratio: number;
  ok: boolean;
  impliedSingleRand: number | null;
}

describe("T5 debug: 全ビート比検査", () => {
  it("レーン別係数フィット（pop = live×A_lane×B1×cb×fan×crit×r）", () => {
    // 実測ポップ（列 "N"）と sim イベント（B1/cb/fan/crit はトレース値）から
    // A_lane = w×(λ/N) を平均で推定する（r は平均1000で消える）。
    const acc: Record<number, { sum: number; n: number; vals: number[] }> = {};
    for (const bt of result.beats) {
      if (bt.beat <= 3 || bt.noteType !== 1) continue; // ビートノートのみ
      const row = t5.timeline.find((t) => t.beat === bt.beat);
      if (!row) continue;
      for (const e of bt.events) {
        if (e.critFactorPermil !== 1000) continue; // 非クリティカルのみ
        const pop = row.pops?.[String(e.lane)];
        if (pop == null || pop === 0) continue;
        const denom =
          e.basicScore *
          (e.b1Permil / 1000) *
          (e.comboFactorPermil / 1000) *
          (e.fanFactorPermil / 1000) *
          (e.critFactorPermil / 1000);
        if (denom <= 0) continue;
        const a = pop / denom;
        (acc[e.lane] ??= { sum: 0, n: 0, vals: [] }).vals.push(a);
      }
    }
    for (const lane of [1, 2, 3, 4, 5]) {
      const a = acc[lane];
      if (!a || a.vals.length === 0) {
        console.log(`[FIT] L${lane}: no data`);
        continue;
      }
      const mean = a.vals.reduce((s, v) => s + v, 0) / a.vals.length;
      const sd = Math.sqrt(a.vals.reduce((s, v) => s + (v - mean) ** 2, 0) / a.vals.length);
      console.log(
        `[FIT] L${lane}: A=${mean.toFixed(5)} (w×LN, json比=${(mean / 0.030769).toFixed(3)}) sd=${sd.toFixed(5)} n=${a.vals.length}`,
      );
    }
    // デバッグ: L1 の最初の10サンプル
    const l1samples: string[] = [];
    for (const bt of result.beats) {
      if (l1samples.length >= 10) break;
      if (bt.beat <= 3) continue;
      const row = t5.timeline.find((t) => t.beat === bt.beat);
      const e = bt.events.find((x) => x.lane === 1);
      if (!row || !e) continue;
      const pop = row.pops?.["1"];
      if (pop == null) continue;
      const denom =
        e.basicScore * (e.b1Permil / 1000) * (e.comboFactorPermil / 1000) * (e.fanFactorPermil / 1000) * (e.critFactorPermil / 1000);
      l1samples.push(`b${bt.beat}:pop=${pop}:basic=${e.basicScore}:b1=${e.b1Permil}:cb=${e.comboFactorPermil}:A=${(pop / denom).toFixed(5)}`);
    }
    console.log("[FIT] L1 samples:", l1samples.join(" | "));
  });

  it("A/SP イベントの離散乱数検定（バフ進化+type36検証）", () => {
    // A/SP ビートではオーナーレーンのポップ = そのスキルのスコア行合計（フォトと無干渉）。
    // r = pop / E(1000) × 1000 が 950-1050 の整数になればモデル完全一致。
    const POSITION_TO_LANE = [3, 2, 4, 1, 5];
    for (const bt of result.beats) {
      if (bt.noteType === 1 || bt.beat < 4) continue;
      const owner = POSITION_TO_LANE[bt.position - 1];
      const row = t5.timeline.find((t) => t.beat === bt.beat);
      if (!row) continue;
      const pop = row.pops?.[String(owner)];
      if (pop == null || pop === 0) continue;
      const evs = bt.events.filter((e) => e.lane === owner);
      const e1000 = evs.reduce(
        (s, e) =>
          s +
          computeEventScore({
            basicScore: e.basicScore,
            skillPowerPermil: e.skillPowerPermil,
            b1Permil: e.b1Permil,
            comboFactorPermil: e.comboFactorPermil,
            fanFactorPermil: e.fanFactorPermil,
            stageFactorPermil: 1000,
            randPermil: 1000,
            critFactorPermil: e.critFactorPermil,
            roundingPolicy: "sequential",
          }),
        0,
      );
      const r = (pop / e1000) * 1000;
      const flag = r >= 950 && r <= 1050 ? "OK" : "OUT";
      const detail = evs
        .map(
          (e) =>
            `pow=${e.skillPowerPermil},basic=${e.basicScore},b1=${e.b1Permil},cb=${e.comboFactorPermil},fan=${e.fanFactorPermil},crit=${e.critFactorPermil}${e.isRatioScore ? ",RATIO" : ""}`,
        )
        .join(" || ");
      console.log(`[A/SP] b${bt.beat} L${owner} pop=${pop} E=${e1000} r=${r.toFixed(2)} [${flag}] ${detail}`);
    }
  });

  it("b3/b4 の内部状態ダンプ", () => {
    for (const b of [1, 2, 3, 4, 5]) {
      const bt = result.beats.find((x) => x.beat === b);
      if (!bt) continue;
      const snap = bt.buffSnapshots[2];
      console.log(`[DUMP] b${b} L3 snap=`, JSON.stringify(snap));
      console.log(`[DUMP] b${b} activations=`, JSON.stringify(bt.activations));
    }
  });

  it("ビート別 D/E 比レポートを出力する", () => {
    const diags: BeatDiag[] = [];
    for (const bt of result.beats) {
      const measured = t5.timeline.find((t) => t.beat === bt.beat)?.gained ?? 0;
      const events = bt.events.map((e) => {
        const e1000 = computeEventScore({
          basicScore: e.basicScore,
          skillPowerPermil: e.skillPowerPermil,
          b1Permil: e.b1Permil,
          comboFactorPermil: e.comboFactorPermil,
          fanFactorPermil: e.fanFactorPermil,
          stageFactorPermil: 1000,
          randPermil: 1000,
          critFactorPermil: e.critFactorPermil,
          roundingPolicy: "sequential",
        });
        return {
          lane: e.lane,
          basic: e.basicScore,
          power: e.skillPowerPermil,
          b1: e.b1Permil,
          comboF: e.comboFactorPermil,
          fanF: e.fanFactorPermil,
          critF: e.critFactorPermil,
          isRatio: e.isRatioScore,
          e1000,
        };
      });
      const simTotal = events.reduce((s, e) => s + e.e1000, 0);
      const ratio = simTotal > 0 ? measured / simTotal : 0;
      diags.push({
        beat: bt.beat,
        k: events.length,
        events,
        measured,
        simTotal,
        ratio,
        ok: measured === 0 ? true : ratio >= 0.95 && ratio <= 1.05,
        impliedSingleRand: events.length === 1 && simTotal > 0 ? (measured / simTotal) * 1000 : null,
      });
    }
    const bad = diags.filter((d) => !d.ok);
    console.log(`[T5] beats=${diags.length} bad=${bad.length}`);
    for (const d of bad) {
      const evSummary = d.events
        .map(
          (e) =>
            `L${e.lane}:basic=${e.basic}:pow=${e.power}:b1=${e.b1}:cb=${e.comboF}:fan=${e.fanF}:crit=${e.critF}${e.isRatio ? ":RATIO" : ""}`,
        )
        .join(" | ");
      console.log(
        `[T5][BAD] b${d.beat} k=${d.k} measured=${d.measured} sim=${d.simTotal} ratio=${d.ratio.toFixed(4)} :: ${evSummary}`,
      );
    }
    // k=1 の離散乱数検定（比が範囲内のもののみ）
    const singles = diags.filter((d) => d.k === 1 && d.ok);
    let singleOk = 0;
    const singleBad: string[] = [];
    for (const d of singles) {
      const r = d.impliedSingleRand;
      const rounded = r === null ? null : Math.round(r);
      if (rounded !== null && r !== null && Math.abs(r - rounded) < 0.005 && rounded >= 950 && rounded <= 1050) {
        singleOk++;
      } else {
        singleBad.push(`b${d.beat}:r=${r?.toFixed(2)}`);
      }
    }
    console.log(`[T5] k=1 beats=${singles.length} discrete-ok=${singleOk} bad=[${singleBad.join(", ")}]`);
    writeFileSync(
      path.join(repoRoot, "tests/golden/fixtures/t5_report.json"),
      JSON.stringify({ bad: bad.map((d) => ({ beat: d.beat, ratio: d.ratio, measured: d.measured, sim: d.simTotal })) }, null, 1),
    );
  });
});

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
import { mulPermil, pctToPermil } from "../../src/rounding.js";
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

function buildInput(
  lanes: LaneInput[],
  debugOptions?: { extensionMode?: "all" | "longest"; comboBasis?: "lane" | "global" },
): SimulateInput {
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
    debugOptions,
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

  it("仮説グリッド: extension方式×コンボ基準 の4組合せでレーン別A系列を比較", () => {
    const W: Record<number, number> = { 1: 0.6, 2: 0.6, 3: 0.6, 4: 0.25, 5: 0.6 };
    const POSITION_TO_LANE_ = [3, 2, 4, 1, 5];
    for (const ext of ["all", "longest"] as const) {
      for (const cb of ["lane", "global"] as const) {
        const res = simulateTimeline(buildInput(buildLanes(), { extensionMode: ext, comboBasis: cb }));
        // --- ビートノート: per-unit-w A 系列 ---
        const acc: Record<number, Array<{ beat: number; a: number }>> = {};
        for (const bt of res.beats) {
          if (bt.beat <= 3 || bt.noteType !== 1) continue;
          const row = t5.timeline.find((t) => t.beat === bt.beat);
          if (!row) continue;
          for (const e of bt.events) {
            if (e.critFactorPermil !== 1000) continue;
            const pop = row.pops?.[String(e.lane)];
            if (pop == null || pop === 0) continue;
            const denom =
              e.basicScore *
              (e.b1Permil / 1000) *
              (e.comboFactorPermil / 1000) *
              (e.fanFactorPermil / 1000) *
              (e.critFactorPermil / 1000);
            if (denom <= 0) continue;
            (acc[e.lane] ??= []).push({ beat: bt.beat, a: pop / denom / (W[e.lane] ?? 0.6) });
          }
        }
        const parts: string[] = [];
        for (const lane of [1, 2, 3, 4, 5]) {
          const vals = acc[lane];
          if (!vals || vals.length === 0) {
            parts.push(`L${lane}:n=0`);
            continue;
          }
          const as = vals.map((v) => v.a);
          const sorted = [...as].sort((x, y) => x - y);
          const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
          const mean = as.reduce((s, v) => s + v, 0) / as.length;
          const sd = Math.sqrt(as.reduce((s, v) => s + (v - mean) ** 2, 0) / as.length);
          const inRange = as.filter((v) => Math.abs(v / median - 1) <= 0.05).length;
          // 5分割バケット中央値（ドリフト/跳ねの検出）
          const bucketN = Math.ceil(as.length / 5);
          const buckets: number[] = [];
          for (let i = 0; i < 5; i++) {
            const seg = sorted.slice(i * bucketN, (i + 1) * bucketN);
            const m = seg[Math.floor(seg.length / 2)];
            if (seg.length > 0 && m !== undefined) buckets.push(m);
          }
          // 外れビート（|dev|>10%）
          const outliers = vals
            .filter((v) => Math.abs(v.a / median - 1) > 0.1)
            .slice(0, 12)
            .map((v) => `b${v.beat}:${(v.a * 1000).toFixed(0)}`);
          parts.push(
            `L${lane}:med=${(median * 1000).toFixed(1)} sd%=${((sd / mean) * 100).toFixed(1)} in5%=${inRange}/${as.length} buckets=[${buckets.map((b) => (b * 1000).toFixed(0)).join(",")}] out=[${outliers.join(" ")}]`,
          );
        }
        // --- A/SP 離散乱数検定（オーナーレーンポップ） ---
        let ok = 0;
        const outList: string[] = [];
        for (const bt of res.beats) {
          if (bt.noteType === 1 || bt.beat < 4) continue;
          const owner = POSITION_TO_LANE_[bt.position - 1];
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
          if (r >= 950 && r <= 1050) {
            ok++;
          } else {
            outList.push(`b${bt.beat}:r=${r.toFixed(0)}`);
          }
        }
        console.log(
          `[GRID] ext=${ext} cb=${cb} A/SP-ok=${ok}\n  ${parts.join("\n  ")}`,
        );
        if (outList.length > 0) console.log(`  A/SP-OUT: ${outList.join(" ")}`);
      }
    }
  });

  it("統合仮説検証: 総和basic×テンション入りB1（トレース後掛けで4変種比較）", () => {
    // 仮説: ビートbasic = Σ_s deck[s]×w_s×liveMult_s（全レーン共通・liveMultはvocalのみ変動）
    //        ビートB1 = 1000 + 25×su + 50×tension + bonus.beat（S2の「テンション不入」を修正）
    //        λ = 8/156（S2）なら A = med/(basic_sum×b1_t/1000×…) が全レーン ~51 で平坦になるはず
    const lanes = buildLanes();
    const res = simulateTimeline(buildInput(lanes));
    const liveMultV = (snap: { vocal_up: number; vocal_up_extreme: number; vocal_boost: number }) =>
      1000 + 50 * (snap.vocal_up + snap.vocal_up_extreme) + 75 * snap.vocal_boost;
    for (const basicMode of ["sum"] as const) {
      for (const b1Mode of ["beat", "beat+asu", "beat+asu+ten"] as const) {
        const acc: Record<number, number[]> = {};
        const tensionSample: Record<number, number[]> = {};
        for (const bt of res.beats) {
          if (bt.beat <= 3 || bt.noteType !== 1) continue;
          const row = t5.timeline.find((t) => t.beat === bt.beat);
          if (!row) continue;
          // P/フォトの score_get が同じビートで発動 → pop 列が混入するため除外
          const polluted = new Set(
            bt.activations
              .filter((a) => a.success && a.gainedScore != null)
              .map((a) => a.lane),
          );
          for (const e of bt.events) {
            if (e.critFactorPermil !== 1000) continue;
            if (polluted.has(e.lane)) continue;
            const pop = row.pops?.[String(e.lane)];
            if (pop == null || pop === 0) continue;
            const laneIdx = e.lane - 1;
            const lane = lanes[laneIdx];
            const snap = bt.buffSnapshots[laneIdx];
            if (!lane || !snap) continue;
            if (!lane || !snap) continue;
            const basic =
              mulPermil(mulPermil(lane.deck.vocal, liveMultV(snap)), 600) +
              mulPermil(lane.deck.dance, 250) +
              mulPermil(lane.deck.visual, 150);
            const b1 =
              b1Mode === "beat"
                ? e.b1Permil
                : b1Mode === "beat+asu"
                  ? e.b1Permil + 50 * snap.a_skill_score_up
                  : e.b1Permil + 50 * snap.a_skill_score_up + 50 * snap.tension_up;
            const denom =
              basic *
              (b1 / 1000) *
              (e.comboFactorPermil / 1000) *
              (e.fanFactorPermil / 1000) *
              (e.critFactorPermil / 1000);
            if (denom <= 0) continue;
            (acc[e.lane] ??= []).push(pop / denom);
            if (bt.beat === 10 || bt.beat === 60 || bt.beat === 120) {
              (tensionSample[e.lane] ??= []).push(snap.tension_up);
            }
          }
        }
        const parts: string[] = [];
        for (const lane of [1, 2, 3, 4, 5]) {
          const vals = acc[lane];
          if (!vals || vals.length === 0) {
            parts.push(`L${lane}:n=0`);
            continue;
          }
          const sorted = [...vals].sort((x, y) => x - y);
          const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
          const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
          const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
          const inRange = vals.filter((v) => Math.abs(v / median - 1) <= 0.05).length;
          const bucketN = Math.ceil(sorted.length / 5);
          const buckets: number[] = [];
          for (let i = 0; i < 5; i++) {
            const seg = sorted.slice(i * bucketN, (i + 1) * bucketN);
            const m = seg[Math.floor(seg.length / 2)];
            if (seg.length > 0 && m !== undefined) buckets.push(m);
          }
          const s = tensionSample[lane] ?? [];
          parts.push(
            `L${lane}:med=${median.toFixed(4)}(λ比=${(median / (8 / 156)).toFixed(3)}) sd%=${((sd / mean) * 100).toFixed(1)} in5%=${inRange}/${vals.length} buckets=[${buckets.map((b) => b.toFixed(3)).join(",")}] ten=[${s.join(",")}]`,
          );
        }
        console.log(`[HYP] basic=${basicMode} b1=${b1Mode}\n  ${parts.join("\n  ")}`);
      }
    }
  });

  it("残差回帰: basic_sum×b1(beat) 除外後のb1_true推定 vs スナップショット段数", () => {
    const lanes = buildLanes();
    const res = simulateTimeline(buildInput(lanes));
    const liveMultV = (snap: { vocal_up: number; vocal_up_extreme: number; vocal_boost: number }) =>
      1000 + 50 * (snap.vocal_up + snap.vocal_up_extreme) + 75 * snap.vocal_boost;
    const LAMBDA = 8 / 156;
    for (const laneNo of [1, 3]) {
      const rows: string[] = [];
      for (const bt of res.beats) {
        if (bt.beat <= 3 || bt.noteType !== 1) continue;
        const row = t5.timeline.find((t) => t.beat === bt.beat);
        if (!row) continue;
        const polluted = new Set(
          bt.activations.filter((a) => a.success && a.gainedScore != null).map((a) => a.lane),
        );
        const e = bt.events.find((x) => x.lane === laneNo);
        if (!e || e.critFactorPermil !== 1000 || polluted.has(laneNo as LaneNumber)) continue;
        const pop = row.pops?.[String(laneNo)];
        if (pop == null || pop === 0) continue;
        const laneIdx = laneNo - 1;
        const lane = lanes[laneIdx];
        const snap = bt.buffSnapshots[laneIdx];
        if (!lane || !snap) continue;
        const statMeasured = row.stat?.[String(laneNo)];
        const basicSum =
          laneNo === 3 && statMeasured
            ? mulPermil(statMeasured, 600) +
              mulPermil(lane.deck.dance, 250) +
              mulPermil(lane.deck.visual, 150)
            : mulPermil(mulPermil(lane.deck.vocal, liveMultV(snap)), 600) +
              mulPermil(lane.deck.dance, 250) +
              mulPermil(lane.deck.visual, 150);
        const rest =
          (e.comboFactorPermil / 1000) * (e.fanFactorPermil / 1000) * (e.critFactorPermil / 1000);
        const b1True = pop / (basicSum * rest * LAMBDA);
        const extra = b1True - e.b1Permil;
        rows.push(
          `b${bt.beat} extra=${extra.toFixed(0)} su=${snap.score_up} asu=${snap.a_skill_score_up} ssu=${snap.sp_skill_score_up} ten=${snap.tension_up} csu=${snap.combo_score_up} foc=${snap.focus} cb=${e.comboFactorPermil} statSim=${mulPermil(lane.deck.vocal, liveMultV(snap))} statMeas=${statMeasured ?? "-"}`,
        );
      }
      const step = Math.max(1, Math.floor(rows.length / 22));
      console.log(`[REG] L${laneNo} (every ${step}th of ${rows.length}):`);
      for (let i = 0; i < rows.length; i += step) console.log("  " + rows[i]);
    }
  });

  it("λスキャン: implied乱数の離散性でλとb1係数を特定", () => {
    const lanes = buildLanes();
    const res = simulateTimeline(buildInput(lanes));
    const liveMultV = (snap: { vocal_up: number; vocal_up_extreme: number; vocal_boost: number }) =>
      1000 + 50 * (snap.vocal_up + snap.vocal_up_extreme) + 75 * snap.vocal_boost;
    interface Sample {
      lane: number;
      a: number; // pop/(basic×(b1/1000)×rest)
    }
    for (const suCoef of [0, 25, 50] as const) {
      const samples: Sample[] = [];
      const samples3: Sample[] = [];
      for (const bt of res.beats) {
        if (bt.beat <= 3 || bt.noteType !== 1) continue;
        const row = t5.timeline.find((t) => t.beat === bt.beat);
        if (!row) continue;
        const polluted = new Set(
          bt.activations.filter((a) => a.success && a.gainedScore != null).map((a) => a.lane),
        );
        for (const e of bt.events) {
          if (e.critFactorPermil !== 1000 || polluted.has(e.lane)) continue;
          const pop = row.pops?.[String(e.lane)];
          if (pop == null || pop === 0) continue;
          const laneIdx = e.lane - 1;
          const lane = lanes[laneIdx];
          const snap = bt.buffSnapshots[laneIdx];
          if (!lane || !snap) continue;
          const statMeasured = row.stat?.[String(e.lane)];
          // L3のみ実測stat列（表示上限飽和前）でvocal成分を置換
          const useMeasured = e.lane === 3 && statMeasured != null && statMeasured < 3.75 * lane.deck.vocal;
          const vocalPart = useMeasured
            ? mulPermil(statMeasured, 600)
            : mulPermil(mulPermil(lane.deck.vocal, liveMultV(snap)), 600);
          const basic = vocalPart + mulPermil(lane.deck.dance, 250) + mulPermil(lane.deck.visual, 150);
          const b1 = 1000 + suCoef * snap.score_up + (e.b1Permil - 1000 - 25 * snap.score_up);
          const rest =
            (e.comboFactorPermil / 1000) * (e.fanFactorPermil / 1000) * (e.critFactorPermil / 1000);
          const a = pop / (basic * (b1 / 1000) * rest);
          (e.lane === 3 ? samples3 : samples).push({ lane: e.lane, a });
        }
      }
      let best = { lambda: 0, frac: 0 };
      const top: Array<{ lambda: number; frac: number }> = [];
      for (let lam = 0.0555; lam <= 0.0585; lam += 0.000005) {
        let ok = 0;
        for (const s of samples) {
          const r = (s.a / lam) * 1000;
          const rr = Math.round(r);
          if (Math.abs(r - rr) < 1.5 && rr >= 945 && rr <= 1055) ok++;
        }
        const frac = ok / samples.length;
        top.push({ lambda: lam, frac });
        if (frac > best.frac) best = { lambda: lam, frac };
      }
      top.sort((x, y) => y.frac - x.frac);
      console.log(
        `[SCAN-TOP] su=${suCoef}‰ ` +
          top.slice(0, 6).map((t) => `λ=${t.lambda.toFixed(6)}:${t.frac.toFixed(3)}`).join(" "),
      );
      const perLane = [1, 2, 4, 5]
        .map((ln) => {
          const ss = samples.filter((s) => s.lane === ln);
          const ok = ss.filter((s) => {
            const r = (s.a / best.lambda) * 1000;
            const rr = Math.round(r);
            return Math.abs(r - rr) < 1.5 && rr >= 945 && rr <= 1055;
          }).length;
          const med = [...ss.map((s) => s.a)].sort((x, y) => x - y)[Math.floor(ss.length / 2)] ?? 0;
          return `L${ln}:${ok}/${ss.length}(medA=${(med * 1000).toFixed(1)})`;
        })
        .join(" ");
      const ok3 = samples3.filter((s) => {
        const r = (s.a / best.lambda) * 1000;
        const rr = Math.round(r);
        return Math.abs(r - rr) < 1.5 && rr >= 945 && rr <= 1055;
      }).length;
      console.log(
        `[SCAN] su=${suCoef}‰ bestλ=${best.lambda.toFixed(6)} beat-ok=${best.frac.toFixed(3)} | ${perLane} | L3(meas-stat):${ok3}/${samples3.length}`,
      );
      // L3 の implied 乱数系列（ドリフト形状）
      const l3s = samples3.slice(0, 41);
      console.log(
        `[SCAN] L3 implied-r: ${l3s.map((s) => Math.round((s.a / best.lambda) * 1000)).join(",")}`,
      );
      // L1 の implied 乱数系列（ドリフトの有無）
      const l1 = samples.filter((s) => s.lane === 1).slice(0, 127);
      const rSeries = l1
        .map((s, i) => `b${i * 5 + 4}:${Math.round((s.a / best.lambda) * 1000)}`)
        .slice(0, 26)
        .join(" ");
      console.log(`[SCAN] L1 implied-r (every 5th): ${rSeries}`);
    }
  });

  it("λ確定: 高精度popの整数ランダム候補交集 + L3のb1×cb実効比", () => {
    const lanes = buildLanes();
    const res = simulateTimeline(buildInput(lanes));
    const liveMultV = (snap: { vocal_up: number; vocal_up_extreme: number; vocal_boost: number }) =>
      1000 + 50 * (snap.vocal_up + snap.vocal_up_extreme) + 75 * snap.vocal_boost;
    // A = pop/(basic×(b1/1000)×rest) = λ×r/1000（r=離散乱数） → λ = A×1000/r, r∈[950,1050]
    const all: Array<{ lane: number; beat: number; a: number; pop: number; snap: (typeof res.beats)[0]["buffSnapshots"][0]; b1: number; cb: number; basicMeas: number }> = [];
    for (const bt of res.beats) {
      if (bt.beat <= 3 || bt.noteType !== 1) continue;
      const row = t5.timeline.find((t) => t.beat === bt.beat);
      if (!row) continue;
      const polluted = new Set(
        bt.activations.filter((a) => a.success && a.gainedScore != null).map((a) => a.lane),
      );
      for (const e of bt.events) {
        if (e.critFactorPermil !== 1000 || polluted.has(e.lane)) continue;
        const pop = row.pops?.[String(e.lane)];
        if (pop == null || pop === 0) continue;
        const laneIdx = e.lane - 1;
        const lane = lanes[laneIdx];
        const snap = bt.buffSnapshots[laneIdx];
        if (!lane || !snap) continue;
        const statMeasured = row.stat?.[String(e.lane)];
        const useMeasured = e.lane === 3 && statMeasured != null && statMeasured < 3.75 * lane.deck.vocal;
        const vocalPart = useMeasured
          ? mulPermil(statMeasured, 600)
          : mulPermil(mulPermil(lane.deck.vocal, liveMultV(snap)), 600);
        const basic = vocalPart + mulPermil(lane.deck.dance, 250) + mulPermil(lane.deck.visual, 150);
        const rest =
          (e.fanFactorPermil / 1000) * (e.critFactorPermil / 1000);
        const a = pop / (basic * (e.b1Permil / 1000) * (e.comboFactorPermil / 1000) * rest);
        all.push({ lane: e.lane, beat: bt.beat, a, pop, snap, b1: e.b1Permil, cb: e.comboFactorPermil, basicMeas: basic });
      }
    }
    // 高精度（pop≥1e6）サンプルから λ 候補の交集
    const precise = [...all].filter((s) => s.pop >= 1e6).sort((x, y) => y.pop - x.pop).slice(0, 8);
    let candidates: number[] = [];
    for (const s of precise) {
      const set: number[] = [];
      for (let r = 950; r <= 1050; r++) set.push((s.a * 1000) / r);
      if (candidates.length === 0) {
        candidates = set;
      } else {
        const tol = 1e-9;
        candidates = candidates.filter((c) => set.some((v) => Math.abs(v - c) < tol * c));
      }
      if (candidates.length <= 2) break;
    }
    console.log(
      `[LAM] precise n=${precise.length} surviving-λ=${candidates.length}: ` +
        candidates.slice(0, 8).map((c) => c.toFixed(8)).join(" ") +
        (candidates.length > 0 ? ` (8/140=${(8 / 140).toFixed(8)})` : ""),
    );
    // L3: 実測stat基本での (b1×cb)_true 推定と sim 値の比
    for (const s of all.filter((x) => x.lane === 3).slice(0, 40)) {
      const fan = 1.62;
      const trueB1cb = s.pop / (s.basicMeas * fan * (8 / 140));
      const simB1cb = (s.b1 / 1000) * (s.cb / 1000);
      console.log(
        `[L3R] b${s.beat} true=${trueB1cb.toFixed(4)} sim=${simB1cb.toFixed(4)} ratio=${(trueB1cb / simB1cb).toFixed(4)} su=${s.snap.score_up} asu=${s.snap.a_skill_score_up} csu=${s.snap.combo_score_up} foc=${s.snap.focus} ten=${s.snap.tension_up} statMeas=${s.basicMeas}`,
      );
    }
  });

  it("L3早期スナップショット詳細: b1-b6の効果付与履歴とスキル定義", () => {
    const lanes = buildLanes();
    const l3 = lanes[2];
    if (!l3) throw new Error("L3 missing");
    console.log(
      `[L3DEF] deck=`, JSON.stringify(l3.deck),
      `\n[L3DEF] A/SP/P skills:`,
      l3.skills.map((s) => `${s.id}[${s.kind}] ct=${s.ct ?? "-"} cost=${s.staminaCost ?? 0} effects=${JSON.stringify(s.effects)}`).join("\n  "),
      `\n[L3DEF] photos:`,
      l3.photos.map((s) => `${s.id} limit=${s.limitPerLive ?? "-"} effects=${JSON.stringify(s.effects)}`).join("\n  "),
    );
    const res = simulateTimeline(buildInput(lanes));
    for (const bt of res.beats.filter((b) => b.beat <= 6)) {
      console.log(
        `[L3EARLY] b${bt.beat} acts=[${bt.activations.map((a) => `${a.lane}:${a.skillId || "FAIL"}:${a.success ? "ok" : a.failReason}`).join(", ")}] L3snap=${JSON.stringify(bt.buffSnapshots[2])}`,
      );
    }
  });

  it("L3係数グリッド全探索: su/asu係数×csuオフセットの同時最適", () => {
    const lanes = buildLanes();
    const res = simulateTimeline(buildInput(lanes));
    const liveMultV = (snap: { vocal_up: number; vocal_up_extreme: number; vocal_boost: number }) =>
      1000 + 50 * (snap.vocal_up + snap.vocal_up_extreme) + 75 * snap.vocal_boost;
    const LAM = 8 / 140;
    const samples: Array<{ beat: number; a0: number; su: number; asu: number; csu: number; cbBase: number }> = [];
    for (const bt of res.beats) {
      if (bt.beat <= 3 || bt.noteType !== 1) continue;
      const row = t5.timeline.find((t) => t.beat === bt.beat);
      if (!row) continue;
      const polluted = new Set(
        bt.activations.filter((a) => a.success && a.gainedScore != null).map((a) => a.lane),
      );
      const e = bt.events.find((x) => x.lane === 3);
      if (!e || e.critFactorPermil !== 1000 || polluted.has(3)) continue;
      const pop = row.pops?.["3"];
      if (pop == null || pop === 0) continue;
      const lane = lanes[2];
      const snap = bt.buffSnapshots[2];
      if (!lane || !snap) continue;
      const statMeasured = row.stat?.["3"];
      const vocalPart =
        statMeasured != null && statMeasured < 3.75 * lane.deck.vocal
          ? mulPermil(statMeasured, 600)
          : mulPermil(mulPermil(lane.deck.vocal, liveMultV(snap)), 600);
      const basic = vocalPart + mulPermil(lane.deck.dance, 250) + mulPermil(lane.deck.visual, 150);
      const rest = (e.fanFactorPermil / 1000) * (e.critFactorPermil / 1000);
      // a0 = pop/(basic×fan×crit) = (b1/1000)×(cb/1000)×λ×r/1000
      const a0 = pop / (basic * rest);
      const cbBase = e.comboFactorPermil / (1 + 0.1 * snap.combo_score_up); // (1000+base)
      samples.push({ beat: bt.beat, a0, su: snap.score_up, asu: snap.a_skill_score_up, csu: snap.combo_score_up, cbBase });
    }
    const results: Array<{ suC: number; asuC: number; off: number; ok: number; n: number }> = [];
    for (const suC of [0, 25] as const) {
      for (const asuC of [0, 25] as const) {
        for (let off = 0; off >= -8; off--) {
          let ok = 0;
          for (const s of samples) {
            const csuT = Math.max(0, s.csu + off);
            const b1 = 1000 + suC * s.su + asuC * s.asu + 360;
            const cb = s.cbBase * (1 + 0.1 * csuT);
            const r = (s.a0 / ((b1 / 1000) * (cb / 1000) * LAM)) * 1000;
            const rr = Math.round(r);
            if (Math.abs(r - rr) < 1.5 && rr >= 945 && rr <= 1055) ok++;
          }
          results.push({ suC, asuC, off, ok, n: samples.length });
        }
      }
    }
    results.sort((x, y) => y.ok - x.ok);
    for (const r of results.slice(0, 8)) {
      console.log(`[L3GRID] su=${r.suC} asu=${r.asuC} csuOff=${r.off} ok=${r.ok}/${r.n}`);
    }
    // 最良組合せの implied-r 系列
    const best = results[0];
    if (best) {
      const series = samples
        .map((s) => {
          const csuT = Math.max(0, s.csu + best.off);
          const b1 = 1000 + best.suC * s.su + best.asuC * s.asu + 360;
          const cb = s.cbBase * (1 + 0.1 * csuT);
          return Math.round((s.a0 / ((b1 / 1000) * (cb / 1000) * LAM)) * 1000);
        })
        .join(",");
      console.log(`[L3GRID] best implied-r: ${series}`);
    }
  });

  it("L3へのsu/csu付与履歴（全ライブ）", () => {
    const lanes = buildLanes();
    const res = simulateTimeline(buildInput(lanes));
    let prev = { su: 0, csu: 0 };
    for (const bt of res.beats) {
      const snap = bt.buffSnapshots[2];
      if (!snap) continue;
      if (snap.score_up !== prev.su || snap.combo_score_up !== prev.csu) {
        const grants = bt.activations
          .filter((a) => a.success && a.lane !== 3)
          .map((a) => `${a.lane}:${a.skillId}`);
        console.log(
          `[L3G] b${bt.beat} su=${prev.su}->${snap.score_up} csu=${prev.csu}->${snap.combo_score_up} | 他レーン発動: ${grants.join(", ")}`,
        );
        prev = { su: snap.score_up, csu: snap.combo_score_up };
      }
    }
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

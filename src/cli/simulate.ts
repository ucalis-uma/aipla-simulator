#!/usr/bin/env node
/**
 * Phase 4 MVP: タイムライン・スコアシミュレーター CLI。
 *
 * 使い方:
 *   npx tsx src/cli/simulate.ts --input <deck.json> [--n 1000] [--crit-rate 0] [--out out.json]
 *
 * 入力 JSON（--input・編成+ステージ+チャート）:
 * {
 *   "deck":    スコア分析サンプル/verification_data_v2.json と同一スキーマ
 *              （staff_bonus / yale_bonus / characters[5]）,
 *   "stage":   { "file": "qt-daily-003-19", "laneAttributes": [2,2,1,2,2] },
 *   "chart":   { "file": "chart-hsm-004-001" },
 *   "missedNotes": [{ "beat": 1, "lane": 1 }, ...]   （省略可）
 *   "mentalOverride": { "1": 105, ... }              （省略可）
 * }
 *
 * 出力（stdout / --out）:
 *   { settings, stats: { min, max, mean, median, p10, p90 }, timeline: 中央値ランのビート毎明細 }
 *
 * スコア乱数は連続値 [0.95,1.05]（T5確定・at-end 丸め）。クリティカル率は確率パラメータ
 * （crit-rate・既定 0。レート式は未解明のため T5 では実測フラグ注入で検証）。
 * サンプル: tests/golden/ の T5 編成を使う場合は sample deck 生成スクリプト参照。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeDeckStatus } from "../formula/baseStatus.js";
import { pctToPermil } from "../rounding.js";
import { simulateTimeline } from "../timeline/engine.js";
import { EVENT_RAND_MIN_PERMIL, EVENT_RAND_MAX_PERMIL } from "../formula/scoreEvent.js";
import type {
  ChartNote,
  LaneInput,
  LaneNumber,
  SimulateInput,
  SkillDef,
  StageInput,
} from "../timeline/types.js";
import type { ScoreRng } from "../rng/types.js";
import type { CardDef, CardParameterRow, StatBonus, StatValues, YellBonus } from "../types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface CliArgs {
  input: string;
  n: number;
  critRate: number;
  out: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { input: "", n: 1000, critRate: 0, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i] ?? "";
    else if (a === "--n") args.n = Number(argv[++i] ?? 1000);
    else if (a === "--crit-rate") args.critRate = Number(argv[++i] ?? 0);
    else if (a === "--out") args.out = argv[++i] ?? null;
  }
  if (!args.input) {
    console.error("usage: simulate.ts --input <deck.json> [--n 1000] [--crit-rate 0] [--out out.json]");
    process.exit(1);
  }
  return args;
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
interface DeckJson {
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
interface SimConfigJson {
  /** 編成（inline）。deckFile との併用不可 */
  deck?: DeckJson;
  /** 編成 JSON へのパス（入力ファイルからの相対・verification_data_v2.json と同一スキーマ） */
  deckFile?: string;
  stage: { file: string; laneAttributes: [number, number, number, number, number] };
  chart: { file: string };
  missedNotes?: Array<{ beat: number; lane: number }>;
  mentalOverride?: Record<string, number>;
  fanFactorPermil?: number;
  successBasePermil?: number;
}

/** 実乱数源（ScoreRng 実装）。スコア乱数=連続値 [950,1050]、クリティカル=critRate */
class RandomRng implements ScoreRng {
  constructor(private readonly critRate: number) {}
  nextScoreRoll(): number {
    return EVENT_RAND_MIN_PERMIL + Math.random() * (EVENT_RAND_MAX_PERMIL - EVENT_RAND_MIN_PERMIL);
  }
  nextCritical(): boolean {
    return Math.random() < this.critRate;
  }
}

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
      if (s.stat === key && s.type === "pct") sum += pctToPermil(s.value);
    }
  }
  return sum;
}

function yell(y: DeckJson["yale_bonus"]): YellBonus {
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

const LANE_ATTRIBUTE: Record<LaneNumber, "vocal" | "dance" | "visual"> = {
  1: "vocal",
  2: "vocal",
  3: "vocal",
  4: "dance",
  5: "vocal",
};

interface BuiltConfig {
  lanes: LaneInput[];
  notes: ChartNote[];
  stage: StageInput;
  fanFactorPermil: number;
  successBasePermil: number;
  missedNotes: Array<{ beat: number; lane: LaneNumber }>;
}

function buildConfig(cfgJson0: SimConfigJson): BuiltConfig {
  const cfg: SimConfigJson & { deck: DeckJson } = cfgJson0 as never;
  const cardsData = JSON.parse(
    readFileSync(path.join(repoRoot, "data/cards.json"), "utf-8"),
  ) as { cards: CardDef[] };
  const cards = cardsData.cards;
  const paramsData = JSON.parse(
    readFileSync(path.join(repoRoot, "data/card_parameters.json"), "utf-8"),
  ) as { rows: CardParameterRow[] };
  const params = paramsData.rows;
  const skillsGolden = JSON.parse(
    readFileSync(path.join(repoRoot, "data/skills_golden.json"), "utf-8"),
  ) as { skills: SkillDef[] };
  const stageData = JSON.parse(
    readFileSync(path.join(repoRoot, "data/stages", `${cfg.stage.file}.json`), "utf-8"),
  ) as {
    beatWeightsPermil: { vocal: number; dance: number; visual: number };
    skillWeightsPermil: { active: number; special: number };
  };
  const chartData = JSON.parse(
    readFileSync(path.join(repoRoot, "data/charts", `${cfg.chart.file}.json`), "utf-8"),
  ) as { notes: Array<{ beat: number; type: number; position: number }> };

  const Y = yell(cfg.deck.yale_bonus);
  const lanes: LaneInput[] = [];
  for (const ch of cfg.deck.characters) {
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
        staff: cfg.deck.staff_bonus,
        yell: Y,
        equipment: { photos: toStatBonus(ch.photos), accessories: toStatBonus(ch.accessories) },
      },
      row,
    );
    const mental = Number(cfg.mentalOverride?.[String(lane)] ?? ch.stats.base.stamina);
    const deck: StatValues<number> = { ...result.deck, mental, critical: 0 };
    const equipment = [...ch.photos, ...ch.accessories];
    lanes.push({
      lane,
      attribute: LANE_ATTRIBUTE[lane],
      role: ch.role as LaneInput["role"],
      deck,
      skills: skillsGolden.skills.filter(
        (s) => s.lane === lane && (s.kind === "A" || s.kind === "SP" || s.kind === "P"),
      ),
      photos: skillsGolden.skills.filter(
        (s) => s.lane === lane && s.kind === "photo" && (s.effects?.length ?? 0) > 0,
      ),
      scoreBonusPct: {
        beat: Y.scorePct.beat + sumScorePct(equipment, "beat_score"),
        active: Y.scorePct.active + sumScorePct(equipment, "a_score"),
        special: Y.scorePct.special + sumScorePct(equipment, "sp_score"),
        passive: sumScorePct(equipment, "p_score"),
      },
      critExtrasPermil: Y.scorePct.criticalScore + sumScorePct(equipment, "critical_score"),
    });
  }
  lanes.sort((a, b) => a.lane - b.lane);
  const notes: ChartNote[] = chartData.notes.map((n) => ({
    beat: n.beat,
    noteType: n.type as 1 | 2 | 3,
    position: n.position as ChartNote["position"],
  }));
  const stage: StageInput = {
    id: cfg.stage.file,
    laneAttributes: cfg.stage.laneAttributes as StageInput["laneAttributes"],
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
    fanFactorPermil: cfg.fanFactorPermil ?? 1620,
    successBasePermil: cfg.successBasePermil ?? 1000,
    missedNotes: (cfg.missedNotes ?? []).map((m) => ({
      beat: m.beat,
      lane: m.lane as LaneNumber,
    })),
  };
}

function runOnce(cfg: BuiltConfig, rng: ScoreRng): number {
  const input: SimulateInput = {
    lanes: cfg.lanes,
    notes: cfg.notes,
    stage: cfg.stage,
    fanFactorPermil: cfg.fanFactorPermil,
    successBasePermil: cfg.successBasePermil,
    criticalProvider: (beat, lane) => rng.nextCritical(),
    rng,
    roundingPolicy: "at-end",
    missedNotes: cfg.missedNotes,
  };
  return simulateTimeline(input).totalScore;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx]!;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  if (!existsSync(inputPath)) {
    console.error(`input not found: ${inputPath}`);
    process.exit(1);
  }
  const cfgJson = JSON.parse(readFileSync(inputPath, "utf-8")) as SimConfigJson;
  if (!cfgJson.deck && cfgJson.deckFile) {
    const deckPath = path.resolve(path.dirname(inputPath), cfgJson.deckFile);
    cfgJson.deck = JSON.parse(readFileSync(deckPath, "utf-8")) as DeckJson;
  }
  if (!cfgJson.deck) {
    console.error("input must have `deck` (inline) or `deckFile` (path)");
    process.exit(1);
  }
  const cfg = buildConfig(cfgJson);
  const rng = new RandomRng(args.critRate);

  const scores: number[] = [];
  for (let i = 0; i < args.n; i++) {
    scores.push(runOnce(cfg, rng));
  }
  const sorted = [...scores].sort((a, b) => a - b);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const median = percentile(sorted, 0.5);

  // 代表ラン（中央値に最も近いスコア）のタイムライン明細
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < scores.length; i++) {
    const d = Math.abs(scores[i]! - median);
    if (d < bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  }
  const timelineRng = new RandomRng(args.critRate);
  const timelineScores: number[] = [];
  for (let i = 0; i <= bestIdx; i++) {
    timelineScores.push(runOnce(cfg, timelineRng));
  }
  const input: SimulateInput = {
    lanes: cfg.lanes,
    notes: cfg.notes,
    stage: cfg.stage,
    fanFactorPermil: cfg.fanFactorPermil,
    successBasePermil: cfg.successBasePermil,
    criticalProvider: () => timelineRng.nextCritical(),
    rng: timelineRng,
    roundingPolicy: "at-end",
    missedNotes: cfg.missedNotes,
  };
  const rep = simulateTimeline(input);
  const timeline = rep.beats.map((bt) => {
    let cum = 0;
    let gained = 0;
    for (const e of bt.events) {
      cum += e.gainedScore;
      gained += e.gainedScore;
    }
    return {
      beat: bt.beat,
      type: bt.noteType,
      position: bt.position,
      events: bt.events.map((e) => ({
        lane: e.lane,
        gained: e.gainedScore,
        crit: e.critFactorPermil > 1000,
      })),
      gained,
      cumulative: cum,
    };
  });
  // 累積の再構築（gained はビート毎合算のため）
  let cum = 0;
  for (const t of timeline) {
    cum += t.gained;
    t.cumulative = cum;
  }

  const result = {
    settings: {
      n: args.n,
      critRate: args.critRate,
      stage: cfgJson.stage.file,
      chart: cfgJson.chart.file,
      roundingPolicy: "at-end",
      randRange: [EVENT_RAND_MIN_PERMIL, EVENT_RAND_MAX_PERMIL],
    },
    stats: {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: Math.round(mean),
      median,
      p10: percentile(sorted, 0.1),
      p90: percentile(sorted, 0.9),
    },
    timeline,
  };
  const json = JSON.stringify(result, null, 1);
  if (args.out) {
    writeFileSync(path.resolve(args.out), json, "utf-8");
    console.log(`written: ${path.resolve(args.out)}`);
  }
  console.log(json);
}

main();

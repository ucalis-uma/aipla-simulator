#!/usr/bin/env node
/**
 * Phase 4: タイムライン・スコアシミュレーター CLI。
 *
 * 使い方:
 *   npm run simulate -- --input examples/t5-sample.json [--n 1000] [--crit-rate 0]
 *                       [--seed 1] [--out out.json]
 *
 * 入力 JSON（--input・編成+ステージ+チャート）:
 * {
 *   "deck":    verification_data_v2.json と同一スキーマ
 *              （staff_bonus / yale_bonus / characters[5]）,
 *              ※ "deckFile" で外部 JSON 参照も可（入力ファイルからの相対パス）
 *   "stage":   { "file": "qt-daily-003-19" },
 *   "chart":   { "file": "chart-hsm-004-001" },
 *   "audience": 16000,                      （省略可・来場ファン数→ファンファクター。省略時 1620‰ 固定）
 *   "successBasePermil": 1000,              （省略可・成功率の基礎値）
 *   "missedNotes": [{ "beat": 1, "lane": 1 }, ...],   （省略可）
 *   "mentalOverride": { "1": 105, ... },    （省略可・P発動順=メンタル降順に影響）
 *   "disabledSkillIds": ["sk-..."],         （省略可・スキル/フォトの無効化）
 *   "critRate": 0.5                         （省略可・基礎クリティカル率 0-1。Peing確定仕様:
 *                                            min(0.50, base) + crit率バフ5%/段 を動的抽選。
 *                                            既定 0.50）
 * }
 *
 * 出力（stdout / --out）:
 *   {
 *     settings,
 *     confirmed: { totalScore, lanes: レーン別内訳, timeline: ビート毎明細 },  // 乱数中立（rand=1000・crit なし）
 *     stats: { min, max, mean, median, p10, p90, laneMeans }                  // Monte Carlo N 回
 *   }
 *
 * スコア乱数は連続値 [0.95,1.05]（T5確定・at-end 丸め）。クリティカルは動的モード
 * （baseCritRate・Peing確定 2026-08-30）でスナップショット毎に抽選する。シード固定で再現可能。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateTimeline } from "../timeline/engine.js";
import type { TimelineResult } from "../timeline/types.js";
import { EVENT_RAND_MIN_PERMIL, EVENT_RAND_MAX_PERMIL } from "../formula/scoreEvent.js";
import { ContinuousRng } from "../rng/random.js";
import { NeutralRng } from "../rng/neutral.js";
import type { ScoreRng } from "../rng/types.js";
import {
  buildSimulateInput,
  laneBreakdown,
  type ChartFile,
  type DeckJsonV2,
  type MasterSkillDef,
  type SimSourceData,
  type SimulateInputBase,
  type StageWeights,
} from "../sim/build.js";
import type { AudienceAdvantageRow } from "../formula/fan.js";
import type { CardDef, CardParameterRow } from "../types.js";
import type { SkillDef } from "../timeline/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface CliArgs {
  input: string;
  n: number;
  critRate: number | null;
  seed: number;
  out: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { input: "", n: 1000, critRate: null, seed: 1, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i] ?? "";
    else if (a === "--n") args.n = Number(argv[++i] ?? 1000);
    else if (a === "--crit-rate") args.critRate = Number(argv[++i] ?? 0.5);
    else if (a === "--seed") args.seed = Number(argv[++i] ?? 1);
    else if (a === "--out") args.out = argv[++i] ?? null;
  }
  if (!args.input) {
    console.error(
      "usage: simulate.ts --input <config.json> [--n 1000] [--crit-rate 0.5] [--seed 1] [--out out.json]",
    );
    process.exit(1);
  }
  return args;
}

interface SimConfigJson {
  /** 編成（inline）。deckFile との併用不可 */
  deck?: DeckJsonV2;
  /** 編成 JSON へのパス（入力ファイルからの相対） */
  deckFile?: string;
  stage: { file: string };
  chart: { file: string };
  audience?: number;
  fanFactorPermil?: number;
  successBasePermil?: number;
  missedNotes?: Array<{ beat: number; lane: number }>;
  mentalOverride?: Record<string, number>;
  disabledSkillIds?: string[];
  /** 基礎クリティカル率 0-1（Peing確定仕様の動的モード。省略時 0.5） */
  critRate?: number;
}

function loadSourceData(stageFile: string, chartFile: string): SimSourceData {
  const read = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));
  const cards = (read(path.join(repoRoot, "data/cards.json")) as { cards: CardDef[] }).cards;
  const cardParameters = (read(path.join(repoRoot, "data/card_parameters.json")) as { rows: CardParameterRow[] })
    .rows;
  const skillsGolden = (read(path.join(repoRoot, "data/skills_golden.json")) as { skills: SkillDef[] })
    .skills;
  // 【Phase 6】マスタ自動解析スキル（全カード・Estimate）。golden があるカードは
  // buildSimulateInput がそちらを優先する
  let skillsByCard: SimSourceData["skillsByCard"];
  try {
    skillsByCard = (read(path.join(repoRoot, "data/skills_master.json")) as { byCard: never })
      .byCard as never;
  } catch {
    skillsByCard = undefined;
  }
  const stages: Record<string, StageWeights> = {};
  const stageJsonPath = path.join(repoRoot, "data/stages", `${stageFile}.json`);
  if (existsSync(stageJsonPath)) {
    stages[stageFile] = read(stageJsonPath) as StageWeights;
  } else {
    // 【Phase 6】data/stages/ に個別ファイルが無いステージは stages_index から構築する
    const idx = read(path.join(repoRoot, "data/stages_index.json")) as {
      quests: Array<{ id: string; c: number; ch: number }>;
      configs: Array<{
        a: number[];
        w: number[];
        aw: number[];
      }>;
      charts: string[];
    };
    const quest = idx.quests.find((q) => q.id === stageFile);
    if (quest === undefined) {
      throw new Error(`stage not found in data: ${stageFile}`);
    }
    const cfg = idx.configs[quest.c]!;
    stages[stageFile] = {
      beatWeightsPermil: { vocal: cfg.w[0]!, dance: cfg.w[1]!, visual: cfg.w[2]! },
      skillWeightsPermil: { active: cfg.aw[0]!, special: cfg.aw[1]! },
      laneAttributes: cfg.a,
    };
  }
  const charts: Record<string, ChartFile> = {};
  const chartPath = path.join(repoRoot, "data/charts", `${chartFile}.json`);
  if (existsSync(chartPath)) {
    charts[chartFile] = read(chartPath) as ChartFile;
  } else {
    const all = read(path.join(repoRoot, "data/charts_all.json")) as Record<string, Array<[number, number]>>;
    const compact = all[chartFile];
    if (compact === undefined) {
      throw new Error(`chart not found in data: ${chartFile}`);
    }
    charts[chartFile] = {
      notes: compact.map(([type, position], i) => ({
        beat: i + 1,
        type: type as 1 | 2 | 3,
        position,
      })),
    };
  }
  let audienceAdvantage: AudienceAdvantageRow[] | undefined;
  try {
    audienceAdvantage = read(path.join(repoRoot, "data/stages/audience_advantage.json")) as AudienceAdvantageRow[];
  } catch {
    audienceAdvantage = undefined;
  }
  // 【Phase 9】ステージのライブボーナスPスキル（research/16 §1）。無ければ undefined
  let liveBonusesByQuest: Record<string, MasterSkillDef[]> | undefined;
  try {
    liveBonusesByQuest = (read(path.join(repoRoot, "data/live_bonuses.json")) as {
      byQuest: Record<string, MasterSkillDef[]>;
    }).byQuest;
  } catch {
    liveBonusesByQuest = undefined;
  }
  let characterNames: Record<string, string> | undefined;
  try {
    characterNames = (read(path.join(repoRoot, "data/characters.json")) as { characters: Record<string, string> })
      .characters;
  } catch {
    characterNames = undefined;
  }
  return {
    cards,
    cardParameters,
    skillsGolden,
    stages,
    charts,
    audienceAdvantage,
    skillsByCard,
    liveBonusesByQuest,
    characterNames,
  };
}

/** 1シミュレーション実行（乱数源とクリティカル判定源を注入） */
function run(
  base: SimulateInputBase,
  rng: ScoreRng,
  criticalProvider: (beat: number, lane: number) => boolean,
): TimelineResult {
  return simulateTimeline({ ...base, criticalProvider, rng });
}
function buildInput(cfg: SimConfigJson, inputPath: string, critRate: number): SimulateInputBase {
  if (!cfg.deck && cfg.deckFile) {
    const deckPath = path.resolve(path.dirname(inputPath), cfg.deckFile);
    cfg.deck = JSON.parse(readFileSync(deckPath, "utf-8")) as DeckJsonV2;
  }
  if (!cfg.deck) {
    throw new Error("input must have `deck` (inline) or `deckFile` (path)");
  }
  const data = loadSourceData(cfg.stage.file, cfg.chart.file);
  // 【Phase 9】ステージのライブボーナスを表示（SimulateInput へは buildSimulateInput が注入）
  const liveBonusDefs = data.liveBonusesByQuest?.[cfg.stage.file];
  if (liveBonusDefs !== undefined && liveBonusDefs.length > 0) {
    for (const lb of liveBonusDefs) {
      console.error(
        `[live-bonus] ${lb.id} CT${lb.ct ?? "—"}: ${(lb as unknown as { description?: string }).description || lb.name}`,
      );
    }
  }
  const built = buildSimulateInput({
    deck: cfg.deck,
    stageFile: cfg.stage.file,
    chartFile: cfg.chart.file,
    data,
    audience: cfg.audience,
    fanFactorPermil: cfg.fanFactorPermil,
    successBasePermil: cfg.successBasePermil,
    missedNotes: cfg.missedNotes,
    mentalOverride: cfg.mentalOverride,
    disabledSkillIds: cfg.disabledSkillIds,
    baseCritRate: critRate,
  });
  for (const w of built.warnings) {
    console.error(`[warn] ${w}`);
  }
  return built.base;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx]!;
}

function timelineOf(res: TimelineResult) {
  let cum = 0;
  const beats = res.beats.map((bt) => {
    const gained = bt.events.reduce((s, e) => s + e.gainedScore, 0);
    cum += gained;
    return {
      beat: bt.beat,
      type: bt.noteType,
      position: bt.position,
      events: bt.events.map((e) => ({
        lane: e.lane,
        kind: e.sourceKind,
        gained: e.gainedScore,
        crit: e.critFactorPermil > 1000,
      })),
      activations: bt.activations.map((a) => ({
        lane: a.lane,
        skill: a.skillId,
        kind: a.kind,
        phase: a.phase,
        success: a.success,
        gained: a.gainedScore ?? 0,
        failReason: a.failReason,
        staminaCost: a.staminaCost,
      })),
      gained,
      cumulative: cum,
      combo: [...bt.comboAfter],
      stamina: [...bt.staminaAfter],
      buffs: bt.buffSnapshots.map((s) => ({ ...s })),
    };
  });
  return beats;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  if (!existsSync(inputPath)) {
    console.error(`input not found: ${inputPath}`);
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(inputPath, "utf-8")) as SimConfigJson;
  // 【Peing確定 2026-08-30】クリティカルは動的モード（baseCritRate・既定 0.5）。
  // critRate 0 で非発生（旧挙動）。確定値ランは常に crit なし。
  const critRate = args.critRate ?? cfg.critRate ?? 0.5;
  const base = buildInput(cfg, inputPath, critRate);

  // ---- 確定値（乱数中立: rand=1000・crit なし・確率ゲートは必通過）----
  const confirmedBase = { ...base, baseCritRate: undefined };
  const confirmedRes = run(confirmedBase, new NeutralRng(), () => false);
  const confirmed = {
    totalScore: confirmedRes.totalScore,
    lanes: laneBreakdown(confirmedRes.beats),
    timeline: timelineOf(confirmedRes),
  };

  // ---- Monte Carlo（シード固定・連続値乱数・crit は動的モードで抽選）----
  const scores: number[] = [];
  const laneSums = new Map<number, number>();
  for (let i = 0; i < args.n; i++) {
    const rng = new ContinuousRng(args.seed + i);
    const res = run(base, rng, () => false);
    scores.push(res.totalScore);
    for (const bt of res.beats) {
      for (const e of bt.events) {
        laneSums.set(e.lane, (laneSums.get(e.lane) ?? 0) + e.gainedScore);
      }
    }
  }
  const sorted = [...scores].sort((a, b) => a - b);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const laneMeans = [...laneSums.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lane, sum]) => ({ lane, mean: Math.round(sum / args.n) }));

  const result = {
    settings: {
      n: args.n,
      baseCritRate: critRate,
      seed: args.seed,
      stage: cfg.stage.file,
      chart: cfg.chart.file,
      fanFactorPermil: base.fanFactorPermil,
      roundingPolicy: "at-end",
      randRange: [EVENT_RAND_MIN_PERMIL, EVENT_RAND_MAX_PERMIL],
      randType: "continuous (float)",
    },
    confirmed,
    stats: {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: Math.round(mean),
      median: percentile(sorted, 0.5),
      p10: percentile(sorted, 0.1),
      p90: percentile(sorted, 0.9),
      laneMeans,
    },
  };
  const json = JSON.stringify(result, null, 1);
  if (args.out) {
    writeFileSync(path.resolve(args.out), json, "utf-8");
    console.error(`written: ${path.resolve(args.out)}`);
  }
  console.log(json);
}

main();

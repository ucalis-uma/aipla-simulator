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
import type { LaneNumber, TimelineResult } from "../timeline/types.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../photos.js";
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

/** ステージ ID → 会場最大キャパシティ（stages_index の cap。loadSourceData が充填） */
const stageCapacities: Record<string, number | undefined> = {};

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
  /**
   * 【Phase 8-B9】マイフォト帳（UI エクスポートと同一形式・CLI でも解決）。
   * photoEquip[lane-1] = 装着する myPhotos の ID 列。スキル持ちフォトは
   * myPhotoToSkillDef で SkillDef 化して buildSimulateInput へ渡す。
   */
  myPhotos?: unknown[];
  photoEquip?: unknown[];
}

function loadSourceData(stageFile: string, chartFile: string): SimSourceData {  const read = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));
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
        /** 要求メンタル（stages_index 収載・CLI では未使用） */
        mt?: number;
        /** 会場最大キャパシティ（/5 = 個人来場ファン数の上限）。audience 導出に使用 */
        cap?: number;
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
    // 【2026-09-01】来場ファン数はステージの会場キャパから導出する（UI と同じ規則・
    // research/02 §1.8）。stages_index には cap / mt が収載されているが、従来ここで
    // 捨てていた（そのため CLI は deck の audience 値をそのまま信頼し、サンプル1 の
    // 71,000（=クリアスコアと同値）がファン 2000‰ にクランプされる誤動作を起こした）。
    stageCapacities[stageFile] = cfg.cap ?? undefined;
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
  // 【Phase 8-B3】レベル別スキル定義（編成 JSON の skill_levels 指定に使用）。無ければ undefined
  let skillLevels: SimSourceData["skillLevels"];
  try {
    skillLevels = read(path.join(repoRoot, "data/skills_levels.json")) as SimSourceData["skillLevels"];
  } catch {
    skillLevels = undefined;
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
    skillLevels,
  };
}

/**
 * 【Phase 8-B10 追補3】T5 実測サンプル（verification_data_v2.json）のレーン別フォト名。
 * golden フォトスキル（photo-L*）は「装着位置のフォトが T5 実測フォトと同一名」の場合のみ
 * 注入する（汎用編成への T5 由来スキル混入の防止）。サンプルが読めない環境では
 * undefined = 従来どおり装着位置のみで判定（フォールバック）。
 */
function loadGoldenPhotoNames(): string[][] | undefined {
  try {
    const sample = JSON.parse(
      readFileSync(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"), "utf-8"),
    ) as { characters: Array<{ photos: Array<{ name: string }> }> };
    return sample.characters.map((c) => c.photos.map((p) => p.name ?? ""));
  } catch {
    return undefined;
  }
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
  // 【2026-09-01】audience / fanFactorPermil が指定されない場合は、ステージの会場キャパから
  // 個人来場ファン数（容量÷5・上限 50,000 人）を導出する（UI の applyStage と同一規則・
  // research/02 §1.8「個人来場 = min(容量/5, 個人可能ファン数)」）。
  // 【2026-09-02 サンプル2修正】入力 JSON に audience が明示されている場合は導出しない。
  // 実測編成 JSON（fan.png 由来）は正しい個人来場ファン数を audience に持つため、
  // cap/5 での上書きは実測値を捨てる誤りだった（S1 の 71,000 は「クリアスコアと同値の
  // 誤値」問題で、正しい実測値の上書きは別問題。STAGE680: cap 70,000→14,000 が
  // 実測 13,206 を上書きしていた）。
  if (cfg.fanFactorPermil === undefined && cfg.audience === undefined) {
    const cap = stageCapacities[cfg.stage.file];
    if (cap !== undefined) {
      cfg.audience = Math.max(0, Math.min(50000, Math.floor(cap / 5)));
      console.error(`[stage] audience を会場キャパ ${cap} から導出: ${cfg.audience} 人`);
    }
  }
  // 【Phase 9】ステージのライブボーナスを表示（SimulateInput へは buildSimulateInput が注入）
  const liveBonusDefs = data.liveBonusesByQuest?.[cfg.stage.file];
  if (liveBonusDefs !== undefined && liveBonusDefs.length > 0) {
    for (const lb of liveBonusDefs) {
      console.error(
        `[live-bonus] ${lb.id} CT${lb.ct ?? "—"}: ${(lb as unknown as { description?: string }).description || lb.name}`,
      );
    }
  }
  // 【Phase 8-B9】マイフォト帳の装備（myPhotos + photoEquip）からユーザーフォトスキルを収集。
  // UI の collectUserPhotoSkills と同一規則（レーン=配列 index+1・photoIndex=装着順）。
  const myPhotos = Array.isArray(cfg.myPhotos) ? (cfg.myPhotos as MyPhotoDef[]) : [];
  const photoEquip = Array.isArray(cfg.photoEquip) ? (cfg.photoEquip as unknown[]).map((ids) => (Array.isArray(ids) ? (ids as string[]) : [])) : [];
  const userPhotoSkills = myPhotos.length > 0
    ? photoEquip.flatMap((ids, i) =>
        ids.flatMap((pid, j) => {
          const p = myPhotos.find((x) => x?.id === pid);
          if (p === undefined) return [];
          const def = myPhotoToSkillDef(p, (i + 1) as LaneNumber, j + 1);
          return def !== null ? [def] : [];
        }),
      )
    : undefined;
  // 【Phase 8-B10】photoEquip 装着分の myPhotos ステータスを deck.photos へ統合
  // （UI toDeck の装備マージと同一規則）。画像→JSON 生成フローや UI エクスポートは
  // ステータスを characters[].photos 側にも書くため同名重複はスキップされ二重計算にならず、
  // frames のみのファイルではここで初めて統合される
  photoEquip.forEach((ids, i) => {
    const ch = cfg.deck?.characters[i];
    if (ch === undefined || !Array.isArray(ch.photos)) return;
    const equipped = ids
      .map((pid) => myPhotos.find((x) => x?.id === pid))
      .filter((p): p is MyPhotoDef => p !== undefined);
    ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
  });
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
    userPhotoSkills,
    goldenPhotoNames: loadGoldenPhotoNames(),
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

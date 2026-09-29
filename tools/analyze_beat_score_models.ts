/**
 * tools/analyze_beat_score_models.ts — Phase 16 アクション1
 *
 * 通常ビート（白ノーツ）スコア式の 4 モデル検証 ＋ S3 confirmed ギャップ要因分解。
 *
 *   実行: npx tsx tools/analyze_beat_score_models.ts [--samples S3,T5,S2]
 *         [--json research/23_beat_score_analysis/phase16_action1_data.json]
 *         [--quiet]
 *
 * ## 検証モデル（変更するのは「通常ビート」だけ。A/SP/P/フォト/ライボのスコアは全モデル共通）
 *
 *   A: λ=8/140 ＋ フォト beat_score% 最大値  ← 現行エンジン（engine.ts BEAT_LAMBDA_* / build.ts maxScorePct）
 *   B: λ=1/20  ＋ フォト beat_score% 合計    ← やる気士 docs 式（idolyphoon score.rs）
 *   C: λ=1/20  ＋ フォト beat_score% 最大値
 *   D: λ=8/140 ＋ フォト beat_score% 合計
 *
 * ## 方法論（判定規律）
 *
 *  - 比較ランは **実測クリティカル再現 ＋ 乱数中立（rand=1000）**。実測側はイベント毎に
 *    rand∈[950,1050] を引くため、式が正しければ **全ビートで** sim/meas ∈ [0.9500,1.0500] に
 *    収まる。1ビートでも外れたモデルは不合格（平均での判定は行わない。prompts/phase16 §2）。
 *  - λ と フォト max/sum は通常ビートの basic / B1 にのみ作用する（バフ・CT・他スコア種別に
 *    影響しない）ので、src/ を恒久変更せず、エンジントレースのファクターから各モデル値を
 *    **厳密に**再計算する。正当性の担保として、まず現行モデル（A）でトレースの gainedScore と
 *    1 イベントも例外なく一致することを確認する（self-check。不一致があれば即中断）。
 *  - 割合型スコア（isRatioScore）は累積スコアを経由してモデル変化の影響を受ける。S2/S3 では
 *    発生 0 件、T5 では L3 の巨大スコアが割合型 → T5 のモデル合計は「スキルスコア固定」の
 *    一次近似であることを出力に明記する。
 *
 * ## 出典
 *  - λ=8/140・重み総和式: src/timeline/engine.ts settleBeatNote（T5実測確定）
 *  - フォト beat_score% 最大値: src/sim/build.ts maxScorePct（サンプル3実測確定 2026-09-04）
 *  - docs 式（λ=1/20・全装備和）: research/23_beat_score_analysis/idolyphoon_formulas.md
 *  - 実測: research/26_data_integrity/measured_data_s3_v3.json / measured_data_s2_v3.json /
 *          aipura_nox/サンプル2/lane_pops_backfill.json / tests/golden/fixtures/t5_measured.json
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSimulateInput, type SimSourceData } from "../src/sim/build.js";
import { simulateTimeline } from "../src/timeline/engine.js";
import { NeutralRng } from "../src/rng/neutral.js";
import { computeEventScore } from "../src/formula/scoreEvent.js";
import { liveStatusMultiplierPermil } from "../src/timeline/buffs.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../src/photos.js";
import { mulPermil, pctToPermil } from "../src/rounding.js";
import type { LaneScoreEventTrace, TimelineResult } from "../src/timeline/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));

/** 現行エンジンの λ（engine.ts BEAT_LAMBDA_NUM / BEAT_LAMBDA_DEN） */
const LAM_CURRENT = { num: 8, den: 140 };
/** docs 式（やる気士）の λ */
const LAM_DOCS = { num: 1, den: 20 };

type PhotoRule = "max" | "sum";
type SampleTag = "S3" | "T5" | "S2" | "S1";
type ModelKey = "A" | "B" | "C" | "D";

interface Model {
  key: ModelKey;
  lam: { num: number; den: number };
  photo: PhotoRule;
  label: string;
}

const MODELS: Model[] = [
  { key: "A", lam: LAM_CURRENT, photo: "max", label: "λ=8/140 + photo max（現行）" },
  { key: "B", lam: LAM_DOCS, photo: "sum", label: "λ=1/20 + photo sum（docs本命）" },
  { key: "C", lam: LAM_DOCS, photo: "max", label: "λ=1/20 + photo max" },
  { key: "D", lam: LAM_CURRENT, photo: "sum", label: "λ=8/140 + photo sum" },
];

/** 乱数幅の許容帯（prompts/phase16 §2: ±5.0%・個別判定） */
const TOL_LO = 0.95;
const TOL_HI = 1.05;

// ---------------------------------------------------------------------------
// 汎用ヘルパ
// ---------------------------------------------------------------------------

function mean(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}
function sd(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(nums.reduce((a, b) => a + (b - m) ** 2, 0) / (nums.length - 1));
}
function pctl(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx] ?? 0;
}
const pctStr = (v: number, digits = 2): string => `${(v * 100).toFixed(digits)}%`;
const intStr = (v: number): string => Math.round(v).toLocaleString("en-US");

/** ビート単位の合格判定サマリ（比率リスト → 合格数・分布統計） */
interface PassStat {
  n: number;
  pass: number;
  passRate: number;
  meanRatio: number;
  sdRatio: number;
  minRatio: number;
  maxRatio: number;
  p05: number;
  p95: number;
  fails: { beat: number; ratio: number }[];
}
function passStat(ratios: { beat: number; ratio: number }[]): PassStat {
  const vals = ratios.map((r) => r.ratio);
  const sorted = [...vals].sort((a, b) => a - b);
  const ok = vals.filter((v) => v >= TOL_LO && v <= TOL_HI).length;
  const fails = ratios
    .filter((r) => r.ratio < TOL_LO || r.ratio > TOL_HI)
    .sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1))
    .slice(0, 12)
    .map((r) => ({ beat: r.beat, ratio: Number(r.ratio.toFixed(4)) }));
  return {
    n: vals.length,
    pass: ok,
    passRate: vals.length === 0 ? 0 : ok / vals.length,
    meanRatio: mean(vals),
    sdRatio: sd(vals),
    minRatio: sorted[0] ?? 0,
    maxRatio: sorted[sorted.length - 1] ?? 0,
    p05: pctl(sorted, 0.05),
    p95: pctl(sorted, 0.95),
    fails,
  };
}

/**
 * ポップ表示テキストを「切り捨て下界」として解釈する。
 *   "+38.6K" → { floor: 38600, step: 100 }（真値は [floor, floor+step)）
 *   "+1.2M"  → { floor: 1200000, step: 100000 }
 * 端数なし（"+38600" / "+567"）は step=1（厳密一致で判定）。
 */
function parsePopText(text: string | null | undefined): { floor: number; step: number } | null {
  if (typeof text !== "string") return null;
  const m = /^\+?(\d+)(?:\.(\d+))?([KM])?$/i.exec(text.trim());
  if (m === null) return null;
  const intPart = m[1] ?? "0";
  const frac = m[2] ?? "";
  const unitRaw = m[3];
  const unit = unitRaw === undefined ? 1 : unitRaw.toUpperCase() === "K" ? 1000 : 1000000;
  const value = (Number(`${intPart}${frac}`) * unit) / Math.pow(10, frac.length);
  if (!Number.isFinite(value)) return null;
  const step = frac.length === 0 ? unit : unit / Math.pow(10, frac.length);
  return { floor: Math.round(value), step: Math.round(step) };
}

/** T5 のポップは数値保存（表示桁の切り捨て）。桁数から step を推定する。 */
function popStepFromValue(v: number): number {
  if (v >= 1e8) return 1000000;
  if (v >= 1e7) return 100000;
  if (v >= 1e6) return 10000;
  if (v >= 1e4) return 100;
  return 1;
}

// ---------------------------------------------------------------------------
// サンプル構築（tools/dump_samples_trace.ts / dump_t5_trace.ts と同一の入力・同一の build 手順）
// ---------------------------------------------------------------------------

/** フォト beat_score% の実体（エンジン buildPhotoScorePctPermils と同じ入力から算出） */
interface PhotoTerm {
  lane: number;
  items: { name: string; pct: number }[];
  maxPct: number;
  sumPct: number;
  /** 【Phase 16 Action 2 検証項目】structured で `beat_score` が `type:"fixed"` の項（現行エンジンは未使用） */
  fixedItems: { name: string; value: number }[];
  fixedSum: number;
  fixedMax: number;
}

interface MeasData {
  total: number;
  /** beat → 5レーン合算の増加量 */
  byBeat: Map<number, number>;
  /** beat → lane1..5 のクリティカル（黄色 pop） */
  crit: Map<number, boolean[]>;
  critCells: { beat: number; lane: number }[];
  /** 実測側で A/SP/P/フォト/LB の発動が記録されているビート */
  activationBeats: Set<number>;
  /** beat → 実測発動の内訳（人間可読。Task 4 の「実測のみ発動」詳細列挙用） */
  actDetail: Map<number, string[]>;
  /** "beat:lane" → レーン別スコアポップ（切り捨て下界＋刻み） */
  pops: Map<string, { floor: number; step: number; raw: string }>;
  /** "beat:lane" → 実測のレーン能力値表示（ライブ中のステータス） */
  stats: Map<string, number>;
  /** "beat:lane" → 実測の強化効果表示（名前一緒） */
  effects: Map<string, { name: string; stage: number }[]>;
  laneTotals: Map<number, number>;
}


interface Sample {
  tag: SampleTag;
  label: string;
  built: any;
  resNeutral: TimelineResult;
  /** 実測クリティカル再現・乱数中立（1000）ラン。判定はすべてこのランで行う */
  resReplay: TimelineResult;
  photo: PhotoTerm[];
  meas: MeasData;
  /** プロンプト指定の保存トレース（陈旧性の確認用） */
  stored: { path: string; exists: boolean; totalScore: number | null; note: string };
  /** プロンプトが記録した「乱数中立の実測基準値」（S3 の 72,176,945 など） */
  recordedConfirmed: number | null;
}

/**
 * deck.json の audience（個人来場ファン数）誤入力チェック【Phase 16-A2b・2026-09-29 発覚】
 *
 * サンプル1 の deck.json は audience=71000 だが、qt-area-1-001 の **目標スコア clear=71000**
 * （左上スコア表示「18,780,790/71,000」＝ research/05_data_quality.md の記載）と完全一致する。
 * つまり 71000 は来場ファン数ではなく目標スコアの誤読で、そのままだと fan はテーブル上限
 * 2000‰ に化けて全ビートスコアが約 2 倍 over-produce する
 * （実測ポップから逆算した示唆 fan は 884〜1,049‰ ＝ 全 5 レーン一致）。
 *
 * 補正規則は src/cli/simulate.ts:283-295 と同一: 個人来場ファン数 = floor(会場キャパ cap / 5)。
 * 発動条件は「宣言値がステージの clear と一致」または「テーブル上限 50,000 超過」だけで、
 * 正常な宣言値（S2 13,206 / S3 8,000 など: fan.png 由来の実測値）は一切変更しない。
 */
const audienceNotes = new Map<string, string>();
/** --raw-inputs 指定時は宣言値をそのまま使う（補正前の乖離を再現して証拠として残すためのフラグ） */
let rawInputs = false;
let _fanTable: { audience: number; advantagePermil: number }[] | null = null;
function fanPermil(audience: number): number {
  const table = (_fanTable ??= readJson(path.join(repoRoot, "data", "stages", "audience_advantage.json")));
  let v = 1000;
  for (const r of table) if (r.audience <= audience) v = r.advantagePermil;
  return v;
}
function resolveAudience(tag: string, declared: number | undefined, stageId: string): number | undefined {
  if (declared === undefined || rawInputs) return declared;
  const idx = readJson(path.join(repoRoot, "data", "stages_index.json"));
  const q = (idx.quests as any[]).find((x) => x.id === stageId);
  const cap: number | undefined = idx.configs?.[q?.c]?.cap;
  if (cap === undefined) return declared;
  const derived = Math.max(0, Math.min(50000, Math.floor(cap / 5)));
  const asClear = q?.clear === declared;
  const overVenue = declared > cap;
  if (asClear || overVenue) {
    const why = asClear
      ? `宣言値 ${declared} は ${stageId} の目標スコア clear=${q?.clear} と同一（左上スコア表示の誤読と判定）`
      : `宣言値 ${declared} が会場キャパ cap=${cap} を超過（観客数が会場容量を超える物理的矛盾＝誤入力の疑い）`;
    audienceNotes.set(
      tag,
      `audience 補正: deck.json ${declared} → ${derived}人（fan ${fanPermil(declared)}‰ → ${fanPermil(derived)}‰）。` +
        `${why}。会場キャパ cap=${cap} からの導出（simulate.ts と同一規則）。※ deck.json 自体は実測入力のため未変更`,
    );
    return derived;
  }
  if (declared > derived) {
    audienceNotes.set(
      tag,
      `audience 注意: 宣言値 ${declared}人は会場キャパ cap=${cap} の 1/5 上限 ${derived}人を超過。` +
        `ゲーム側の個人来場数上限（cap/5: S3 は fan.png 実測 8,000 = 40,000/5 と完全一致）と矛盾するため fan.png を再確認してください（本解析では宣言値を採用）`,
    );
  }
  return declared;
}

/**
 * エンジンと同じ equipmentForScore（ch.photos + ch.accessories）から
 * 写/アクセの beat_score%（scoreBonusPct.beat に入る乗数項）を取り出す。
 * スキーマは src/sim/build.ts と同じ `structured: [{stat, type, value}]`
 * （max 側が src/sim/build.ts:679 maxScorePct、sum 側が Model D の仮説）。
 */
function photoBeatTerms(deck: any): PhotoTerm[] {
  return (deck.characters ?? []).map((ch: any, i: number) => {
    const items: { name: string; pct: number }[] = [];
    const fixedItems: { name: string; value: number }[] = [];
    const pool: any[] = [...(ch.photos ?? []), ...(ch.accessories ?? [])];
    for (const it of pool) {
      for (const s of it?.structured ?? []) {
        if (s?.stat !== "beat_score") continue;
        if (s?.type === "pct" && typeof s.value === "number") {
          items.push({ name: String(it?.name ?? "?"), pct: s.value });
        } else if (s?.type === "fixed" && typeof s.value === "number") {
          fixedItems.push({ name: String(it?.name ?? "?"), value: s.value });
        }
      }
    }
    const pcts = items.map((x) => x.pct);
    const fixeds = fixedItems.map((x) => x.value);
    return {
      lane: i + 1,
      items,
      fixedItems,
      fixedSum: fixeds.reduce((a, b) => a + b, 0),
      fixedMax: fixeds.length > 0 ? Math.max(...fixeds) : 0,
      maxPct: pcts.length > 0 ? Math.max(...pcts) : 0,
      sumPct: pcts.reduce((a, b) => a + b, 0),

    };
  });
}

function loadS23Data(): SimSourceData {
  const dataDir = path.join(repoRoot, "data");
  const idx = readJson(path.join(dataDir, "stages_index.json"));
  const allCharts = readJson(path.join(dataDir, "charts_all.json"));
  const mkStage = (qid: string): [string, any] => {
    const q = idx.quests.find((x: any) => x.id === qid);
    const c = idx.configs[q.c];
    return [
      qid,
      {
        beatWeightsPermil: { vocal: c.w[0], dance: c.w[1], visual: c.w[2] },
        skillWeightsPermil: { active: c.aw[0], special: c.aw[1] },
        skillStaminaWeightPermil: c.st ?? 1000,
        laneAttributes: c.a,
      },
    ];
  };
  const mkChart = (cid: string): [string, any] => [
    cid,
    {
      notes: (allCharts[cid] as Array<[number, number]>).map((n: any, i: number) => ({
        beat: i + 1,
        type: n[0],
        position: n[1],
      })),
    },
  ];
  return {
    cards: readJson(path.join(dataDir, "cards.json")).cards,
    cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
    skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
    stages: Object.fromEntries([mkStage("qt-tower-680"), mkStage("qt-ex-tower-005-045")]),
    charts: Object.fromEntries([mkChart("chart-sun-004-001"), mkChart("chart-thrx-004-001")]),
    audienceAdvantage: readJson(path.join(dataDir, "stages/audience_advantage.json")),
    skillsByCard: readJson(path.join(dataDir, "skills_master.json")).byCard,
    skillLevels: readJson(path.join(dataDir, "skills_levels.json")),
    liveBonusesByQuest: readJson(path.join(dataDir, "live_bonuses.json")).byQuest,
    characterAdvantageByQuest: readJson(path.join(dataDir, "character_advantage.json")).byQuest,
  };
}

const goldenPhotoNames = (): string[][] | undefined => {
  try {
    const s = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"));
    return (s.characters as any[]).map((c: any) => (c.photos ?? []).map((p: any) => p.name ?? ""));
  } catch {
    return undefined;
  }
};

/**
 * サンプルデッキ束（deck.json 直下: deck / myPhotos / photoEquip / mentalOverride /
 * missedNotes / disabledSkillIds）を tools/dump_samples_trace.ts と**同一手順**で読む。
 *  - S3 のみ: characters[3].ct_cuts = [{skill:2,value:5}] と uph-lane5-3 の
 *    staminaScaling="more_stamina" を当てる（Phase 13 以降の確定補正。dumpS3 と必須同一）
 */
function loadSampleBundle(sampleNo: "1" | "2" | "3"): {
  deck: any;
  userPhotoSkills: any[] | undefined;
  cfg: any;
} {
  const cfgJson = readJson(path.join(noxRoot, `サンプル${sampleNo}`, "deck.json"));
  if (sampleNo === "3") {
    cfgJson.deck.characters[3].ct_cuts = [{ skill: 2, value: 5 }];
    for (const ph of cfgJson.myPhotos as any[]) {
      if (ph.id === "uph-lane5-3" && ph.skill !== null) ph.skill.staminaScaling = "more_stamina";
    }
  }
  return { ...mergeBundle(cfgJson), cfg: cfgJson };
}

/**
 * deck.json / examples/nested-sample.json 共通の後処理（CLI src/cli/simulate.ts run() と同一手順）:
 *  装着フォト（photoEquip 順）の能力値合成と myPhotos/photoEquip → userPhotoSkills 変換。
 */
function mergeBundle(cfgJson: any): { deck: any; userPhotoSkills: any[] | undefined } {
  const d = cfgJson.deck;
  const myPhotos: MyPhotoDef[] = cfgJson.myPhotos ?? [];
  const photoEquip: string[][] = cfgJson.photoEquip ?? [];
  photoEquip.forEach((ids: string[], i: number) => {
    const ch = d.characters[i];
    if (ch === undefined || !Array.isArray(ch.photos)) return;
    const equipped = ids
      .map((pid: string) => myPhotos.find((x: any) => x?.id === pid))
      .filter((p: any): p is MyPhotoDef => p !== undefined);
    ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
  });
  const userPhotoSkills =
    myPhotos.length > 0
      ? photoEquip.flatMap((ids: string[], i: number) =>
          ids.flatMap((pid: string, j: number) => {
            const p = myPhotos.find((x: any) => x?.id === pid);
            if (p === undefined) return [];
            const def = myPhotoToSkillDef(p, (i + 1) as any, j + 1);
            return def !== null ? [def] : [];
          }),
        )
      : undefined;
  return { deck: d, userPhotoSkills };
}


// ---------------------------------------------------------------------------
// S3（EXタワー STAGE045 / chart-thrx-004-001 / 4BEAT）
// ---------------------------------------------------------------------------

function buildS3(): Sample {
  const sampleDir = path.join(noxRoot, "サンプル3");
  const { deck, userPhotoSkills, cfg } = loadSampleBundle("3");

  const built = buildSimulateInput({
    deck,
    stageFile: "qt-ex-tower-005-045",
    chartFile: "chart-thrx-004-001",
    data: loadS23Data(),
    audience: resolveAudience("S3", 8000, "qt-ex-tower-005-045"), // fan.png 実測値（目標スコアとの一致＝誤読でないことを本関数が検証）
    mentalOverride: cfg.mentalOverride,
    missedNotes: cfg.missedNotes,
    disabledSkillIds: cfg.disabledSkillIds,
    userPhotoSkills,
    goldenPhotoNames: goldenPhotoNames(),
  } as any);

  const m = readJson(path.join(repoRoot, "research/26_data_integrity/measured_data_s3_v3.json"));
  // クリティカル再現は tools/dump_samples_trace.ts.dumpS3 と同じ measured_data_v2.json（critical_flags.beats）
  const critRaw = readJson(path.join(sampleDir, "measured_data_v2.json")).critical_flags;
  const crit = new Map<number, boolean[]>();
  const critCells: { beat: number; lane: number }[] = [];
  for (const row of critRaw.beats as Array<{ beat: number; lanes: boolean[] }>) {
    const arr = row.lanes ?? [false, false, false, false, false];
    crit.set(row.beat, arr);
    arr.forEach((c: boolean, l: number) => {
      if (c) critCells.push({ beat: row.beat, lane: l + 1 });
    });
  }
  const resNeutral = simulateTimeline({ ...built.base, rng: new NeutralRng(), criticalProvider: () => false });
  const resReplay = simulateTimeline({
    ...built.base,
    rng: new NeutralRng(),
    criticalProvider: (beat: number, lane: number) => crit.get(beat)?.[lane - 1] === true,
  });

  const byBeat = new Map<number, number>();
  const pops = new Map<string, { floor: number; step: number; raw: string }>();
  const stats = new Map<string, number>();
  const effects = new Map<string, { name: string; stage: number }[]>();
  const actDetail = new Map<number, string[]>();
  const activationBeats = new Set<number>();
  const sum = (m.skill_activations_summary ?? []) as any[];
  for (const row of m.timeline as any[]) {
    byBeat.set(row.beat, row.beat_gained_score ?? 0);
    for (const idx of row.skill_activations ?? []) {
      const a = sum[idx];
      if (a !== undefined && a !== null) {
        activationBeats.add(row.beat);
        if (!actDetail.has(row.beat)) actDetail.set(row.beat, []);
        actDetail.get(row.beat)!.push(`L${a.lane ?? "-"} ${a.type ?? "?"} ${a.skill_name ?? "?"}`);
      }
    }
    for (let lane = 1; lane <= 5; lane++) {
      const pop = row.lanes?.[String(lane)]?.gained_score_pop;
      const pr = parsePopText(pop?.text);
      if (pr !== null) pops.set(`${row.beat}:${lane}`, { ...pr, raw: String(pop.text) });
      const cell = row.lanes?.[String(lane)];
      if (typeof cell?.stat_value === "number") stats.set(`${row.beat}:${lane}`, cell.stat_value);
      if (Array.isArray(cell?.effects) && cell.effects.length > 0) {
        effects.set(
          `${row.beat}:${lane}`,
          cell.effects.map((e: any) => ({ name: String(e.name), stage: Number(e.stage ?? 0) })),
        );
      }
    }
  }

  return {
    tag: "S3",
    label: "S3（EXタワーSTAGE045・4BEAT・char優位2250‰）",
    built,
    resNeutral,
    resReplay,
    photo: photoBeatTerms(deck),
    meas: {
      total: Number(m.results.total_score),
      byBeat,
      crit,
      critCells,
      activationBeats,
      actDetail,
      pops,
      stats,
      effects,
      laneTotals: new Map(
        Object.entries(m.results.scores_by_lane ?? {}).map((e: any) => [Number(e[0]), Number(e[1])]),
      ),
    },
    stored: {
      path: "research/21_sample3_gap_analysis/sim_trace_full.json",
      exists: existsSync(path.join(repoRoot, "research/21_sample3_gap_analysis/sim_trace_full.json")),
      totalScore:
        readJson(path.join(repoRoot, "research/21_sample3_gap_analysis/sim_trace_full.json"))?.meta
          ?.replayTotalScore ?? null,
      note: "research/24_result_vs_pop_sum/s3_full_trace.json に neutral/replay 合計値の記録あり",
    },
    recordedConfirmed: 72176945,
  };
}


// ---------------------------------------------------------------------------
// S1（サンプル1 / Area 1 Normal「Shine Purity〜輝きの純度〜」/ chart-hsm-006-001・177ビート）
//   入力経路は tools/audit_s1_b136_step11.ts（2026-09 の S1 監査）と同一。
//   ※ stage.live_bonus_check = "not_captured"（ライブボーナス未確認）→ ライボなしで計算する。
//     実測（116,537,513）はライボ入りの可能性があり、その場合 sim は実測より低く出る。
// ---------------------------------------------------------------------------

function loadS1Data(): SimSourceData {
  const dataDir = path.join(repoRoot, "data");
  const idx = readJson(path.join(dataDir, "stages_index.json"));
  const q = idx.quests.find((x: any) => x.id === "qt-area-1-001");
  const c = idx.configs[q.c];
  const allCharts = readJson(path.join(dataDir, "charts_all.json"));
  return {
    cards: readJson(path.join(dataDir, "cards.json")).cards,
    cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
    skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
    stages: {
      "qt-area-1-001": {
        beatWeightsPermil: { vocal: c.w[0], dance: c.w[1], visual: c.w[2] },
        skillWeightsPermil: { active: c.aw[0], special: c.aw[1] },
        skillStaminaWeightPermil: c.st ?? 1000,
        laneAttributes: c.a,
      },
    },
    charts: {
      "chart-hsm-006-001": {
        notes: (allCharts["chart-hsm-006-001"] as Array<[number, number]>).map((n: any, i: number) => ({
          beat: i + 1,
          type: n[0],
          position: n[1],
        })),
      },
    },
    audienceAdvantage: readJson(path.join(dataDir, "stages/audience_advantage.json")),
    skillsByCard: readJson(path.join(dataDir, "skills_master.json")).byCard,
    skillLevels: readJson(path.join(dataDir, "skills_levels.json")),
    liveBonusesByQuest: readJson(path.join(dataDir, "live_bonuses.json")).byQuest,
    characterAdvantageByQuest: readJson(path.join(dataDir, "character_advantage.json")).byQuest,
  } as any;
}

function buildS1(): Sample {
  const { deck, userPhotoSkills, cfg } = loadSampleBundle("1");
  const built = buildSimulateInput({
    deck,
    stageFile: "qt-area-1-001",
    chartFile: "chart-hsm-006-001",
    data: loadS1Data(),
    audience: resolveAudience("S1", cfg.audience, "qt-area-1-001"), // deck.json 値 71000 は目標スコア誤読の可能性→検証して補正
    mentalOverride: cfg.mentalOverride,
    missedNotes: cfg.missedNotes,
    disabledSkillIds: cfg.disabledSkillIds,
    userPhotoSkills,
    goldenPhotoNames: goldenPhotoNames(),
  } as any);

  const m = readJson(path.join(noxRoot, "サンプル1/measured_data_v2.json"));
  // crit: v2 の beats[beat]["1".."5"] === "critical"
  const crit = new Map<number, boolean[]>();
  const critCells: { beat: number; lane: number }[] = [];
  for (const [bStr, flags] of Object.entries((m.critical_flags?.beats ?? {}) as Record<string, any>)) {
    const arr = [1, 2, 3, 4, 5].map((l) => flags?.[String(l)] === "critical");
    crit.set(Number(bStr), arr);
    arr.forEach((c: boolean, l: number) => {
      if (c) critCells.push({ beat: Number(bStr), lane: l + 1 });
    });
  }
  const resNeutral = simulateTimeline({ ...built.base, rng: new NeutralRng(), criticalProvider: () => false });
  const resReplay = simulateTimeline({
    ...built.base,
    rng: new NeutralRng(),
    criticalProvider: (beat: number, lane: number) => crit.get(beat)?.[lane - 1] === true,
  });

  const byBeat = new Map<number, number>();
  const stats = new Map<string, number>();
  const effects = new Map<string, { name: string; stage: number }[]>();
  const actDetail = new Map<number, string[]>();
  const activationBeats = new Set<number>();
  const sum = (m.skill_activations_summary ?? []) as any[];
  for (const row of m.timeline as any[]) {
    byBeat.set(row.beat, row.beat_gained_score ?? 0);
    for (const idx of row.skill_activations ?? []) {
      const a = sum[idx];
      if (a !== undefined && a !== null) {
        activationBeats.add(row.beat);
        if (!actDetail.has(row.beat)) actDetail.set(row.beat, []);
        actDetail.get(row.beat)!.push(`L${a.lane ?? "-"} ${a.type ?? "?"} ${a.skill_name ?? "?"}`);
      }
    }
    for (let lane = 1; lane <= 5; lane++) {
      const cell = row.lanes?.[String(lane)];
      if (cell === undefined || cell === null) continue;
      if (typeof cell.stat_value === "number") stats.set(`${row.beat}:${lane}`, cell.stat_value);
      if (Array.isArray(cell.effects) && cell.effects.length > 0) {
        effects.set(
          `${row.beat}:${lane}`,
          cell.effects.map((e: any) => ({ name: String(e.name), stage: Number(e.stage ?? 0) })),
        );
      }
    }
  }
  // レーン別ポップは backfill 実測（"+123.3K" 等）
  const pops = new Map<string, { floor: number; step: number; raw: string }>();
  const popsPath = path.join(noxRoot, "サンプル1/lane_pops_backfill.json");
  if (existsSync(popsPath)) {
    for (const r of readJson(popsPath).pops as any[]) {
      const pr = parsePopText(r?.displayed);
      if (pr !== null) pops.set(`${r.beat}:${r.lane}`, { ...pr, raw: String(r.displayed) });
    }
  }
  return {
    tag: "S1",
    label: "S1（Area1 Normal・177ビート・ライボ未確認）",
    built,
    resNeutral,
    resReplay,
    photo: photoBeatTerms(deck),
    meas: {
      total: Number(m.results?.total_score ?? 0),
      byBeat,
      crit,
      critCells,
      activationBeats,
      actDetail,
      pops,
      stats,
      effects,
      laneTotals: new Map(
        Object.entries(m.results?.scores_by_lane ?? {}).map((e: any) => [Number(e[0]), Number(e[1])]),
      ),
    },
    stored: {
      path: "research/26_data_integrity/phase14f_s1_divergence_audit.json",
      exists: existsSync(path.join(repoRoot, "research/26_data_integrity/phase14f_s1_divergence_audit.json")),
      totalScore: null,
      note: "S1 は tools/audit_s1_b136_step11.ts が同一入力で個別監査している",
    },
    recordedConfirmed: null,
  };
}

// ---------------------------------------------------------------------------
// T5（デイリー 3-19 / chart-hsm-004-001 / 156ビート・割合型スコアあり）
// ---------------------------------------------------------------------------

interface ScoreRngLike {
  nextScoreRoll(): number;
  nextCritical(): boolean;
  nextFloat(): number;
}
/** 保存済み乱数列をそのまま使う RNG（T5 ゴールデン再現の確認専用・判定には不使用） */
class ArrayRng implements ScoreRngLike {
  private i = 0;
  constructor(private readonly rolls: number[]) {}
  nextScoreRoll(): number {
    const r = this.rolls[this.i];
    if (r === undefined) throw new Error("ArrayRng exhausted");
    this.i++;
    return r;
  }
  nextCritical(): boolean {
    return false;
  }
  nextFloat(): number {
    return 0;
  }
}

const T5_MENTAL: Record<string, number> = { 1: 8996, 2: 5880, 3: 8074, 4: 5890, 5: 5880 };

function buildT5(): Sample {
  const dataDir = path.join(repoRoot, "data");
  const data = {
    cards: readJson(path.join(dataDir, "cards.json")).cards,
    cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
    skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
    stages: { "qt-daily-003-19": readJson(path.join(dataDir, "stages/qt-daily-003-19.json")) },
    charts: { "chart-hsm-004-001": readJson(path.join(dataDir, "charts/chart-hsm-004-001.json")) },
  } as any;
  const deck = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"));
  const built = buildSimulateInput({
    deck,
    stageFile: "qt-daily-003-19",
    chartFile: "chart-hsm-004-001",
    data,
    missedNotes: [1, 2, 3, 4, 5].map((lane) => ({ beat: 1, lane })),
    mentalOverride: T5_MENTAL,
  } as any);
  built.base.fanBaseCount = 16000; // dump_t5_trace.ts と同一（T5 の観客数は 16000 固定）

  const t5 = readJson(path.join(repoRoot, "tests/golden/fixtures/t5_measured.json"));
  const crit = new Map<number, boolean[]>();
  const critCells: { beat: number; lane: number }[] = [];
  for (const f of t5.critFlags as any[]) {
    const arr = [1, 2, 3, 4, 5].map((l) => (f.yellow_lanes ?? []).map(String).includes(String(l)));
    crit.set(f.beat, arr);
    arr.forEach((c: boolean, l: number) => {
      if (c) critCells.push({ beat: f.beat, lane: l + 1 });
    });
  }
  const critFn = (beat: number, lane: number): boolean => crit.get(beat)?.[lane - 1] === true;
  const resNeutral = simulateTimeline({ ...built.base, rng: new NeutralRng(), criticalProvider: () => false });
  const resReplay = simulateTimeline({ ...built.base, rng: new NeutralRng(), criticalProvider: critFn });
  const goldenPath = path.join(repoRoot, "tests/golden/fixtures/t5_replay_rands.json");
  let goldenTotal: number | null = null;
  if (existsSync(goldenPath)) {
    const raw = readJson(goldenPath);
    goldenTotal = simulateTimeline({
      ...built.base,
      rng: new ArrayRng(Array.isArray(raw) ? raw : (raw.rands ?? [])),
      criticalProvider: critFn,
    } as any).totalScore;
  }

  const byBeat = new Map<number, number>();
  const pops = new Map<string, { floor: number; step: number; raw: string }>();
  const activationBeats = new Set<number>();
  for (const row of t5.timeline as any[]) {
    byBeat.set(row.beat, row.gained ?? 0);
    for (let lane = 1; lane <= 5; lane++) {
      const v = row.pops?.[String(lane)];
      if (typeof v === "number" && v > 0) {
        const step = popStepFromValue(v);
        pops.set(`${row.beat}:${lane}`, { floor: Math.floor(v / step) * step, step, raw: String(v) });
      }
    }
  }
  for (const a of (t5.activations ?? []) as any[]) {
    if (a?.lane !== undefined && a?.lane !== null) activationBeats.add(a.beat);
  }

  return {
    tag: "T5",
    label: `T5（デイリー3-19・golden再現 ${goldenTotal === null ? "n/a" : intStr(goldenTotal)}）`,
    built,
    resNeutral,
    resReplay,
    photo: photoBeatTerms(deck),
    meas: {
      total: Number(t5.results.total_score),
      byBeat,
      crit,
      critCells,
      activationBeats,
      actDetail: new Map(),
      pops,
      stats: new Map(),
      effects: new Map(),
      laneTotals: new Map(
        Object.entries(t5.results.scores_by_lane ?? {}).map((e: any) => [Number(e[0]), Number(e[1])]),
      ),
    },
    stored: {
      path: "research/25_buff_audit/t5_sim_trace_full.json",
      exists: existsSync(path.join(repoRoot, "research/25_buff_audit/t5_sim_trace_full.json")),
      totalScore: goldenTotal,
      note: "t5_replay_rands.json の乱数列で現行エンジンにより再計算した値（research/25 の保存トレースは Phase 12 由来）",
    },
    recordedConfirmed: null,
  };
}



// ---------------------------------------------------------------------------
// S2（タワー680 / chart-sun-004-001）— 補助サンプル
// ---------------------------------------------------------------------------

function buildS2(): Sample {
  const sampleDir = path.join(noxRoot, "サンプル2");
  const { deck, userPhotoSkills, cfg } = loadSampleBundle("2");
  const built = buildSimulateInput({
    deck,
    stageFile: "qt-tower-680",
    chartFile: "chart-sun-004-001",
    data: loadS23Data(),
    audience: resolveAudience("S2", 13206, "qt-tower-680"), // fan.png 実測値（誤読指紋に該当しない＝正当な値を同関数が検証）
    disabledSkillIds: cfg.disabledSkillIds,
    userPhotoSkills,
    goldenPhotoNames: goldenPhotoNames(),
  } as any);

  const m = readJson(path.join(repoRoot, "research/26_data_integrity/measured_data_s2_v3.json"));
  const critFlags = readJson(path.join(noxRoot, "サンプル2/measured_data_v2.json")).critical_flags;
  const crit = new Map<number, boolean[]>();
  const critCells: { beat: number; lane: number }[] = [];
  const lastBeat = Math.max(...(m.timeline as any[]).map((r: any) => r.beat));
  for (let b = 0; b <= lastBeat; b++) {
    const arr = [1, 2, 3, 4, 5].map((l) => critFlags[`b${String(b).padStart(3, "0")}_L${l}`] === true);
    crit.set(b, arr);
    arr.forEach((c: boolean, l: number) => {
      if (c) critCells.push({ beat: b, lane: l + 1 });
    });
  }
  const resNeutral = simulateTimeline({ ...built.base, rng: new NeutralRng(), criticalProvider: () => false });
  const resReplay = simulateTimeline({
    ...built.base,
    rng: new NeutralRng(),
    criticalProvider: (beat: number, lane: number) => crit.get(beat)?.[lane - 1] === true,
  });

  const byBeat = new Map<number, number>();
  const stats = new Map<string, number>();
  const effects = new Map<string, { name: string; stage: number }[]>();
  const actDetail = new Map<number, string[]>();
  const activationBeats = new Set<number>();
  const sumS2 = (m.skill_activations_summary ?? []) as any[];
  for (const row of m.timeline as any[]) {
    byBeat.set(row.beat, row.beat_gained_score ?? 0);
    if ((row.skill_activations ?? []).length > 0) activationBeats.add(row.beat);
    for (const idxOrObj of row.skill_activations ?? []) {
      const a = typeof idxOrObj === "number" ? sumS2[idxOrObj] : idxOrObj;
      if (a === undefined || a === null) continue;
      if (!actDetail.has(row.beat)) actDetail.set(row.beat, []);
      actDetail
        .get(row.beat)!
        .push(`L${a.lane ?? "-"} ${a.skill_type ?? a.type ?? "?"} ${a.skill_name ?? "?"}`);
    }
    for (let lane = 1; lane <= 5; lane++) {
      const cell = row.lanes?.[String(lane)] ?? row.lanes?.[`lane${lane}`];
      if (typeof cell?.stat_value === "number") stats.set(`${row.beat}:${lane}`, cell.stat_value);
      if (Array.isArray(cell?.effects) && cell.effects.length > 0) {
        effects.set(
          `${row.beat}:${lane}`,
          cell.effects.map((e: any) => ({ name: String(e.name), stage: Number(e.stage ?? 0) })),
        );
      }
    }
  }
  // レーン別ポップは backfill 実測（displayed: "+123.3K" 等）
  const pops = new Map<string, { floor: number; step: number; raw: string }>();
  const popsPath = path.join(noxRoot, "サンプル2/lane_pops_backfill.json");
  if (existsSync(popsPath)) {
    for (const r of readJson(popsPath).pops as any[]) {
      const pr = parsePopText(r?.displayed);
      if (pr !== null) pops.set(`${r.beat}:${r.lane}`, { ...pr, raw: String(r.displayed) });
    }
  }
  return {
    tag: "S2",
    label: "S2（タワー680・3BEAT）",
    built,
    resNeutral,
    resReplay,
    photo: photoBeatTerms(deck),
    meas: {
      total: Number(m.results?.total_score ?? 0),
      byBeat,
      crit,
      critCells,
      activationBeats,
      actDetail,
      pops,
      stats,
      effects,
      laneTotals: new Map(
        Object.entries(m.results?.scores_by_lane ?? {}).map((e: any) => [Number(e[0]), Number(e[1])]),
      ),
    },
    stored: {
      path: "research/20_sample2_gap_analysis/sim_trace_full.json",
      exists: existsSync(path.join(repoRoot, "research/20_sample2_gap_analysis/sim_trace_full.json")),
      totalScore: null,
      note: "research/26_data_integrity/samples_trace_summary.json にフェーズ別合計値",
    },
    recordedConfirmed: null,
  };
}

// ---------------------------------------------------------------------------
// モデル再計算（トレースのファクターから 4 モデル値を厳密に作り直す）
// ---------------------------------------------------------------------------

interface LaneCtx {
  lane: number;
  deck: { vocal: number; dance: number; visual: number };
  attribute: "vocal" | "dance" | "visual";
  /** キャラ優位 permil（S3 の ⅢX メンバーは 2250） */
  adv: number;
  /** フォト beat_score% の sum − max（permil）。sum モデルでは B1 にこの差分を足す */
  photoDeltaPermil: number;
}

interface ModelSet {
  A: number;
  B: number;
  C: number;
  D: number;
}
const zeroModels = (): ModelSet => ({ A: 0, B: 0, C: 0, D: 0 });
/** Record<ModelKey, T> を全キー初期化で作る（noUncheckedIndexedAccess 対策） */
function modelRecord<T>(make: () => T): Record<ModelKey, T> {
  return { A: make(), B: make(), C: make(), D: make() };
}
const EMPTY_PASS: PassStat = {
  n: 0,
  pass: 0,
  passRate: 0,
  meanRatio: 0,
  sdRatio: 0,
  minRatio: 0,
  maxRatio: 0,
  p05: 0,
  p95: 0,
  fails: [],
};
const EMPTY_POP: PopCellStat = { n: 0, inInterval: 0, within5: 0, meanRatio: 0, perLaneMeanRatio: {} };
const EMPTY_WHITE = { whiteGap: 0, residualGap: 0, residualGapPct: 0 };

interface BeatAgg {
  /** 通常ビート（sourceKind="beat"）のモデル別 5レーン合算 */
  beat: ModelSet;
  /** A/SP/P/フォト/LB など通常ビート以外の合算（モデル非依存＝全モデル同値） */
  other: ModelSet;
  /** 全スコア合算（beat + other） */
  total: ModelSet;
  /** レーン別の通常ビート値（モデル別） */
  laneBeat: Map<number, ModelSet>;
  /** sim 側で成功発動があったスキルの kind */
  simActivationKinds: string[];
  /** エンジン再計算と gainedScore が一致しなかったセル数 */
  mismatchCells: number;
}

/** 1セル（ビート×レーンの通常ビート）の再計算に必要なトレース情報 */
interface CellTrace {
  ev: LaneScoreEventTrace;
  snap: BuffSnapshotLike | undefined;
  /** 重み総和（Σ_attr floor(floor(deck×ライブ倍率/1000)×重み/1000)）。Phase 16-A2 の要検証量 */
  basicSum: number;
  /** モデル別の再計算スコア（セルフチェック通過済み） */
  vals: ModelSet;
}

interface Recompute {
  perBeat: Map<number, BeatAgg>;
  mismatches: { beat: number; lane: number; expect: number; got: number; why: string }[];
  beatEvents: number;
  otherEvents: number;
  /** buffSnapshot が無く再計算できなかったセル数（トレース値を流用） */
  unverifiedCells: number;
  /** "beat:lane" → 再計算セルのトレース（レーン別ファクター分解用） */
  cellAt: Map<string, CellTrace>;
}

type BuffSnapshotLike = Parameters<typeof liveStatusMultiplierPermil>[0];

/** engine settleBeatNote の basicSum 再現（Σ_attr floor(floor(deck×ライブ倍率/1000)×重み/1000)） */
function basicSumOf(
  lc: LaneCtx,
  snap: BuffSnapshotLike,
  w: { vocal: number; dance: number; visual: number },
): number {
  const one = (stat: number, mult: number, weight: number): number =>
    mulPermil(mulPermil(stat, mult), weight);
  return (
    one(lc.deck.vocal, liveStatusMultiplierPermil(snap, "vocal"), w.vocal) +
    one(lc.deck.dance, liveStatusMultiplierPermil(snap, "dance"), w.dance) +
    one(lc.deck.visual, liveStatusMultiplierPermil(snap, "visual"), w.visual)
  );
}

function laneContexts(s: Sample): LaneCtx[] {
  return (s.built.base.lanes as any[]).map((li: any, i: number) => {
    const pt = s.photo.find((p) => p.lane === i + 1);
    return {
      lane: i + 1,
      deck: li.deck,
      attribute: li.attribute,
      adv: Number(li.characterAdvantagePermil ?? 1000),
      photoDeltaPermil: pt === undefined ? 0 : pctToPermil(pt.sumPct) - pctToPermil(pt.maxPct),
    };
  });
}

/**
 * トレースから 4 モデルのスコアを再計算する。
 * 現行モデル（A）がエンジンの gainedScore と 1 セルも例外なく一致することをここで検証する。
 */
function recomputeModels(s: Sample, res: TimelineResult): Recompute {
  const laneCtx = laneContexts(s);
  const stage = s.built.base.stage as any;
  const w = stage.beatWeightsPermil as { vocal: number; dance: number; visual: number };
  const stageF = Number(stage.stageFactorPermil ?? 1000);
  const policy = (s.built.base.roundingPolicy ?? "sequential") as "sequential" | "at-end";

  const perBeat = new Map<number, BeatAgg>();
  const cellAt = new Map<string, CellTrace>();
  const mismatches: Recompute["mismatches"] = [];
  let beatEvents = 0;
  let otherEvents = 0;
  let unverifiedCells = 0;

  for (const bt of res.beats) {
    const agg: BeatAgg = {
      beat: zeroModels(),
      other: zeroModels(),
      total: zeroModels(),
      laneBeat: new Map(),
      simActivationKinds: bt.activations.filter((a) => a.success).map((a) => String(a.kind)),
      mismatchCells: 0,
    };
    for (const ev of bt.events) {
      const lc = laneCtx[ev.lane - 1];
      if (lc === undefined) throw new Error(`lane ctx missing: ${ev.lane}`);
      if (ev.sourceKind !== "beat") {
        otherEvents++;
        for (const m of MODELS) {
          agg.other[m.key] += ev.gainedScore;
          agg.total[m.key] += ev.gainedScore;
        }
        continue;
      }
      beatEvents++;
      const snap = bt.buffSnapshots[ev.lane - 1] as BuffSnapshotLike | undefined;
      let ok = true;
      const beatVals: ModelSet = zeroModels();
      if (snap === undefined) {
        unverifiedCells++;
        ok = false;
        beatVals.A = ev.gainedScore;
        beatVals.B = ev.gainedScore;
        beatVals.C = ev.gainedScore;
        beatVals.D = ev.gainedScore;
      } else {
        const basicSum = basicSumOf(lc, snap, w);
        const basicA = Math.floor((basicSum * LAM_CURRENT.num) / LAM_CURRENT.den);
        if (basicA !== ev.basicScore) {
          ok = false;
          mismatches.push({
            beat: bt.beat,
            lane: ev.lane,
            expect: ev.basicScore,
            got: basicA,
            why: "basicSum 再現不一致",
          });
        }
        for (const m of MODELS) {
          const basic = Math.floor((basicSum * m.lam.num) / m.lam.den);
          const b1 = m.photo === "max" ? ev.b1Permil : ev.b1Permil + lc.photoDeltaPermil;
          const raw = computeEventScore({
            basicScore: basic,
            skillPowerPermil: ev.skillPowerPermil,
            b1Permil: b1,
            comboFactorPermil: ev.comboFactorPermil,
            fanFactorPermil: ev.fanFactorPermil,
            stageFactorPermil: stageF,
            randPermil: ev.randPermil,
            critFactorPermil: ev.critFactorPermil,
            roundingPolicy: policy,
          });
          const val = mulPermil(raw, lc.adv);
          beatVals[m.key] = val;
          if (m.key === "A" && val !== ev.gainedScore) {
            ok = false;
            mismatches.push({
              beat: bt.beat,
              lane: ev.lane,
              expect: ev.gainedScore,
              got: val,
              why: "モデルA 再計算不一致",
            });
          }
        }
      }
      if (!ok) agg.mismatchCells++;
      cellAt.set(`${bt.beat}:${ev.lane}`, {
        ev,
        snap,
        basicSum: snap === undefined ? 0 : basicSumOf(lc, snap, w),
        vals: beatVals,
      });
      const lb = agg.laneBeat.get(ev.lane) ?? zeroModels();
      for (const m of MODELS) {
        agg.beat[m.key] += beatVals[m.key];
        agg.total[m.key] += beatVals[m.key];
        lb[m.key] += beatVals[m.key];
      }
      agg.laneBeat.set(ev.lane, lb);
    }
    perBeat.set(bt.beat, agg);
  }
  return { perBeat, cellAt, mismatches, beatEvents, otherEvents, unverifiedCells };
}



// ---------------------------------------------------------------------------
// Phase 16 アクション2: レーン別ファクター分解（不足分がどの項にいるかを特定する）
// ---------------------------------------------------------------------------
/**
 * 純白ビート（クリティカル無し・スキル発動無し）でレーン別スコアポップが読めたセルだけを使い、
 * 実測中値 / sim(rand=1000) のズレを **各ファクター単独で埋めるといくらになるか** に分解する。
 *
 *   ratio  = mid / simA                 … 系統ズレ（1.000 なら一致）
 *   Δbasic = basic × (ratio−1)          … 重み総和 λ の内側（ステータス側＝フォト fixed と同じ単位系）
 *   Δb1    = b1 × (ratio−1)             … 総合スコア係数 B1 側（%系: beat_score_pct・ビートスコア上昇）
 *   Δfan   = fan × (ratio−1)            … ファン（観客数）側
 *
 * 判定の型: ズレが **レーン間で絶対値（Δbasic）が一定** なら加算flat（フォト fixed 型）、
 *          **比率が一定** なら乗算項（%系: B1 の beat_score_pct・ビートスコア上昇・ライボ等）。
 */
interface LaneFactorDiag {
  lane: number;
  n: number;
  attribute: string;
  ratioMean: number;
  ratioMin: number;
  ratioMax: number;
  basicMean: number;
  basicSumMean: number;
  b1Mean: number;
  comboMean: number;
  fanMean: number;
  stage: number;
  adv: number;
  photoFixedSum: number;
  photoFixedMax: number;
  photoPctMax: number;
  photoPctSum: number;
  /** ライブ中の実測能力値表示と sim のライブ中能力値（レーン属性） */
  measStatMean: number;
  simStatMean: number;
  statRatioMean: number;
  statMatch: number;
  /** 実測効果と sim スナップショットの段数が一致したセル数／不一致セル数（内訳トップ5） */
  effectMatchCells: number;
  effectDiffCells: number;
  effectDiffTop: string[];
  dBasicMean: number;
  dBasicSd: number;
  dB1Mean: number;
  dFanMean: number;
  dComboMean: number;
  dAdvMean: number;
  /** フォト beat_score% を sum にしたモデルDでの平均比率 */
  ratioMeanPhotoSum: number;
  /** 仮説E: A + フォト fixedSum（ビートスコアに flat 加算）での平均比率 */
  ratioMeanFixedA: number;
  /** 仮説F: D + フォト fixedSum での平均比率 */
  ratioMeanFixedD: number;
  /** 仮説G: 実測 = simA + fixedSum + pct差 相当（D+fixed）のセル内バラつき */
  ratioSdFixedD: number;
  /** 仮説B1: A + fixed を basic に加算した平均比率 */
  ratioMeanFixedABasic: number;
  /** 仮説B2: D + fixed を basic に加算した平均比率 */
  ratioMeanFixedDBasic: number;
  /** 仮説B2 のセル内バラつき */
  ratioSdFixedDBasic: number;
  /** 不足が fan（観客優位）単独で説明できると仮定した時の示唆 fan 値 */
  impliedFanMean: number;
  /** 同上で adv（キャラ優位）単独と仮定した時の示唆 adv 値 */
  impliedAdvMean: number;
}

/** laneFactorDiagnostics の 1セル分（内部用） */
interface CellDiagSample {
  beat: number;
  lane: number;
  ratio: number;
  ratioD: number;
  simA: number;
  simD: number;
  /** 実測ポップ中値 */
  mid: number;
  /** 仮説B1: A + フォト fixed を basic に加算 */
  simAfixBasic: number;
  /** 仮説B2: D + フォト fixed を basic に加算 */
  simDfixBasic: number;
  basic: number;
  basicSum: number;
  b1: number;
  combo: number;
  fan: number;
  crit: number;
  adv: number;
  measStat: number | undefined;
  simStat: number;
  simEffects: Record<string, number>;
  measEffects: { name: string; stage: number }[];
  photoFixedSum: number;
  photoPctMax: number;
  photoPctSum: number;
}

function popCoverage(s: Sample, rc: Recompute): { nBeats: number; ratio: number } {
  const whiteBeats = new Set(
    classifyBeats(s, rc)
      .filter((r) => r.group === "white" || r.group === "white_crit")
      .map((r) => r.beat),
  );
  const agg = new Map<number, { sum: number; n: number }>();
  for (const [key, pop] of s.meas.pops) {
    const beat = Number(key.split(":")[0]);
    if (!whiteBeats.has(beat)) continue;
    const rec = agg.get(beat) ?? { sum: 0, n: 0 };
    rec.sum += pop.floor + pop.step / 2;
    rec.n += 1;
    agg.set(beat, rec);
  }
  let sumPop = 0;
  let sumBar = 0;
  let n = 0;
  for (const [beat, rec] of [...agg.entries()].sort((a, b) => a[0] - b[0])) {
    const gain = s.meas.byBeat.get(beat);
    if (gain === undefined || gain <= 0 || rec.n < 4) continue;
    sumPop += rec.sum;
    sumBar += gain;
    n += 1;
  }
  return { nBeats: n, ratio: sumBar > 0 ? sumPop / sumBar : 0 };
}

function laneFactorDiagnostics(s: Sample, rc: Recompute): LaneFactorDiag[] {
  const laneCtx = laneContexts(s);
  const stage = s.built.base.stage as any;
  const stageF = Number(stage.stageFactorPermil ?? 1000);
  const policy = (s.built.base.roundingPolicy ?? "sequential") as "sequential" | "at-end";
  const valOf = (ct: CellTrace, lc: LaneCtx, basic: number, b1: number): number =>
    mulPermil(
      computeEventScore({
        basicScore: basic,
        skillPowerPermil: ct.ev.skillPowerPermil,
        b1Permil: b1,
        comboFactorPermil: ct.ev.comboFactorPermil,
        fanFactorPermil: ct.ev.fanFactorPermil,
        stageFactorPermil: stageF,
        randPermil: ct.ev.randPermil,
        critFactorPermil: ct.ev.critFactorPermil,
        roundingPolicy: policy,
      }),
      lc.adv,
    );
  const whiteBeats = new Set(
    classifyBeats(s, rc)
      .filter((r) => r.group === "white" || r.group === "white_crit")
      .map((r) => r.beat),
  );
  const byLane = new Map<number, CellDiagSample[]>();
  for (const [key, pop] of s.meas.pops) {
    const parts = key.split(":");
    const beat = Number(parts[0]);
    const lane = Number(parts[1]);
    if (!whiteBeats.has(beat)) continue;
    if (s.meas.crit.get(beat)?.[lane - 1] === true) continue;
    const ct = rc.cellAt.get(key);
    if (ct === undefined || ct.snap === undefined) continue;
    const lc = laneCtx[lane - 1];
    if (lc === undefined) continue;
    const simA = ct.vals.A;
    if (simA <= 0) continue;
    const mid = pop.floor + pop.step / 2;
    const pt = s.photo.find((p) => p.lane === lane);
    const fixedSum = pt?.fixedSum ?? 0;
    const mult = liveStatusMultiplierPermil(ct.snap, lc.attribute as any);
    const simStat = mulPermil(lc.deck[lc.attribute as "vocal" | "dance" | "visual"], mult);
    const basicA = Math.floor((ct.basicSum * LAM_CURRENT.num) / LAM_CURRENT.den);
    const bucket = byLane.get(lane) ?? [];
    bucket.push({
      beat,
      lane,
      ratio: mid / simA,
      ratioD: ct.vals.D > 0 ? mid / ct.vals.D : 0,
      simA,
      simD: ct.vals.D,
      mid,
      /** 仮説B1: フォト fixed を basic（λ適用後）に足す */
      simAfixBasic: valOf(ct, lc, basicA + fixedSum, ct.ev.b1Permil),
      simDfixBasic: valOf(
        ct,
        lc,
        basicA + fixedSum,
        ct.ev.b1Permil + lc.photoDeltaPermil,
      ),
      basic: basicA,
      basicSum: ct.basicSum,
      b1: ct.ev.b1Permil,
      combo: ct.ev.comboFactorPermil,
      fan: ct.ev.fanFactorPermil,
      crit: ct.ev.critFactorPermil,
      adv: lc.adv,
      measStat: s.meas.stats.get(key),
      simStat,
      simEffects: ct.snap as unknown as Record<string, number>,
      measEffects: s.meas.effects.get(key) ?? [],
      photoFixedSum: pt?.fixedSum ?? 0,
      photoPctMax: pt?.maxPct ?? 0,
      photoPctSum: pt?.sumPct ?? 0,
    });
    byLane.set(lane, bucket);
  }
  const out: LaneFactorDiag[] = [];
  for (const lane of [...byLane.keys()].sort((a, b) => a - b)) {
    const cells = byLane.get(lane) ?? [];
    if (cells.length === 0) continue;
    const lc = laneCtx[lane - 1] as LaneCtx;
    const pt = s.photo.find((p) => p.lane === lane);
    const ratios = cells.map((c) => c.ratio);
    const dBasic = cells.map((c) => c.basic * (c.ratio - 1));
    const statPairs = cells.filter((c) => typeof c.measStat === "number");
    let statMatch = 0;
    for (const c of statPairs) if (c.measStat === c.simStat) statMatch++;
    let effectMatchCells = 0;
    let effectDiffCells = 0;
    const diffTally = new Map<string, number>();
    for (const c of cells) {
      if (c.measEffects.length === 0) continue;
      let allOk = true;
      for (const e of c.measEffects) {
        const k = NAME_TO_BUFF_KEY[e.name];
        const simStage = k === undefined ? undefined : Number((c.simEffects as any)[k] ?? 0);
        if (simStage === e.stage) continue;
        allOk = false;
        const label = `${e.name}(実測${e.stage}/sim${simStage ?? "?"})`;
        diffTally.set(label, (diffTally.get(label) ?? 0) + 1);
      }
      if (allOk) effectMatchCells++;
      else effectDiffCells++;
    }
    out.push({
      lane,
      n: cells.length,
      attribute: lc.attribute,
      ratioMean: mean(ratios),
      ratioMin: Math.min(...ratios),
      ratioMax: Math.max(...ratios),
      basicMean: mean(cells.map((c) => c.basic)),
      basicSumMean: mean(cells.map((c) => c.basicSum)),
      b1Mean: mean(cells.map((c) => c.b1)),
      comboMean: mean(cells.map((c) => c.combo)),
      fanMean: mean(cells.map((c) => c.fan)),
      stage: stageF,
      adv: lc.adv,
      photoFixedSum: pt?.fixedSum ?? 0,
      photoFixedMax: pt?.fixedMax ?? 0,
      photoPctMax: pt?.maxPct ?? 0,
      photoPctSum: pt?.sumPct ?? 0,
      measStatMean: mean(statPairs.map((c) => c.measStat as number)),
      simStatMean: mean(statPairs.map((c) => c.simStat)),
      statRatioMean:
        statPairs.length === 0 ? 0 : mean(statPairs.map((c) => (c.measStat as number) / c.simStat)),
      statMatch,
      effectMatchCells,
      effectDiffCells,
      effectDiffTop: [...diffTally.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map((e) => `${e[0]}×${e[1]}`),
      dBasicMean: mean(dBasic),
      dBasicSd: sd(dBasic),
      dB1Mean: mean(cells.map((c) => c.b1 * (c.ratio - 1))),
      dFanMean: mean(cells.map((c) => c.fan * (c.ratio - 1))),
      dComboMean: mean(cells.map((c) => c.combo * (c.ratio - 1))),
      dAdvMean: mean(cells.map((c) => c.adv * (c.ratio - 1))),
      ratioMeanPhotoSum: mean(cells.map((c) => c.ratioD)),
      ratioMeanFixedA: mean(cells.map((c) => (c.simA > 0 ? (c.mid - c.photoFixedSum) / c.simA : 0))),
      ratioMeanFixedABasic: mean(cells.map((c) => (c.simAfixBasic > 0 ? c.mid / c.simAfixBasic : 0))),
      ratioMeanFixedDBasic: mean(cells.map((c) => (c.simDfixBasic > 0 ? c.mid / c.simDfixBasic : 0))),
      ratioSdFixedDBasic: sd(cells.map((c) => (c.simDfixBasic > 0 ? c.mid / c.simDfixBasic : 0))),
      ratioMeanFixedD: mean(cells.map((c) => (c.simD > 0 ? (c.mid - c.photoFixedSum) / c.simD : 0))),
      ratioSdFixedD: sd(cells.map((c) => (c.simD > 0 ? (c.mid - c.photoFixedSum) / c.simD : 0))),
      impliedFanMean: mean(cells.map((c) => c.fan * c.ratio)),
      impliedAdvMean: mean(cells.map((c) => c.adv * c.ratio)),
    });
  }
  return out;
}

/** 実測の強化効果表示名 → buffKey（tools/audit_s1_b136_step11.ts / run_audit_post_decay.py と同一対応） */
const NAME_TO_BUFF_KEY: Record<string, string> = {
  "ボーカル上昇": "vocal_up",
  "ボーカルブースト": "vocal_boost",
  "ボーカル上昇超化": "vocal_up_extreme",
  "ボーカル低下": "vocal_down",
  "ダンス上昇": "dance_up",
  "ダンスブースト": "dance_boost",
  "ダンス上昇超化": "dance_up_extreme",
  "ダンス低下": "dance_down",
  "ビジュアル上昇": "visual_up",
  "ビジュアルブースト": "visual_boost",
  "ビジュアル上昇超化": "visual_up_extreme",
  "ビジュアル低下": "visual_down",
  "スコア上昇": "score_up",
  "ビートスコア上昇": "beat_score_up",
  "Aスキルスコア上昇": "a_skill_score_up",
  "SPスキルスコア上昇": "sp_skill_score_up",
  "Pスキルスコア上昇": "p_skill_score_up",
  "コンボスコア上昇": "combo_score_up",
  "クリティカル率上昇": "critical_rate_up",
  "クリティカル係数上昇": "critical_coeff_up",
  "テンションUP": "tension_up",
  "テンション": "tension_up",
  "集目": "focus",
  "ステルス": "stealth",
  "スキル成功率上昇": "skill_success_up",
  "消費スタミナ低下": "stamina_cost_down",
  "消費スタミナ上昇": "stamina_cost_up",
};

// ---------------------------------------------------------------------------
// ビート分類と適合度判定
// ---------------------------------------------------------------------------

type GroupKey = "white" | "white_crit" | "skill" | "empty";
const GROUP_KEYS: GroupKey[] = ["white", "white_crit", "skill", "empty"];
const GROUP_LABEL: Record<GroupKey, string> = {
  white: "純粋白ノーツ（クリなし・スキル発動なし）",
  white_crit: "白ノーツ＋クリティカル発生",
  skill: "スキル発動ビート（A/SP/P/フォト/LB）",
  empty: "データ欠損（実測 0 または sim 該当なし）",
};

interface BeatRow {
  beat: number;
  group: GroupKey;
  meas: number;
  measAct: boolean;
  simAct: string[];
  measBeatKind: number;
}

function classifyBeats(s: Sample, rc: Recompute): BeatRow[] {
  const rows: BeatRow[] = [];
  const beats = new Set<number>([...rc.perBeat.keys(), ...s.meas.byBeat.keys()]);
  for (const b of [...beats].sort((x, y) => x - y)) {
    const agg = rc.perBeat.get(b);
    const meas = s.meas.byBeat.get(b) ?? 0;
    const crit = s.meas.crit.get(b) ?? [false, false, false, false, false];
    const hasCrit = crit.some((c: boolean) => c === true);
    const simAct = agg?.simActivationKinds ?? [];
    const measAct = s.meas.activationBeats.has(b);
    let group: GroupKey = "white";
    if (meas <= 0 || agg === undefined) group = "empty";
    else if (simAct.length > 0 || measAct) group = "skill";
    else if (hasCrit) group = "white_crit";
    rows.push({
      beat: b,
      group,
      meas,
      measAct,
      simAct,
      measBeatKind: meas - (agg?.other.A ?? 0),
    });
  }
  return rows;
}

/** sourceKind 別の獲得スコア合計（ギャップ分解用） */
function kindTotals(res: TimelineResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const bt of res.beats) {
    for (const ev of bt.events) {
      const k = String(ev.sourceKind);
      out[k] = (out[k] ?? 0) + ev.gainedScore;
    }
  }
  return out;
}

interface GroupStat {
  nBeats: number;
  perModel: Record<ModelKey, PassStat>;
}
interface PopCellStat {
  n: number;
  /** sim 値がポップ表示区間 [floor, floor+step) に落ちたセル数（＝厳密一致） */
  inInterval: number;
  within5: number;
  /** 実測（ポップ中値）/ sim(rand=1000) の平均。1.000 なら系統ズレなし */
  meanRatio: number;
  perLaneMeanRatio: Record<string, number>;
}

interface SampleAnalysis {
  tag: SampleTag;
  label: string;
  totals: {
    meas: number;
    simNeutral: number;
    simReplay: number;
    modelNeutral: ModelSet;
    modelReplay: ModelSet;
    replayGap: number;
    replayGapPct: number;
    critPremiumSim: number;
    recordedConfirmed: number | null;
    impliedPremiumOfRecord: number | null;
    storedTraceTotal: number | null;
  };
  selfCheck: {
    beatEvents: number;
    otherEvents: number;
    mismatchCells: number;
    unverifiedCells: number;
    sample: { beat: number; lane: number; expect: number; got: number; why: string }[];
  };
  counts: Record<GroupKey, number>;
  groups: Record<GroupKey, GroupStat>;
  overall: Record<ModelKey, PassStat>;
  overallBeatKind: Record<ModelKey, PassStat>;
  pop: { nCells: number; perModel: Record<ModelKey, PopCellStat> };
  classMismatch: { simActNoMeas: number; measActNoSim: number };
  beatShareOfWhite: number;
  rows: BeatRow[];
}


function analyzeSample(s: Sample, rc: Recompute, rcNeutral: Recompute): SampleAnalysis {
  const rows = classifyBeats(s, rc);
  const counts: Record<GroupKey, number> = { white: 0, white_crit: 0, skill: 0, empty: 0 };
  const accTotal = modelRecord<{ beat: number; ratio: number }[]>(() => []);
  const accBeat = modelRecord<{ beat: number; ratio: number }[]>(() => []);
  const accByGroup = {} as Record<GroupKey, Record<ModelKey, { beat: number; ratio: number }[]>>;
  for (const g of GROUP_KEYS) accByGroup[g] = modelRecord<{ beat: number; ratio: number }[]>(() => []);
  const whiteShare: number[] = [];
  let simActNoMeas = 0;
  let measActNoSim = 0;

  for (const r of rows) {
    if (r.simAct.length > 0 && !r.measAct) simActNoMeas++;
    if (r.measAct && r.simAct.length === 0) measActNoSim++;
    const agg = rc.perBeat.get(r.beat);
    if (r.group === "empty" || agg === undefined) {
      counts.empty++;
      continue;
    }
    counts[r.group]++;
    if (r.group === "white" && agg.total.A > 0) whiteShare.push(agg.beat.A / agg.total.A);
    for (const m of MODELS) {
      const ratioTotal = agg.total[m.key] / r.meas;
      accTotal[m.key].push({ beat: r.beat, ratio: ratioTotal });
      accByGroup[r.group][m.key].push({ beat: r.beat, ratio: ratioTotal });
      if (r.measBeatKind > 0) {
        accBeat[m.key].push({ beat: r.beat, ratio: agg.beat[m.key] / r.measBeatKind });
      }
    }
  }

  const groups = {} as Record<GroupKey, GroupStat>;
  for (const g of GROUP_KEYS) {
    const perModel = modelRecord<PassStat>(() => EMPTY_PASS);
    for (const m of MODELS) perModel[m.key] = passStat(accByGroup[g][m.key]);
    groups[g] = { nBeats: counts[g], perModel };
  }
  const overall = modelRecord<PassStat>(() => EMPTY_PASS);
  const overallBeatKind = modelRecord<PassStat>(() => EMPTY_PASS);
  for (const m of MODELS) {
    overall[m.key] = passStat(accTotal[m.key]);
    overallBeatKind[m.key] = passStat(accBeat[m.key]);
  }

  const modelReplay = zeroModels();
  const modelNeutral = zeroModels();
  for (const a of rc.perBeat.values()) for (const m of MODELS) modelReplay[m.key] += a.total[m.key];
  for (const a of rcNeutral.perBeat.values()) for (const m of MODELS) modelNeutral[m.key] += a.total[m.key];

  // --- レーン別ポップ突合（純白ビートの非クリセルのみ） ---
  const whiteBeats = new Set(rows.filter((r) => r.group === "white").map((r) => r.beat));
  const popAcc = modelRecord<{ beat: number; lane: number; ratio: number }[]>(() => []);
  const popIn = modelRecord<number>(() => 0);
  const popWithin = modelRecord<number>(() => 0);
  const laneAcc = modelRecord<Record<string, number[]>>(() => ({}));
  let nCells = 0;
  for (const [key, pop] of s.meas.pops) {
    const parts = key.split(":");
    const beat = Number(parts[0]);
    const lane = Number(parts[1]);
    if (!whiteBeats.has(beat)) continue;
    const val = rc.perBeat.get(beat)?.laneBeat.get(lane);
    if (val === undefined) continue;
    nCells++;
    const mid = pop.floor + pop.step / 2;
    for (const m of MODELS) {
      const v = val[m.key];
      const ratio = v === 0 ? 0 : mid / v;
      (popAcc[m.key] ??= []).push({ beat, lane, ratio });
      if (v >= pop.floor && v < pop.floor + pop.step) popIn[m.key] = (popIn[m.key] ?? 0) + 1;
      if (ratio >= TOL_LO && ratio <= TOL_HI) popWithin[m.key] = (popWithin[m.key] ?? 0) + 1;
      ((laneAcc[m.key] ??= {})[String(lane)] ??= []).push(ratio);
    }
  }
  const pop: SampleAnalysis["pop"] = { nCells, perModel: modelRecord<PopCellStat>(() => EMPTY_POP) };
  for (const m of MODELS) {
    const st = passStat(popAcc[m.key] ?? []);
    const perLaneMeanRatio: Record<string, number> = {};
    for (const [lane, arr] of Object.entries(laneAcc[m.key] ?? {})) {
      perLaneMeanRatio[lane] = Number(mean(arr).toFixed(4));
    }
    pop.perModel[m.key] = {
      n: nCells,
      inInterval: popIn[m.key] ?? 0,
      within5: popWithin[m.key] ?? 0,
      meanRatio: Number(st.meanRatio.toFixed(4)),
      perLaneMeanRatio,
    };
  }

  return {
    tag: s.tag,
    label: s.label,
    totals: {
      meas: s.meas.total,
      simNeutral: s.resNeutral.totalScore,
      simReplay: s.resReplay.totalScore,
      modelNeutral,
      modelReplay,
      replayGap: s.resReplay.totalScore - s.meas.total,
      replayGapPct: s.resReplay.totalScore / s.meas.total - 1,
      critPremiumSim: s.resReplay.totalScore - s.resNeutral.totalScore,
      recordedConfirmed: s.recordedConfirmed,
      impliedPremiumOfRecord: s.recordedConfirmed === null ? null : s.meas.total - s.recordedConfirmed,
      storedTraceTotal: s.stored.totalScore,
    },
    selfCheck: {
      beatEvents: rc.beatEvents,
      otherEvents: rc.otherEvents,
      mismatchCells: rc.mismatches.length,
      unverifiedCells: rc.unverifiedCells,
      sample: rc.mismatches.slice(0, 8),
    },
    counts,
    groups,
    overall,
    overallBeatKind,
    pop,
    classMismatch: { simActNoMeas, measActNoSim },
    beatShareOfWhite: mean(whiteShare),
    rows,
  };
}


// ---------------------------------------------------------------------------
// S3 confirmed ギャップ要因分解（Step 2）
// ---------------------------------------------------------------------------

interface GapRow {
  key: string;
  label: string;
  sim: number;
  meas: number;
  gap: number;
  shareOfGapPct: number;
  note: string;
}

interface GapDecomp {
  header: {
    measTotal: number;
    simReplay: number;
    simNeutral: number;
    replayGap: number;
    replayGapPct: number;
    recordedConfirmed: number;
    recordedGap: number;
    recordedGapPct: number;
    /** simNeutral − （実測 − sim自身のcritプレミアム） 。記録された基準値を使わない自己一貫値 */
    confirmedGapSelf: number;
    critPremiumSim: number;
    critPremiumRecord: number;
    /** = replayGap + (critPremiumRecord − critPremiumSim) （恒等式） */
    confirmedGapReconstructed: number;
  };
  rows: GapRow[];
  /** 通常ビート（白ノーツ）の差が確認値ギャップに占める割合 */
  whiteShareOfConfirmedGapPct: number;
  /** モデル差し替えで通常ビート差がどう埋まるか */
  modelWhiteGap: Record<ModelKey, { whiteGap: number; residualGap: number; residualGapPct: number }>;
}

function gapDecomposition(s: Sample, rcReplay: Recompute, rcNeutral: Recompute): GapDecomp {
  const rowsAll = classifyBeats(s, rcReplay);
  // --- 実測クリティカルプレミアム（sim の crit 係数で中立化した実測値を推定） ---
  let critPremiumSim = 0;
  for (const cell of s.meas.critCells) {
    const rep = rcReplay.perBeat.get(cell.beat)?.laneBeat.get(cell.lane)?.A ?? 0;
    const neu = rcNeutral.perBeat.get(cell.beat)?.laneBeat.get(cell.lane)?.A ?? 0;
    critPremiumSim += rep - neu;
  }
  const measNeutralEst = s.meas.total - critPremiumSim;
  const confirmedGap = s.resNeutral.totalScore - measNeutralEst;

  // --- ビートグループ別の差（リプレイ・ラン＝乱数中立・実測 crit 再現） ---
  const bucket: Record<GroupKey, { sim: number; meas: number; n: number }> = {
    white: { sim: 0, meas: 0, n: 0 },
    white_crit: { sim: 0, meas: 0, n: 0 },
    skill: { sim: 0, meas: 0, n: 0 },
    empty: { sim: 0, meas: 0, n: 0 },
  };
  for (const r of rowsAll) {
    const agg = rcReplay.perBeat.get(r.beat);
    if (agg === undefined || r.meas <= 0 || r.group === "empty") continue;
    bucket[r.group].sim += agg.total.A;
    bucket[r.group].meas += r.meas;
    bucket[r.group].n += 1;
  }
  // --- 通常ビート（純白）の差をモデル別に再計算（確定値ラン＝乱数中立・クリティカル無し） ---
  //     純白ビートにはクリティカルが無いので measWhite = 実測増加量 − sim(通常ビート以外の確定値) で厳密に帰属できる
  const modelWhiteGap = modelRecord(() => ({ ...EMPTY_WHITE }));
  for (const m of MODELS) {
    let whiteSim = 0;
    let whiteMeas = 0;
    for (const r of rowsAll) {
      if (r.group !== "white") continue;
      const aggR = rcReplay.perBeat.get(r.beat);
      const aggN = rcNeutral.perBeat.get(r.beat);
      if (aggR === undefined || aggN === undefined) continue;
      whiteSim += aggN.beat[m.key];
      whiteMeas += r.meas - aggN.other[m.key];
    }
    const whiteGap = whiteSim - whiteMeas;
    const resid = s.resNeutral.totalScore + whiteGap - measNeutralEst;
    modelWhiteGap[m.key] = {
      whiteGap,
      residualGap: resid,
      residualGapPct: resid / measNeutralEst,
    };
  }
  const whiteGapModelA = modelWhiteGap.A.whiteGap;


  const replayGap = s.resReplay.totalScore - s.meas.total;
  const recorded = s.recordedConfirmed ?? 0;
  const critPremiumRecord = recorded === 0 ? 0 : s.meas.total - recorded;
  const recordedGap = recorded === 0 ? 0 : s.resNeutral.totalScore - recorded;

  const rows: GapRow[] = [];
  const totalGapForShare = replayGap !== 0 ? replayGap : 1;
  for (const g of ["white", "white_crit", "skill"] as GroupKey[]) {
    const b = bucket[g];
    if (b.n === 0) continue;
    rows.push({
      key: g,
      label: GROUP_LABEL[g],
      sim: b.sim,
      meas: b.meas,
      gap: b.sim - b.meas,
      shareOfGapPct: ((b.sim - b.meas) / totalGapForShare) * 100,
      note: `${b.n} ビート`,
    });
  }
  const kindNeutral = kindTotals(s.resNeutral);
  for (const [k, v] of Object.entries(kindNeutral)) {
    if (k === "beat") continue;
    rows.push({
      key: `kind_${k}`,
      label: `スキル系（確定値ラン・sim 側内訳）kind=${k}`,
      sim: v,
      meas: Number.NaN,
      gap: 0,
      shareOfGapPct: 0,
      note: "実測側を単独分解できないため sim 内訳のみ（帰属は白ノーツ側に行っている）",
    });
  }
  const whiteGap = whiteGapModelA;
  return {
    header: {
      measTotal: s.meas.total,
      simReplay: s.resReplay.totalScore,
      simNeutral: s.resNeutral.totalScore,
      replayGap,
      replayGapPct: replayGap / s.meas.total,
      recordedConfirmed: recorded,
      recordedGap,
      recordedGapPct: recorded === 0 ? 0 : recordedGap / recorded,
      confirmedGapSelf: confirmedGap,
      critPremiumSim,
      critPremiumRecord,
      confirmedGapReconstructed: replayGap + (critPremiumRecord - critPremiumSim),
    },
    rows,
    whiteShareOfConfirmedGapPct: recordedGap === 0 ? 0 : (whiteGap / recordedGap) * 100,
    modelWhiteGap,
  };
}



// ---------------------------------------------------------------------------
// 出力
// ---------------------------------------------------------------------------

const pad = (v: string | number, n: number): string => String(v).padEnd(n);
const passCell = (st: PassStat): string => (st.n === 0 ? "n/a" : `${st.pass}/${st.n} (${pctStr(st.passRate, 1)})`);

function statLine(st: PassStat): string {
  return (
    `合格 ${passCell(st)} | 平均 ${st.meanRatio.toFixed(4)} | σ ${st.sdRatio.toFixed(4)} | ` +
    `範囲 [${st.minRatio.toFixed(4)}, ${st.maxRatio.toFixed(4)}] | p5 ${st.p05.toFixed(4)} p95 ${st.p95.toFixed(4)}`
  );
}

interface SampleReport {
  analysis: SampleAnalysis;
  gap: GapDecomp | null;
  storedCompare: { stored: number | null; fresh: number; diff: number } | null;
  /** Phase 16 Action 2: レーン別ファクター分解（中立ラン基準） */
  laneDiag: LaneFactorDiag[];
  /** Phase 16-A2: ポップ合計のスコアバー増分に対する比（ capture 基準の健全性チェック） */
  popCoverage: { nBeats: number; ratio: number };
}

function printSampleReport(s: Sample, r: SampleReport, log: (l: string) => void): void {
  const a = r.analysis;
  log(`\n${"=".repeat(104)}`);
  log(`■ ${s.tag}: ${s.label}`);
  log(
    `  実測 ${intStr(a.totals.meas)} / sim(replay: 実測crit再現・rand=1000) ${intStr(a.totals.simReplay)} → ` +
      `${a.totals.replayGapPct >= 0 ? "+" : ""}${pctStr(a.totals.replayGapPct)}`,
  );
  log(
    `  sim(確定値・crit無) ${intStr(a.totals.simNeutral)} / 保存トレース ${
      r.storedCompare === null ? "n/a" : intStr(r.storedCompare.stored ?? 0)
    }`,
  );
  log(
    `  分類: ${GROUP_KEYS.map((g) => `${g}=${a.counts[g]}`).join(" / ")} ` +
      `（発動記録の不一致: simのみ ${a.classMismatch.simActNoMeas} / 実測のみ ${a.classMismatch.measActNoSim}）`,
  );
  log(
    `  self-check（エンジン値再現）: beat ${a.selfCheck.beatEvents} / other ${a.selfCheck.otherEvents} ` +
      `/ 不一致 ${a.selfCheck.mismatchCells} / 未検証 ${a.selfCheck.unverifiedCells}`,
  );
  for (const m of a.selfCheck.sample.slice(0, 4)) {
    log(`    · b${m.beat} L${m.lane} ${m.why}: expect ${m.expect} got ${m.got}`);
  }
  log(`  純白ビートでの通常ビート(beat種)比率の平均: ${pctStr(a.beatShareOfWhite, 1)}`);
  log(
    `  実測拡張データ: レーン別ポップ ${s.meas.pops.size} / 能力値表示 ${s.meas.stats.size} / ` +
      `効果 ${s.meas.effects.size} / 発動詳細 ${s.meas.actDetail.size} ビート`,
  );
  if (audienceNotes.has(s.tag)) log(`  ★ ${audienceNotes.get(s.tag)}`);

  log(`  ── 全ビート個別判定 sim/meas ∈ [${TOL_LO.toFixed(4)}, ${TOL_HI.toFixed(4)}]（1ビートでも外れたら不合格）`);
  for (const g of GROUP_KEYS) {
    if (a.groups[g].nBeats === 0) continue;
    log(`    [${GROUP_LABEL[g]}] ${a.groups[g].nBeats} ビート`);
    for (const m of MODELS) {
      log(`      ${m.key}: ${statLine(a.groups[g].perModel[m.key])}`);
    }
  }
  log(`    [ALL]`);
  for (const m of MODELS) log(`      ${m.key} 合計ベース      : ${statLine(a.overall[m.key])}`);
  for (const m of MODELS) log(`      ${m.key} 通常ビート孤立   : ${statLine(a.overallBeatKind[m.key])}`);

  if (a.pop.nCells > 0) {
    log(`  ── レーン別スコアポップ突合（純白ビート ${a.pop.nCells} セル）`);
    log(`      指標 = 実測ポップ中値 / sim(rand=1000)。式が正しければ 1.0000±0.025（乱数幅の半分）`);
    for (const m of MODELS) {
      const p = a.pop.perModel[m.key];
      const lanes = Object.entries(p.perLaneMeanRatio)
        .map(([l, v]) => `L${l} ${v.toFixed(4)}`)
        .join(" ");
      log(
        `      ${m.key}: 表示区間内 ${p.inInterval}/${p.n} | ±5% ${p.within5}/${p.n} | 平均 ${p.meanRatio.toFixed(4)} | ${lanes}`,
      );
    }
  }

  if (r.laneDiag.length > 0) {
    const nCells = r.laneDiag.reduce((acc, d) => acc + d.n, 0);
    log(`  ── Phase16-A2: レーン別ファクター分解（スキル発動なしビートの非クリティカルセル ${nCells} セル）`);
    const cov = r.popCoverage;
    if (cov.nBeats > 0) {
      log(
        `      健全性: ポップ合計/スコアバー増分 = ${cov.ratio.toFixed(4)}（4レーン以上記録の ${cov.nBeats} ビート）` +
          (cov.ratio > 0.85 && cov.ratio < 1.15
            ? "→ ポップはレーン増分のほぼ全量（他サンプルと同一基準で比較可）"
            : "→ ★ポップ値とレーン増分のスケールが不一致（このサンプルのポップは式検証に使えない）"),
      );
    }
    log(`      ratio = 実測ポップ中値 / sim中立(rand=1000)。Δ* = その項単独で不足を埋める場合に必要な増加分`);
    for (const d of r.laneDiag) {
      log(
        `      L${d.lane}(${d.attribute}) n=${d.n} ratio ${d.ratioMean.toFixed(4)} [${d.ratioMin.toFixed(3)}, ${d.ratioMax.toFixed(3)}] ` +
          `| フォト fixed ${d.photoFixedSum}(max ${d.photoFixedMax}) pct ${d.photoPctMax}→${d.photoPctSum} ` +
          `| basic ${intStr(d.basicMean)} b1 ${d.b1Mean.toFixed(0)} combo ${d.comboMean.toFixed(0)} fan ${d.fanMean.toFixed(0)} stage ${d.stage} adv ${d.adv}`,
      );
      log(
        `        Δbasic ${d.dBasicMean.toFixed(1)}±${d.dBasicSd.toFixed(1)} | Δb1 ${d.dB1Mean.toFixed(1)} | Δfan ${d.dFanMean.toFixed(1)} ` +
          `| Δcombo ${d.dComboMean.toFixed(1)} | Δadv ${d.dAdvMean.toFixed(1)}`,
      );
      log(
        `        [仮説] 生 ${d.ratioMean.toFixed(4)} | photoSum ${d.ratioMeanPhotoSum.toFixed(4)} | A+fix後 ${d.ratioMeanFixedA.toFixed(4)} | D+fix後 ${d.ratioMeanFixedD.toFixed(4)} ` +
          `| A+fixb ${d.ratioMeanFixedABasic.toFixed(4)} | D+fixb ${d.ratioMeanFixedDBasic.toFixed(4)}±${d.ratioSdFixedDBasic.toFixed(4)} ` +
          `| 示唆 fan ${intStr(d.impliedFanMean)} 示唆 adv ${intStr(d.impliedAdvMean)}`,
      );
      if (d.measStatMean > 0) {
        log(
          `        能力値: 実測 ${intStr(d.measStatMean)} / sim ${intStr(d.simStatMean)}（ratio ${d.statRatioMean.toFixed(4)}・完全一致 ${d.statMatch}/${d.n}）`,
        );
      }
      if (d.effectMatchCells + d.effectDiffCells > 0) {
        log(
          `        効果段数: 一致 ${d.effectMatchCells} / 不一致 ${d.effectDiffCells}` +
            (d.effectDiffTop.length > 0 ? ` | 内訳 ${d.effectDiffTop.join(", ")}` : ""),
        );
      }
    }
    const hypKeys = [
      ["生(A)", "ratioMean"],
      ["photo sum(D)", "ratioMeanPhotoSum"],
      ["A+fixed(後)", "ratioMeanFixedA"],
      ["D+fixed(後)", "ratioMeanFixedD"],
      ["A+fixed(basic)", "ratioMeanFixedABasic"],
      ["D+fixed(basic)", "ratioMeanFixedDBasic"],
    ] as const;
    let best = { label: "", maxAbs: 9, mean: 0, sd: 9 };
    for (const [label, key] of hypKeys) {
      const vs = r.laneDiag.map((d) => d[key]);
      const maxAbs = Math.max(...vs.map((v) => Math.abs(v - 1)));
      if (maxAbs < best.maxAbs) best = { label, maxAbs, mean: mean(vs), sd: sd(vs) };
      log(
        `      仮説${label}: レーン横断 平均 ${mean(vs).toFixed(4)} / レーン間σ ${sd(vs).toFixed(4)} / 最大偏差 ${maxAbs.toFixed(4)}` +
          (maxAbs <= 0.05 ? " ★全レーン ±5% 内" : ""),
      );
    }
    log(
      `      ★ 最良仮説: ${best.label}（最大偏差 ${best.maxAbs.toFixed(4)}・平均 ${best.mean.toFixed(4)}・レーン間σ ${best.sd.toFixed(4)}）` +
        (best.mean !== 0 && Math.abs(best.mean - 1) > 0.004
          ? ` ／ ただし系統オフセット ${(100 * (best.mean - 1)).toFixed(2)}% が残る（レーン非依存の不足＝ライボ等の%項か λ の可能性）`
          : " ／ 系統オフセットも無し"),
    );
    const flatSd = sd(r.laneDiag.map((d) => d.dBasicMean));
    const ratioSd = sd(r.laneDiag.map((d) => d.ratioMean));
    log(
      `      → レーン間散らばり: Δbasic(絶対値) σ ${flatSd.toFixed(1)} / ratio(比率) σ ${ratioSd.toFixed(4)} ` +
        `→ ${ratioSd < 0.005 ? "比率が一定＝乗算項（%系バフ・ライボ・λ）が不足" : flatSd < Math.abs(mean(r.laneDiag.map((d) => d.dBasicMean))) * 0.15 ? "絶対値が一定＝加算flat（フォト fixed 型）が不足" : "レーン依存（属性・優位・能力値差）を疑う"}`,
    );
  }

  if (a.classMismatch.simActNoMeas + a.classMismatch.measActNoSim > 0 && s.meas.actDetail.size > 0) {
    const measOnly = a.rows.filter((r) => r.measAct && r.simAct.length === 0).slice(0, 6);
    const simOnly = a.rows.filter((r) => r.simAct.length > 0 && !r.measAct).slice(0, 6);
    log(`  ── 発動記録の食い違い詳細（上位 ${measOnly.length}/${simOnly.length} 件）`);
    for (const m of measOnly) {
      log(`      実測のみ b${m.beat}: ${(s.meas.actDetail.get(m.beat) ?? []).join(" / ") || "(詳細なし)"}`);
    }
    for (const m of simOnly) log(`      sim のみ b${m.beat}: ${m.simAct.join(", ")}`);
  }

  if (r.gap !== null) {
    const h = r.gap.header;
    log(`  ── Step 2: 確定値（乱数中立）ギャップの要因分解`);
    log(`      実測 ${intStr(h.measTotal)} / sim(replay) ${intStr(h.simReplay)} / sim(中立) ${intStr(h.simNeutral)}`);
    log(`      sim のクリティカルプレミアム = ${intStr(h.critPremiumSim)} (${pctStr(h.critPremiumSim / h.simNeutral)})`);
    if (h.recordedConfirmed > 0) {
      log(`      記録された実測基準(乱数中立) = ${intStr(h.recordedConfirmed)} → 隐含プレミアム ${intStr(h.critPremiumRecord)}`);
      log(
        `      記録基準の差 ${intStr(h.recordedGap)} (${pctStr(h.recordedGapPct)}) ／ ` +
          `sim自身プレミアムで中立化した差 ${intStr(h.confirmedGapSelf)} (${pctStr(h.confirmedGapSelf / h.measTotal)})`,
      );
      log(
        `      ★ プレミアム差 ${intStr(h.critPremiumRecord - h.critPremiumSim)} が「−8% に見える」分。` +
          ` リプレイギャップは ${pctStr(h.replayGapPct)}`,
      );
    }
    for (const row of r.gap.rows) {
      const measStr = Number.isNaN(row.meas) ? "(実測側は単独分解不可)" : intStr(row.meas);
      log(
        `      ${pad(row.label, 44)} sim ${pad(intStr(row.sim), 13)} meas ${pad(measStr, 14)} 差 ${pad(intStr(row.gap), 12)}` +
          ` リプレイギャップ比 ${pad(pctStr(row.shareOfGapPct / 100, 1), 9)} ${row.note}`,
      );
    }
    log(`      ── モデル差し替え時の「純白ビート差」と残りギャップ`);
    for (const m of MODELS) {
      const w = r.gap.modelWhiteGap[m.key];
      log(
        `      ${m.key}: 純白差 ${pad(intStr(w.whiteGap), 13)} | 中立合計の差 ${pad(intStr(w.residualGap), 13)} (${pctStr(w.residualGapPct)})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

function main(): number {
  const argv = process.argv.slice(2);
  rawInputs = argv.includes("--raw-inputs");
  /** --name=value と --name value の両形式を受け付ける（--out path は打ち間違いやすいので許容） */
  const getArg = (name: string): string | null => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq !== undefined) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    const next: string | undefined = i >= 0 ? argv[i + 1] : undefined;
    if (next !== undefined && !next.startsWith("--")) return next;
    return null;
  };
  const wantTags = (getArg("samples") ?? "S3,T5")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0) as SampleTag[];
  const jsonPath = getArg("json");
  const quiet = argv.includes("--quiet");
  const lines: string[] = [];
  const log = (l: string): void => {
    lines.push(l);
    if (!quiet) console.log(l);
  };

  log("=== Phase 16 アクション1: 通常ビートスコア計算モデルの同定 ===");
  log(`実行: ${new Date().toISOString()} / 対象: ${wantTags.join(", ")}`);
  log(`判定: 各ビートで sim/meas ∈ [${TOL_LO.toFixed(4)}, ${TOL_HI.toFixed(4)}]（全ビート個別・平均判定は禁止）`);
  for (const m of MODELS) log(`  Model ${m.key}: ${m.label}`);

  const built: { sample: Sample; report: SampleReport; rcNeutral: Recompute }[] = [];
  for (const tag of wantTags) {
    const s =
      tag === "S3" ? buildS3() : tag === "S1" ? buildS1() : tag === "T5" ? buildT5() : buildS2();
    const rcReplay = recomputeModels(s, s.resReplay);
    const rcNeutral = recomputeModels(s, s.resNeutral);
    const analysis = analyzeSample(s, rcReplay, rcNeutral);
    const gap = tag === "S3" ? gapDecomposition(s, rcReplay, rcNeutral) : null;
    const storedCompare =
      s.stored.totalScore === null
        ? null
        : { stored: s.stored.totalScore, fresh: s.resReplay.totalScore, diff: s.resReplay.totalScore - s.stored.totalScore };
    built.push({
      sample: s,
      rcNeutral,
      report: {
      analysis,
      gap,
      storedCompare,
      laneDiag: laneFactorDiagnostics(s, rcNeutral),
      popCoverage: popCoverage(s, rcNeutral),
    },
    });
    if (rcReplay.mismatches.length > 0) {
      log(`\n!! セルフチェック失敗（${tag}）: ${rcReplay.mismatches.length} セルがエンジン値と不一致`);
      for (const m of rcReplay.mismatches.slice(0, 10)) {
        log(`   b${m.beat} L${m.lane} ${m.why}: expect ${m.expect} got ${m.got}`);
      }
      log("!! 再計算ロジックがエンジンとずれているため判定は無効（必ず修正すること）");
      return 1;
    }
  }

  for (const b of built) printSampleReport(b.sample, b.report, log);

  // --- ビート単位の生対照ダンプ（--dump=S1,S3 のように指定。アライメント/スケール検証用） ---
  const dumpArg = getArg("dump");
  if (dumpArg !== null) {
    const only = dumpArg.length === 0 ? null : new Set(dumpArg.split(",").map((t) => t.trim().toUpperCase()));
    const dumpPath = getArg("dumpout") ?? "research/23_beat_score_analysis/phase16_beat_dump.txt";
    const dl: string[] = [];
    for (const b of built) {
      if (only !== null && !only.has(b.sample.tag)) continue;
      const groups = new Map(classifyBeats(b.sample, b.rcNeutral).map((r) => [r.beat, r.group]));
      const beats = new Set<number>();
      for (const k of b.sample.meas.pops.keys()) beats.add(Number(k.split(":")[0]));
      dl.push(`=== ${b.sample.tag} ${b.sample.label}（ポップのあるビート ${beats.size} 件） ===`);
      dl.push(
        "  beat group   bar_meas   sim5中立  sim/bar |  popΣ  n | レーン別 pop/simA",
      );
      for (const beat of [...beats].sort((x, y) => x - y)) {
        const bar = b.sample.meas.byBeat.get(beat) ?? 0;
        let simSum = 0;
        let popSum = 0;
        let nPop = 0;
        const simRow: string[] = [];
        const popRow: string[] = [];
        const critRow: string[] = [];
        const crit = b.sample.meas.crit.get(beat) ?? [];
        for (let lane = 1; lane <= 5; lane++) {
          const ct = b.rcNeutral.cellAt.get(`${beat}:${lane}`);
          if (ct !== undefined) simSum += ct.vals.A;
          simRow.push(ct === undefined ? "     ——" : intStr(ct.vals.A).padStart(8));
          critRow.push(crit[lane - 1] === true ? "★" : "·");
          const pop = b.sample.meas.pops.get(`${beat}:${lane}`);
          if (pop === undefined) {
            popRow.push("     ——");
            continue;
          }
          const mid = pop.floor + pop.step / 2;
          popSum += mid;
          nPop += 1;
          popRow.push(intStr(mid).padStart(8));
        }
        dl.push(
          `  b${String(beat).padStart(4)} ${pad(groups.get(beat) ?? "?", 11)} bar=${pad(intStr(bar), 9)} sim5=${pad(
            intStr(simSum),
            9,
          )} sim/bar=${(simSum / Math.max(bar, 1)).toFixed(2)} popΣ=${pad(intStr(popSum), 9)} n=${nPop} crit=${critRow.join("")}`,
        );
        dl.push(`       sim : ${simRow.join(" ")}`);
        dl.push(`       pop : ${popRow.join(" ")}`);
      }
      dl.push("");
    }
    writeFileSync(dumpPath, dl.join("\n") + "\n", "utf8");
    console.error(`[beat dump] ${dumpPath}`);
  }

  // --- 判定サマリ ---
  log(`\n${"=".repeat(104)}`);
  log("■ 総合判定（Model A-D × サンプル）");
  log(`  ${pad("sample", 6)} ${pad("model", 6)} ${pad("λ", 10)} ${pad("photo", 6)} ${pad("ALL合格", 14)} ${pad("白のみ", 14)} ${pad("平均比率", 9)} 判定`);
  const verdicts: { sample: string; model: string; lam: string; photo: string; allPass: boolean; whitePass: boolean; meanRatio: number }[] = [];
  for (const b of built) {
    for (const m of MODELS) {
      const all = b.report.analysis.overall[m.key];
      const white = b.report.analysis.groups.white.perModel[m.key];
      const allOk = all.n > 0 && all.pass === all.n;
      const whiteOk = white.n > 0 && white.pass === white.n;
      verdicts.push({
        sample: b.sample.tag,
        model: m.key,
        lam: `${m.lam.num}/${m.lam.den}`,
        photo: m.photo,
        allPass: allOk,
        whitePass: whiteOk,
        meanRatio: Number(all.meanRatio.toFixed(4)),
      });
      log(
        `  ${pad(b.sample.tag, 6)} ${pad(m.key, 6)} ${pad(`${m.lam.num}/${m.lam.den}`, 10)} ${pad(m.photo, 6)} ` +
          `${pad(`${all.pass}/${all.n}`, 14)} ${pad(`${white.pass}/${white.n}`, 14)} ${pad(all.meanRatio.toFixed(4), 9)} ` +
          `${allOk ? "★ 合格" : `不合格（逸脱 ${all.n - all.pass} 件・最大逸脱 ${Math.max(Math.abs(all.minRatio - 1), Math.abs(all.maxRatio - 1)).toFixed(4)}）`}`,
      );
    }
  }
  const anyPass = verdicts.filter((v) => v.allPass);
  log(
    anyPass.length === 0
      ? "  → 全ビート ±5.0% を満たすモデルは無し（次アクション: 通常ビート以外の係数・クリティカル・オフ属性扱いを疑う）"
      : `  → 合格モデル: ${anyPass.map((v) => `${v.sample}/Model ${v.model}`).join(", ")}`,
  );

  if (jsonPath !== null) {
    const out = {
      meta: {
        generatedAt: new Date().toISOString(),
        tolerance: [TOL_LO, TOL_HI],
        models: MODELS.map((m) => ({ key: m.key, lambda: `${m.lam.num}/${m.lam.den}`, photo: m.photo, label: m.label })),
        note: "src/ は未変更。各モデル値はエンジンのビートファクター（basicSum/b1/combo/fan/stage/rand/crit/adv/photo sum-max 差分）から再計算した値。",
      },
      verdicts,
      samples: built.map((b) => ({
        tag: b.sample.tag,
        label: b.sample.label,
        storedTrace: b.sample.stored,
        photoBeatTerms: b.sample.photo,
        measCoverage: {
          popCells: b.sample.meas.pops.size,
          statCells: b.sample.meas.stats.size,
          effectCells: b.sample.meas.effects.size,
          actDetailBeats: b.sample.meas.actDetail.size,
        },
        laneDiag: b.report.laneDiag,
        lanePhotoDeltaPermil: laneContexts(b.sample).map((c) => ({ lane: c.lane, adv: c.adv, photoDeltaPermil: c.photoDeltaPermil })),
        analysis: {
          ...b.report.analysis,
          rows: b.report.analysis.rows.filter((r) => r.group !== "empty").slice(0, 400),
        },
        gap: b.report.gap,
      })),
    };
    const abs = path.isAbsolute(jsonPath) ? jsonPath : path.join(repoRoot, jsonPath);
    writeFileSync(abs, JSON.stringify(out, null, 2), "utf-8");
    if (!quiet) console.log(`\nJSON 出力: ${abs}`);
  }
  // レポートファイルは --quiet でも必ず書く（--quiet はコンソール出力の抑制だけを意味する）
  const outName = getArg("out") ?? "research/23_beat_score_analysis/phase16_action1_stdout.txt";
  const outAbs = path.isAbsolute(outName) ? outName : path.join(repoRoot, outName);
  writeFileSync(outAbs, lines.join("\n") + "\n", "utf-8");
  if (!quiet) console.log(`\nレポート出力: ${outAbs}`);
  return 0;
}

process.exit(main());


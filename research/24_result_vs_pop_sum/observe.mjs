/**
 * 24_analysis: リザルト画面のレーン別スコア（A）vs ポップ表示合計（B）の整合検証
 * 第1段階: セル分類統計・丸め unit 判別・残差分布の観察
 *
 * データ規律:
 *   - ポップ数字は backfill（LLM 目視）+ measured_data 既存記録のみ。推測で埋めない
 *   - 表示は「+38.6K」等の K/M 切り捨て表示 → 真値は [表示値, 表示値+unit)
 *   - A ビート（chart type=2）ではビートスコアなし＝発動レーンの A スコアのみ（T5 b23 で確認）
 *     非発動レーンのポップ欠損はスコア 0 として確定扱いできる
 *   - T5 b2 の A は b3 に計上（開幕例外）→ 残差法の対象から除外
 *
 * 実行: node research/24_result_vs_pop_sum/observe.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "C:/Users/umaro/Documents/アイプラ";
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

// ---------------------------------------------------------------- helpers

/** K/M 表示ポップの下限値パース: "+38.6K" → 38600, "+1.2M" → 1200000 */
function parsePop(displayed) {
  if (typeof displayed !== "string") return null;
  const m = /^\+?([\d.]+)([KM])$/.exec(displayed.trim());
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  return m[2] === "K" ? Math.round(num * 1000) : Math.round(num * 1e6);
}

/** unit（不確かさ幅）: 表示形式に依存する。+38.6K→100 / +24K→100（整数Kは .0 省略説） or 1000 / +1.2M→100000 */
function popUnit(displayed, integerKMode = 100) {
  if (typeof displayed !== "string") return null;
  const m = /^\+?([\d.]+)([KM])$/.exec(displayed.trim());
  if (!m) return null;
  const dec = (m[1].split(".")[1] ?? "").length; // 小数桁数
  const base = m[2] === "K" ? 1000 : 1e6;
  return base / 10 ** dec;
}

/** chart position → 実レーン（発動優先位置 1=センター=L3, 2=L2, 3=L4, 4=L1, 5=L5） */
const POS_TO_LANE = { 1: 3, 2: 2, 3: 4, 4: 1, 5: 5 };

// ---------------------------------------------------------------- sample definitions

const SAMPLES = [
  {
    tag: "T5",
    stage: "qt-daily-003-19",
    dir: `${REPO}/スコア分析サンプル`,
    act: `${REPO}/スコア分析サンプル/measured_data_v2.json`,
    pops: `${REPO}/スコア分析サンプル/lane_pops_backfill.json`,
    chart: "chart-hsm-004-001",
    resultKey: "scores_by_lane",
    openingSpecial: true, // b2 A は b3 計上
  },
  {
    tag: "S1",
    stage: "qt-area-1-001",
    dir: `${NOX}/サンプル1`,
    act: `${NOX}/サンプル1/measured_data_v2.json`,
    pops: `${NOX}/サンプル1/lane_pops_backfill.json`,
    chart: "chart-hsm-006-001",
    resultKey: "scores_by_lane",
    openingSpecial: false,
  },
  {
    tag: "S2",
    stage: "qt-tower-680",
    dir: `${NOX}/サンプル2`,
    act: `${NOX}/サンプル2/measured_data_v2.json`,
    pops: `${NOX}/サンプル2/lane_pops_backfill.json`,
    chart: "chart-sun-004-001",
    resultKey: "lane_scores", // lane1..lane5
    openingSpecial: false,
  },
  {
    tag: "S3",
    stage: "qt-ex-tower-005-045",
    dir: `${NOX}/サンプル3`,
    act: `${NOX}/サンプル3/measured_data.json`,
    pops: `${NOX}/サンプル3/lane_pops_backfill.json`,
    chart: "chart-thrx-004-001",
    resultKey: "scores_by_lane",
    openingSpecial: false,
  },
];

// ---------------------------------------------------------------- cell construction

/**
 * 全ビート×5レーンのポップセルを構築する。
 * 情報源（優先度）:
 *   1. lane_pops_backfill.json の pops（全セル網羅。readable/no_pop/遮蔽の判定済み）
 *   2. measured_data の gained_score_displayed（T5 形式）/ gained_score_pop.text（S3 形式）
 * 出力: cells[beat][lane] = {displayed, lo, unit, readable, covered, note}
 */
function buildCells(sample) {
  const act = read(sample.act);
  const tl = act.timeline;
  const bf = read(sample.pops);
  const cells = {};
  for (const p of bf.pops) {
    const beat = Number(p.beat);
    const L = Number(p.lane);
    (cells[beat] ??= {})[L] = {
      displayed: p.displayed ?? null,
      readable: p.readable === true,
      covered: p.covered_by_existing === true,
      color: p.color ?? null,
      note: p.note ?? null,
    };
  }
  for (const b of tl) {
    for (const [k, v] of Object.entries(b.lanes ?? {})) {
      const L = Number(String(k).replace(/^lane/, ""));
      const text = v.gained_score_displayed ?? v.gained_score_pop?.text ?? null;
      if (text) {
        cells[b.beat] ??= {};
        const c = cells[b.beat][L];
        if (!c || c.covered || !c.readable) {
          cells[b.beat][L] = {
            displayed: text,
            readable: true,
            covered: c?.covered ?? false,
            color: c?.color ?? v.gained_score_pop?.color ?? null,
            note: c?.note ?? "existing",
          };
        }
      }
    }
  }
  return { cells, timeline: tl, act };
}

// ---------------------------------------------------------------- per-sample analysis

function analyze(sample) {
  const { cells, timeline, act } = buildCells(sample);
  const chart = read(`${REPO}/data/charts_all.json`)[sample.chart];
  const noteType = {}, notePos = {};
  for (let i = 0; i < chart.length; i++) {
    noteType[i + 1] = chart[i][0];
    notePos[i + 1] = chart[i][1];
  }
  // activations: measured timeline から (beat → lanes[])
  const activations = {};
  for (const b of timeline) {
    activations[b.beat] = (b.skill_activations ?? []).map((a) => ({
      lane: Number(a.lane ?? a.idol?.replace(/[^\d]/g, "") ?? 0) || a.lane,
      type: a.skill_type,
      name: a.skill_name,
    }));
  }
  const stats = {
    tag: sample.tag,
    beats: timeline.length,
    cells_total: timeline.length * 5,
    readable: 0,
    no_pop: 0,
    no_pop_struct_zero: 0, // A/SP 非発動レーン or b0 等の構造的 0
    no_pop_unknown: 0,     // 推測必要（マスク・遮蔽・MISS 判定不能）
    no_frame: 0,
    display_formats: {},   // 表示形式の分布（unit 判定用）
    full_readable_beats: [], // 5 レーン全部 readable のビート（丸め判別用）
    unknown_by_lane: { 1: [], 2: [], 3: [], 4: [], 5: [] },
    struct_zero_by_lane: { 1: [], 2: [], 3: [], 4: [], 5: [] },
  };
  const cellRows = [];
  for (const b of timeline) {
    const beat = b.beat;
    const bgs = b.beat_gained_score ?? 0;
    const note = noteType[beat] ?? 0;
    // A/SP ビートの発動実レーン（activations に A/SP がいるレーン）
    const skillLanes = (activations[beat] ?? []).filter((a) => a.type === "A" || a.type === "SP").map((a) => a.lane);
    const chartLane = note > 0 ? POS_TO_LANE[notePos[beat]] : null;
    const fail = /FAIL/.test(b.sp_note ?? "") || (note === 3 && skillLanes.length === 0);
    for (let L = 1; L <= 5; L++) {
      const c = cells[beat]?.[L];
      const row = { beat, lane: L, noteType: note };
      if (c && c.readable && c.displayed) {
        stats.readable++;
        row.state = "readable";
        row.displayed = c.displayed;
        row.lo = parsePop(c.displayed);
        row.unit = popUnit(c.displayed);
        row.color = c.color;
        const fmt = c.displayed.replace(/^\+\d+/, "N").replace(/^\+\d*\.?\d+/, "N");
        stats.display_formats[c.displayed.replace(/^(\+\d[\d.]*)([KM])$/, "$1:$2")] =
          (stats.display_formats[c.displayed.replace(/^(\+\d[\d.]*)([KM])$/, "$1:$2")] ?? 0) + 1;
      } else {
        // 欠損セル
        if (c && /フレーム/.test(c.note ?? "") && !c.readable) stats.no_frame++;
        if (beat === 0 || bgs === 0) {
          row.state = "zero_struct"; // ビート合計 0 → 全レーン 0
          stats.no_pop_struct_zero++;
          stats.struct_zero_by_lane[L].push(beat);
        } else if ((note === 2 || note === 3) && !skillLanes.includes(L) && chartLane !== L) {
          row.state = "zero_struct"; // A/SP ビート非発動レーン
          stats.no_pop_struct_zero++;
          stats.struct_zero_by_lane[L].push(beat);
        } else if ((note === 2 || note === 3) && (chartLane === L || skillLanes.includes(L))) {
          row.state = "unknown"; // 発動レーンのポップが見えない（遮蔽・マスク）
          stats.no_pop++;
          stats.no_pop_unknown++;
          stats.unknown_by_lane[L].push(beat);
          row.reason = c?.note ?? "no record";
        } else {
          row.state = "unknown"; // 通常ビートでポップなし（MISS or マスク）
          stats.no_pop++;
          stats.no_pop_unknown++;
          stats.unknown_by_lane[L].push(beat);
          row.reason = c?.note ?? "no record";
        }
        row.bgs = bgs;
      }
      cellRows.push(row);
    }
    // 5 レーン全部 readable → 丸め判別候補
    if ([1, 2, 3, 4, 5].every((L) => cells[beat]?.[L]?.readable && cells[beat]?.[L]?.displayed)) {
      stats.full_readable_beats.push(beat);
    }
  }
  return { stats, cellRows, timeline, cells, noteType, activations, act };
}

// ---------------------------------------------------------------- run

const lines = [];
const outAll = {};
for (const sample of SAMPLES) {
  const { stats, cellRows } = analyze(sample);
  console.log(`===== ${sample.tag} (${sample.stage}) =====`);
  console.log(`beats=${stats.beats} cells=${stats.cells_total} readable=${stats.readable} no_pop=${stats.no_pop} (struct_zero=${stats.no_pop_struct_zero} unknown=${stats.no_pop_unknown})`);
  for (let L = 1; L <= 5; L++) {
    console.log(`  L${L}: struct_zero=${stats.struct_zero_by_lane[L].length} unknown=${stats.unknown_by_lane[L].length}`);
  }
  console.log(`display formats: ${JSON.stringify(stats.display_formats)}`);
  console.log(`full readable beats: ${stats.full_readable_beats.length}`);
  console.log("");
  outAll[sample.tag] = stats;
  writeFileSync(
    new URL(`./cells_${sample.tag}.json`, import.meta.url),
    JSON.stringify(cellRows, null, 1),
  );
}
writeFileSync(new URL("./observe_stats.json", import.meta.url), JSON.stringify(outAll, null, 2));

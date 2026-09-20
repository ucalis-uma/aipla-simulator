/**
 * 24_analysis 第4段階: unknown セルの詳細と推測手段の可用性レポート
 *
 * セル分類:
 *   readable     : ポップ表示あり（下限値 lo / unit は K:100, M:100000, G:1e8 切捨て）
 *   zero         : ビート合計 0（開幕/miss ビート）・A/SP FAIL・A/SP 非発動レーン → スコア 0
 *   unknown      : ポップなし・スコアあり（マスク/遮蔽/取り逃し）→ 推測対象
 *
 * 実行: node research/24_result_vs_pop_sum/unknowns.mjs
 */
import { readFileSync } from "node:fs";

const REPO = "C:/Users/umaro/Documents/アイプラ";
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

const UNIT_BY_SF = { K: 100, M: 100000, G: 100000000 };

function parsePop(displayed) {
  if (typeof displayed !== "string") return null;
  const m = /^\+?([\d.]+)([KMG])$/.exec(displayed.trim());
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * { K: 1e3, M: 1e6, G: 1e9 }[m[2]]);
}
function popSuffix(displayed) {
  const m = /^\+?([\d.]+)([KMG])$/.exec(displayed.trim());
  return m ? m[2] : null;
}

const POS_TO_LANE = { 1: 3, 2: 2, 3: 4, 4: 1, 5: 5 };

const SAMPLES = [
  { tag: "T5", stage: "qt-daily-003-19", dir: `${REPO}/スコア分析サンプル`, act: `${REPO}/スコア分析サンプル/measured_data_v2.json`, pops: `${REPO}/スコア分析サンプル/lane_pops_backfill.json`, chart: "chart-hsm-004-001", resultKey: "scores_by_lane", openingSpecial: true },
  { tag: "S1", stage: "qt-area-1-001", dir: `${NOX}/サンプル1`, act: `${NOX}/サンプル1/measured_data_v2.json`, pops: `${NOX}/サンプル1/lane_pops_backfill.json`, chart: "chart-hsm-006-001", resultKey: "scores_by_lane", openingSpecial: false },
  { tag: "S2", stage: "qt-tower-680", dir: `${NOX}/サンプル2`, act: `${NOX}/サンプル2/measured_data_v2.json`, pops: `${NOX}/サンプル2/lane_pops_backfill.json`, chart: "chart-sun-004-001", resultKey: "lane_scores", openingSpecial: false },
  { tag: "S3", stage: "qt-ex-tower-005-045", dir: `${NOX}/サンプル3`, act: `${NOX}/サンプル3/measured_data.json`, pops: `${NOX}/サンプル3/lane_pops_backfill.json`, chart: "chart-thrx-004-001", resultKey: "scores_by_lane", openingSpecial: false },
];

export function buildSample(sample) {
  const act = read(sample.act);
  const tl = act.timeline;
  const bf = read(sample.pops);
  const cells = {};
  for (const p of bf.pops) {
    (cells[p.beat] ??= {})[p.lane] = { ...p, lane: Number(p.lane) };
  }
  for (const b of tl) {
    for (const [k, v] of Object.entries(b.lanes ?? {})) {
      const L = Number(String(k).replace(/^lane/, ""));
      const text = v.gained_score_displayed ?? v.gained_score_pop?.text ?? null;
      if (text) {
        cells[b.beat] ??= {};
        const c = cells[b.beat][L];
        if (!c || c.covered_by_existing || !c.readable) {
          cells[b.beat][L] = { displayed: text, readable: true, covered: c?.covered_by_existing ?? false, note: c?.note ?? "existing", lane: L };
        }
      }
    }
  }
  const chart = read(`${REPO}/data/charts_all.json`)[sample.chart];
  const notes = chart.map(([t, p], i) => ({ beat: i + 1, type: t, lane: POS_TO_LANE[p] }));
  const critMap = {};
  const cfb = act.critical_flags;
  if (cfb?.beats && typeof cfb.beats === "object") {
    if (typeof cfb.beats[Symbol.iterator] === "function") {
      for (const r of cfb.beats) {
        critMap[r.beat] = [1, 2, 3, 4, 5].map((L) => (r.lanes ? r.lanes[String(L)] === "critical" : false));
      }
    } else {
      for (const [k, v] of Object.entries(cfb.beats)) {
        critMap[Number(k)] = [1, 2, 3, 4, 5].map((L) => v[`L${L}`] === "critical");
      }
    }
  }
  // timeline lanes の stat_value と effects をとる
  const laneState = {};
  for (const b of tl) {
    laneState[b.beat] = {};
    for (const [k, v] of Object.entries(b.lanes ?? {})) {
      const L = Number(String(k).replace(/^lane/, ""));
      laneState[b.beat][L] = {
        stat: v.stat_value ?? null,
        effects: (v.effects ?? []).map((e) => `${e.id ?? e.name}:${e.stage ?? ""}`).join("|"),
      };
    }
  }
  return { act, tl, cells, notes, critMap, laneState };
}

export function classifyCells(sample, built) {
  const { tl, cells, notes, critMap } = built;
  const noteMap = Object.fromEntries(notes.map((n) => [n.beat, n]));
  const rows = [];
  for (const b of tl) {
    const beat = b.beat;
    const bgs = b.beat_gained_score ?? 0;
    const note = noteMap[beat] ?? { type: 0, lane: null };
    const acts = b.skill_activations ?? [];
    const failAct = acts.find((a) => /FAIL/.test(a.skill_name ?? ""));
    const skillLanes = acts.filter((a) => (a.skill_type === "A" || a.skill_type === "SP") && !/FAIL/.test(a.skill_name ?? "")).map((a) => a.lane);
    const anyActLanes = acts.filter((a) => !/FAIL/.test(a.skill_name ?? "")).map((a) => a.lane);
    for (let L = 1; L <= 5; L++) {
      const c = cells[beat]?.[L];
      const crit = critMap[beat]?.[L - 1] ?? null;
      const row = { beat, lane: L, bgs, noteType: note.type, noteLane: note.lane, crit, acts: anyActLanes.includes(L) };
      if (c && c.readable && c.displayed) {
        const lo = parsePop(c.displayed);
        row.state = "readable";
        row.displayed = c.displayed;
        row.lo = lo;
        row.hi = lo + UNIT_BY_SF[popSuffix(c.displayed)];
        row.color = c.color ?? null;
      } else if (beat === 0 || bgs === 0) {
        row.state = "zero";
        row.reason = beat === 0 ? "b0" : "bgs=0";
        row.lo = 0; row.hi = 0;
      } else if ((note.type === 2 || note.type === 3)) {
        if (failAct || skillLanes.length === 0) {
          row.state = "zero"; row.reason = "skill fail";
          row.lo = 0; row.hi = 0;
        } else if (!skillLanes.includes(L)) {
          row.state = "zero"; row.reason = "non-activation lane";
          row.lo = 0; row.hi = 0;
        } else {
          row.state = "unknown"; row.reason = c?.note ?? "activation lane, no pop";
          row.lo = null; row.hi = null;
        }
      } else {
        row.state = "unknown"; row.reason = c?.note ?? "no pop (normal beat)";
        row.lo = null; row.hi = null;
      }
      rows.push(row);
    }
  }
  return rows;
}

if (process.argv[1] && process.argv[1].endsWith("unknowns.mjs")) {
  for (const sample of SAMPLES) {
    const built = buildSample(sample);
    const rows = classifyCells(sample, built);
    const unknowns = rows.filter((r) => r.state === "unknown");
    console.log(`===== ${sample.tag}: unknown ${unknowns.length} =====`);
    for (const u of unknowns) {
      console.log(`  b${u.beat} L${u.lane} type=${u.noteType} crit=${u.crit} reason=${u.reason} bgs=${u.bgs}`);
    }
    console.log("");
  }
}

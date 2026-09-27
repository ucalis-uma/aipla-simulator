/**
 * 【Phase 14-F 検証監査 v2】revival ON/OFF が分岐する全セルの実測表示突合
 * 作成: 2026-09-27
 *
 * audit_phase14f_revival.mjs（v1）は「実測に表示されているバフ」だけを突合したため、
 * **revival が実測に無いバフを作り出す偽陽性**を捕捉できなかった。本スクリプトは
 * ON/OFF の buffSnapshots が食い違う (beat, lane, buff) セルを全て列挙し、
 * 各セルについて実測表示が
 *   - 同じ値を提示（ON 支持）/ 別の値を提示（双方不一致）/ 空リストで非表示（OFF 支持）
 *   - 撮影欠損（判定不能）
 * のいずれに該当するかで判定する。これが「実測効果を計算機で説明できるか」の直接検証。
 *
 * 実行: node research/26_data_integrity/audit_phase14f_divergence.mjs
 * 出力: research/26_data_integrity/phase14f_divergence_audit.json
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const readFs = (p) => JSON.parse(readFileSync(p, "utf-8"));
const readHead = (p) =>
  JSON.parse(execSync(`git show HEAD:${p}`, { encoding: "utf-8", maxBuffer: 1 << 28 }));

const measured = readFs("tests/golden/fixtures/t5_measured.json");
const onTrace = readFs("research/25_buff_audit/t5_sim_trace_full.json"); // 作業ツリー = revival ON
const offTrace = readHead("research/25_buff_audit/t5_sim_trace_full.json"); // HEAD = revival OFF

const WATCHED = [
  "vocal_boost",
  "vocal_up",
  "dance_boost",
  "dance_up",
  "visual_boost",
  "visual_up",
  "skill_success_up",
  "combo_score_up",
  "critical_coeff_up",
  "focus",
];

const idx = (t) => new Map((t.beats ?? []).map((b) => [b.beat, b]));
const ON = idx(onTrace);
const OFF = idx(offTrace);
const measByBeat = new Map((measured.timeline ?? []).map((r) => [Number(r.beat), r]));

/** 実測表示のバフ段数マップ（同一 id 重複は合算）。戻り値 null = そのレーンの撮影欠損 */
function measStages(row, laneKey) {
  if (!row?.effects || !(laneKey in row.effects)) return null;
  const list = row.effects[laneKey];
  if (!Array.isArray(list)) return null;
  const out = {};
  for (const e of list) {
    if (e?.id == null) continue;
    out[e.id] = (out[e.id] ?? 0) + (e.stage == null ? 0 : Number(e.stage));
  }
  return { map: out, captured: true, empty: list.length === 0 };
}

const simVal = (map, beat, laneIdx, key) => {
  const snap = map.get(beat)?.buffSnapshots?.[laneIdx];
  return snap ? Number(snap[key] ?? 0) : null;
};

// ---- 撮影カバレッジ確認（判定可能セルの分母を正当化するため） ----
let laneCells = 0;
let laneCaptured = 0;
for (const row of measured.timeline ?? []) {
  for (const lane of ["1", "2", "3", "4", "5"]) {
    laneCells++;
    if (measStages(row, lane)) laneCaptured++;
  }
}

const cells = [];
let totalDivergent = 0;
const verdict = { on_support: 0, off_support: 0, both: 0, neither: 0, not_captured: 0 };

for (const row of measured.timeline ?? []) {
  const beat = Number(row.beat);
  for (const lane of ["1", "2", "3", "4", "5"]) {
    const laneIdx = Number(lane) - 1;
    const ms = measStages(row, lane);
    for (const key of WATCHED) {
      const vOn = simVal(ON, beat, laneIdx, key);
      const vOff = simVal(OFF, beat, laneIdx, key);
      if (vOn === null || vOff === null) continue;
      if (vOn === vOff) continue;
      totalDivergent++;
      let support;
      let measuredVal = null;
      if (!ms) {
        support = "not_captured";
      } else if (key in ms.map) {
        measuredVal = ms.map[key];
        const onOk = vOn === measuredVal;
        const offOk = vOff === measuredVal;
        support = onOk && offOk ? "both" : onOk ? "on" : offOk ? "off" : "neither";
      } else {
        // 実測はそのバフを表示していない（空リスト／他バフのみ）
        const onShows = vOn > 0;
        const offShows = vOff > 0;
        support = onShows && !offShows ? "off" : offShows && !onShows ? "on" : "neither";
      }
      if (support === "on") verdict.on_support++;
      else if (support === "off") verdict.off_support++;
      else if (support === "both") verdict.both++;
      else if (support === "not_captured") verdict.not_captured++;
      else verdict.neither++;
      cells.push({
        beat,
        lane: Number(lane),
        buff: key,
        sim_on: vOn,
        sim_off: vOff,
        measured: measuredVal,
        support,
      });
    }
  }
}

// ---- 表示遅延 1 ビートを許容した感度分析（ON が有利なセルだけ再評価） ----
const lagTolerant = { on: 0, off: 0, neither: 0 };
for (const c of cells) {
  if (c.support !== "on" && c.support !== "off") continue;
  const msPrev = measStages(measByBeat.get(c.beat - 1), String(c.lane));
  const prevVal = msPrev?.map?.[c.buff];
  const prevShown = msPrev ? c.buff in msPrev.map : false;
  const onMatches = c.sim_on === prevVal || (prevShown && c.sim_on === 0) || (!prevShown && c.sim_on === 0);
  const offMatches = c.sim_off === prevVal || (prevShown && c.sim_off === 0) || (!prevShown && c.sim_off === 0);
  if (onMatches && !offMatches) lagTolerant.on++;
  else if (offMatches && !onMatches) lagTolerant.off++;
  else lagTolerant.neither++;
}

const summary = {
  generated: "2026-09-27",
  purpose: "revival ON/OFF の buffSnapshots 分岐セル全ての実測表示突合",
  total_score: {
    revival_on: onTrace.totalScore,
    revival_off: offTrace.totalScore,
    measured: measured.results?.total_score ?? null,
  },
  score_error_pct: {
    revival_on: Number(
      (((onTrace.totalScore - measured.results.total_score) / measured.results.total_score) * 100).toFixed(4),
    ),
    revival_off: Number(
      (((offTrace.totalScore - measured.results.total_score) / measured.results.total_score) * 100).toFixed(4),
    ),
  },
  display_capture_coverage: { lane_cells: laneCells, captured: laneCaptured },
  divergent_cells: totalDivergent,
  verdict,
  lag1_sensitivity_on_divergent: lagTolerant,
};

writeFileSync(
  "research/26_data_integrity/phase14f_divergence_audit.json",
  JSON.stringify({ summary, cells }, null, 1),
);
console.log(JSON.stringify(summary, null, 1));
console.log("--- 分岐セル（先頭 40 件）---");
for (const c of cells.slice(0, 40)) {
  console.log(
    `b${c.beat} L${c.lane} ${c.buff}: ON=${c.sim_on} OFF=${c.sim_off} meas=${c.measured ?? "-"} => ${c.support}`,
  );
}

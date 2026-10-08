/**
 * Phase 16 Action14 共通: **厳密セル台帳**（bgs − Σ(可読 pop) で「唯一不能レーン」の実測を復元）
 *
 *   node research/23_beat_score_analysis/_a14_exact_ledger.mjs S2 [lane]
 *
 * なぜ必要か: pop は K/M 表記の切り捨てなので単独では ±99〜99,999 の不確かさを持つ。
 * 「そのビートで pop が読めていないレーンが 1 つだけ」なら、そのレーンの実測 =
 * `beat_gained_score − Σ(可読 pop)` として **切り捨て分（≤ Σ 粒度）を除いて厳密**に決まる。
 * A/SP スキルセルはこの形（他レーンは pop なし）が多いので、A2 の突合に使える。
 */
import fs from "node:fs";
import path from "node:path";

const repo = process.cwd();
const nox = path.resolve(repo, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const argv = process.argv.slice(2);
const TAG = (argv[0] ?? "S2").toUpperCase();
const LANE_FILTER = argv[1] === undefined ? null : Number(argv[1]);
const DIR = { S1: "サンプル1", S2: "サンプル2", S3: "サンプル3" }[TAG];

const parseK = (t) => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const u = { "": 1, K: 1e3, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : Math.round(Number(m[1]) * u);
};
const gran = (t) => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const u = { "": 1, K: 1e3, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : u / 10;
};
const laneOf = (row, l) => {
  const L = row?.lanes;
  if (L === null || L === undefined) return null;
  return Array.isArray(L) ? (L[l - 1] ?? null) : (L[String(l)] ?? L[`lane${l}`] ?? null);
};

const evFile = path.join(repo, "research", "23_beat_score_analysis", `phase16_action14_a2_${TAG.toLowerCase()}_events.json`);
const simDoc = J(evFile).samples[TAG];
const sim = simDoc.cells;
const cellEvents = simDoc.cellEvents ?? {};
let meas = null;
for (const f of ["measured_data_v3.json", "measured_data_v2.json"]) {
  const p = path.join(nox, DIR, f);
  if (!fs.existsSync(p)) continue;
  const d = J(p);
  if (Array.isArray(d.timeline)) {
    meas = d;
    break;
  }
}
const pop = new Map();
for (const e of meas.timeline) {
  for (let l = 1; l <= 5; l++) {
    const g = laneOf(e, l)?.gained_score_pop;
    const t = typeof g === "string" ? g : (g?.text ?? null);
    if (parseK(t) !== null) pop.set(`${e.beat}:${l}`, String(t));
  }
}
const bf = path.join(nox, DIR, "lane_pops_backfill.json");
if (fs.existsSync(bf)) {
  for (const x of J(bf).pops ?? []) {
    if (x.readable === false || parseK(x.displayed) === null) continue;
    if (!pop.has(`${x.beat}:${x.lane}`)) pop.set(`${x.beat}:${x.lane}`, String(x.displayed));
  }
}
const rows = [];
for (const e of meas.timeline) {
  const b = e.beat;
  const bgs = e.beat_gained_score ?? 0;
  const readable = [];
  const unreadable = [];
  let popSum = 0;
  let slack = 0;
  for (let l = 1; l <= 5; l++) {
    const t = pop.get(`${b}:${l}`);
    if (t === undefined) unreadable.push(l);
    else {
      readable.push(l);
      popSum += parseK(t) ?? 0;
      slack += (gran(t) ?? 0) - 1;
    }
  }
  const resid = bgs - popSum;
  rows.push({ beat: b, bgs, readable, unreadable, popSum, slack, resid });
}
console.log(`=== ${TAG} 厳密セル台帳（pop 不能レーンが 1 つだけのビート） ===`);
const exact = [];
for (const r of rows) {
  if (r.unreadable.length !== 1) continue;
  const lane = r.unreadable[0];
  if (LANE_FILTER !== null && lane !== LANE_FILTER) continue;
  const simV = sim[`${r.beat}:${lane}`] ?? null;
  const meta = { measured: r.resid, slack: r.slack, sim: simV, lane, beat: r.beat };
  if (simV === null) continue;
  exact.push({ ...meta, ratio: r.resid === 0 ? null : simV / r.resid });
}
const byLane = new Map();
for (const x of exact) {
  const a = byLane.get(x.lane) ?? { n: 0, measured: 0, sim: 0, slack: 0, cells: [] };
  a.n++;
  a.measured += x.measured;
  a.sim += x.sim;
  a.slack += x.slack;
  a.cells.push(x);
  byLane.set(x.lane, a);
}
for (const [lane, a] of [...byLane.entries()].sort((x, y) => x[0] - y[0])) {
  console.log(
    `  L${lane}: ${String(a.n).padStart(3)} セル / 実測 ${a.measured.toLocaleString()} / sim ${a.sim.toLocaleString()} / ` +
      `比 ${(a.sim / a.measured).toFixed(4)}（切り捨て不確かさ ≤${a.slack.toLocaleString()} = ${((a.slack / a.measured) * 100).toFixed(2)}%）`,
  );
}
if (LANE_FILTER !== null) {
  const a = byLane.get(LANE_FILTER);
  console.log(`\n--- L${LANE_FILTER} のセル別（比の良い順） ---`);
  for (const x of (a?.cells ?? []).slice().sort((p, q) => (q.ratio ?? 0) - (p.ratio ?? 0))) {
    const kinds = (cellEvents[`${x.beat}:${x.lane}`] ?? []).map((e) => `${e.sourceKind}${e.isRatioScore ? "(ratio)" : ""}`);
    console.log(
      `  b${String(x.beat).padStart(3)}: 実測 ${String(x.measured).padStart(11)} sim ${String(x.sim).padStart(11)} ` +
        `比 ${x.ratio === null ? "  n/a" : x.ratio.toFixed(4)} [${kinds.join(",")}]`,
    );
  }
  const kindsAgg = {};
  for (const x of a?.cells ?? []) {
    const evs = cellEvents[`${x.beat}:${x.lane}`] ?? [];
    for (const k of new Set(evs.map((e) => e.sourceKind))) {
      kindsAgg[k] ??= { n: 0, measured: 0, sim: 0 };
      kindsAgg[k].n++;
      kindsAgg[k].measured += x.measured;
      kindsAgg[k].sim += x.sim;
    }
  }
  console.log(`\n--- L${LANE_FILTER} kind 別（厳密セルのみ） ---`);
  for (const [k, v] of Object.entries(kindsAgg)) {
    console.log(`  ${k}: ${v.n} セル / 実測 ${v.measured.toLocaleString()} / sim ${v.sim.toLocaleString()} / 比 ${(v.sim / v.measured).toFixed(4)}`);
  }
}

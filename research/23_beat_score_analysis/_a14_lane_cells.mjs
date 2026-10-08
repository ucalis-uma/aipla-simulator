/**
 * Phase 16 Action14 共通小道具: サンプル×レーンのセル台帳
 *
 *   node research/23_beat_score_analysis/_a14_lane_cells.mjs S1 3
 *   node research/23_beat_score_analysis/_a14_lane_cells.mjs S3 3 --top=25
 *
 * 出すもの: pop と sim の突合（diff 上位/下位）・sim の超過が大きいセルの発動記録・
 *          レーン合計/Σpop/隠れ枠/可読比・K/M 切り捨ての上界。
 */
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(process.cwd());
const nox = path.resolve(repo, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);
const argv = process.argv.slice(2);
const TAG = (argv[0] ?? "S3").toUpperCase();
const LANE = Number(argv[1] ?? 3);
const TOP = Number((argv.find((a) => a.startsWith("--top=")) ?? "--top=20").split("=")[1]);

const DIR = { S1: "サンプル1", S2: "サンプル2", S3: "サンプル3" }[TAG];
const FALLBACK = { S1: "measured_data_s1_v3.json", S2: "measured_data_s2_v3.json", S3: "measured_data_s3_v3.json" }[TAG];
const cands = [
  ...["measured_data_v3.json", "measured_data_v2.json", "measured_data.json"].map((f) =>
    path.join(nox, DIR, f),
  ),
  path.join(repo, "research", "26_data_integrity", FALLBACK),
];
let meas = null;
let measFile = null;
for (const p of cands) {
  if (!exists(p)) continue;
  const d = J(p);
  if (Array.isArray(d.timeline)) {
    meas = d;
    measFile = path.relative(repo, p);
    break;
  }
}
if (meas === null) throw new Error(`${TAG}: measured_data が見つからない`);

const parseK = (t) => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t ?? "").replace(/[,\s]/g, ""));
  if (!m) return null;
  const n = Number(m[1]);
  const u = { "": 1, K: 1e3, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : Math.round(n * u);
};
const gran = (t) => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t ?? "").replace(/[,\s]/g, ""));
  if (!m) return null;
  const u = { "": 1, K: 1e3, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : u / 10;
};
const laneOf = (row, l) => {
  const L = row?.lanes;
  if (L === null || L === undefined) return null;
  return Array.isArray(L) ? (L[l - 1] ?? null) : (L[String(l)] ?? L[`lane${l}`] ?? null);
};
const merged = new Map();
for (const e of meas.timeline) {
  for (let l = 1; l <= 5; l++) {
    const g = laneOf(e, l)?.gained_score_pop;
    const t = typeof g === "string" ? g : (g?.text ?? null);
    if (parseK(t) !== null) merged.set(`${e.beat}:${l}`, String(t));
  }
}
const bfFile = path.join(nox, DIR, "lane_pops_backfill.json");
if (exists(bfFile)) {
  for (const x of J(bfFile).pops ?? []) {
    if (x.readable === false || parseK(x.displayed) === null) continue;
    const k = `${x.beat}:${x.lane}`;
    if (!merged.has(k)) merged.set(k, String(x.displayed));
  }
}
const sim = J(path.join(repo, "research", "23_beat_score_analysis", "phase16_action10_sim_cells_off.json"))
  .samples[TAG].cells;
const laneTotalsRaw = meas.results?.scores_by_lane ?? meas.results?.lane_scores ?? null;
const laneTotal = Array.isArray(laneTotalsRaw)
  ? laneTotalsRaw[LANE - 1]
  : (laneTotalsRaw?.[String(LANE)] ?? laneTotalsRaw?.[`lane${LANE}`] ?? null);
let popSum = 0;
let truncMax = 0;
const cells = [];
for (const [k, t] of merged) {
  if (Number(k.split(":")[1]) !== LANE) continue;
  const pop = parseK(t) ?? 0;
  popSum += pop;
  truncMax += (gran(t) ?? 0) - 1;
  const s = sim[k] ?? null;
  cells.push({ beat: Number(k.split(":")[0]), popText: t, pop, sim: s, diff: s === null ? null : s - pop });
}
const simHiddenCells = Object.entries(sim)
  .filter(([k]) => Number(k.split(":")[1]) === LANE && !merged.has(k))
  .map(([k, v]) => ({ cell: k, sim: v }));
const simLane = Object.entries(sim)
  .filter(([k]) => Number(k.split(":")[1]) === LANE)
  .reduce((a, [, v]) => a + v, 0);
const simHidden = simHiddenCells.reduce((a, c) => a + c.sim, 0);

console.log(`=== ${TAG} L${LANE}（${measFile}） ===`);
console.log(`  レーン合計 ${laneTotal?.toLocaleString?.() ?? laneTotal} / Σpop ${popSum.toLocaleString()} / 隠れ枠 ${(laneTotal - popSum).toLocaleString()}`);
console.log(`  sim レーン合計 ${simLane.toLocaleString()} / sim(不能セル) ${simHidden.toLocaleString()}（${simHiddenCells.length} セル）`);
console.log(`  可読セル ${cells.length} / 不能ビート ${170 - cells.length} / 切り捨て上界 ${truncMax.toLocaleString()}`);
console.log(`  可読比 = ${((simLane - simHidden) / popSum).toFixed(4)} / レーン比 = ${(simLane / laneTotal).toFixed(4)}`);
if (simHiddenCells.length > 0) {
  console.log(`  不能セル: ${simHiddenCells.map((c) => `${c.cell}=${c.sim.toLocaleString()}`).join(" ")}`);
}
const sorted = [...cells].sort((a, b) => (b.diff ?? -1e18) - (a.diff ?? -1e18));
console.log(`\n  --- diff = sim − pop 上位 ${TOP} ---`);
for (const r of sorted.slice(0, TOP)) {
  const row = meas.timeline.find((e) => e.beat === r.beat);
  const acts = (meas.skill_activations_summary ?? [])
    .filter((a) => a.beat === r.beat && a.lane === LANE)
    .map((a) => `${a.order}:${a.type}:${a.skill_name}`);
  const actsAll = (meas.skill_activations_summary ?? [])
    .filter((a) => a.beat === r.beat)
    .map((a) => `L${a.lane}:${a.type}`);
  console.log(
    `    b${String(r.beat).padStart(3)} pop ${String(r.popText).padStart(9)}(${String(r.pop).padStart(9)}) sim ${r.sim === null ? "  セルなし" : String(r.sim).padStart(11)} diff ${String(r.diff ?? "").padStart(10)}  act(L${LANE})=[${acts.join(",")}] actAll=[${actsAll.join(",")}] bgs=${row?.beat_gained_score}`,
  );
}
console.log(`\n  --- diff 下位 ${Math.min(TOP, 10)} ---`);
for (const r of sorted.slice(-Math.min(TOP, 10))) {
  console.log(
    `    b${String(r.beat).padStart(3)} pop ${String(r.popText).padStart(9)}(${String(r.pop).padStart(9)}) sim ${r.sim === null ? "  セルなし" : String(r.sim).padStart(11)} diff ${String(r.diff ?? "").padStart(10)}`,
  );
}
const pos = cells.filter((r) => (r.diff ?? 0) > 0).reduce((a, r) => a + r.diff, 0);
const neg = cells.filter((r) => (r.diff ?? 0) < 0).reduce((a, r) => a + r.diff, 0);
const excluded = cells.filter((r) => r.sim === null).reduce((a, r) => a + r.pop, 0);
console.log(
  `\n  Σ正の差 ${pos.toLocaleString()} / Σ負の差 ${neg.toLocaleString()} / Σ(sim セルなしの pop) ${excluded.toLocaleString()}`,
);
console.log(`  恒等式検査: Σdiff = ${(pos + neg).toLocaleString()} = sim(可読) − Σpop(sim セルあり) = ${((simLane - simHidden) - (popSum - excluded)).toLocaleString()}`);

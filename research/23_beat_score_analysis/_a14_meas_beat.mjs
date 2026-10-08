/** 実測の pop / 発動を 1 ビートぶん表示（S2 の lanes が object の場合にも対応）
 *   node research/23_beat_score_analysis/_a14_meas_beat.mjs S2 90 10
 */
import fs from "node:fs";
import path from "node:path";

const repo = process.cwd();
const nox = path.resolve(repo, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const argv = process.argv.slice(2);
const TAG = (argv[0] ?? "S2").toUpperCase();
const beats = argv.slice(1).map(Number);
const DIR = { S1: "サンプル1", S2: "サンプル2", S3: "サンプル3" }[TAG];
const cands = ["measured_data_v3.json", "measured_data_v2.json"].map((f) => path.join(nox, DIR, f));
let meas = null;
let file = null;
for (const p of cands) {
  if (!fs.existsSync(p)) continue;
  const d = J(p);
  if (Array.isArray(d.timeline)) {
    meas = d;
    file = path.relative(repo, p);
    break;
  }
}
const laneOf = (row, l) => {
  const L = row?.lanes;
  if (L === null || L === undefined) return null;
  if (Array.isArray(L)) return L[l - 1] ?? null;
  return L[String(l)] ?? L[`lane${l}`] ?? null;
};
console.log(`${TAG} (${file}) / lanes の型: ${Array.isArray(meas.timeline[0]?.lanes) ? "array" : "object"}`);
const bf = path.join(nox, DIR, "lane_pops_backfill.json");
const bfMap = new Map();
if (fs.existsSync(bf)) {
  for (const x of J(bf).pops ?? []) bfMap.set(`${x.beat}:${x.lane}`, x);
}
for (const b of beats) {
  const row = meas.timeline.find((e) => e.beat === b);
  if (row === undefined) {
    console.log(`beat ${b}: 実測になし`);
    continue;
  }
  console.log(`\n=== ${TAG} b${b}: beat_gained_score ${row.beat_gained_score?.toLocaleString?.() ?? row.beat_gained_score} ===`);
  for (let l = 1; l <= 5; l++) {
    const pop = laneOf(row, l)?.gained_score_pop ?? null;
    const t = typeof pop === "string" ? pop : (pop?.text ?? null);
    const bfe = bfMap.get(`${b}:${l}`);
    console.log(
      `  L${l}: 内生 pop=${JSON.stringify(pop)} → ${t ?? "不能"} / backfill=${bfe === undefined ? "-" : `displayed=${bfe.displayed} readable=${bfe.readable ?? "?"} note=${bfe.note ?? ""}`}`,
    );
  }
  const acts = (meas.skill_activations_summary ?? []).filter((a) => a.beat === b);
  console.log(`  acts: ${JSON.stringify(acts)}`);
}

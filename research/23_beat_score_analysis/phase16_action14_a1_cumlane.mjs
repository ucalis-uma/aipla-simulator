/**
 * Phase 16 Action14 / A1 補助: S3 の per-lane 累積（lanes[n].cumulative_lane）を独立な証拠として使えるか
 *
 * - `cumulative_lane` が全レーン同値なら「フォーカスレーンの値のコピー」で使えない
 * - レーン別に独立な系列が取れるなら、レーン合計（results.scores_by_lane）を独立検証できる
 *
 * 実行: node research/23_beat_score_analysis/phase16_action14_a1_cumlane.mjs
 */
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(process.cwd());
const nox = path.resolve(repo, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const meas = J(path.join(nox, "サンプル3", "measured_data_v3.json"));
const lanesOf = (row) => {
  const L = row?.lanes;
  if (L === null || L === undefined) return [null, null, null, null, null];
  if (Array.isArray(L)) return [1, 2, 3, 4, 5].map((l) => L[l - 1] ?? null);
  return [1, 2, 3, 4, 5].map((l) => L[String(l)] ?? null);
};

const out = [];
let multi = 0;
let same = 0;
const firstSeen = new Map(); // lane -> Map(cum -> beats)
for (const row of meas.timeline) {
  const ls = lanesOf(row);
  const cums = ls.map((x) => x?.cumulative_lane ?? null);
  const distinct = [...new Set(cums.filter((v) => v !== null))];
  if (distinct.length > 1) multi++;
  else same++;
  for (let l = 1; l <= 5; l++) {
    const c = cums[l - 1];
    if (c === null) continue;
    const m = firstSeen.get(l) ?? new Map();
    m.set(c, (m.get(c) ?? 0) + 1);
    firstSeen.set(l, m);
  }
  out.push({
    beat: row.beat,
    bgs: row.beat_gained_score ?? null,
    cumulative_score: row.cumulative_score ?? null,
    cums,
    combo_lane: ls.map((x) => x?.combo_lane ?? null),
    notes3: ls[2]?.note ?? null,
  });
}
const allCums = new Set(out.flatMap((r) => r.cums.filter((v) => v !== null)));
console.log(`beats=${out.length}  distinct-cums-in-row>1: ${multi} / ==1: ${same}`);
console.log(`distinct cumulative_lane values overall: ${allCums.size}`);
console.log("--- last 12 beats ---");
for (const r of out.slice(-12)) {
  console.log(
    `  b${r.beat}: cum=${r.cumulative_score} lanes=${JSON.stringify(r.cums)} bgs=${r.bgs} combo=${JSON.stringify(r.combo_lane)}`,
  );
}
console.log("--- rows where per-lane cum differs ---");
for (const r of out.filter((x) => new Set(x.cums.filter((v) => v !== null)).size > 1)) {
  console.log(`  b${r.beat}: ${JSON.stringify(r.cums)} (bgs ${r.bgs}, cum ${r.cumulative_score})`);
}
/* レーン別に「そのレーンのカードが映っているフレームで読んだ累積」が作れるか:
   lanes[n].cumulative_lane がレーンごとに別の数列を持つなら、レーン別系列として使える。
   ここでは各レーンの値の最大値（終端 = 最終累積）を見る。 */
console.log("--- per-lane max cumulative_lane ---");
for (const [l, m] of [...firstSeen.entries()].sort((a, b) => a[0] - b[0])) {
  const vals = [...m.keys()].sort((a, b) => a - b);
  console.log(`  L${l}: n=${vals.length} max=${vals[vals.length - 1]} min=${vals[0]}`);
}
console.log("--- results.scores_by_lane ---");
console.log(JSON.stringify(meas.results.scores_by_lane));
console.log("--- results.counts_note ---");
console.log(JSON.stringify(meas.results.counts_note));
console.log("--- v2_meta / v1_meta ---");
console.log(JSON.stringify(meas.v2_meta).slice(0, 900));

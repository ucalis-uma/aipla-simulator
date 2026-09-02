import { readFileSync } from "node:fs";
const repo = "C:/Users/umaro/Documents/アイプラ";
const tr = JSON.parse(readFileSync(repo + "/research/17_sample1_gap_analysis/sim_trace_full.json", "utf-8"));
const m = JSON.parse(readFileSync("C:/Users/umaro/Documents/aipura_nox/サンプル1/measured_data_v2.json", "utf-8"));
const tl = {};
for (const t of m.timeline) tl[t.beat] = t;
for (const b of [25, 40, 51, 66, 97, 104, 115, 123, 130, 143, 148, 156, 170, 176]) {
  const bt = tr.beats.find((x) => x.beat === b);
  if (!bt) continue;
  let sim = 0;
  for (const e of bt.events) sim += e.gainedScore;
  const meas = tl[b].beat_gained_score;
  console.log(`b${b} sim=${sim.toLocaleString()} meas=${meas.toLocaleString()} req=${(meas / sim).toFixed(3)}`);
}

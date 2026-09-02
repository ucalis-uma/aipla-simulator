import { readFileSync } from "node:fs";
const tr = JSON.parse(readFileSync("C:/Users/umaro/Documents/アイプラ/research/17_sample1_gap_analysis/sim_trace_full.json", "utf-8"));
// 活性化トレース（発動記録）からテンション付与を探す
console.log(typeof tr, Object.keys(tr).slice(0, 20));

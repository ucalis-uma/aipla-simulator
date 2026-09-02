import { readFileSync } from "node:fs";
const repo = "C:/Users/umaro/Documents/アイプラ";
const tr = JSON.parse(readFileSync(repo + "/research/17_sample1_gap_analysis/sim_trace_full.json", "utf-8"));
// L3 (lane 3) のみの累積を b142 まで求める
let lane3cum = 0;
for (const bt of tr.beats) {
  if (bt.beat >= 143) break;
  for (const e of bt.events) {
    if (e.lane === 3) lane3cum += e.gainedScore;
  }
}
console.log("sim L3-only cumulative up to b142:", lane3cum.toLocaleString());
// それを使った ratio 行: 14% × lane3cum × b1 × critF
const basic = Math.floor((lane3cum * 140) / 1000);
const b1 = 1577, critF = 2081;
const ratioRow = Math.floor((basic * b1 * critF) / 1e6 * 1000) * 1000; // 概算
console.log("ratio basic:", basic.toLocaleString());
console.log("ratio row (×b1×crit):", Math.floor(basic * b1 / 1000 * critF / 1000).toLocaleString());
// score_get 行も再掲
const sg = Math.floor(402390 * 17 * 1577 / 1000 * 1570 / 1000 * 1052 / 1000 * critF / 1000);
console.log("score_get row:", sg.toLocaleString());
console.log("SP total:", (sg + Math.floor(basic * b1 / 1000 * critF / 1000)).toLocaleString(), "vs meas 51,566,931");

import { readFileSync } from "node:fs";
const repo = "C:/Users/umaro/Documents/アイプラ";
const meas = JSON.parse(readFileSync(repo + "/tests/golden/fixtures/t5_measured.json", "utf-8"));
// b103 の実測 total
const row = meas.timeline.find((t) => t.beat === 103);
console.log("b103 measured gained:", row.gained, "cum:", row.cumulative);
// score_get 行（新エンジン・フィクスチャ乱数）の値をトレースから
const tr = JSON.parse(readFileSync(repo + "/research/17_sample1_gap_analysis/sim_trace_full.json", "utf-8"));
// 注: sim_trace_full は S1。T5 は t5_trace を別実行で得る（ここでは計算のみ）
// 必要 ratio 行
const scoreGet = 5375865594; // t5_trace 直前の値
const need = row.gained - scoreGet;
console.log("score_get:", scoreGet, "ratioが必要:", need);
const b1 = 3022, critF = 4651;
// 乱数が 1000 のときの basic:
const basicNeed = need / (b1 / 1000) / (critF / 1000);
console.log("ratio basic needed:", basicNeed.toFixed(0));
console.log("basis needed (÷12%):", (basicNeed / 0.12).toFixed(0));
// 比較用
console.log("L3-lane-cum (新basis): 346,111,935 | 旧comment: 4,445,607,475 | 旧global: 9,932,706,191");
console.log("ratio vs: 346,111,935→41.5M | 4,445,607,475→533M | 9,932,706,191→1,191.9M");

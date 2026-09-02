import { readFileSync } from "node:fs";
const repo = "C:/Users/umaro/Documents/アイプラ";
const trS1 = JSON.parse(readFileSync(repo + "/research/17_sample1_gap_analysis/sim_trace_full.json", "utf-8"));
const tlS1 = {};
const mS1 = JSON.parse(readFileSync("C:/Users/umaro/Documents/aipura_nox/サンプル1/measured_data_v2.json", "utf-8"));
for (const t of mS1.timeline) tlS1[t.beat] = t;
// b143 の sim 再計算（新しい trace はまだないため直接計算）
// 基準（割合行時点の L3 累積）= スキル開始時点 25,595,432 + score_get 実額
const laneCumStart = 25595432;
const scoreGet = 37077911;
const ratioBasic = Math.floor(((laneCumStart + scoreGet) * 140) / 1000);
console.log("S1 ratio basic (inclusive):", ratioBasic);
// ratio row: basic × b1(1577) × critF(2081 or 1000)
for (const critF of [2081, 1000]) {
  const ratioRow = Math.floor((ratioBasic * 1577 * critF) / 1e6);
  const total = scoreGet + ratioRow;
  console.log(`  S1 critF=${critF}: ratio=${ratioRow.toLocaleString()} total=${total.toLocaleString()} vs 51,566,931 → x${(total / 51566931).toFixed(4)}`);
}
// T5 b103 (inclusive): 346,111,935 + score_get 5,375,865,594
const t5LaneCum = 346111935;
const t5ScoreGet = 5375865594;
const t5Basic = Math.floor(((t5LaneCum + t5ScoreGet) * 120) / 1000);
console.log("T5 ratio basic (inclusive):", t5Basic.toLocaleString());
for (const critF of [4651, 1000]) {
  const ratioRow = Math.floor((t5Basic * 3022 * critF) / 1e6);
  const total = t5ScoreGet + ratioRow;
  console.log(`  T5 critF=${critF}: ratio=${ratioRow.toLocaleString()} total=${total.toLocaleString()} vs 15,145,715,433 → x${(total / 15145715433).toFixed(4)}`);
}

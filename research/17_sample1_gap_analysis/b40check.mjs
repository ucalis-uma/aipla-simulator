import { readFileSync } from "node:fs";
// b40/97/130: 千紗ビームの own-csu が B2 に乗るか判別する
// sim の各イベントの B2 と、想定（own-csu 6段あり/なし）を比較
const tr = JSON.parse(readFileSync("C:/Users/umaro/Documents/アイプラ/research/17_sample1_gap_analysis/sim_trace_full.json", "utf-8"));
for (const b of [40, 97, 130]) {
  const bt = tr.beats.find((x) => x.beat === b);
  console.log("=== b" + b);
  for (const e of bt.events) {
    console.log(`  L${e.lane} ${e.sourceKind} basic=${e.basicScore} power=${e.skillPowerPermil} b1=${e.b1Permil} combo=${e.comboFactorPermil} fan=${e.fanFactorPermil} crit=${e.critFactorPermil} gain=${e.gainedScore}`);
  }
}

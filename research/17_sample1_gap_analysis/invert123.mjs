import { readFileSync } from "node:fs";
// b123 / b176 の逆算（sim がオーバーしている方）
// b123: sim 2,090,240 vs 1,843,767 (0.882) / b176: sim 5,203,695 vs 4,698,967 (0.903)
const rows = [
  { b: 123, basic: 296208, power: 3600, b1: 1286, combo: 1250, fan: 1001, critF: 1000, meas: 1843767 },
  { b: 176, basic: 296208, power: 3600, b1: 1286, combo: 1650, fan: 1001, critF: 1886, meas: 4698967 },
];
for (const r of rows) {
  const baseModel = (r.basic * r.power * r.b1 * r.combo * r.fan * r.critF) / Math.pow(1000, 5);
  console.log(`b${r.b}: model=${baseModel.toLocaleString()} vs ${r.meas.toLocaleString()} → x${(baseModel / r.meas).toFixed(4)}`);
  // b1 の逆算（他を固定）
  const b1needed = r.meas * Math.pow(1000, 4) / (r.basic * r.power * r.combo * r.fan * r.critF);
  console.log(`   b1 needed=${b1needed.toFixed(0)} (sim 1286)`);
}

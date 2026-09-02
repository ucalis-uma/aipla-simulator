import { readFileSync } from "node:fs";
// b40 / b97 / b130 の sim 因子と、実測を満たす B2 を逆算
const rows = [
  { b: 40, basic: 112347, power: 4400, b1: 1177, fan: 1002, critF: 1854, meas: 1448648 },
  { b: 97, basic: 91712, power: 4400, b1: 1177, fan: 1001, critF: 1000, meas: 767562 },
  { b: 130, basic: 112347, power: 4400, b1: 1177, fan: 1001, critF: 1854, meas: 1608860 },
];
for (const r of rows) {
  const baseModel = (r.basic * r.power * r.b1 * r.fan) / Math.pow(1000, 3);
  const b2crit = r.meas / baseModel;
  const B2 = (b2crit * 1000) / r.critF;
  console.log(`b${r.b}: baseModel=${baseModel.toFixed(0)} needed B2×critF=${b2crit.toFixed(2)} → B2=${B2.toFixed(2)}`);
}
// 候補 B2 ルール検証: B2 = 1000 + base×(1+0.1×csu)/1000
// combo 40 → base 200, 41 → 200, 74 → 300
for (const [b, combo, csu0] of [[40, 40, 0], [97, 41, 0], [130, 74, 0]]) {
  const base = combo >= 100 ? 500 : combo >= 70 ? 300 : combo >= 50 ? 250 : combo >= 40 ? 200 : combo >= 30 ? 150 : combo >= 20 ? 100 : combo >= 10 ? 50 : 0;
  for (const csu of [0, 3, 6, 7]) {
    console.log(`  b${b} combo=${combo} base=${base} csu=${csu} → B2=${(1000 + base * (1 + 0.1 * csu) * (1.0)).toFixed(1)}`);
    break;
  }
}

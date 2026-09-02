import { readFileSync } from "node:fs";
// 割合行の「実測必要倍率」を逆算（S1: 51,566,931 → score_get(crit) = 37,077,911）
const S1meas = 51566931;
const S1sg = 37077911;
const S1ratioNeed = S1meas - S1sg;
const S1basic = Math.floor((62545532 * 140) / 1000); // 62,545,532? 下で正確に
console.log("S1 ratio need:", S1ratioNeed);
// inclusive basis = laneCum + score_get
const laneCum = 25595432;
const inclusive = laneCum + S1sg;
const basic = Math.floor((inclusive * 140) / 1000);
console.log("inclusive basis:", inclusive, "basic:", basic);
console.log("required multiplier:", (S1ratioNeed / basic).toFixed(4));
// 必要な (B1×critF)
for (const b1 of [1577, 1000, 1500]) {
  const cr = S1ratioNeed / basic / (b1 / 1000);
  console.log(`B1=${b1} → critF=${cr.toFixed(1)}‰`);
}
// T5 側も同様（検算用）
const T5sg = 5375865594;
const T5meas = 15145715433 - T5sg; // ratio need
const T5basis = 346111935 + T5sg;
const T5basic = Math.floor((T5basis * 120) / 1000);
console.log("T5: need:", T5meas, "basic:", T5basic, "required mult:", (T5meas / T5basic).toFixed(4));
for (const b1 of [3022, 1000]) {
  const cr = T5meas / T5basic / (b1 / 1000);
  console.log(`  T5 B1=${b1} → critF=${cr.toFixed(1)}‰`);
}

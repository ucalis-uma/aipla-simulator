import { readFileSync } from "node:fs";
// score_get = basic × power‰ × B1‰ × B2‰ × fan‰ × critF‰ ÷ 1000^5
function scoreGet(d, critYes) {
  return Math.floor((d.basic * d.power * d.B1 * d.B2 * d.fan * (critYes ? d.critF : 1000)) / Math.pow(1000, 5));
}
function ratio(d, basisMode, critYes) {
  const sg = scoreGet(d, true);
  const basis = basisMode === "inclusive" ? d.laneCum + sg : d.laneCum;
  const basicR = Math.floor((basis * d.pct * 1000) / 1000);
  return Math.floor((basicR * d.B1 * (critYes ? d.critF : 1000)) / Math.pow(1000, 2));
}
const T = {
  basic: 2348336, power: 34540, B1: 3022, B2: 2800, fan: 1768, critF: 4651, pct: 0.12,
  laneCum: 346111935, measured: 15145715433,
};
const S = {
  basic: 402390, power: 17000, B1: 1577, B2: 1570, fan: 1052, critF: 2081, pct: 0.14,
  laneCum: 25595432, measured: 51566931,
};
for (const basisMode of ["before", "inclusive"]) {
  for (const critRatio of [true, false]) {
    const t = scoreGet(T, true) + ratio(T, basisMode, critRatio);
    const s = scoreGet(S, true) + ratio(S, basisMode, critRatio);
    console.log(`basis=${basisMode} ratioCrit=${critRatio}: T5=${t.toLocaleString()} (${(t / T.measured).toFixed(4)}) | S1=${s.toLocaleString()} (${(s / S.measured).toFixed(4)})`);
  }
}

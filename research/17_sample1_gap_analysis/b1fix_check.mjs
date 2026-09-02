import { readFileSync } from "node:fs";
// S1 b143: B1 = 1000 + 30×2 (SPスコア昇2段) + 0 (スコア上昇) + 0 (テンション) + 120 (yale SP 12%) + 97 (photo SP 9.7%)
const B1 = 1000 + 60 + 0 + 0 + 120 + 97; // 1277
const basic = 402390, power = 17000, B2 = 1570, fan = 1052, critF = 2081, pct = 0.14;
const laneCumBefore = 25595432;
const sg = Math.floor((basic * power * B1 * B2 * fan) / Math.pow(1000, 4)) * 1; // ‰×4: power,B1,B2,fan
const sgFull = Math.floor((basic * power * B1 * B2 * fan * critF) / Math.pow(1000, 5));
const basisIncl = laneCumBefore + sgFull;
const basicR = Math.floor((basisIncl * pct * 1000) / 1000);
const ratioRow = Math.floor((basicR * B1 * critF) / Math.pow(1000, 2));
const total = sgFull + ratioRow;
console.log(`B1=${B1} score_get=${sgFull.toLocaleString()} basis=${basisIncl.toLocaleString()} ratioBasic=${basicR.toLocaleString()} ratio=${ratioRow.toLocaleString()} total=${total.toLocaleString()} vs 51,566,931 → x${(total / 51566931).toFixed(4)}`);

// 補足: B1=1577（engine）の場合を再掲
const B1b = 1577;
const sgb = Math.floor((basic * power * B1b * B2 * fan * critF) / Math.pow(1000, 5));
const basb = laneCumBefore + sgb;
const rbb = Math.floor((basb * pct * 1000) / 1000);
const rr = Math.floor((rbb * B1b * critF) / Math.pow(1000, 2));
console.log(`(参考 B1=1577) score_get=${sgb.toLocaleString()} total=${(sgb + rr).toLocaleString()} → x${((sgb + rr) / 51566931).toFixed(4)}`);

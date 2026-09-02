import { readFileSync } from "node:fs";
// S1 残5イベントの規則グリッド探索
// 各イベント: basic / power / b1Base(1000+70+107=1177 or 1286) / comboDisplay / csu / critF / meas
// 候補ルール: B1={1177,1286}, B2-csu={none, ownGrant6}, combo±1={-1,0,+1}
const rows = [
  { b: 40, basic: 112347, power: 4400, b1Base: 1177, combo: 40, csuSelf: 0, csuState: 0, crit: 1854, meas: 1448648 },
  { b: 97, basic: 91712, power: 4400, b1Base: 1177, combo: 41, csuSelf: 0, csuState: 0, crit: 1000, meas: 767562 },
  { b: 130, basic: 112347, power: 4400, b1Base: 1177, combo: 74, csuSelf: 0, csuState: 0, crit: 1854, meas: 1608860 },
  { b: 123, basic: 360835, power: 3600, b1Base: 1286, combo: 67, csuSelf: 0, csuState: 0, crit: 1000, meas: 1843767 },
  { b: 176, basic: 360835, power: 3600, b1Base: 1286, combo: 120, csuSelf: 0, csuState: 3, crit: 1886, meas: 4698967 },
];
const TABLE = (c) => c >= 100 ? 500 : c >= 70 ? 300 : c >= 50 ? 250 : c >= 40 ? 200 : c >= 30 ? 150 : c >= 20 ? 100 : c >= 10 ? 50 : 0;
const B2 = (combo, csu) => 1000 + TABLE(combo) * (1 + 0.1 * csu);
const results = [];
for (const b1Extra of [0, 109]) {
  for (const csuOwn of [0, 6]) { // 千紗 own 6段分が同ビートの B2 に乗るか
    for (const cd of [-1, 0, 1]) {
      let ok = 0, vals = [];
      for (const r of rows) {
        const b1 = b1Extra === 0 ? 1177 : 1286;
        const combo = r.combo + cd;
        const csu = r.csuState + (r.b === 40 || r.b === 97 || r.b === 130 ? csuOwn : 0);
        const model = (r.basic * r.power * b1 * B2(combo, csu) * 1001 * r.crit) / 1e12;
        const rand = r.meas / model;
        const inRange = rand >= 0.95 && rand <= 1.05;
        if (inRange) { ok++; vals.push(`${r.b}:${rand.toFixed(3)}`); }
      }
      results.push({ b1Extra, csuOwn, cd, ok, vals: vals.join(" ") });
    }
  }
}
results.sort((a, b) => b.ok - a.ok);
for (const r of results.slice(0, 6)) console.log(`ok=${r.ok}/5 b1+${r.b1Extra} csuOwn=${r.csuOwn} cd=${r.cd} | ${r.vals}`);

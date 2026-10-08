/**
 * B2: γ 推定器の**原理的な分解能**を測る。
 *
 *   node research/23_beat_score_analysis/_b2_noise.mjs research/23_beat_score_analysis/_a13_cells_s2_legacy.json S2
 *
 * γ_b（ビート共通のノート乱数）を他レーンから除いても、**対象レーン自身のノート乱数**は残る。
 * その残差を「非 crit の beat セル」で実測し、段数換算の 1σ を出す:
 *     q_{l,b} = (pop_{l,b} / sim_{l,b}) / μ_l      （真値 1。乱数 ±5% と pop 切り捨てを含む）
 *     段数換算 1σ ≈ sd(q) × crit_sim / 50
 * これが 5〜13 段程度なら単セルでは 0/5/13 を分離できない（＝B2 の【Unknown】の定量的根拠）。
 */
import fs from "node:fs";
const p = process.argv[2];
const id = process.argv[3] ?? "S2";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const s = j.samples[id];
const mu = s.muByLane;
const perLane = new Map();
const cellRows = [];
for (const c of s.cells) {
  const ev = c.sim.events.length === 1 ? c.sim.events[0] : null;
  if (ev === null) continue;
  if (c.meas.pop === null || c.meas.pop === undefined) continue;
  const m = mu[String(c.lane)];
  if (m === null || m === undefined || m === 0) continue;
  const q = c.meas.pop / ev.score / m;
  cellRows.push({
    beat: c.beat,
    lane: c.lane,
    crit: ev.crit,
    critSim: ev.crit,
    score: ev.score,
    pop: c.meas.pop,
    q,
    kind: ev.kind,
    stages: c.sim.snap?.critical_coeff_up ?? null,
  });
  if (ev.crit !== 1000) continue; // 非 crit セルだけ＝乱数の素の分布
  const a = perLane.get(c.lane) ?? [];
  a.push(q);
  perLane.set(c.lane, a);
}
const stats = (a) => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1));
  return { n: a.length, mean: m, sd };
};
console.log(`=== ${id}: 非 crit beat セルの q = (pop/sim)/μ（真値 1）===`);
let maxSd = 0;
for (const [lane, a] of [...perLane.entries()].sort((x, y) => x[0] - y[0])) {
  const st = stats(a);
  maxSd = Math.max(maxSd, st.sd);
  console.log(
    `  L${lane}: n=${String(st.n).padStart(3)} 平均 ${st.mean.toFixed(4)} sd ${st.sd.toFixed(4)}` +
      `（±${(100 * st.sd).toFixed(2)}%）→ crit 2504 なら ±${((st.sd * 2504) / 50).toFixed(2)} 段・crit 1854 なら ±${((st.sd * 1854) / 50).toFixed(2)} 段`,
  );
}
/** ビート共通項を除いた後の残差（対象レーンの q を、そのビートの他レーン平均で割る） */
const byBeat = new Map();
for (const r of cellRows) {
  const a = byBeat.get(r.beat) ?? [];
  a.push(r);
  byBeat.set(r.beat, a);
}
const resid = new Map();
let bn = 0;
for (const [, arr] of byBeat) {
  const nonCrit = arr.filter((x) => x.crit === 1000);
  if (nonCrit.length < 3) continue;
  const g = nonCrit.reduce((a, x) => a + x.q, 0) / nonCrit.length;
  for (const r of nonCrit) {
    const a2 = resid.get(r.lane) ?? [];
    a2.push(r.q / g); // ビート共通項を除去した残差（真値 1）
    resid.set(r.lane, a2);
    bn++;
  }
}
console.log(`\n=== ビート共通項（他レーン平均）を除いた残差 q_l,b / γ_b（n=${bn}）===`);
for (const [lane, a] of [...resid.entries()].sort((x, y) => x[0] - y[0])) {
  const st = stats(a);
  console.log(
    `  L${lane}: n=${String(st.n).padStart(3)} sd ${st.sd.toFixed(4)}（±${(100 * st.sd).toFixed(2)}%）` +
      ` → crit 2504 で ±${((st.sd * 2504) / 50).toFixed(2)} 段`,
  );
}
/** b95/b97 の実測 q と、仮説ごとの期待値 */
console.log("\n=== b95–100（孤立窓）の対象セル: 仮説別の期待 q ===");
for (const r of cellRows.filter((x) => x.beat >= 94 && x.beat <= 101)) {
  console.log(
    `  b${r.beat} L${r.lane} kind=${r.kind} sim段=${r.stages} critSim=${r.critSim} pop=${r.pop} sim=${r.score} q=${r.q.toFixed(4)}` +
      `（sim の critF=1854 前提。実機 13段なら期待 q≈${(2504 / 1854).toFixed(3)}・5段なら ${(2104 / 1854).toFixed(3)}・0段なら 1.000）`,
  );
}

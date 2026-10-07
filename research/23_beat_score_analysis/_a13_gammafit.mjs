/**
 * A13: 「ビート共通のノート乱数 γ_b」を他レーンの pop から推定して、
 * 対象レーンの crit 段数を 1 セル単位で逆算する（乱数除去つき推定器）。
 *
 *   pop_l/S_l = γ_b · o_l · (crit_machine/crit_sim)   （crit セル）
 *   pop_l/S_l = γ_b · o_l                              （非 crit セル）
 *   μ_l = 全曲の非 crit セルの pop/sim 平均 = o_l · γ̄
 *   q_l,b = (pop_l,b/S_l,b)/μ_l
 *   γ_b/γ̄ = mean_{l ≠ target, 非crit}(q_l,b)
 *   → crit_machine/crit_sim = q_target,b / (γ_b/γ̄)
 *
 * 使い方: node _a13_gammafit.mjs <cells.json> <S1|S2|S3> <lane> [key]
 */
import fs from "node:fs";
const p = process.argv[2];
const id = process.argv[3] ?? "S2";
const target = Number(process.argv[4] ?? 3);
const key = process.argv[5] ?? "critical_coeff_up";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const s = j.samples[id];
const extras = s.laneInfo[target - 1].critExtras ?? 0;
const mu = s.muByLane;
const byBeat = new Map();
for (const c of s.cells) {
  const ev = c.sim.events.length === 1 ? c.sim.events[0] : null;
  const arr = byBeat.get(c.beat) ?? [];
  arr.push({ lane: c.lane, crit: ev?.crit ?? null, kind: ev?.kind ?? null, sim: ev?.score ?? 0, pop: c.meas.pop ?? null, cell: c });
  byBeat.set(c.beat, arr);
}
const rows = [];
for (const [beat, arr] of [...byBeat.entries()].sort((a, b) => a[0] - b[0])) {
  const others = arr.filter((x) => x.lane !== target && x.crit === 1000 && x.pop !== null && mu[String(x.lane)] !== null);
  const gamma = others.length >= 2 ? others.reduce((a, x) => a + (x.pop / x.sim) / mu[String(x.lane)], 0) / others.length : null;
  const t = arr.find((x) => x.lane === target);
  if (t === undefined || t.pop === null || t.crit === null || t.crit === 1000 || t.kind !== "beat" || gamma === null) continue;
  const q = (t.pop / t.sim) / mu[String(target)];
  const critMachine = t.crit * q / gamma;
  rows.push({
    beat, simCrit: t.crit, gamma: Number(gamma.toFixed(4)), q: Number(q.toFixed(4)),
    critMachine: Number(critMachine.toFixed(1)), stages: Number(((critMachine - 1500 - extras) / 50).toFixed(2)),
    simStages: t.cell.sim.snap?.[key] ?? 0, n: others.length,
    meas: JSON.stringify(t.cell.meas.rows),
  });
}
let win = null;
const wins = [];
for (const r of rows) {
  if (win === null || r.beat !== win.to + 1 || r.simStages !== win.simStages) { win = { from: r.beat, to: r.beat, simStages: r.simStages, rs: [] }; wins.push(win); }
  win.to = r.beat; win.rs.push(r);
}
console.log(`${id} L${target} key=${key} extras=${extras} μ=${JSON.stringify(mu)}`);
console.log("beat  sim段 実機行                                               γ    q    推定crit 推定段数 他レーンn");
for (const r of rows) console.log(`${String(r.beat).padStart(4)} ${String(r.simStages).padStart(5)} ${r.meas.slice(0, 62).padEnd(62)} ${r.gamma.toFixed(3)} ${r.q.toFixed(3)} ${String(r.critMachine).padStart(8)} ${String(r.stages).padStart(8)} ${r.n}`);
console.log("\n窓ごとの平均（sim段 → 推定段数）");
for (const w of wins) {
  const m = w.rs.reduce((a, r) => a + r.stages, 0) / w.rs.length;
  const sd = Math.sqrt(w.rs.reduce((a, r) => a + (r.stages - m) ** 2, 0) / Math.max(1, w.rs.length - 1));
  console.log(`b${String(w.from).padStart(3)}-${String(w.to).padStart(3)} sim=${w.simStages} n=${String(w.rs.length).padStart(2)} 平均=${m.toFixed(2)} sd=${Number.isFinite(sd) ? sd.toFixed(2) : "-"} SE=${(sd / Math.sqrt(w.rs.length)).toFixed(2)}`);
}

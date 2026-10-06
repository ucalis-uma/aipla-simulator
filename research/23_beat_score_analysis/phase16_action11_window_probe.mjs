/** Phase 16 Action11 出発点: S2 の act なしセルの sim/pop 比をビート順に並べる（ライボ 45 ビート窓の有無を目視する用）。 */
import fs from "node:fs";

const MEAS = "C:/Users/umaro/Documents/aipura_nox/サンプル2/measured_data_v3.json";
const BACKFILL = "C:/Users/umaro/Documents/aipura_nox/サンプル2/lane_pops_backfill.json";
const SIM = "research/23_beat_score_analysis/phase16_action11_sim_cells_s2_legacy.json";

const meas = JSON.parse(fs.readFileSync(MEAS, "utf8"));
const sim = JSON.parse(fs.readFileSync(SIM, "utf8")).samples.S2;
const bf = JSON.parse(fs.readFileSync(BACKFILL, "utf8"));

function parseK(text) {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(text ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const unit = { "": 1, K: 1000, M: 1e6, G: 1e9 };
  const u = unit[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : Math.round(Number(m[1]) * u);
}
const pop = new Map();
for (const x of bf.pops ?? []) {
  if (typeof x?.beat !== "number" || typeof x?.lane !== "number" || x.readable === false) continue;
  const v = parseK(x.displayed);
  if (v !== null) pop.set(`${x.beat}:${x.lane}`, v);
}
const actCells = new Set();
for (const a of meas.skill_activations_summary ?? []) actCells.add(`${a.beat}:${a.lane}`);

for (const lane of [1, 2, 3, 4, 5]) {
  const rows = [];
  const win = [];
  for (let b = 1; b <= 168; b++) {
    const k = `${b}:${lane}`;
    const p = pop.get(k);
    if (p === undefined || actCells.has(k)) continue;
    const s = sim.cells[k] ?? 0;
    if (p < 3000) continue; // 小セルは丸め誤差が大きいので除外
    const r = s / p;
    win.push({ b, r });
    rows.push(`b${b}:${r.toFixed(2)}`);
  }
  console.log(`\n■ L${lane}（act なしセルのみ・pop≥3K）n=${win.length}`);
  console.log("  " + rows.join(" "));
  // 45 ビート窓で最も低い平均比を探す
  let best = { start: 0, avg: 9 };
  for (let st = 1; st + 44 <= 168; st++) {
    const inWin = win.filter((x) => x.b >= st && x.b <= st + 44);
    if (inWin.length < 8) continue;
    const avg = inWin.reduce((a, x) => a + x.r, 0) / inWin.length;
    if (avg < best.avg) best = { start: st, avg };
  }
  const outside = win.filter((x) => !(x.b >= best.start && x.b <= best.start + 44));
  const outAvg = outside.length === 0 ? NaN : outside.reduce((a, x) => a + x.r, 0) / outside.length;
  console.log(
    `  最悪 45 ビート窓: b${best.start}〜b${best.start + 44} 平均比 ${best.avg.toFixed(3)}（窓外 ${outAvg.toFixed(3)}・n=${outside.length}）`,
  );
}

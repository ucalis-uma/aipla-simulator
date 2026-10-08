/**
 * Phase 16 Action14 / A1 補助3: S3 L3 の「pop と sim の差」全セル台帳
 *   - diff = sim − pop（正 = pop が sim より小さい = pop に載っていない得点がある可能性）
 *   - 隠れ枠 2,635,445 の内訳を「b2 の A スコア」「不能セル」「K 切り捨て」に分解する
 *
 * 実行: node research/23_beat_score_analysis/phase16_action14_a1_l3_ledger.mjs
 */
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(process.cwd());
const nox = path.resolve(repo, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const meas = J(path.join(nox, "サンプル3", "measured_data_v3.json"));
const bf = J(path.join(nox, "サンプル3", "lane_pops_backfill.json"));
const sim = J(
  path.join(repo, "research", "23_beat_score_analysis", "phase16_action10_sim_cells_off.json"),
).samples.S3.cells;
const parseK = (t) => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t ?? "").replace(/[,\s]/g, ""));
  if (!m) return null;
  const n = Number(m[1]);
  const u = { "": 1, K: 1e3, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : Math.round(n * u);
};
const laneOf = (row, l) => {
  const L = row?.lanes;
  if (L === null || L === undefined) return null;
  return Array.isArray(L) ? (L[l - 1] ?? null) : (L[String(l)] ?? L[`lane${l}`] ?? null);
};
const merged = new Map();
for (const e of meas.timeline) {
  for (let l = 1; l <= 5; l++) {
    const g = laneOf(e, l)?.gained_score_pop;
    const t = typeof g === "string" ? g : (g?.text ?? null);
    if (parseK(t) !== null) merged.set(`${e.beat}:${l}`, String(t));
  }
}
for (const x of bf.pops ?? []) {
  if (x.readable === false || parseK(x.displayed) === null) continue;
  const k = `${x.beat}:${x.lane}`;
  if (!merged.has(k)) merged.set(k, String(x.displayed));
}
const L = 3;
const laneTotal = meas.results.scores_by_lane["3"];
const mergedL = [...merged.entries()].filter(([k]) => Number(k.split(":")[1]) === L);
const popSum = mergedL.reduce((a, [, t]) => a + (parseK(t) ?? 0), 0);
const simL = Object.entries(sim).filter(([k]) => Number(k.split(":")[1]) === L);
const simSum = simL.reduce((a, [, v]) => a + v, 0);
const simRead = simL.filter(([k]) => merged.has(k)).reduce((a, [, v]) => a + v, 0);
const simHidden = simSum - simRead;

console.log(`S3 L3: 実測レーン合計 ${laneTotal.toLocaleString()} / Σpop ${popSum.toLocaleString()} / 隠れ枠 ${(laneTotal - popSum).toLocaleString()}`);
console.log(`        sim セル ${simL.length} 個 / sim 合計 ${simSum.toLocaleString()} / sim(可読) ${simRead.toLocaleString()} / sim(不能) ${simHidden.toLocaleString()}`);
console.log(`        pop 可読セル ${mergedL.length} / 不能ビート ${170 - mergedL.length}`);

const rows = [];
for (const [k, t] of mergedL) {
  const pop = parseK(t) ?? 0;
  const s = sim[k] ?? null;
  rows.push({ beat: Number(k.split(":")[0]), pop, popText: t, sim: s, diff: s === null ? null : s - pop });
}
rows.sort((a, b) => (b.diff ?? -1e18) - (a.diff ?? -1e18));
console.log("\n--- L3 可読セル: diff = sim − pop（上位 20・truncation を超えるもの） ---");
for (const r of rows.slice(0, 20)) {
  console.log(
    `  b${String(r.beat).padStart(3)} pop ${String(r.popText).padStart(9)} (${String(r.pop).padStart(9)}) sim ${r.sim === null ? "セルなし" : String(r.sim).padStart(11)} diff ${r.diff === null ? "" : r.diff.toLocaleString()}`,
  );
}
console.log("\n--- L3 可読セル: diff 下位 12（sim が pop より小さい） ---");
for (const r of rows.slice(-12)) {
  console.log(
    `  b${String(r.beat).padStart(3)} pop ${String(r.popText).padStart(9)} (${String(r.pop).padStart(9)}) sim ${r.sim === null ? "セルなし" : String(r.sim).padStart(11)} diff ${r.diff === null ? "" : r.diff.toLocaleString()}`,
  );
}
const bigPos = rows.filter((r) => r.diff !== null && r.diff > 200000);
console.log(`\ndiff > 200,000 のセル: ${bigPos.length} 件 / 合計 ${bigPos.reduce((a, r) => a + r.diff, 0).toLocaleString()}`);
for (const r of bigPos) {
  const row = meas.timeline.find((e) => e.beat === r.beat);
  console.log(
    `  b${r.beat} pop ${r.popText} sim ${r.sim.toLocaleString()} diff ${r.diff.toLocaleString()} act=${JSON.stringify(row?.skill_activations)} note=${JSON.stringify(laneOf(row, 3)?.note)}`,
  );
}
/* K 切り捨ての上限見積り: 表示の最終桁 */
const gran = (t) => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t).replace(/[,\s]/g, ""));
  if (!m) return null;
  const u = { "": 1, K: 1e3, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  const dec = (m[1].split(".")[1] ?? "").length;
  return u / 10 ** dec;
};
const truncMax = mergedL.reduce((a, [, t]) => a + ((gran(t) ?? 0) - 1), 0);
console.log(`\nK 切り捨ての最大損失見積り（Σ(表示粒度−1)）= ${truncMax.toLocaleString()}`);
console.log(`隠れ枠の内訳候補: 不能セル(L3 sim) ${simHidden.toLocaleString()} + b2 A スコア 2,109,487 + 切り捨て ≤ ${truncMax.toLocaleString()}`);
console.log(`  → 残差 = ${(laneTotal - popSum - simHidden - 2109487 - truncMax).toLocaleString()} 〜 ${(laneTotal - popSum - simHidden - 2109487).toLocaleString()}`);

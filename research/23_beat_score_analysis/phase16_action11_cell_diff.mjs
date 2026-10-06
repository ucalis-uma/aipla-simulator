/** Phase 16 Action11 出発点: S2 の cell 単位差分（sim − 実測pop）を出すだけの一時スクリプト。プロンプトの出発点を作る用。 */
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
  const unit = { "": 1, K: 1000, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return unit === undefined ? null : Math.round(Number(m[1]) * unit);
}

const pop = new Map();
for (const x of bf.pops ?? []) {
  if (typeof x?.beat !== "number" || typeof x?.lane !== "number") continue;
  if (x.readable === false) continue;
  const v = parseK(x.displayed);
  if (v === null) continue;
  pop.set(`${x.beat}:${x.lane}`, { v, text: x.displayed, src: "backfill" });
}
const laneRead = (row, l) => {
  const L = row?.lanes;
  if (L == null) return null;
  return Array.isArray(L) ? L[l - 1] : (L[String(l)] ?? L[`lane${l}`]);
};
for (const row of meas.timeline) {
  for (let l = 1; l <= 5; l++) {
    const g = laneRead(row, l)?.gained_score_pop;
    const t = typeof g === "string" ? g : g?.text;
    const v = parseK(t);
    if (v !== null && t != null) pop.set(`${row.beat}:${l}`, { v, text: String(t), src: "inline" });
  }
}
const acts = new Map();
for (const a of meas.skill_activations_summary ?? []) {
  const k = `${a.beat}:${a.lane}`;
  if (!acts.has(k)) acts.set(k, []);
  acts.get(k).push(a);
}
const fmt = (v) => Math.round(v).toLocaleString("en-US");

const totalMeas = meas.results.total_score;
console.log(`実測 total ${fmt(totalMeas)} / sim total ${fmt(sim.totalScore)} = ${(((sim.totalScore / totalMeas) - 1) * 100).toFixed(2)}%`);
console.log(`pop セル数 ${pop.size}（backfill ${[...pop.values()].filter((x) => x.src === "backfill").length}）`);

for (let l = 1; l <= 5; l++) {
  let popSum = 0;
  let simRead = 0;
  let simHidden = 0;
  let hiddenCells = 0;
  for (const [k, x] of pop) {
    if (Number(k.split(":")[1]) !== l) continue;
    popSum += x.v;
    simRead += sim.cells[k] ?? 0;
  }
  for (const [k, v] of Object.entries(sim.cells)) {
    if (Number(k.split(":")[1]) !== l) continue;
    if (!pop.has(k)) {
      simHidden += v;
      hiddenCells++;
    }
  }
  const laneTotal = meas.results.lane_scores?.[String(l)] ?? meas.results.lane_scores?.[`lane${l}`];
  console.log(
    `L${l}: レーン合計 ${fmt(laneTotal)} | Σpop ${fmt(popSum)} | sim(読込セル) ${fmt(simRead)} = ${(((simRead / popSum) - 1) * 100).toFixed(2)}% | ` +
      `差 ${fmt(popSum - simRead)} | sim(隠れセル) ${fmt(simHidden)}（${hiddenCells} セル）`,
  );
}

const rows = [];
for (const [k, x] of pop) {
  const s = sim.cells[k] ?? 0;
  rows.push({ k, pop: x.v, sim: s, d: s - x.v, text: x.text, acts: acts.get(k) ?? [] });
}
rows.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
console.log("\n■ 差分の大きいセル上位 25（読込セルのみ）");
for (const r of rows.slice(0, 25)) {
  const [b, l] = r.k.split(":");
  const actTxt = r.acts
    .map((a) => `${a.skill_type}:${a.skill_name}(Lv${a.skill_level}${a.is_fail ? "/FAIL" : ""}${a.is_critical ? "/crit" : ""},cost${a.stamina_cost})`)
    .join(" + ");
  console.log(
    `  b${b}×L${l}: sim ${fmt(r.sim)} / 実測pop ${fmt(r.pop)}（${r.text}）= 差 ${fmt(r.d)}${r.sim === 0 ? "  ★sim 0" : ""}` +
      (actTxt === "" ? "" : `\n        実測 act: ${actTxt}`),
  );
}

const missed = rows.filter((r) => r.sim === 0 && r.pop > 0);
console.log(`\n■ sim=0 かつ 実測pop>0 のセル: ${missed.length} 件 / 失点合計 ${fmt(missed.reduce((a, r) => a + r.pop, 0))}`);
for (const r of missed.slice(0, 15)) {
  const [b, l] = r.k.split(":");
  const actTxt = r.acts.map((a) => `${a.skill_type}:${a.skill_name}${a.is_fail ? "(FAIL)" : ""}${a.is_critical ? "(crit)" : ""}`).join(" + ");
  console.log(`  b${b}×L${l}: pop ${fmt(r.pop)}（${r.text}） 実測 act: ${actTxt || "(なし)"}`);
}
const over = rows.filter((r) => r.d > 0).reduce((a, r) => a + r.d, 0);
const under = rows.filter((r) => r.d < 0).reduce((a, r) => a + r.d, 0);
console.log(`\n■ 読込セルの合計: 過大 +${fmt(over)} / 過小 ${fmt(under)} / 純 ${fmt(over + under)}`);

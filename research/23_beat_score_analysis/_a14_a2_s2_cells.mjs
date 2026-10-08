/**
 * Phase 16 Action14 / A2: S2 縺ｮ A/SP 繧ｻ繝ｫ蜿ｰ蟶ｳ・・ind 蛻･ ﾃ・pop 遯∝粋 + ratio 逕溘ョ繝ｼ繧ｿ・・ *   node research/23_beat_score_analysis/_a14_a2_s2_cells.mjs
 */
import fs from "node:fs";
import path from "node:path";

const repo = process.cwd();
const nox = path.resolve(repo, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const parseK = (t) => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const u = { "": 1, K: 1e3, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : Math.round(Number(m[1]) * u);
};
const sim = J(path.join(repo, "research", "23_beat_score_analysis", "phase16_action14_a2_s2_events.json")).samples.S2;
const dir = path.join(nox, "繧ｵ繝ｳ繝励Ν2");
const meas = J(path.join(dir, "measured_data_v3.json"));
const popByCell = new Map();
for (const e of meas.timeline) {
  for (let l = 1; l <= 5; l++) {
    const g = (e.lanes ?? [])[l - 1]?.gained_score_pop;
    const t = typeof g === "string" ? g : (g?.text ?? null);
    if (parseK(t) !== null) popByCell.set(`${e.beat}:${l}`, String(t));
  }
}
const bf = path.join(dir, "lane_pops_backfill.json");
if (fs.existsSync(bf)) {
  for (const x of J(bf).pops ?? []) {
    if (x.readable === false || parseK(x.displayed) === null) continue;
    if (!popByCell.has(`${x.beat}:${x.lane}`)) popByCell.set(`${x.beat}:${x.lane}`, String(x.displayed));
  }
}
const rows = [];
for (const [k, evs] of Object.entries(sim.cellEvents ?? {})) {
  const total = evs.reduce((a, e) => a + e.gainedScore, 0);
  const kinds = {};
  for (const e of evs) kinds[e.sourceKind] = (kinds[e.sourceKind] ?? 0) + e.gainedScore;
  const popText = popByCell.get(k) ?? null;
  const pop = popText === null ? null : (parseK(popText) ?? 0);
  rows.push({ cell: k, total, kinds, popText, pop, diff: pop === null ? null : pop - total, evs });
}
const byKind = {};
for (const r of rows) {
  for (const [k, v] of Object.entries(r.kinds)) {
    byKind[k] ??= { n: 0, sim: 0, pop: 0, cells: 0 };
    byKind[k].n++;
    byKind[k].sim += v;
    if (r.pop !== null && r.kinds[k] === r.total) {
      byKind[k].cells++;
      byKind[k].pop += r.pop;
    }
  }
}
console.log("=== S2 kind 蛻･・・op 蜿ｯ隱ｭ繧ｻ繝ｫ縺ｮ縺ｿ遯∝粋・・===");
for (const [k, v] of Object.entries(byKind)) {
  console.log(`  ${k.padEnd(11)} 繧､繝吶Φ繝医そ繝ｫ ${String(v.n).padStart(3)} / 蜊倡峡繧ｻ繝ｫ ${String(v.cells).padStart(3)}: sim ${v.sim.toLocaleString()} / pop ${v.pop.toLocaleString()} / 蟾ｮ ${(v.pop - v.sim).toLocaleString()}`);
}
console.log("\n=== SP 繧ｻ繝ｫ・・pecial・・===");
for (const r of rows.filter((r) => r.kinds.SP !== undefined)) {
  console.log(`  ${r.cell}: sim ${r.total.toLocaleString()} / pop ${r.popText}(${r.pop?.toLocaleString() ?? "荳崎・"}) / 蟾ｮ ${r.diff?.toLocaleString() ?? "-"}`);
  for (const e of r.evs) {
    console.log(
      `    ${e.sourceKind} ${e.skillName ?? e.skillId} ratio=${e.isRatioScore} base=${e.ratioBaseCumScore?.toLocaleString() ?? "-"} power=${e.skillPowerPermil} basic=${e.basicScore?.toLocaleString() ?? "-"} combo=${e.comboFactorPermil} fan=${e.fanFactorPermil} crit=${e.critFactorPermil} gain=${e.gainedScore.toLocaleString()} cumAfter=${e.cumAfterEvent.toLocaleString()}`,
    );
  }
}
console.log("\n=== A 繧ｹ繧ｭ繝ｫ 繧ｻ繝ｫ・・ctive繝ｻ蟾ｮ縺ｮ邨ｶ蟇ｾ蛟､鬆・ｼ・===");
const act = rows.filter((r) => r.kinds.A !== undefined).sort((a, b) => Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0));
for (const r of act) {
  console.log(`  ${r.cell}: sim ${r.total.toLocaleString()} / pop ${r.popText}(${r.pop?.toLocaleString() ?? "荳崎・"}) / 蟾ｮ ${r.diff?.toLocaleString() ?? "-"}`);
  for (const e of r.evs) {
    if (e.sourceKind !== "A") continue;
    console.log(
      `    active ${e.skillName ?? e.skillId} ratio=${e.isRatioScore} base=${e.ratioBaseCumScore?.toLocaleString() ?? "-"} power=${e.skillPowerPermil} basic=${e.basicScore?.toLocaleString() ?? "-"} combo=${e.comboFactorPermil} fan=${e.fanFactorPermil} crit=${e.critFactorPermil} gain=${e.gainedScore.toLocaleString()} cumAfter=${e.cumAfterEvent.toLocaleString()}`,
    );
  }
}
const sumActDiff = act.reduce((a, r) => a + (r.diff ?? 0), 0);
console.log(`  A 繧ｻ繝ｫ蜷郁ｨ亥ｷｮ ${sumActDiff.toLocaleString()}・・{act.length} 繧ｻ繝ｫ・荏);

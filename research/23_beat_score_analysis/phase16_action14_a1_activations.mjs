/**
 * Phase 16 Action14 / A1 補助2: S3 の A/SP 発動（skill_activations_summary）と
 * 「そのビート・そのレーンの pop が読めているか」を突合する。
 *
 * 目的: b2 の residual 2,109,487（v2_meta 曰く "L3A殻510pct約+2.0M"）のように
 *       **A/SP のスコアに pop が付かない** 構造が他にもあるか、隠れ枠 2,635,445 の内訳を作る。
 *
 * 実行: node research/23_beat_score_analysis/phase16_action14_a1_activations.mjs
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

const acts = meas.skill_activations_summary ?? [];
const rows = [];
for (const a of acts) {
  const k = `${a.beat}:${a.lane}`;
  rows.push({
    order: a.order,
    beat: a.beat,
    lane: a.lane,
    type: a.type,
    name: a.skill_name,
    popReadable: merged.has(k),
    pop: merged.get(k) ?? null,
    simCell: sim[k] ?? null,
  });
}
const skillActs = rows.filter((r) => r.type === "A" || r.type === "SP");
console.log(`activations=${rows.length}  A/SP=${skillActs.length}`);
console.log("--- A/SP 発動 × pop 可読 × sim セル ---");
for (const r of skillActs.sort((a, b) => a.beat - b.beat)) {
  console.log(
    `  b${String(r.beat).padStart(3)} L${r.lane} ${r.type.padEnd(2)} pop=${r.popReadable ? String(r.pop).padStart(8) : "  不能  "} sim=${r.simCell === null ? "  セルなし" : String(r.simCell).padStart(11)}  ${r.name}`,
  );
}
const noPop = skillActs.filter((r) => !r.popReadable);
console.log(
  `\nA/SP 発動で pop が無いもの: ${noPop.length} 件 → ${noPop.map((r) => `b${r.beat}L${r.lane}(${r.type})`).join(" ")}`,
);
console.log(
  `  それらの sim セル合計 = ${noPop.reduce((a, r) => a + (r.simCell ?? 0), 0).toLocaleString()}`,
);
/* レーン別の「pop が無い A/SP 発動」 */
const byLane = new Map();
for (const r of noPop) byLane.set(r.lane, (byLane.get(r.lane) ?? 0) + 1);
console.log(`  レーン別: ${[...byLane.entries()].map(([l, n]) => `L${l} ${n}件`).join(" / ")}`);

/* 全タイプ（photo/P 含む）で pop が無い発動 */
const allNoPop = rows.filter((r) => !r.popReadable);
console.log(`\n全タイプで pop が無い発動: ${allNoPop.length} 件`);
for (const r of allNoPop.sort((a, b) => a.beat - b.beat)) {
  console.log(`  b${String(r.beat).padStart(3)} L${r.lane} ${r.type.padEnd(5)} sim=${r.simCell ?? 0}  ${r.name}`);
}

/* 隠れ枠の内訳候補: b2 の residual を「A/SP 発動で pop なし」に寄与として分配 */
console.log("\n--- 参考: b2 の位相内訳（v2_meta） ---");
console.log(`  bgs(b2)=${meas.timeline.find((e) => e.beat === 2)?.beat_gained_score} Σpop=553,100 residual=2,109,487`);
console.log(`  L3 の b2 pop は +123.3K（フォト）のみ。v2_meta は "L3A殻510pct約+2.0M" を L3 の寄与と記録。`);

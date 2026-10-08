/** B1: sp_skill_score_up の窓（実機 vs sim）を A13 の buff-rows 成果物から引く
 *   node research/23_beat_score_analysis/_b1_sp_window.mjs
 */
import fs from "node:fs";
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const d = J("research/23_beat_score_analysis/phase16_action13_buff_rows.json");
for (const [tag, s] of Object.entries(d.samples)) {
  const rows = s.rows ?? s.buffRows ?? null;
  console.log(`=== ${tag}（meas=${s.measFile}）rows=${Array.isArray(rows) ? rows.length : "n/a"} keys=${Object.keys(s).join(",")}`);
  if (!Array.isArray(rows)) continue;
  for (const r of rows) {
    const blob = JSON.stringify(r);
    if (!blob.includes("sp_skill_score_up") && !blob.includes("SPスキルスコア")) continue;
    console.log(`  ${JSON.stringify(r).slice(0, 600)}`);
  }
}

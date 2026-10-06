/**
 * Phase 16 Action11 タスク2/3 の決定的検定:
 * レーンごとに「クリティカルセル」と「非クリティカルセル」へ分けて sim/pop 比を出す。
 * - 非クリセルの比が全サンプル・全レーンで揃うなら、素点式は正しく、ズレはクリティカル係数側。
 * - クリセルの比がレーン/サンプルで違うなら、critFactorPermil の段数依存が怪しい。
 *   npx tsx research/23_beat_score_analysis/phase16_action11_crit_split.ts S1,S2,S3
 */
import fs from "node:fs";
const ROOT = process.cwd();
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const fsx = fs;
const j = JSON.parse(fsx.readFileSync(`${ROOT}/research/23_beat_score_analysis/phase16_action11_decouple_out.json`, "utf8"));
const DIRS = { S1: "サンプル1", S2: "サンプル2", S3: "サンプル3" };
const parseK = (t) => { const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t ?? "").replace(/[,\s]/g, "")); if (m === null) return null; const u = { "": 1, K: 1000, M: 1e6, G: 1e9 }[m[2].toUpperCase()]; return u === undefined ? null : Math.round(Number(m[1]) * u); };
for (const [ID, dir] of Object.entries(DIRS)) {
  const mp = [`${NOX}/${dir}/measured_data_v3.json`, `${NOX}/${dir}/measured_data_v2.json`].find((p) => fsx.existsSync(p));
  const meas = JSON.parse(fsx.readFileSync(mp, "utf8"));
  const bf = JSON.parse(fsx.readFileSync(`${NOX}/${dir}/lane_pops_backfill.json`, "utf8"));
  const pop = new Map();
  for (const x of bf.pops ?? []) { if (typeof x?.beat !== "number" || x.readable === false) continue; const v = parseK(x.displayed); if (v !== null) pop.set(`${x.beat}:${x.lane}`, v); }
  for (const row of meas.timeline ?? []) for (let l = 1; l <= 5; l++) { const cell = (row.lanes ?? {})[`lane${l}`] ?? (row.lanes ?? {})[l]; const p = cell?.gained_score_pop; const v = typeof p === "object" && p !== null ? parseK(p.text) : parseK(p); if (v !== null && !pop.has(`${row.beat}:${l}`)) pop.set(`${row.beat}:${l}`, v); }
  const acts = new Set((meas.skill_activations_summary ?? []).map((a) => `${a.beat}:${a.lane}`));
  const S = j.samples[ID];
  const acc = [1, 2, 3, 4, 5].map(() => ({ ncS: 0, ncP: 0, ncN: 0, cS: 0, cP: 0, cN: 0, critVals: new Map() }));
  // クリティカル係数別の内訳
  const byCrit = new Map();
  for (const [key, arr] of Object.entries(S.cells)) {
    const [beat, lane] = key.split(":").map(Number);
    const ev = arr.find((x) => x.sourceKind === "beat");
    if (ev === undefined || arr.length !== 1 || acts.has(key)) continue;
    const p = pop.get(key);
    if (p === undefined || p < 3000) continue;
    const a = acc[lane - 1];
    if (ev.critFactorPermil === 1000) { a.ncS += ev.gainedScore; a.ncP += p; a.ncN++; }
    else { a.cS += ev.gainedScore; a.cP += p; a.cN++; }
    const ck = `${lane}:${ev.critFactorPermil}`;
    const e = byCrit.get(ck) ?? { s: 0, p: 0, n: 0 };
    e.s += ev.gainedScore; e.p += p; e.n++;
    byCrit.set(ck, e);
  }
  console.log(`\n########## ${ID} ##########`);
  console.log(`  レーン  非クリ比(sim/pop) n   クリ比(sim/pop) n   全比`);
  for (let l = 0; l < 5; l++) {
    const a = acc[l];
    const ncr = a.ncP > 0 ? a.ncS / a.ncP : NaN;
    const cr = a.cP > 0 ? a.cS / a.cP : NaN;
    const all = (a.ncS + a.cS) / (a.ncP + a.cP);
    console.log(`   L${l + 1}  ${ncr.toFixed(4).padStart(8)} ${String(a.ncN).padStart(4)}  ${cr.toFixed(4).padStart(8)} ${String(a.cN).padStart(4)}  ${all.toFixed(4)}  (${S.lanes[l].attribute})`);
  }
  console.log(`  クリティカル係数別:`);
  for (const [ck, e] of [...byCrit.entries()].sort((a, b) => Number(a[0].split(":")[1]) - Number(b[0].split(":")[1]) || Number(a[0].split(":")[0]) - Number(b[0].split(":")[0]))) {
    console.log(`    lane${ck.split(":")[0]} crit=${ck.split(":")[1]} n=${String(e.n).padStart(3)} sim/pop=${(e.s / e.p).toFixed(4)}  Σpop=${e.p.toLocaleString("en-US")}`);
  }
}

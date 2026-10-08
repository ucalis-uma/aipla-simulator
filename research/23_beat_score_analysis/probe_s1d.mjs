// 一時_probe_: S1 の実測データ（サンプル1）構造と lane_pops・fan 係数の当たりを確認
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
const repo = process.cwd();
const rj = (p) => JSON.parse(readFileSync(path.join(repo, p), "utf8"));
const nox = path.resolve(repo, "..", "aipura_nox");
const rjN = (p) => JSON.parse(readFileSync(path.join(nox, p), "utf8"));

console.log("26_data_integrity json:", readdirSync(path.join(repo, "research/26_data_integrity")).filter((n) => n.endsWith(".json")).join(", "));

const md = rjN("サンプル1/measured_data_v2.json");
console.log("\nS1 stage:", JSON.stringify(md.stage));
console.log("S1 results keys:", Object.keys(md.results ?? {}).join(","));
console.log("S1 results:", JSON.stringify(md.results).slice(0, 600));
console.log("S1 timeline n:", md.timeline.length, "row1:", JSON.stringify(md.timeline[1]).slice(0, 900));
const sum = md.skill_activations_summary ?? [];
console.log("S1 summary n:", sum.length, "row1:", JSON.stringify(sum[1]).slice(0, 400));
console.log("S1 row.skill_activations sample:", JSON.stringify(md.timeline.slice(0, 60).map((r) => r.skill_activations).filter((x) => (x ?? []).length > 0).slice(0, 4)));
// ポップ所持数
let popN = 0, popW = 0;
const perLane = {};
for (const r of md.timeline) {
  for (let l = 1; l <= 5; l++) {
    const p = r.lanes?.[String(l)]?.gained_score_pop;
    const t = typeof p === "string" ? p : p?.text;
    if (t !== undefined && t !== null) {
      popN++;
      perLane[l] = (perLane[l] ?? 0) + 1;
    }
  }
}
console.log("S1 in-timeline pop cells:", popN, JSON.stringify(perLane));

const lp = rjN("サンプル1/lane_pops_backfill.json");
console.log("\nS1 lane_pops_backfill keys:", Object.keys(lp).join(","));
const pops = lp.pops ?? [];
console.log("S1 backfill pops n:", pops.length, "row0:", JSON.stringify(pops[0]), "row5:", JSON.stringify(pops[5]));
const cnt = {};
let readable = 0;
for (const p of pops) {
  cnt[p.lane] = (cnt[p.lane] ?? 0) + 1;
  if (p.displayed !== null && p.displayed !== undefined) readable++;
}
console.log("S1 backfill per-lane:", JSON.stringify(cnt), "readable:", readable);

// deck.json（サンプル1）側
const cfg = rjN("サンプル1/deck.json");
console.log("\nサンプル1/deck.json keys:", Object.keys(cfg).join(","));
console.log("  audience-ish:", JSON.stringify({ audience: cfg.audience, myPhotos: (cfg.myPhotos ?? []).length, photoEquip: cfg.photoEquip ?? null, disabled: (cfg.disabledSkillIds ?? []).length, mental: cfg.mentalOverride ?? null }));
const chars = cfg.deck.characters;
console.log("  chars:", chars.map((c) => `${c.card_id ?? c.id}/${c.attribute ?? "?"}`).join(" | "));
console.log("  stats:", chars.map((c) => JSON.stringify(c.stats?.total_after_non_skill_modifiers ?? c.stats ?? null)).join("\n         "));
console.log("  photos beat_score terms:");
chars.forEach((c, i) => {
  const t = [];
  for (const it of [...(c.photos ?? []), ...(c.accessories ?? [])]) {
    for (const s of it?.structured ?? []) if (s.stat === "beat_score") t.push(`${it.name}:${s.type}=${s.value}`);
  }
  console.log(`    L${i + 1} ${t.join(", ")}`);
});
const mdChars = md.characters ?? [];
console.log("  S1 measured characters n:", mdChars.length, JSON.stringify(mdChars[0] ?? null).slice(0, 300));
console.log("  S1 staff_bonus:", JSON.stringify(md.staff_bonus).slice(0, 300), "yale:", JSON.stringify(md.yale_bonus).slice(0, 300));

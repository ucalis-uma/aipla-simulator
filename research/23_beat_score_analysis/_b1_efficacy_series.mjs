/** B1: `ef-...-<N>` の末尾 N は「ビート数」なのか「段数/対象コード」なのかを全マスタで統計する
 *   node research/23_beat_score_analysis/_b1_efficacy_series.mjs
 *
 * 判定: 説明文に `[Nビート]` を持つ効果行について、efficacyId の数値成分に N が現れるかを数える。
 *   - 「ビート数が ID に入る系列」なら、[Nビート] 付きの大半で一致するはず。
 *   - 一致しなければ、末尾の数値は段数・対象コード等であり **持続ビートは ID に無い**。
 */
import fs from "node:fs";
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const v = J("vendor/Skill.json");
const skills = Array.isArray(v) ? v : (v.skills ?? v.rows ?? Object.values(v));
let total = 0;
let withBeats = 0;
let beatInId = 0;
const examplesBeatInId = [];
const examplesNotInId = [];
const spSeries = new Map();
for (const s of skills) {
  for (const lv of s.levels ?? []) {
    const desc = String(lv.description ?? "");
    for (const d of lv.skillDetails ?? []) {
      const id = String(d.efficacyId ?? "");
      if (id === "") continue;
      total++;
      if (id.includes("special_skill_score_up")) {
        spSeries.set(id, (spSeries.get(id) ?? 0) + 1);
      }
      const m = /\[(\d+)ビート\]/.exec(desc);
      if (m === null) continue;
      withBeats++;
      const n = m[1];
      const nums = id.match(/\d+/g) ?? [];
      if (nums.includes(n)) {
        beatInId++;
        if (examplesBeatInId.length < 5) examplesBeatInId.push(`${s.id}: [${n}ビート] → ${id}`);
      } else if (examplesNotInId.length < 8) {
        examplesNotInId.push(`${s.id}: [${n}ビート] → ${id}（数値成分 ${nums.join(",")}）`);
      }
    }
  }
}
console.log(`skillDetails 総数: ${total} / [Nビート] 付き: ${withBeats} / そのうち efficacyId に N が現れる: ${beatInId}`);
console.log(
  `→ ${withBeats === 0 ? "n/a" : ((100 * beatInId) / withBeats).toFixed(1)}% ＝ ` +
    `${beatInId === withBeats ? "ビート数は ID に入る系列" : "**ビート数は efficacyId に入らない**（末尾の数値は段数・対象コード等）"}`,
);
console.log("\n--- [Nビート] の N が ID に現れる例 ---");
for (const e of examplesBeatInId) console.log(`  ${e}`);
console.log("--- 現れない例 ---");
for (const e of examplesNotInId) console.log(`  ${e}`);
console.log("\n--- special_skill_score_up 系列（全 ID と出現数） ---");
for (const [id, n] of [...spSeries.entries()].sort()) console.log(`  ${n.toString().padStart(4)}  ${id}`);

/* --- 同系列の説明文に [Nビート] があるか（末尾コード = ビート数 の検証） --- */
console.log("\n--- special_skill_score_up: 末尾コードと [Nビート] の関係 ---");
const info = new Map();
for (const s of skills) {
  for (const lv of s.levels ?? []) {
    const desc = String(lv.description ?? "");
    for (const d of lv.skillDetails ?? []) {
      const id = String(d.efficacyId ?? "");
      if (!id.includes("special_skill_score_up")) continue;
      const tail = Number((id.match(/-(\d+)$/) ?? [])[1] ?? NaN);
      const beats = (/\[(\d+)ビート\]/.exec(desc) ?? [])[1] ?? null;
      const stages = (/対象1人に(\d+)段階/.exec(desc) ?? [])[1] ?? (/誰かがSP[^]*?(\d+)段階/.exec(desc) ?? [])[1] ?? null;
      const e = info.get(id) ?? { n: 0, tails: new Set(), beats: new Set(), stages: new Set() };
      e.n++;
      e.tails.add(tail);
      e.beats.add(beats ?? "なし");
      e.stages.add(stages ?? "?");
      info.set(id, e);
    }
  }
}
for (const [id, e] of [...info.entries()].sort()) {
  console.log(
    `  ${id.padEnd(62)} n=${String(e.n).padStart(3)} 末尾=${[...e.tails].join("/")} [Nビート]=${[...e.beats].join("/")} 段階=${[...e.stages].join("/")}`,
  );
}

/* --- sk-skr-05-fest-00-3 の全レベル --- */
console.log("\n--- sk-skr-05-fest-00-3（S2 L2「胸いっぱいの勇気」）の全レベル ---");
for (const s of skills) {
  if (s.id !== "sk-skr-05-fest-00-3") continue;
  for (const lv of s.levels ?? []) {
    const desc = String(lv.description ?? "").split("\n").join(" / ");
    const ids = (lv.skillDetails ?? []).map((d) => d.efficacyId).join(",");
    console.log(`  Lv${lv.level}: ${ids}  CT:${lv.coolTime}  「${desc}」`);
  }
}

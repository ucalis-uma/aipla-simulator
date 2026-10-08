// Phase 16 Action 2 探索用（使い捨て）: ライブ中表示ステータスと deck.json のステータスを比較し、
// 全レーン共通の倍率ズレ（欠落乘数）の有無を確かめる。
// 実行: node research/23_beat_score_analysis/probe_status.mjs
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "../..");
const nox = path.resolve(repo, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));
const stageIdx = J(path.join(repo, "data/stages_index.json"));

function attrsOf(qid) {
  const list = Array.isArray(stageIdx.quests) ? stageIdx.quests : Object.values(stageIdx.quests);
  const q = list.find((x) => x.id === qid);
  if (!q) throw new Error(`quest not found: ${qid}`);
  const c = stageIdx.configs[q.c];
  return { a: c.a, w: c.w, st: c.st ?? 1000, rw: c.rw ?? 1000, raw: c };
}

function report(tag, sampleDir, measuredFile, qid) {
  const deckCfg = J(path.join(nox, sampleDir, "deck.json"));
  const deck = deckCfg.deck;
  const m = J(path.join(repo, "research/26_data_integrity", measuredFile));
  const at = attrsOf(qid);
  console.log(`\n===== ${tag}  quest=${qid} laneAttr=${JSON.stringify(at.a)} weights=${JSON.stringify(at.w)}`);
  console.log(`  results: ${JSON.stringify(m.results?.scores_by_lane)} total=${m.results?.total_score}`);
  console.log(`  lane_fans=${JSON.stringify(m.lane_fans ?? m.results?.lane_fans ?? null)}`);
  if (m.stage) console.log(`  stage(m) = ${JSON.stringify(m.stage)}`);
  if (m.staff_bonus !== undefined) console.log(`  staff_bonus = ${JSON.stringify(m.staff_bonus).slice(0, 300)}`);
  if (m.yale_bonus !== undefined) console.log(`  yale_bonus = ${JSON.stringify(m.yale_bonus).slice(0, 300)}`);
  if (m.characters !== undefined) console.log(`  characters(m) = ${JSON.stringify(m.characters).slice(0, 900)}`);
  const early = [1, 2, 3, 5, 10];
  for (const b of early) {
    const row = m.timeline.find((r) => r.beat === b);
    if (!row) continue;
    const cells = [];
    for (let l = 1; l <= 5; l++) {
      const c = row.lanes?.[String(l)] ?? row.lanes?.[`lane${l}`];
      cells.push(`L${l}=${c?.stat_value ?? "?"}${c?.effects?.length ? "/" + c.effects.map((e) => e.name + e.stage).join(",") : ""}`);
    }
    console.log(`  b${b} combo=${row.combo} ${cells.join(" ")}`);
  }
  const last = m.timeline[m.timeline.length - 1];
  const lc = [];
  for (let l = 1; l <= 5; l++) {
    const c = last.lanes?.[String(l)] ?? last.lanes?.[`lane${l}`];
    lc.push(`L${l}=${c?.stat_value ?? "?"}`);
  }
  console.log(`  last b${last.beat} ${lc.join(" ")}`);
  (deck.characters ?? []).forEach((ch, i) => {
    const a = at.a[i % 5];
    console.log(
      `  deck L${i + 1} ${JSON.stringify(Object.fromEntries(["vocal", "dance", "visual"].map((k) => [k, ch[k]])))} attr=${a} -> ${ch[a]}  mental=${ch.mental ?? ch.psychosis ?? "?"}`,
    );
  });
}

const which = (process.argv[2] ?? "S2").toUpperCase();
if (which === "S2") report("S2", "サンプル2", "measured_data_s2_v3.json", "qt-tower-680");
if (which === "S3") report("S3", "サンプル3", "measured_data_s3_v3.json", "qt-ex-tower-005-045");
if (which === "S1") {
  const m = J(path.join(repo, "research/15_phase4/sample1_full/measured_data_v2.json"));
  const deckCfg = J(path.join(nox, "サンプル1", "deck.json"));
  console.log("\n===== S1");
  console.log("  results", JSON.stringify(m.results ?? {}).slice(0, 400));
  for (const b of [1, 2, 3, 5, 10]) {
    const row = m.timeline.find((r) => r.beat === b);
    if (!row) continue;
    const cells = [];
    for (let l = 1; l <= 5; l++) {
      const c = row.lanes?.[String(l)] ?? row.lanes?.[`lane${l}`];
      cells.push(`L${l}=${c?.stat_value ?? "?"}${c?.effects?.length ? "/" + c.effects.map((e) => e.name + e.stage).join(",") : ""}`);
    }
    console.log(`  b${b} combo=${row.combo} ${cells.join(" ")}`);
  }
  (deckCfg.deck?.characters ?? deckCfg.characters ?? []).forEach((ch, i) => {
    console.log(`  deck L${i + 1} ${JSON.stringify(Object.fromEntries(["vocal", "dance", "visual"].map((k) => [k, ch[k]])))}`);
  });
  const st = J(path.join(repo, "data/stages_index.json"));
  const qid = deckCfg.deck?.stage_id ?? "qt-ex-tower-005-003";
  console.log("  quest guess", qid, JSON.stringify(st.quests[qid] ?? null));
}

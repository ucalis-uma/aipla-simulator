// Phase 16 Action 2 探索用（使い捨て）: 表示ステータスがどの能力値か／フォト beat_score% の実体を確認する。
// 実行: node research/23_beat_score_analysis/probe_stats23.mjs
import fs from "node:fs";
import path from "node:path";
const repo = path.resolve(import.meta.dirname, "../..");
const nox = path.resolve(repo, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));
const cards = J(path.join(repo, "data/cards.json")).cards;
const byId = new Map(cards.map((c) => [c.id, c]));

const laneAttrEnc = { 1: "dance", 2: "vocal", 3: "visual" }; // 検証対象の仮説
const idx = J(path.join(repo, "data/stages_index.json"));
const samples = [
  { tag: "S1", deckFile: path.join(repo, "examples/nested-sample.json"), meas: path.join(nox, "サンプル1/measured_data_v2.json"), qid: "qt-area-1-001", measFmt: "nestedLanes" },
  { tag: "S2", deckFile: path.join(nox, "サンプル2/deck.json"), meas: path.join(repo, "research/26_data_integrity/measured_data_s2_v3.json"), qid: "qt-tower-680", measFmt: "nestedLanes" },
  { tag: "S3", deckFile: path.join(nox, "サンプル3/deck.json"), meas: path.join(repo, "research/26_data_integrity/measured_data_s3_v3.json"), qid: "qt-ex-tower-005-045", measFmt: "nestedLanes" },
];
for (const s of samples) {
  const cfg = J(s.deckFile);
  const deck = cfg.deck;
  const q = idx.quests.find((x) => x.id === s.qid);
  const c = idx.configs[q.c];
  const m = J(s.meas);
  console.log(`\n===== ${s.tag} q=${s.qid} a=${JSON.stringify(c.a)} w=${JSON.stringify(c.w)} mt=${c.mt} cap=${c.cap} audience(clear)=${q.clear}`);
  const firstRows = m.timeline.filter((r) => r.lanes?.["1"]?.stat_value != null);
  console.log(`  rows with stat_value: ${firstRows.length}/${m.timeline.length}`);
  const r0 = firstRows[0];
  deck.characters.forEach((ch, i) => {
    const lane = i + 1;
    const card = byId.get(ch.card_id ?? ch.card ?? "");
    const st = ch.stats?.total_after_non_skill_modifiers ?? ch.stats ?? {};
    const disp = r0?.lanes?.[String(lane)]?.stat_value;
    const which = ["vocal", "dance", "visual"].filter((k) => st[k] === disp);
    const attr = laneAttrEnc[c.a[i]];
    const eff = (r0?.lanes?.[String(lane)]?.effects ?? []).map((e) => `${e.name}${e.stage}`).join(",");
    const bs = [...(ch.photos ?? []), ...(ch.accessories ?? [])].flatMap((it) =>
      (it.structured ?? []).filter((x) => x.stat === "beat_score").map((x) => `${x.type}:${x.value}`),
    );
    console.log(
      `  L${lane} card=${ch.card_id ?? ch.card} char=${card?.characterId ?? "?"} type=${card?.type ?? "?"} ` +
      `deckV=${st.vocal} deckD=${st.dance} deckViz=${st.visual} | disp(b${r0?.beat})=${disp} →match[${which.join("/")}] laneAttr=${attr}`,
    );
    console.log(`       photoBeatScore=[${bs.join(" ")}] effects=[${eff}]`);
  });
}

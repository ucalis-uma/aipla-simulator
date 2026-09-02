import { readFileSync } from "node:fs";
// ビルドされた scoreBonusPct と、写真 grants の a_score 成分を確認
import { buildSimulateInput } from "../../src/sim/build.ts";
const repo = "C:/Users/umaro/Documents/アイプラ";
const read = (p) => JSON.parse(readFileSync(p, "utf-8"));
// trace_dump と同じデータ構築（簡易）
const data = {
  cards: read(repo + "/data/cards.json").cards,
  cardParameters: read(repo + "/data/card_parameters.json").rows,
  skillsGolden: read(repo + "/data/skills_golden.json").skills,
  skillsByCard: read(repo + "/data/skills_master.json").byCard,
  skillLevels: read(repo + "/data/skills_levels.json"),
  liveBonusesByQuest: read(repo + "/data/live_bonuses.json").byQuest,
  audienceAdvantage: read(repo + "/data/stages/audience_advantage.json"),
  stages: {},
  charts: {},
};
const idx = read(repo + "/data/stages_index.json");
const q = idx.quests.find((x) => x.id === "qt-area-1-001");
const cfg = idx.configs[q.c];
data.stages["qt-area-1-001"] = {
  beatWeightsPermil: { vocal: cfg.w[0], dance: cfg.w[1], visual: cfg.w[2] },
  skillWeightsPermil: { active: cfg.aw[0], special: cfg.aw[1] },
  laneAttributes: cfg.a,
};
const all = read(repo + "/data/charts_all.json");
data.charts["chart-hsm-006-001"] = { notes: (all["chart-hsm-006-001"] || []).map(([t, p], i) => ({ beat: i + 1, type: t, position: p })) };
const deckJson = JSON.parse(readFileSync("C:/Users/umaro/Documents/aipura_nox/サンプル1/deck.json", "utf-8"));
const built = buildSimulateInput({ deck: deckJson.deck, stageFile: "qt-area-1-001", chartFile: "chart-hsm-006-001", data, audience: 20, disabledSkillIds: deckJson.disabledSkillIds, critRate: undefined, myPhotos: deckJson.myPhotos, photoEquip: deckJson.photoEquip });
for (const lane of built.lanes) {
  console.log(`L${lane.lane}: scoreBonusPct=`, JSON.stringify(lane.scoreBonusPct ?? (lane.input ?? lane).scoreBonusPct ?? null));
}

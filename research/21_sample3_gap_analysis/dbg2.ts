import { readFileSync } from "node:fs";
import { buildSimulateInput } from "../../src/sim/build.ts";
const root = "C:/Users/umaro/Documents/アイプラ";
const read = (p) => JSON.parse(readFileSync(`${root}/${p}`, "utf-8"));
const deckJson = JSON.parse(readFileSync("C:/Users/umaro/Documents/aipura_nox/サンプル3/deck.json", "utf-8"));
const data = {
  cards: read("data/cards.json").cards,
  cardParameters: read("data/card_parameters.json").rows,
  skillsGolden: read("data/skills_golden.json").skills,
  stages: {},
  charts: {},
  audienceAdvantage: read("data/stages/audience_advantage.json"),
  skillsByCard: read("data/skills_master.json").byCard,
  liveBonusesByQuest: read("data/live_bonuses.json").byQuest,
  skillLevels: read("data/skills_levels.json"),
};
import { mergePhotoEquipStatuses, myPhotoToSkillDef } from "../../src/photos.ts";
const d = deckJson.deck;
const myPhotos = deckJson.myPhotos ?? [];
const photoEquip = deckJson.photoEquip ?? [];
const userPhotoSkills = photoEquip.flatMap((ids, i) =>
  ids.flatMap((pid, j) => {
    const p = myPhotos.find((x) => x?.id === pid);
    if (p === undefined) return [];
    const def = myPhotoToSkillDef(p, i + 1, j + 1);
    return def !== null ? [def] : [];
  }),
);
console.log("userPhotoSkills:", userPhotoSkills.map((s) => [s.lane, s.name]));
const q = read("data/stages_index.json").quests.find((x) => x.id === "qt-ex-tower-005-045");
const cfg = read("data/stages_index.json").configs[q.c];
data.stages["qt-ex-tower-005-045"] = {
  beatWeightsPermil: { vocal: cfg.w[0], dance: cfg.w[1], visual: cfg.w[2] },
  skillWeightsPermil: { active: cfg.aw[0], special: cfg.aw[1] },
  laneAttributes: cfg.a,
};
const all = read("data/charts_all.json");
data.charts["chart-thrx-004-001"] = { notes: all["chart-thrx-004-001"].map(([t, p], i) => ({ beat: i + 1, type: t, position: p })) };
const built = buildSimulateInput({ deck: d, stageFile: "qt-ex-tower-005-045", chartFile: "chart-thrx-004-001", data, audience: 8000, userPhotoSkills });
for (const ln of built.lanes) {
  console.log(`L${ln.lane} bonus=`, JSON.stringify(ln.scoreBonusPct), "flat=", ln.aScoreAdditionalFlat, "critX=", ln.critExtrasPermil);
}
console.log("warnings:", built.warnings.slice(0, 10));

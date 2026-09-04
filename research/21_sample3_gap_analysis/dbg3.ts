import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
import { buildSimulateInput } from "../../src/sim/build.ts";
import { simulateTimeline } from "../../src/timeline/engine.ts";
import { NeutralRng } from "../../src/rng/neutral.ts";
import { mergePhotoEquipStatuses, myPhotoToSkillDef } from "../../src/photos.ts";
const read = (p) => JSON.parse(readFileSync(p, "utf-8"));
const cfgJson = JSON.parse(readFileSync("C:/Users/umaro/Documents/aipura_nox/サンプル3/deck.json", "utf-8"));
cfgJson.deck.characters[3].ct_cuts = [{ skill: 2, value: 5 }];
for (const p of cfgJson.myPhotos) {
  if (p.id === "uph-lane5-3" && p.skill !== null) p.skill.staminaScaling = "more_stamina";
}
const d = cfgJson.deck;
const myPhotos = cfgJson.myPhotos ?? [];
const photoEquip = cfgJson.photoEquip ?? [];
photoEquip.forEach((ids, i) => {
  const ch = d.characters[i];
  if (ch === undefined || !Array.isArray(ch.photos)) return;
  const equipped = ids.map((pid) => myPhotos.find((x) => x?.id === pid)).filter((p) => p !== undefined);
  ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
});
const userPhotoSkills = photoEquip.flatMap((ids, i) =>
  ids.flatMap((pid, j) => {
    const p = myPhotos.find((x) => x?.id === pid);
    if (p === undefined) return [];
    const def = myPhotoToSkillDef(p, i + 1, j + 1);
    return def !== null ? [def] : [];
  }),
);
const idx = read(`${repoRoot}/data/stages_index.json`);
const quest = idx.quests.find((x) => x.id === "qt-ex-tower-005-045");
const scfg = idx.configs[quest.c];
const data = {
  cards: read(`${repoRoot}/data/cards.json`).cards,
  cardParameters: read(`${repoRoot}/data/card_parameters.json`).rows,
  skillsGolden: read(`${repoRoot}/data/skills_golden.json`).skills,
  stages: { "qt-ex-tower-005-045": { beatWeightsPermil: { vocal: scfg.w[0], dance: scfg.w[1], visual: scfg.w[2] }, skillWeightsPermil: { active: scfg.aw[0], special: scfg.aw[1] }, skillStaminaWeightPermil: scfg.st ?? 1000, staminaRecoveryWeightPermil: scfg.rw ?? 0, laneAttributes: scfg.a } },
  charts: { "chart-thrx-004-001": { notes: read(`${repoRoot}/data/charts_all.json`)["chart-thrx-004-001"].map(([t, p], i) => ({ beat: i + 1, type: t, position: p })) } },
  audienceAdvantage: read(`${repoRoot}/data/stages/audience_advantage.json`),
  skillsByCard: read(`${repoRoot}/data/skills_master.json`).byCard,
  liveBonusesByQuest: read(`${repoRoot}/data/live_bonuses.json`).byQuest,
  characterAdvantageByQuest: read(`${repoRoot}/data/character_advantage.json`).byQuest,
  skillLevels: read(`${repoRoot}/data/skills_levels.json`),
};
const built = buildSimulateInput({ deck: d, stageFile: "qt-ex-tower-005-045", chartFile: "chart-thrx-004-001", data, audience: 8000, userPhotoSkills, goldenPhotoNames: (() => { try { const s = read("C:/Users/umaro/Documents/アイプラ/スコア分析サンプル/verification_data_v2.json"); return s.characters.map((c) => c.photos.map((p) => p.name ?? "")); } catch { return undefined; } })() });
const res = simulateTimeline({ ...built.base, baseCritRate: undefined, criticalProvider: () => false, rng: new NeutralRng() });
// NOTE: engine does not expose instances; this script only verifies build path parity.
console.log("lanes:", built.lanes.map((l) => l.lane));
console.log("L4 bonus:", JSON.stringify(built.lanes[3].scoreBonusPct));

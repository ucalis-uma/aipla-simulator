import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import { buildSimulateInput, type SimSourceData } from "../src/sim/build.js";
import { simulateTimeline } from "../src/timeline/engine.js";
import { NeutralRng } from "../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../src/photos.js";

const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const dataDir = path.join(repoRoot, "data");

const idx = readJson(path.join(dataDir, "stages_index.json"));
const quest1 = idx.quests.find((x: any) => x.id === "qt-area-1-001")!;
const cfg1 = idx.configs[quest1.c]!;
const allCharts = readJson(path.join(dataDir, "charts_all.json"));

const data: SimSourceData = {
  cards: readJson(path.join(dataDir, "cards.json")).cards,
  cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
  skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
  stages: {
    "qt-area-1-001": {
      beatWeightsPermil: { vocal: cfg1.w[0]!, dance: cfg1.w[1]!, visual: cfg1.w[2]! },
      skillWeightsPermil: { active: cfg1.aw[0]!, special: cfg1.aw[1]! },
      laneAttributes: cfg1.a,
    },
  },
  charts: {
    "chart-hsm-006-001": {
      notes: (allCharts["chart-hsm-006-001"] as Array<[number, number]>).map(([t, p]: any, i: number) => ({
        beat: i + 1,
        type: t,
        position: p,
      })),
    },
  },
  audienceAdvantage: readJson(path.join(dataDir, "stages/audience_advantage.json")),
  skillsByCard: readJson(path.join(dataDir, "skills_master.json")).byCard,
  skillLevels: readJson(path.join(dataDir, "skills_levels.json")),
  liveBonusesByQuest: readJson(path.join(dataDir, "live_bonuses.json")).byQuest,
  characterAdvantageByQuest: readJson(path.join(dataDir, "character_advantage.json")).byQuest,
} as any;

const cfgJson = readJson(path.join(repoRoot, "../aipura_nox/サンプル1/deck.json"));
const d = cfgJson.deck;
const myPhotos: MyPhotoDef[] = cfgJson.myPhotos ?? [];
const photoEquip: string[][] = cfgJson.photoEquip ?? [];
photoEquip.forEach((ids, i) => {
  const ch = d.characters[i];
  if (ch === undefined || !Array.isArray(ch.photos)) return;
  const equipped = ids
    .map((pid) => myPhotos.find((x) => x?.id === pid))
    .filter((p): p is MyPhotoDef => p !== undefined);
  ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
});
const userPhotoSkills =
  myPhotos.length > 0
    ? photoEquip.flatMap((ids, i) =>
        ids.flatMap((pid, j) => {
          const p = myPhotos.find((x) => x?.id === pid);
          if (p === undefined) return [];
          const def = myPhotoToSkillDef(p, (i + 1) as any, j + 1);
          return def !== null ? [def] : [];
        }),
      )
    : undefined;

const built = buildSimulateInput({
  deck: d,
  stageFile: "qt-area-1-001",
  chartFile: "chart-hsm-006-001",
  data,
  audience: 20,
  disabledSkillIds: cfgJson.disabledSkillIds,
  userPhotoSkills,
} as any);

const res = simulateTimeline({
  ...built.base,
  rng: new NeutralRng(),
  criticalProvider: () => false,
});

for (let beat = 129; beat <= 135; beat++) {
  const b = res.beats.find((x) => x.beat === beat);
  const snap = b?.buffSnapshots[2]; // Lane 3
  console.log(`Beat ${beat}: L3 combo_score_up = ${snap?.combo_score_up}`);
}

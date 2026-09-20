import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import { buildSimulateInput, type SimSourceData, type DeckJsonV2 } from "../src/sim/build.js";
import { simulateTimeline } from "../src/timeline/engine.js";
import { NeutralRng } from "../src/rng/neutral.js";

const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const dataDir = path.join(repoRoot, "data");
const sampleDir = path.join(repoRoot, "スコア分析サンプル");

const data: SimSourceData = {
  cards: readJson(path.join(dataDir, "cards.json")).cards,
  cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
  skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
  stages: { "qt-daily-003-19": readJson(path.join(dataDir, "stages/qt-daily-003-19.json")) },
  charts: { "chart-hsm-004-001": readJson(path.join(dataDir, "charts/chart-hsm-004-001.json")) },
} as any;
const ver = readJson(path.join(sampleDir, "verification_data_v2.json")) as DeckJsonV2;

const base = buildSimulateInput({
  deck: ver, stageFile: "qt-daily-003-19", chartFile: "chart-hsm-004-001", data,
  missedNotes: [1, 2, 3, 4, 5].map((lane) => ({ beat: 1, lane })),
  mentalOverride: { 1: 8996, 2: 5880, 3: 8074, 4: 5890, 5: 5880 },
}).base;

const res = simulateTimeline({
  ...base, rng: new NeutralRng(),
  criticalProvider: () => false,
});

for (let beat = 37; beat <= 46; beat++) {
  const b = res.beats.find((x) => x.beat === beat);
  console.log(`\n=== Beat ${beat} ===`);
  for (const a of b?.activations ?? []) {
    if (a.success) console.log(`  Act: ${a.skillId} (${a.kind}, ${a.phase})`);
  }
  const snap = b?.buffSnapshots[2];
  console.log(`  L3 snap score_up: ${snap?.score_up}`);
}

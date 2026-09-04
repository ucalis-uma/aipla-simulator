import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import { buildSimulateInput, type SimSourceData, type StageWeights } from "../src/sim/build.js";
import { simulateTimeline, type TimelineResult } from "../src/timeline/engine.js";
import { NeutralRng } from "../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../src/photos.js";
import type { LaneNumber } from "../src/timeline/types.js";
import type { CardDef, CardParameterRow } from "../src/types.js";
import type { SkillDef } from "../src/timeline/types.js";

const read = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));

// 1. 入力ロード (examples/sample4.json)
const inputPath = path.join(repoRoot, "examples/sample4.json");
const cfg = read(inputPath);

const STAGE = cfg.stage.file;
const CHART = cfg.chart.file;

// load source data
const cards: CardDef[] = read(path.join(repoRoot, "data/cards.json")).cards;
const cardParameters: CardParameterRow[] = read(path.join(repoRoot, "data/card_parameters.json")).rows;
const skillsGolden = read(path.join(repoRoot, "data/skills_golden.json")).skills;
const stages: Record<string, StageWeights> = {};
const idx = read(path.join(repoRoot, "data/stages_index.json"));
const quest = idx.quests.find((x: any) => x.id === STAGE)!;
const scfg = idx.configs[quest.c]!;
stages[STAGE] = {
  beatWeightsPermil: { vocal: scfg.w[0]!, dance: scfg.w[1]!, visual: scfg.w[2]! },
  skillWeightsPermil: { active: scfg.aw[0]!, special: scfg.aw[1]! },
  skillStaminaWeightPermil: scfg.st ?? 1000,
  staminaRecoveryWeightPermil: scfg.rw ?? 0,
  laneAttributes: scfg.a,
};
const all = read(path.join(repoRoot, "data/charts_all.json"));
const chart = {
  notes: (all[CHART] as Array<[number, number]>).map(([t, p]: any, i: number) => ({
    beat: i + 1,
    type: t,
    position: p,
  })),
};
const audienceAdvantage = read(path.join(repoRoot, "data/stages/audience_advantage.json"));
const skillsByCard = read(path.join(repoRoot, "data/skills_master.json")).byCard;
const skillLevels = read(path.join(repoRoot, "data/skills_levels.json"));
const liveBonusesByQuest = read(path.join(repoRoot, "data/live_bonuses.json")).byQuest;
const characterAdvantageByQuest = read(path.join(repoRoot, "data/character_advantage.json")).byQuest;

const data: SimSourceData = {
  cards,
  cardParameters,
  skillsGolden,
  stages,
  charts: { [CHART]: chart },
  audienceAdvantage,
  skillsByCard,
  liveBonusesByQuest,
  characterAdvantageByQuest,
  skillLevels,
} as any;

const myPhotos: MyPhotoDef[] = cfg.myPhotos ?? [];
const photoEquip: string[][] = cfg.photoEquip ?? [];
photoEquip.forEach((ids, i) => {
  const ch = cfg.deck.characters[i];
  if (ch === undefined || !Array.isArray(ch.photos)) return;
  const equipped = ids.map((pid) => myPhotos.find((x) => x?.id === pid)).filter((p): p is MyPhotoDef => p !== undefined);
  ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
});
const userPhotoSkills =
  myPhotos.length > 0
    ? photoEquip.flatMap((ids, i) =>
        ids.flatMap((pid, j) => {
          const p = myPhotos.find((x) => x?.id === pid);
          if (p === undefined) return [];
          const def = myPhotoToSkillDef(p, (i + 1) as LaneNumber, j + 1);
          return def !== null ? [def] : [];
        }),
      )
    : undefined;

const built = buildSimulateInput({
  deck: cfg.deck,
  stageFile: STAGE,
  chartFile: CHART,
  data,
  audience: cfg.audience,
  mentalOverride: cfg.mentalOverride,
  missedNotes: cfg.missedNotes,
  disabledSkillIds: cfg.disabledSkillIds,
  baseCritRate: undefined,
  userPhotoSkills,
  goldenPhotoNames: (() => {
    try {
      const sample = read(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"));
      return (sample.characters as Array<{ photos: Array<{ name?: string }> }>).map((c) =>
        c.photos.map((p) => p.name ?? ""),
      );
    } catch {
      return undefined;
    }
  })(),
} as any);

// 2. 実測データのクリティカルフラグ読み込み
const measuredPath = "C:/Users/umaro/Documents/aipura_nox/サンプル4/measured_data.json";
const measured = read(measuredPath);

const critByBeat = new Map<number, boolean[]>();
for (const row of measured.critical_flags.beats as Array<{ beat: number; lanes: boolean[] }>) {
  critByBeat.set(row.beat, row.lanes);
}

// 3. simulateTimeline 実行（実測クリティカルフラグ注入 + 乱数1.000）
const res: TimelineResult = simulateTimeline({
  ...built.base,
  baseCritRate: undefined,
  criticalProvider: (beat: number, lane: number) => {
    return critByBeat.get(beat)?.[lane - 1] === true;
  },
  rng: new NeutralRng(),
} as any);

// 4. ビート毎の比較
const measuredTimelineByBeat = new Map<number, any>();
for (const row of measured.timeline) {
  measuredTimelineByBeat.set(row.beat, row);
}

const checks: any[] = [];
const skills: any[] = [];
const normalBeats: any[] = [];

for (const bt of res.beats) {
  const meas = measuredTimelineByBeat.get(bt.beat);
  if (!meas) continue;
  const simGained = bt.gainedScore;
  const measGained = meas.beat_gained_score;
  if (measGained === 0 && simGained === 0) continue;

  const ratio = measGained > 0 ? simGained / measGained : 0;
  const inRange = ratio >= 0.950 && ratio <= 1.050;

  const acts = bt.activations.filter(a => a.success);
  let kind = "beat";
  let skillNames: string[] = [];
  if (acts.some(a => a.kind === "SP")) {
    kind = "SP";
    skillNames = acts.filter(a => a.kind === "SP").map(a => `${a.lane}:${a.skillId}`);
  } else if (acts.some(a => a.kind === "A")) {
    kind = "A";
    skillNames = acts.filter(a => a.kind === "A").map(a => `${a.lane}:${a.skillId}`);
  } else if (acts.some(a => a.kind === "photo")) {
    kind = "photo";
    skillNames = acts.filter(a => a.kind === "photo").map(a => `${a.lane}:${a.skillId}`);
  }

  const check = {
    beat: bt.beat,
    simGained,
    measGained,
    ratio: Number(ratio.toFixed(4)),
    diffPct: Number(((ratio - 1) * 100).toFixed(2)),
    kind,
    skillNames,
    inRange,
  };
  checks.push(check);

  if (kind !== "beat") {
    skills.push(check);
  } else {
    normalBeats.push(check);
  }
}

const normalRatios = normalBeats.map(b => b.ratio);
const minRatio = Math.min(...normalRatios);
const maxRatio = Math.max(...normalRatios);
const avgRatio = normalRatios.reduce((a, b) => a + b, 0) / normalRatios.length;
const normalPassCount = normalBeats.filter(b => b.inRange).length;

const summary = {
  totalSim: res.totalScore,
  totalMeas: measured.results.total_score,
  totalRatio: Number((res.totalScore / measured.results.total_score).toFixed(4)),
  totalDiffPct: Number(((res.totalScore / measured.results.total_score - 1) * 100).toFixed(2)),
  skills,
  normalBeatsSummary: {
    total: normalBeats.length,
    passed: normalPassCount,
    passPct: Number((normalPassCount / normalBeats.length * 100).toFixed(1)),
    minRatio: Number(minRatio.toFixed(4)),
    maxRatio: Number(maxRatio.toFixed(4)),
    avgRatio: Number(avgRatio.toFixed(4)),
  },
  normalBeats,
  allChecks: checks,
  outBeats: checks.filter(c => !c.inRange),
};

writeFileSync(
  path.join(repoRoot, "research/22_sample4_gap_analysis/verify_beats.json"),
  JSON.stringify(summary, null, 2),
  "utf-8"
);
console.log("verify_beats.json written successfully");
console.log("Summary:", JSON.stringify({
  totalRatio: summary.totalRatio,
  totalDiffPct: summary.totalDiffPct,
  skillsCount: skills.length,
  skillsPassed: skills.filter(s => s.inRange).length,
  normalPassed: normalPassCount,
  normalTotal: normalBeats.length,
  normalPassPct: summary.normalBeatsSummary.passPct,
  minRatio: summary.normalBeatsSummary.minRatio,
  maxRatio: summary.normalBeatsSummary.maxRatio,
  avgRatio: summary.normalBeatsSummary.avgRatio,
}, null, 2));

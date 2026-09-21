/**
 * tools/dump_samples_trace.ts
 * 
 * S1, S2, S3 の最新エンジン（Phase 14 実効N-1 Decay適正化モデル）による
 * シミュレーショントレース（全ビート・全レーンの buffSnapshots およびスコア）を再ダンプするツール。
 * 
 * 実行: npx tsx tools/dump_samples_trace.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSimulateInput, type SimSourceData } from "../src/sim/build.js";
import { simulateTimeline } from "../src/timeline/engine.js";
import type { TimelineResult, BeatTrace, ActivationTrace, LaneScoreEventTrace } from "../src/timeline/types.js";
import { NeutralRng } from "../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../src/photos.js";
import type { CardDef, CardParameterRow } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));

function loadSharedData(): SimSourceData {
  const dataDir = path.join(repoRoot, "data");
  const cards: CardDef[] = readJson(path.join(dataDir, "cards.json")).cards;
  const cardParameters: CardParameterRow[] = readJson(path.join(dataDir, "card_parameters.json")).rows;
  const skillsGolden = readJson(path.join(dataDir, "skills_golden.json")).skills;
  const idx = readJson(path.join(dataDir, "stages_index.json"));
  const allCharts = readJson(path.join(dataDir, "charts_all.json"));
  const audienceAdvantage = readJson(path.join(dataDir, "stages/audience_advantage.json"));
  const skillsByCard = readJson(path.join(dataDir, "skills_master.json")).byCard;
  const skillLevels = readJson(path.join(dataDir, "skills_levels.json"));
  const liveBonusesByQuest = readJson(path.join(dataDir, "live_bonuses.json")).byQuest;
  const characterAdvantageByQuest = readJson(path.join(dataDir, "character_advantage.json")).byQuest;

  const stages: any = {};

  // S1: qt-area-1-001
  const q1 = idx.quests.find((x: any) => x.id === "qt-area-1-001")!;
  const c1 = idx.configs[q1.c]!;
  stages["qt-area-1-001"] = {
    beatWeightsPermil: { vocal: c1.w[0]!, dance: c1.w[1]!, visual: c1.w[2]! },
    skillWeightsPermil: { active: c1.aw[0]!, special: c1.aw[1]! },
    laneAttributes: c1.a,
  };

  // S2: qt-tower-680
  const q2 = idx.quests.find((x: any) => x.id === "qt-tower-680")!;
  const c2 = idx.configs[q2.c]!;
  stages["qt-tower-680"] = {
    beatWeightsPermil: { vocal: c2.w[0]!, dance: c2.w[1]!, visual: c2.w[2]! },
    skillWeightsPermil: { active: c2.aw[0]!, special: c2.aw[1]! },
    laneAttributes: c2.a,
  };

  // S3: qt-ex-tower-005-045
  const q3 = idx.quests.find((x: any) => x.id === "qt-ex-tower-005-045")!;
  const c3 = idx.configs[q3.c]!;
  stages["qt-ex-tower-005-045"] = {
    beatWeightsPermil: { vocal: c3.w[0]!, dance: c3.w[1]!, visual: c3.w[2]! },
    skillWeightsPermil: { active: c3.aw[0]!, special: c3.aw[1]! },
    skillStaminaWeightPermil: c3.st ?? 1000,
    laneAttributes: c3.a,
  };

  const charts: any = {};
  charts["chart-hsm-006-001"] = {
    notes: (allCharts["chart-hsm-006-001"] as Array<[number, number]>).map(([t, p]: any, i: number) => ({
      beat: i + 1,
      type: t,
      position: p,
    })),
  };
  charts["chart-sun-004-001"] = {
    notes: (allCharts["chart-sun-004-001"] as Array<[number, number]>).map(([t, p]: any, i: number) => ({
      beat: i + 1,
      type: t,
      position: p,
    })),
  };
  charts["chart-thrx-004-001"] = {
    notes: (allCharts["chart-thrx-004-001"] as Array<[number, number]>).map(([t, p]: any, i: number) => ({
      beat: i + 1,
      type: t,
      position: p,
    })),
  };

  return {
    cards,
    cardParameters,
    skillsGolden,
    stages,
    charts,
    audienceAdvantage,
    skillsByCard,
    skillLevels,
    liveBonusesByQuest,
    characterAdvantageByQuest,
  } as any;
}

function formatTraceOutput(res: TimelineResult, built: any, meta: any) {
  return {
    meta,
    laneInputs: ((res as any).input?.lanes ?? []).map((l: any) => ({
      lane: l.lane,
      role: l.role,
      bonus: l.scoreBonusPct,
      critExtras: l.critExtrasPermil,
    })),
    simTotal: res.totalScore,
    totalScore: res.totalScore,
    fanFactorPermil: built.base.fanFactorPermil,
    beats: res.beats.map((bt: BeatTrace) => ({
      beat: bt.beat,
      noteType: bt.noteType,
      position: bt.position,
      gained: bt.gainedScore,
      comboAfter: [...bt.comboAfter],
      staminaAfter: [...bt.staminaAfter],
      activations: bt.activations.map((a: ActivationTrace) => ({
        lane: a.lane,
        skillId: a.skillId,
        kind: a.kind,
        phase: a.phase,
        success: a.success,
        failReason: a.failReason ?? null,
        staminaCost: a.staminaCost ?? null,
        gainedScore: a.gainedScore ?? null,
      })),
      events: bt.events.map((e: LaneScoreEventTrace) => ({
        lane: e.lane,
        sourceKind: e.sourceKind,
        basicScore: e.basicScore,
        skillPowerPermil: e.skillPowerPermil,
        b1Permil: e.b1Permil,
        comboFactorPermil: e.comboFactorPermil,
        fanFactorPermil: e.fanFactorPermil,
        randPermil: e.randPermil,
        critFactorPermil: e.critFactorPermil,
        isRatioScore: e.isRatioScore,
        ratioBaseCumScore: e.ratioBaseCumScore ?? null,
        gainedScore: e.gainedScore,
      })),
      buffSnapshots: bt.buffSnapshots.map((s: any) => ({ ...s })),
    })),
    finalStamina: [...res.finalStamina],
    finalCombo: [...res.finalCombo],
  };
}

function dumpS1(data: SimSourceData) {
  console.log("--- Processing Sample 1 (S1) ---");
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

  const goldenPhotoNames = (() => {
    try {
      const sample = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"));
      return (sample.characters as Array<{ photos: Array<{ name?: string }> }>).map((c) =>
        c.photos.map((p) => p.name ?? ""),
      );
    } catch {
      return undefined;
    }
  })();

  const built = buildSimulateInput({
    deck: d,
    stageFile: "qt-area-1-001",
    chartFile: "chart-hsm-006-001",
    data,
    audience: 20,
    disabledSkillIds: cfgJson.disabledSkillIds,
    userPhotoSkills,
    goldenPhotoNames,
  } as any);

  // 1. 確定値ラン（NeutralRng, critなし）
  const resNeutral = simulateTimeline({
    ...built.base,
    rng: new NeutralRng(),
    criticalProvider: () => false,
  });

  // 2. 実機クリティカル再現ラン
  const critFlagsRaw = readJson(path.join(repoRoot, "../aipura_nox/サンプル1/measured_data_v2.json")).critical_flags.beats;
  const resReplay = simulateTimeline({
    ...built.base,
    rng: new NeutralRng(),
    criticalProvider: (beat: number, lane: number) => {
      const row = critFlagsRaw[String(beat)];
      return row ? row[String(lane)] === "critical" : false;
    },
  });

  console.log(`S1 Neutral Total: ${resNeutral.totalScore}`);
  console.log(`S1 Replay Total:  ${resReplay.totalScore}`);

  const out = formatTraceOutput(resReplay, built, {
    sample: "S1",
    stage: "qt-area-1-001",
    chart: "chart-hsm-006-001",
    neutralTotalScore: resNeutral.totalScore,
    replayTotalScore: resReplay.totalScore,
  });

  // 保存
  const p1 = path.join(repoRoot, "research/17_sample1_gap_analysis/sim_trace_full.json");
  writeFileSync(p1, JSON.stringify(out, null, 2));
  console.log(`Saved S1 trace to ${p1}`);

  return { resNeutral, resReplay, out };
}

function dumpS2(data: SimSourceData) {
  console.log("--- Processing Sample 2 (S2) ---");
  const cfgJson = readJson(path.join(repoRoot, "../aipura_nox/サンプル2/deck.json"));
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

  const goldenPhotoNames = (() => {
    try {
      const sample = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"));
      return (sample.characters as Array<{ photos: Array<{ name?: string }> }>).map((c) =>
        c.photos.map((p) => p.name ?? ""),
      );
    } catch {
      return undefined;
    }
  })();

  const built = buildSimulateInput({
    deck: d,
    stageFile: "qt-tower-680",
    chartFile: "chart-sun-004-001",
    data,
    audience: 13206,
    disabledSkillIds: cfgJson.disabledSkillIds,
    userPhotoSkills,
    goldenPhotoNames,
  } as any);

  // 1. 確定値ラン
  const resNeutral = simulateTimeline({
    ...built.base,
    rng: new NeutralRng(),
    criticalProvider: () => false,
  });

  // 2. 実機クリティカル再現ラン
  const critFlags = readJson(path.join(repoRoot, "../aipura_nox/サンプル2/measured_data_v2.json")).critical_flags;
  const resReplay = simulateTimeline({
    ...built.base,
    rng: new NeutralRng(),
    criticalProvider: (beat: number, lane: number) => {
      return critFlags[`b${String(beat).padStart(3, "0")}_L${lane}`] === true;
    },
  });

  console.log(`S2 Neutral Total: ${resNeutral.totalScore}`);
  console.log(`S2 Replay Total:  ${resReplay.totalScore}`);

  const out = formatTraceOutput(resReplay, built, {
    sample: "S2",
    stage: "qt-tower-680",
    chart: "chart-sun-004-001",
    neutralTotalScore: resNeutral.totalScore,
    replayTotalScore: resReplay.totalScore,
  });

  const p2 = path.join(repoRoot, "research/20_sample2_gap_analysis/sim_trace_full.json");
  writeFileSync(p2, JSON.stringify(out, null, 2));
  console.log(`Saved S2 trace to ${p2}`);

  return { resNeutral, resReplay, out };
}

function dumpS3(data: SimSourceData) {
  console.log("--- Processing Sample 3 (S3) ---");
  const cfgJson = readJson(path.join(repoRoot, "../aipura_nox/サンプル3/deck.json"));
  cfgJson.deck.characters[3].ct_cuts = [{ skill: 2, value: 5 }];
  for (const p of cfgJson.myPhotos as Array<{ id: string; skill: Record<string, unknown> | null }>) {
    if (p.id === "uph-lane5-3" && p.skill !== null) {
      p.skill.staminaScaling = "more_stamina";
    }
  }
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

  const goldenPhotoNames = (() => {
    try {
      const sample = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"));
      return (sample.characters as Array<{ photos: Array<{ name?: string }> }>).map((c) =>
        c.photos.map((p) => p.name ?? ""),
      );
    } catch {
      return undefined;
    }
  })();

  const built = buildSimulateInput({
    deck: d,
    stageFile: "qt-ex-tower-005-045",
    chartFile: "chart-thrx-004-001",
    data,
    audience: 8000,
    mentalOverride: cfgJson.mentalOverride,
    missedNotes: cfgJson.missedNotes,
    disabledSkillIds: cfgJson.disabledSkillIds,
    userPhotoSkills,
    goldenPhotoNames,
  } as any);

  // 1. 確定値ラン
  const resNeutral = simulateTimeline({
    ...built.base,
    rng: new NeutralRng(),
    criticalProvider: () => false,
  });

  // 2. 実機クリティカル再現ラン
  const critRaw = readJson(path.join(repoRoot, "../aipura_nox/サンプル3/measured_data_v2.json")).critical_flags;
  const critByBeat = new Map<number, boolean[]>();
  for (const row of critRaw.beats as Array<{ beat: number; lanes: boolean[] }>) {
    critByBeat.set(row.beat, row.lanes);
  }
  const resReplay = simulateTimeline({
    ...built.base,
    rng: new NeutralRng(),
    criticalProvider: (beat: number, lane: number) => {
      return critByBeat.get(beat)?.[lane - 1] === true;
    },
  });

  console.log(`S3 Neutral Total: ${resNeutral.totalScore}`);
  console.log(`S3 Replay Total:  ${resReplay.totalScore}`);

  const out = formatTraceOutput(resReplay, built, {
    sample: "S3",
    stage: "qt-ex-tower-005-045",
    chart: "chart-thrx-004-001",
    neutralTotalScore: resNeutral.totalScore,
    replayTotalScore: resReplay.totalScore,
  });

  const p3 = path.join(repoRoot, "research/21_sample3_gap_analysis/sim_trace_full.json");
  writeFileSync(p3, JSON.stringify(out, null, 2));
  console.log(`Saved S3 trace to ${p3}`);

  return { resNeutral, resReplay, out };
}

async function main() {
  const data = loadSharedData();
  const s1 = dumpS1(data);
  const s2 = dumpS2(data);
  const s3 = dumpS3(data);

  // research/26_data_integrity にもトレースサマリを保存
  const outDir26 = path.join(repoRoot, "research/26_data_integrity");
  mkdirSync(outDir26, { recursive: true });

  const summary = {
    timestamp: new Date().toISOString(),
    engineModel: "Phase 14 (Effective N-1 Decay & Restored Master Skills)",
    samples: {
      S1: {
        stage: "qt-area-1-001",
        chart: "chart-hsm-006-001",
        beatsCount: s1.out.beats.length,
        neutralTotalScore: s1.resNeutral.totalScore,
        replayTotalScore: s1.resReplay.totalScore,
      },
      S2: {
        stage: "qt-tower-680",
        chart: "chart-sun-004-001",
        beatsCount: s2.out.beats.length,
        neutralTotalScore: s2.resNeutral.totalScore,
        replayTotalScore: s2.resReplay.totalScore,
      },
      S3: {
        stage: "qt-ex-tower-005-045",
        chart: "chart-thrx-004-001",
        beatsCount: s3.out.beats.length,
        neutralTotalScore: s3.resNeutral.totalScore,
        replayTotalScore: s3.resReplay.totalScore,
      },
    },
  };

  writeFileSync(
    path.join(outDir26, "samples_trace_summary.json"),
    JSON.stringify(summary, null, 2),
    "utf-8"
  );
  console.log("Successfully generated all sample traces.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

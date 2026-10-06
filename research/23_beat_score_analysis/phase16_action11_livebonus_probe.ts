/** Phase 16 Action11 出発点: S2 のライブボーナス寄与（あり/なし）と発動件数を測る読み取り専用プローブ。実行はリポジトリルートから: npx tsx research/23_beat_score_analysis/phase16_action11_livebonus_probe.ts */
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { NeutralRng } from "../../src/rng/neutral.js";
import { myPhotoToSkillDef, type MyPhotoDef } from "../../src/photos.js";

const repoRoot = process.cwd();
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf8"));

function loadData(): SimSourceData {
  const dataDir = path.join(repoRoot, "data");
  const idx = readJson(path.join(dataDir, "stages_index.json"));
  const allCharts = readJson(path.join(dataDir, "charts_all.json"));
  const mkStage = (qid: string): [string, any] => {
    const q = idx.quests.find((x: any) => x.id === qid);
    const c = idx.configs[q.c];
    return [
      qid,
      {
        beatWeightsPermil: { vocal: c.w[0], dance: c.w[1], visual: c.w[2] },
        skillWeightsPermil: { active: c.aw[0], special: c.aw[1] },
        skillStaminaWeightPermil: c.st ?? 1000,
        laneAttributes: c.a,
      },
    ];
  };
  const mkChart = (cid: string): [string, any] => [
    cid,
    {
      notes: (allCharts[cid] as Array<[number, number]>).map((n: any, i: number) => ({
        beat: i + 1,
        type: n[0],
        position: n[1],
      })),
    },
  ];
  return {
    cards: readJson(path.join(dataDir, "cards.json")).cards,
    cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
    skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
    stages: Object.fromEntries(["qt-tower-680"].map(mkStage)),
    charts: Object.fromEntries(["chart-sun-004-001"].map(mkChart)),
    audienceAdvantage: readJson(path.join(dataDir, "stages/audience_advantage.json")),
    skillsByCard: readJson(path.join(dataDir, "skills_master.json")).byCard,
    skillLevels: readJson(path.join(dataDir, "skills_levels.json")),
    liveBonusesByQuest: readJson(path.join(dataDir, "live_bonuses.json")).byQuest,
    characterAdvantageByQuest: readJson(path.join(dataDir, "character_advantage.json")).byQuest,
  } as any;
}

function critMap(): Map<number, boolean[]> {
  const raw = readJson(path.join(noxRoot, "サンプル2", "measured_data_v2.json"));
  const root = raw?.critical_flags ?? raw;
  const out = new Map<number, boolean[]>();
  for (const [k, v] of Object.entries(root ?? {})) {
    const m = /^b0*(\d+)_L(\d)$/.exec(k);
    if (m === null) continue;
    const arr = out.get(Number(m[1])) ?? [false, false, false, false, false];
    arr[Number(m[2]) - 1] = v === true;
    out.set(Number(m[1]), arr);
  }
  return out;
}

const golden = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"));
const goldenNames: string[][] = (golden.characters as any[]).map((ch: any) =>
  (ch.photos ?? []).map((p: any) => p.name ?? ""),
);

function run(useLiveBonus: boolean) {
  const data = loadData();
  if (!useLiveBonus) data.liveBonusesByQuest = {};
  const raw = readJson(path.join(noxRoot, "サンプル2", "deck.json"));
  const deck = JSON.parse(JSON.stringify(raw.deck ?? raw));
  // マイフォト（持ち込みフォト）のスキル。A10/A9 ハーネスと同一の解決（photoEquip → myPhotos）
  const myPhotos: MyPhotoDef[] = raw.myPhotos ?? [];
  const userPhotoSkills =
    myPhotos.length > 0
      ? (raw.photoEquip ?? []).flatMap((ids: string[], i: number) =>
          ids.flatMap((pid: string, j: number) => {
            const p = myPhotos.find((x: any) => x?.id === pid);
            if (p === undefined) return [];
            const def = myPhotoToSkillDef(p, (i + 1) as any, j + 1);
            return def !== null ? [def] : [];
          }),
        )
      : undefined;
  const built = buildSimulateInput({
    deck,
    stageFile: "qt-tower-680",
    chartFile: "chart-sun-004-001",
    data,
    audience: 13206,
    mentalOverride: raw.mentalOverride,
    missedNotes: raw.missedNotes,
    disabledSkillIds: raw.disabledSkillIds,
    userPhotoSkills,
    goldenPhotoNames: goldenNames,
  } as any);
  const crit = critMap();
  const res = simulateTimeline({
    ...built.base,
    rng: new NeutralRng(),
    criticalProvider: (beat: number, lane: number) => crit.get(beat)?.[lane - 1] === true,
  } as any);
  const lb = (res.activations as any[]).filter((a) => a.lane === 0);
  return { res, lb, warnings: built.warnings };
}

for (const flag of [true, false]) {
  const { res, lb } = run(flag);
  const laneTotals = [1, 2, 3, 4, 5].map((l) =>
    res.beats.flatMap((b) => b.events).filter((e: any) => e.lane === l).reduce((a: number, e: any) => a + e.gainedScore, 0),
  );
  console.log(
    `liveBonus=${flag ? "あり" : "なし"}: total ${res.totalScore.toLocaleString("en-US")} = ${(
      (res.totalScore / 77732383 - 1) * 100
    ).toFixed(2)}% | lanes ${laneTotals.map((v) => Math.round(v).toLocaleString("en-US")).join(" / ")}`,
  );
  if (flag) {
    console.log(`  ライボ発動 ${lb.length} 件:`, lb.map((a) => `b${a.beat}/${a.phase ?? ""}`).join(" "));
    for (const a of lb) console.log("   ", JSON.stringify(a).slice(0, 320));
  }
}

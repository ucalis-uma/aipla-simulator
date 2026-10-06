/**
 * Phase 16 アクション4 調査用プローブ（read-only）:
 *   S3 の発動ビート b63 / b71 / b141 で「バー増分 > レーン別ポップ合計」となる 10% の正体を
 *   sim（実測クリ再現・乱数中立）のイベント内訳と突き合わせて特定する。
 *
 * 実行: npx tsx research/23_beat_score_analysis/tmp_a4_s3_beats.ts
 * 出典: tools/analyze_beat_score_models.ts の buildS3 と同一の build 手順（dumpS3 互換）。
 */
import { readFileSync } from "node:fs";
// 注: 出力は下の console.log をそのまま使う（実行時に shell のリダイレクトで
//     tmp_a4_s3_beats_out.txt へ落とす。本スクリプトは書き込みを行わない）
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { NeutralRng } from "../../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../../src/photos.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));

function loadS23Data(): SimSourceData {
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
    stages: Object.fromEntries([mkStage("qt-tower-680"), mkStage("qt-ex-tower-005-045")]),
    charts: Object.fromEntries([mkChart("chart-sun-004-001"), mkChart("chart-thrx-004-001")]),
    audienceAdvantage: readJson(path.join(dataDir, "stages/audience_advantage.json")),
    skillsByCard: readJson(path.join(dataDir, "skills_master.json")).byCard,
    skillLevels: readJson(path.join(dataDir, "skills_levels.json")),
    liveBonusesByQuest: readJson(path.join(dataDir, "live_bonuses.json")).byQuest,
    characterAdvantageByQuest: readJson(path.join(dataDir, "character_advantage.json")).byQuest,
  };
}


const cfgJson = readJson(path.join(noxRoot, "サンプル3", "deck.json"));
cfgJson.deck.characters[3].ct_cuts = [{ skill: 2, value: 5 }];
for (const ph of cfgJson.myPhotos as any[]) {
  if (ph.id === "uph-lane5-3" && ph.skill !== null) ph.skill.staminaScaling = "more_stamina";
}
const d = cfgJson.deck;
const myPhotos: MyPhotoDef[] = cfgJson.myPhotos ?? [];
const photoEquip: string[][] = cfgJson.photoEquip ?? [];
photoEquip.forEach((ids: string[], i: number) => {
  const ch = d.characters[i];
  if (ch === undefined || !Array.isArray(ch.photos)) return;
  const equipped = ids
    .map((pid: string) => myPhotos.find((x: any) => x?.id === pid))
    .filter((p: any): p is MyPhotoDef => p !== undefined);
  ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
});
const userPhotoSkills = myPhotos.length > 0
  ? photoEquip.flatMap((ids: string[], i: number) =>
      ids.flatMap((pid: string, j: number) => {
        const p = myPhotos.find((x: any) => x?.id === pid);
        if (p === undefined) return [];
        const def = myPhotoToSkillDef(p, (i + 1) as any, j + 1);
        return def !== null ? [def] : [];
      }),
    )
  : undefined;

const built = buildSimulateInput({
  deck: d,
  stageFile: "qt-ex-tower-005-045",
  chartFile: "chart-thrx-004-001",
  data: loadS23Data(),
  audience: 8000,
  mentalOverride: cfgJson.mentalOverride,
  missedNotes: cfgJson.missedNotes,
  disabledSkillIds: cfgJson.disabledSkillIds,
  userPhotoSkills,
} as any);

const m = readJson(path.join(repoRoot, "research/26_data_integrity/measured_data_s3_v3.json"));
const critRaw = readJson(path.join(noxRoot, "サンプル3", "measured_data_v2.json")).critical_flags;
const crit = new Map<number, boolean[]>();
for (const row of critRaw.beats as Array<{ beat: number; lanes: boolean[] }>) {
  crit.set(row.beat, row.lanes ?? [false, false, false, false, false]);
}
const res = simulateTimeline({
  ...built.base,
  rng: new NeutralRng(),
  criticalProvider: (beat: number, lane: number) => crit.get(beat)?.[lane - 1] === true,
});



// 調査対象ビート: b61/b73 = バナーが出て pop が null になったビート（アクション4で追加）
// b62/b64/b72/b140 = 対照（バナーなし・pop 全読み）／b70/b142 = バー 0 のビート
const BEATS = [61, 62, 63, 64, 70, 71, 72, 73, 140, 141, 142];
const parsePop = (text: string | null | undefined): number =>
  typeof text === "string" ? Math.round(Number(text.replace(/[+K]/g, "")) * 1000) : 0;

console.log("=== S3: 発動ビート周辺の内訳（sim: 実測クリ再現・rand=1000） ===");
// 【Phase 16-A4】満員会場（S3: 合計 40,000 = cap）での新旧ファンの総スコア比較。
// 従来 = fanBaseCount（引力度モデル: 非集目 4 レーン 1356‰ / L3 集目 1568‰）
// 新 = laneFans（満員ガード → 全レーン一律 f(8000) = 1375‰）
{
  const builtLane = buildSimulateInput({
    deck: d,
    stageFile: "qt-ex-tower-005-045",
    chartFile: "chart-thrx-004-001",
    data: loadS23Data(),
    audience: 8000,
    laneFans: [8515, 7748, 8535, 8518, 6684],
    maxCapacity: 40000,
    mentalOverride: cfgJson.mentalOverride,
    missedNotes: cfgJson.missedNotes,
    disabledSkillIds: cfgJson.disabledSkillIds,
    userPhotoSkills,
  } as any);
  const resLane = simulateTimeline({
    ...builtLane.base,
    rng: new NeutralRng(),
    criticalProvider: (beat: number, lane: number) => crit.get(beat)?.[lane - 1] === true,
  });
  const measured = 79_411_389; // 実測（analysis と同じ値）
  const oldTotal = res.totalScore;
  const newTotal = resLane.totalScore;
  console.log(
    `\n--- 満員会場（S3）でのファン経路の比較: 従来(引力度) ${oldTotal.toLocaleString()} ` +
      `(${(((oldTotal - measured) / measured) * 100).toFixed(2)}%) / ` +
      `新(laneFans 満員一律 1375‰) ${newTotal.toLocaleString()} ` +
      `(${(((newTotal - measured) / measured) * 100).toFixed(2)}%) / 実測 ${measured.toLocaleString()}`,
  );
  console.log(`    新経路の laneFanFactorPermil = ${JSON.stringify(builtLane.base.laneFanFactorPermil)}`);
  console.log(`    warnings: ${builtLane.warnings.join(" | ")}`);
}
for (const b of BEATS) {
  const tr = res.beats.find((x: any) => x.beat === b) as any;
  const row = (m.timeline as any[]).find((x) => x.beat === b);
  const pops = [1, 2, 3, 4, 5].map((l) => row?.lanes?.[String(l)]?.gained_score_pop?.text ?? null);
  const popSum = pops.reduce((a: number, t: string | null) => a + parsePop(t), 0);
  const bar = row?.beat_gained_score ?? 0;
  console.log(`\n--- b${b}: 実測バー ${bar.toLocaleString()} / ポップ合計 ${popSum.toLocaleString()}（差 ${(bar - popSum).toLocaleString()}）/ act=${JSON.stringify(row?.skill_activations ?? [])}`);
  console.log(`    実測ポップ: ${pops.map((t: string | null, i: number) => `L${i + 1} ${t}`).join(" / ")}`);
  if (tr === undefined) { console.log("    sim: (なし)"); continue; }
  console.log(`    sim beat 合計 ${tr.gainedScore.toLocaleString()}（events ${tr.events.length}）`);
  for (const ev of tr.events as any[]) {
    console.log(
      `      L${ev.lane} ${String(ev.sourceKind).padEnd(9)} gained ${String(ev.gainedScore).padStart(12)} | basic ${String(ev.basicScore).padStart(10)} b1 ${ev.b1Permil} combo ${ev.comboFactorPermil} fan ${ev.fanFactorPermil} crit ${ev.critFactorPermil} rand ${ev.randPermil}`,
    );
  }
  const simPop = [1, 2, 3, 4, 5].map((l) => (tr.events as any[]).filter((e: any) => e.lane === l).reduce((a: number, e: any) => a + e.gainedScore, 0));
  console.log(`    sim レーン別: ${simPop.map((v, i) => `L${i + 1} ${v.toLocaleString()}`).join(" / ")}`);
}

/**
 * Phase 16 Action10: **sim 側セルダンプ**（`tools/audit_hidden_cells.mjs` の下請け・port）
 *
 * A8 の `research/23_beat_score_analysis/phase16_action8_sim_hidden_cells.ts` の実装を
 * そのまま移植し、「beat:lane → sim 配置スコア」「beat:lane → レーン残スタミナ」を
 * JSON で書き出すだけのツールにしたもの（判定は持たない＝ゲートは .mjs 側）。
 *
 * 実行（.mjs から tsx 経由で起動される。直接叩いてもよい）:
 *   npx tsx tools/audit_hidden_cells_sim.ts <out.json> S1,S2,S3 [--mode=lanefans|legacy] [--legacy-photo]
 *
 * 経路（A5/A8 と同一・実測再現の基準）:
 *   - mode=lanefans（既定）: audience + laneFans + maxCapacity（A4 の満員ガード付き表引き）
 *   - mode=legacy         : audience のみ（tools/analyze_beat_score_models.ts と同一経路）
 *   - クリティカルは実測 `critical_flags` を注入（NeutralRng・確率 1000）
 *   - `--legacy-photo`: goldenPhotoNames を渡さない（A8 当時の既定 = F3 前は T5 フォトが素通り）
 *     既定では T5 実測サンプルのフォト名を渡す（受け入れ基準ハーネスと同一のゲート有効経路）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSimulateInput, type SimSourceData } from "../src/sim/build.js";
import { simulateTimeline } from "../src/timeline/engine.js";
import { NeutralRng } from "../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../src/photos.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, "utf8"));

const argv = process.argv.slice(2);
const outPath = argv.find((a) => !a.startsWith("--")) ?? path.join(repoRoot, "tmp_sim_cells.json");
const sampleArg =
  argv.find((a, i) => !a.startsWith("--") && i > 0) ?? "S1,S2,S3";
const MODE = (argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "lanefans") as
  | "lanefans"
  | "legacy";
const LEGACY_PHOTO = argv.includes("--legacy-photo");

/* ===================== サンプル定義（A5/A8/A9 と同一） ===================== */
const CASES: any[] = [
  {
    id: "S1",
    deck: path.join(noxRoot, "サンプル1", "deck.json"),
    stageFile: "qt-area-1-001",
    chartFile: "chart-hsm-006-001",
    audience: 20,
    laneFans: [19, 19, 18, 22, 22],
    maxCapacity: 100,
    critFile: path.join(noxRoot, "サンプル1", "measured_data_v2.json"),
    critFormat: "beatMap",
  },
  {
    id: "S2",
    deck: path.join(noxRoot, "サンプル2", "deck.json"),
    stageFile: "qt-tower-680",
    chartFile: "chart-sun-004-001",
    audience: 13206,
    laneFans: [11996, 13543, 13741, 13255, 13496],
    maxCapacity: 70000,
    critFile: path.join(noxRoot, "サンプル2", "measured_data_v2.json"),
    critFormat: "keys",
  },
  {
    id: "S3",
    deck: path.join(noxRoot, "サンプル3", "deck.json"),
    stageFile: "qt-ex-tower-005-045",
    chartFile: "chart-thrx-004-001",
    audience: 8000,
    laneFans: [8515, 7748, 8535, 8518, 6684],
    maxCapacity: 40000,
    s3Fixes: true,
    critFile: path.join(noxRoot, "サンプル3", "measured_data_v2.json"),
    critFormat: "beats",
  },
];

/* ===================== データ供給（A9 と同一） ===================== */
function loadData(stageIds: string[], chartIds: string[]): SimSourceData {
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
    stages: Object.fromEntries(stageIds.map(mkStage)),
    charts: Object.fromEntries(chartIds.map(mkChart)),
    audienceAdvantage: readJson(path.join(dataDir, "stages/audience_advantage.json")),
    skillsByCard: readJson(path.join(dataDir, "skills_master.json")).byCard,
    skillLevels: readJson(path.join(dataDir, "skills_levels.json")),
    liveBonusesByQuest: readJson(path.join(dataDir, "live_bonuses.json")).byQuest,
    characterAdvantageByQuest: readJson(path.join(dataDir, "character_advantage.json")).byQuest,
  } as any;
}

/* ===================== クリティカル（実測注入） ===================== */
function critFromBeats(root: any): Map<number, boolean[]> {
  const out = new Map<number, boolean[]>();
  for (const r of (root?.beats ?? []) as any[]) {
    if (typeof r?.beat !== "number") continue;
    out.set(r.beat, (r.lanes ?? []).map((x: any) => x === true));
  }
  return out;
}
function critFromKeys(root: any): Map<number, boolean[]> {
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
function critFromBeatMap(root: any): Map<number, boolean[]> {
  const out = new Map<number, boolean[]>();
  for (const [k, v] of Object.entries(root?.beats ?? {})) {
    if (!Number.isFinite(Number(k))) continue;
    const arr = [false, false, false, false, false];
    for (const [lk, lv] of Object.entries((v ?? {}) as Record<string, unknown>)) {
      const lane = Number(lk);
      if (lane >= 1 && lane <= 5)
        arr[lane - 1] = typeof lv === "string" ? lv.includes("critical") : lv === true;
    }
    out.set(Number(k), arr);
  }
  return out;
}
function loadCrit(c: any): Map<number, boolean[]> {
  const raw = readJson(c.critFile);
  const root = raw?.critical_flags ?? raw;
  if (c.critFormat === "keys") return critFromKeys(root);
  if (c.critFormat === "beatMap") return critFromBeatMap(root);
  return critFromBeats(root);
}

/* ===================== T5 実測フォト名（受け入れ基準ハーネスと同一） ===================== */
function t5GoldenPhotoNames(): string[][] | undefined {
  try {
    const s = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"));
    return (s.characters as any[]).map((ch: any) => (ch.photos ?? []).map((p: any) => p.name ?? ""));
  } catch {
    return undefined;
  }
}

/* ===================== ビルド（deck.json ネスト形式） ===================== */
function buildCase(c: any): { base: any; warnings: string[] } {
  const raw = readJson(c.deck);
  const d = JSON.parse(JSON.stringify(raw.deck ?? raw));
  if (c.s3Fixes === true) {
    d.characters[3].ct_cuts = [{ skill: 2, value: 5 }];
    for (const ph of raw.myPhotos ?? []) {
      if (ph?.id === "uph-lane5-3" && ph.skill !== null) ph.skill.staminaScaling = "more_stamina";
    }
  }
  const myPhotos: MyPhotoDef[] = raw.myPhotos ?? [];
  const photoEquip: string[][] = raw.photoEquip ?? [];
  photoEquip.forEach((ids: string[], i: number) => {
    const ch = d.characters[i];
    if (ch === undefined || !Array.isArray(ch.photos)) return;
    const equipped = ids
      .map((pid: string) => myPhotos.find((x: any) => x?.id === pid))
      .filter((p: any): p is MyPhotoDef => p !== undefined);
    ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
  });
  const userPhotoSkills =
    myPhotos.length > 0
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
    stageFile: c.stageFile,
    chartFile: c.chartFile,
    data: loadData([c.stageFile], [c.chartFile]),
    audience: c.audience,
    ...(MODE === "lanefans" ? { laneFans: c.laneFans, maxCapacity: c.maxCapacity } : {}),
    mentalOverride: raw.mentalOverride,
    missedNotes: raw.missedNotes,
    disabledSkillIds: raw.disabledSkillIds,
    userPhotoSkills,
    goldenPhotoNames: LEGACY_PHOTO ? undefined : t5GoldenPhotoNames(),
  } as any);
  return { base: built.base, warnings: built.warnings };
}

/* ===================== 実行 ===================== */
const want = sampleArg.split(",").map((s) => s.trim().toUpperCase());
const samples: Record<string, any> = {};
for (const c of CASES) {
  if (!want.includes(c.id)) continue;
  const { base, warnings } = buildCase(c);
  const crit = loadCrit(c);
  const res: any = simulateTimeline({
    ...base,
    rng: new NeutralRng(),
    criticalProvider: (beat: number, lane: number) => crit.get(beat)?.[lane - 1] === true,
  });
  const cells: Record<string, number> = {};
  const staminaAfter: Record<string, number> = {};
  for (const b of res.beats as any[]) {
    for (const ev of (b.events ?? []) as any[]) {
      const k = `${b.beat}:${ev.lane}`;
      cells[k] = (cells[k] ?? 0) + (Number(ev.gainedScore) || 0);
    }
    for (let l = 1; l <= 5; l++) {
      const v = b.staminaAfter?.[l - 1];
      if (typeof v === "number") staminaAfter[`${b.beat}:${l}`] = v;
    }
  }
  samples[c.id] = {
    stage: c.stageFile,
    chart: c.chartFile,
    totalScore: res.totalScore,
    laneTotals: (res.laneTotals ?? res.scoresByLane ?? null) as any,
    cells,
    staminaAfter,
    warnings,
  };
  console.log(
    `[sim] ${c.id}: total ${res.totalScore} / cells ${Object.keys(cells).length} / fan=${
      (base as any).fanFactorPermil
    } / laneFans=${JSON.stringify((base as any).laneFanFactorPermil ?? null)}`,
  );
}

fs.writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      generatedBy: "tools/audit_hidden_cells_sim.ts",
      mode: MODE,
      goldenPhotoNames: LEGACY_PHOTO ? "omitted(--legacy-photo)" : "passed(T5 names)",
      samples,
    },
    null,
    0,
  )}\n`,
  "utf8",
);
console.log(`[sim] wrote ${outPath}`);

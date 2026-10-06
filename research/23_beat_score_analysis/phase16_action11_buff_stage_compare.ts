/** Phase 16 Action11 出発点: 実測の効果表示（effects: name+stage）と sim の beats[].buffSnapshots（段数）をセル単位で突合する。
 *  実行: npx tsx research/23_beat_score_analysis/phase16_action11_buff_stage_compare.ts 2   （第1引数 = サンプル番号 1|2）
 *  注意: 実測の「クリティカル係数上昇」と「クリティカル係数上昇超化」は別プール表示だが、
 *        sim 側は critical_coeff_up の 1 キーしか持たないため本スクリプトは両方を同じキーへ寄せている
 *        （＝この行の不一致率 47% は突合方法の産物を含む。プール分離の要否は要検討）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { NeutralRng } from "../../src/rng/neutral.js";
import { myPhotoToSkillDef, type MyPhotoDef } from "../../src/photos.js";

const repoRoot = process.cwd();
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf8"));
const dataDir = path.join(repoRoot, "data");

/** 実測の画面表示名 → sim の BuffKey */
const NAME2KEY: Record<string, string> = {
  ボーカル上昇: "vocal_up",
  ボーカルブースト: "vocal_boost",
  ボーカル上昇超化: "vocal_up_extreme",
  ダンス上昇: "dance_up",
  ダンスブースト: "dance_boost",
  ダンス上昇超化: "dance_up_extreme",
  ビジュアル上昇: "visual_up",
  ビジュアルブースト: "visual_boost",
  ビジュアル上昇超化: "visual_up_extreme",
  ビートスコア上昇: "beat_score_up",
  テンションUP: "tension_up",
  スコア上昇: "score_up",
  Aスキルスコア上昇: "a_skill_score_up",
  SPスキルスコア上昇: "sp_skill_score_up",
  Pスキルスコア上昇: "p_skill_score_up",
  コンボスコア上昇: "combo_score_up",
  クリティカル係数上昇: "critical_coeff_up",
  クリティカル係数上昇超化: "critical_coeff_up",
  クリティカル率上昇: "critical_rate_up",
  スキル成功率上昇: "skill_success_up",
  集目: "focus",
  ステルス: "stealth",
  消費スタミナ低下: "stamina_cost_down",
};

const WATCH = [
  "visual_up",
  "score_up",
  "critical_rate_up",
  "critical_coeff_up",
  "skill_success_up",
  "focus",
  "a_skill_score_up",
  "sp_skill_score_up",
];

function loadData(stageFile: string, chartFile: string): SimSourceData {
  const idx = readJson(path.join(dataDir, "stages_index.json"));
  const allCharts = readJson(path.join(dataDir, "charts_all.json"));
  const q = idx.quests.find((x: any) => x.id === stageFile);
  const c = idx.configs[q.c];
  return {
    cards: readJson(path.join(dataDir, "cards.json")).cards,
    cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
    skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
    stages: {
      [stageFile]: {
        beatWeightsPermil: { vocal: c.w[0], dance: c.w[1], visual: c.w[2] },
        skillWeightsPermil: { active: c.aw[0], special: c.aw[1] },
        skillStaminaWeightPermil: c.st ?? 1000,
        laneAttributes: c.a,
      },
    },
    charts: {
      [chartFile]: {
        notes: (allCharts[chartFile] as Array<[number, number]>).map((n, i) => ({
          beat: i + 1,
          type: n[0],
          position: n[1],
        })),
      },
    },
    audienceAdvantage: readJson(path.join(dataDir, "stages/audience_advantage.json")),
    skillsByCard: readJson(path.join(dataDir, "skills_master.json")).byCard,
    skillLevels: readJson(path.join(dataDir, "skills_levels.json")),
    liveBonusesByQuest: readJson(path.join(dataDir, "live_bonuses.json")).byQuest,
    characterAdvantageByQuest: readJson(path.join(dataDir, "character_advantage.json")).byQuest,
  } as any;
}

const SAMPLE = process.argv[2] ?? "2";
const CASES: Record<string, any> = {
  "1": {
    deck: path.join(noxRoot, "サンプル1", "deck.json"),
    stageFile: "qt-area-1-001",
    chartFile: "chart-hsm-006-001",
    audience: 20,
    critFile: path.join(noxRoot, "サンプル1", "measured_data_v2.json"),
    crit: "beatMap",
    meas: path.join(noxRoot, "サンプル1", "measured_data_v3.json"),
  },
  "2": {
    deck: path.join(noxRoot, "サンプル2", "deck.json"),
    stageFile: "qt-tower-680",
    chartFile: "chart-sun-004-001",
    audience: 13206,
    critFile: path.join(noxRoot, "サンプル2", "measured_data_v2.json"),
    crit: "keys",
    meas: path.join(noxRoot, "サンプル2", "measured_data_v3.json"),
  },
};
const cfg = CASES[SAMPLE];
const raw = readJson(cfg.deck);
const deck = JSON.parse(JSON.stringify(raw.deck ?? raw));
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
const golden = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"));
const goldenNames = (golden.characters as any[]).map((ch: any) => (ch.photos ?? []).map((p: any) => p.name ?? ""));
const built = buildSimulateInput({
  deck,
  stageFile: cfg.stageFile,
  chartFile: cfg.chartFile,
  data: loadData(cfg.stageFile, cfg.chartFile),
  audience: cfg.audience,
  mentalOverride: raw.mentalOverride,
  missedNotes: raw.missedNotes,
  disabledSkillIds: raw.disabledSkillIds,
  userPhotoSkills,
  goldenPhotoNames: goldenNames,
} as any);

const critRaw = readJson(cfg.critFile);
const critRoot = critRaw?.critical_flags ?? critRaw;
const crit = new Map<number, boolean[]>();
if (cfg.crit === "keys") {
  for (const [k, v] of Object.entries(critRoot ?? {})) {
    const m = /^b0*(\d+)_L(\d)$/.exec(k);
    if (m === null) continue;
    const arr = crit.get(Number(m[1])) ?? [false, false, false, false, false];
    arr[Number(m[2]) - 1] = v === true;
    crit.set(Number(m[1]), arr);
  }
} else {
  for (const [k, v] of Object.entries((critRoot as any)?.beats ?? {})) {
    const arr = [false, false, false, false, false];
    for (const [lk, lv] of Object.entries((v ?? {}) as Record<string, unknown>)) {
      const lane = Number(lk);
      if (lane >= 1 && lane <= 5) arr[lane - 1] = typeof lv === "string" ? lv.includes("critical") : lv === true;
    }
    crit.set(Number(k), arr);
  }
}
const res: any = simulateTimeline({
  ...built.base,
  rng: new NeutralRng(),
  criticalProvider: (beat: number, lane: number) => crit.get(beat)?.[lane - 1] === true,
});
console.log(`サンプル${SAMPLE} sim total ${res.totalScore.toLocaleString("en-US")}`);

const meas = readJson(cfg.meas);
const readLane = (row: any, l: number) => {
  const L = row.lanes;
  return Array.isArray(L) ? L[l - 1] : (L[String(l)] ?? L[`lane${l}`]);
};

type Stat = { n: number; okSame: number; okNext: number; diffSum: number; diffN: number; examples: string[] };
const stats = new Map<string, Stat>();
for (const k of WATCH) stats.set(k, { n: 0, okSame: 0, okNext: 0, diffSum: 0, diffN: 0, examples: [] });

let cellsWithEffects = 0;
let cellsAllMatched = 0;
for (const row of meas.timeline as any[]) {
  for (let l = 1; l <= 5; l++) {
    const cell = readLane(row, l);
    const effs: any[] = cell?.effects ?? [];
    if (effs.length === 0) continue;
    cellsWithEffects++;
    const same = res.beats[row.beat - 1]?.buffSnapshots?.[l - 1] ?? {};
    const next = res.beats[row.beat]?.buffSnapshots?.[l - 1] ?? {};
    let allOk = true;
    for (const e of effs) {
      const key = NAME2KEY[String(e.name)];
      if (key === undefined || !stats.has(key)) continue;
      const st = stats.get(key)!;
      const want = Number(e.stage ?? 0);
      const got = same[key] ?? 0;
      const gotNext = next[key] ?? 0;
      st.n++;
      if (got === want) st.okSame++;
      if (gotNext === want) st.okNext++;
      const best = got === want ? got : gotNext;
      if (best !== want) {
        allOk = false;
        st.diffSum += want - best;
        st.diffN++;
        if (st.examples.length < 3)
          st.examples.push(`b${row.beat}×L${l} 実測${want} vs sim${got}${gotNext !== got ? `/next${gotNext}` : ""}`);
      }
    }
    if (allOk) cellsAllMatched++;
  }
}
console.log(`効果表示のあるセル ${cellsWithEffects} / 全項目一致（同ビートまたは次ビート） ${cellsAllMatched}`);
console.log("key                 n   一致(同)  一致(次)  不一致時の平均(実測−sim)  例");
for (const [k, s] of stats) {
  if (s.n === 0) continue;
  const avg = s.diffN === 0 ? 0 : s.diffSum / s.diffN;
  console.log(
    `${k.padEnd(20)}${String(s.n).padStart(4)} ${String(s.okSame).padStart(8)} ${String(s.okNext).padStart(9)} ` +
      `${avg.toFixed(2).padStart(12)}   ${s.examples.join(" | ")}`,
  );
}

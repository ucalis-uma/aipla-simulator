/**
 * Phase 16 Action11 タスク2: 素点式の重みを**実測から直接**解く（読み取り専用）。
 *
 * 各セル（ビート素点のみ・act なし・pop 可読）について
 *   Y_c = basic_c × (pop_c / gained_c) × (140/8)
 * は「実測が要求する basicSum」であり、これは
 *   basicSum_c = Σ_attr deck_i[attr] × liveStatusMultiplierPermil(snap_c, attr)/1000 × w'_attr
 * の形をしている。セルについて和を取れば
 *   Σ_c Y_c = Σ_attr ( Σ_c deck_i[attr]·mult_c(attr)/1000 ) · w'_attr  = E_i · w'
 * というレーンごとの 1 本の線形式になる（5 レーン → 5 式 / 未知 3）。
 * これを最小二乗で解き、現行 (600,250,150) との比を出す。
 *
 *   npx tsx research/23_beat_score_analysis/phase16_action11_weightfit.ts S1,S2,S3 [--mode=legacy|lanefans]
 */
import fs from "node:fs";
import path from "node:path";
import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { liveStatusMultiplierPermil } from "../../src/timeline/buffs.js";
import { NeutralRng } from "../../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../../src/photos.js";

const repoRoot = process.cwd();
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, "utf8"));
const argv = process.argv.slice(2);
const IDS = (argv.find((a) => !a.startsWith("--")) ?? "S1,S2,S3").split(",").map((s) => s.trim().toUpperCase());
const MODE = (argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "lanefans") as "legacy" | "lanefans";
const MIN_POP = Number(argv.find((a) => a.startsWith("--min-pop="))?.split("=")[1] ?? 3000);
const WHITE_ONLY = argv.includes("--white");

const CASES: any[] = [
  { id: "S1", dir: "サンプル1", stage: "qt-area-1-001", chart: "chart-hsm-006-001", audience: 20, laneFans: [19, 19, 18, 22, 22], maxCapacity: 100, crit: "beatMap" },
  { id: "S2", dir: "サンプル2", stage: "qt-tower-680", chart: "chart-sun-004-001", audience: 13206, laneFans: [11996, 13543, 13741, 13255, 13496], maxCapacity: 70000, crit: "keys" },
  { id: "S3", dir: "サンプル3", stage: "qt-ex-tower-005-045", chart: "chart-thrx-004-001", audience: 8000, laneFans: [8515, 7748, 8535, 8518, 6684], maxCapacity: 40000, s3Fixes: true, crit: "beats" },
];

function parseK(t: any): number | null {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const u = { "": 1, K: 1000, M: 1e6, G: 1e9 }[m[2].toUpperCase()];
  return u === undefined ? null : Math.round(Number(m[1]) * u);
}

function loadData(stage: string, chart: string): SimSourceData {
  const dataDir = path.join(repoRoot, "data");
  const idx = readJson(path.join(dataDir, "stages_index.json"));
  const allCharts = readJson(path.join(dataDir, "charts_all.json"));
  const q = idx.quests.find((x: any) => x.id === stage);
  const c = idx.configs[q.c];
  return {
    cards: readJson(path.join(dataDir, "cards.json")).cards,
    cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
    skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
    stages: { [stage]: { beatWeightsPermil: { vocal: c.w[0], dance: c.w[1], visual: c.w[2] }, skillWeightsPermil: { active: c.aw[0], special: c.aw[1] }, skillStaminaWeightPermil: c.st ?? 1000, laneAttributes: c.a } },
    charts: { [chart]: { notes: (allCharts[chart] as any[]).map((n: any, i: number) => ({ beat: i + 1, type: n[0], position: n[1] })) } },
    audienceAdvantage: readJson(path.join(dataDir, "stages/audience_advantage.json")),
    skillsByCard: readJson(path.join(dataDir, "skills_master.json")).byCard,
    skillLevels: readJson(path.join(dataDir, "skills_levels.json")),
    liveBonusesByQuest: readJson(path.join(dataDir, "live_bonuses.json")).byQuest,
    characterAdvantageByQuest: readJson(path.join(dataDir, "character_advantage.json")).byQuest,
  } as any;
}

function loadCrit(c: any): Map<number, boolean[]> {
  const raw = readJson(path.join(noxRoot, c.dir, "measured_data_v2.json"));
  const root = raw?.critical_flags ?? raw;
  const out = new Map<number, boolean[]>();
  if (c.crit === "keys") {
    for (const [k, v] of Object.entries(root ?? {})) {
      const m = /^b0*(\d+)_L(\d)$/.exec(k);
      if (m === null) continue;
      const arr = out.get(Number(m[1])) ?? [false, false, false, false, false];
      arr[Number(m[2]) - 1] = v === true;
      out.set(Number(m[1]), arr);
    }
  } else if (c.crit === "beatMap") {
    for (const [k, v] of Object.entries((root as any)?.beats ?? {})) {
      const arr = [false, false, false, false, false];
      for (const [lk, lv] of Object.entries((v ?? {}) as any)) {
        const lane = Number(lk);
        if (lane >= 1 && lane <= 5) arr[lane - 1] = typeof lv === "string" ? (lv as string).includes("critical") : lv === true;
      }
      out.set(Number(k), arr);
    }
  } else {
    for (const r of (root as any)?.beats ?? []) if (typeof r?.beat === "number") out.set(r.beat, (r.lanes ?? []).map((x: any) => x === true));
  }
  return out;
}

/** 3 未知の最小二乗（正規方程式 → ガウス消去） */
function lsq3(rows: number[][], y: number[]): { w: number[]; relRes: number[]; rms: number } {
  const n = 3;
  const M = Array.from({ length: n }, () => new Array(n).fill(0));
  const v = new Array(n).fill(0);
  rows.forEach((r, i) => {
    for (let a = 0; a < n; a++) {
      v[a] += r[a] * y[i];
      for (let b = 0; b < n; b++) M[a][b] += r[a] * r[b];
    }
  });
  const A = M.map((r, i) => [...r, v[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let k = col; k <= n; k++) A[r][k] -= f * A[col][k];
    }
  }
  const w = A.map((r, i) => r[n] / r[i]);
  const fitted = rows.map((r) => r[0] * w[0] + r[1] * w[1] + r[2] * w[2]);
  const relRes = fitted.map((f, i) => f / y[i] - 1);
  return { w, relRes, rms: Math.sqrt(relRes.reduce((a, x) => a + x * x, 0) / relRes.length) };
}

const out: any = { mode: MODE, minPop: MIN_POP, samples: {} };
for (const c of CASES) {
  if (!IDS.includes(c.id)) continue;
  const data = loadData(c.stage, c.chart);
  const raw = readJson(path.join(noxRoot, c.dir, "deck.json"));
  const d = JSON.parse(JSON.stringify(raw.deck ?? raw));
  if (c.s3Fixes === true) {
    d.characters[3].ct_cuts = [{ skill: 2, value: 5 }];
    for (const ph of raw.myPhotos ?? []) if (ph?.id === "uph-lane5-3" && ph.skill !== null) ph.skill.staminaScaling = "more_stamina";
  }
  const myPhotos: MyPhotoDef[] = raw.myPhotos ?? [];
  const photoEquip: string[][] = raw.photoEquip ?? [];
  photoEquip.forEach((ids: string[], i: number) => {
    const ch = d.characters[i];
    if (ch === undefined || !Array.isArray(ch.photos)) return;
    const equipped = ids.map((pid: string) => myPhotos.find((x: any) => x?.id === pid)).filter((p: any) => p !== undefined);
    ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
  });
  const userPhotoSkills = myPhotos.length > 0
    ? photoEquip.flatMap((ids: string[], i: number) => ids.flatMap((pid: string, j: number) => {
        const p = myPhotos.find((x: any) => x?.id === pid);
        if (p === undefined) return [];
        const def = myPhotoToSkillDef(p, (i + 1) as any, j + 1);
        return def !== null ? [def] : [];
      }))
    : undefined;
  const golden = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"));
  const built = buildSimulateInput({
    deck: d, stageFile: c.stage, chartFile: c.chart, data, audience: c.audience,
    ...(MODE === "lanefans" ? { laneFans: c.laneFans, maxCapacity: c.maxCapacity } : {}),
    mentalOverride: raw.mentalOverride, missedNotes: raw.missedNotes, disabledSkillIds: raw.disabledSkillIds,
    userPhotoSkills, goldenPhotoNames: (golden.characters as any[]).map((ch: any) => (ch.photos ?? []).map((p: any) => p.name ?? "")),
  } as any);
  const crit = loadCrit(c);
  const res: any = simulateTimeline({ ...built.base, rng: new NeutralRng(), criticalProvider: (b: number, l: number) => crit.get(b)?.[l - 1] === true });
  const mpath = [`${noxRoot}/${c.dir}/measured_data_v3.json`, `${noxRoot}/${c.dir}/measured_data_v2.json`].find((p) => fs.existsSync(p))!;
  const meas = readJson(mpath);
  const bf = readJson(path.join(noxRoot, c.dir, "lane_pops_backfill.json"));
  const pop = new Map<string, number>();
  for (const x of bf.pops ?? []) {
    if (typeof x?.beat !== "number" || x.readable === false) continue;
    const v = parseK(x.displayed);
    if (v !== null) pop.set(`${x.beat}:${x.lane}`, v);
  }
  for (const row of meas.timeline ?? []) {
    for (let l = 1; l <= 5; l++) {
      const cell = (row.lanes ?? {})[`lane${l}`] ?? (row.lanes ?? {})[l];
      const p = cell?.gained_score_pop;
      const v = typeof p === "object" && p !== null ? parseK(p.text) : parseK(p);
      if (v !== null && !pop.has(`${row.beat}:${l}`)) pop.set(`${row.beat}:${l}`, v);
    }
  }
  const acts = new Set((meas.skill_activations_summary ?? []).map((a: any) => `${a.beat}:${a.lane}`));
  const E: number[][] = [1, 2, 3, 4, 5].map(() => [0, 0, 0]);
  const Y = [0, 0, 0, 0, 0];
  const N = [0, 0, 0, 0, 0];
  for (const b of res.beats as any[]) {
    const snaps: any[] = b.buffSnapshots;
    for (const ev of b.events as any[]) {
      if (ev.sourceKind !== "beat") continue;
      const lane = ev.lane;
      const k = `${b.beat}:${lane}`;
      if (acts.has(k)) continue;
      const p = pop.get(k);
      if (p === undefined || p < MIN_POP) continue;
      const req = ev.basicScore * (p / ev.gainedScore) * (140 / 8);
      const snap = snaps[lane - 1];
      const deck = built.base.lanes[lane - 1].deck;
      const mv = liveStatusMultiplierPermil(snap, "vocal") / 1000;
      const md = liveStatusMultiplierPermil(snap, "dance") / 1000;
      const mvi = liveStatusMultiplierPermil(snap, "visual") / 1000;
      if (WHITE_ONLY && (mv !== 1 || md !== 1 || mvi !== 1)) continue; // ステータスバフ皆無のセルのみ
      // basicSum は permil スケール（Σ deck[attr]·mult·w/1000）なので 1000 で割る
      E[lane - 1][0] += (deck.vocal * mv) / 1000;
      E[lane - 1][1] += (deck.dance * md) / 1000;
      E[lane - 1][2] += (deck.visual * mvi) / 1000;
      Y[lane - 1] += req;
      N[lane - 1]++;
    }
  }
  const w = built.base.stage.beatWeightsPermil;
  console.log(`\n########## ${c.id} (mode=${MODE}, minPop=${MIN_POP}, measured=${mpath.split("/").slice(-1)}) ##########`);
  console.log(`  実測レーン合計=${JSON.stringify((meas.results?.scores_by_lane ?? meas.results?.lane_scores) ?? null)} / sim total=${res.totalScore}`);
  const cur = [w.vocal, w.dance, w.visual];
  for (let l = 1; l <= 5; l++) {
    const lane = built.base.lanes[l - 1];
    const curSum = E[l - 1].reduce((a, e, i) => a + e * cur[i], 0);
    console.log(
      `   L${l} ${String(lane.attribute).padEnd(6)} n=${String(N[l - 1]).padStart(3)}  要求Σ=${Math.round(Y[l - 1]).toLocaleString("en-US")} 現行Σ=${Math.round(curSum).toLocaleString("en-US")} 比=${(Y[l - 1] / curSum).toFixed(4)}`,
    );
  }
  const fit = lsq3(E, Y);
  const sum = fit.w[0] + fit.w[1] + fit.w[2];
  console.log(
    `  ── 実測から解いた重み: vocal=${fit.w[0].toFixed(1)} dance=${fit.w[1].toFixed(1)} visual=${fit.w[2].toFixed(1)}  rms=${(fit.rms * 100).toFixed(2)}%`,
  );
  console.log(
    `     正規化（合計 ${sum.toFixed(0)}）: ${((fit.w[0] / sum) * 1000).toFixed(1)} / ${((fit.w[1] / sum) * 1000).toFixed(1)} / ${((fit.w[2] / sum) * 1000).toFixed(1)}   ／ 現行は ${cur.join(" / ")}（合計 ${cur.reduce((a, b) => a + b, 0)}）`,
  );
  console.log(`     残差=[${fit.relRes.map((r) => (r * 100).toFixed(2) + "%").join(", ")}]`);
  out.samples[c.id] = { stage: built.base.stage, lanes: built.base.lanes.map((l: any) => ({ lane: l.lane, attribute: l.attribute, deck: l.deck })), E, Y, N, fit, cur, total: res.totalScore, measuredLane: meas.results?.scores_by_lane ?? meas.results?.lane_scores ?? null };
}
fs.writeFileSync(path.join(repoRoot, `research/23_beat_score_analysis/phase16_action11_weightfit_${MODE}.json`), JSON.stringify(out, null, 1), "utf8");
console.log(`\n[saved] phase16_action11_weightfit_${MODE}.json`);

/**
 * Phase 16 Action11 タスク2（決定版）: レーンラベルに依存しない重み推定。
 *
 * ビート b について、5 レーン合計の実測ポップは
 *   Σ_i pop_i(b) = Σ_attr w'_attr × G_b[attr],
 *   G_b[attr] = Σ_i deck_i[attr] × mult_i(b,attr)/1000 × F_i(b),
 *   F_i(b) = gained_i(b)/basic_i(b)   ← sim トレースから厳密に取れる（b1/combo/fan/rand/crit/stage）
 * と書ける。つまり **ビートごとに 1 本の線形式**（未知 3）が立ち、140 本を最小二乗できる。
 * レーン横断で和を取るためポップのレーン割当が多少ずれても影響しない。
 *
 *   npx tsx research/23_beat_score_analysis/phase16_action11_beatfit.ts S1,S2,S3 [--mode=legacy|lanefans]
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
const MODE = (argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "legacy") as "legacy" | "lanefans";
const MIN_POP = Number(argv.find((a) => a.startsWith("--min-pop="))?.split("=")[1] ?? 3000);
const CASES: any[] = [
  { id: "S1", dir: "サンプル1", stage: "qt-area-1-001", chart: "chart-hsm-006-001", audience: 20, laneFans: [19, 19, 18, 22, 22], maxCapacity: 100, crit: "beatMap" },
  { id: "S2", dir: "サンプル2", stage: "qt-tower-680", chart: "chart-sun-004-001", audience: 13206, laneFans: [11996, 13543, 13741, 13255, 13496], maxCapacity: 70000, crit: "keys" },
  { id: "S3", dir: "サンプル3", stage: "qt-ex-tower-005-045", chart: "chart-thrx-004-001", audience: 8000, laneFans: [8515, 7748, 8535, 8518, 6684], maxCapacity: 40000, s3Fixes: true, crit: "beats" },
];
const parseK = (t: any): number | null => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const u = { "": 1, K: 1000, M: 1e6, G: 1e9 }[m[2].toUpperCase()];
  return u === undefined ? null : Math.round(Number(m[1]) * u);
};
function loadData(stage: string, chart: string): SimSourceData {
  const dd = path.join(repoRoot, "data");
  const idx = readJson(path.join(dd, "stages_index.json"));
  const allCharts = readJson(path.join(dd, "charts_all.json"));
  const q = idx.quests.find((x: any) => x.id === stage);
  const c = idx.configs[q.c];
  return {
    cards: readJson(path.join(dd, "cards.json")).cards,
    cardParameters: readJson(path.join(dd, "card_parameters.json")).rows,
    skillsGolden: readJson(path.join(dd, "skills_golden.json")).skills,
    stages: { [stage]: { beatWeightsPermil: { vocal: c.w[0], dance: c.w[1], visual: c.w[2] }, skillWeightsPermil: { active: c.aw[0], special: c.aw[1] }, skillStaminaWeightPermil: c.st ?? 1000, laneAttributes: c.a } },
    charts: { [chart]: { notes: (allCharts[chart] as any[]).map((n: any, i: number) => ({ beat: i + 1, type: n[0], position: n[1] })) } },
    audienceAdvantage: readJson(path.join(dd, "stages/audience_advantage.json")),
    skillsByCard: readJson(path.join(dd, "skills_master.json")).byCard,
    skillLevels: readJson(path.join(dd, "skills_levels.json")),
    liveBonusesByQuest: readJson(path.join(dd, "live_bonuses.json")).byQuest,
    characterAdvantageByQuest: readJson(path.join(dd, "character_advantage.json")).byQuest,
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
function solve(rows: number[][], y: number[]) {
  const n = 3;
  const M = Array.from({ length: n }, () => new Array(n).fill(0));
  const v = new Array(n).fill(0);
  rows.forEach((r, i) => { for (let a = 0; a < n; a++) { v[a] += r[a] * y[i]; for (let b = 0; b < n; b++) M[a][b] += r[a] * r[b]; } });
  const A = M.map((r, i) => [...r, v[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < n; r++) { if (r === col) continue; const f = A[r][col] / A[col][col]; for (let k = col; k <= n; k++) A[r][k] -= f * A[col][k]; }
  }
  const w = A.map((r, i) => r[n] / r[i]);
  const res = rows.map((r, i) => (r[0] * w[0] + r[1] * w[1] + r[2] * w[2]) / y[i] - 1);
  return { w, res, rms: Math.sqrt(res.reduce((a, x) => a + x * x, 0) / res.length) };
}
const out: any = { mode: MODE, samples: {} };
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
  const userPhotoSkills = photoEquip.flatMap((ids: string[], i: number) => ids.flatMap((pid: string, j: number) => {
    const p = myPhotos.find((x: any) => x?.id === pid);
    if (p === undefined) return [];
    const def = myPhotoToSkillDef(p, (i + 1) as any, j + 1);
    return def !== null ? [def] : [];
  }));
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
  const rows: number[][] = [];
  const y: number[] = [];
  const beatsUsed: number[] = [];
  for (const b of res.beats as any[]) {
    const snaps: any[] = b.buffSnapshots;
    const beatEvs = (b.events as any[]).filter((e) => e.sourceKind === "beat");
    if (beatEvs.length !== 5) continue;
    let ok = true;
    let sumPop = 0;
    for (const ev of beatEvs) {
      const k = `${b.beat}:${ev.lane}`;
      if (acts.has(k)) { ok = false; break; }
      const p = pop.get(k);
      if (p === undefined || p < MIN_POP) { ok = false; break; }
      sumPop += p;
    }
    if (!ok) continue;
    const G = [0, 0, 0];
    for (const ev of beatEvs) {
      const lane = ev.lane;
      const deck = built.base.lanes[lane - 1].deck;
      const snap = snaps[lane - 1];
      const F = ev.gainedScore / ev.basicScore; // b1/combo/fan/rand/crit/stage/adv（floor 込み）
      const mv = liveStatusMultiplierPermil(snap, "vocal") / 1000;
      const md = liveStatusMultiplierPermil(snap, "dance") / 1000;
      const mvi = liveStatusMultiplierPermil(snap, "visual") / 1000;
      G[0] += ((deck.vocal * mv) / 1000) * F;
      G[1] += ((deck.dance * md) / 1000) * F;
      G[2] += ((deck.visual * mvi) / 1000) * F;
    }
    rows.push(G);
    y.push(sumPop);
    beatsUsed.push(b.beat);
  }
  const w = built.base.stage.beatWeightsPermil;
  const cur = [w.vocal, w.dance, w.visual];
  const curTot = rows.reduce((a, r) => a + r[0] * cur[0] + r[1] * cur[1] + r[2] * cur[2], 0);
  const popTot = y.reduce((a, x) => a + x, 0);
  const fit = solve(rows, y);
  const sum = fit.w[0] + fit.w[1] + fit.w[2];
  console.log(`\n########## ${c.id} (mode=${MODE}) ビート数=${rows.length} ##########`);
  console.log(`  Σpop=${popTot.toLocaleString("en-US")}  現行重みでの予測Σsim=${Math.round(curTot).toLocaleString("en-US")} → 比=${(curTot / popTot).toFixed(4)}`);
  console.log(`  実測から解いた重み: vocal=${fit.w[0].toFixed(1)} dance=${fit.w[1].toFixed(1)} visual=${fit.w[2].toFixed(1)}  rms=${(fit.rms * 100).toFixed(2)}%`);
  console.log(`    正規化(合計1000): ${((fit.w[0] / sum) * 1000).toFixed(1)} / ${((fit.w[1] / sum) * 1000).toFixed(1)} / ${((fit.w[2] / sum) * 1000).toFixed(1)}   ／ 現行 ${cur.join("/")}`);
  out.samples[c.id] = { stage: built.base.stage, n: rows.length, popTot, curTot, cur, fit: { w: fit.w, rms: fit.rms }, beatsUsed, perBeat: rows.map((r, i) => ({ beat: beatsUsed[i], pop: y[i], pred: r[0] * cur[0] + r[1] * cur[1] + r[2] * cur[2] })) };
  // ビート帯ごとの現行比（時間構造を見る）
  const bins = new Map<number, { p: number; c: number }>();
  rows.forEach((r, i) => {
    const bn = Math.floor(beatsUsed[i] / 10) * 10;
    const e = bins.get(bn) ?? { p: 0, c: 0 };
    e.p += y[i]; e.c += r[0] * cur[0] + r[1] * cur[1] + r[2] * cur[2];
    bins.set(bn, e);
  });
  console.log("  ビート帯別 現行予測/実測pop（×(8/140) 済みの比）:");
  const k = 8 / 140;
  console.log("   " + [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([bn, e]) => `b${bn}-:${((e.c * k) / e.p).toFixed(3)}`).join(" "));
}
fs.writeFileSync(path.join(repoRoot, `research/23_beat_score_analysis/phase16_action11_beatfit_${MODE}.json`), JSON.stringify(out, null, 1), "utf8");
console.log(`\n[saved] phase16_action11_beatfit_${MODE}.json`);

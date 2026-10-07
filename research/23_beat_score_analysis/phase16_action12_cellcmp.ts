/**
 * Phase 16 Action12: **口径別セル突合**（タスク0 の裁定・タスク1 の内訳・タスク4 の crit 層別を 1 本で）。
 *
 * `tools/audit_hidden_cells_sim.ts` と同一の CASES/ビルド経路で **legacy と lanefans の両方**を
 * 同一プロセスで回し、実測ポップ（内生 + 遡及）・レーン合計・発動セル・crit フラグと突合する。
 * src/ も実測ファイルも一切変更しない。
 *
 *   npx tsx research/23_beat_score_analysis/phase16_action12_cellcmp.ts S1,S2,S3 \
 *     [--out=research/23_beat_score_analysis/phase16_action12_cellcmp.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { NeutralRng } from "../../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../../src/photos.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, "utf8"));
const LANES = [1, 2, 3, 4, 5];

const argv = process.argv.slice(2);
const IDS = (argv.find((a) => !a.startsWith("--")) ?? "S1,S2,S3").split(",").map((s) => s.trim().toUpperCase());
const OUT = argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "research/23_beat_score_analysis/phase16_action12_cellcmp.json";
const MIN_POP = Number(argv.find((a) => a.startsWith("--min-pop="))?.split("=")[1] ?? 3000);

const CASES: any[] = [
  { id: "S1", dir: "サンプル1", stage: "qt-area-1-001", chart: "chart-hsm-006-001", audience: 20, laneFans: [19, 19, 18, 22, 22], maxCapacity: 100, crit: "beatMap", meas: ["measured_data_v2.json"] },
  { id: "S2", dir: "サンプル2", stage: "qt-tower-680", chart: "chart-sun-004-001", audience: 13206, laneFans: [11996, 13543, 13741, 13255, 13496], maxCapacity: 70000, crit: "keys", meas: ["measured_data_v3.json", "measured_data_v2.json"] },
  { id: "S3", dir: "サンプル3", stage: "qt-ex-tower-005-045", chart: "chart-thrx-004-001", audience: 8000, laneFans: [8515, 7748, 8535, 8518, 6684], maxCapacity: 40000, s3Fixes: true, crit: "beats", meas: ["measured_data_v3.json", "measured_data_v2.json"] },
];

/* ---------------- データ供給 ---------------- */
function loadData(stageIds: string[], chartIds: string[]): SimSourceData {
  const dataDir = path.join(repoRoot, "data");
  const idx = readJson(path.join(dataDir, "stages_index.json"));
  const allCharts = readJson(path.join(dataDir, "charts_all.json"));
  const mkStage = (qid: string): [string, any] => {
    const q = idx.quests.find((x: any) => x.id === qid);
    const c = idx.configs[q.c];
    return [qid, { beatWeightsPermil: { vocal: c.w[0], dance: c.w[1], visual: c.w[2] }, skillWeightsPermil: { active: c.aw[0], special: c.aw[1] }, skillStaminaWeightPermil: c.st ?? 1000, laneAttributes: c.a }];
  };
  const mkChart = (cid: string): [string, any] => [cid, { notes: (allCharts[cid] as Array<[number, number]>).map((n: any, i: number) => ({ beat: i + 1, type: n[0], position: n[1] })) }];
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

function critFromBeats(root: any): Map<number, boolean[]> {
  const out = new Map<number, boolean[]>();
  for (const r of (root?.beats ?? []) as any[]) if (typeof r?.beat === "number") out.set(r.beat, (r.lanes ?? []).map((x: any) => x === true));
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
      if (lane >= 1 && lane <= 5) arr[lane - 1] = typeof lv === "string" ? lv.includes("critical") : lv === true;
    }
    out.set(Number(k), arr);
  }
  return out;
}
function t5GoldenPhotoNames(): string[][] | undefined {
  try {
    const s = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"));
    return (s.characters as any[]).map((ch: any) => (ch.photos ?? []).map((p: any) => p.name ?? ""));
  } catch {
    return undefined;
  }
}

function buildCase(c: any, mode: "legacy" | "lanefans"): any {
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
    const equipped = ids.map((pid: string) => myPhotos.find((x: any) => x?.id === pid)).filter((p: any): p is MyPhotoDef => p !== undefined);
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
  return buildSimulateInput({
    deck: d, stageFile: c.stage, chartFile: c.chart,
    data: loadData([c.stage], [c.chart]),
    audience: c.audience,
    ...(mode === "lanefans" ? { laneFans: c.laneFans, maxCapacity: c.maxCapacity } : {}),
    mentalOverride: raw.mentalOverride, missedNotes: raw.missedNotes, disabledSkillIds: raw.disabledSkillIds,
    userPhotoSkills, goldenPhotoNames: t5GoldenPhotoNames(),
  } as any);
}

/* ---------------- ポップ・実測 ---------------- */
function parseK(text: any): number | null {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(text ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const unit = { "": 1, K: 1000, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return unit === undefined ? null : Math.round(Number(m[1]) * unit);
}
const laneRead = (row: any, lane: number): any => {
  const L = row?.lanes;
  if (L === null || L === undefined) return null;
  return Array.isArray(L) ? (L[lane - 1] ?? null) : (L[String(lane)] ?? L[`lane${lane}`] ?? null);
};

interface MeasCtx {
  file: string;
  total: number | null;
  laneTotals: (number | null)[];
  pops: Map<string, string>;
  popSrc: Map<string, string>;
  actCells: Set<string>;
  actByCell: Map<string, string[]>;
  crit: Map<number, boolean[]>;
  timeline: any[];
}
function loadMeas(c: any): MeasCtx {
  const dir = path.join(noxRoot, c.dir);
  const file = c.meas.map((f: string) => path.join(dir, f)).find((p: string) => fs.existsSync(p));
  const doc = readJson(file);
  const res = doc.results ?? {};
  const raw = res.scores_by_lane ?? res.lane_scores ?? {};
  const laneTotals = LANES.map((l) => {
    const v = raw[String(l)] ?? raw[`lane${l}`];
    return typeof v === "number" ? v : null;
  });
  const pops = new Map<string, string>();
  const popSrc = new Map<string, string>();
  for (const e of doc.timeline ?? []) {
    if (typeof e?.beat !== "number") continue;
    for (const l of LANES) {
      const g = laneRead(e, l)?.gained_score_pop;
      const t = typeof g === "string" ? g : (g?.text ?? null);
      if (parseK(t) !== null && !pops.has(`${e.beat}:${l}`)) { pops.set(`${e.beat}:${l}`, String(t)); popSrc.set(`${e.beat}:${l}`, "inline"); }
    }
  }
  const bf = path.join(dir, "lane_pops_backfill.json");
  if (fs.existsSync(bf)) {
    for (const x of readJson(bf).pops ?? []) {
      if (typeof x?.beat !== "number" || typeof x?.lane !== "number") continue;
      if (x.readable === false) continue;
      if (parseK(x.displayed) === null) continue;
      const k = `${x.beat}:${x.lane}`;
      if (!pops.has(k)) { pops.set(k, String(x.displayed)); popSrc.set(k, "backfill"); }
    }
  }
  const actCells = new Set<string>();
  const actByCell = new Map<string, string[]>();
  const sum = (doc.skill_activations_summary ?? []) as any[];
  for (const row of doc.timeline ?? []) {
    for (const idx of row?.skill_activations ?? []) {
      const a = typeof idx === "number" ? sum[idx] : idx;
      if (a === undefined || a === null) continue;
      const k = `${row.beat}:${a.lane ?? "-"}`;
      actCells.add(k);
      actByCell.set(k, [...(actByCell.get(k) ?? []), `${a.type ?? a.skill_type ?? "?"}:${a.skill_name ?? "?"}`]);
    }
  }
  const root = readJson(path.join(dir, "measured_data_v2.json"))?.critical_flags ?? {};
  const crit = c.crit === "keys" ? critFromKeys(root) : c.crit === "beatMap" ? critFromBeatMap(root) : critFromBeats(root);
  return { file: path.relative(repoRoot, file), total: typeof res.total_score === "number" ? res.total_score : null, laneTotals, pops, popSrc, actCells, actByCell, crit, timeline: doc.timeline ?? [] };
}

/* ---------------- 実行 ---------------- */
const out: any = { generatedBy: "phase16_action12_cellcmp.ts", minPop: MIN_POP, samples: {} };
const say = (s: string) => console.log(s);
const f = (v: any) => (v === null || v === undefined || Number.isNaN(v) ? "null" : Math.round(v).toLocaleString("en-US"));
const fp = (v: number) => v.toFixed(4);

for (const c of CASES) {
  if (!IDS.includes(c.id)) continue;
  const meas = loadMeas(c);
  const runs: Record<string, any> = {};
  for (const mode of ["legacy", "lanefans"] as const) {
    const built = buildCase(c, mode);
    const base = built.base;
    const res: any = simulateTimeline({ ...base, rng: new NeutralRng(), criticalProvider: (b: number, l: number) => meas.crit.get(b)?.[l - 1] === true });
    const cells = new Map<string, any[]>();
    for (const b of res.beats as any[]) for (const ev of (b.events ?? []) as any[]) {
      const k = `${b.beat}:${ev.lane}`;
      cells.set(k, [...(cells.get(k) ?? []), { sourceKind: ev.sourceKind, basicScore: ev.basicScore, b1Permil: ev.b1Permil, comboFactorPermil: ev.comboFactorPermil, fanFactorPermil: ev.fanFactorPermil, randPermil: ev.randPermil, critFactorPermil: ev.critFactorPermil, gainedScore: ev.gainedScore }]);
    }
    runs[mode] = { total: res.totalScore, cells, fanFactor: base.fanFactorPermil, laneFan: base.laneFanFactorPermil ?? null, laneTotals: res.laneTotals ?? null };
  }
  say(`\n########## ${c.id} (${c.stage}) — 実測 ${f(meas.total)} / ${meas.file} ##########`);
  for (const mode of ["legacy", "lanefans"] as const) say(`  sim[${mode}] total ${f(runs[mode].total)} / fan ${runs[mode].fanFactor} / laneFan ${JSON.stringify(runs[mode].laneFan)}`);

  /* ---- A: レーン別 sim/pop（beat セルのみ・act 除外・pop≥MIN） ---- */
  const A: any = {};
  for (const mode of ["legacy", "lanefans"] as const) {
    say(`\n  --- A[${mode}]: レーン別 sim/pop（beat 単独セル・実測 act なし・pop≥${MIN_POP}） ---`);
    say("   レーン  非クリ(sim/pop)   n   |  クリ(sim/pop)   n   |   全体   | legacy比");
    const acc = LANES.map(() => ({ ncS: 0, ncP: 0, ncN: 0, cS: 0, cP: 0, cN: 0 }));
    for (const [k, evs] of runs[mode].cells) {
      if (meas.actCells.has(k)) continue;
      if (evs.length !== 1 || evs[0].sourceKind !== "beat") continue;
      const p = parseK(meas.pops.get(k));
      if (p === null || p < MIN_POP) continue;
      const [bStr, lStr] = k.split(":");
      const li = Number(lStr) - 1;
      void bStr;
      const a = acc[li];
      if (evs[0].critFactorPermil === 1000) { a.ncS += evs[0].gainedScore; a.ncP += p; a.ncN++; } else { a.cS += evs[0].gainedScore; a.cP += p; a.cN++; }
    }
    const rows = acc.map((a, i) => {
      const ncr = a.ncP > 0 ? a.ncS / a.ncP : NaN;
      const cr = a.cP > 0 ? a.cS / a.cP : NaN;
      const all = a.ncP + a.cP > 0 ? (a.ncS + a.cS) / (a.ncP + a.cP) : NaN;
      say(`     L${i + 1}   ${fp(ncr).padStart(8)}  ${String(a.ncN).padStart(4)}   |   ${fp(cr).padStart(8)}  ${String(a.cN).padStart(4)}   | ${fp(all)} | ${LANES.map((x) => x).length > 0 ? "" : ""}`);
      return { lane: i + 1, nonCrit: ncr, nNonCrit: a.ncN, crit: cr, nCrit: a.cN, all, simNonCrit: a.ncS, popNonCrit: a.ncP, simCrit: a.cS, popCrit: a.cP };
    });
    const tot = rows.reduce((s, r) => ({ s: s.s + r.simNonCrit + r.simCrit, p: s.p + r.popNonCrit + r.popCrit }), { s: 0, p: 0 });
    say(`     全体 sim/pop = ${fp(tot.s / tot.p)}（Σsim ${f(tot.s)} / Σpop ${f(tot.p)}）`);
    A[mode] = { rows, overall: tot.s / tot.p, sumSim: tot.s, sumPop: tot.p };
  }
  say("\n   --- A 比較（lanefans ÷ legacy の比） ---");
  for (let i = 0; i < 5; i++) {
    const l = A.legacy.rows[i];
    const n = A.lanefans.rows[i];
    say(`     L${i + 1}  非クリ legacy ${fp(l.nonCrit)} → lanefans ${fp(n.nonCrit)}   /  クリ ${fp(l.crit)} → ${fp(n.crit)}`);
  }

  /* ---- B: source kind 別（可読セル / 隠れセル）＝タスク1 の内訳 ---- */
  const kindAgg: any = {};
  for (const mode of ["legacy", "lanefans"] as const) {
    const kinds = ["beat", "active", "special", "passive", "photo", "live_bonus"];
    const read: any = Object.fromEntries(kinds.map((k) => [k, { sim: 0, n: 0 }]));
    const hidden: any = Object.fromEntries(kinds.map((k) => [k, { sim: 0, n: 0 }]));
    const readPopByShape: any = { singleBeat: { sim: 0, pop: 0, n: 0 }, singleOther: { sim: 0, pop: 0, n: 0 }, multi: { sim: 0, pop: 0, n: 0 } };
    const hiddenFrame: (number | null)[] = LANES.map(() => null);
    const popSum: number[] = LANES.map(() => 0);
    const simRead: number[] = LANES.map(() => 0);
    const simHidden: number[] = LANES.map(() => 0);
    for (const [k, evs] of runs[mode].cells) {
      const li = Number(k.split(":")[1]) - 1;
      const isRead = meas.pops.has(k);
      for (const ev of evs) {
        const kind = ev.sourceKind === "A" ? "active" : ev.sourceKind === "SP" ? "special" : ev.sourceKind === "P" ? "passive" : ev.sourceKind;
        const bucket = isRead ? read : hidden;
        if (bucket[kind] === undefined) bucket[kind] = { sim: 0, n: 0 };
        bucket[kind].sim += ev.gainedScore;
        bucket[kind].n += 1;
      }
      if (isRead) {
        const p = parseK(meas.pops.get(k))!;
        popSum[li] += p;
        simRead[li] += evs.reduce((s: number, e: any) => s + e.gainedScore, 0);
        if (evs.length === 1 && evs[0].sourceKind === "beat") { readPopByShape.singleBeat.sim += evs[0].gainedScore; readPopByShape.singleBeat.pop += p; readPopByShape.singleBeat.n++; }
        else if (evs.length === 1) { readPopByShape.singleOther.sim += evs[0].gainedScore; readPopByShape.singleOther.pop += p; readPopByShape.singleOther.n++; }
        else { readPopByShape.multi.sim += evs.reduce((s: number, e: any) => s + e.gainedScore, 0); readPopByShape.multi.pop += p; readPopByShape.multi.n++; }
      } else {
        simHidden[li] += evs.reduce((s: number, e: any) => s + e.gainedScore, 0);
      }
    }
    LANES.forEach((_, i) => { hiddenFrame[i] = meas.laneTotals[i] === null ? null : (meas.laneTotals[i] as number) - popSum[i]; });
    const totRead = Object.values(read).reduce((s: number, v: any) => s + v.sim, 0);
    const totHidden = Object.values(hidden).reduce((s: number, v: any) => s + v.sim, 0);
    kindAgg[mode] = { read, hidden, readPopByShape, hiddenFrame, popSum, simRead, simHidden, totRead, totHidden };
    say(`\n  --- B[${mode}]: sourceKind 別（可読セル / 隠れセル） ---`);
    say(`     Σpop(可読) ${f(popSum.reduce((a, b) => a + b, 0))} / sim(可読) ${f(totRead)} / 隠れ枠 ${f(hiddenFrame.reduce((a: number, b) => a + (b ?? 0), 0))} / sim(隠れ) ${f(totHidden)}`);
    say("     kind      |  sim(可読)   n | sim(隠れ)   n");
    for (const kind of ["beat", "active", "special", "passive", "photo", "live_bonus"]) {
      say(`     ${kind.padEnd(10)}| ${f(read[kind].sim).padStart(12)} ${String(read[kind].n).padStart(4)} | ${f(hidden[kind].sim).padStart(10)} ${String(hidden[kind].n).padStart(4)}`);
    }
    say(`     可読セルの形: 単独beat ${readPopByShape.singleBeat.n} セル (sim ${f(readPopByShape.singleBeat.sim)} / pop ${f(readPopByShape.singleBeat.pop)}) / ` +
        `単独その他 ${readPopByShape.singleOther.n} (sim ${f(readPopByShape.singleOther.sim)} / pop ${f(readPopByShape.singleOther.pop)}) / ` +
        `複数イベント ${readPopByShape.multi.n} (sim ${f(readPopByShape.multi.sim)} / pop ${f(readPopByShape.multi.pop)})`);
  }
  say(`\n  --- B 比較: 実測内訳（Δ = 実測 − sim）---`);
  const BL = kindAgg.legacy;
  const BN = kindAgg.lanefans;
  const popAll = BL.popSum.reduce((a: number, b: number) => a + b, 0);
  const frameAll = BL.hiddenFrame.reduce((a: number, b: number) => a + (b ?? 0), 0);
  say(`     実測 = Σpop(可読) ${f(popAll)} + 隠れ枠 ${f(frameAll)} = ${f(popAll + frameAll)}（実測合計 ${f(meas.total)}）`);
  for (const mode of ["legacy", "lanefans"] as const) {
    const g = kindAgg[mode];
    say(`     [${mode}] sim = 可読 ${f(g.totRead)} + 隠れ ${f(g.totHidden)} = ${f(g.totRead + g.totHidden)}（実測との差 ${f(g.totRead + g.totHidden - (popAll + frameAll))}）`);
    say(`        可読セルの不足 = ${f(popAll - g.totRead)} / 隠れセルの不足 = ${f(frameAll - g.totHidden)}`);
  }

  /* ---- C: crit 層別（タスク4） ---- */
  say(`\n  --- C: crit 係数層別（pop≥${MIN_POP}・beat 単独・act なし） ---`);
  const layer: any = {};
  for (const mode of ["legacy", "lanefans"] as const) {
    const m = new Map<string, { s: number; p: number; n: number; lanes: Set<number> }>();
    for (const [k, evs] of runs[mode].cells) {
      if (meas.actCells.has(k) || evs.length !== 1 || evs[0].sourceKind !== "beat") continue;
      const p = parseK(meas.pops.get(k));
      if (p === null || p < MIN_POP) continue;
      const lane = Number(k.split(":")[1]);
      const key = `${lane}:${evs[0].critFactorPermil}`;
      const e = m.get(key) ?? { s: 0, p: 0, n: 0, lanes: new Set<number>() };
      e.s += evs[0].gainedScore; e.p += p; e.n++; e.lanes.add(lane);
      m.set(key, e);
    }
    say(`    [${mode}]`);
    const rows = [...m.entries()].map(([k, v]) => ({ key: k, lane: Number(k.split(":")[0]), crit: Number(k.split(":")[1]), ratio: v.s / v.p, n: v.n, pop: v.p, sim: v.s })).sort((a, b) => a.lane - b.lane || a.crit - b.crit);
    for (const r of rows) say(`      L${r.lane} crit=${String(r.crit).padStart(4)}  sim/pop ${fp(r.ratio)}  n=${String(r.n).padStart(3)}  Σpop ${f(r.pop)}`);
    layer[mode] = rows;
  }

  /* ---- D: 「実測が要求するファンファクター」— legacy の集目/ステルス加算が実在するかの判定 ---- */
  //   全ファクターが正しければ  pop/sim_lanefans = fan_required / fan_lanefans。
  //   セルは beat 単独・act なし・pop≥MIN_POP。fan_required = fan_lanefans × pop / sim_lanefans。
  const required: any = { byPair: {}, byLanePair: {}, detail: [] as any[] };
  const pairAgg = new Map<string, { pop: number; sim: number; n: number; need: number[] }>();
  for (const [k, evs] of runs.lanefans.cells) {
    if (meas.actCells.has(k) || evs.length !== 1 || evs[0].sourceKind !== "beat") continue;
    const p = parseK(meas.pops.get(k));
    if (p === null || p < MIN_POP) continue;
    const evN = evs[0];
    const evL = runs.legacy.cells.get(k)?.[0];
    const lane = Number(k.split(":")[1]);
    const need = (evN.fanFactorPermil * p) / evN.gainedScore;
    const key = `L${lane}|legacy=${evL?.fanFactorPermil ?? "-"}|lanefans=${evN.fanFactorPermil}`;
    const a = pairAgg.get(key) ?? { pop: 0, sim: 0, n: 0, need: [] };
    a.pop += p; a.sim += evN.gainedScore; a.n++; a.need.push(need);
    pairAgg.set(key, a);
    required.detail.push({ cell: k, lane, beat: Number(k.split(":")[0]), pop: p, simLanefans: evN.gainedScore, simLegacy: evL?.gainedScore ?? null, fanLegacy: evL?.fanFactorPermil ?? null, fanLanefans: evN.fanFactorPermil, fanRequired: Number(need.toFixed(1)), crit: evN.critFactorPermil });
  }
  say(`\n  --- D: 実測が要求するファンファクター（beat 単独・pop≥${MIN_POP}） ---`);
  say("     lane | fan(legacy) | fan(lanefans) |  n | pop/sim_lanefans | 要求 fan（= fan_lanefans × pop/sim）");
  for (const [key, a] of [...pairAgg.entries()].sort()) {
    const r = a.pop / a.sim;
    const needMean = a.need.reduce((x, y) => x + y, 0) / a.need.length;
    say(`     ${key.padEnd(40)} n=${String(a.n).padStart(3)}  ${fp(r)}  → ${needMean.toFixed(1)}`);
    required.byPair[key] = { n: a.n, pop: a.pop, sim: a.sim, ratio: r, fanRequiredMean: needMean };
  }
  // レーン×legacy fan ごとの時間帯（10 ビート帯）分布
  const bandOf = new Map<string, Map<number, number>>();
  for (const d of required.detail) {
    const key = `L${d.lane}|fan${d.fanLanefans}`;
    const m = bandOf.get(key) ?? new Map<number, number>();
    const band = Math.floor(d.beat / 20) * 20;
    m.set(band, (m.get(band) ?? 0) + 1);
    bandOf.set(key, m);
  }
  say("     --- 20 ビート帯ごとのセル数（レーン×fan） ---");
  for (const [key, m] of [...bandOf.entries()].sort()) {
    say(`     ${key.padEnd(20)} ${[...m.entries()].sort((a, b) => a[0] - b[0]).map(([b, n]) => `b${b}:${n}`).join(" ")}`);
  }

  out.samples[c.id] = { stage: c.stage, measFile: meas.file, measTotal: meas.total, laneTotals: meas.laneTotals, required, sim: Object.fromEntries((["legacy", "lanefans"] as const).map((m) => [m, { total: runs[m].total, fanFactor: runs[m].fanFactor, laneFan: runs[m].laneFan, laneTotals: runs[m].laneTotals }])), A, kindAgg, layer };
  fs.writeFileSync(path.resolve(repoRoot, OUT), JSON.stringify(out, null, 1), "utf8");
}
console.log(`\n[cellcmp] wrote ${OUT}`);

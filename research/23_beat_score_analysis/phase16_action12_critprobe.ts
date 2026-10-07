/**
 * Phase 16 Action12 タスク4: **クリティカル係数の段数集約則の裁定**用プローブ（読み取り専用）。
 *
 * 方針: beat ノート 1 セル（実測 act なし・pop 可読）について、sim の他ファクターを固定して
 * **実測が要求するクリティカル係数**を厳密に逆算する。
 *
 *   final = floor(K × crit) + flat      （K = basic·power·b1·combo·fan·stage·rand·adv の合成）
 *   → K = (sim − flat) / crit_sim ,  要求 crit = crit_sim × (pop − flat) / (sim − flat)
 *   → 要求段数 = (要求 crit − 1500 − critExtras) / 50
 *
 * 同時に engine の `effectInspector` で critical_coeff_up / critical_coeff_limit の
 * **インスタンス内訳**（型・段数・残ビート・出所スキル）を取得し、候補となる集約則を
 * オフラインで再構成して「要求段数を唯一再現する則」があるかを検査する。
 *
 *   npx tsx research/23_beat_score_analysis/phase16_action12_critprobe.ts S1,S2,S3 [--mode=lanefans|legacy]
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
const MODE = (argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "lanefans") as "legacy" | "lanefans";
const MIN_POP = Number(argv.find((a) => a.startsWith("--min-pop="))?.split("=")[1] ?? 3000);
const OUT = argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? `research/23_beat_score_analysis/phase16_action12_critprobe_${MODE}.json`;

const CASES: any[] = [
  { id: "S1", dir: "サンプル1", stage: "qt-area-1-001", chart: "chart-hsm-006-001", audience: 20, laneFans: [19, 19, 18, 22, 22], maxCapacity: 100, crit: "beatMap", meas: ["measured_data_v2.json"] },
  { id: "S2", dir: "サンプル2", stage: "qt-tower-680", chart: "chart-sun-004-001", audience: 13206, laneFans: [11996, 13543, 13741, 13255, 13496], maxCapacity: 70000, crit: "keys", meas: ["measured_data_v3.json", "measured_data_v2.json"] },
  { id: "S3", dir: "サンプル3", stage: "qt-ex-tower-005-045", chart: "chart-thrx-004-001", audience: 8000, laneFans: [8515, 7748, 8535, 8518, 6684], maxCapacity: 40000, s3Fixes: true, crit: "beats", meas: ["measured_data_v3.json", "measured_data_v2.json"] },
];

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
const say = (s: string) => console.log(s);
const out: any = { generatedBy: "phase16_action12_critprobe.ts", mode: MODE, minPop: MIN_POP, samples: {} };

for (const c of CASES) {
  if (!IDS.includes(c.id)) continue;
  const dir = path.join(noxRoot, c.dir);
  const raw = readJson(path.join(dir, "deck.json"));
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
    ch.photos = mergePhotoEquipStatuses(ch.photos, ids.map((pid: string) => myPhotos.find((x: any) => x?.id === pid)).filter((p: any): p is MyPhotoDef => p !== undefined));
  });
  const userPhotoSkills = myPhotos.length > 0
    ? photoEquip.flatMap((ids: string[], i: number) => ids.flatMap((pid: string, j: number) => {
        const p = myPhotos.find((x: any) => x?.id === pid);
        if (p === undefined) return [];
        const def = myPhotoToSkillDef(p, (i + 1) as any, j + 1);
        return def !== null ? [def] : [];
      }))
    : undefined;
  const gp = (() => { try { const s = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json")); return (s.characters as any[]).map((ch: any) => (ch.photos ?? []).map((p: any) => p.name ?? "")); } catch { return undefined; } })();
  const built = buildSimulateInput({
    deck: d, stageFile: c.stage, chartFile: c.chart,
    data: loadData([c.stage], [c.chart]),
    audience: c.audience,
    ...(MODE === "lanefans" ? { laneFans: c.laneFans, maxCapacity: c.maxCapacity } : {}),
    mentalOverride: raw.mentalOverride, missedNotes: raw.missedNotes, disabledSkillIds: raw.disabledSkillIds,
    userPhotoSkills, goldenPhotoNames: gp,
  } as any);
  const base = built.base;
  const laneInfo = base.lanes.map((li: any) => ({
    lane: li.lane, attribute: li.attribute, adv: li.characterAdvantagePermil ?? 1000,
    flat: li.aScoreAdditionalFlat ?? 0, critExtras: li.critExtrasPermil ?? 0, deck: li.deck,
  }));

  // effectInspector で critical 系インスタンス内訳を採取（ステップ11終了時点の内部状態）
  const instAt = new Map<string, any[]>();
  (base as any).effectInspector = (beat: number, states: readonly any[]) => {
    for (const st of states) {
      const lane: number = st.input.lane;
      const list = (st.effects ?? [])
        .filter((e: any) => e.type === "critical_coeff_up" || e.type === "critical_coeff_limit")
        .map((e: any) => ({ type: e.type, stages: e.stages, rem: e.remainingBeats, limitRelease: e.limitRelease === true, capExtend: typeof e.capExtend === "number" ? e.capExtend : e.capExtend === true ? e.stages : 0, src: e.sourceSkillId }));
      instAt.set(`${beat}:${lane}`, list);
    }
  };

  const critRaw = readJson(path.join(dir, "measured_data_v2.json")).critical_flags ?? {};
  const crit = c.crit === "keys" ? critFromKeys(critRaw) : c.crit === "beatMap" ? critFromBeatMap(critRaw) : critFromBeats(critRaw);
  const res: any = simulateTimeline({ ...base, rng: new NeutralRng(), criticalProvider: (b: number, l: number) => crit.get(b)?.[l - 1] === true });

  const pops = new Map<string, number>();
  const measFile = c.meas.map((x: string) => path.join(dir, x)).find((p: string) => fs.existsSync(p))!;
  const mdoc = readJson(measFile);
  for (const e of mdoc.timeline ?? []) for (const l of LANES) {
    const g = laneRead(e, l)?.gained_score_pop;
    const v = parseK(typeof g === "string" ? g : g?.text);
    if (v !== null && !pops.has(`${e.beat}:${l}`)) pops.set(`${e.beat}:${l}`, v);
  }
  const bf = path.join(dir, "lane_pops_backfill.json");
  if (fs.existsSync(bf)) for (const x of readJson(bf).pops ?? []) {
    if (typeof x?.beat !== "number" || typeof x?.lane !== "number" || x.readable === false) continue;
    const v = parseK(x.displayed);
    const k = `${x.beat}:${x.lane}`;
    if (v !== null && !pops.has(k)) pops.set(k, v);
  }
  const actCells = new Set<string>();
  const sumAct = (mdoc.skill_activations_summary ?? []) as any[];
  for (const row of mdoc.timeline ?? []) for (const idx of row?.skill_activations ?? []) {
    const a = typeof idx === "number" ? sumAct[idx] : idx;
    if (a !== null && a !== undefined) actCells.add(`${row.beat}:${a.lane ?? "-"}`);
  }

  /* 候補集約則 */
  const clamp = (v: number, cap: number): number => Math.min(v, cap);
  function candidates(list: any[]): Record<string, number> {
    const ups = list.filter((e) => e.type === "critical_coeff_up");
    const lims = list.filter((e) => e.type === "critical_coeff_limit");
    const sumAll = list.reduce((s, e) => s + e.stages, 0);
    const sumUp = ups.reduce((s, e) => s + e.stages, 0);
    const maxAll = list.reduce((m, e) => Math.max(m, e.stages), 0);
    const capExt = list.reduce((m, e) => Math.max(m, e.capExtend ?? 0), 0);
    const hasLimit = lims.length > 0 || list.some((e) => e.limitRelease === true);
    const capBase = hasLimit ? 30 : 20;
    return {
      C1_sumAll_cap20or30: clamp(sumAll, capBase + capExt), // 現行（aggregateBuffs）
      C2_sumUpOnly_cap20: clamp(sumUp, 20 + capExt),
      C3_maxAll: maxAll,
      C4_sumAll_cap30: clamp(sumAll, 30 + capExt),
      C5_sumUp_cap30: clamp(sumUp, 30 + capExt),
      C6_sumUpOnly_noCap: sumUp,
    };
  }

  const recs: any[] = [];
  for (const b of res.beats as any[]) {
    const snaps: any[] = b.buffSnapshots ?? [];
    const byCell = new Map<number, any[]>();
    for (const ev of (b.events ?? []) as any[]) byCell.set(ev.lane, [...(byCell.get(ev.lane) ?? []), ev]);
    for (const [lane, evs] of byCell) {
      if (evs.length !== 1 || evs[0].sourceKind !== "beat") continue;
      const k = `${b.beat}:${lane}`;
      if (actCells.has(k)) continue;
      const p = pops.get(k);
      if (p === undefined || p < MIN_POP) continue;
      const ev = evs[0];
      const li = laneInfo[lane - 1];
      // beat ノートは flat 加算なし（engine L2271: mulPermil(score, advantage) のみ）
      const flat = 0;
      void li;
      const net = ev.gainedScore - flat;
      if (net <= 0) continue;
      const requiredCrit = (ev.critFactorPermil * (p - flat)) / net;
      const requiredStages = (requiredCrit - 1500 - li.critExtras) / 50;
      const snapStages = snaps[lane - 1]?.critical_coeff_up ?? null;
      const list = instAt.get(`${b.beat}:${lane}`) ?? [];
      const listPrev = instAt.get(`${b.beat - 1}:${lane}`) ?? [];
      recs.push({
        beat: b.beat, lane, critSim: ev.critFactorPermil, critExtras: li.critExtras, flat, adv: li.adv,
        sim: ev.gainedScore, pop: p, requiredCrit: Number(requiredCrit.toFixed(1)), requiredStages: Number(requiredStages.toFixed(2)),
        snapStages, inst: list, instPrev: listPrev, cand: candidates(list), candPrev: candidates(listPrev),
      });
    }
  }

  say(`\n########## ${c.id} (${c.stage}) mode=${MODE} n=${recs.length} ##########`);
  say(`  lane 属性/adv/flat/critExtras: ${laneInfo.map((x: any) => `L${x.lane}:${x.attribute}/${x.adv}/${x.flat}/${x.critExtras}`).join("  ")}`);
  // 集約則の検証（要求段数 vs 候補）
  const rules = ["C1_sumAll_cap20or30", "C2_sumUpOnly_cap20", "C3_maxAll", "C4_sumAll_cap30", "C5_sumUp_cap30", "C6_sumUpOnly_noCap"];
  const summary: any = {};
  for (const lane of LANES) {
    const rs = recs.filter((r) => r.lane === lane);
    if (rs.length === 0) continue;
    say(`  --- L${lane} (n=${rs.length}) ---`);
    // snapStages（エンジンが実際に使った集約値）と候補の一致（タイミング検証）
    const sameBeat = rs.filter((r) => r.snapStages !== null && r.cand.C1_sumAll_cap20or30 === r.snapStages).length;
    const prevBeat = rs.filter((r) => r.snapStages !== null && r.candPrev.C1_sumAll_cap20or30 === r.snapStages).length;
    say(`     タイミング検証: 同一ビートの内訳から C1 を再構成して snapStages と一致 ${sameBeat}/${rs.length} ／ 前ビート基準 ${prevBeat}/${rs.length}`);
    const stat = (xs: number[]) => {
      if (xs.length === 0) return "n/a";
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const rms = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
      return `平均 ${mean.toFixed(2)} rms ${rms.toFixed(2)}`;
    };
    say(`     要求段数 − snapStages: ${stat(rs.map((r) => r.requiredStages - (r.snapStages ?? 0)))}`);
    for (const rule of rules) {
      const d = stat(rs.map((r) => r.requiredStages - r.cand[rule]));
      say(`     要求段数 − ${rule.padEnd(22)}: ${d}`);
      summary[`L${lane}_${rule}`] = d;
    }
    // crit 係数層別の要求段数
    const byCrit = new Map<number, any[]>();
    for (const r of rs) byCrit.set(r.critSim, [...(byCrit.get(r.critSim) ?? []), r]);
    // 非クリ層の pop/sim 平均 = そのレーンの「その他全部」係数 A_nc（時間一定と仮定）
    const nc = byCrit.get(1000) ?? [];
    const aNc = nc.length > 0 ? nc.reduce((a, r) => a + r.pop / r.sim, 0) / nc.length : NaN;
    for (const [cs, arr] of [...byCrit.entries()].sort((a, b) => a[0] - b[0])) {
      const need = arr.reduce((a, r) => a + r.requiredStages, 0) / arr.length;
      const ratio = arr.reduce((a, r) => a + r.pop / r.sim, 0) / arr.length / aNc;
      const critNorm = cs * ratio;
      const stagesNorm = (critNorm - 1500 - arr[0].critExtras) / 50;
      say(`     crit=${String(cs).padStart(4)}: n=${String(arr.length).padStart(3)}  要求段数(sim基準) 平均 ${need.toFixed(2)}  ｜ 正規化 pop/sim 比 ${ratio.toFixed(4)} → 正規化要求 crit ${critNorm.toFixed(0)}・段数 ${stagesNorm.toFixed(2)}  （sim 段数 ${arr[0].snapStages}）`);
    }
  }
  out.samples[c.id] = { stage: c.stage, mode: MODE, laneInfo, n: recs.length, summary, recs: recs.slice(0, 4000) };
  fs.writeFileSync(path.resolve(repoRoot, OUT), JSON.stringify(out, null, 1), "utf8");
}
say(`\n[critprobe] wrote ${OUT}`);

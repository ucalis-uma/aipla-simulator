/**
 * Phase 16 Action12 タスク0 の決め手: **「実測が要求するファンファクター」を
 * 集目/ステルス段数で説明できるか**を検査する読み取り専用プローブ。
 *
 * 動機: lanefans 口径（laneFanFactorPermil 指定時）は engine 側で
 *   `fanF = laneFanF`（実測来場数の表引き or 満員時の f(cap/5)）
 * を素で使い、**集目（focus）の副効果加算と引力再配分を落とす**
 * （src/timeline/engine.ts L2010-2023）。一方 legacy 口径は
 *   `fanF = fanFactorPermilByAttraction(baseCount, focus, stealth, others)`
 * を使う。どちらが実測に合うかを、**セル単位の要求 fan** で判定する。
 *
 *   要求 fan = fan_lanefans × pop / sim_lanefans   （beat 単独セル・実測 act なし・pop≥MIN）
 *
 *   npx tsx research/23_beat_score_analysis/phase16_action12_focusprobe.ts S1,S2,S3
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { NeutralRng } from "../../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../../src/photos.js";
import {
  fanFactorPermilByAttraction,
  focusFanBonusPermil,
  stealthFanBonusPermil,
} from "../../src/timeline/buffs.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, "utf8"));
const LANES = [1, 2, 3, 4, 5];

const argv = process.argv.slice(2);
const IDS = (argv.find((a) => !a.startsWith("--")) ?? "S1,S2,S3").split(",").map((s) => s.trim().toUpperCase());
const MIN_POP = Number(argv.find((a) => a.startsWith("--min-pop="))?.split("=")[1] ?? 3000);
const OUT = argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "research/23_beat_score_analysis/phase16_action12_focusprobe.json";

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
interface Rec { lane: number; beat: number; focus: number; stealth: number; fanLane: number; fanLegacy: number; fanFocusModel: number; fanFocusOnly: number; required: number; crit: number }
const f = (v: any) => (typeof v === "number" ? Math.round(v).toLocaleString("en-US") : String(v));
const out: any = { generatedBy: "phase16_action12_focusprobe.ts", minPop: MIN_POP, samples: {} };

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
    audience: c.audience, laneFans: c.laneFans, maxCapacity: c.maxCapacity,
    mentalOverride: raw.mentalOverride, missedNotes: raw.missedNotes, disabledSkillIds: raw.disabledSkillIds,
    userPhotoSkills, goldenPhotoNames: gp,
  } as any);
  const base = built.base;
  const critFile = path.join(dir, c.meas.find((x: string) => x.startsWith("measured"))!);
  const critRaw = readJson(path.join(dir, "measured_data_v2.json")).critical_flags ?? {};
  const crit = c.crit === "keys" ? critFromKeys(critRaw) : c.crit === "beatMap" ? critFromBeatMap(critRaw) : critFromBeats(critRaw);
  const res: any = simulateTimeline({ ...base, rng: new NeutralRng(), criticalProvider: (b: number, l: number) => crit.get(b)?.[l - 1] === true });
  void critFile;

  // ポップ
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
  const sum = (mdoc.skill_activations_summary ?? []) as any[];
  for (const row of mdoc.timeline ?? []) for (const idx of row?.skill_activations ?? []) {
    const a = typeof idx === "number" ? sum[idx] : idx;
    if (a !== null && a !== undefined) actCells.add(`${row.beat}:${a.lane ?? "-"}`);
  }

  const laneFan: number[] = base.laneFanFactorPermil ?? LANES.map(() => base.fanFactorPermil);
  const baseCount: number | undefined = base.fanBaseCount;
  const recs: Rec[] = [];
  for (const b of res.beats as any[]) {
    const snaps: any[] = b.buffSnapshots ?? [];
    // セル（beat:lane）単位にまとめる（1 セル 1 イベントだけを使う）
    const byCell = new Map<number, any[]>();
    for (const ev of (b.events ?? []) as any[]) byCell.set(ev.lane, [...(byCell.get(ev.lane) ?? []), ev]);
    for (const [lane, evs] of byCell) {
      if (evs.length !== 1 || evs[0].sourceKind !== "beat") continue;
      const ev = evs[0];
      const k = `${b.beat}:${lane}`;
      if (actCells.has(k)) continue;
      const p = pops.get(k);
      if (p === undefined || p < MIN_POP) continue;
      const self = snaps[lane - 1] ?? {};
      const others = LANES.filter((l) => l !== lane).map((l) => ({ focus: snaps[l - 1]?.focus ?? 0, stealth: snaps[l - 1]?.stealth ?? 0 }));
      const stealthOthers = others.reduce((s, o) => s + stealthFanBonusPermil(o.stealth), 0);
      const fanLegacy = baseCount !== undefined ? fanFactorPermilByAttraction(baseCount, self.focus ?? 0, self.stealth ?? 0, others) : 0;
      const fanLane = laneFan[lane - 1];
      const required = (fanLane * p) / ev.gainedScore;
      recs.push({
        lane, beat: b.beat, focus: self.focus ?? 0, stealth: self.stealth ?? 0,
        fanLane, fanLegacy,
        fanFocusModel: fanLane + focusFanBonusPermil(self.focus ?? 0) + stealthOthers,
        fanFocusOnly: fanLane + focusFanBonusPermil(self.focus ?? 0),
        required, crit: ev.critFactorPermil,
      });
    }
  }

  say(`\n########## ${c.id} (${c.stage}) base=${baseCount} laneFan=${JSON.stringify(laneFan)} n=${recs.length} ##########`);
  const stat = (xs: number[]) => {
    if (xs.length === 0) return { n: 0, mean: NaN, rms: NaN, min: NaN, max: NaN };
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const rms = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    return { n: xs.length, mean, rms, min: Math.min(...xs), max: Math.max(...xs) };
  };
  const table: any = {};
  for (const lane of LANES) {
    const rs = recs.filter((r) => r.lane === lane);
    const dLane = stat(rs.map((r) => r.required / r.fanLane - 1));
    const dLegacy = stat(rs.map((r) => r.required / r.fanLegacy - 1));
    const dFocus = stat(rs.map((r) => r.required / r.fanFocusModel - 1));
    const dFocusOnly = stat(rs.map((r) => r.required / r.fanFocusOnly - 1));
    say(`  L${lane}: n=${String(rs.length).padStart(3)}  focus>0 のセル ${rs.filter((r) => r.focus > 0).length} / stealth>0 ${rs.filter((r) => r.stealth > 0).length}`);
    say(`    要求/実測lanefan −1 : 平均 ${(dLane.mean * 100).toFixed(2)}%  rms ${(dLane.rms * 100).toFixed(2)}%`);
    say(`    要求/legacy引力式 −1 : 平均 ${(dLegacy.mean * 100).toFixed(2)}%  rms ${(dLegacy.rms * 100).toFixed(2)}%`);
    say(`    要求/lanefan+集目+ステルス −1: 平均 ${(dFocus.mean * 100).toFixed(2)}%  rms ${(dFocus.rms * 100).toFixed(2)}%`);
    say(`    要求/lanefan+集目のみ   −1: 平均 ${(dFocusOnly.mean * 100).toFixed(2)}%  rms ${(dFocusOnly.rms * 100).toFixed(2)}%`);
    table[`L${lane}`] = { n: rs.length, focusCells: rs.filter((r) => r.focus > 0).length, dLane, dLegacy, dFocus, dFocusOnly };
  }
  // 集目段数ごとの内訳（レーン別）
  say("  --- レーン×集目段数ごとの「要求 − laneFan」 ---");
  const detail: any = {};
  for (const lane of LANES) {
    const rs = recs.filter((r) => r.lane === lane);
    const byFocus = new Map<number, Rec[]>();
    for (const r of rs) byFocus.set(r.focus, [...(byFocus.get(r.focus) ?? []), r]);
    for (const [fo, arr] of [...byFocus.entries()].sort((a, b) => a[0] - b[0])) {
      const need = arr.map((r) => r.required - r.fanLane);
      const mean = need.reduce((a, b) => a + b, 0) / need.length;
      say(`    L${lane} focus=${String(fo).padStart(2)}: n=${String(arr.length).padStart(3)}  要求−laneFan 平均 ${mean.toFixed(1)}  （+集目則 ${focusFanBonusPermil(fo)}）  要求 ${ (arr.reduce((a, r) => a + r.required, 0) / arr.length).toFixed(1) } / legacy ${ (arr.reduce((a, r) => a + r.fanLegacy, 0) / arr.length).toFixed(1) }`);
      detail[`L${lane}_f${fo}`] = { n: arr.length, meanRequiredMinusLaneFan: mean, focusBonus: focusFanBonusPermil(fo), meanRequired: arr.reduce((a, r) => a + r.required, 0) / arr.length, meanLegacy: arr.reduce((a, r) => a + r.fanLegacy, 0) / arr.length };
    }
  }
  out.samples[c.id] = { stage: c.stage, baseCount, laneFan, n: recs.length, table, detail, recs: recs.map((r) => ({ ...r, required: Number(r.required.toFixed(1)) })) };
  fs.writeFileSync(path.resolve(repoRoot, OUT), JSON.stringify(out, null, 1), "utf8");
}
say(`\n[focusprobe] wrote ${OUT}`);

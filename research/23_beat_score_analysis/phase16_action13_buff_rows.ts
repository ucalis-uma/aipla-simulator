/**
 * Phase 16 Action13 計測器（**読み取り専用**）:
 *   ①実機バフ行 ⇔ sim 実効段数の全セル突合（一致率表・不一致分類）
 *   ②超化（capExtend）の意味の検定（寿命の窓＋ pop 逆算の窓平均）
 *   ③stat_value（実機のライブ中ステータス表示）による段数算術の独立検証
 *
 * 使い方:
 *   npx tsx research/23_beat_score_analysis/phase16_action13_buff_rows.ts S1,S2,S3 [--mode=legacy|lanefans] [--out=<json>] [--md=<md>]
 *
 * 出力:
 *   --out 既定 `research/23_beat_score_analysis/phase16_action13_buff_rows.json`
 *   --md  既定 `research/23_beat_score_analysis/phase16_action13_buff_rows.md`
 *
 * 規律: `../aipura_nox/` は読み取り専用（書き込まない）。値は読めたものだけ（捏造しない）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { mapEffectToBuffKey, liveStatusMultiplierPermil } from "../../src/timeline/buffs.js";
import { EXTREME_GRANT_STAGES } from "../../src/timeline/constants.js";
import { NeutralRng } from "../../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../../src/photos.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, "utf8"));
const LANES = [1, 2, 3, 4, 5];

const argv = process.argv.slice(2);
const IDS = (argv.find((a) => !a.startsWith("--")) ?? "S1,S2,S3").split(",").map((s) => s.trim().toUpperCase());
const MODE = (argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "legacy") as "legacy" | "lanefans";
const OUT = argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "research/23_beat_score_analysis/phase16_action13_buff_rows.json";
const MD = argv.find((a) => a.startsWith("--md="))?.split("=")[1] ?? "research/23_beat_score_analysis/phase16_action13_buff_rows.md";

/**
 * 実機の表示名 → キー。
 * `*超化`（capExtend）・`*上限開放`（limitRelease）は実機では**基本行とは別の行**として出るため、
 * 専用の擬似キー（`@capExtend:<基本キー>` / `@limitRelease:<基本キー>`）へ送る。
 * `クリティカル係数上昇超化` は `/クリティカル係数/` にも一致するので**完全一致**で引くこと（手順書 §7-3）。
 */
export const NAME_TO_BUFF_KEY: Record<string, string> = {
  "ボーカル上昇": "vocal_up",
  "ボーカルブースト": "vocal_boost",
  "ボーカル上昇超化": "@capExtend:vocal_up",
  "ボーカル低下": "vocal_down",
  "ダンス上昇": "dance_up",
  "ダンスブースト": "dance_boost",
  "ダンス上昇超化": "@capExtend:dance_up",
  "ダンス低下": "dance_down",
  "ビジュアル上昇": "visual_up",
  "ビジュアルブースト": "visual_boost",
  "ビジュアル上昇超化": "@capExtend:visual_up",
  "ビジュアル低下": "visual_down",
  "スコア上昇": "score_up",
  "ビートスコア上昇": "beat_score_up",
  "Aスキルスコア上昇": "a_skill_score_up",
  "SPスキルスコア上昇": "sp_skill_score_up",
  "Pスキルスコア上昇": "p_skill_score_up",
  "コンボスコア上昇": "combo_score_up",
  "クリティカル率上昇": "critical_rate_up",
  "クリティカル係数上昇": "critical_coeff_up",
  "クリティカル係数上昇超化": "@capExtend:critical_coeff_up",
  "テンションUP": "tension_up",
  "集目": "focus",
  "ステルス": "stealth",
  "スキル成功率上昇": "skill_success_up",
  "消費スタミナ低下": "stamina_cost_down",
  "消費スタミナ上昇": "stamina_cost_up",
  "ボーカル上昇上限開放": "@limitRelease:vocal_up",
  "ダンス上昇上限開放": "@limitRelease:dance_up",
  "ビジュアル上昇上限開放": "@limitRelease:visual_up",
  "コンボスコア上昇上限開放": "@limitRelease:combo_score_up",
  "テンションUP上限開放": "@limitRelease:tension_up",
  "スタミナ継続回復": "@nonstaged:stamina_recovery",
};
export const nameToKey = (name: string): string | undefined => NAME_TO_BUFF_KEY[name];

/** 「実機行なし ⇔ sim 0」を正しく比較するため、実機行に現れた key と sim のキーを突き合わせる */
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

const CASES: any[] = [
  { id: "S1", dir: "サンプル1", stage: "qt-area-1-001", chart: "chart-hsm-006-001", audience: 20, laneFans: [19, 19, 18, 22, 22], maxCapacity: 100, crit: "beatMap", critFile: "measured_data_v2.json", meas: ["measured_data_v2.json", "measured_data.json"] },
  { id: "S2", dir: "サンプル2", stage: "qt-tower-680", chart: "chart-sun-004-001", audience: 13206, laneFans: [11996, 13543, 13741, 13255, 13496], maxCapacity: 70000, crit: "keys", critFile: "measured_data_v2.json", meas: ["measured_data_v3.json"] },
  { id: "S3", dir: "サンプル3", stage: "qt-ex-tower-005-045", chart: "chart-thrx-004-001", audience: 8000, laneFans: [8515, 7748, 8535, 8518, 6684], maxCapacity: 40000, s3Fixes: true, crit: "beats", critFile: "measured_data_v2.json", meas: ["measured_data_v3.json"] },
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

function nameToKeyOfType(type: string): string | null {
  const m = mapEffectToBuffKey(type as any);
  return m === null ? null : m.key;
}

const out: any = { generatedBy: "phase16_action13_buff_rows.ts", mode: MODE, samples: {} };
const say = (s: string) => console.log(s);
const md: string[] = [];

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
    flat: li.aScoreAdditionalFlat ?? 0, critExtras: li.critExtrasPermil ?? 0,
    deck: li.deck, role: li.role, cardId: li.cardId ?? null, cardType: li.cardType ?? null,
  }));

  const instAt = new Map<string, Record<string, any[]>>();
  (base as any).effectInspector = (beat: number, states: readonly any[]) => {
    for (const st of states) {
      const lane: number = st.input.lane;
      const rec: Record<string, any[]> = {};
      for (const e of st.effects ?? []) {
        const key = nameToKeyOfType(e.type) ?? e.type;
        (rec[key] ??= []).push({
          stages: e.stages, rem: e.remainingBeats, src: e.sourceSkillId, type: e.type,
          capExtend: typeof e.capExtend === "number" ? e.capExtend : e.capExtend === true ? e.stages : 0,
          limitRelease: e.limitRelease === true, skipFirstDecay: e.skipFirstDecay === true,
        });
      }
      instAt.set(`${beat}:${lane}`, rec);
    }
  };

  const critRaw = readJson(path.join(dir, c.critFile)).critical_flags ?? {};
  const crit = c.crit === "keys" ? critFromKeys(critRaw) : c.crit === "beatMap" ? critFromBeatMap(critRaw) : critFromBeats(critRaw);
  const res: any = simulateTimeline({ ...base, rng: new NeutralRng(), criticalProvider: (b: number, l: number) => crit.get(b)?.[l - 1] === true });

  const measFile = c.meas.map((x: string) => path.join(dir, x)).find((p: string) => fs.existsSync(p))!;
  const mdoc = readJson(measFile);
  const pops = new Map<string, number>();
  const measRows = new Map<string, Record<string, number>>();
  const measStat = new Map<string, number>();
  for (const e of mdoc.timeline ?? []) for (const l of LANES) {
    const L = laneRead(e, l);
    if (L === null) continue;
    const k = `${e.beat}:${l}`;
    const g = L.gained_score_pop;
    const v = parseK(typeof g === "string" ? g : g?.text);
    if (v !== null) pops.set(k, v);
    if (typeof L.stat_value === "number") measStat.set(k, L.stat_value);
    const rows: Record<string, number> = {};
    for (const eff of L.effects ?? []) if (eff && typeof eff.name === "string") rows[eff.name] = eff.stage;
    measRows.set(k, rows);
  }
  const bf = path.join(dir, "lane_pops_backfill.json");
  if (fs.existsSync(bf)) for (const x of readJson(bf).pops ?? []) {
    if (typeof x?.beat !== "number" || typeof x?.lane !== "number" || x.readable === false) continue;
    const v = parseK(x.displayed);
    const k = `${x.beat}:${x.lane}`;
    if (v !== null && !pops.has(k)) pops.set(k, v);
  }
  const actCells = new Map<string, any[]>();
  const sumAct = (mdoc.skill_activations_summary ?? []) as any[];
  for (const row of mdoc.timeline ?? []) {
    const list: any[] = [];
    for (const idx of row?.skill_activations ?? []) {
      const a = typeof idx === "number" ? sumAct[idx] : idx;
      if (a !== null && a !== undefined) list.push({ lane: a.lane, name: a.skill_name, type: a.skill_type, fails: a.is_fail === true, crit: a.is_critical === true });
    }
    if (list.length > 0) actCells.set(String(row.beat), list);
  }

  const beats = res.beats as any[];
  const cells: any[] = [];
  for (const b of beats) {
    const snaps: any[] = b.buffSnapshots ?? [];
    const byLane = new Map<number, any[]>();
    for (const ev of (b.events ?? []) as any[]) byLane.set(ev.lane, [...(byLane.get(ev.lane) ?? []), ev]);
    for (const l of LANES) {
      const k = `${b.beat}:${l}`;
      const li = laneInfo[l - 1];
      const snap = snaps[l - 1] ?? null;
      const rows = measRows.get(k) ?? {};
      const mapped: Record<string, { meas: number; names: string[] }> = {};
      for (const [name, stage] of Object.entries(rows)) {
        const key = NAME_TO_BUFF_KEY[name] ?? `@unknown:${name}`;
        const cur = mapped[key];
        if (cur === undefined) mapped[key] = { meas: stage, names: [name] };
        else { cur.meas += stage; cur.names.push(name); }
      }
      const simStat = snap === null ? null : Math.floor((li.deck[li.attribute] * liveStatusMultiplierPermil(snap, li.attribute)) / 1000);
      // 実効値（A13 の裁定）: 超化行（@capExtend:<base>）は基本キーへ一律 +5段として合算する。
      // 基本行が無いビートでは加算しない（engine の extendStages と同じ規則）。
      const effective: Record<string, number> = {};
      for (const [key, v] of Object.entries(mapped)) {
        if (key.startsWith("@capExtend:")) continue;
        effective[key] = v.meas;
      }
      for (const [key] of Object.entries(mapped)) {
        if (!key.startsWith("@capExtend:")) continue;
        const base = key.slice("@capExtend:".length);
        if ((effective[base] ?? 0) > 0) effective[base] = (effective[base] ?? 0) + EXTREME_GRANT_STAGES;
      }
      cells.push({
        beat: b.beat, lane: l, attribute: li.attribute, role: li.role,
        meas: { rows, mapped, effective, stat: measStat.get(k) ?? null, pop: pops.get(k) ?? null, acts: actCells.get(String(b.beat))?.filter((a: any) => a.lane === l) ?? [] },
        sim: {
          snap, inst: instAt.get(k) ?? {}, stat: simStat,
          events: (byLane.get(l) ?? []).map((ev: any) => ({ kind: ev.sourceKind, score: ev.gainedScore, crit: ev.critFactorPermil, skill: ev.skillId ?? null, success: ev.success !== false })),
        },
      });
    }
  }

  /* ================= A. 一致率表（行名レベル） ================= */
  const keyStats = new Map<string, { cells: number; both: number; onlyMeas: number; onlySim: number; diffs: number[]; absDiff: number; maxAbs: number }>();
  const bump = (key: string): any => {
    let s = keyStats.get(key);
    if (s === undefined) { s = { cells: 0, both: 0, onlyMeas: 0, onlySim: 0, diffs: [], absDiff: 0, maxAbs: 0 }; keyStats.set(key, s); }
    return s;
  };
  for (const cell of cells) {
    const keys = new Set<string>();
    for (const key of Object.keys(cell.meas.mapped)) keys.add(key);
    for (const key of Object.keys(cell.sim.snap ?? {})) if (!key.startsWith("@") && (cell.sim.snap[key] ?? 0) !== 0) keys.add(key);
    for (const key of keys) {
      const m = cell.meas.mapped[key]?.meas ?? 0;
      const sVal = key.startsWith("@") ? null : (cell.sim.snap?.[key] ?? 0);
      if (m === 0 && (sVal === null || sVal === 0)) continue;
      const st = bump(key);
      st.cells += 1;
      if (m > 0 && (sVal ?? 0) > 0) {
        st.both += 1;
        const diff = (sVal ?? 0) - m;
        st.diffs.push(diff);
        st.absDiff += Math.abs(diff);
        st.maxAbs = Math.max(st.maxAbs, Math.abs(diff));
      } else if (m > 0) st.onlyMeas += 1;
      else st.onlySim += 1;
    }
  }

  /* ---- A'. 一致率表（超化行を基本キーへ +5 として合算した「実効値」比較）----
     超化は実機では別行・sim では基本キーへ合算されるため、行名レベルの A 表だけでは
     必ず +5 の差が出る。A13 の裁定（= +5段の修飾子）を適用した比較がこちら。
     属性上昇（vocal/dance/visual_up）は engine が超化を別キー `*_up_extreme`（5段）で
     持つため、基本キーへ合算した「上昇の合計段数」で比較する。 */
  const ATTR_UP_KEYS = new Set(["vocal_up", "dance_up", "visual_up"]);
  const keyStatsEff = new Map<string, { cells: number; both: number; onlyMeas: number; onlySim: number; diffs: number[]; absDiff: number; maxAbs: number }>();
  const bumpEff = (key: string): any => {
    let s = keyStatsEff.get(key);
    if (s === undefined) { s = { cells: 0, both: 0, onlyMeas: 0, onlySim: 0, diffs: [], absDiff: 0, maxAbs: 0 }; keyStatsEff.set(key, s); }
    return s;
  };
  for (const cell of cells) {
    const keys = new Set<string>();
    for (const key of Object.keys(cell.meas.effective)) keys.add(key);
    for (const key of Object.keys(cell.sim.snap ?? {})) {
      if (key.startsWith("@") || (cell.sim.snap[key] ?? 0) === 0) continue;
      if (key.endsWith("_extreme")) continue; // 超化は基本キー側へ合算済み（実機に行名が無い）
      keys.add(key);
    }
    for (const key of keys) {
      const m = cell.meas.effective[key] ?? 0;
      // 属性上昇キーは engine の別キー *_up_extreme（超化 5段）も合算して「上昇の合計段数」で比較
      const sVal = key.startsWith("@")
        ? null
        : ATTR_UP_KEYS.has(key)
          ? (cell.sim.snap?.[key] ?? 0) + (cell.sim.snap?.[`${key}_extreme`] ?? 0)
          : (cell.sim.snap?.[key] ?? 0);
      if (m === 0 && (sVal === null || sVal === 0)) continue;
      const st = bumpEff(key);
      st.cells += 1;
      if (m > 0 && (sVal ?? 0) > 0) {
        st.both += 1;
        const diff = (sVal ?? 0) - m;
        st.diffs.push(diff);
        st.absDiff += Math.abs(diff);
        st.maxAbs = Math.max(st.maxAbs, Math.abs(diff));
      } else if (m > 0) st.onlyMeas += 1;
      else st.onlySim += 1;
    }
  }

  /* ---- A2. 窓比較（実機行の出現窓 ⇔ sim 段数の窓）で「寿命違い」を分類 ---- */
  const winRows: any[] = [];
  for (const lane of LANES) {
    const lcells = cells.filter((x) => x.lane === lane);
    const allKeys = new Set<string>();
    for (const x of lcells) {
      for (const k of Object.keys(x.meas.mapped)) allKeys.add(k);
      for (const k of Object.keys(x.sim.snap ?? {})) if ((x.sim.snap[k] ?? 0) !== 0) allKeys.add(k);
    }
    for (const key of allKeys) {
      const mk = (v: (x: any) => number) => {
        const wins: any[] = [];
        let cur: any = null;
        for (const x of lcells) {
          const val = v(x);
          if (val > 0) {
            if (cur === null || x.beat !== cur.to + 1 || cur.val !== val) { cur = { from: x.beat, to: x.beat, val }; wins.push(cur); }
            else cur.to = x.beat;
          }
        }
        return wins;
      };
      const mw = mk((x) => x.meas.mapped[key]?.meas ?? 0);
      const sw = mk((x) => (key.startsWith("@") ? 0 : (x.sim.snap?.[key] ?? 0)));
      if (mw.length === 0 && sw.length === 0) continue;
      winRows.push({
        sample: c.id, lane, key,
        meas: mw.map((w) => ({ from: w.from, to: w.to, beats: w.to - w.from + 1, val: w.val })),
        sim: sw.map((w) => ({ from: w.from, to: w.to, beats: w.to - w.from + 1, val: w.val })),
      });
    }
  }

  /* ================= B. stat_value 検証（段数算術の独立検証） ================= */
  const statRows: any[] = [];
  for (const cell of cells) {
    if (cell.meas.stat === null || cell.sim.stat === null) continue;
    statRows.push({ beat: cell.beat, lane: cell.lane, meas: cell.meas.stat, sim: cell.sim.stat, ratio: cell.meas.stat / cell.sim.stat });
  }
  // 実機の stat は 1 の位まで一致するはず（差は基準値の丸め由来のみ）。相対 0.05% を超えるものを不一致とする。
  const statBad = statRows.filter((r) => Math.abs(r.ratio - 1) > 0.0005);
  const statAbsByLane: Record<number, { n: number; minAbs: number; maxAbs: number; maxRel: number }> = {};
  for (const lane of LANES) {
    const rs = statRows.filter((r) => r.lane === lane);
    if (rs.length === 0) continue;
    const abs = rs.map((r) => r.meas - r.sim);
    const rel = rs.map((r) => Math.abs(r.ratio - 1));
    statAbsByLane[lane] = { n: rs.length, minAbs: Math.min(...abs), maxAbs: Math.max(...abs), maxRel: Number(Math.max(...rel).toFixed(6)) };
  }

  /* ================= C. ccu の pop 逆算（窓平均） ================= */
  const critProbe: any[] = [];
  for (const cell of cells) {
    const evs = cell.sim.events;
    if (evs.length !== 1 || evs[0].kind !== "beat") continue;
    if (cell.meas.pop === null || cell.meas.pop < 3000) continue;
    const ev = evs[0];
    const li = laneInfo[cell.lane - 1];
    const requiredCrit = (ev.crit * cell.meas.pop) / ev.score;
    critProbe.push({
      beat: cell.beat, lane: cell.lane, simScore: ev.score, pop: cell.meas.pop, ratio: Number((cell.meas.pop / ev.score).toFixed(6)),
      critSim: ev.crit, requiredStages: Number(((requiredCrit - 1500 - li.critExtras) / 50).toFixed(3)),
      snapStages: cell.sim.snap?.critical_coeff_up ?? null,
      measCcu: cell.meas.rows["クリティカル係数上昇"] ?? null,
      measExt: cell.meas.rows["クリティカル係数上昇超化"] ?? null,
    });
  }
  const winEstimate: any[] = [];
  for (const lane of LANES) {
    const rs = critProbe.filter((r) => r.lane === lane);
    if (rs.length === 0) continue;
    const extras = laneInfo[lane - 1].critExtras;
    const nc = rs.filter((r) => r.critSim === 1000);
    const mu = nc.length > 0 ? nc.reduce((a, r) => a + r.pop / r.simScore, 0) / nc.length : null;
    if (mu === null) continue;
    let cur: any = null;
    const wins: any[] = [];
    for (const r of rs) {
      const key = `${r.snapStages}|${r.measCcu ?? "-"}|${r.measExt ?? "-"}`;
      if (cur === null || key !== cur.key || r.beat !== cur.to + 1) { cur = { key, from: r.beat, to: r.beat, rs: [r] }; wins.push(cur); }
      else { cur.to = r.beat; cur.rs.push(r); }
    }
    for (const w of wins) {
      const crit = w.rs.filter((r: any) => r.critSim !== 1000);
      if (crit.length === 0) continue;
      const ybar = crit.reduce((a: number, r: any) => a + (r.pop / r.simScore) * r.critSim, 0) / crit.length;
      const critTrue = ybar / mu;
      const stages = (critTrue - 1500 - extras) / 50;
      winEstimate.push({
        sample: c.id, lane, from: w.from, to: w.to, n: crit.length,
        simStages: w.rs[0].snapStages, measCcu: w.rs[0].measCcu, measExt: w.rs[0].measExt,
        meanCrit: Number(critTrue.toFixed(1)), impliedStages: Number(stages.toFixed(2)), deltaVsSim: Number((stages - (w.rs[0].snapStages ?? 0)).toFixed(2)),
      });
    }
  }
  const muByLane = Object.fromEntries(LANES.map((lane) => {
    const rs = critProbe.filter((r) => r.lane === lane && r.critSim === 1000);
    return [lane, rs.length > 0 ? Number((rs.reduce((a, r) => a + r.pop / r.simScore, 0) / rs.length).toFixed(5)) : null];
  }));

  /* ================= D. A12 層要求の再現（crit 層ごとの平均要求段数） ================= */
  const layers: any[] = [];
  for (const lane of LANES) {
    const rs = critProbe.filter((r) => r.lane === lane);
    for (const cs of [...new Set(rs.map((r) => r.critSim))].sort((a, b) => a - b)) {
      const arr = rs.filter((r) => r.critSim === cs);
      const need = arr.reduce((a, r) => a + r.requiredStages, 0) / arr.length;
      const beatsWin = [...new Set(arr.map((r) => r.beat))].sort((a, b) => a - b);
      layers.push({
        sample: c.id, lane, critSim: cs, n: arr.length,
        meanRequiredStages: Number(need.toFixed(2)),
        beats: beatsWin.length <= 40 ? beatsWin : `${beatsWin[0]}-${beatsWin[beatsWin.length - 1]}`,
      });
    }
  }

  say(`\n########## ${c.id} (mode=${MODE}) cells=${cells.length} ##########`);
  say(`  lanes: ${laneInfo.map((x: any) => `L${x.lane}:${x.attribute}/${x.role ?? "-"}`).join("  ")}`);
  const table = [...keyStats.entries()].map(([key, s]) => ({
    key, cells: s.cells, both: s.both, onlyMeas: s.onlyMeas, onlySim: s.onlySim,
    meanDiff: s.diffs.length > 0 ? Number((s.diffs.reduce((a, b) => a + b, 0) / s.diffs.length).toFixed(3)) : null,
    absDiff: s.absDiff, maxAbs: s.maxAbs,
  })).sort((a, b) => (b.onlyMeas + b.onlySim + b.absDiff) - (a.onlyMeas + a.onlySim + a.absDiff));
  say(`  ${"key".padEnd(30)} cells both onlyMeas onlySim meanDiff Σ|diff| max|diff|`);
  for (const r of table) say(`  ${String(r.key).padEnd(30)} ${String(r.cells).padStart(5)} ${String(r.both).padStart(4)} ${String(r.onlyMeas).padStart(8)} ${String(r.onlySim).padStart(7)} ${(r.meanDiff === null ? "-" : r.meanDiff.toFixed(2)).padStart(8)} ${String(r.absDiff).padStart(7)} ${String(r.maxAbs).padStart(8)}`);
  const tableEff = [...keyStatsEff.entries()].map(([key, s]) => ({
    key, cells: s.cells, both: s.both, onlyMeas: s.onlyMeas, onlySim: s.onlySim,
    meanDiff: s.diffs.length > 0 ? Number((s.diffs.reduce((a, b) => a + b, 0) / s.diffs.length).toFixed(3)) : null,
    absDiff: s.absDiff, maxAbs: s.maxAbs,
  })).sort((a, b) => (b.onlyMeas + b.onlySim + b.absDiff) - (a.onlyMeas + a.onlySim + a.absDiff));
  say(`  --- 実効値（超化行を基本キーへ +5 合算・基本行が無いビートは加算なし）---`);
  say(`  ${"key".padEnd(30)} cells both onlyMeas onlySim meanDiff Σ|diff| max|diff|`);
  for (const r of tableEff) say(`  ${String(r.key).padEnd(30)} ${String(r.cells).padStart(5)} ${String(r.both).padStart(4)} ${String(r.onlyMeas).padStart(8)} ${String(r.onlySim).padStart(7)} ${(r.meanDiff === null ? "-" : r.meanDiff.toFixed(2)).padStart(8)} ${String(r.absDiff).padStart(7)} ${String(r.maxAbs).padStart(8)}`);
  say(`  stat_value: 比較 ${statRows.length} セル / 相対0.05%超の不一致 ${statBad.length} セル`);
  for (const lane of LANES) {
    const s = statAbsByLane[lane];
    if (s !== undefined) say(`    L${lane}: n=${s.n} 実機−sim の範囲 [${s.minAbs}, ${s.maxAbs}] 最大相対差 ${(s.maxRel * 100).toFixed(4)}%`);
  }
  for (const r of statBad.slice(0, 12)) say(`    b${r.beat} L${r.lane}: 実機 ${r.meas} / sim ${r.sim} = ${r.ratio.toFixed(6)}`);
  say(`  μ（非クリセルの pop/sim・レーン別）: ${JSON.stringify(muByLane)}`);

  out.samples[c.id] = {
    stage: c.stage, mode: MODE, measFile: path.basename(measFile), laneInfo, table, tableEff, winRows, muByLane, winEstimate, layers,
    statCompared: statRows.length, statBadCount: statBad.length, statAbsByLane, cells, critProbe,
  };
}

/* ================= MD 生成 ================= */
{
  const mdout: string[] = [];
  mdout.push(`# Phase 16 Action13: 実機バフ行 ⇔ sim 実効段数の一致率表と超化の裁定（計測データ）`);
  mdout.push("");
  mdout.push(`- 生成: \`research/23_beat_score_analysis/phase16_action13_buff_rows.ts\`（口径 mode=${MODE}）`);
  mdout.push(`- 実機の行: \`../aipura_nox/サンプルN/measured_data_v3.json\` の \`timeline[].lanes[].effects[]\`（**完全一致**で引く。\`/クリティカル係数/\` は超化行にも一致するため使わない）`);
  mdout.push(`- sim の段数: engine の \`buffSnapshots\`（そのビートのスコア計算に使った実効段数）。加えて \`effectInspector\` でインスタンス内訳を採取`);
  mdout.push(`- 表示名→キー: \`NAME_TO_BUFF_KEY\`（\`*超化\` → \`@capExtend:<key>\`・\`*上限開放\` → \`@limitRelease:<key>\` は**別行**として擬似キーへ）`);
  mdout.push("");
  for (const [id, s] of Object.entries(out.samples) as [string, any][]) {
    mdout.push(`## ${id}（${s.measFile}・${s.stage}）`);
    mdout.push("");
    mdout.push(`レーン構成: ${s.laneInfo.map((x: any) => `L${x.lane}=${x.attribute}/${x.role ?? "-"}/${String(x.cardId).replace("card-", "")}`).join("・")}`);
    mdout.push("");
    mdout.push(`### 一致率表（キー × セル）`);
    mdout.push("");
    mdout.push(`| key | セル数 | 両方あり | 実機のみ | sim のみ | 平均差(sim−実機) | Σ\\|差\\| | 最大\\|差\\| |`);
    mdout.push(`|---|---:|---:|---:|---:|---:|---:|---:|`);
    for (const r of s.table) mdout.push(`| \`${r.key}\` | ${r.cells} | ${r.both} | ${r.onlyMeas} | ${r.onlySim} | ${r.meanDiff ?? "-"} | ${r.absDiff} | ${r.maxAbs} |`);
    mdout.push("");
    mdout.push(`### 一致率表（実効値 = 超化行を基本キーへ +5 合算・基本行が無いビートは加算なし）`);
    mdout.push("");
    mdout.push(`| key | セル数 | 両方あり | 実機のみ | sim のみ | 平均差(sim−実機) | Σ\\|差\\| | 最大\\|差\\| |`);
    mdout.push(`|---|---:|---:|---:|---:|---:|---:|---:|`);
    for (const r of s.tableEff) mdout.push(`| \`${r.key}\` | ${r.cells} | ${r.both} | ${r.onlyMeas} | ${r.onlySim} | ${r.meanDiff ?? "-"} | ${r.absDiff} | ${r.maxAbs} |`);
    mdout.push("");
    mdout.push(`### 窓比較（寿命）— 不一致があるキーのみ`);
    mdout.push("");
    const interesting = s.winRows.filter((w: any) => JSON.stringify(w.meas) !== JSON.stringify(w.sim));
    mdout.push(`| lane | key | 実機の窓 | sim の窓 |`);
    mdout.push(`|---|---|---|---|`);
    for (const w of interesting.slice(0, 40)) {
      const f = (ws: any[]) => ws.map((x) => `b${x.from}–${x.to}(${x.val})`).join(" ") || "—";
      mdout.push(`| L${w.lane} | \`${w.key}\` | ${f(w.meas)} | ${f(w.sim)} |`);
    }
    if (interesting.length > 40) mdout.push(`| … | 他 ${interesting.length - 40} 行 | | |`);
    mdout.push("");
    mdout.push(`### stat_value（実機のライブ中ステータス）検証`);
    mdout.push("");
    mdout.push(`比較 ${s.statCompared} セル / **相対 0.05% 超の不一致 ${s.statBadCount} セル**（sim の段数算術＝実機表示と一致するかの独立検証）`);
    mdout.push("");
    mdout.push(`| lane | n | 実機−sim の範囲 | 最大相対差 |`);
    mdout.push(`|---|---:|---|---:|`);
    for (const lane of [1, 2, 3, 4, 5]) {
      const x = s.statAbsByLane?.[lane];
      if (x !== undefined) mdout.push(`| L${lane} | ${x.n} | [${x.minAbs}, ${x.maxAbs}] | ${(x.maxRel * 100).toFixed(4)}% |`);
    }
    mdout.push("");
    mdout.push(`### pop 逆算の窓平均（μ = 非クリセルの pop/sim: ${JSON.stringify(s.muByLane)}）`);
    mdout.push("");
    mdout.push(`| lane | 窓 | sim段数 | 実機 ccu/超化 | n | 推定 crit | **推定段数** | 差 |`);
    mdout.push(`|---|---|---:|---|---:|---:|---:|---:|`);
    for (const w of s.winEstimate) mdout.push(`| L${w.lane} | b${w.from}–${w.to} | ${w.simStages} | ${w.measCcu ?? "-"}/${w.measExt ?? "-"} | ${w.n} | ${w.meanCrit} | **${w.impliedStages}** | ${w.deltaVsSim} |`);
    mdout.push("");
    mdout.push(`### crit 層ごとの平均要求段数（A12 の層要求の再現）`);
    mdout.push("");
    mdout.push(`| lane | critSim | n | 平均要求段数 | ビート |`);
    mdout.push(`|---|---:|---:|---:|---|`);
    for (const l of s.layers) mdout.push(`| L${l.lane} | ${l.critSim} | ${l.n} | ${l.meanRequiredStages} | ${l.beats} |`);
    mdout.push("");
  }
  // 手書きの裁定・考察（phase16_action13_report.md）をそのまま末尾に取り込む。
  // ハーネスを再実行しても裁定が消えないようにするための仕組み。
  const reportPath = path.resolve(repoRoot, "research/23_beat_score_analysis/phase16_action13_report.md");
  if (fs.existsSync(reportPath)) {
    mdout.push("");
    mdout.push("---");
    mdout.push("");
    mdout.push(fs.readFileSync(reportPath, "utf8"));
  }
  fs.mkdirSync(path.dirname(path.resolve(repoRoot, MD)), { recursive: true });
  fs.writeFileSync(path.resolve(repoRoot, MD), mdout.join("\n"), "utf8");
  say(`\n[buff_rows] wrote ${MD}`);
}

fs.mkdirSync(path.dirname(path.resolve(repoRoot, OUT)), { recursive: true });
fs.writeFileSync(path.resolve(repoRoot, OUT), JSON.stringify(out, null, 1), "utf8");
say(`[buff_rows] wrote ${OUT}`);

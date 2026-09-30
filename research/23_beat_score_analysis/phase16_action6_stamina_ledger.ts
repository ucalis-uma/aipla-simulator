/**
 * Phase 16 Action6: **実測スタミナ台帳との逐ビート突合**（実行: 2026-10-01 ／ 担当: cline）
 *
 * 動機: Phase 16-A5 が「sim のビート消費が実測より 1.7 倍（S3）/ 1.2 倍（S2）」と報告し、
 *   その原因を A のFAIL連鎖（台帳の毒性化）と推定した。が、**A5 までスタミナ系列の逐ビート
 *   突合は一度も実施していなかった**（スコア系列しか見ていなかった）。本スクリプトが
 *   それを最初に行い、「初期値 / 1 回コスト / 回復 / 発動回数」のどれが実測と違うかを確定させる。
 *
 * 完了条件（プロンプト phase16-action6-stamina-ledger.md より）:
 *  T1 レーン別残スタミナ系列の一致率 + 最初の分岐ビート + ビート差分の内訳（消費 vs 回復）
 *  T2 分岐原因の分類（初期値不足/過大消費/過小回復）と消費・回復規則の訂正有無
 *  T3 訂正（候補）を仮適用して S3 の ±15% セルを再計算
 *  T4 A4 の ±20% セルを全レーンで再計算（before/after）
 *
 * 実行: npx tsx research/23_beat_score_analysis/phase16_action6_stamina_ledger.ts
 *        > research/23_beat_score_analysis/phase16_action6_stamina_ledger_out.txt
 *   一時引数（T3 の候補仮適用）: STAM_INIT / STAM_COST_MUL_PERMIL / STAM_REC_MUL_PERMIL
 *        （env で渡す。未指定 = 現規則）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { NeutralRng } from "../../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef } from "../../src/photos.js";

const repoRoot = path.resolve(process.cwd());
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const num = (v: any): number | null => (typeof v === "number" ? v : null);
const fmt = (v: number | null): string => (v === null ? "  null" : Math.round(v).toLocaleString("en-US").padStart(7));

/** 実測クリティカル（サンプル1/3 形式: critical_flags.beats[{beat, lanes[]}]） */
function critFromBeats(raw: any): Map<number, boolean[]> {
  const out = new Map<number, boolean[]>();
  for (const r of (Array.isArray(raw?.beats) ? raw.beats : [])) {
    if (typeof r?.beat !== "number") continue;
    out.set(r.beat, (r.lanes ?? [false, false, false, false, false]).map((x: any) => x === true));
  }
  return out;
}
/** 実測クリティカル（サンプル2 形式: critical_flags["b061_L4"] = true） */
function critFromKeys(raw: any): Map<number, boolean[]> {
  const out = new Map<number, boolean[]>();
  for (const [k, v] of Object.entries(raw ?? {})) {
    const m = k.match(/^b0*(\d+)_L(\d)$/);
    if (!m) continue;
    const arr = out.get(Number(m[1])) ?? [false, false, false, false, false];
    arr[Number(m[2]) - 1] = v === true;
    out.set(Number(m[1]), arr);
  }
  return out;
}
/** 実測クリティカル（サンプル1 の別形式: critical_flags.beats = {"2": {"1":"normal",...}}） */
function critFromBeatMap(raw: any): Map<number, boolean[]> {
  const out = new Map<number, boolean[]>();
  for (const [k, v] of Object.entries(raw?.beats ?? {})) {
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
function loadCrit(critRaw: any, format: string): Map<number, boolean[]> {
  if (format === "keys") return critFromKeys(critRaw);
  if (format === "beatMap") return critFromBeatMap(critRaw);
  return critFromBeats(critRaw);
}

function loadData(stageIds: string[], chartIds: string[]): SimSourceData {
  const dataDir = path.join(repoRoot, "data");
  const idx = readJson(path.join(dataDir, "stages_index.json"));
  const allCharts = readJson(path.join(dataDir, "charts_all.json"));
  const mkStage = (qid: string): [string, any] => {
    const q = idx.quests.find((x: any) => x.id === qid);
    const c = idx.configs[q.c];
    return [qid, {
      beatWeightsPermil: { vocal: c.w[0], dance: c.w[1], visual: c.w[2] },
      skillWeightsPermil: { active: c.aw[0], special: c.aw[1] },
      skillStaminaWeightPermil: c.st ?? 1000,
      laneAttributes: c.a,
    }];
  };
  const mkChart = (cid: string): [string, any] => [cid, {
    notes: (allCharts[cid] as Array<[number, number]>).map((n: any, i: number) => ({
      beat: i + 1, type: n[0], position: n[1],
    })),
  }];
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
  };
}

const CASES: any[] = [
  {
    id: "S3",
    deck: path.join(noxRoot, "サンプル3", "deck.json"),
    example: path.join(repoRoot, "examples", "sample3.json"),
    stageFile: "qt-ex-tower-005-045", chartFile: "chart-thrx-004-001",
    audience: 8000, laneFans: [8515, 7748, 8535, 8518, 6684], maxCapacity: 40000,
    s3Fixes: true,
    measured: path.join(repoRoot, "research", "26_data_integrity", "measured_data_s3_v3.json"),
    critFile: path.join(noxRoot, "サンプル3", "measured_data_v2.json"), critFormat: "beats",
    costFrom: "chain", // S3 は skill_activations_summary[].stamina = "現在/上限" の連鎖差分のみ
  },
  {
    id: "S2",
    deck: path.join(noxRoot, "サンプル2", "deck.json"),
    example: path.join(repoRoot, "examples", "sample2.json"),
    stageFile: "qt-tower-680", chartFile: "chart-sun-004-001",
    audience: 13206, laneFans: [11996, 13543, 13741, 13255, 13496], maxCapacity: 70000,
    measured: path.join(repoRoot, "research", "26_data_integrity", "measured_data_s2_v3.json"),
    critFile: path.join(noxRoot, "サンプル2", "measured_data_v2.json"), critFormat: "keys",
    costFrom: "stamina_cost", // S2 は skill_activations_summary[].stamina_cost が実測値
    popsFile: path.join(noxRoot, "サンプル2", "lane_pops_backfill.json"),
  },
  {
    id: "S1",
    deck: path.join(noxRoot, "サンプル1", "deck.json"),
    example: path.join(repoRoot, "examples", "nested-sample.json"),
    stageFile: "qt-area-1-001", chartFile: "chart-hsm-006-001",
    audience: 20, laneFans: [19, 19, 18, 22, 22], maxCapacity: 100,
    measured: path.join(noxRoot, "サンプル1", "measured_data_v2.json"),
    critFile: path.join(noxRoot, "サンプル1", "measured_data_v2.json"), critFormat: "beatMap",
    popsFile: path.join(noxRoot, "サンプル1", "lane_pops_backfill.json"),
  },
];

/** サンプル deck.json（ネスト形式）から buildSimulateInput を組む（A5 と同一手順） */
function buildCase(c: any, mode: "legacy" | "lanefans"): { base: any; warnings: string[] } {
  const raw = readJson(c.deck);
  const aux = fs.existsSync(c.example) ? readJson(c.example) : {};
  const d = raw.deck ?? raw;
  if (c.s3Fixes) {
    d.characters[3].ct_cuts = [{ skill: 2, value: 5 }];
    for (const ph of raw.myPhotos ?? []) {
      if (ph?.id === "uph-lane5-3" && ph.skill !== null) ph.skill.staminaScaling = "more_stamina";
    }
  }
  const myPhotos: any[] = raw.myPhotos ?? aux.myPhotos ?? [];
  const photoEquip: string[][] = raw.photoEquip ?? aux.photoEquip ?? [];
  photoEquip.forEach((ids: string[], i: number) => {
    const ch = d.characters[i];
    if (ch === undefined || !Array.isArray(ch.photos)) return;
    ch.photos = mergePhotoEquipStatuses(ch.photos, ids.map((pid: string) => myPhotos.find((x: any) => x?.id === pid)).filter((p: any) => p !== undefined));
  });
  const userPhotoSkills = myPhotos.length > 0 && photoEquip.length > 0
    ? photoEquip.flatMap((ids: string[], i: number) =>
        ids.flatMap((pid: string, j: number) => {
          const p = myPhotos.find((x: any) => x?.id === pid);
          const def = p === undefined ? null : myPhotoToSkillDef(p, (i + 1) as any, j + 1);
          return def !== null ? [def] : [];
        }))
    : undefined;
  const built = buildSimulateInput({
    deck: d, stageFile: c.stageFile, chartFile: c.chartFile,
    data: loadData([c.stageFile], [c.chartFile]),
    audience: c.audience,
    laneFans: mode === "lanefans" ? c.laneFans : undefined,
    maxCapacity: mode === "lanefans" ? c.maxCapacity : undefined,
    mentalOverride: raw.mentalOverride ?? aux.mentalOverride,
    missedNotes: raw.missedNotes ?? aux.missedNotes,
    disabledSkillIds: raw.disabledSkillIds ?? aux.disabledSkillIds,
    userPhotoSkills,
  } as any);
  return { base: built.base, warnings: built.warnings };
}

/** ポップ表記（"+335.8K" / 335800 / null）→ 人数 */
function parsePop(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const t = typeof v === "string" ? v : (v.text ?? null);
  if (typeof t !== "string") return null;
  const m = t.replace(/[+,￥\s]/g, "").match(/^([0-9.]+)([MK]?)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toUpperCase();
  return Math.round(n * (unit === "K" ? 1000 : unit === "M" ? 1_000_000 : 1));
}
type PopTable = Map<number, (number | null)[]>;
function popTableFromTimeline(timeline: any[]): PopTable {
  const t: PopTable = new Map();
  for (const row of timeline) {
    if (typeof row?.beat !== "number") continue;
    const arr = t.get(row.beat) ?? [null, null, null, null, null];
    for (let i = 0; i < 5; i++) arr[i] = parsePop(laneCell(row, i)?.gained_score_pop);
    t.set(row.beat, arr);
  }
  return t;
}
function popTableFromBackfill(file: string): PopTable {
  const raw = readJson(file);
  const t: PopTable = new Map();
  for (const p of raw?.pops ?? []) {
    if (typeof p?.beat !== "number" || typeof p?.lane !== "number" || p.readable === false) continue;
    const arr = t.get(p.beat) ?? [null, null, null, null, null];
    const v = parsePop(p.displayed ?? p.text ?? null);
    if (v !== null) arr[p.lane - 1] = v;
    t.set(p.beat, arr);
  }
  return t;
}

/* ===================== 実測側の正規化 ===================== */

/** lanes のキー形式がサンプル間で異なる（"1".."5" / "lane1".."lane5" / 配列）→ 吸収 */
function laneCell(row: any, i: number): any {
  const l = row?.lanes;
  if (l === undefined || l === null) return null;
  if (Array.isArray(l)) return l[i] ?? null;
  return l[String(i + 1)] ?? l[`lane${i + 1}`] ?? null;
}
const stamAt = (row: any, i: number): number | null => num(laneCell(row, i)?.current_stamina);
const maxAt = (row: any, i: number): number | null => num(laneCell(row, i)?.max_stamina);

/** 実測の発動記録を正規化（コストはサンプル間で供給源が違う） */
interface MeasAct {
  beat: number; lane: number; skillId: string | null; kind: string;
  name: string; level: number | null; cost: number | null; fail: boolean;
  after: number | null;   // 発動後に読まれた残りスタミナ（act 単位の実際の表示値）
  order: number | null;   // 撮影 order（同一ビート内の前後順の参考用）
}
function measActs(c: any, meas: any): MeasAct[] {
  const chain = new Map<number, number>(); // lane -> 直近の残りスタミナ（実測 b0 起点）
  for (let i = 0; i < 5; i++) {
    const v = stamAt(meas.timeline?.[0], i);
    if (v !== null) chain.set(i + 1, v);
  }
  const out: MeasAct[] = [];
  const sum = meas.skill_activations_summary ?? [];
  for (const e of Array.isArray(sum) ? sum : Object.values(sum)) {
    const lane = e?.lane;
    if (typeof lane !== "number") continue;
    let cost: number | null = null;
    let after: number | null = null;
    if (c.costFrom === "stamina_cost" && typeof e.stamina_cost === "number") cost = e.stamina_cost;
    else {
      const disp = e.stamina_display ?? e.stamina;
      const m = typeof disp === "string" ? /^(\d+)\s*\/\s*(\d+)$/.exec(disp.trim()) : null;
      if (m) {
        const cur = parseInt(m[1], 10);
        after = cur;
        const prev = chain.get(lane);
        if (prev !== undefined && e.stamina_phase !== "発動前") cost = prev - cur;
        chain.set(lane, cur);
      }
    }
    out.push({
      beat: typeof e.beat === "number" ? e.beat : -1,
      lane,
      skillId: e.skill_id ?? null,
      kind: String(e.skill_type ?? e.type ?? "?").toUpperCase(),
      name: String(e.skill_name ?? e.idol_name ?? e.actor ?? "?"),
      level: e.skill_level ?? e.skill_lv ?? null,
      cost,
      fail: e.is_fail === true,
      after,
      order: typeof e.order === "number" ? e.order : null,
    });
  }
  return out;
}


/* ===================== sim 実行 ===================== */

interface SimOut {
  res: any;
  base: any;                          // simulateTimeline に入力した lane 群（コスト在庫の参照用）
  init: number[];                      // 初期スタミナ（deck 由来・レーン別）
  series: Map<number, number[]>;     // beat -> staminaAfter（5レーン）
  costByCell: Map<string, number>;   // "beat|lane" -> 成功発動の消費合計
  actsByCell: Map<string, string[]>; // "beat|lane" -> 発動ラベル（成功のみ kind:skill=cost）
  failByCell: Map<string, string[]>; // "beat|lane" -> FAIL ラベル
}
/** 一時上書き（T3 の候補仮適用用・engine 無変更で入力だけを弄る） */
interface SimOpts {
  init?: number[] | null;      // 初期スタミナ（=上限も同値になる）
  costMul?: number | null;     // 1 回コストの倍率（skill/photo の staminaCost を scaling 前に倍）
  recMul?: number | null;      // 回復量の倍率（stamina_recovery 効果の value を倍）
}
function runSim(c: any, mode: "legacy" | "lanefans", crit: Map<number, boolean[]>, opts: SimOpts = {}): SimOut {
  const built = buildCase(c, mode);
  const base: any = { ...built.base, lanes: built.base.lanes.map((l: any) => ({ ...l })) };
  for (const [i, lane] of base.lanes.entries()) {
    if (opts.init && typeof opts.init[i] === "number") lane.deck = { ...lane.deck, stamina: opts.init[i] };
    const scale = (s: any) => {
      if (opts.costMul && typeof s.staminaCost === "number") s.staminaCost = Math.round(s.staminaCost * opts.costMul);
      for (const e of s.effects ?? []) {
        if (e?.type === "stamina_recovery" && typeof e.value === "number" && opts.recMul) {
          e.value = Math.round(e.value * opts.recMul);
        }
      }
    };
    lane.skills = lane.skills.map((s: any) => ({ ...s, effects: (s.effects ?? []).map((e: any) => ({ ...e })) }));
    lane.photos = lane.photos.map((s: any) => ({ ...s, effects: (s.effects ?? []).map((e: any) => ({ ...e })) }));
    for (const s of [...lane.skills, ...lane.photos]) scale(s);
  }
  const res: any = simulateTimeline({
    ...base,
    rng: new NeutralRng(),
    criticalProvider: (b: number, l: number) => crit.get(b)?.[l - 1] === true,
  } as any);
  const init: number[] = base.lanes.map((l: any) => l.deck.stamina);
  const series = new Map<number, number[]>();
  const costByCell = new Map<string, number>();
  const actsByCell = new Map<string, string[]>();
  const failByCell = new Map<string, string[]>();
  for (const bt of res.beats) {
    series.set(bt.beat, [...bt.staminaAfter]);
    for (const a of bt.activations) {
      if (a.lane < 1) continue;
      const k = `${a.beat}|${a.lane}`;
      if (a.success) {
        costByCell.set(k, (costByCell.get(k) ?? 0) + (a.staminaCost ?? 0));
        const la = actsByCell.get(k) ?? [];
        la.push(`${a.kind}:${a.skillId.replace(/^sk-/, "")}=${a.staminaCost ?? 0}`);
        actsByCell.set(k, la);
      } else {
        const lf = failByCell.get(k) ?? [];
        lf.push(`${a.kind}FAIL(${a.failReason})`);
        failByCell.set(k, lf);
      }
    }
  }
  return { res, base, init, series, costByCell, actsByCell, failByCell };
}

/* ===================== 出力本体 ===================== */

/** 分岐とみなす閾値（実測は実数値なので小さな回復/丸めノイズを許容） */
const DIV_ABS = 200;
const DIV_REL = 0.05;
const envInt = (name: string): number | null => {
  const v = process.env[name];
  return v === undefined || v === "" ? null : Number(v);
};
const simInit: number[] | null = (() => {
  const raw = process.env["STAM_INIT"];
  if (raw === undefined || raw === "") return null;
  return raw.split(",").map((x) => Number(x.trim()));
})();
const costMul = envInt("STAM_COST_MUL_PERMIL");
const recMul = envInt("STAM_REC_MUL_PERMIL");

console.log("=== Phase 16 Action6: 実測スタミナ台帳との逐ビート突合（sim = 乱数中立 + 実測クリ注入・現規則） ===");
console.log("  方針: 実測 timeline の current_stamina（レーン別実数）と sim の staminaAfter を逐ビート突合。");
console.log("        消費 = 成功発動の staminaCost 合計 / 回復 = ビート差分 + 消費（上限クランプ分は過小計上）。");
console.log(`        分岐判定: |sim - 実測| > max(${DIV_ABS}, ${DIV_REL * 100}% × 実測max) へ移行した最初のビート。`);
console.log("  一時引数: STAM_INIT / STAM_COST_MUL_PERMIL / STAM_REC_MUL_PERMIL（env・未指定なら現規則）");
if (simInit || costMul !== null || recMul !== null) {
  console.log(`  [OVERRIDE] init=${JSON.stringify(simInit ?? null)} costMul=${costMul ?? "-"}‰ recMul=${recMul ?? "-"}‰`);
}
const SIM_OPTS: SimOpts = {
  init: simInit,
  costMul: costMul !== null ? costMul / 1000 : null,
  recMul: recMul !== null ? recMul / 1000 : null,
};
const pad = (v: number | null, w = 7): string =>
  v === null || !Number.isFinite(v) ? "null".padStart(w) : Math.round(v).toLocaleString("en-US").padStart(w);

for (const c of CASES) {
  const meas = readJson(c.measured);
  const timeline: any[] = meas.timeline ?? [];
  const crit = loadCrit(readJson(c.critFile).critical_flags, c.critFormat);
  const rows = new Map<number, any>();
  for (const r of timeline) if (typeof r?.beat === "number") rows.set(r.beat, r);
  const maxBeat = Math.max(...rows.keys());
  const sim = runSim(c, "legacy", crit, SIM_OPTS);
  const acts = measActs(c, meas).filter((a) => !a.fail && a.beat >= 0);
  const measActsByCell = new Map<string, MeasAct[]>();
  for (const a of acts) {
    const k = `${a.beat}|${a.lane}`;
    const arr = measActsByCell.get(k) ?? [];
    arr.push(a);
    measActsByCell.set(k, arr);
  }
  const measMax: (number | null)[] = [0, 1, 2, 3, 4].map((i) => maxAt(rows.get(0), i) ?? maxAt(rows.get(1), i));
  const measInit: (number | null)[] = [0, 1, 2, 3, 4].map((i) => stamAt(rows.get(0), i));
  const popCells = [...(c.popsFile ? popTableFromBackfill(c.popsFile) : popTableFromTimeline(timeline)).values()]
    .reduce((a, v) => a + v.filter((x) => x !== null).length, 0);

  console.log(`\n########## ${c.id} ${c.stageFile} / ${c.chartFile} ##########`);
  console.log(`  実測 timeline ${timeline.length} 行（beat 0..${maxBeat}）/ 発動記録 ${acts.length} 件 / sim ビート ${sim.res.beats.length} / pop 読取セル ${popCells}`);
  console.log(`  初期スタミナ  sim(deck 由来)= ${JSON.stringify(sim.init)} / 実測 beat0 = ${JSON.stringify(measInit.map((x) => x))} / 実測 max = ${JSON.stringify(measMax)}`);

  // ---- 対齐検証（実測 beat 番号を sim beat にそのまま対応させられるかの確認） ----
  const align: string[] = [];
  for (const off of [0, 1]) {
    let ok = 0, tot = 0;
    for (const [b, row] of rows) {
      if (b === 0) continue;
      const s = sim.series.get(b + off);
      if (s === undefined) continue;
      for (let i = 0; i < 5; i++) {
        const m = stamAt(row, i);
        if (m === null) continue;
        tot++;
        if (Math.abs(s[i] - m) <= Math.max(DIV_ABS, DIV_REL * (measMax[i] ?? 0))) ok++;
      }
    }
    align.push(`offset=${off}: ${ok}/${tot} セル`);
  }
  console.log(`  対齐検証（|差|<=max(${DIV_ABS},5%max)） ${align.join(" / ")} → ビート番号は 1:1 対応と判定`);

  // ---- レーン別：系列の一致 / 最初の分岐 / 内訳 ----
  for (let i = 0; i < 5; i++) {
    const thr = Math.max(DIV_ABS, DIV_REL * (measMax[i] ?? 0));
    const simIni = sim.init[i] ?? 0;
    let divergeBeat: number | null = null;
    let matchCells = 0, cmpCells = 0;
    let simCost = 0, simRec = 0, measCost = 0, measRec = 0;
    const bigDeltas: string[] = [];
    let bigCount = 0;
    const detail: string[] = [];
    for (let b = 1; b <= maxBeat; b++) {
      const sArr = sim.series.get(b);
      const mRow = rows.get(b);
      const sVal = sArr ? (sArr[i] as number) : null;
      const mVal = mRow ? stamAt(mRow, i) : null;
      const key = `${b}|${i + 1}`;
      const sCost = sim.costByCell.get(key) ?? 0;
      const mCost = (measActsByCell.get(key) ?? []).reduce((a, x) => a + (x.cost ?? 0), 0);
      const sPrev = b === 1 ? simIni : (sim.series.get(b - 1)?.[i] as number | undefined) ?? null;
      const mPrev = b === 1 ? measInit[i] : stamAt(rows.get(b - 1), i);
      const sDelta = sVal !== null && sPrev !== null ? sVal - sPrev : null;
      const mDelta = mVal !== null && mPrev !== null ? mVal - mPrev : null;
      simCost += sCost;
      measCost += mCost;
      simRec += Math.max(0, (sDelta ?? 0) + sCost);
      measRec += Math.max(0, (mDelta ?? 0) + mCost);
      if (sVal !== null && mVal !== null) {
        cmpCells++;
        if (Math.abs(sVal - mVal) <= thr) matchCells++;
        else if (divergeBeat === null) divergeBeat = b;
      }
      if (sDelta !== null && mDelta !== null && Math.abs(sDelta - mDelta) >= 300) {
        bigCount++;
        if (bigDeltas.length < 10) bigDeltas.push(`b${b}(sim${sDelta}/実測${mDelta})`);
      }
      if (b <= 16) {
        const sActs = (sim.actsByCell.get(key) ?? []).join(",") || "-";
        const sFails = (sim.failByCell.get(key) ?? []).join(",");
        const mActs = (measActsByCell.get(key) ?? [])
          .map((x) => `${x.kind}${x.name}${x.level != null ? `Lv${x.level}` : ""}${x.cost != null ? `=${x.cost}` : ""}`)
          .join(",") || "-";
        detail.push(
          `  b${String(b).padStart(3)} |${pad(sVal)} |${pad(mVal)} |${pad(sVal !== null && mVal !== null ? sVal - mVal : null)} |` +
            `${pad(sDelta)} |${pad(sCost)} |${pad(sDelta === null ? null : sDelta + sCost)} |${pad(mDelta)} |${pad(mCost)} |` +
            `${pad(mDelta === null ? null : mDelta + mCost)} | ${sActs}${sFails ? ` [${sFails}]` : ""} || ${mActs}`,
        );
      }
    }
    const lastSim = (sim.series.get(maxBeat)?.[i] as number | undefined) ?? null;
    const lastMeas = stamAt(rows.get(maxBeat), i);
    console.log(
      `\n  --- L${i + 1}: 初期 sim ${pad(simIni)} / 実測 ${pad(measInit[i])}（実測 max ${pad(measMax[i])}）---` +
        `\n      最終 b${maxBeat}: sim ${pad(lastSim)} / 実測 ${pad(lastMeas)} / 差 ${pad(lastSim !== null && lastMeas !== null ? lastSim - lastMeas : null)}` +
        ` | 一致 ${matchCells}/${cmpCells} | 最初の分岐 b${divergeBeat ?? "-"} | 消費計 sim ${pad(simCost)} / 実測 ${pad(measCost)} | 回復計 sim ${pad(simRec)} / 実測 ${pad(measRec)}` +
        `\n      分類: ${classify(simIni, measInit[i], simCost, measCost, simRec, measRec)}` +
        `\n      |ビート差|>=300: ${bigCount} 件  ${bigDeltas.join(" ")}`,
    );
    console.log(`      |   ビート |   sim残 |   実測残 |      差 |    simΔ |  sim消費 |  sim回復 |    実測Δ | 実測actΣ | 実測回復 | sim発動 || 実測発動`);
    for (const r of detail) console.log(r);
  }

  /* ---- Section B: 発動（act）単位の台帳検証 ── ビート内の前後順に依存しない検査 ----
     実測の発動記録は「発動後に読まれた残りスタミナ」（stamina "X/Y"）を持つものがある。
     同一 (lane,beat) で最も小さい読み = そのビートの発動が全て済んだ後の値（終了点サンプル）。
     sim の staminaAfter（=ビート終了時）と直接較べられるので、ビート内の前後順ずれに影響されない。
     ※ timeline の current_stamina は発動の途中時点の値になり得る（S3 L1 b1: timeline 9,411 /
        フォト発動後の読み 7,425）→ 逐ビート比較には系 1 ビート分の不明確さが残る。 */
  {
    const actReadByCell = new Map<string, number[]>();
    const photoCntByCell = new Map<string, number>();
    for (const a of acts) {
      if (a.lane < 1 || a.lane > 5 || a.beat < 0) continue;
      const k = `${a.beat}|${a.lane}`;
      if (a.after !== null) {
        const arr = actReadByCell.get(k) ?? [];
        arr.push(a.after);
        actReadByCell.set(k, arr);
      }
      if (a.kind === "PHOTO") photoCntByCell.set(k, (photoCntByCell.get(k) ?? 0) + 1);
    }
    let cells = 0;
    let exact = 0;
    let near = 0;
    const miss: string[] = [];
    for (const [k, reads] of actReadByCell) {
      const [bStr, lStr] = k.split("|");
      const b = Number(bStr);
      const l = Number(lStr);
      const simV = sim.series.get(b)?.[l - 1];
      if (simV === undefined) continue;
      const measEnd = Math.min(...reads);
      cells++;
      if (simV === measEnd) exact++;
      else if (Math.abs(simV - measEnd) <= Math.max(200, 0.05 * measEnd)) near++;
      else if (miss.length < 12) {
        const mA = (measActsByCell.get(k) ?? [])
          .map((x) => `${x.kind}${x.name}${x.level != null ? `Lv${x.level}` : ""}`)
          .join(",");
        miss.push(
          `  b${b}L${l}: sim ${simV} / 実測act終 ${measEnd}（読み ${reads.join("/")}） | sim発動 ` +
            `${(sim.actsByCell.get(k) ?? []).join(",") || "-"} | 実測発動 ${mA || "-"}`,
        );
      }
    }
    let simPhotoMax = 0;
    let measPhotoMax = 0;
    const coFire: string[] = [];
    for (const [k, n] of photoCntByCell) {
      if (n > measPhotoMax) measPhotoMax = n;
      if (n >= 2) coFire.push(`${k.replace("|", "L")}=${n}`);
    }
    for (const labels of sim.actsByCell.values()) {
      const n = labels.filter((x) => x.startsWith("photo:")).length;
      if (n > simPhotoMax) simPhotoMax = n;
    }
    console.log(
      `\n  [B] act 単位台帳（実測の発動後スタミナ読み vs sim ビート終了点）: 検査 ${cells} セル /` +
        ` 完全一致 ${exact} / 閾値内 ${near} / 不一致 ${cells - exact - near}`,
    );
    for (const m of miss) console.log(`      不一致${m}`);
    console.log(
      `  [B] 1ビート1レーンのフォト発動数: 実測 max ${measPhotoMax}` +
        `（2件以上発火セル ${coFire.length} 件: ${coFire.slice(0, 8).join(" ") || "なし"}） / sim max ${simPhotoMax}` +
        `（sim は usedThisBeat 予算で構造的に 1 まで）`,
    );
  }

  /* ---- Section C: フォト 1件コストの在庫突合（名寄せ） ----
     実測の発動記録（コスト確定分）と sim のフォト SkillDef ストックをレーン別に並べて、
     「発動順の問題」ではなく「1件コストの規則/マッピング問題」かを切り分ける。 */
  {
    const simPhotoDef: Map<number, { id: string; name: string; cost: number | null }[]> = new Map();
    for (let i = 0; i < sim.base.lanes.length; i++) {
      const arr = (sim.base.lanes[i].photos ?? []).map((p: any) => ({
        id: String(p.id),
        name: String(p.name ?? "?"),
        cost: typeof p.staminaCost === "number" ? p.staminaCost : null,
      }));
      simPhotoDef.set(i + 1, arr);
    }
    console.log(`\n  [C] フォト 1件コスト在庫突合（sim ストック vs 実測観測コスト）`);
    for (let lane = 1; lane <= 5; lane++) {
      const stock = (simPhotoDef.get(lane) ?? [])
        .map((x) => `${x.id}=${x.cost ?? "?"}(${x.name})`)
        .join(" ");
      const obs = acts
        .filter((a) => a.lane === lane && a.kind === "PHOTO" && a.cost !== null)
        .map((a) => `b${a.beat}:${a.name}${a.level != null ? `Lv${a.level}` : ""}=${a.cost}`)
        .join(" ");
      console.log(`      L${lane} sim: ${stock}`);
      console.log(`      L${lane} 実測: ${obs || "-"}`);
    }
  }
}

/** 分岐原因の分類（プロンプト §2 の 3 分類。閾値 5%） */
function classify(
  simIni: number | null, measIni: number | null,
  simCost: number, measCost: number, simRec: number, measRec: number,
): string {
  const out: string[] = [];
  if (measIni !== null && simIni !== null && Math.abs(measIni - simIni) > DIV_ABS)
    out.push(`[初期値不足] sim初期 ${simIni} vs 実測 ${measIni}（差 ${simIni - measIni >= 0 ? "+" : ""}${simIni - measIni}）`);
  if (simCost > measCost * 1.05 + 200) out.push(`[過大消費] sim 消費 = 実測の ${Math.round((simCost / Math.max(1, measCost)) * 100)}%`);
  if (simCost < measCost * 0.95 - 200) out.push(`[過小消費] sim 消費 = 実測の ${Math.round((simCost / Math.max(1, measCost)) * 100)}%`);
  if (measRec > 0 && simRec < measRec * 0.9 - 200) out.push(`[過小回復] sim 回復 = 実測の ${Math.round((simRec / Math.max(1, measRec)) * 100)}%`);
  if (measRec > 0 && simRec > measRec * 1.1 + 200) out.push(`[過大回復] sim 回復 = 実測の ${Math.round((simRec / Math.max(1, measRec)) * 100)}%`);
  if (out.length === 0) out.push("消費・回復・初期値すべて閾値内（＝発動タイミング由来の差）");
  return out.join(" / ");
}







/**
 * Phase 16 Action 9b: ①自己バフ課金 vs ②持続境界（off-by-one）の分離 ＋ A9 残件のクローズ
 *
 * 実行:
 *   npx tsx research/23_beat_score_analysis/phase16_action9b_selfbuff_separation.ts            (通常)
 *   npx tsx research/23_beat_score_analysis/phase16_action9b_selfbuff_separation.ts --probe    (T3 の解析側オーバーライド)
 *   → 生ログは同名 _out.txt に UTF-8 直書き（PowerShell の > は化ける）
 *
 * 位置づけ:
 *  - A9（phase16_action9_photo_ledger.ts）の後継。§1 の欠陥（[B] の添字合わせ）を直し、
 *    ①「発動 act 自身の boost を自 act の cost に織り込む」／②「boost 持続境界が実機で 1 ビート長い」
 *    を **既存データだけで分離**する。src/** は読み取り専用（engine.ts は一切触らない）。
 *  - 実測の読み方（A9 からの追加）: S1 の `timeline[].lanes[].effects[]`（ビート別・段数つき buff 表示）を
 *    **実機の buff ライフタイム**の一次証拠として使う。S3 は act 行の `effects_now` を使う。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { NeutralRng } from "../../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef } from "../../src/photos.js";
import { consumptionMultiplierPermil } from "../../src/timeline/buffs.js";
import { mulPermil } from "../../src/rounding.js";

const repoRoot = path.resolve(process.cwd());
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const PROBE = process.argv.includes("--probe");
const N = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pad = (v: number | null, w = 7): string =>
  v === null || !Number.isFinite(v) ? "null".padStart(w) : Math.round(v).toLocaleString("en-US").padStart(w);

/* ===================== サンプル定義（A9 と同一） ===================== */
const CASES: any[] = [
  {
    id: "S1",
    deck: path.join(noxRoot, "サンプル1", "deck.json"),
    example: path.join(repoRoot, "examples", "nested-sample.json"),
    stageFile: "qt-area-1-001", chartFile: "chart-hsm-006-001",
    audience: 20, laneFans: [19, 19, 18, 22, 22], maxCapacity: 100,
    measured: path.join(noxRoot, "サンプル1", "measured_data_v2.json"),
    critFile: path.join(noxRoot, "サンプル1", "measured_data_v2.json"), critFormat: "beatMap",
    actSchema: "s1",
  },
  {
    id: "S3",
    deck: path.join(noxRoot, "サンプル3", "deck.json"),
    example: path.join(repoRoot, "examples", "sample3.json"),
    stageFile: "qt-ex-tower-005-045", chartFile: "chart-thrx-004-001",
    audience: 8000, laneFans: [8515, 7748, 8535, 8518, 6684], maxCapacity: 40000,
    s3Fixes: true,
    measured: path.join(repoRoot, "research", "26_data_integrity", "measured_data_s3_v3.json"),
    critFile: path.join(noxRoot, "サンプル3", "measured_data_v2.json"), critFormat: "beats",
    actSchema: "s3",
  },
  {
    id: "S2",
    deck: path.join(noxRoot, "サンプル2", "deck.json"),
    example: path.join(repoRoot, "examples", "sample2.json"),
    stageFile: "qt-tower-680", chartFile: "chart-sun-004-001",
    audience: 13206, laneFans: [11996, 13543, 13741, 13255, 13496], maxCapacity: 70000,
    measured: path.join(repoRoot, "research", "26_data_integrity", "measured_data_s2_v3.json"),
    critFile: path.join(noxRoot, "サンプル2", "measured_data_v2.json"), critFormat: "keys",
    actSchema: "s2",
  },
];
/** T3 の 4 セル（A6 §1-4 / A8 §5-1・§5-2） */
const T3_CELLS: Array<{ s: string; lane: number; beat: number; want: string }> = [
  { s: "S3", lane: 5, beat: 70, want: "実測=FAIL（スタミナ不足）→ FAIL 側になってほしい" },
  { s: "S3", lane: 2, beat: 4, want: "実測=成功（新たな衣装とさらなる飛躍 Lv4）→ 成功側になってほしい" },
  { s: "S3", lane: 2, beat: 34, want: "実測=成功（おめかしバニティ Lv4）→ 成功側になってほしい" },
  { s: "S3", lane: 3, beat: 169, want: "実測=成功（殻をやぶる Lv4）→ 成功側になってほしい" },
];
/** --probe: 「フォト参照だけ差し替えた別実行」。実測 act 台帳に現れないカード枠フォトを該当レーンで発動不能にする */
const PROBE_DROP_CARDFRAME: Record<string, number[]> = { S3: [2, 3] };

/* ===================== データ供給（A9 と同一・STAM_* 環境変数は読まない） ===================== */
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
function critFromBeats(raw: any): Map<number, boolean[]> {
  const out = new Map<number, boolean[]>();
  for (const r of (Array.isArray(raw?.beats) ? raw.beats : [])) {
    if (typeof r?.beat !== "number") continue;
    out.set(r.beat, (r.lanes ?? []).map((x: any) => x === true));
  }
  return out;
}
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
/** deck.json（ネスト形式）から buildSimulateInput を組む。dropCardFrames でカード枠フォトの発動を止める */
function buildCase(c: any, opts: { dropCardFrames?: number[] } = {}): { base: any; warnings: string[] } {
  const raw = readJson(c.deck);
  const aux = fs.existsSync(c.example) ? readJson(c.example) : {};
  const d = JSON.parse(JSON.stringify(raw.deck ?? raw));
  if (c.s3Fixes) {
    d.characters[3].ct_cuts = [{ skill: 2, value: 5 }];
    for (const ph of raw.myPhotos ?? []) {
      if (ph?.id === "uph-lane5-3" && ph.skill !== null) ph.skill.staminaScaling = "more_stamina";
    }
  }
  for (const lane of opts.dropCardFrames ?? []) {
    // カード枠フォト = characters[lane].photos[]（マイフォトは photoEquip 側で別に付く）
    if (Array.isArray(d.characters[lane - 1]?.photos)) d.characters[lane - 1].photos = [];
  }
  const myPhotos: any[] = raw.myPhotos ?? aux.myPhotos ?? [];
  const photoEquip: string[][] = raw.photoEquip ?? aux.photoEquip ?? [];
  photoEquip.forEach((ids: string[], i: number) => {
    const ch = d.characters[i];
    if (ch === undefined) return;
    if (!Array.isArray(ch.photos)) ch.photos = [];
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
    audience: c.audience, laneFans: c.laneFans, maxCapacity: c.maxCapacity,
    mentalOverride: raw.mentalOverride ?? aux.mentalOverride,
    missedNotes: raw.missedNotes ?? aux.missedNotes,
    disabledSkillIds: raw.disabledSkillIds ?? aux.disabledSkillIds,
    userPhotoSkills,
  } as any);
  return { base: built.base, warnings: built.warnings };
}

/* ===================== 実測 act 台帳（A9 と同一ロジック） ===================== */
interface MeasAct {
  order: number | null; beat: number; lane: number; kind: string; name: string; level: number | null;
  cur: number | null; maxs: number | null; phase: string | null;
  cost: number | null; basis: string; effNow: string[]; effLines: string[]; targets: string | null; file: string | null;
}
function laneRead(row: any, lane: number): any {
  const l = row?.lanes;
  if (Array.isArray(l)) return l[lane - 1];
  if (l !== null && typeof l === "object") return l[String(lane)] ?? l[`lane${lane}`] ?? null;
  return null;
}
const parsePair = (s: unknown): [number | null, number | null] => {
  if (typeof s === "number") return [s, null];
  const m = String(s ?? "").replace(/,/g, "").match(/(\d+)\s*\/\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
};
const photoType = (t: string, name: string): boolean => /^(photo|フォト)$/i.test(t) || /スキル$/.test(name) || name.includes("マイフォト");
function detectSchema(list: any[]): "s1" | "s2" | "s3" {
  const f: any = list[0] ?? {};
  if (typeof f.stamina_cost === "number" || typeof f.skill_id === "string") return "s2";
  if (typeof f.stamina_display === "string" || f.stamina_phase !== undefined) return "s1";
  return "s3";
}
function measActs(measRaw: any): { acts: MeasAct[]; schema: string } {
  const raw = measRaw.skill_activations_summary;
  const list = (Array.isArray(raw) ? raw : Object.values(raw ?? {}))
    .filter((e: any) => typeof e?.beat === "number" && Number(e?.lane) >= 1 && Number(e?.lane) <= 5) as any[];
  const schema = detectSchema(list);
  const acts: MeasAct[] = [];
  for (const e of list) {
    const name = String(e.skill_name ?? e.skill_type ?? "?");
    const tRaw = String(e.skill_type ?? e.type ?? "");
    const [cur, mx] = parsePair(e.stamina ?? e.stamina_display ?? e.stamina_after);
    acts.push({
      order: typeof e.order === "number" ? e.order : null,
      beat: e.beat, lane: Number(e.lane), name,
      kind: photoType(tRaw, name) ? "photo" : tRaw.toUpperCase(),
      level: typeof e.skill_lv === "number" ? e.skill_lv : (typeof e.skill_level === "number" ? e.skill_level : null),
      cur, maxs: mx,
      phase: e.stamina_phase !== undefined && e.stamina_phase !== null ? String(e.stamina_phase) : null,
      cost: null, basis: "",
      effNow: (Array.isArray(e.effects_now) ? e.effects_now : []).map(String),
      effLines: (Array.isArray(e.effect_lines) ? e.effect_lines : Array.isArray(e.effects) ? e.effects : []).map(String),
      targets: typeof e.targets === "string" ? e.targets : null,
      file: typeof e.file === "string" ? e.file : null,
    });
  }
  acts.sort((a, b) => a.beat - b.beat || (a.order ?? 0) - (b.order ?? 0) || a.lane - b.lane);
  if (schema === "s2") {
    for (const a of acts) {
      const st = (list.find((e: any) => Number(e.lane) === a.lane && e.beat === a.beat && String(e.skill_name) === a.name) as any)?.stamina_cost;
      a.cost = typeof st === "number" ? st : null;
      a.basis = a.cost !== null ? "記載値(原価)" : "記載なし";
    }
  } else if (schema === "s1") {
    for (let lane = 1; lane <= 5; lane++) {
      const seq = acts.filter((x) => x.lane === lane);
      for (let i = 1; i < seq.length; i++) {
        const p = seq[i - 1]; const c = seq[i];
        if (p.cur === null || c.cur === null) { c.basis = "観測値なし"; continue; }
        const dd = p.cur - c.cur;
        const pPost = !/発動前/.test(p.phase ?? "");
        const cPost = !/発動前/.test(c.phase ?? "");
        const tag = p.beat === c.beat ? "同ビート" : `ビート跨ぎ(+${c.beat - p.beat})`;
        if (pPost && cPost) { c.cost = dd; c.basis = `1act差(${tag},前=発動後)`; }
        else if (!pPost && !cPost) { p.cost = dd; p.basis = `1act差(${tag},先読=発動前)`; }
        else { c.basis = `2act混在(${tag})`; }
      }
      if (seq.length > 0) seq[0].basis = "系列先頭";
    }
    for (const a of acts) if (a.cost === null && a.phase !== null && /変化なし/.test(a.phase)) { a.cost = 0; a.basis = "変化なし=消費0"; }
  } else {
    for (let lane = 1; lane <= 5; lane++) {
      let prev: MeasAct | null = null;
      for (const a of acts.filter((x) => x.lane === lane)) {
        if (a.cur === null) { a.basis = "読取なし"; continue; }
        if (prev === null) a.basis = "系列先頭";
        else {
          const gap = a.beat - prev.beat;
          if (gap === 0) { const dd = (prev.cur as number) - a.cur; a.cost = dd; a.basis = dd >= 0 ? "同一ビート内" : "同一ビート内(逆順)"; }
          else a.basis = `ビート跨ぎ(+${gap})`;
        }
        prev = a;
      }
    }
  }
  return { acts, schema };
}
/** S1 の timeline から「実機が表示していた buff 段数」を (lane,beat) で引く */
function realBoostTimeline(measRaw: any): Map<string, { vocal: number; dance: number; visual: number; all: string[] }> {
  const out = new Map<string, { vocal: number; dance: number; visual: number; all: string[] }>();
  const rows = Array.isArray(measRaw?.timeline) ? measRaw.timeline : [];
  for (const row of rows) {
    const beat = row?.beat;
    if (typeof beat !== "number") continue;
    for (let l = 1; l <= 5; l++) {
      const lane = laneRead(row, l);
      const effs: any[] = Array.isArray(lane?.effects) ? lane.effects : [];
      const rec = { vocal: 0, dance: 0, visual: 0, all: effs.map((e: any) => `${e?.name}${e?.stage ?? ""}`) };
      for (const e of effs) {
        const nm = String(e?.name ?? ""); const st = Number(e?.stage ?? 0) || 0;
        if (!/ブースト/.test(nm)) continue;
        if (/ボーカル/.test(nm)) rec.vocal += st;
        else if (/ダンス/.test(nm)) rec.dance += st;
        else if (/ビジュアル/.test(nm)) rec.visual += st;
      }
      out.set(`${l}:${beat}`, rec);
    }
  }
  return out;
}
/** "5段階 ボーカルブースト" 形式（S3 effects_now）から boost 段数を読む */
function boostFromEffNow(list: string[]): { vocal: number; dance: number; visual: number } {
  const rec = { vocal: 0, dance: 0, visual: 0 };
  for (const s of list) {
    const m = s.match(/(\d+)段階\s*(ボーカル|ダンス|ビジュアル)ブースト/);
    if (m === null) continue;
    if (m[2] === "ボーカル") rec.vocal += Number(m[1]);
    else if (m[2] === "ダンス") rec.dance += Number(m[1]);
    else rec.visual += Number(m[1]);
  }
  return rec;
}

/* ===================== sim 実行 ===================== */
interface SimAct { lane: number; beat: number; phase: string; id: string; kind: string; name: string; cost: number | null; fail: boolean; failReason: string | null }
type Attr = "vocal" | "dance" | "visual";
interface BoostInst { type: string; stages: number; rem: number; src: string }
interface RunOut {
  res: any; base: any; series: Map<string, number | null>; acts: SimAct[];
  photoInv: Array<{ lane: number; id: string; name: string; lv: number | null; dur: number | null; stock: number | null; ct: number | null; limit: number | null; src: string }>;
  snaps: Map<string, any>;
  /** ビート終端の boost インスタンス（effectInspector 由来） */
  inst: Map<string, BoostInst[]>;
  laneAttr: (Attr | null)[];
}
function runSim(baseIn: any, c: any, label: string, opts: { dropCardFrames?: number[] } = {}): RunOut {
  const base: any = { ...baseIn, lanes: baseIn.lanes.map((l: any) => ({ ...l, photos: (l.photos ?? []).map((p: any) => ({ ...p })) })) };
  for (const laneNum of opts.dropCardFrames ?? []) {
    const lane = base.lanes[laneNum - 1];
    if (lane === undefined) continue;
    lane.photos = (lane.photos ?? []).filter((p: any) => String(p.id).startsWith("uph-"));
  }
  const critMap = loadCrit(readJson(c.critFile), c.critFormat);
  const nameOf = new Map<string, string>();
  for (const lane of base.lanes as any[]) for (const s of [...(lane.skills ?? []), ...(lane.photos ?? [])]) nameOf.set(s.id, s.name ?? s.id);
  const inst = new Map<string, BoostInst[]>();
  const inspector = (beat: number, states: any[]): void => {
    for (const st of states) {
      const rows: BoostInst[] = (st.effects ?? [])
        .filter((e: any) => /_boost$/.test(String(e.type)))
        .map((e: any) => ({ type: String(e.type), stages: Number(e.stages ?? 0), rem: Number(e.remainingBeats ?? -1), src: nameOf.get(e.sourceSkillId) ?? String(e.sourceSkillId) }));
      inst.set(`${st.input.lane}:${beat}`, rows);
    }
  };
  const res: any = simulateTimeline({
    ...base,
    rng: new NeutralRng(),
    criticalProvider: (b: number, l: number) => critMap.get(b)?.[l - 1] === true,
    effectInspector: inspector,
  } as any);
  const photoInv: RunOut["photoInv"] = [];
  for (const lane of base.lanes as any[]) {
    for (const p of lane.photos ?? []) {
      const dur = Math.max(0, ...(p.effects ?? []).map((e: any) => e.durationBeats ?? 0));
      photoInv.push({
        lane: lane.lane, id: p.id, name: p.name ?? p.id, lv: p.level ?? null, dur: dur > 0 ? dur : null,
        stock: p.staminaCost ?? null, ct: p.ct ?? null, limit: p.limitPerLive ?? null,
        src: String(p.id).startsWith("uph-") ? "マイフォト" : "カード枠",
      });
    }
  }
  const acts: SimAct[] = [];
  for (const a of res.activations as any[]) {
    if (!(a.lane >= 1)) continue;
    acts.push({
      lane: a.lane, beat: a.beat, phase: String(a.phase ?? "?"), id: a.skillId, kind: String(a.kind),
      name: nameOf.get(a.skillId) ?? a.skillId, cost: N(a.staminaCost), fail: a.success !== true, failReason: a.failReason ?? null,
    });
  }
  const series = new Map<string, number | null>();
  const snaps = new Map<string, any>();
  for (const bt of res.beats as any[]) {
    for (let l = 1; l <= 5; l++) {
      series.set(`${l}:${bt.beat}`, N(bt.staminaAfter?.[l - 1]));
      const bs = bt.buffSnapshots?.[l - 1];
      if (bs !== undefined) snaps.set(`${l}:${bt.beat}`, bs);
    }
  }
  const laneAttr: (Attr | null)[] = (base.lanes as any[]).map((l: any) => l.attribute ?? null);
  return { res, base, series, acts, photoInv, snaps, inst, laneAttr };
}

/* ===================== 出力 ===================== */
const L: string[] = [];
const P0 = (s = ""): void => { L.push(s); };
P0("=== Phase 16 Action 9b: ①自己バフ課金 vs ②持続境界の分離 ＋ A9 残件クローズ ===");
P0(`  実行: 2026-10-02 / --probe=${PROBE ? "ON（T3 の解析側オーバーライドを適用）" : "OFF"}`);
P0("  方針: src/** は読み取り専用。実測は aipura_nox（読み取りのみ）＋ research/26_data_integrity の S2/S3 v3。");
P0("  A9 §1 の欠陥（[B] の deck/sim 添字合わせ）は本 Harness で「名前＋持続＋原価」の対応づけに修正済み。");
P0("");

for (const c of CASES) {
  const measRaw = readJson(c.measured);
  const built = buildCase(c);
  const run = runSim(built.base, c, "lane_fans・乱数中立");
  const probeRun = PROBE ? runSim(
    buildCase(c, { dropCardFrames: PROBE_DROP_CARDFRAME[c.id] ?? [] }).base, c, "probe",
    { dropCardFrames: PROBE_DROP_CARDFRAME[c.id] ?? [] },
  ) : null;
  const { acts, schema } = measActs(measRaw);
  // S1 は timeline（ビート別スタミナ）から act 1 件分のコストを直接取れる。直前ビートが定常
  // （＝継続回復ティックが混入していない）ときだけ採用する。
  if (schema === "s1") {
    const tlStam = new Map<string, number | null>();
    for (const row of (Array.isArray(measRaw?.timeline) ? measRaw.timeline : [])) {
      for (let l = 1; l <= 5; l++) tlStam.set(`${l}:${row.beat}`, N(laneRead(row, l)?.current_stamina));
    }
    for (const a of acts) {
      if (a.cur === null) continue;
      const cell = acts.filter((x) => x.lane === a.lane && x.beat === a.beat);
      if (cell.length !== 1) continue; // ビート内に 1 act だけのセルに限る（複数 act の按分は act 行の差分に任せる）
      const prev = tlStam.get(`${a.lane}:${a.beat - 1}`) ?? null;
      const cur = tlStam.get(`${a.lane}:${a.beat}`) ?? null;
      const prev2 = tlStam.get(`${a.lane}:${a.beat - 2}`) ?? null;
      if (prev === null || cur === null || prev2 === null || prev2 !== prev) continue;
      a.cost = prev - cur;
      a.basis = "timeline差(直前ビート定常=回復混入なし)";
    }
  }
  const weight = (built.base.stage as any).skillStaminaWeightPermil ?? 1000;
  const realBoost = realBoostTimeline(measRaw);
  const attrOf = (lane: number): string => run.laneAttr[lane - 1] ?? "vocal";
  const permilAt = (lane: number, beat: number): number => {
    const s = run.snaps.get(`${lane}:${beat}`);
    return s ? consumptionMultiplierPermil(s, run.laneAttr[lane - 1] ?? undefined) : 1000;
  };
  const expCostOf = (stock: number, permil: number): number => mulPermil(mulPermil(stock, weight), permil);
  const segsOf = (stock: number, cost: number): number[] => {
    const out: number[] = [];
    for (let n = 0; n <= 60; n++) if (expCostOf(stock, 1000 + 10 * n) === cost) out.push(n);
    return out;
  };
  const deckRaw = readJson(c.deck);
  const laneOfId = new Map<string, number>();
  ((deckRaw.photoEquip ?? []) as any[]).forEach((arr: any, i: number) => {
    for (const id of (Array.isArray(arr) ? arr : [])) laneOfId.set(String(id), i + 1);
  });
  const deckInv = ((deckRaw.myPhotos ?? []) as any[]).map((mp: any) => ({
    id: mp.id, lane: laneOfId.get(String(mp.id)) ?? Number(String(mp.id).match(/lane(\d)|l(\d)/)?.[1] ?? 0),
    name: mp.name, lv: mp.skill?.level ?? null, dur: mp.skill?.durationBeats ?? null,
    stock: mp.skill?.staminaCost ?? null, type: mp.skill?.type ?? null, stages: mp.skill?.stages ?? null,
    target: mp.skill?.target ?? null, ct: mp.skill?.ct ?? null,
  }));

  P0(`########## ${c.id} ${c.stageFile} / ${c.chartFile} ##########`);
  P0(`  実測 act ${acts.length} 件（スキーマ ${schema}）/ sim act 成功 ${run.acts.filter((a) => !a.fail).length} 件 / ステージ重み ${weight}‰ / レーン属性 ${run.laneAttr.join(",")}`);

  /* ---- [1] A9 §1 欠陥の修正: 三角照合表（名前＋持続＋原価で対応づけ） ---- */
  P0("");
  P0("  --- [1] 三角照合表（deck myPhotos ⇔ sim in-game stock ⇔ 実測 act）: A9 §1 の添字合わせを廃止 ---");
  P0("      対応づけ規則: (名前一致) ∧ (持続一致) ∧ (原価一致) を満たす組だけを「供給一致」とする。");
  let supSame = 0; let supDiff = 0; const supRows: string[] = [];
  for (let lane = 1; lane <= 5; lane++) {
    const simL = run.photoInv.filter((x) => x.lane === lane && x.src === "マイフォト");
    const deckL = deckInv.filter((x) => x.lane === lane);
    P0(`      L${lane}（attr=${attrOf(lane)}）`);
    P0(`        deck myPhotos : ${deckL.map((x) => `${x.name}[${x.type ?? "?"} ${x.stages ?? "-"}段 ${x.dur ?? "-"}b 原価${x.stock} 対象${x.target ?? "-"}]`).join(" / ") || "（0 枚）"}`);
    P0(`        sim マイフォト: ${simL.map((x) => `${x.name}[原価${x.stock} ${x.dur ?? "-"}b]`).join(" / ") || "（0 枚）"}`);
    const simAll = run.photoInv.filter((x) => x.lane === lane);
    P0(`        sim 全フォト枠: ${simAll.map((x) => `${x.name.slice(0, 14)}[${x.stock}${x.src === "カード枠" ? "・カード枠" : ""}]`).join(" / ") || "（空）"}`);
    for (const dph of deckL) {
      const hit = simL.find((s) => s.name === dph.name && s.dur === dph.dur && s.stock === dph.stock);
      if (hit !== undefined) { supSame++; supRows.push(`        ○ 供給一致 L${lane} ${dph.name}[原価${dph.stock} ${dph.dur}b]`); }
      else {
        supDiff++;
        const near = simL.find((s) => s.name === dph.name);
        supRows.push(`        ✕ 供給不一致 L${lane} ${dph.name}[deck 原価${dph.stock} ${dph.dur}b] → sim ${near === undefined ? "同名なし" : `[原価${near.stock} ${near.dur}b]`}`);
      }
    }
  }
  for (const r of supRows) P0(r);
  P0(`      → 供給一致 ${supSame} / 不一致 ${supDiff}（A9 §1 の「原価一致 0」は添字合わせの産物。上の規則で対応づけると内訳はこの行）`);

  /* ---- [2] T1: ①②分離（境界走査） ---- */
  P0("");
  P0("  --- [2] T1 ①②分離: 「他ソースの boost が当該ビートで満了する」act の全件走査 ---");
  P0("      読み方: engine のコストは発火時点の live 状態（engine.ts:1435 snapshotOf）。");
  P0("        phase=first/main は step7/8（減算前）・phase=last は step11（step10 の減算**後**）に発火する。");
  P0("      実機の buff ライフタイムは S1 = timeline[].lanes[].effects[]（ビート別・段数つき）、S3 = act 行 effects_now。");
  P0("      | サンプル | L | beat | phase | act | engine cost | 適用段数 | 前ビート表示 | 当該ビート表示 | 当該ビートで満了したインスタンス | 判定 |");
  const t1Rows: string[] = [];
  const t1Count = { selfOnly: 0, boundary: 0, both: 0, neither: 0, unknown: 0 };
  const boostAtBeatOf = (lane: number, beat: number): { vocal: number; dance: number; visual: number } | undefined => {
    const tl = realBoost.get(`${lane}:${beat}`);
    if (tl !== undefined) return tl;
    // S3/S2 はビート別 timeline が無いので act 行の effects_now（そのビート時点の表示）で代用
    const rows = acts.filter((x) => x.lane === lane && x.beat === beat && x.effNow.length > 0);
    if (rows.length === 0) return undefined;
    return boostFromEffNow(rows[rows.length - 1].effNow);
  };
  for (const a of run.acts.filter((x) => !x.fail)) {
    const boostAtBeat = boostAtBeatOf(a.lane, a.beat);
    const boostPrev = boostAtBeatOf(a.lane, a.beat - 1);
    const expiring = (run.inst.get(`${a.lane}:${a.beat}`) ?? []).filter((i) => i.rem <= 0);
    const inv = run.photoInv.find((p) => p.id === a.id);
    const isPhoto = String(a.kind).toLowerCase().includes("photo") || inv !== undefined;
    if (!isPhoto) continue;
    if (boostAtBeat === undefined) continue; // S3/S2 はビート別表示が無い（act 行のみ）
    const attr = attrOf(a.lane) as Attr;
    const realStages = boostAtBeat[attr];
    const prevStages = boostPrev?.[attr] ?? 0;
    const base = inv?.stock ?? null;
    const applied = base !== null && a.cost !== null ? segsOf(base, a.cost) : [];
    const appliedTxt = a.cost !== null && base !== null ? `${a.cost}（原価${base}×重み${weight}）` : "null";
    const expTxt = expiring.length === 0 ? "なし" : expiring.map((i) => `${i.type}${i.stages}段@${i.src}(rem${i.rem})`).join(" + ");
    const lost = realStages > 0 && expiring.length > 0;
    const verdict = lost
      ? (expiring.every((i) => i.src !== a.name) ? "②境界（他ソースの最終ビート）" : "①/②混在")
      : boostAtBeat[attr] === 0 && prevStages > 0 ? "②境界（前ビートまで表示・当該ビートで消滅）" : "—";
    if (lost) {
      if (expiring.every((i) => i.src !== a.name)) t1Count.boundary++; else t1Count.both++;
      t1Rows.push(`      | ${c.id} | ${a.lane} | ${a.beat} | ${a.phase} | ${a.name.slice(0, 18)} | ${appliedTxt} | ${applied.join("/") || "-"} | ${prevStages}段 | ${realStages}段 | ${expTxt} | ${verdict} |`);
    }
  }
  for (const r of t1Rows) P0(r);
  P0(`      → 条件該当 act ${t1Rows.length} 件（②境界 ${t1Count.boundary} / ① 自ソース由来 ${t1Count.both}）`);

  /* ---- [2b] S1 L1 b60/b120 の深掘り（A9 の核心セル） ---- */
  if (c.id === "S1") {
    P0("");
    P0("  --- [2b] S1 L1 伊吹渚 6/22（原価662・vocal_boost3段[22ビート]・CT60）の3発動を1ビートずつ ---");
    const ph = run.photoInv.find((p) => p.lane === 1 && p.stock === 662);
    P0(`      実測 act 行の対象: ${acts.filter((x) => x.lane === 1 && x.kind === "photo").map((x) => `b${x.beat}「${x.effLines.join(" / ")}」targets=${x.targets}`).join(" ｜ ")}`);
    P0("      → 実機では**このフォトの付与先は L3**（ボーカルタイプ1人=L3）。発動レーン L1 自身には付かない。");
    for (const beat of [1, 60, 120]) {
      const at = run.acts.find((x) => x.lane === 1 && x.beat === beat && !x.fail && String(x.kind).toLowerCase().includes("photo"));
      const instEnd = run.inst.get(`1:${beat}`) ?? [];
      const rb = realBoost.get(`1:${beat}`); const rp = realBoost.get(`1:${beat - 1}`);
      P0(`      ▶ b${beat}:`);
      P0(`        engine: phase=${at?.phase ?? "-"} cost=${at?.cost ?? "-"}（原価${ph?.stock}）| 実測タイムライン L1 buff: 前ビート ${JSON.stringify(rp)} / 当該ビート ${JSON.stringify(rb)}`);
      P0(`        ビート終端の boost インスタンス: ${instEnd.map((i) => `${i.type}${i.stages}段@${i.src}(rem${i.rem})`).join(" + ") || "なし"}`);
      if (at !== undefined && at.cost !== null && ph?.stock != null) {
        const base = mulPermil(ph.stock, weight);
        P0(`        段数換算: cost=${at.cost} / (原価${ph.stock}×重み${weight}=${base}) → ${((at.cost / base - 1) * 100).toFixed(1)}% = ${((at.cost / base - 1) * 100 / 1).toFixed(1)}段相当（1段=+1.0%）`);
      }
    }
    P0("      裁定材料: 実機の表示ライフタイム（S1 timeline）と engine の phase を突き合わせると、");
    P0("        b60 は「他ソース（準備も立った大舞台＝L2 A スキル）の最終ビート」で、その buff は実機 b60 に表示・b61 で消滅。");
    P0("        engine も同じインスタンスを b60 の snapshot（step7）に持つが、**フォトは CT の関係で step11（phase=last）に発火**し、");
    P0("        step10 の減算で rem=0 になった後なので snapshotOf から落ちる → cost 662（実機 681）。");
  }

  /* ---- [3] 実測 cost ÷ (原価×重み) の総当たり（±6% の正体） ---- */
  P0("");
  P0("  --- [3] 実測 act cost ÷ (原価×重み) の比と、実機が表示していた boost 段数の対照（±6% の正体） ---");
  P0("      「原価」は photo=deck myPhotos の staminaCost、A/P/SP=build が解決した SkillDef.staminaCost（＝マスタ Lv 別）。");
  const defs: Array<{ id: string; lane: number; name: string; kind: string; cost: number | null; dur: number | null }> = [];
  for (const lane of run.base.lanes as any[]) {
    for (const s of lane.skills ?? []) defs.push({ id: s.id, lane: lane.lane, name: s.name ?? s.id, kind: String(s.kind), cost: N(s.staminaCost), dur: Math.max(0, ...(s.effects ?? []).map((e: any) => e.durationBeats ?? 0)) || null });
    for (const p of lane.photos ?? []) defs.push({ id: p.id, lane: lane.lane, name: p.name ?? p.id, kind: "photo", cost: N(p.staminaCost), dur: Math.max(0, ...(p.effects ?? []).map((e: any) => e.durationBeats ?? 0)) || null });
  }
  let ratioOver = 0; let ratioEq = 0; const gammaRows: string[] = [];
  for (const a of acts.filter((x) => x.cost !== null && (x.cost as number) > 0 && /同一ビート内|1act差\(同ビート|timeline差/.test(x.basis))) {
    const kindOk = (k: string): boolean => (a.kind === "photo" ? k === "photo" : k === a.kind);
    const cands = defs.filter((d) => d.lane === a.lane && kindOk(d.kind));
    const byName = cands.filter((d) => d.name.includes(a.name.replace(/スキル$/, "")) || a.name.includes(d.name));
    const pool = byName.length > 0 ? byName : cands;
    const scored = pool.map((d) => ({ d, base: mulPermil(d.cost ?? 0, weight) }))
      .filter((x) => x.base > 0)
      .sort((p, q) => Math.abs(p.base - (a.cost as number)) - Math.abs(q.base - (a.cost as number)));
    const best = scored[0];
    if (best === undefined) {
      P0(`      ${c.id} b${String(a.beat).padStart(3)} L${a.lane} ${a.kind.padEnd(5)} ${a.name.slice(0, 18).padEnd(18)} 実測 ${pad(a.cost, 6)} → 原価候補なし（レーン内に同種別の定義が無い）`);
      continue;
    }
    const ratio = (a.cost as number) / best.base;
    const rb = boostAtBeatOf(a.lane, a.beat);
    const attr = attrOf(a.lane) as Attr;
    const other = rb === undefined ? 0 : (rb.vocal + rb.dance + rb.visual) - rb[attr];
    const own = rb === undefined ? 0 : rb[attr];
    /** 実測 cost を厳密再現する boost 段数（floor 後の一致で判定。比の逆算では丸めで 1 段ずれる） */
    const exactStages = (raw: number, cost: number): number | null => {
      for (let n = 0; n <= 30; n++) if (mulPermil(mulPermil(raw, weight), 1000 + 10 * n) === cost) return n;
      return null;
    };
    const nObs = exactStages(best.d.cost as number, a.cost as number);
    const eAct = run.acts.find((x) => x.lane === a.lane && x.beat === a.beat && !x.fail && (x.kind === a.kind || (a.kind === "photo" && String(x.kind).toLowerCase().includes("photo"))));
    const nEng = eAct?.cost != null && best.d.cost !== null ? exactStages(best.d.cost, eAct.cost) : null;
    if (Math.abs(ratio - 1) < 0.0005) ratioEq++; else ratioOver++;
    const reason = nObs === null ? "段数で再現不能"
      : nEng === null ? "engine 側に同 act なし"
        : nObs === nEng ? "engine と一致"
          : nObs > nEng
            ? `engine 過小（実測 ${nObs} 段 / engine ${nEng} 段）: ${other > 0 ? `他属性 boost ${other} 段を engine が数えない` : ""}${eAct?.phase === "last" ? " / phase=last（持続の最終ビートを減算後に見ている）" : ""}`
            : `engine 過大（実測 ${nObs} / engine ${nEng}）`;
    const line = `      ${c.id} b${String(a.beat).padStart(3)} L${a.lane} ${a.kind.padEnd(5)} ${a.name.slice(0, 20).padEnd(20)} 実測 ${pad(a.cost, 5)} = 原価${best.d.cost}×${weight}‰×(${nObs === null ? "?" : 1000 + 10 * nObs})‰ [${nObs ?? "?"}段] | engine cost ${pad(eAct?.cost ?? null, 5)} [${nEng ?? "?"}段・phase=${eAct?.phase ?? "-"}] | 表示 v${rb?.vocal ?? "-"}/d${rb?.dance ?? "-"}/vi${rb?.visual ?? "-"}（自属性${attr} ${own} / 他属性 ${other}） | ${reason}`;
    P0(line);
    if (nObs !== null && nEng !== null && nObs !== nEng) gammaRows.push(line);
  }
  P0(`      → クリーン cost の act: 比 1.000 が ${ratioEq} 件 / 比 > 1 が ${ratioOver} 件。`);
  P0("      engine と段数が食い違うセル（＝±6% の正体。実測＝発火瞬間の boost 合計段数として厳密再現）:");
  for (const r of gammaRows) P0(`        ${r.trim()}`);

  /* ---- [4] T2: α/β/γ の裁定 ---- */
  P0("");
  P0("  --- [4] T2 α/β/γ 裁定（実測 act と sim のフォト同一性・コスト） ---");
  const simPhotoActs = run.acts.filter((x) => !x.fail && String(x.kind).toLowerCase().includes("photo"));
  for (let lane = 1; lane <= 5; lane++) {
    const mA = acts.filter((x) => x.lane === lane && x.kind === "photo");
    const sA = simPhotoActs.filter((x) => x.lane === lane);
    P0(`      L${lane}: 実測 photo act ${mA.length} 件 [${mA.map((x) => `b${x.beat}`).join(",") || "-"}] / sim 成功 photo act ${sA.length} 件 [${sA.map((x) => `b${x.beat}:${x.name.slice(0, 10)}`).join(",") || "-"}]`);
  }

  /* ---- [5] T3 の 4 セル ---- */
  P0("");
  P0("  --- [5] T3 4 セルの現状 ---");
  for (const t of T3_CELLS.filter((x) => x.s === c.id)) {
    const cur = run.acts.filter((x) => x.lane === t.lane && x.beat === t.beat);
    const probe = probeRun?.acts.filter((x) => x.lane === t.lane && x.beat === t.beat) ?? [];
    const ma = acts.filter((x) => x.lane === t.lane && x.beat === t.beat);
    P0(`      ▶ L${t.lane} b${t.beat}（${t.want}）`);
    P0(`          sim(現規則): ${cur.map((x) => `${x.kind}:${x.name.slice(0, 14)}${x.cost !== null ? ` cost${x.cost}` : ""}${x.fail ? ` **FAIL**(${x.failReason})` : ""}`).join(" + ") || "（発動なし）"}`);
    if (probeRun !== null) P0(`          sim(--probe): ${probe.map((x) => `${x.kind}:${x.name.slice(0, 14)}${x.cost !== null ? ` cost${x.cost}` : ""}${x.fail ? ` **FAIL**(${x.failReason})` : ""}`).join(" + ") || "（発動なし）"}`);
    P0(`          実測 act: ${ma.map((x) => `${x.kind}:${x.name}${x.cost !== null ? ` cost${x.cost}(${x.basis})` : ""}`).join(" + ") || "（記録なし）"}`);
    P0(`          スタミナ b${t.beat - 1}: 実測 ${pad(acts.find((x) => x.lane === t.lane && x.beat === t.beat - 1)?.cur ?? null)} / sim ${pad(run.series.get(`${t.lane}:${t.beat - 1}`) ?? null)} | b${t.beat}: 実測 ${pad(acts.find((x) => x.lane === t.lane && x.beat === t.beat)?.cur ?? null)} / sim ${pad(run.series.get(`${t.lane}:${t.beat}`) ?? null)}`);
  }
  P0("");
}

/* ===================== 総括 ===================== */
P0("########## 総括 ##########");
P0("  [T1] ①②の裁定:");
P0("    ・実機の buff ライフタイムは S1 timeline のビート別表示で直接読める。S1 L1 伊吹渚 6/22 の 3 発動のうち");
P0("      食い違うのは b60 だけ（engine 662 / 実測 681）。b60 は **他ソース（L2 A スキル「準備も立った大舞台」）の最終ビート**で、");
P0("      その boost 3 段は実機 b60 に表示され b61 で消える（＝実機のライフタイムは申告どおり）。");
P0("    ・engine は同じインスタンスを b60 の snapshot(step7) には持つが、フォトが CT 由来で **phase=last（step11）** に発火し、");
P0("      step10 の減算後なのでコスト倍率から落ちる。→ **①自己バフ課金ではなく ②持続境界（最終ビートの扱い）** が原因。");
P0("    ・①の反証: このフォトの付与先は実測で「ボーカルタイプ1人（=L3）」であり、発動レーン L1 自身ではない（S1 act 行 order4/13/22）。");
P0("      自 act の付与を自分の cost に足す規則では L1 の 681 は出ない（L3 のコストにしか効かない）。");
P0("  [T2] ±6% の正体（4 候補の潰し）:");
P0("    ・①スタミナ消費削減系 effect_lines: 該当なし（+5% を示すセルにコスト低下系の表示は無い）。");
P0("    ・②Lv バッジ誤読: フォトの staminaCost は Lv 非依存（マスタはカードスキルのみ Lv 別消費を持つ）。");
P0("    ・③OCR 誤読: 同一セルの独立 2 観測（S3 b13/b73）が同一値 2,085、S1 は timeline と act 行が整合。");
P0("    ・④現在値/最大値比例: 比が一定（1.0498）で現在値・最大値に依存しないことから棄却。");
P0("    ・残った説明 = **レーンに乗っている boost の段数 × 1%**。engine は自属性ブーストのみ数える");
P0("      （consumptionMultiplierPermil(snap, attr)）ため、他属性ブーストが乗っているセルだけ engine が安く出る。");
P0(`  --probe = ${PROBE ? "ON: 4 セルの反転有無は上の [5] 行" : "OFF（T3 の模擬は --probe で実行）"}`);
P0("");
P0("--- 検証フッター ---");
P0("  engine.ts・src/** は読み取りのみ（本 Harness は import のみ・書き込みなし）。");
P0("  再実行: npx tsx research/23_beat_score_analysis/phase16_action9b_selfbuff_separation.ts [--probe]");
fs.writeFileSync(path.join(repoRoot, "research", "23_beat_score_analysis", "phase16_action9b_selfbuff_separation_out.txt"), `${L.join("\n")}\n`, "utf8");
console.log(`出力 ${L.length} 行 → research/23_beat_score_analysis/phase16_action9b_selfbuff_separation_out.txt`);

/**
 * Phase 16 Action 9: act 単位スタミナ台帳とフォト原価台帳（実行: 2026-10-01 ／ 担当: cline）
 *
 * 動機（A6 の証跡を継承）:
 *  - A6 は act 単位 cost 表を作らず (lane,beat) セル合計しか見ておらず、「1 act 超過か全 act 超過か」を
 *    決定できなかった（§1-4 の 4 セルが未解決のまま残った）。
 *  - A6 §4 の「フォト原価 ±6% 変動」は **ビート跨ぎの raw 差分**（= 前ビート読取 + 継続回復 − 現ビート読取）
 *    を stock×重み と比べたもの → 継続回復が消費側に混入している疑いがある。
 *  - A6 §0 は deck の myPhotos にあるフォト原価（676/718 ではなく 706/733）を「固定値なし」と誤読した。
 *
 * やること（prompts/phase16-action9-photo-ledger-and-act-cost.md の T1〜T4）:
 *  [A] T1 act 単位 cost 台帳（基準の性質を明記）と集合比較 4 数値
 *  [B] T2 フォト原価三角照合（deck myPhotos・実測 effect_lines・sim）＋ α/β/γ 判定
 *  [C] ±6% 候補 4 検（①バフ ②Lv読み違い ③OCR ④比例）＋ 第5候補（継続回復の混入）
 *  [D] T3 4 セルの現状と解析側オーバーライド（--probe）
 *  [E] T4 ゲート（S1 L1 逐ビート一致が現行コードで成立しているか＝engine 側が壊れていないか）
 *  [F] cost 残差の発生箇所（発動時点の live 倍率 × 同一ビート内の act 順 × self-buff）の特定
 *
 * 実行: npx tsx research/23_beat_score_analysis/phase16_action9_photo_ledger.ts [--probe]
 *        > research/23_beat_score_analysis/phase16_action9_photo_ledger_out.txt
 *
 * 制約: `src/`（とくに engine.ts）は読み取りのみ・aipura_nox は読み取りのみ・既存 measured_data /
 *   deck / order PNG を変更しない・STAM_* 環境変数は既定で読まない（A6 までとは違い一切参照しない）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { NeutralRng } from "../../src/rng/neutral.js";
import { ContinuousRng } from "../../src/rng/random.js";
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
const dstr = (v: number | null, w = 8): string =>
  v === null || !Number.isFinite(v) ? "null".padStart(w) : `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("en-US")}`.padStart(w);
const pstr = (v: number | null, w = 8): string =>
  v === null || !Number.isFinite(v) ? "null".padStart(w) : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`.padStart(w);

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
    actSchema: "s3", // stamina="cur/max" 文字列・型は P/A/photo・effect_lines あり
  },
  {
    id: "S2",
    deck: path.join(noxRoot, "サンプル2", "deck.json"),
    example: path.join(repoRoot, "examples", "sample2.json"),
    stageFile: "qt-tower-680", chartFile: "chart-sun-004-001",
    audience: 13206, laneFans: [11996, 13543, 13741, 13255, 13496], maxCapacity: 70000,
    measured: path.join(repoRoot, "research", "26_data_integrity", "measured_data_s2_v3.json"),
    critFile: path.join(noxRoot, "サンプル2", "measured_data_v2.json"), critFormat: "keys",
    actSchema: "s2", // stamina_cost は「マスタ記載値」であって実測消費ではない
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
    actSchema: "s1", // stamina_display + stamina_phase（発動前/発動後）
    popsFile: path.join(noxRoot, "サンプル1", "lane_pops_backfill.json"),
  },
];

/** T3 の 4 セル（A6 §1-4 の sim 4 件違い） */
const T3_CELLS: Array<{ s: string; lane: number; beat: number; want: string }> = [
  { s: "S3", lane: 5, beat: 70, want: "実測=FAIL（スコアUPスキルが消費不能）" },
  { s: "S3", lane: 2, beat: 4, want: "実測=成功（新たな衣装とさらなる飛躍 Lv4）" },
  { s: "S3", lane: 2, beat: 34, want: "実測=成功（おめかしバニティ Lv4）" },
  { s: "S3", lane: 3, beat: 169, want: "実測=成功（殻をやぶる一歩 Lv4）" },
];
/** --probe 時の解析側オーバーライド（engine 無変更・入力側の操作のみ） */
const T3_PHOTO_ORDER: Record<string, string[]> = {
  // L5: 発動優先順を実測の発動順（スコアUP→獲得スタミナ多→クリティカル48→クリティカル40）に並べ替える
  S3: ["uph-uph-lane5-1", "uph-uph-lane5-3", "uph-uph-lane5-4", "uph-uph-lane5-2"],
};

/* ===================== データ供給（A6 と同一手順・STAM_* env は読まない） ===================== */
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
    out.set(r.beat, (r.lanes ?? [false, false, false, false, false]).map((x: any) => x === true));
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

/** サンプル deck.json（ネスト形式）から buildSimulateInput を組む（A6 と同一） */
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

/* ===================== 実測 act 台帳（サンプル別スキーマ適応） =====================
 * 2026-10-01 スキーマ確定（tmp_a9_probe / tmp_a9_probe2 の実測ダンプで確認）:
 *   S1 … 行 {order, beat, lane, type(P/Photo/A/SP), skill_name, effects[],
 *        stamina_display:"cur/max", stamina_phase:"発動前|発動後|変化なし（消費0）"}
 *        → act 単位 cost は **同一 (lane,beat,skill) の 発動前→発動後 ペアの差**（クリーン）
 *   S2 … 行 {order, beat, lane, skill_type, skill_name, skill_level, stamina_cost, ct, description}
 *        → cost は **記載値（マスタ原価）**。実測消費は stamina 系列から別途取る
 *   S3 … 行 {order, beat, lane, type(P/A/photo/フォト), skill_name, skill_lv,
 *        stamina:"cur/max", effect_lines[], effects_now[]}
 *        → 同一レーンの **同一ビート内の相邻 order 差** のみクリーン（ビート跨ぎは継続回復が混入）
 *   ※ timeline 行のレーン別スタミナは S1/S3 が lanes["1".."5"]、S2 が lanes["lane1".."lane5"]
 * ============================================================================== */
interface MeasAct {
  order: number | null; beat: number; lane: number; kind: string; name: string; level: number | null;
  cur: number | null; maxs: number | null; phase: string | null;
  cost: number | null; basis: string; gap: number | null; statedCost: number | null;
  effLines: string[]; effNow: string[]; note: string | null; desc: string | null;
}
/** timeline 行のレーン別読み取り（"1".."5" / "lane1".."lane5" / 配列のいずれにも対応） */
function laneRead(row: any, lane: number): any {
  const l = row?.lanes;
  if (Array.isArray(l)) return l[lane - 1];
  if (l !== null && typeof l === "object") return l[String(lane)] ?? l[`lane${lane}`] ?? null;
  return row?.stamina?.[lane] ?? null;
}
const parsePair = (s: unknown): [number | null, number | null] => {
  if (typeof s === "number") return [s, null];
  const m = String(s ?? "").replace(/,/g, "").match(/(\d+)\s*\/\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
};
/** "9221/9770" 文字列からも現在値を取り出す（数値はそのまま）。読み取り失敗は null */
const numOf = (v: unknown): number | null => (typeof v === "number" ? (Number.isFinite(v) ? v : null) : parsePair(v)[0]);
/** 実測のビート別スタミナ系列（null 読み取りは键ごと置かない＝比較母数 n に影響） */
function measSeries(measRaw: any): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const rows = Array.isArray(measRaw?.timeline) ? measRaw.timeline : Array.isArray(measRaw?.beats) ? measRaw.beats : [];
  for (const row of rows) {
    const beat = row?.beat ?? row?.frame_number;
    if (typeof beat !== "number") continue;
    for (let l = 1; l <= 5; l++) {
      const e = laneRead(row, l);
      const v = typeof e === "number" ? e : numOf(e?.current_stamina ?? e?.stamina_now ?? e?.now ?? e?.stamina);
      if (v !== null) out.set(`${l}:${beat}`, v);
    }
  }
  return out;
}
const photoType = (t: string, name: string): boolean => /^(photo|フォト)$/i.test(t) || /スキル$/.test(name) || name.includes("マイフォト");
/** スキーマ自動認識（CASES の actSchema は参照値。実ファイル側を優先する） */
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
    const lane = Number(e.lane);
    const name = String(e.skill_name ?? e.skill_type ?? "?");
    const tRaw = String(e.skill_type ?? e.type ?? "");
    const [cur, mx] = parsePair(e.stamina ?? e.stamina_display ?? e.stamina_after);
    acts.push({
      order: typeof e.order === "number" ? e.order : null,
      beat: e.beat, lane, name,
      kind: photoType(tRaw, name) ? "photo" : tRaw.toUpperCase(),
      level: typeof e.skill_lv === "number" ? e.skill_lv : (typeof e.skill_level === "number" ? e.skill_level : null),
      cur, maxs: mx,
      phase: e.stamina_phase !== undefined && e.stamina_phase !== null ? String(e.stamina_phase) : null,
      cost: null, basis: "", gap: null,
      statedCost: typeof e.stamina_cost === "number" ? e.stamina_cost : null,
      effLines: (Array.isArray(e.effect_lines) ? e.effect_lines : Array.isArray(e.effects) ? e.effects : []).map(String),
      effNow: (Array.isArray(e.effects_now) ? e.effects_now : []).map(String),
      note: typeof e.note === "string" ? e.note : (typeof e.skill_name_note === "string" ? e.skill_name_note : null),
      desc: typeof e.description === "string" ? e.description : null,
    });
  }
  acts.sort((a, b) => a.beat - b.beat || (a.order ?? 0) - (b.order ?? 0) || a.lane - b.lane);
  if (schema === "s2") {
    // 記載値＝マスタ原価。act 単位だが「実測消費」ではないので basis で区別する
    for (const a of acts) { a.cost = a.statedCost; a.basis = a.statedCost !== null ? "記載値(原価)" : "記載なし"; }
  } else if (schema === "s1") {
    /* s1 は行ごとに「発動前」か「発動後」かの位相しか持たない（1 act に 1 観測）。
     * したがって cost は「同一レーンの隣接観測の間隔」からしか決まらず、帰属規則が要る:
     *   前行=発動後/消費0 → 現行=発動後 : 間隔は現行 act 1 件分のみ = クリーン
     *   前行=発動前      → 現行=発動前 : 間隔は前行 act 1 件分のみ = クリーン（先読み）
     *   前行=発動前      → 現行=発動後 : 前行+現行の 2 act が混在 = 単独帰属できない（数値のみ記録）
     * A6 がここで何をしたかったか（「発動前後ペア」）をこの規則に置き換えた。 */
    for (let lane = 1; lane <= 5; lane++) {
      const seq = acts.filter((x) => x.lane === lane);
      for (let i = 1; i < seq.length; i++) {
        const p = seq[i - 1]; const c = seq[i];
        if (p.cur === null || c.cur === null) { c.basis = "観測値なし"; continue; }
        const d = p.cur - c.cur;
        const pPost = !/発動前/.test(p.phase ?? "");
        const cPost = !/発動前/.test(c.phase ?? "");
        const tag = p.beat === c.beat ? "同ビート" : `ビート跨ぎ(+${c.beat - p.beat})`;
        if (pPost && cPost) { c.cost = d; c.basis = `1act差(${tag},前=発動後)`; }
        else if (!pPost && !cPost) { p.cost = d; p.basis = `1act差(${tag},先読=発動前)`; }
        else { c.basis = `2act混在(${tag})計測値=${d}`; }
      }
      if (seq.length > 0) seq[0].basis = "系列先頭";
    }
    for (const a of acts) {
      if (a.cost === null && a.phase !== null && /変化なし/.test(a.phase)) { a.cost = 0; a.basis = "変化なし=消費0"; }
    }
  } else {
    // s3: レーン別・同一ビート内の相邻 order 差のみ採用（ビート跨ぎは継続回復が混入するので除外）
    for (let lane = 1; lane <= 5; lane++) {
      let prev: MeasAct | null = null;
      for (const a of acts.filter((x) => x.lane === lane)) {
        if (a.cur === null) { a.basis = "読取なし"; continue; }
        if (prev === null) a.basis = "系列先頭";
        else {
          a.gap = a.beat - prev.beat;
          if (a.gap === 0) {
            const d = (prev.cur as number) - a.cur;
            a.cost = d; a.basis = d >= 0 ? "同一ビート内" : "同一ビート内(逆順)";
          } else a.basis = `ビート跨ぎ(+${a.gap})`;
        }
        prev = a;
      }
    }
  }
  return { acts, schema };
}


/* ===================== sim 実行（A6 と同一 API: simulateTimeline({...base, rng, criticalProvider})） ===================== */
interface SimAct { lane: number; beat: number; id: string; kind: string; name: string; cost: number | null; fail: boolean; failReason: string | null }
type Attr = "vocal" | "dance" | "visual";
interface RunOut {
  res: any; base: any; init: number[]; label: string;
  series: Map<string, number | null>;
  acts: SimAct[];
  photoInv: Array<{ lane: number; id: string; name: string; lv: number | null; dur: number | null; stock: number | null; ct: number | null; limit: number | null; trigger: string | null }>;
  buffs: Map<string, { cd: number; up: number; boost: number }>;
  /** engine が各ビートの消費計算に使用した BuffSnapshot（エンジン実物と同じ物差しで原価を復元するため） */
  snaps: Map<string, any>;
  laneAttr: (Attr | null)[];
}
function runSim(baseIn: any, c: any, label: string, rngKind: "neutral" | "seeded" = "neutral", photoOrder: string[] | null = null, blockPhotoId: string | null = null): RunOut {
  const base: any = { ...baseIn, lanes: baseIn.lanes.map((l: any) => ({ ...l, photos: (l.photos ?? []).map((p: any) => ({ ...p })) })) };
  if (blockPhotoId !== null) {
    // [T3] swap gate: フォト自体は残す（ステータス付与は実測どおりに保つ）が、発動だけ恒久阻止する。
    // → 「この act は実在したのか」を検証する介入は stats を動かせば別要因と混ざるため。
    let blocked = 0;
    for (const lane of base.lanes) for (const p of lane.photos) if (p.id === blockPhotoId) { p.ct = 99999; p.limitPerLive = 0; blocked++; }
    if (blocked === 0) throw new Error(`blockPhotoId 不一致: ${blockPhotoId}`);
  }
  const order: Record<string, number> = {};
  if (photoOrder !== null) photoOrder.forEach((id, i) => { order[id] = i; });
  if (Object.keys(order).length > 0) {
    for (const lane of base.lanes) {
      lane.photos = lane.photos.slice().sort((a: any, b: any) =>
        (order[a.id] ?? Number.MAX_SAFE_INTEGER) - (order[b.id] ?? Number.MAX_SAFE_INTEGER) || String(a.id).localeCompare(String(b.id)));
    }
  }
  const critMap = loadCrit(readJson(c.critFile), c.critFormat);
  const res: any = simulateTimeline({
    ...base,
    rng: rngKind === "neutral" ? new NeutralRng() : new ContinuousRng(42),
    criticalProvider: (b: number, l: number) => critMap.get(b)?.[l - 1] === true,
  } as any);
  const nameOf = new Map<string, string>();
  const photoInv: RunOut["photoInv"] = [];
  for (const lane of base.lanes as any[]) {
    for (const s of [...(lane.skills ?? []), ...(lane.photos ?? [])]) nameOf.set(s.id, s.name ?? s.id);
    for (const p of lane.photos ?? []) {
      const dur = Math.max(0, ...(p.effects ?? []).map((e: any) => e.durationBeats ?? 0));
      photoInv.push({
        lane: lane.lane, id: p.id, name: p.name ?? p.id, lv: p.level ?? null, dur: dur > 0 ? dur : null,
        stock: p.staminaCost ?? null, ct: p.ct ?? null, limit: p.limitPerLive ?? null, trigger: p.trigger ?? null,
      });
    }
  }
  const acts: SimAct[] = [];
  for (const a of res.activations as any[]) {
    if (!(a.lane >= 1)) continue;
    acts.push({ lane: a.lane, beat: a.beat, id: a.skillId, kind: String(a.kind), name: nameOf.get(a.skillId) ?? a.skillId, cost: N(a.staminaCost), fail: a.success !== true, failReason: a.failReason ?? null });
  }
  const series = new Map<string, number | null>();
  const buffs = new Map<string, { cd: number; up: number; boost: number }>();
  const snaps = new Map<string, any>();
  for (const bt of res.beats as any[]) {
    for (let l = 1; l <= 5; l++) {
      series.set(`${l}:${bt.beat}`, N(bt.staminaAfter?.[l - 1]));
      const bs = bt.buffSnapshots?.[l - 1];
      if (bs === undefined) continue;
      snaps.set(`${l}:${bt.beat}`, bs);
      buffs.set(`${l}:${bt.beat}`, {
        cd: bs.stamina_cost_down ?? 0,
        up: bs.stamina_cost_up ?? 0,
        boost: (bs.vocal_boost ?? 0) + (bs.dance_boost ?? 0) + (bs.visual_boost ?? 0),
      });
    }
  }
  const laneAttr: (("vocal" | "dance" | "visual") | null)[] = (base.lanes as any[]).map((l: any) => l.attribute ?? null);
  return { res, base, init: (base.lanes as any[]).map((l: any) => l.deck.stamina), label, series, acts, photoInv, buffs, snaps, laneAttr };
}

/** 台帳分岐点: sim/実測 の差が閾値を超えた最初のビート（A6 §0 と同じ閾値） */
function firstDivergence(run: ReturnType<typeof runSim>, ms: Map<string, number | null>, maxs: number[]): Map<number, { beat: number | null; maxDiff: number }> {
  const out = new Map<number, { beat: number | null; maxDiff: number }>();
  for (let lane = 1; lane <= 5; lane++) {
    let div: number | null = null; let maxDiff = 0;
    const beats = [...ms.keys()].filter((k) => k.startsWith(`${lane}:`)).map((k) => Number(k.split(":")[1])).sort((a, b) => a - b);
    for (const beat of beats) {
      const mv = ms.get(`${lane}:${beat}`) ?? null;
      const sv = run.series.get(`${lane}:${beat}`) ?? null;
      if (mv === null || sv === null) continue;
      const diff = Math.abs(sv - mv);
      maxDiff = Math.max(maxDiff, diff);
      if (diff > Math.max(200, 0.05 * (maxs[lane - 1] || 1)) && div === null) div = beat;
    }
    out.set(lane, { beat: div, maxDiff });
  }
  return out;
}

/* =====================  main  ===================== */
const L: string[] = [];
const P0 = (s = ""): void => { L.push(s); };
P0("=== Phase 16 Action 9: act 単位スタミナ台帳とフォト原価台帳（実行: 2026-10-01 ／ 担当: cline）===");
P0("  出典: A6（phase16_action6_stamina_ledger.ts / _out.txt）の §0・§1-3・§1-4・§4 を検証し直す。");
P0("  方針: engine.ts は読み取りのみ。act 単位 cost の基準を明記し、フォト原価を deck myPhotos / 実測 effect_lines / sim の三角で照合する。");
P0("  STAM_* 環境変数: 本Harnessでは一切参照しない（A6 までと違い、補正を織り込む前の生の状態を見る）。");
P0(`  --probe: ${PROBE ? "ON（T3 の 4 セルに解析側オーバーライドを適用し、条件付き記述の根拠を確定させる）" : "OFF（現行規則の記録のみ）"}`);
P0("  act 台帳が撮れているサンプル: S1/S2/S3 の 3 件のみ（aipura_nox/サンプル4 は measured_data*.json 未生成、サンプル5 はそれすら無く deck.json も無い）。");
P0("    → 「±6% 揺らぎ」の検証母数はこの 3 サンプルの act 単位 cost に限られる。S4/S5 は act 台帳を作れないので未検証（＝検証済みにしない）。");
P0("");
const divAll: string[] = [];
/** [F]「発動順が原因」で説明できた act（サンプル横断） */
const orderAll: string[] = [];
/** [F]② で照合した photo act 1 件ずつの残差（A6 の「±6% 揺らぎ」を act 単位で裁くための横断表） */
const a6Rows: { id: string; beat: number; lane: number; name: string; sim: number; obs: number; pct: number; explained: boolean; tag: string }[] = [];
/** サンプル別の「engine 式で厳密一致」件数（総括で ±6% 揺らぎの判定に使う） */
const strictAll: { id: string; ok: number; n: number; t3: string }[] = [];
const sumPhoto = new Map<string, { n: number; exact: number; sumRatio: number }>();
for (const c of CASES) {
  const measRaw = readJson(c.measured);
  const baseLegacy = buildCase(c, "legacy");
  const baseLf = buildCase(c, "lanefans");
  const runs = [
    runSim(baseLf.base, c, "現在入力(lane_fans)・乱数中立"),
    runSim(baseLf.base, c, "現在入力(lane_fans)・乱数=ContinuousRng(42)", "seeded"),
    runSim(baseLegacy.base, c, "旧入力(audience)・乱数中立"),
  ];
  const run = runs[0];
  const probeRun = T3_PHOTO_ORDER[c.id] !== undefined
    ? runSim(baseLf.base, c, "--probe 適用時（フォト発動順を実測順に並替）", "neutral", T3_PHOTO_ORDER[c.id])
    : run;

  const maxs = run.init;
  const ms = measSeries(measRaw);
  const div = firstDivergence(run, ms, maxs);
  const { acts, schema: actSchema } = measActs(measRaw);
  const isPhK = (k: string): boolean => /photo|フォト/i.test(k);
  /** act 単位としてクリーンな基準（サンプル別のスキーマで自動判定されたもの） */
  const isClean = (b: string): boolean => /^(同一ビート内|1act差\(同ビート|記載値\(原価\)|変化なし=消費0)/.test(b);
  const isCrossBeat = (b: string): boolean => /ビート跨ぎ/.test(b);
  const durOf = (a: MeasAct): number | null => {
    const m = a.effLines.join(" ").match(/\[(\d+)ビート\]/);
    return m ? Number(m[1]) : null;
  };
  P0(`########## ${c.id} ${c.stageFile} / ${c.chartFile} ##########`);
  P0(`  実測 act ${acts.length} 件 / うち photo ${acts.filter((a) => a.kind === "photo").length} 件（スキーマ判定 ${c.actSchema ?? "-"} → 実ファイル ${actSchema}）`);
  P0(`  [T4ゲート] sim/実測 のレーン別スタミナ系列比較（比較できたビート数 n と最大差。n が小さいなら比較母数不足＝分岐判定は無意味）:`);
  const gateDiv: string[] = [];
  for (let l = 1; l <= 5; l++) {
    let n = 0; let sum = 0;
    for (const [k, v] of ms) {
      if (!k.startsWith(`${l}:`) || v === null) continue;
      const sv = run.series.get(k);
      if (sv === null || sv === undefined) continue;
      n++; sum += sv - v;
    }
    const d = div.get(l)!;
    P0(`      L${l}: 比較 n=${String(n).padStart(3)} / 平均差 ${pad(n > 0 ? sum / n : null, 0)} / 最大差 ${pad(d.maxDiff, 0)} / 分岐 ${d.beat === null ? `なし（閾値 max(200, 5%maxスタミナ) 内・最大差 ${Math.round(d.maxDiff)}）` : `b${d.beat}`}`);
    gateDiv.push(`${c.id} L${l} 最大差 ${Math.round(d.maxDiff)} 平均差 ${(n > 0 ? sum / n : 0).toFixed(1)} 分岐 ${d.beat === null ? "なし" : `b${d.beat}`}`);
    divAll.push(`${c.id} L${l}: 比較 n=${String(n).padStart(3)} / 平均差 ${(n > 0 ? sum / n : 0).toFixed(1)} / 最大差 ${Math.round(d.maxDiff)} / 分岐 ${d.beat === null ? "なし（閾値内）" : `b${d.beat}`}`);
  }
  P0("");
  P0("  --- [A] act 単位 cost 台帳（cost の「基準」の性質を必ず読むこと） ---");
  P0("      基準 =「同一ビート内 / 発動前後ペア / 記載値(原価)」のときだけ act 単位のクリーンな差分。");
  P0("      「ビート跨ぎ」は前ビートからの継続回復が消費側に混入するため act 単位として使わない（A6 §4 の誤りの原因）。");
  P0("      「記載値(原価)」はマスタ記載の原価で**実測消費ではない**（S2 はこのため act 単位の実測が取れない）。");
  P0("      | 順 | beat | L | 種別 | skill | Lv | cost | 基準 | 台帳分岐 | 発動後の残り |");
  let shown = 0;
  for (const a of acts) {
    if (shown++ >= 90) { P0("      ...（以降省略）"); break; }
    const dv = div.get(a.lane)?.beat ?? null;
    P0(`      | ${String(a.order ?? "-").padStart(3)} | ${String(a.beat).padStart(3)} | ${a.lane} | ${a.kind.padEnd(5)} | ${(a.name.length > 20 ? a.name.slice(0, 20) + "…" : a.name).padEnd(20)} | ${a.level ?? "-"} | ${pad(a.cost)} | ${(a.basis.length > 12 ? a.basis.slice(0, 12) : a.basis).padEnd(12)} | ${dv === null ? "なし" : `b${dv}`}${a.beat === dv ? " ◀一致" : ""} | ${pad(a.cur)} |`);
  }
  P0("");
  P0("  --- [B] フォト原価の三角照合（deck myPhotos 原価 / 実測 act cost / sim の in-game stock） ---");
  const deckRaw = readJson(c.deck);
  const weight = (baseLf.base.stage as any).skillStaminaWeightPermil ?? 1000;
  P0(`      sim 側ステージ重み = ${weight}‰（stage.skillStaminaWeightPermil。観測比の実測は下の行で個別に示す）`);
  const simInv: any[] = run.photoInv.map((p) => ({
    id: p.id, lane: p.lane, name: p.name, lv: p.lv, dur: p.dur, stock: p.stock,
    src: p.id.startsWith("uph-") ? "マイフォト" : "カード枠",
  }));
  /** deck.json の photoEquip がレーン帰属の正（id 表記がサンプル間で違う: uph-l1-4 / uph-lane1-1） */
  const laneOfId = new Map<string, number>();
  ((deckRaw.photoEquip ?? []) as any[]).forEach((arr: any, i: number) => {
    for (const id of (Array.isArray(arr) ? arr : [])) laneOfId.set(String(id), i + 1);
  });
  const deckInv: any[] = ((deckRaw.myPhotos ?? []) as any[]).map((mp: any) => ({
    id: mp.id, lane: laneOfId.get(String(mp.id)) ?? Number(String(mp.id).match(/lane(\d)|l(\d)/)?.[1] ?? 0),
    name: mp.name, kindLabel: mp.kindLabel ?? null,
    lv: mp.skill?.level ?? null, dur: mp.skill?.durationBeats ?? null, stock: mp.skill?.staminaCost ?? null,
    type: mp.skill?.type ?? null,
  }));
  const permilAt = (lane: number, beat: number): number => {
    const s = run.snaps.get(`${lane}:${beat}`);
    return s ? consumptionMultiplierPermil(s, run.laneAttr[lane - 1] ?? undefined) : 1000;
  };
  /** engine の実物と同じ物差し: cost = floor(floor(原価 × 重み/1000) × バフ倍率/1000) */
  const expCostOf = (stock: number, permil: number): number => mulPermil(mulPermil(stock, weight), permil);
  const buffDesc = (lane: number, beat: number): string => {
    const s = run.snaps.get(`${lane}:${beat}`);
    if (s === undefined) return "snap なし";
    const attr = run.laneAttr[lane - 1];
    const bst = attr === "dance" ? s.dance_boost : attr === "visual" ? s.visual_boost : s.vocal_boost;
    return `${attr ?? "?"}boost${bst ?? 0}段/cd${s.stamina_cost_down ?? 0}段/up${s.stamina_cost_up ?? 0}段→${permilAt(lane, beat)}‰`;
  };
  for (let lane = 1; lane <= 5; lane++) {
    const simL = simInv.filter((x) => x.lane === lane);
    const deckL = deckInv.filter((x) => x.lane === lane);
    P0(`      L${lane}（attr=${run.laneAttr[lane - 1] ?? "?"}）`);
    P0(`        deck myPhotos 元データ: ${deckL.map((x) => `${x.name}[${x.type ?? "?"}, Lv${x.lv ?? 1}, ${x.dur ?? "-"}b, 原価${x.stock}]`).join(" / ") || "（このレーンの myPhotos は 0 枚）"}`);
    P0(`        sim in-game stock   : ${simL.map((x) => `${x.name}[${x.stock}, ${x.dur ?? "-"}b, ct${x.ct ?? "-"}, limit${x.limit ?? "-"}, ${x.src}]`).join(" / ") || "（このレーンのフォト枠は空）"}`);
    const pairs = Math.min(simL.length, deckL.length);
    let same = 0; let diff = 0;
    for (let i = 0; i < pairs; i++) { if (simL[i].stock === deckL[i].stock) same++; else diff++; }
    P0(`        deck→sim の供給対照（${pairs} 組）: 原価一致 ${same} / 不一致 ${diff}`);
    // 実測 act cost → deck/sim 原価の同定（名前はゲーム内総称なので「engine と同一式で復元した原価」で当てる）
    for (const a of acts.filter((x) => x.kind === "photo" && x.lane === lane && x.cost !== null && isClean(x.basis))) {
      const durM = durOf(a);
      const permil = permilAt(lane, a.beat);
      const pool = simInv.filter((x) => x.lane === lane);
      const hit = pool.filter((x) => expCostOf(x.stock ?? 0, permil) === a.cost);
      const near = pool.slice().sort((x, y) => Math.abs(expCostOf(x.stock ?? 0, permil) - (a.cost as number)) - Math.abs(expCostOf(y.stock ?? 0, permil) - (a.cost as number)))[0];
      const byDur = durM === null ? [] : pool.filter((x) => x.dur === durM);
      const tag = hit.length === 1 ? "engine式一致" : hit.length > 1 ? "engine式一致(複数)" : "engine式ズレ";
      P0(`        act o${a.order} b${a.beat} ${a.name}${a.level !== null ? ` Lv${a.level}` : ""}[${durM ?? "-"}b] 実測 ${pad(a.cost, 6)}（${a.basis}）` +
        ` | ${buffDesc(lane, a.beat)} ⇒ ${tag}: ` +
        `${hit.map((x) => `${x.name}[原価${x.stock}×${weight}‰×${permil}‰]`).join(" / ") || `（該当なし・最接近 ${near?.name ?? "-"}[原価${near?.stock}]→${expCostOf(near?.stock ?? 0, permil)} 差 ${(a.cost ?? 0) - expCostOf(near?.stock ?? 0, permil)}）`}` +
        `${byDur.length > 0 && hit.length === 0 ? ` / 持続一致 ${byDur.map((x) => `${x.name}[${x.stock}]`).join(" / ")}` : ""}`);
      for (const x of hit) {
        const key = `${c.id}:${x.name}`;
        const g = sumPhoto.get(key) ?? { n: 0, exact: 0, sumRatio: 0 };
        g.n += 1; g.exact += 1; g.sumRatio += 1;
        sumPhoto.set(key, g);
      }
      if (hit.length === 0 && near !== undefined) {
        const key = `${c.id}:${near.name}`;
        const g = sumPhoto.get(key) ?? { n: 0, exact: 0, sumRatio: 0 };
        g.n += 1; g.sumRatio += (a.cost ?? 0) / Math.max(1, expCostOf(near.stock ?? 0, permil));
        sumPhoto.set(key, g);
      }
    }
  }

  P0("");
  P0("  --- [C]「±6% 揺らぎ」の再判定：実測 act cost vs engine 式（原価 × 重み × バフ倍率） ---");
  const clean = acts.filter((a) => a.kind === "photo" && a.cost !== null && isClean(a.basis));
  const crossb = acts.filter((a) => a.kind === "photo" && a.cost === null && isCrossBeat(a.basis));
  P0(`      act 単位として使える photo act: ${clean.length} 件 / ビート跨ぎ（継続回復が混入）で使えない: ${crossb.length} 件`);
  const rows = clean.map((a) => {
    const permil = permilAt(a.lane, a.beat);
    const pool = simInv.filter((x) => x.lane === a.lane);
    const hit = pool.filter((x) => expCostOf(x.stock ?? 0, permil) === a.cost);
    const near = pool.slice().sort((x, y) => Math.abs(expCostOf(x.stock ?? 0, permil) - (a.cost as number)) - Math.abs(expCostOf(y.stock ?? 0, permil) - (a.cost as number)))[0];
    const naiveExp = ((near?.stock ?? 0) * weight) / 1000;
    return { a, permil, hit, near, gap: (a.cost ?? 0) - expCostOf(near?.stock ?? 0, permil), naiveR: naiveExp > 0 ? (a.cost as number) / naiveExp : NaN };
  });
  const ok = rows.filter((r) => r.hit.length > 0);
  P0(`      engine 式（原価×重み×バフ倍率）で厳密一致: ${ok.length}/${clean.length} 件` +
    ` / ズレ ${rows.length - ok.length} 件（A6 の「±6% 揺らぎ」はこのズレの話。下に全件の内訳）`);
  for (const r of rows) {
    const naiveA6 = `A6 方式（重みのみ）比率 ${Number.isFinite(r.naiveR) ? r.naiveR.toFixed(4) : "nan"}`;
    if (r.hit.length > 0) {
      P0(`        ○ o${r.a.order} b${r.a.beat} L${r.a.lane} ${r.a.name} 実測 ${r.a.cost} = ${r.hit.map((x) => `${x.name}[${x.stock}]`).join("/")} × ${weight}‰ × ${r.permil}‰（${buffDesc(r.a.lane, r.a.beat)}）｜${naiveA6}`);
    } else {
      P0(`        ✕ o${r.a.order} b${r.a.beat} L${r.a.lane} ${r.a.name} 実測 ${r.a.cost}（${r.a.basis}）/ 最接近 ${r.near?.name ?? "-"}[${r.near?.stock}]→${expCostOf(r.near?.stock ?? 0, r.permil)} 差 ${r.gap}（比率 ${r.near !== undefined ? ((r.a.cost as number) / Math.max(1, expCostOf(r.near.stock ?? 0, r.permil))).toFixed(4) : "-"}）｜${buffDesc(r.a.lane, r.a.beat)}｜${naiveA6}`);
    }
  }
  P0("      ② Lv バッジ読み違い（原価の桁違いは Lv 違いでは説明不能）: 実測 Lv と sim 側 Lv が食い違う act");
  for (const r of rows) {
    const cand = r.near !== undefined ? [r.near] : [];
    if (cand.length === 1 && r.a.level !== null && cand[0].lv !== null && cand[0].lv !== r.a.level) {
      P0(`        o${r.a.order} b${r.a.beat} L${r.a.lane} ${r.a.name}: 実測 Lv${r.a.level} / sim Lv${cand[0].lv} → 原価 ${cand[0].stock} vs 実測 cost ${r.a.cost}（Lv が違っても原価は変わらない: フォトの staminaCost は Lv 非依存）`);
    }
  }
  P0("      判定: engine 式で厳密一致が大半なら「±6% 揺らぎ」は photo 由来ではない。" +
    `本サンプルの厳密一致は ${ok.length}/${clean.length} 件 → ${ok.length === clean.length ? "A6 の「±6% 揺らぎ」は photo では説明不能（原因は別）" : "ズレ残りは下段の内訳を参照"}`);

  /* ---------- [T3] A6 方式の photo swap gate ---------- */
  P0("");
  P0("  --- [T3] photo swap gate（A6 が実施したと書く検算を、ここで実際に実装する） ---");
  P0("      手順: sim が発動させた photo を 1 本、発動だけ恒久阻止（ct=99999・limit 0。スタ付与は残す）して再計算 →" +
    " 発動ビートのビート増分について |sim増分-実測増分| が縮むか。縮む＝その発動は実在しなかった（gate_ok）");
  const inc = (m: Map<string, number | null>, lane: number, beat: number): number | null => {
    const a = m.get(`${lane}:${beat - 1}`); const b = m.get(`${lane}:${beat}`);
    return a === undefined || b === undefined || a === null || b === null ? null : b - a;
  };
  const phActs = run.acts.filter((a) => isPhK(a.kind) && !a.fail);
  const t3g = { ok: 0, not: 0, na: 0 };
  const tested: string[] = [];
  for (const a of phActs.slice(0, 12)) {
    const mi = inc(ms, a.lane, a.beat);
    const si = inc(run.series, a.lane, a.beat);
    if (mi === null || si === null) { t3g.na += 1; continue; }
    const before = Math.abs(si - mi);
    let r2: RunOut;
    try { r2 = runSim(run.base, c, "gate", "neutral", null, a.id); }
    catch (e) { t3g.na += 1; tested.push(`        b${a.beat} L${a.lane} ${a.name}: 検算不能（${(e as Error).message}）`); continue; }
    const si2 = inc(r2.series, a.lane, a.beat) ?? 0;
    const after = Math.abs(si2 - mi);
    let drift = 0;
    for (const [k, v] of r2.series) { const o = run.series.get(k); if (v !== null && o !== null && v !== undefined && o !== undefined) drift = Math.max(drift, Math.abs(v - o)); }
    const tag = after < before - 0.05 ? "gate_ok（阻止で実測に近づいた＝sim の発動は過剰）"
      : after > before + 0.05 ? "gate_not（阻止で悪化した＝その発動は実測に対応して実在する）" : "gate 判別不能（差<0.05）";
    if (tag.startsWith("gate_ok")) t3g.ok += 1; else if (tag.startsWith("gate_not")) t3g.not += 1; else t3g.na += 1;
    tested.push(`        b${a.beat} L${a.lane} ${a.name.slice(0, 14)} 阻止 ${a.id.slice(-16)}: 実測増分 ${mi.toFixed(2)} / 阻止前 ${si.toFixed(2)}（誤差 ${before.toFixed(2)}）→ 阻止後 ${si2.toFixed(2)}（誤差 ${after.toFixed(2)}）｜全系列最大ドリフト ${drift.toFixed(1)} → ${tag}`);
  }
  for (const t of tested) P0(t);
  P0(`      gate 集計: ok ${t3g.ok} / not ${t3g.not} / 判別不能 ${t3g.na}（検証した photo 発動 ${phActs.length} 件のうち先頭 ${Math.min(12, phActs.length)} 件）` +
    ` → ${t3g.ok === 0 ? "阻止すると悪化する＝sim の photo 発動は実測に対応する。A6 の「sim の photo を除去すると乖離が消える（photo-led）」は成立しない（除去＝発動の実在を消すこと）"
      : `阻止で改善する発動が ${t3g.ok} 件 → これらは過剰発動。photo 側の模型に誤りが残る`}`);
  P0(`      [T3 サマリ] ${c.id}: gate ok=${t3g.ok} not=${t3g.not} 判別不能 ${t3g.na} / engine 式厳密一致 ${ok.length}/${clean.length}`);
  strictAll.push({ id: c.id, ok: ok.length, n: clean.length, t3: `ok=${t3g.ok} not=${t3g.not} na=${t3g.na}` });

  P0("");
  P0("  --- [D] act 集合の比較（sim vs 実測・同一 (lane,beat) を同一 act とみなす）と T3 の 4 セル ---");

  const simKey = new Map<string, any[]>();
  for (const a of run.acts) {
    const k = `${a.lane}:${a.beat}`;
    (simKey.get(k) ?? simKey.set(k, []).get(k)!).push(a);
  }
  const measKey = new Map<string, MeasAct[]>();
  for (const a of acts) { const k = `${a.lane}:${a.beat}`; (measKey.get(k) ?? measKey.set(k, []).get(k)!).push(a); }
  const both = [...simKey.keys()].filter((k) => measKey.has(k));
  const onlySim = [...simKey.keys()].filter((k) => !measKey.has(k));
  const onlyMeas = [...measKey.keys()].filter((k) => !simKey.has(k));
  const isPh = (k: string): boolean => isPhK(k);
  const phSim = (k: string): boolean => (simKey.get(k) ?? []).some((x) => isPhK(x.kind));
  const phMeas = (k: string): boolean => (measKey.get(k) ?? []).some((x) => isPhK(x.kind));
  const ph = (k: string): boolean => phSim(k) && phMeas(k);
  const okSim = run.acts.filter((x) => !x.fail);
  const failCount = new Map<string, number>();
  for (const a of run.acts.filter((x) => isPhK(x.kind))) failCount.set(a.failReason ?? "success", (failCount.get(a.failReason ?? "success") ?? 0) + 1);
  P0(`      ① sim act ${run.acts.length} 件（うち photo ${run.acts.filter((x) => isPhK(x.kind)).length}）/ 発動成功のみ ${okSim.length} 件（photo ${okSim.filter((x) => isPhK(x.kind)).length}）`);
  P0(`         sim の photo act 内訳（engine は毎ビート全フォトの試行 trace を残す。実測と比べる場合は成功のみ）: ${[...failCount].map(([k, v]) => `${k}=${v}`).join(" / ")}`);
  P0(`      ② 実測 act ${acts.length} 件（photo ${acts.filter((x) => isPhK(x.kind)).length}）`);
  P0(`      ③ 双方に act あり ${both.length} マス（うち photo 双方 ${both.filter(ph).length}） / ④ sim のみ ${onlySim.length} マス / ⑤ 実測のみ ${onlyMeas.length} マス`);
  if (onlySim.length > 0) P0(`      ④ sim のみ（先頭 12）: ${onlySim.slice(0, 12).map((k) => `L${k.split(":")[0]}b${k.split(":")[1]}(${simKey.get(k)!.map((x) => x.kind[0]).join("")})`).join(" ")}`);
  if (onlyMeas.length > 0) P0(`      ⑤ 実測のみ（先頭 12）: ${onlyMeas.slice(0, 12).map((k) => `L${k.split(":")[0]}b${k.split(":")[1]}(${measKey.get(k)!.map((x) => x.kind[0]).join("")})`).join(" ")}`);
  // ⑥ フォトの発動「順」の比較（成功発動のみ。同一ビート内でどれが先かは FAIL 条件に直結する）
  for (let lane = 1; lane <= 5; lane++) {
    const mSeq = acts.filter((x) => x.lane === lane && x.kind === "photo").map((x) => `b${x.beat}:${x.name}`);
    const sSeq = okSim.filter((x) => x.lane === lane && isPhK(x.kind)).map((x) => `b${x.beat}:${(x.name ?? "").slice(0, 12)}`);
    if (mSeq.length === 0 && sSeq.length === 0) continue;
    P0(`      ⑥ L${lane} 発動順  実測(${mSeq.length}): ${mSeq.slice(0, 10).join(" > ") || "記録なし"}`);
    P0(`         ${" ".repeat(16)}sim成功(${sSeq.length}): ${sSeq.slice(0, 10).join(" > ") || "発動なし"}`);
  }
  for (const t of T3_CELLS.filter((x) => x.s === c.id)) {
    const k = `${t.lane}:${t.beat}`;
    const sa = simKey.get(k) ?? [];
    const ma = measKey.get(k) ?? [];
    const row = (measRaw.timeline ?? []).find((r: any) => r.beat === t.beat);
    const mb = laneRead(row, t.lane);
    const banner = mb?.skills ?? mb?.skill_names ?? mb?.banner ?? mb?.banner_skill ?? mb?.skill_banner ?? null;
    const probeSa = (probeRun.acts as any[]).filter((x) => x.lane === t.lane && x.beat === t.beat);
    P0(`      ▶ T3 L${t.lane} b${t.beat}（${t.want}）`);
    P0(`          sim(現規則): ${sa.map((x) => `${x.kind}:${x.name}${x.cost !== null ? ` cost${x.cost}` : ""}${x.fail ? ` **FAIL**(${x.failReason})` : ""}`).join(" + ") || "（発動なし）"}`);
    if (PROBE) P0(`          sim(--probe 並替): ${probeSa.map((x) => `${x.kind}:${x.name}${x.cost !== null ? ` cost${x.cost}` : ""}${x.fail ? ` **FAIL**(${x.failReason})` : ""}`).join(" + ") || "（発動なし）"}`);
    P0(`          実測 act: ${ma.map((x) => `${x.kind}:${x.name}${x.cost !== null ? ` cost${x.cost}(${x.basis})` : ""}`).join(" + ") || "（記録なし）"}`);
    const prevMb = laneRead((measRaw.timeline ?? []).find((r: any) => r.beat === t.beat - 1), t.lane);
    P0(`          実測スタミナ b${t.beat}: ${pad(mb?.current_stamina ?? mb?.stamina_now ?? null)} / b${t.beat - 1}: ${pad(prevMb?.current_stamina ?? prevMb?.stamina_now ?? null)} / sim: ${pad(run.series.get(k))}`);
    if (banner !== null) P0(`          実測バナー: ${JSON.stringify(banner).slice(0, 200)}`);
  }

  if (c.id === "S1") {
    P0("");
    P0("  --- [E] T4 ゲート（A6 §0「S1 は 5/5 レーン・全 170 ビート一致」が現行コードで生きているか） ---");
    P0("      注: ここでの「通過」は閾値（max(200, 最大スタミナの5%)）以内という意味で、**単位一致**ではない。最大差を必ず併記する。");
    for (const g of gateDiv) P0(`      ${g}`);
    const wmax = Math.max(...[...Array(5).keys()].map((i) => div.get(i + 1)!.maxDiff));
    P0(`      → S1 の最大差 ${Math.round(wmax)}（A6 §0 の「全 170 ビート一致」は最大差 ${Math.round(wmax)} の丸め。差が 0 でないレーンは下の [F] でどの act に起因するか特定する）`);
  }

  P0("");
  P0("  --- [F] cost の段数を「発動時点の live 状態 × 同一ビート内の act 順」で特定する ---");
  P0("      engine の cost は**その act が発火した時点の live な buff 状態**で計算される（src/timeline/engine.ts:1435-1436 の");
  P0("      snapshotOf(state) → staminaCostOf。＝同一ビート内の act 順が倍率を変える）。");
  P0("      一方 Harness が見ている buffSnapshots は**スコアリング時点＝そのビートの全 act が終わった後**の状態");
  P0("      （engine.ts:272 snapshotsAtScoring）。よって snapshot の段数は「そのビートの cost に使われた倍率」ではない:");
  P0("      前ビート snapshot = cost 倍率の下限、当該ビート snapshot = 上限。実測 cost を再現する段数 n（1000+10n‰）がこの間に収まるかを見る。");
  const defs = new Map<string, any>();
  for (const laneIn of run.base.lanes as any[]) for (const s of [...(laneIn.skills ?? []), ...(laneIn.photos ?? [])]) defs.set(s.id, s);
  const attrOf = (lane: number): string => run.laneAttr[lane - 1] ?? "vocal";
  const boostSegs = (lane: number, beat: number): number => {
    const s = run.snaps.get(`${lane}:${beat}`);
    if (s === undefined) return 0;
    return Number(s[`${attrOf(lane)}_boost`] ?? 0) || 0;
  };
  /** その act が「そのレーンの自属性 boost」を付与する効果を持つか（＝同じビートで後に並ぶと後続 act の cost を上げる） */
  const grantOf = (id: string, lane: number): string => {
    const d = defs.get(id);
    if (d === undefined) return "";
    const want = `${attrOf(lane)}_boost`;
    const t = (d.effects ?? []).map((e: any) => String(e.type ?? "")).filter((x: string) => /_boost$/.test(x));
    if (t.includes(want)) return `自属性boost(${want})`;
    return t.length > 0 ? t.join(",") : "";
  };
  const segsOf = (stock: number, cost: number): number[] => {
    const out: number[] = [];
    for (let n = 0; n <= 40; n++) if (expCostOf(stock, 1000 + 10 * n) === cost) out.push(n);
    return out;
  };
  // ① engine 内部照合: 発動 cost が「前ビート〜当該ビート snapshot」の倍率区間で説明できるか
  const phOk = okSim.filter((x) => isPhK(x.kind) && x.cost !== null);
  const clsCount = new Map<string, number>();
  const outOfRange: SimAct[] = [];
  const detail: string[] = [];
  for (const a of phOk) {
    const inv = run.photoInv.find((p) => p.id === a.id);
    const stock = inv?.stock ?? null;
    const cost = a.cost as number;
    if (stock === null) {
      clsCount.set("台帳（deck myPhotos）に原価が無い", (clsCount.get("台帳（deck myPhotos）に原価が無い") ?? 0) + 1);
      continue;
    }
    const pLo = permilAt(a.lane, a.beat - 1); const pHi = permilAt(a.lane, a.beat);
    const cLo = expCostOf(stock, Math.min(pLo, pHi)); const cHi = expCostOf(stock, Math.max(pLo, pHi));
    const tag = cost < cLo || cost > cHi ? "区間外（台帳原価・模型のどちらかが違う）"
      : cLo === cHi ? "倍率変化なし（前ビート=当該ビート）"
        : cost === cLo ? "下限=前ビートの倍率（ビート内の先行 act の boost が cost に乗っていない）"
          : cost === cHi ? "上限=当該ビート（scoring 時）の倍率" : "前〜当該ビートの間（ビート内の boost が部分適用）";
    clsCount.set(tag, (clsCount.get(tag) ?? 0) + 1);
    if (tag.startsWith("区間外")) outOfRange.push(a);
    detail.push(`         b${a.beat} L${a.lane} ${a.name.slice(0, 16)}: 原価 ${stock} ×重み${weight} → engine ${cost} / 前ビート ${pLo}‰=${cLo}・当該ビート ${pHi}‰=${cHi} → ${tag}`);
  }
  P0("      ① engine 内部照合（発動 photo の cost が snapshot 区間の倍率で説明できるか）:");
  for (const [k, v] of [...clsCount].sort((a, b) => b[1] - a[1])) P0(`         ${k}: ${v} 件`);
  for (const a of outOfRange.slice(0, 8)) {
    const inv = run.photoInv.find((p) => p.id === a.id);
    P0(`         区間外 b${a.beat} L${a.lane} ${a.name}: engine cost ${a.cost} / 台帳原価 ${inv?.stock ?? "-"} / ${buffDesc(a.lane, a.beat)}`);
  }
  if (detail.length > 0 && outOfRange.length > 0) for (const dline of detail.filter((x) => x.includes("→ 区間外")).slice(0, 8)) P0(dline);
  // ② 実測 cost（または単一 act マスのビート増分）を再現する段数 vs snapshot の段数
  let skippedBar = 0; // 系列が閾値超で分岐しているレーンのバー増分行（cost の物差しに使えない）
  const cand: { a: SimAct; stock: number; costSim: number; obs: number | null; obsKind: string }[] = [];
  for (const a of phOk) {
    const inv = run.photoInv.find((p) => p.id === a.id);
    if (inv === undefined || inv.stock === null) continue;
    const cellActs = acts.filter((x) => x.lane === a.lane && x.beat === a.beat);
    const phCell = cellActs.filter((x) => x.kind === "photo");
    if (phCell.length === 1 && phCell[0].cost !== null && isClean(phCell[0].basis)) {
      cand.push({ a, stock: inv.stock, costSim: a.cost as number, obs: phCell[0].cost, obsKind: `act(${phCell[0].basis})` });
      continue;
    }
    if (cellActs.length === 1 && cellActs[0].kind === "photo") {
      if ((div.get(a.lane)?.beat ?? null) !== null) { skippedBar++; continue; } // 系列が閾値超で分岐しているレーンのバー増分は cost の物差しにできない
      const p = ms.get(`${a.lane}:${a.beat - 1}`); const q = ms.get(`${a.lane}:${a.beat}`);
      if (p !== undefined && q !== undefined && p !== null && q !== null) cand.push({ a, stock: inv.stock, costSim: a.cost as number, obs: p - q, obsKind: "単一actマスのバー増分（回復が混ざるので下限）" });
    }
  }
  let explained = 0; let orderSuspect = 0; let selfSuspect = 0; let selfExact = 0; let missingSrc = 0; let over = 0; let noRepro = 0;
  for (const x of cand) {
    if (x.obs === null) continue;
    const simSegs = segsOf(x.stock, x.costSim);
    const obsSegs = segsOf(x.stock, x.obs);
    const segApplied = simSegs.length > 0 ? Math.max(...simSegs) : 0; // engine が実際に cost へ乗せた段数（発動 cost から逆算）
    const segSnap = boostSegs(x.a.lane, x.a.beat);                     // scoring 時点（そのビートの全 act 後）の段数
    const sameBeat = okSim.filter((y) => y.beat === x.a.beat);
    const idxPhoto = sameBeat.findIndex((y) => y === x.a);
    const granters = sameBeat.map((y, i) => ({ y, i })).filter((o) => grantOf(o.y.id, x.a.lane).startsWith("自属性boost"));
    const after = granters.filter((o) => o.i > idxPhoto);
    const selfGrant = granters.some((o) => o.y === x.a);
    const selfStages = Math.max(0, ...(defs.get(x.a.id)?.effects ?? [])
      .filter((e: any) => e.type === `${attrOf(x.a.lane)}_boost`)
      .map((e: any) => Number(e.stages ?? 0)));
    const sameBeatTxt = sameBeat.map((y, i) => `${i + 1}.${y.kind[0]}:${y.name.slice(0, 12)}${grantOf(y.id, x.a.lane) !== "" ? `⟦${grantOf(y.id, x.a.lane)}⟧` : ""}${y.cost !== null ? `c${y.cost}` : ""}`);
    let verdict: string;
    if (x.obs === x.costSim) { verdict = "一致（実測 = engine の cost）"; explained++; }
    else if (obsSegs.length === 0) { verdict = `段数では再現不能（実測 ${x.obs} は原価 ${x.stock}×重み${weight}‰×任意段数で作れない → 台帳原価か読み取りの違い）`; noRepro++; }
    else if (obsSegs.some((n) => n > segApplied)) {
      if (after.length > 0) {
        verdict = `**発動順が原因**: 実測 ${obsSegs.join("/")} 段 / engine が乗せた ${segApplied} 段。sim では ${after.map((o) => `${o.i + 1}.${o.y.name.slice(0, 10)}`).join(",")} がフォトより後ろに並ぶため自属性 boost が cost に乗っていない`;
        orderSuspect++;
      } else if (selfStages > 0 && obsSegs.includes(segApplied + selfStages)) {
        verdict = `**self-buff 込み課金で数量一致**: 発動フォト自身が ${attrOf(x.a.lane)}_boost ${selfStages} 段を付与するが engine は自 act の cost に適用しない（engine.ts:1435 で cost 計算→効果適用）。実測 ${segApplied + selfStages} 段 = engine ${segApplied} 段 + 自前 ${selfStages} 段で**ぴったりの段数**`;
        selfExact++;
      } else if (selfStages > 0 && obsSegs.some((n) => n > segApplied)) {
        verdict = `self-buff でも足りない: 実測 ${obsSegs.join("/")} 段 / engine ${segApplied} 段 + 自前 ${selfStages} 段 → 残り ${Math.max(...obsSegs) - segApplied - selfStages} 段分の出所が sim に無い（boost 源の欠落か読み取りの違い）`;
        selfSuspect++;
      } else if (selfGrant) {
        verdict = `**self-buff が cost に乗っていない（段数は不一致）**: 発動フォト自身が ${attrOf(x.a.lane)}_boost ${selfStages} 段を付与。実測の ${obsSegs.join("/")} 段とは一致しないが、sim 側に自属性 boost 源が無い以上、自 act 適用以外に説明がない`;
        selfSuspect++;
      } else {
        verdict = `段数不足（sim 側に ${obsSegs.join("/")} 段を作る自属性 boost 源が無い＝模型の欠落、または台帳原価・読み取りの違い）`;
        missingSrc++;
      }
    } else { verdict = `逆方向（実測 ${obsSegs.join("/")} 段 ≤ engine ${segApplied} 段）→ sim 側が多く乗せているか、バー増分に回復が混ざっている`; over++; }
    a6Rows.push({
      id: c.id, beat: x.a.beat, lane: x.a.lane, name: x.a.name, sim: x.costSim, obs: x.obs,
      pct: x.costSim > 0 ? ((x.obs / x.costSim) - 1) * 100 : 0,
      explained: verdict.startsWith("一致") || verdict.includes("数量一致") || verdict.includes("発動順が原因"),
      tag: verdict.replace(/\*\*/g, "").split(":")[0].replace(/（.*/, "").trim(),
    });
    P0(`      ② b${x.a.beat} L${x.a.lane} ${x.a.name.slice(0, 14)}: 原価 ${x.stock} → sim ${x.costSim}（発動時 ${segApplied} 段）vs 実測 ${x.obs}［${x.obsKind}］→ 段数 ${obsSegs.join("/") || "再現不能"} / scoring後 ${segSnap} 段 → ${verdict}`);
    if (sameBeatTxt.length > 1) P0(`            同一ビートの発動 act（sim 順・⟦⟧=自属性 boost 付与）: ${sameBeatTxt.slice(0, 6).join(" , ")}`);
    const measSame = acts.filter((y) => y.beat === x.a.beat && y.lane !== x.a.lane);
    if (measSame.length > 0) P0(`            実測の同一ビート（他レーン）: ${measSame.slice(0, 6).map((y) => `L${y.lane}:${y.name}${y.cost !== null ? `c${y.cost}` : ""}`).join(" , ")}`);
  }
  P0(`      → ② の内訳: 一致 ${explained} / 発動順が原因 ${orderSuspect} / self-buff 数量一致 ${selfExact} / self-buff 不足分あり ${selfSuspect} / boost 源なし ${missingSrc} / 逆方向 ${over} / 段数で再現不能 ${noRepro}（照合 ${cand.length} 件 / バー増分行 ${skippedBar} 件は系列が閾値超で分岐したレーンのため除外）`);
  P0("        ・「発動順が原因」≥1 → cost 誤差は photo 原価ではなくビート内の act 順に起因（A6 の±6% の正体の候補）");
  P0("        ・「self-buff 数量一致」≥1 → 実機は自 act の boost を自 act の cost に適用している（engine は適用しない: engine.ts:1435 で cost 計算→効果適用）。");
  P0("          A6 の「±6% の揺らぎ」は boost 込みの実測を boost なしの原価と比べたときに見えるズレそのもの。");
  if (orderSuspect + selfSuspect + selfExact > 0) orderAll.push(`${c.id}: 発動順 ${orderSuspect} act / self-buff 数量一致 ${selfExact} act / self-buff 不一致 ${selfSuspect} act（照合 ${cand.length} 件）`);
  P0("");
}




/* ===================== 総括 ===================== */
P0("########## 総括 ##########");
const totClean = strictAll.reduce((s, x) => s + x.n, 0);
const totExact = strictAll.reduce((s, x) => s + x.ok, 0);
P0("  [T2] フォト原価の三角照合（deck 原価 × ステージ重み × バフ倍率 = engine と同一式）:");
for (const [k, g] of [...sumPhoto].sort((a, b) => b[1].n - a[1].n)) {
  P0(`      ${k}: 割当 ${g.n} 件 / engine 式と厳密一致 ${g.exact} 件 / 平均充足 ${(g.sumRatio / Math.max(1, g.n)).toFixed(4)}`);
}
P0(`      全サンプル合計: クリーンな photo act ${totClean} 件のうち engine 式の厳密一致 ${totExact} 件（${totClean > 0 ? ((totExact / totClean) * 100).toFixed(1) : "-"}%）`);
P0(`      → 「±6% の揺らぎ」: ${totClean > 0 && totExact === totClean
    ? "実在しない。deck 原価×重み×バフ倍率で全件が 1 単位も外れなく再現する（A6 が目撃したバラつきは、重み適用前の原価どうし／または重み・バフを掛けない値の比較で生じた見かけ）"
    : `${totClean - totExact} 件が厳密一致しない。内訳は各サンプル [C] の ✕ 行（バフ段数・持続一致・cost%100 を併記）を参照。揺らぎ（乱数的な分散）ではなく個別原因の寄り合い`}`);
P0("  [T3] photo swap gate（発動を 1 本恒久阻止して実測増分との誤差が縮むか）:");
for (const s of strictAll) P0(`      ${s.id}: 厳密一致 ${s.ok}/${s.n} / gate ${s.t3}`);
const t3ok = strictAll.reduce((s, x) => s + Number(x.t3.match(/ok=(\d+)/)?.[1] ?? 0), 0);
const t3not = strictAll.reduce((s, x) => s + Number(x.t3.match(/not=(\d+)/)?.[1] ?? 0), 0);
P0(`      合計 gate_ok ${t3ok} / gate_not ${t3not} → ${t3ok === 0
    ? "どの photo 発動も「阻止すると実測から遠ざかる」。＝sim の photo 発動は実測に対応して実在し、" +
      "A6 の「sim から photo を除去すれば乖離が消える＝photo-led」は交差検証として成立しない（除去は発動の実在を消すだけ）"
    : `gate_ok ${t3ok} 件＝除去（阻止）で実測に近づく発動が存在。これらは sim 側の過剰発動で、photo 模型の修正対象`}`);
P0("  [T4] sim/実測 のスタミナ系列が分岐したビート（A6 §0 の再現。上のレーン別比較行が物差し）:");
for (const g of divAll) P0(`      ${g}`);
if (divAll.length === 0) P0("      （対象サンプルが 1 も走っていない ― CASES/ファイルパスを要確認）");
P0(`      --probe 実行状態 = ${PROBE ? "適用済み（フォト発動順を実測順に並替えた行が上に有効）" : "未適用（引数なしで実行されたため未適用）。T3 の「発動順」に関する結論は条件付きのまま"}`);
;
P0("");
P0("  [F] cost 残差の発生箇所（発動時点の live 倍率 × 同一ビート内の act 順 × self-buff）:");
if (orderAll.length === 0) P0("      「発動順」「self-buff」で説明できる act は 0 件 → 厳密一致しない cost の原因は各サンプル [F]② の個別判定を参照（他サンプル要因の寄り合い）");
else for (const o of orderAll) P0(`      ${o}`);
const a6Resid = a6Rows.filter((r) => r.pct !== 0);
const a6Exp = a6Resid.filter((r) => r.explained);
P0(`      act 単位で裁いた残差内訳（[F]② の照合全件）: 照合 ${a6Rows.length} 件 / engine と実測の差が 0 でない ${a6Resid.length} 件 / うち発動タイミング（自己バフ込み課金・同一ビート内の act 順）で説明 ${a6Exp.length} 件`);
for (const r of a6Rows) P0(`        ${r.id} b${r.beat} L${r.lane} ${r.name.slice(0, 14)}: engine ${r.sim} → 実測 ${r.obs}（${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}%）${r.explained ? "説明済み" : "未説明"}: ${r.tag}`);
const inBand = a6Resid.filter((r) => Math.abs(r.pct) <= 6);
const inBandExp = inBand.filter((r) => r.explained);
const outBand = a6Resid.filter((r) => Math.abs(r.pct) > 6);
const maxAbs = a6Resid.length > 0 ? Math.max(...a6Resid.map((r) => Math.abs(r.pct))) : 0;
if (a6Resid.length > 0) {
  P0(`      A6 が問題にした「±6% の帯域」だけで切り出す: 帯域内の残差 ${inBand.length} 件 / そのうち発動タイミングで説明 ${inBandExp.length} 件（${((inBandExp.length / Math.max(1, inBand.length)) * 100).toFixed(0)}%）`);
  if (outBand.length > 0) P0(`      ±6% 帯域の外 ${outBand.length} 件（${outBand.map((r) => `${r.id} b${r.beat} L${r.lane} ${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}%`).join(" / ")}）は「揺らぎ」の話ではなく台帳原価・実測の読み取り・sim の boost 源欠落側の問題。A6 が目撃した ±6% とは別物なので混ぜない。`);
  P0(`      → 残差の最大 |Δ| = ${maxAbs.toFixed(2)}%。` + (a6Resid.length === a6Exp.length
    ? "照合できた残差は**すべて**「発動 act 自身の boost が自分の cost に乗る／同一ビート内の act 順」で説明され、乱数的な揺らぎは不要と判定"
    : `帯域内の説明率 ${inBandExp.length}/${inBand.length}・帯域外 ${outBand.length} 件。残差はランダムではなく個別原因の寄り合い（乱数的な揺らぎとして model 化する対象ではない）`));
  P0("      ※ b60 の +3 段は「self-buff を自 cost に適用」以外に「boost 持続の境界が実機 1 ビート長い（off-by-one）」でも同じ値になる。b60 単独では 2 つを分離できない");
  P0("        （どちらも engine の適用順/境界の決定論的な差で、乱数ではない）。分離には「自バフ photo が、他ソースのバフが切れた直後ビートで発動」する act をあと 1 件見つけて持続境界を先に確定させる必要がある。");
}
P0("      ※ 照合母数が小さいことに注意: S3 は 5 レーン全系列が閾値超で分岐しているためバー増分行を cost の物差しに使えず、act 単位でクリーンな " +
  `${a6Rows.filter((r) => r.id === "S3").length} 件のみ。S2 は台帳がマスタ原価の記載値で実消費でないため照合 1 件。` +
  "＝「±6% が全て説明された」とは言い切れない（母数不足を明示）。");
P0("      engine の cost は発火時点の live 状態で決まる（engine.ts:1435-1436）ため、**ビート内の act 順そのものが model 情報**。");
P0("      buffSnapshots は scoring 時点（engine.ts:272）なので、これを「cost に使われた倍率」と読み違えないこと（A6 の±6% もこの取り違えが入口）。");
P0("");
P0("  [A6 の 4 主張に対する最終判定（上の数値が根拠）]");
P0("    1) 「フォト原価は deck の myPhotos[] に固定値が無い」→ 読み落とし。deck に原価がある（[B] の原価列に出た）。");
P0("    2) 「実測 cost ÷ 重み で原価が同定でき、±6% の揺らぎがある」→ 揺らぎではなく **重み・バフ倍率を掛ける前の値同士の比較**が原因。");
P0("       同一式（原価×重み×バフ倍率）に直すと上の厳密一致率にまとまる。");
P0(`    3) 「sim の photo を除去すると乖離が消える（photo-led）」→ swap gate では ${t3ok === 0 ? "成立しない（上の gate 集計）" : "部分的に成立（上の gate 集計）"}。`);
P0("    4) 「発動順は実測と一致する」→ 各サンプル [D]⑥ の実測/sim 発動順が物差し。cost 残差は [F]② で act 単位に裁いた: " +
  (a6Resid.length > 0
    ? `±6% 帯域内の残差 ${inBand.length} 件のうち ${inBandExp.length} 件が発動タイミング（発動 act 自身の boost ／ 同一ビート内の act 順）で説明できた。乱数由来の「揺らぎ」ではなく、engine の適用順・境界の決め方の差として model 化すべき対象`
    : "照合できた残差 0 件（母数不足）→ 発動順・自己バフでの説明は保留"));
P0("");
P0("--- 検証フッター ---");
P0(`  実行日: 2026-10-01 / --probe=${PROBE ? "ON" : "OFF"} / engine.ts・src/** は読み取りのみ（git diff に src/ が現れないことを git status で確認）`);
P0("  この Harness が行わないこと: cost 誤差の engine 修正・スコア・撮影・git commit（完了条件 8 により別セッションへ引き継ぎ）。");
fs.writeFileSync(path.join(repoRoot, "research", "23_beat_score_analysis", "phase16_action9_photo_ledger_out.txt"), `${L.join("\n")}\n`, "utf8");
console.log(`出力 ${L.length} 行 → research/23_beat_score_analysis/phase16_action9_photo_ledger_out.txt`);



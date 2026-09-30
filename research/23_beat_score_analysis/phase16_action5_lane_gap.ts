/**
 * Phase 16 Action5: **レーン別スコアの全ビート乖離マッピング**（実行: 2026-09-30 ／ 担当: cline）
 *
 * 動機: 前セッション（Phase 16-A4 の追試）がチャット上で
 *   「S3 L5 に sim=0 / 実測 316.9K 等のビートが 6 件」「S2 L4 に sim=0 / 実測 >0 が 2 件」
 * と報告したが、証拠ファイルを残さず途中終了している。本スクリプトはその主張を
 * **全ビート × 全レーンで再現・量化**する（読み取り専用の再検証）。
 *
 * 方針:
 *  - sim: NeutralRng（rand=1000）+ 実測クリティカル注入（`critical_flags`）で
 *    ビート × レーン別の獲得スコアを出す（`tmp_a4_s3_beats.ts` と同じ再現条件）。
 *  - 実測: `beat_gained_score`（5レーン合計のバー増分）とレーン別 `gained_score_pop`
 *    （`+335.8K` 等の K 表記。null = 遮蔽/非表示 → 比較不能として別扱い）。
 *  - 出力: ①レーン別の「sim=0 なのに実測 pop あり」件数 ②乖離の大きい順上位 ③
 *    5レーン合計のバー vs sim 合計の大きい順（= 既存のビートレベル乖離との対応）。
 *
 * 実行: npx tsx research/23_beat_score_analysis/phase16_action5_lane_gap.ts
 *        > research/23_beat_score_analysis/phase16_action5_lane_gap_out.txt
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { NeutralRng } from "../../src/rng/neutral.js";
import { POSITION_TO_LANE } from "../../src/timeline/constants.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef } from "../../src/photos.js";

const repoRoot = path.resolve(process.cwd());
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const num = (v: any): number | null => (typeof v === "number" ? v : null);

/** ポップ表記（"+335.8K" / 335800 / null）→ 人数（K は 1000 倍・0.1K 刻みで粗い） */
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

/** 実測クリティカル（サンプル1/3/4 形式: critical_flags.beats[{beat, lanes[]}]） */
function critFromBeats(raw: any): Map<number, boolean[]> {
  const out = new Map<number, boolean[]>();
  const rows: any[] = Array.isArray(raw?.beats) ? raw.beats : [];
  for (const r of rows) {
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
    const b = Number(m[1]);
    const lane = Number(m[2]);
    const arr = out.get(b) ?? [false, false, false, false, false];
    arr[lane - 1] = v === true;
    out.set(b, arr);
  }
  return out;
}

function loadData(stageIds: string[], chartIds: string[]): SimSourceData {
  const dataDir = path.join(repoRoot, "data");
  const idx = readJson(path.join(dataDir, "stages_index.json"));
  const allCharts = readJson(path.join(dataDir, "charts_all.json"));
  const mkStage = (qid: string): [string, any] => {
    const q = idx.quests.find((x: any) => x.id === qid);
    const c = idx.configs[q.c];
    return [
      qid,
      {
        beatWeightsPermil: { vocal: c.w[0], dance: c.w[1], visual: c.w[2] },
        skillWeightsPermil: { active: c.aw[0], special: c.aw[1] },
        skillStaminaWeightPermil: c.st ?? 1000,
        laneAttributes: c.a,
      },
    ];
  };
  const mkChart = (cid: string): [string, any] => [
    cid,
    {
      notes: (allCharts[cid] as Array<[number, number]>).map((n: any, i: number) => ({
        beat: i + 1,
        type: n[0],
        position: n[1],
      })),
    },
  ];
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

/** 実測クリティカル（サンプル1 形式: critical_flags.beats = {"2": {"1":"normal","2":"critical",...}}） */
function critFromBeatMap(raw: any): Map<number, boolean[]> {
  const out = new Map<number, boolean[]>();
  for (const [k, v] of Object.entries(raw?.beats ?? {})) {
    const b = Number(k);
    if (!Number.isFinite(b)) continue;
    const arr = [false, false, false, false, false];
    for (const [lk, lv] of Object.entries((v ?? {}) as Record<string, unknown>)) {
      const lane = Number(lk);
      if (!(lane >= 1 && lane <= 5)) continue;
      arr[lane - 1] = typeof lv === "string" ? lv.includes("critical") : lv === true;
    }
    out.set(b, arr);
  }
  return out;
}

/** critFormat による実測クリティカル読み込みのディスパッチ（3 サンプルで形式が異なる） */
function loadCrit(critRaw: any, format: string): Map<number, boolean[]> {
  if (format === "keys") return critFromKeys(critRaw);
  if (format === "beatMap") return critFromBeatMap(critRaw);
  return critFromBeats(critRaw);
}

/**
 * レーン別ポップを (beat, lane) で引ける表にする。
 *
 * 保持場所はサンプルごとに異なる（research/23 phase16_action2d/AGENTS.md の「レーン別ポップ記録」規律）:
 *  - サンプル3: `measured_data_v2.timeline[].lanes[].gained_score_pop` に内生（撮影時に記録）
 *  - サンプル1/2: 撮影時は未取得 → 遡及取得ファイル `lane_pops_backfill.json`
 *    （`pops[] = {beat, lane, displayed:"+9.9K", color, readable, note}`・`prompts/backfill-lane-pops.md` 準拠）
 * `readable: false`（遮蔽・該当フレームなし）は**比較不能**として null のまま置く（0 と区別するため）。
 */
type PopTable = Map<number, (number | null)[]>;

function popTableFromTimeline(timeline: any[]): PopTable {
  const t: PopTable = new Map();
  for (const row of timeline) {
    if (typeof row?.beat !== "number") continue;
    const arr = t.get(row.beat) ?? [null, null, null, null, null];
    for (let i = 0; i < 5; i++) arr[i] = parsePop(row?.lanes?.[String(i + 1)]?.gained_score_pop);
    t.set(row.beat, arr);
  }
  return t;
}

function popTableFromBackfill(file: string): PopTable {
  const raw = readJson(file);
  const t: PopTable = new Map();
  for (const p of raw?.pops ?? []) {
    if (typeof p?.beat !== "number" || typeof p?.lane !== "number") continue;
    if (p.readable === false) continue;
    const arr = t.get(p.beat) ?? [null, null, null, null, null];
    const v = parsePop(p.displayed ?? p.text ?? null);
    if (v !== null) arr[p.lane - 1] = v;
    t.set(p.beat, arr);
  }
  return t;
}

const CASES: any[] = [
  {
    id: "S3",
    deck: path.join(noxRoot, "サンプル3", "deck.json"),
    example: path.join(repoRoot, "examples", "sample3.json"),
    stageFile: "qt-ex-tower-005-045",
    chartFile: "chart-thrx-004-001",
    audience: 8000,
    laneFans: [8515, 7748, 8535, 8518, 6684],
    maxCapacity: 40000,
    s3Fixes: true,
    measured: path.join(repoRoot, "research", "26_data_integrity", "measured_data_s3_v3.json"),
    critFile: path.join(noxRoot, "サンプル3", "measured_data_v2.json"),
    critFormat: "beats",
  },
  {
    id: "S2",
    deck: path.join(noxRoot, "サンプル2", "deck.json"),
    example: path.join(repoRoot, "examples", "sample2.json"),
    stageFile: "qt-tower-680",
    chartFile: "chart-sun-004-001",
    audience: 13206,
    laneFans: [11996, 13543, 13741, 13255, 13496],
    maxCapacity: 70000,
    measured: path.join(repoRoot, "research", "26_data_integrity", "measured_data_s2_v3.json"),
    critFile: path.join(noxRoot, "サンプル2", "measured_data_v2.json"),
    critFormat: "keys",
    // S2 は撮影時にレーン別ポップ未記録 → 遡及取得ファイル（readable 745/840）を使う
    popsFile: path.join(noxRoot, "サンプル2", "lane_pops_backfill.json"),
  },
  {
    // 満員会場（cap 100）のサンプル。E2E 側（phase16_action5_lane_fans_cli_e2e.mjs）と同じ入力条件で
    // レーン別ポップの乖離も見る（audience は AGENTS.md 確定値 20・deck.json の 71000 は目標スコアの誤入力）
    id: "S1",
    deck: path.join(noxRoot, "サンプル1", "deck.json"),
    example: path.join(repoRoot, "examples", "nested-sample.json"),
    stageFile: "qt-area-1-001",
    chartFile: "chart-hsm-006-001",
    audience: 20,
    laneFans: [19, 19, 18, 22, 22],
    maxCapacity: 100,
    measured: path.join(noxRoot, "サンプル1", "measured_data_v2.json"),
    critFile: path.join(noxRoot, "サンプル1", "measured_data_v2.json"),
    critFormat: "beatMap",
    popsFile: path.join(noxRoot, "サンプル1", "lane_pops_backfill.json"),
  },
];

/** サンプル deck.json（ネスト形式）から buildSimulateInput を組む（tmp_a4_s3_beats.ts と同一手順） */
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
    const equipped = ids
      .map((pid: string) => myPhotos.find((x: any) => x?.id === pid))
      .filter((p: any) => p !== undefined);
    ch.photos = mergePhotoEquipStatusesLite(ch.photos, equipped);
  });
  const userPhotoSkills =
    myPhotos.length > 0 && photoEquip.length > 0
      ? photoEquip.flatMap((ids: string[], i: number) =>
          ids.flatMap((pid: string, j: number) => {
            const p = myPhotos.find((x: any) => x?.id === pid);
            if (p === undefined) return [];
            const def = myPhotoToSkillDef(p, (i + 1) as any, j + 1);
            return def !== null ? [def] : [];
          }),
        )
      : undefined;
  const built = buildSimulateInput({
    deck: d,
    stageFile: c.stageFile,
    chartFile: c.chartFile,
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

/** src/photos.js の mergePhotoEquipStatuses（同名ラッパー・型は any に緩く寄せる） */
function mergePhotoEquipStatusesLite(photos: any, equipped: any[]): any {
  return mergePhotoEquipStatuses(photos ?? [], equipped);
}

const fmt = (v: number | null): string => (v === null ? "null" : Math.round(v).toLocaleString("en-US"));
const laneKeys = [1, 2, 3, 4, 5];

console.log("=== Phase 16 Action5: レーン別スコアの全ビート乖離マッピング（sim=乱数中立+実測クリ注入） ===");

for (const c of CASES) {
  const meas = readJson(c.measured);
  const timeline: any[] = meas.timeline ?? [];
  const critRaw = readJson(c.critFile).critical_flags;
  const crit = loadCrit(critRaw, c.critFormat);
  const measLaneTotalsRaw = meas?.results?.scores_by_lane ?? meas?.results?.lane_scores ?? null;
  const measLaneTotals = measLaneTotalsRaw
    ? laneKeys.map((l) => num(measLaneTotalsRaw[String(l)] ?? measLaneTotalsRaw[`lane${l}`]))
    : null;
  // ポップ供給源: S3 は measured_data 内生、S1/S2 は遡及取得ファイル（CASES.popsFile）
  const popTable: PopTable = c.popsFile ? popTableFromBackfill(c.popsFile) : popTableFromTimeline(timeline);
  const chartNotes: unknown[] = readJson(path.join(repoRoot, "data", "charts_all.json"))[c.chartFile] ?? [];
  const popAt = (beat: number, laneIdx: number): number | null => popTable.get(beat)?.[laneIdx] ?? null;
  const popBeats = [...popTable.values()].filter((a) => a.some((v) => v !== null)).length;
  const popCells = [...popTable.values()].reduce((a, v) => a + v.filter((x) => x !== null).length, 0);
  console.log(
    `\n########## ${c.id} ${c.stageFile} / ${c.chartFile} ##########\n` +
      `  timeline ${timeline.length} ビート / crit マップ ${crit.size} ビート / ` +
      `実測 pop ${popBeats} ビートで 1 つ以上読込（セル数 ${popCells}・供給源 ${c.popsFile ? "遡及取得ファイル" : "measured_data 内生"}）`,
  );

  for (const mode of ["legacy", "lanefans"] as const) {
    const built = buildCase(c, mode);
    console.log(`\n=== mode=${mode} ===`);
    console.log(`  laneFanFactorPermil = ${JSON.stringify(built.base.laneFanFactorPermil ?? null)}`);
    for (const w of built.warnings) console.log(`  [warn] ${w}`);

    const res: any = simulateTimeline({
      ...built.base,
      rng: new NeutralRng(),
      criticalProvider: (b: number, l: number) => crit.get(b)?.[l - 1] === true,
    });

    // ビート × レーン別の sim 獲得スコア
    const byBeat = new Map<number, number[]>();
    for (const bt of res.beats) {
      const arr = byBeat.get(bt.beat) ?? [0, 0, 0, 0, 0];
      for (const ev of bt.events) arr[ev.lane - 1] += ev.gainedScore;
      byBeat.set(bt.beat, arr);
    }
    const simTotals = [0, 0, 0, 0, 0];
    for (const arr of byBeat.values()) for (let i = 0; i < 5; i++) simTotals[i] += arr[i];
    const simAll = simTotals.reduce((a, b) => a + b, 0);
    const measAll = measLaneTotals ? measLaneTotals.reduce((a: number, b: number | null) => a + (b ?? 0), 0) : null;
    console.log(`  sim 合計 ${fmt(simAll)}${measAll ? ` / 実測 ${fmt(measAll)}（${(((simAll - measAll) / measAll) * 100).toFixed(2)}%）` : ""}`);
    console.log(`  レーン |          sim |          実測 |   sim/実測 | pop 読込 | sim=0&pop>0 | pop=0&sim>0 | pop-sim 合計 | |乖離|>=100K`);

    const rows: Array<{ beat: number; lane: number; pop: number; sim: number; gap: number; bar: number }> = [];
    for (const row of timeline) {
      const beat = row?.beat;
      if (typeof beat !== "number") continue;
      const simArr = byBeat.get(beat) ?? [0, 0, 0, 0, 0];
      for (let i = 0; i < 5; i++) {
        const pop = popAt(beat, i);
        if (pop === null) continue;
        const sim = simArr[i];
        const gap = pop - sim;
        if (Math.abs(gap) >= 100_000)
          rows.push({ beat, lane: i + 1, pop, sim, gap, bar: num(row?.beat_gained_score) ?? 0 });
      }
    }
    for (let i = 0; i < 5; i++) {
      let popRead = 0, simZero = 0, popZero = 0, sumGap = 0, big = 0;
      for (const row of timeline) {
        const beat = row?.beat;
        if (typeof beat !== "number") continue;
        const pop = popAt(beat, i);
        if (pop === null) continue;
        const sim = (byBeat.get(beat) ?? [0, 0, 0, 0, 0])[i];
        popRead++;
        sumGap += pop - sim;
        if (sim === 0 && pop > 0) simZero++;
        if (pop === 0 && sim > 0) popZero++;
        if (Math.abs(pop - sim) >= 100_000) big++;
      }
      const mt = measLaneTotals?.[i];
      console.log(
        `      L${i + 1}  | ${fmt(simTotals[i]).padStart(12)} | ${mt === null || mt === undefined ? "        （無）" : fmt(mt).padStart(12)} | ` +
          `${mt ? (simTotals[i] / mt).toFixed(4) : "  -   "}   | ${String(popRead).padStart(7)} | ${String(simZero).padStart(10)} | ${String(popZero).padStart(12)} | ` +
          `${fmt(sumGap).padStart(13)} | ${String(big).padStart(9)}`,
      );
    }
    // --- A/SP の stamina_short 失点とスタミナ末尾（sim の枯渇が実測より早いのか、ノートの得点規則なのかの判別） ---
    const laneObjAt = (row: any, l: number) => (row?.lanes?.[String(l)] ?? row?.lanes?.[l - 1] ?? null);
    const allActs = (res.activations ?? []) as any[];
    const shortFails = allActs.filter(
      (a) => ["a", "sp"].includes(String(a.kind).toLowerCase()) && a.success !== true && String(a.failReason) === "stamina_short",
    );
    console.log(
      `  [debug] activations n=${allActs.length} kinds=${[...new Set(allActs.map((a) => a.kind))].join("/")} ` +
        `success値=${[...new Set(allActs.map((a) => typeof a.success + ":" + a.success))].join(",")} ` +
        `failReason=${[...new Set(allActs.filter((a) => a.success !== true).map((a) => a.failReason))].join("/")}`,
    );
    let lostPop = 0;
    const lostDetail: string[] = [];
    for (const a of shortFails) {
      const p = popAt(a.beat, a.lane - 1);
      if (p !== null && p > 0) {
        lostPop += p;
        if (lostDetail.length < 8) lostDetail.push(`b${a.beat}L${a.lane}=${fmt(p)}`);
      }
    }
    console.log(
      `  A/SP の stamina_short 失点: ${shortFails.length} 件 / そのビート×レーンの実測 pop 合計 ${fmt(lostPop)}` +
        `（実測全体比 ${measAll ? ((lostPop / measAll) * 100).toFixed(1) : "-"}%） 内訳 ${lostDetail.join(", ")}`,
    );
    const lastRow: any = timeline[timeline.length - 1] ?? {};
    const mStam = laneKeys.map((l) => num(laneObjAt(lastRow, l)?.current_stamina ?? null));
    console.log(
      `  スタミナ末尾  sim  [${res.finalStamina.map((v: number) => fmt(v).padStart(7)).join(",")}]  ` +
        `実測 [${mStam.map((v) => (v === null ? "   （無）" : fmt(v).padStart(7))).join(",")}]（b${lastRow?.beat}）`,
    );
    rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    console.log(`  --- |pop - sim| >= 100K のビート×レーン（上位 25 / 全 ${rows.length} 件）`);
    for (const r of rows.slice(0, 25)) {
      console.log(
        `      b${String(r.beat).padStart(3)} L${r.lane}: pop ${fmt(r.pop).padStart(9)} / sim ${fmt(r.sim).padStart(9)} ` +
          `→ ギャップ ${r.gap > 0 ? "+" : ""}${fmt(r.gap).padStart(10)}（そのビートのバー増分 ${fmt(r.bar)}）`,
      );
    }

    // --- 「エンジンが無得点にしたセル」の詳報: そのビートの全レーン sim / 全レーン pop / 譜面のノート / 実測 crit
    //     sim=0 & pop>0 が「レーンの持ち越し（他レーンが代わりに稼いだ）」なのか「ビート自体が未処理」なのかを判別する
    const notes = chartNotes as Array<[number, number]>;
    console.log(`  --- sim=0 かつ pop>0 のセルがあるビートの内訳（上位 8 ビート）`);
    let shown = 0;
    for (const row of timeline) {
      const beat = row?.beat;
      if (typeof beat !== "number") continue;
      const simArr = byBeat.get(beat) ?? [0, 0, 0, 0, 0];
      const pops = [0, 1, 2, 3, 4].map((i) => popAt(beat, i));
      const hit = pops.some((p, i) => p !== null && p > 0 && simArr[i] === 0);
      if (!hit || shown >= 8) continue;
      shown++;
      const note = notes[beat - 1];
      const critArr = crit.get(beat) ?? [false, false, false, false, false];
      const beatTotal = (b: number): number => (byBeat.get(b) ?? [0, 0, 0, 0, 0]).reduce((a, x) => a + x, 0);
      const kind = note?.[0] === 3 ? "sp" : note?.[0] === 2 ? "a" : "beat";
      const laneOfPos = POSITION_TO_LANE[((note?.[1] ?? 1) as number) - 1];
      const acts = ((res.activations ?? []) as any[]).filter((a) => a.beat === beat);
      const posLane = typeof laneOfPos === "number" ? `L${laneOfPos}` : "?";
      console.log(
        `      b${String(beat).padStart(3)}: sim [${simArr.map((v) => fmt(v).padStart(9)).join(",")}] 計 ${fmt(simArr.reduce((a, b) => a + b, 0)).padStart(10)} ` +
          `（隣 sim 計: b${beat - 1}=${fmt(beatTotal(beat - 1))} / b${beat + 1}=${fmt(beatTotal(beat + 1))}）\n` +
          `           pop [${pops.map((v) => (v === null ? "     null" : fmt(v).padStart(9))).join(",")}] バー ${fmt(num(row?.beat_gained_score) ?? 0).padStart(10)} / ` +
          `譜面 type=${note?.[0] ?? "?"}(${kind}) pos=${note?.[1] ?? "?"}→${posLane} / crit [${critArr.map((x) => (x ? "C" : ".")).join("")}]`,
      );
      // sim がそのビートで何を出した/出さなかったか（発動失敗の理由まで）・実測の発動記録
      console.log(
        `           sim 発動@b${beat}: ${acts.length === 0 ? "（無し）" : acts.map((a) => `${a.kind}/L${a.lane}/${String(a.skillId).replace(/^.+-/, "")}:${a.success ? "OK" : `FAIL(${a.failReason})`}`).join(", ")}` +
          ` / 実測 pop レーン=${pops.map((v, i) => (v !== null && v > 0 && simArr[i] === 0 ? `L${i + 1}` : "")).filter(Boolean).join(",")}（${posLane} と${pops.some((v, i) => v !== null && v > 0 && i + 1 === laneOfPos) ? "一致" : "不一致"}）`,
      );
      const prior = ((res.activations ?? []) as any[]).filter(
        (a) => a.lane === laneOfPos && a.kind === kind && a.beat < beat && beat - a.beat <= 60,
      );
      console.log(
        `           ${posLane} の同種(${kind})直近発動（≤60b）: ${prior.length === 0 ? "無し（初回）" : prior.slice(-3).map((a) => `b${a.beat}${a.success ? "OK" : `FAIL(${a.failReason})`}`).join(",")}`,
      );

    }
  }
}



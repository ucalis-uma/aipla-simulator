/**
 * Phase 16 Action14 / タスク A1: S3 L3 の「隠れ 3 セル」＝ 下側ゲート 0.04× の正体
 *
 * 手順書 `prompts/phase16-action14-noshoot-backlog.md` §2 A1。
 * 下側ゲートの定義（`tools/audit_hidden_cells.mjs`）:
 *   比 = sim(pop読込不能セル) ÷ (レーン合計 − Σpop)
 *   S3 L3 = 116,039 ÷ 2,635,445 = 0.044×（FAIL(下)）
 *
 * 本ハーネスが出すもの:
 *   [1] pop 読込不能セル（sim がセルを持つ = 隠れセル数に数えられる）の特定と因子ダンプ
 *   [2] 同じビートの他レーン（同時刻の A/SP セルの対照）
 *   [3] **上界検定**: 「beat_gained_score − Σ(可読 pop)」を L3 不能ビートで合計し、
 *       隠れ枠 2,635,445 を「不能セル側で説明できるか」を数値で判定する
 *   [4] measured_data_v3 の note / missing_frames / supplement から読めなかった理由を引く
 *
 * 実行:
 *   npx tsx research/23_beat_score_analysis/phase16_action14_a1_s3_l3_cells.ts
 * 出力:
 *   research/23_beat_score_analysis/phase16_action14_a1_s3_l3_cells.json
 *   research/23_beat_score_analysis/phase16_action14_a1_s3_l3_cells_out.txt
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
const exists = (p: string): boolean => fs.existsSync(p);

const OUT_DIR = path.join(repoRoot, "research", "23_beat_score_analysis");
const outJson = path.join(OUT_DIR, "phase16_action14_a1_s3_l3_cells.json");
const outTxt = path.join(OUT_DIR, "phase16_action14_a1_s3_l3_cells_out.txt");

const lines: string[] = [];
const say = (s = ""): void => {
  lines.push(s);
  console.log(s);
};

/* ===================== ポップ表記の解釈（research/24 §2.3 準拠） ===================== */
function parseK(text: unknown): number | null {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(text ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = { "": 1, K: 1000, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return unit === undefined ? null : Math.round(n * unit);
}
const laneRead = (row: any, lane: number): any => {
  const L = row?.lanes;
  if (L === null || L === undefined) return null;
  if (Array.isArray(L)) return L[lane - 1] ?? null;
  return L[String(lane)] ?? L[`lane${lane}`] ?? null;
};

/* ===================== 実測（S3） ===================== */
const MEAS_CANDIDATES = ["measured_data_v3.json", "measured_data_v2.json", "measured_data.json"];
const FALLBACK = path.join(repoRoot, "research", "26_data_integrity", "measured_data_s3_v3.json");
function loadS3Measured(): { doc: any; file: string } {
  const cands = [
    ...MEAS_CANDIDATES.map((f) => path.join(noxRoot, "サンプル3", f)),
    FALLBACK,
  ];
  for (const p of cands) {
    if (!exists(p)) continue;
    const doc = readJson(p);
    if (!Array.isArray(doc.timeline)) continue;
    return { doc, file: path.relative(repoRoot, p) };
  }
  throw new Error("S3 measured_data が見つからない");
}
const { doc: meas, file: measFile } = loadS3Measured();

const inline = new Map<string, { text: string; raw: any }>();
for (const e of meas.timeline as any[]) {
  if (typeof e?.beat !== "number") continue;
  for (let l = 1; l <= 5; l++) {
    const g = laneRead(e, l)?.gained_score_pop;
    const t = typeof g === "string" ? g : (g?.text ?? null);
    if (parseK(t) !== null) inline.set(`${e.beat}:${l}`, { text: String(t), raw: laneRead(e, l) });
  }
}
const bfFile = path.join(noxRoot, "サンプル3", "lane_pops_backfill.json");
const backfillAll: any[] = exists(bfFile) ? (readJson(bfFile).pops ?? []) : [];
const backfill = new Map<string, { text: string; readable: any; frames: any }>();
let backfillUnreadable = 0;
for (const x of backfillAll) {
  if (typeof x?.beat !== "number" || typeof x?.lane !== "number") continue;
  if (x.readable === false) {
    backfillUnreadable++;
    continue;
  }
  if (parseK(x.displayed) === null) continue;
  backfill.set(`${x.beat}:${x.lane}`, {
    text: String(x.displayed),
    readable: x.readable,
    frames: x.source_frames ?? [],
  });
}
const merged = new Map<string, { text: string; src: string }>();
for (const [k, v] of inline) merged.set(k, { text: v.text, src: "inline" });
let fromBackfill = 0;
for (const [k, v] of backfill) {
  if (merged.has(k)) continue;
  merged.set(k, { text: v.text, src: "backfill" });
  fromBackfill++;
}

const LANES = [1, 2, 3, 4, 5];
const laneTotals: number[] = LANES.map((l) => meas.results?.scores_by_lane?.[String(l)] ?? null);
const popSum = [0, 0, 0, 0, 0];
for (const [k, v] of merged) popSum[Number(k.split(":")[1]) - 1] += parseK(v.text) ?? 0;
const hiddenCap = LANES.map((_, i) => laneTotals[i] - popSum[i]);

/* ===================== sim（S3・lanefans = 監査口径） ===================== */
const CASES: any[] = [
  {
    id: "S1",
    deck: path.join(noxRoot, "サンプル1", "deck.json"),
    stageFile: "qt-area-1-001",
    chartFile: "chart-hsm-006-001",
    audience: 20,
    laneFans: [19, 19, 18, 22, 22],
    maxCapacity: 100,
    critFile: path.join(noxRoot, "サンプル1", "measured_data_v2.json"),
    critFormat: "beatMap",
  },
  {
    id: "S2",
    deck: path.join(noxRoot, "サンプル2", "deck.json"),
    stageFile: "qt-tower-680",
    chartFile: "chart-sun-004-001",
    audience: 13206,
    laneFans: [11996, 13543, 13741, 13255, 13496],
    maxCapacity: 70000,
    critFile: path.join(noxRoot, "サンプル2", "measured_data_v2.json"),
    critFormat: "keys",
  },
  {
    id: "S3",
    deck: path.join(noxRoot, "サンプル3", "deck.json"),
    stageFile: "qt-ex-tower-005-045",
    chartFile: "chart-thrx-004-001",
    audience: 8000,
    laneFans: [8515, 7748, 8535, 8518, 6684],
    maxCapacity: 40000,
    s3Fixes: true,
    critFile: path.join(noxRoot, "サンプル3", "measured_data_v2.json"),
    critFormat: "beats",
  },
];

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
  } as any;
}

function critFromBeats(root: any): Map<number, boolean[]> {
  const out = new Map<number, boolean[]>();
  for (const r of (root?.beats ?? []) as any[]) {
    if (typeof r?.beat !== "number") continue;
    out.set(r.beat, (r.lanes ?? []).map((x: any) => x === true));
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

const c = CASES[2]; // S3
const raw = readJson(c.deck);
const d = JSON.parse(JSON.stringify(raw.deck ?? raw));
if (c.s3Fixes === true) {
  d.characters[3].ct_cuts = [{ skill: 2, value: 5 }];
  for (const ph of raw.myPhotos ?? []) {
    if (ph?.id === "uph-lane5-3" && ph.skill !== null) ph.skill.staminaScaling = "more_stamina";
  }
}
const myPhotos: MyPhotoDef[] = raw.myPhotos ?? [];
const photoEquip: string[][] = raw.photoEquip ?? [];
photoEquip.forEach((ids: string[], i: number) => {
  const ch = d.characters[i];
  if (ch === undefined || !Array.isArray(ch.photos)) return;
  const equipped = ids
    .map((pid: string) => myPhotos.find((x: any) => x?.id === pid))
    .filter((p: any): p is MyPhotoDef => p !== undefined);
  ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
});
const userPhotoSkills =
  myPhotos.length > 0
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
  laneFans: c.laneFans,
  maxCapacity: c.maxCapacity,
  mentalOverride: raw.mentalOverride,
  missedNotes: raw.missedNotes,
  disabledSkillIds: raw.disabledSkillIds,
  userPhotoSkills,
  goldenPhotoNames: t5GoldenPhotoNames(),
} as any);
const crit = critFromBeats(readJson(c.critFile)?.critical_flags ?? readJson(c.critFile));
const res: any = simulateTimeline({
  ...built.base,
  rng: new NeutralRng(),
  criticalProvider: (beat: number, lane: number) => crit.get(beat)?.[lane - 1] === true,
});

/* セル（beat:lane）→ スコア、イベント列はそのまま保持 */
const cellScore = new Map<string, number>();
const cellEvents = new Map<string, any[]>();
const cellKinds = new Map<string, Record<string, number>>();
for (const b of res.beats as any[]) {
  for (const ev of (b.events ?? []) as any[]) {
    const k = `${b.beat}:${ev.lane}`;
    const v = Number(ev.gainedScore) || 0;
    cellScore.set(k, (cellScore.get(k) ?? 0) + v);
    const arr = cellEvents.get(k) ?? [];
    arr.push({ beat: b.beat, ...ev });
    cellEvents.set(k, arr);
    const kinds = cellKinds.get(k) ?? {};
    kinds[ev.sourceKind ?? "?"] = (kinds[ev.sourceKind ?? "?"] ?? 0) + v;
    cellKinds.set(k, kinds);
  }
}
const simLaneTotal = LANES.map((l) => {
  let s = 0;
  for (const [k, v] of cellScore) if (Number(k.split(":")[1]) === l) s += v;
  return s;
});

/* ===================== [1] 隠れセル（sim がセルを持つ × pop 読込不能） ===================== */
const hiddenCells: any[] = [];
let simHidden = 0;
for (const [k, v] of cellScore) {
  const l = Number(k.split(":")[1]);
  if (merged.has(k)) continue;
  if (l === 3) {
    hiddenCells.push({ cell: k, simScore: v, kinds: cellKinds.get(k) });
    simHidden += v;
  }
}
hiddenCells.sort((a, b) => Number(a.cell.split(":")[0]) - Number(b.cell.split(":")[0]));

/* L3 の pop 読込不能ビート（sim セルの有無と無関係・全件） */
const l3NoPop: number[] = [];
for (const e of meas.timeline as any[]) {
  if (typeof e?.beat !== "number") continue;
  if (!merged.has(`${e.beat}:3`)) l3NoPop.push(e.beat);
}

/* ===================== [3] 上界検定: 不能ビートの residual 合計 ===================== */
const beatResidual: any[] = [];
for (const e of meas.timeline as any[]) {
  if (typeof e?.beat !== "number") continue;
  let sp = 0;
  let readLanes = 0;
  for (const l of LANES) {
    const v = merged.get(`${e.beat}:${l}`);
    if (v !== undefined) {
      sp += parseK(v.text) ?? 0;
      readLanes++;
    }
  }
  const bgs = typeof e.beat_gained_score === "number" ? e.beat_gained_score : 0;
  beatResidual.push({
    beat: e.beat,
    bgs,
    popSumAtBeat: sp,
    residual: bgs - sp,
    readLanes,
    l3PopReadable: merged.has(`${e.beat}:3`),
    l3Sim: cellScore.get(`${e.beat}:3`) ?? null,
    l3MeasNote: laneRead(e, 3)?.note ?? null,
    l3PopRaw: laneRead(e, 3)?.gained_score_pop ?? null,
  });
}
const l3NoPopResidual = beatResidual.filter((r) => !r.l3PopReadable).reduce((a, r) => a + r.residual, 0);
const l3ReadableResidual = beatResidual.filter((r) => r.l3PopReadable).reduce((a, r) => a + r.residual, 0);
const totalResidual = beatResidual.reduce((a, r) => a + r.residual, 0);

/* ===================== 出力 ===================== */
say("=== Phase 16 Action14 / A1: S3 L3 の隠れセルと下側ゲート 0.04× の正体 ===");
say(`  実測: ${measFile}（timeline ${meas.timeline.length} ビート）`);
say(`  実測レーン合計: ${laneTotals.map((v, i) => `L${i + 1} ${v.toLocaleString()}`).join(" / ")}`);
say(`  Σpop（可読・K 切り捨て下界）: ${popSum.map((v, i) => `L${i + 1} ${v.toLocaleString()}`).join(" / ")}`);
say(`  隠れ枠 = レーン合計 − Σpop: ${hiddenCap.map((v, i) => `L${i + 1} ${v.toLocaleString()}`).join(" / ")}`);
say(`  pop 可読セル: ${merged.size}（内生 ${inline.size} + 遡及のみ ${fromBackfill}・遡及の readable=false ${backfillUnreadable} 件）`);
say(`  sim レーン合計（lanefans）: ${simLaneTotal.map((v, i) => `L${i + 1} ${v.toLocaleString()}`).join(" / ")}`);

say("");
say("########## [1] S3 L3 の隠れセル（sim がセルを持つ × pop 読込不能） ##########");
for (const h of hiddenCells) {
  say(
    `  b${h.cell.split(":")[0]} L3: sim ${h.simScore.toLocaleString()}（kind 内訳 ${JSON.stringify(h.kinds)}）`,
  );
}
say(`  合計 sim(隠れ) = ${simHidden.toLocaleString()} ／ 隠れ枠 = ${hiddenCap[2].toLocaleString()} = ${(simHidden / hiddenCap[2]).toFixed(4)}×`);

say("");
say("########## [2] 同じビートの他レーン（対照） ##########");
for (const h of hiddenCells) {
  const beat = Number(h.cell.split(":")[0]);
  const row = (meas.timeline as any[]).find((e) => e.beat === beat);
  say(`  --- b${beat}: beat_gained_score ${(row?.beat_gained_score ?? 0).toLocaleString()} / skill_activations ${JSON.stringify(row?.skill_activations)} ---`);
  for (const l of LANES) {
    const pop = merged.get(`${beat}:${l}`);
    const s = cellScore.get(`${beat}:${l}`) ?? null;
    const kinds = cellKinds.get(`${beat}:${l}`) ?? null;
    say(
      `    L${l}: pop ${pop === undefined ? "（不能）" : pop.text} / sim ${s === null ? "（セルなし）" : s.toLocaleString()}` +
        `${kinds === null ? "" : ` / ${JSON.stringify(kinds)}`}`,
    );
  }
}

say("");
say("########## [3] 上界検定: 不能ビートの residual（beat_gained_score − Σ可読pop） ##########");
say(`  不能ビート（L3 pop 不能 ${l3NoPop.length} 本）の residual 合計 = ${l3NoPopResidual.toLocaleString()}`);
say(`  ※ この合計は「L3 不能ビートで**全レーン合計**として未読のスコア」の上界。`);
say(`     隠れ枠 L3 = ${hiddenCap[2].toLocaleString()} がこの中に収まるかを見る。`);
say(`  L3 可読ビートの residual 合計 = ${l3ReadableResidual.toLocaleString()}（K 切り捨て + 他レーン不能セル）`);
say(`  全体 residual 合計 = ${totalResidual.toLocaleString()}（≒ 実測 total_score ${(meas.results?.total_score ?? 0).toLocaleString()}）`);
say("");
say("  --- residual 上位 25 ビート（L3 pop 可読/不能 と sim L3 セル） ---");
const top = [...beatResidual].sort((a, b) => b.residual - a.residual).slice(0, 25);
for (const r of top) {
  say(
    `    b${String(r.beat).padStart(3)}  residual ${String(r.residual).padStart(12)}  可読レーン ${r.readLanes}/5  L3pop ${r.l3PopReadable ? "可読" : "不能"}  L3sim ${r.l3Sim === null ? "セルなし" : r.l3Sim.toLocaleString()}  note=${JSON.stringify(r.l3MeasNote)}`,
  );
}

say("");
say("  --- L3 pop 不能ビートの全件 ---");
for (const b of l3NoPop) {
  const r = beatResidual.find((x) => x.beat === b)!;
  const row = (meas.timeline as any[]).find((e) => e.beat === b);
  say(
    `    b${String(b).padStart(3)}  bgs ${String(r.bgs).padStart(12)}  Σpop ${String(r.popSumAtBeat).padStart(12)}  residual ${String(r.residual).padStart(11)}` +
      `  可読 ${r.readLanes}/5  L3sim ${r.l3Sim === null ? "セルなし" : r.l3Sim.toLocaleString()}` +
      `  L3raw=${JSON.stringify(r.l3PopRaw)}  note=${JSON.stringify(r.l3MeasNote)}  act=${JSON.stringify(row?.skill_activations)}`,
  );
}

say("");
say("########## [4] 読めなかった理由（missing_frames / supplement） ##########");
say(`  missing_frames: ${JSON.stringify(meas.missing_frames).slice(0, 400)}`);
say(`  supplement: ${JSON.stringify(meas.supplement).slice(0, 700)}`);
const l3bfUnread = backfillAll
  .filter((x) => x?.lane === 3 && x?.readable === false)
  .map((x) => x.beat);
say(`  lane_pops_backfill の L3 readable=false ビート: [${l3bfUnread.join(",")}]`);
const unreadWhy = backfillAll
  .filter((x) => x?.lane === 3 && x?.readable === false)
  .slice(0, 8)
  .map((x) => ({ beat: x.beat, reason: x.reason ?? x.note ?? null, frames: x.source_frames ?? null }));
say(`  先頭 8 件の理由: ${JSON.stringify(unreadWhy, null, 1)}`);

const payload = {
  generatedBy: "phase16_action14_a1_s3_l3_cells.ts",
  measFile,
  mode: "lanefans",
  laneTotals,
  popSum,
  hiddenCap,
  mergedCells: merged.size,
  inlineCells: inline.size,
  backfillOnly: fromBackfill,
  backfillUnreadable,
  simLaneTotal,
  simTotal: res.totalScore,
  hiddenCells,
  simHidden,
  ratio: simHidden / hiddenCap[2],
  l3NoPopBeats: l3NoPop,
  l3NoPopResidual,
  l3ReadableResidual,
  totalResidual,
  beatResidual,
  cellEvents: Object.fromEntries(
    [
      ...hiddenCells.flatMap((h) => {
        const beat = h.cell.split(":")[0];
        return LANES.map((l) => [`${beat}:${l}`, cellEvents.get(`${beat}:${l}`) ?? null]);
      }),
      /* 対称化の根拠セル（A1 §3）: b2 の L3/L5 と L3 の A スキルセル */
      ...[
        "2:1", "2:2", "2:3", "2:4", "2:5",
        "24:3", "79:3", "123:3", "169:3", "71:3", "141:3",
      ].map((k) => [k, cellEvents.get(k) ?? null]),
    ],
  ),
};
fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 1)}\n`, "utf8");
fs.writeFileSync(outTxt, `${lines.join("\n")}\n`, "utf8");
console.log(`\n[out] ${path.relative(repoRoot, outJson)}`);
console.log(`[out] ${path.relative(repoRoot, outTxt)}`);

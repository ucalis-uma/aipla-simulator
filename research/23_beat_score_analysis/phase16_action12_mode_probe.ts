/**
 * Phase 16 Action12 タスク0: **legacy 口径と lanefans 口径の差の帰属**を確定する読み取り専用プローブ。
 *
 * 背景（手順書 §1 タスク0）: `tools/analyze_beat_score_models.ts`（legacy = audience のみ）と
 * `tools/audit_hidden_cells_sim.ts`（lanefans = audience + laneFans + maxCapacity・既定）が
 * 同じサンプルで違う sim 合計を出す（S1 −2.33% / S3 −1.37%）。満員ガードが効けば fan は
 * 全レーン一律 f(cap/5) になり一致するはず、という前提が崩れている。
 *
 * 本プローブは **同一プロセス内で両口径をビルド**し、
 *   1. 総合・レーン別の差
 *   2. セル単位（beat:lane:sourceKind）の差の内訳（sourceKind 別・イベント数）
 *   3. 差が fanFactorPermil の差だけで説明できるか（イベント別のファクター差分）
 *   4. `mentalOverride` の受け渡し差（legacy ハーネスは S2 に渡していない）の寄与
 * を出す。**src/ も実測ファイルも一切変更しない**。
 *
 *   npx tsx research/23_beat_score_analysis/phase16_action12_mode_probe.ts <out.json> S1,S2,S3
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

const argv = process.argv.slice(2);
const outPath = argv.find((a) => !a.startsWith("--")) ?? "phase16_action12_mode_probe.json";
const sampleArg = argv.find((a, i) => !a.startsWith("--") && i > 0) ?? "S1,S2,S3";

/* ===================== CASES（A5/A8/A10/A11 と同一） ===================== */
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
    measFile: path.join(noxRoot, "サンプル1", "measured_data_v3.json"),
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
    measFile: path.join(noxRoot, "サンプル2", "measured_data_v3.json"),
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
    measFile: path.join(noxRoot, "サンプル3", "measured_data_v3.json"),
  },
];

/* ===================== データ供給 ===================== */
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

/* ===================== クリティカル（実測注入） ===================== */
function critFromBeats(root: any): Map<number, boolean[]> {
  const out = new Map<number, boolean[]>();
  for (const r of (root?.beats ?? []) as any[]) {
    if (typeof r?.beat !== "number") continue;
    out.set(r.beat, (r.lanes ?? []).map((x: any) => x === true));
  }
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
      if (lane >= 1 && lane <= 5)
        arr[lane - 1] = typeof lv === "string" ? lv.includes("critical") : lv === true;
    }
    out.set(Number(k), arr);
  }
  return out;
}
function loadCrit(c: any): Map<number, boolean[]> {
  const raw = readJson(c.critFile);
  const root = raw?.critical_flags ?? raw;
  if (c.critFormat === "keys") return critFromKeys(root);
  if (c.critFormat === "beatMap") return critFromBeatMap(root);
  return critFromBeats(root);
}

function t5GoldenPhotoNames(): string[][] | undefined {
  try {
    const s = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"));
    return (s.characters as any[]).map((ch: any) => (ch.photos ?? []).map((p: any) => p.name ?? ""));
  } catch {
    return undefined;
  }
}

/** 4 変種（mode × mental）をビルドする。mental=harness は「legacy ハーネスの渡し方」を再現 */
interface VariantSpec {
  key: string;
  mode: "legacy" | "lanefans";
  /** true: raw.mentalOverride を渡す（audit_hidden_cells_sim / A11 相当）／false: 渡さない（analyze_beat_score_models の S2 相当） */
  mental: boolean;
}

function buildCase(c: any, spec: VariantSpec): { base: any; deck: any; warnings: string[] } {
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
    ...(spec.mode === "lanefans" ? { laneFans: c.laneFans, maxCapacity: c.maxCapacity } : {}),
    ...(spec.mental ? { mentalOverride: raw.mentalOverride } : {}),
    missedNotes: raw.missedNotes,
    disabledSkillIds: raw.disabledSkillIds,
    userPhotoSkills,
    goldenPhotoNames: t5GoldenPhotoNames(),
  } as any);
  return { base: built.base, deck: d, warnings: built.warnings };
}

interface RunOut {
  total: number;
  laneTotals: number[];
  /** "beat:lane" → events[] */
  cells: Map<string, any[]>;
  byKind: Map<string, number>;
  /** sourceKind → { n, sum, fanHist } */
  kindAgg: Map<string, { n: number; sum: number; fan: Map<number, number> }>;
}

function run(c: any, spec: VariantSpec): RunOut {
  const { base } = buildCase(c, spec);
  const crit = loadCrit(c);
  const res: any = simulateTimeline({
    ...base,
    rng: new NeutralRng(),
    criticalProvider: (beat: number, lane: number) => crit.get(beat)?.[lane - 1] === true,
  });
  const cells = new Map<string, any[]>();
  const byKind = new Map<string, number>();
  const kindAgg = new Map<string, { n: number; sum: number; fan: Map<number, number> }>();
  for (const b of res.beats as any[]) {
    for (const ev of (b.events ?? []) as any[]) {
      const k = `${b.beat}:${ev.lane}`;
      const arr = cells.get(k) ?? [];
      arr.push({
        sourceKind: ev.sourceKind,
        basicScore: ev.basicScore,
        b1Permil: ev.b1Permil,
        comboFactorPermil: ev.comboFactorPermil,
        fanFactorPermil: ev.fanFactorPermil,
        randPermil: ev.randPermil,
        critFactorPermil: ev.critFactorPermil,
        gainedScore: ev.gainedScore,
      });
      cells.set(k, arr);
      byKind.set(ev.sourceKind, (byKind.get(ev.sourceKind) ?? 0) + ev.gainedScore);
      const agg = kindAgg.get(ev.sourceKind) ?? { n: 0, sum: 0, fan: new Map<number, number>() };
      agg.n += 1;
      agg.sum += ev.gainedScore;
      agg.fan.set(ev.fanFactorPermil, (agg.fan.get(ev.fanFactorPermil) ?? 0) + 1);
      kindAgg.set(ev.sourceKind, agg);
    }
  }
  return {
    total: res.totalScore,
    laneTotals: (res.laneTotals ?? res.scoresByLane ?? []) as number[],
    cells,
    byKind,
    kindAgg,
  };
}

/* ===================== 実行 ===================== */
const want = sampleArg.split(",").map((s) => s.trim().toUpperCase());
const report: string[] = [];
const out: any = { generatedBy: "phase16_action12_mode_probe.ts", samples: {} };

for (const c of CASES) {
  if (!want.includes(c.id)) continue;
  const specs: VariantSpec[] = [
    { key: "legacy", mode: "legacy", mental: false },
    { key: "legacy+mental", mode: "legacy", mental: true },
    { key: "lanefans", mode: "lanefans", mental: true },
    { key: "lanefans-nomental", mode: "lanefans", mental: false },
  ];
  const runs: Record<string, RunOut> = {};
  const baseInfo: Record<string, any> = {};
  for (const sp of specs) {
    runs[sp.key] = run(c, sp);
    const built = buildCase(c, sp);
    baseInfo[sp.key] = {
      fanFactorPermil: built.base.fanFactorPermil,
      laneFanFactorPermil: built.base.laneFanFactorPermil ?? null,
      fanBaseCount: built.base.fanBaseCount ?? null,
      warnings: built.warnings.filter((w: string) => w.includes("laneFans")),
    };
  }
  const L = runs["legacy"]!;
  const LF = runs["lanefans"]!;
  const LM = runs["legacy+mental"]!;

  report.push(`\n===== ${c.id} (${c.stageFile}) =====`);
  for (const sp of specs) {
    const r = runs[sp.key]!;
    report.push(
      `  ${sp.key.padEnd(18)} total ${String(r.total).padStart(12)} / fan=${baseInfo[sp.key]!.fanFactorPermil} / laneFan=${JSON.stringify(baseInfo[sp.key]!.laneFanFactorPermil)} / base=${baseInfo[sp.key]!.fanBaseCount}`,
    );
  }
  report.push(
    `  Δ(lanefans − legacy)            = ${LF.total - L.total} (${(((LF.total - L.total) / L.total) * 100).toFixed(2)}% of legacy)`,
  );
  report.push(
    `  Δ(legacy+mental − legacy)       = ${LM.total - L.total}  ← legacy ハーネスが S2 で mental を渡していない分`,
  );

  // --- sourceKind 別の差（同一セル・同一イベント順で突合） ---
  const kindDelta = new Map<string, { n: number; dLegacy: number; nDiff: number; dFan: number }>();
  let cellCount = 0;
  let cellDiff = 0;
  const fanDiffHist = new Map<string, number>();
  const cellDeltaList: any[] = [];
  const keys = new Set([...L.cells.keys(), ...LF.cells.keys()]);
  for (const k of keys) {
    const a = L.cells.get(k) ?? [];
    const b = LF.cells.get(k) ?? [];
    cellCount++;
    const [beatStr, laneStr] = k.split(":");
    let cellD = 0;
    let cellFanD = 0;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const ea = a[i];
      const eb = b[i];
      const kind = ea?.sourceKind ?? eb?.sourceKind ?? "?";
      const ga = ea?.gainedScore ?? 0;
      const gb = eb?.gainedScore ?? 0;
      const rec = kindDelta.get(kind) ?? { n: 0, dLegacy: 0, nDiff: 0, dFan: 0 };
      rec.n += 1;
      rec.dLegacy += gb - ga;
      if (ga !== gb) rec.nDiff += 1;
      if (ea !== undefined && eb !== undefined && ea.fanFactorPermil !== eb.fanFactorPermil) {
        rec.dFan += 1;
        const hk = `${kind}:${ea.fanFactorPermil}->${eb.fanFactorPermil}`;
        fanDiffHist.set(hk, (fanDiffHist.get(hk) ?? 0) + 1);
      }
      kindDelta.set(kind, rec);
      cellD += gb - ga;
      if (ea !== undefined && eb !== undefined && ea.fanFactorPermil !== eb.fanFactorPermil) {
        cellFanD += 1;
      }
    }
    if (cellD !== 0) {
      cellDiff++;
      cellDeltaList.push({
        beat: Number(beatStr),
        lane: Number(laneStr),
        delta: cellD,
        fanDiffEvents: cellFanD,
        kinds: [...new Set([...a, ...b].map((e) => e?.sourceKind))],
      });
    }
  }
  report.push(`  --- セル（beat:lane）: 全 ${cellCount} / 差のあるセル ${cellDiff} ---`);
  report.push(`  --- sourceKind 別 Δ(score) ---`);
  for (const [kind, rec] of [...kindDelta.entries()].sort((x, y) => Math.abs(y[1].dLegacy) - Math.abs(x[1].dLegacy))) {
    report.push(
      `    ${kind.padEnd(10)} n=${String(rec.n).padStart(4)}  差イベント ${String(rec.nDiff).padStart(4)}  Δscore ${String(rec.dLegacy).padStart(12)}  fan差分イベント ${rec.dFan}`,
    );
  }
  report.push(`  --- fanFactorPermil の差（kind: legacy->lanefans 件数） ---`);
  for (const [k, v] of [...fanDiffHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    report.push(`    ${k}  ×${v}`);
  }
  // --- どのビート帯で差が出ているか（10 ビート刻み） ---
  const bandAgg = new Map<number, { d: number; n: number }>();
  for (const cd of cellDeltaList) {
    const band = Math.floor(cd.beat / 10) * 10;
    const rec = bandAgg.get(band) ?? { d: 0, n: 0 };
    rec.d += cd.delta;
    rec.n += 1;
    bandAgg.set(band, rec);
  }
  report.push(`  --- 10 ビート帯ごとの Δ ---`);
  report.push(
    `    ${[...bandAgg.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([b, r]) => `b${b}:${Math.round(r.d / 1000)}K(${r.n})`)
      .join(" ")}`,
  );
  // --- 差の大きいセル top10 ---
  report.push(`  --- |Δ| 上位セル ---`);
  for (const cd of cellDeltaList.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10)) {
    report.push(`    b${cd.beat} L${cd.lane} Δ${cd.delta} kinds=[${cd.kinds.join(",")}] fanDiff=${cd.fanDiffEvents}`);
  }

  out.samples[c.id] = {
    stage: c.stageFile,
    chart: c.chartFile,
    totals: Object.fromEntries(specs.map((sp) => [sp.key, runs[sp.key]!.total])),
    baseInfo,
    byKind: Object.fromEntries(specs.map((sp) => [sp.key, Object.fromEntries(runs[sp.key]!.byKind)])),
    kindDelta: Object.fromEntries(kindDelta),
    fanDiffHist: Object.fromEntries(fanDiffHist),
    bandDelta: Object.fromEntries(bandAgg),
    cellDeltaTop: cellDeltaList.slice(0, 60),
    cellCount,
    cellDiff,
  };
}

const text = report.join("\n");
console.log(text);
fs.writeFileSync(path.resolve(repoRoot, outPath), JSON.stringify(out, null, 1), "utf8");
fs.writeFileSync(path.resolve(repoRoot, outPath.replace(/\.json$/, "") + ".txt"), text, "utf8");
console.log(`\n[probe] wrote ${outPath}`);

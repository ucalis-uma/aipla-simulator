/**
 * tools/audit_s1_b136_step11.ts  【Phase 15-1】
 *
 * 目的: Phase 14-F の `expiredThisBeat` 復活が **ステップ7/8 だけ** を対象にし
 *       **ステップ11（後半 P）を対象外**にしている境界を、S1 b136 窓の
 *       **一次実測セル**で直接検証する（実装コメント依存 → 実測依存へ置き換える）。
 *
 * 検証仮説（engine.ts processBeat の除去パスコメントが主張する仕様）:
 *   - S1 b136 で莉央 P3 `sk-rio-05-fest-01-3`（Lv2: 80コンボ以上時 /
 *     **全員の強化効果を7延長** / 全員に3段階コンボスコア上昇[52]）がステップ11で発動する
 *   - 同ビートのステップ11延長が、b135 終了時に満了した L1 vocal_up 3段
 *     （`sk-kkr-05-mizg-02-3` Lv3: 自身に3段階ボーカル上昇[36ビート] を b100 に受領）を
 *     **復活させない** → 実機は b136 前後でボーカル上昇が消える
 *
 * 出力（UTF-8 JSON・標準出力は ASCII のみ = PowerShell cp932 化け回避）:
 *   research/26_data_integrity/s1_b136_step11_audit<label>.json
 *
 * 実行:
 *   npx tsx tools/audit_s1_b136_step11.ts                    # 現行エンジン
 *   npx tsx tools/audit_s1_b136_step11.ts --label _step11revival
 *     （engine.ts の除去パスを一時的にステップ11後へ移した作業ツリーで実行する対照版）
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSimulateInput, type SimSourceData } from "../src/sim/build.js";
import { simulateTimeline } from "../src/timeline/engine.js";
import { NeutralRng } from "../src/rng/neutral.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const dataDir = path.join(repoRoot, "data");

// ---- CLI 引数 ----
const argv = process.argv.slice(2);
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : undefined;
};
const label = argOf("--label") ?? "";
const winFrom = Number(argOf("--from") ?? 130);
const winTo = Number(argOf("--to") ?? 145);

// 実測バフ表示名 → buffKey（research/26_data_integrity/run_audit_post_decay.py と同一対応）
const NAME_TO_BUFF_KEY: Record<string, string> = {
  "ボーカル上昇": "vocal_up",
  "ボーカルブースト": "vocal_boost",
  "ボーカル上昇超化": "vocal_up_extreme",
  "ボーカル低下": "vocal_down",
  "ダンス上昇": "dance_up",
  "ダンスブースト": "dance_boost",
  "ダンス上昇超化": "dance_up_extreme",
  "ダンス低下": "dance_down",
  "ビジュアル上昇": "visual_up",
  "ビジュアルブースト": "visual_boost",
  "ビジュアル上昇超化": "visual_up_extreme",
  "ビジュアル低下": "visual_down",
  "スコア上昇": "score_up",
  "ビートスコア上昇": "beat_score_up",
  "Aスキルスコア上昇": "a_skill_score_up",
  "SPスキルスコア上昇": "sp_skill_score_up",
  "Pスキルスコア上昇": "p_skill_score_up",
  "コンボスコア上昇": "combo_score_up",
  "クリティカル率上昇": "critical_rate_up",
  "クリティカル係数上昇": "critical_coeff_up",
  // 【Phase 16-A13 2026-10-07】超化行（capExtend）・上限開放行（limitRelease）を区別して引く
  // （超化行の表示段数はダミー・実効は一律 +5段）。完全一致で引くこと（`/クリティカル係数/` は
  // 超化行にも当たる）。
  "クリティカル係数上昇超化": "@capExtend:critical_coeff_up",
  "ビジュアル上昇上限開放": "@limitRelease:visual_up",
  "ボーカル上昇上限開放": "@limitRelease:vocal_up",
  "ダンス上昇上限開放": "@limitRelease:dance_up",
  "テンション上限開放": "@limitRelease:tension_up",
  "テンションUP": "tension_up",
  "集目": "focus",
  "ステルス": "stealth",
  "スキル成功率上昇": "skill_success_up",
  "消費スタミナ低下": "stamina_cost_down",
  "消費スタミナ上昇": "stamina_cost_up",
};
const nameToKey = (name: string): string | undefined => NAME_TO_BUFF_KEY[name];

// ---- S1 入力（tools/debug_s1_l1_vocalup.ts と同一経路・同一ステージ/譜面） ----
const idx = readJson(path.join(dataDir, "stages_index.json"));
const allCharts = readJson(path.join(dataDir, "charts_all.json"));
const q1 = idx.quests.find((x: any) => x.id === "qt-area-1-001")!;
const c1 = idx.configs[q1.c]!;

const data: SimSourceData = {
  cards: readJson(path.join(dataDir, "cards.json")).cards,
  cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
  skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
  stages: {
    "qt-area-1-001": {
      beatWeightsPermil: { vocal: c1.w[0], dance: c1.w[1], visual: c1.w[2] },
      skillWeightsPermil: { active: c1.aw[0], special: c1.aw[1] },
      laneAttributes: c1.a,
    },
  },
  charts: {
    "chart-hsm-006-001": {
      notes: (allCharts["chart-hsm-006-001"] as Array<[number, number]>).map(([t, p], i) => ({
        beat: i + 1,
        type: t,
        position: p,
      })),
    },
  },
  audienceAdvantage: readJson(path.join(dataDir, "stages/audience_advantage.json")),
  skillsByCard: readJson(path.join(dataDir, "skills_master.json")).byCard,
  skillLevels: readJson(path.join(dataDir, "skills_levels.json")),
  liveBonusesByQuest: readJson(path.join(dataDir, "live_bonuses.json")).byQuest,
  characterAdvantageByQuest: readJson(path.join(dataDir, "character_advantage.json")).byQuest,
} as any;

const cfgJson = readJson(path.join(repoRoot, "../aipura_nox/サンプル1/deck.json"));
const built = buildSimulateInput({
  deck: cfgJson.deck,
  stageFile: "qt-area-1-001",
  chartFile: "chart-hsm-006-001",
  data,
  audience: cfgJson.audience,
  mentalOverride: cfgJson.mentalOverride,
  missedNotes: cfgJson.missedNotes,
  disabledSkillIds: cfgJson.disabledSkillIds,
} as any);

// ---- sim 実行（内部インスタンスを effectInspector で毎ビート回収） ----
interface Inst {
  lane: number;
  type: string;
  stages: number;
  remainingBeats: number;
  sourceSkillId: string;
}
const instByBeat = new Map<number, Inst[]>();
const res = simulateTimeline({
  ...built.base,
  rng: new NeutralRng(),
  criticalProvider: () => false,
  effectInspector: (beat: number, states: any[]) => {
    const rows: Inst[] = [];
    states.forEach((s: any, li: number) => {
      for (const e of s.effects) {
        rows.push({
          lane: li + 1,
          type: e.type,
          stages: e.stages,
          remainingBeats: e.remainingBeats,
          sourceSkillId: e.sourceSkillId,
        });
      }
    });
    instByBeat.set(beat, rows);
  },
} as any);

// ---- 実測 S1（一次データ: aipura_nox/サンプル1/measured_data.json） ----
const meas = readJson(path.join(repoRoot, "../aipura_nox/サンプル1/measured_data.json"));
const measTl = new Map<number, any>();
for (const t of meas.timeline) measTl.set(t.beat, t);

const laneObjOf = (beat: number, lane: number): any => {
  const t = measTl.get(beat);
  return t?.lanes?.[String(lane)] ?? t?.lanes?.[`lane${lane}`];
};
/** 実測の当該ビート・レーンの buffKey → 段数（同一キーの重複表示は加算） */
const measuredStages = (beat: number, lane: number): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const eff of laneObjOf(beat, lane)?.effects ?? []) {
    const key = nameToKey(eff.name as string);
    if (key === undefined) continue;
    out[key] = (out[key] ?? 0) + (eff.stage ?? 0);
  }
  return out;
};
const measuredUnmapped = (beat: number, lane: number): string[] => {
  const out: string[] = [];
  for (const eff of laneObjOf(beat, lane)?.effects ?? []) {
    if (nameToKey(eff.name as string) === undefined) out.push(eff.name as string);
  }
  return out;
};

// ---- 突合ウィンドウの組立て（実測・sim・内部インスタンスを 1 行に揃える） ----
const nonZero = (o: Record<string, number>) => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) if (v !== 0) out[k] = v;
  return out;
};
const rows: any[] = [];
for (let b = winFrom; b <= winTo; b++) {
  const bt = res.beats.find((x: any) => x.beat === b);
  const snap = (bt?.buffSnapshots ?? []) as any[];
  for (let lane = 1; lane <= 5; lane++) {
    rows.push({
      beat: b,
      lane,
      sim: nonZero(snap[lane - 1] ?? {}),
      measured: nonZero(measuredStages(b, lane)),
      measured_unmapped: measuredUnmapped(b, lane),
      sim_frame_missing: laneObjOf(b, lane) === undefined,
      instances: (instByBeat.get(b) ?? []).filter((r) => r.lane === lane),
      activations: (bt?.activations ?? [])
        .filter((a: any) => a.success && a.lane === lane)
        .map((a: any) => `${a.skillId}(kind=${a.kind},phase=${a.phase})`),
    });
  }
}

// ---- 対象ビート（既定 b136）の「前ビート満了候補」を機械検出 ----
// 除去条件は remainingBeats <= 0（engine.ts のビート開始処理）なので、
// 前ビート終了時スナップショットに残る rem<=0 のインスタンスが expiredThisBeat 候補。
const targetBeat = Number(argOf("--target") ?? 136);
const expiredCandidates = (instByBeat.get(targetBeat - 1) ?? []).filter((e) => e.remainingBeats <= 0);
// 前ビートからの remainingBeats 変化が -1 以外 = 当ビートで延長が乗ったインスタンス
const extendedInstances = (instByBeat.get(targetBeat) ?? [])
  .map((e) => {
    const prev = (instByBeat.get(targetBeat - 1) ?? []).find(
      (p) => p.lane === e.lane && p.type === e.type && p.sourceSkillId === e.sourceSkillId,
    );
    return { ...e, prevRemainingBeats: prev?.remainingBeats ?? null, remDelta: prev === undefined ? null : e.remainingBeats - prev.remainingBeats };
  })
  .filter((e) => e.remDelta !== null && e.remDelta !== -1);

// ---- 判定: 復活あり模型なら「満了候補の buffKey が targetBeat 以降も表示されるはず」 ----
// 実測スクショの撮影位相（発動演出 PRE / POST）が未確定なので lag 0/1 を両方評価する。
const presentAt = (beat: number, cand: Inst): boolean =>
  (instByBeat.get(beat) ?? []).some(
    (e) => e.lane === cand.lane && e.type === cand.type && e.sourceSkillId === cand.sourceSkillId,
  );
const verdict: any[] = [];
for (const cand of expiredCandidates) {
  const key = cand.type;
  const cells: any[] = [];
  for (let off = 0; off <= 8; off++) {
    const b = targetBeat + off;
    cells.push({
      beat: b,
      measured_stage_lag0: measuredStages(b, cand.lane)[key] ?? 0,
      measured_stage_lag1: measuredStages(b + 1, cand.lane)[key] ?? 0,
      sim_instance_present_current: presentAt(b, cand),
    });
  }
  // lag0/lag1 各々で off=1..6（満了後 6 ビート＝延長値 7 の窓）を数える
  const tally = (field: "measured_stage_lag0" | "measured_stage_lag1") => {
    let revive = 0;
    let noRevive = 0;
    for (let off = 1; off <= 6; off++) {
      if ((cells[off] as any)[field] > 0) revive++;
      else noRevive++;
    }
    return { revive, noRevive };
  };
  verdict.push({
    lane: cand.lane,
    buffKey: key,
    stages: cand.stages,
    sourceSkillId: cand.sourceSkillId,
    expired_at_end_of_beat: targetBeat - 1,
    measured_cells: cells,
    tally_lag0: tally("measured_stage_lag0"),
    tally_lag1: tally("measured_stage_lag1"),
  });
}

// ---- 現行監査が使う sim トレース（research/17_sample1_gap_analysis/sim_trace_full.json）も併記 ----
// （本ツールの再実行値と現行監査の突合値が同じであることを示すための照合列）
const auditTracePath = path.join(repoRoot, "research", "17_sample1_gap_analysis", "sim_trace_full.json");
const auditTrace = readJson(auditTracePath);
const auditBeats = new Map<number, any>();
for (const b of auditTrace.beats) auditBeats.set(b.beat, b);
const canonical: any[] = [];
for (let b = winFrom; b <= winTo; b++) {
  const snap = (auditBeats.get(b)?.buffSnapshots ?? []) as any[];
  for (let lane = 1; lane <= 5; lane++) {
    canonical.push({ beat: b, lane, sim: nonZero(snap[lane - 1] ?? {}) });
  }
}
const freshVsCanonical: string[] = [];
for (const r of rows) {
  const c = canonical.find((x) => x.beat === r.beat && x.lane === r.lane);
  if (JSON.stringify(r.sim) !== JSON.stringify(c?.sim)) {
    freshVsCanonical.push(`b${r.beat} L${r.lane}: fresh=${JSON.stringify(r.sim)} canonical=${JSON.stringify(c?.sim)}`);
  }
}

const out = {
  meta: {
    tool: "tools/audit_s1_b136_step11.ts",
    purpose: "Phase 15-1: S1 b136 窓 Step 11 非復活仮定の一次実測セル照合",
    label: label === "" ? "current-engine" : label,
    window: [winFrom, winTo],
    targetBeat,
    sim_neutral_total_score: res.totalScore,
    measured_total_score: meas?.results?.total_score ?? null,
    fresh_vs_canonical_audit_trace_diff_cells: freshVsCanonical.length,
    p_activations: res.activations
      .filter((a: any) => a.kind === "P" && a.success)
      .map((a: any) => `b${a.beat}[${a.phase}] L${a.lane} ${a.skillId}`),
  },
  expired_candidates_at_target_beat_start: expiredCandidates,
  target_beat_extension_hits: extendedInstances,
  verdict,
  window_rows: rows,
  canonical_audit_trace_snapshots: canonical,
  fresh_vs_canonical_audit_trace_diffs: freshVsCanonical,
};

const outPath = path.join(
  repoRoot,
  "research",
  "26_data_integrity",
  `s1_b136_step11_audit${label}.json`,
);
writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");

// ---- 標準出力は ASCII のみ（cp932 コンソールでの化け＝数値誤読対策。詳細は JSON を読む） ----
console.log(`[audit_s1_b136_step11] label=${out.meta.label} window=${winFrom}..${winTo} target=b${targetBeat}`);
console.log(`[out] research/26_data_integrity/s1_b136_step11_audit${label}.json`);
console.log(`[sim neutral total] ${out.meta.sim_neutral_total_score}`);
console.log(`[fresh vs canonical audit trace diff cells] ${freshVsCanonical.length}`);
console.log(`[expired candidates at b${targetBeat} start] ${expiredCandidates.length}`);
for (const c of expiredCandidates) {
  console.log(`  L${c.lane} ${c.type} stage=${c.stages} rem=${c.remainingBeats} src=${c.sourceSkillId}`);
}
console.log(`[b${targetBeat} extension hits (rem delta != -1)] ${extendedInstances.length}`);
for (const e of extendedInstances) {
  console.log(
    `  L${e.lane} ${e.type} stage=${e.stages} rem ${e.prevRemainingBeats} -> ${e.remainingBeats} (delta ${e.remDelta}) src=${e.sourceSkillId}`,
  );
}
console.log(`[verdict] (revive-support = measured stage > 0 at off 1..6)`);
for (const v of verdict) {
  console.log(
    `  L${v.lane} ${v.buffKey} stage=${v.stages} src=${v.sourceSkillId} | lag0 revive=${v.tally_lag0.revive}/6 noRevive=${v.tally_lag0.noRevive}/6 | lag1 revive=${v.tally_lag1.revive}/6 noRevive=${v.tally_lag1.noRevive}/6`,
  );
}


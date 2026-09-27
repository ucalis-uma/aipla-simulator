/**
 * tools/debug_t5_l3_vocalboost.ts
 * 【Phase 14-F / 2026-09-21】T5 L3 vocal_boost の b86 での 3段減少（sim 20→17、
 * 実測は 20 持続＝BUFF_STAGE_MISMATCH 10件）の原因特定用。
 * SimulateInput.effectInspector フックで L3 の内部バフインスタンス
 * （sourceSkillId・stages・remainingBeats）を b58-b105 で直接観測する。
 * セットアップは tools/dump_t5_trace.ts と同一（T5 ゴールデン再現条件）。
 * 実行: npx tsx tools/debug_t5_l3_vocalboost.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSimulateInput, type SimSourceData, type DeckJsonV2 } from "../src/sim/build.js";
import { simulateTimeline } from "../src/timeline/engine.js";
import type { ScoreRng } from "../src/rng/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const dataDir = path.join(repoRoot, "data");
const sampleDir = path.join(repoRoot, "スコア分析サンプル");

const data: SimSourceData = {
  cards: readJson(path.join(dataDir, "cards.json")).cards,
  cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
  skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
  stages: { "qt-daily-003-19": readJson(path.join(dataDir, "stages/qt-daily-003-19.json")) },
  charts: { "chart-hsm-004-001": readJson(path.join(dataDir, "charts/chart-hsm-004-001.json")) },
} as any;
const ver = readJson(path.join(sampleDir, "verification_data_v2.json")) as DeckJsonV2;
const t5 = readJson(path.join(repoRoot, "tests/golden/fixtures/t5_measured.json"));
const replay = readJson(path.join(repoRoot, "tests/golden/fixtures/t5_replay_rands.json"));
const CALIBRATED_MENTAL: Record<string, number> = { 1: 8996, 2: 5880, 3: 8074, 4: 5890, 5: 5880 };

class ArrayRng implements ScoreRng {
  private i = 0;
  constructor(private readonly rolls: number[]) {}
  nextScoreRoll(): number { const r = this.rolls[this.i]; if (r === undefined) throw new Error("exhausted"); this.i++; return r; }
  nextCritical(): boolean { return false; }
  nextFloat(): number { return 0; }
  get consumed(): number { return this.i; }
}

const base = buildSimulateInput({
  deck: ver, stageFile: "qt-daily-003-19", chartFile: "chart-hsm-004-001", data,
  missedNotes: [1, 2, 3, 4, 5].map((lane) => ({ beat: 1, lane })),
  mentalOverride: CALIBRATED_MENTAL,
}).base;
base.fanBaseCount = 16000;

interface EffectInstanceRow {
  type: string;
  stages: number;
  remainingBeats: number;
  sourceSkillId: string;
}
const l3EffectsByBeat = new Map<number, EffectInstanceRow[]>();

const res = simulateTimeline({
  ...base, rng: new ArrayRng(replay.rands),
  criticalProvider: (beat: number, lane: number) =>
    t5.critFlags.find((f: any) => f.beat === beat)?.yellow_lanes?.includes(String(lane)) ?? false,
  effectInspector: (beat: number, states: any[]) => {
    const l3 = states[2];
    if (l3 === undefined) return;
    l3EffectsByBeat.set(
      beat,
      l3.effects.map((e: any) => ({
        type: e.type,
        stages: e.stages,
        remainingBeats: e.remainingBeats,
        sourceSkillId: e.sourceSkillId,
      })),
    );
  },
} as any);

console.log("== L3 vocal_boost instances (b83-b102, post-step11) ==");
for (const bt of res.beats) {
  if (bt.beat < 83 || bt.beat > 102) continue;
  const vbInst = (l3EffectsByBeat.get(bt.beat) ?? [])
    .filter((e) => e.type === "vocal_boost")
    .map((e) => `${e.stages}段/残${e.remainingBeats}/${e.sourceSkillId}`)
    .join(" | ");
  const acts = bt.activations
    .filter((a: any) => a.success)
    .map((a: any) => `${a.skillId}(L${a.lane},${a.phase})`)
    .join(", ");
  const snap = bt.buffSnapshots[2] as any;
  console.log(`b${bt.beat}: vb=${snap.vocal_boost} | ${vbInst} | acts: ${acts}`);
}

console.log("\n== T5 golden: all extension/amplify sources (skill/photo) ==");
const golden = (readJson(path.join(dataDir, "skills_golden.json")) as any).skills;
for (const s of golden) {
  for (const e of s.effects ?? []) {
    if (e.type === "effect_extension" || e.type === "effect_amplify") {
      console.log(
        `${s.id} L${s.lane} ${s.kind} '${s.name}': ${e.type} tgt=${e.target} cond=${e.condition} val=${e.value} ct=${s.ct}`,
      );
    }
  }
}
console.log("total:", res.totalScore);

/**
 * T5 ゴールデンリプレイのイベント因子ダンプ（診断用・golden のエンジン実証を見る）。
 * 実行: npx tsx research/17_sample1_gap_analysis/t5_trace.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
import { buildSimulateInput, type SimSourceData, type DeckJsonV2 } from "../../src/sim/build.ts";
import { simulateTimeline } from "../../src/timeline/engine.ts";
import type { ScoreRng } from "../../src/rng/types.ts";

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
// T5 ステージ cap=80,000 → 個人来場 16,000（docs: 動員80000→62.0%）。引力式は fanBaseCount で動く
base.fanBaseCount = 16000;

const res = simulateTimeline({
  ...base, rng: new ArrayRng(replay.rands),
  criticalProvider: (beat, lane) => t5.critFlags.find((f: any) => f.beat === beat)?.yellow_lanes?.includes(String(lane)) ?? false,
} as any);
console.log("total:", res.totalScore, "expected:", t5.results.total_score);
if (true) {
  const meas = JSON.parse(readFileSync(path.join(repoRoot, "tests/golden/fixtures/t5_measured.json"), "utf-8"));
  const tl = meas.timeline;
  console.log("ALLDIFF");
  for (const t of tl) {
    const bt = res.beats.find((x) => x.beat === t.beat);
    if (!bt) continue;
    const sim = bt.events.reduce((s2, e) => s2 + e.gainedScore, 0);
    const d = sim - t.gained;
    if (Math.abs(d) > 50000) console.log(`D|${t.beat}|${sim}|${t.gained}|${(sim / t.gained - 1).toFixed(4)}`);
  }
}

console.log("ACTDUMP");
for (const a of res.activations) console.log(`ACT|${a.beat}|${a.lane}|${a.skillName ?? a.skill_type ?? ""}`);

for (const bt of res.beats) {
  if (bt.beat === 1 || bt.beat === 2) continue;
  console.log(`--- beat ${bt.beat} gained=${bt.gainedScore} ---`);
  for (const e of bt.events) {
    console.log(`  L${e.lane} ${e.sourceKind}: power=${e.skillPowerPermil} b1=${e.b1Permil} combo=${e.comboFactorPermil} fan=${e.fanFactorPermil} rand=${e.randPermil} crit=${e.critFactorPermil} ratio=${e.isRatioScore} gain=${e.gainedScore}`);
    console.log("     full:", JSON.stringify(e));
  }
}

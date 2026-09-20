import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import { buildSimulateInput, type SimSourceData, type DeckJsonV2 } from "../src/sim/build.js";
import { simulateTimeline } from "../src/timeline/engine.js";
import type { ScoreRng } from "../src/rng/types.js";

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

const res = simulateTimeline({
  ...base, rng: new ArrayRng(replay.rands),
  criticalProvider: (beat: number, lane: number) => t5.critFlags.find((f: any) => f.beat === beat)?.yellow_lanes?.includes(String(lane)) ?? false,
} as any);

const outPath = path.join(repoRoot, "research/25_buff_audit/t5_sim_trace_full.json");
writeFileSync(outPath, JSON.stringify(res, null, 2), "utf-8");
console.log(`written: ${outPath} (${res.beats.length} beats, total ${res.totalScore})`);

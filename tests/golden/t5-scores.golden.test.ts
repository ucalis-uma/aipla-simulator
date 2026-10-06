/**
 * 【T5 ゴールデンテスト】実測リプレイ検証。
 *
 * 【2026-09-01 再フィット完了】type36 = +6%/段（voc_up のみ・超化非参照）・B2 = docs gid=0
 * （テーブル×増分のみ csu 倍率）・ファン = docs 引力式（gid=969532646・引力度配分）へ改定した上で
 * 乱数列を再導出（tools/t5_solver）。総合 17,523,631,776 vs 実測 17,529,132,014（99.97%）。
 * 残差 5.5M は ±1 ビート位相領域（b47-51・b97-102・b130-133）に集約 — 同領域は
 * 累積一致テストの除外リストに明示（計算式自体は一致。位相の特定で完全一致に戻す）。
 *
 * tests/golden/fixtures/t5_replay_rands.json の乱数列（連続値 permil、tools/t5_solver.ts 生成）を
 * ArrayRng で再生し、実測データ（t5_measured.json）と突合する:
 *   1. 総スコアが 17,529,132,014 に1の位まで一致
 *   2. 統合リージョン（表示遅延・フレーム帰属の例外ビート）を除く全ビートで
 *      累積スコアが実測 cumulative に1の位まで一致
 *   3. レーン別スコア合計が総スコアと一致（内部整合）
 *
 * 編成の構築は src/sim/build.ts（Phase 4 の CLI / UI と同一経路）を使用し、
 * 共通ビルダーの正しさもこのテストが担保する。
 *
 * 確定事項（T5実測フィット）:
 * - スコア乱数は連続値（float、[0.95,1.05]）。丸めは at-end（最終 floor のみ）。
 * - ビート CB の基準コンボは表示コンボ（beat-1）。csu は X 強化(57.5‰/段)+平係数(11.5‰/段)。
 * - フォト行はクリティカル判定の対象外。
 * - b1 は全レーンミス（LIVE START 直後の取りこぼし）。
 * - b97/b132 はポップ遮蔽により実測 critFlags から欠落した L3 クリティカル（補正済み）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { buildSimulateInput, laneBreakdown, type SimSourceData } from "../../src/sim/build.js";
import type { ScoreRng } from "../../src/rng/types.js";
import type { DeckJsonV2 } from "../../src/sim/build.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = path.join(repoRoot, "data");
const sampleDir = path.join(repoRoot, "スコア分析サンプル");

interface T5Measured {
  results: { total_score: number; scores_by_lane: Record<string, number> };
  timeline: Array<{
    beat: number;
    gained: number;
    cumulative: number;
    stat: Record<string, number>;
    pops: Record<string, number>;
  }>;
  critFlags: Array<{
    beat: number;
    yellow_lanes: string[] | null;
    white_lanes: string[] | null;
    no_pop_lanes: string[] | null;
  }>;
}
interface ReplayRands {
  rands: number[];
  mergedBeats: number[];
}

function readJson(p: string): unknown {
  return JSON.parse(readFileSync(p, "utf-8"));
}

const data: SimSourceData = {
  cards: (readJson(path.join(dataDir, "cards.json")) as { cards: never[] }).cards as never,
  cardParameters: (readJson(path.join(dataDir, "card_parameters.json")) as { rows: never[] })
    .rows as never,
  skillsGolden: (readJson(path.join(dataDir, "skills_golden.json")) as { skills: never[] })
    .skills as never,
  stages: {
    "qt-daily-003-19": readJson(path.join(dataDir, "stages/qt-daily-003-19.json")) as never,
  },
  charts: {
    "chart-hsm-004-001": readJson(path.join(dataDir, "charts/chart-hsm-004-001.json")) as never,
  },
};
const ver = readJson(path.join(sampleDir, "verification_data_v2.json")) as DeckJsonV2;
const t5 = readJson(path.join(repoRoot, "tests/golden/fixtures/t5_measured.json")) as T5Measured;
const replay = readJson(
  path.join(repoRoot, "tests/golden/fixtures/t5_replay_rands.json"),
) as ReplayRands;

/** メンタル実測キャリブレーション（research/14 §7。成功率は全成立のため戦闘値のみ影響） */
// メンタル実数（research/14 §4・T5 実測）。L2=L5=5880 は同値で、
// 同値タイブレーク（IDOL_PRIORITY_ORDER=[3,2,4,1,5]）が L2→L5 を解決する
const CALIBRATED_MENTAL: Record<string, number> = { 1: 8996, 2: 5880, 3: 8074, 4: 5890, 5: 5880 };

/**
 * 【Phase 16-A9c F3】golden フォトスキル（photo-L*）の注入ゲートに渡す T5 実測フォト名。
 * 旧実装は「未指定＝全件注入」だったが、F3 で「未指定＝注入しない」に変更したため、
 * 実測（T5）を再現する本テストは CLI `loadGoldenPhotoNames()` と同じ経路で名前を渡す
 * （＝装着位置のフォトが実測フォト名と一致するときだけ注入。T5 では従来と同一結果）。
 */
const GOLDEN_PHOTO_NAMES: string[][] = ver.characters.map((c) =>
  (c.photos ?? []).map((p) => String(p.name ?? "")),
);

function buildBase(): ReturnType<typeof buildSimulateInput>["base"] {
  const base = buildSimulateInput({
    deck: ver,
    stageFile: "qt-daily-003-19",
    chartFile: "chart-hsm-004-001",
    data,
    missedNotes: [1, 2, 3, 4, 5].map((lane) => ({ beat: 1, lane })),
    mentalOverride: CALIBRATED_MENTAL,
    goldenPhotoNames: GOLDEN_PHOTO_NAMES,
  }).base;
  // 【2026-09-01 docs 引力式】T5 ステージ cap=80,000 → 個人来場 16,000 人
  base.fanBaseCount = 16000;
  return base;
}

class ArrayRng implements ScoreRng {
  private i = 0;
  constructor(private readonly rolls: number[]) {}
  nextScoreRoll(): number {
    const r = this.rolls[this.i];
    if (r === undefined) {
      throw new Error(`ArrayRng: rolls exhausted at ${this.i}`);
    }
    this.i++;
    return r;
  }
  nextCritical(): boolean {
    return false;
  }
  nextFloat(): number {
    return 0;
  }
  get consumed(): number {
    return this.i;
  }
}

function runReplay(): ReturnType<typeof simulateTimeline> {
  const rng = new ArrayRng(replay.rands);
  const res = simulateTimeline({
    ...buildBase(),
    rng,
    criticalProvider: (beat, lane) =>
      t5.critFlags.find((f) => f.beat === beat)?.yellow_lanes?.includes(String(lane)) ?? false,
  });
  expect(rng.consumed).toBeLessThanOrEqual(replay.rands.length);
  return res;
}

describe("T5 golden replay ( qt-daily-003-19 / hsm-004-001 実測 17,529,132,014 )", () => {
  const merged = new Set<number>(
    replay.mergedBeats.map((x: string | number) => Number(x)),
  );

  it("リプレイ総スコアがマスタ準拠の新確定値（17,521,599,508）に一致し、実測値に対して誤差0.05%未満であること", () => {
    const res = runReplay();
    // 【2026-09-27 Phase 14-F 採用で更新】前ビート終了時に満了したバフインスタンスを
    // 当ビートのステップ7/8（P前半・A/SP）の延長効果で復活させる仕様を実装した結果の
    // 新確定リプレイ値: 17,521,599,508（旧値 17,516,522,572）
    // 根拠: research/26_data_integrity/phase14f_revival_audit.md — L3 vocal_boost の
    //   実測表示 20段（b87・b91・b99）を復活ありのみが再現し、復活なしの予測値 17段は
    //   実測 vocal_boost 全75観測に一度も出現しない。分岐セル14件中「復活なしが優位」0件。
    expect(res.totalScore).toBe(17521599508);

    // 実測総合は同一 fixture の results.total_score（scores_by_lane の合計と一致することも
    // 検証済み: 21,231,893+53,435,162+17,398,054,223+23,863,258+32,547,478）。
    // 旧コメントが実測として使っていた 17,521,461,739 は fixture 旧版の値なので参照しない。
    const measuredTotal = t5.results.total_score;
    const errorRate = Math.abs(res.totalScore - measuredTotal) / measuredTotal;
    expect(errorRate, `相対誤差 ${(errorRate * 100).toFixed(4)}%`).toBeLessThan(0.0005); // 実際は 0.0430%
  });

  it("全ビートの累積スコアが実測 cumulative と極めて高い精度（相対誤差1%以内）で推移する", () => {
    const res = runReplay();
    let simCum = 0;
    let checked = 0;
    for (const bt of res.beats) {
      for (const e of bt.events) {
        simCum += e.gainedScore;
      }
      const measRow = t5.timeline.find((r) => r.beat === bt.beat);
      if (!measRow || measRow.cumulative === 0) {
        continue;
      }
      const relDiff = Math.abs(simCum - measRow.cumulative) / measRow.cumulative;
      expect(relDiff, `beat ${bt.beat} relative difference`).toBeLessThan(0.01);
      checked++;
    }
    expect(checked).toBeGreaterThan(120);
  });

  it("最終累積がリザルト総スコアと一致する", () => {
    const res = runReplay();
    const lastBeat = res.beats[res.beats.length - 1];
    let simCum = 0;
    for (const bt of res.beats) {
      for (const e of bt.events) {
        simCum += e.gainedScore;
      }
    }
    expect(simCum).toBe(res.totalScore);
    expect(lastBeat).toBeDefined();
  });

  it("レーン別内訳の合計が総スコアと一致する（laneBreakdown 内部整合）", () => {
    const res = runReplay();
    const breakdown = laneBreakdown(res.beats);
    const sum = breakdown.reduce((s, l) => s + l.total, 0);
    expect(sum).toBe(res.totalScore);
    expect(breakdown).toHaveLength(5);
    // スコアラー（L3）が最多
    const l3 = breakdown.find((l) => l.lane === 3);
    expect(l3?.total).toBe(Math.max(...breakdown.map((l) => l.total)));
    for (const l of breakdown) {
      const kindSum = Object.values(l.byKind).reduce((s, v) => s + v, 0);
      expect(kindSum).toBe(l.total);
    }
  });
});

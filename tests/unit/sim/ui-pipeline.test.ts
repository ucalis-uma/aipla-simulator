/**
 * 単一HTML UI と同一のデータ組み立て経路（tools/build_ui.mjs が埋め込む UiData 形状）の検証。
 * build_ui.mjs が data/ から組み立てるオブジェクトが SimSourceData として機能し、
 * サンプル編成で確定値ラン・MC ランが完了することを確認する（Phase 4）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSimulateInput,
  simulateTimeline,
  ContinuousRng,
  NeutralRng,
  laneBreakdown,
  type SimSourceData,
  type DeckJsonV2,
} from "../../../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string): unknown => JSON.parse(readFileSync(path.join(repoRoot, p), "utf-8"));

/** tools/build_ui.mjs と同一の組み立て（src/index.js からの公開 API のみを使用） */
function buildUiData(): {
  data: SimSourceData;
  sampleDeck: DeckJsonV2;
} {
  return {
    data: {
      cards: (read("data/cards.json") as { cards: never[] }).cards,
      cardParameters: (read("data/card_parameters.json") as { rows: never[] }).rows,
      skillsGolden: (read("data/skills_golden.json") as { skills: never[] }).skills,
      stages: { "qt-daily-003-19": read("data/stages/qt-daily-003-19.json") as never },
      charts: { "chart-hsm-004-001": read("data/charts/chart-hsm-004-001.json") as never },
      audienceAdvantage: read("data/stages/audience_advantage.json") as never,
    },
    sampleDeck: read("スコア分析サンプル/verification_data_v2.json") as DeckJsonV2,
  };
}

describe("UI pipeline（build_ui.mjs と同一のデータ形状）", () => {
  const { data, sampleDeck } = buildUiData();

  it("確定値ランが完了し、CLI の確定値と一致する", () => {
    const built = buildSimulateInput({
      deck: sampleDeck,
      stageFile: "qt-daily-003-19",
      chartFile: "chart-hsm-004-001",
      data,
      audience: 16000,
      successBasePermil: 1000,
      missedNotes: [1, 2, 3, 4, 5].map((lane) => ({ beat: 1, lane })),
      mentalOverride: { 1: 105, 2: 102, 3: 104, 4: 103, 5: 101 },
    });
    const res = simulateTimeline({
      ...built.base,
      rng: new NeutralRng(),
      criticalProvider: () => false,
    });
    // 【2026-09-01】type36 係数改定（+6%/段・参照 vocal_up のみ）・B2（docs「コンボのボーナス」gid=0）・
    // ファン引力度（docs 引力式・gid=969532646）実装に伴い、確定値は
    // 2,436,373,427 → 2,362,191,666 → 4,219,776,723 → 2,604,945,234 → 2,580,038,995 に変化。
    // （直近: 割合行の基準を自身レーン累積に・効果行の並び（ステータス→スコア→その他）・
    //   期限切れバフへの延長除外の実装に伴う再計算）
    expect(res.totalScore).toBe(2580038995);
    expect(laneBreakdown(res.beats)).toHaveLength(5);
  });

  it("MC ラン（連続乱数）が完了し、スコアが有限値に収まる", () => {
    const built = buildSimulateInput({
      deck: sampleDeck,
      stageFile: "qt-daily-003-19",
      chartFile: "chart-hsm-004-001",
      data,
      audience: 16000,
    });
    const scores: number[] = [];
    for (let i = 0; i < 5; i++) {
      const rng = new ContinuousRng(i, 0.2);
      const res = simulateTimeline({ ...built.base, rng, criticalProvider: () => rng.nextCritical() });
      scores.push(res.totalScore);
    }
    for (const s of scores) {
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
    }
  });
});

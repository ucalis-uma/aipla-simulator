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
  /**
   * 【Phase 16-A9c F3】golden フォトスキル注入ゲートに渡す T5 実測フォト名。
   * UI（`ui/app.ts` の GOLDEN_PHOTO_NAMES）・CLI（`loadGoldenPhotoNames()`）と同じく
   * 実測サンプルのフォト名を渡す（F3 で未指定＝注入しないが既定になったため必須）。
   */
  const GOLDEN_PHOTO_NAMES: string[][] = sampleDeck.characters.map((c) =>
    (c.photos ?? []).map((p) => String(p.name ?? "")),
  );

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
      goldenPhotoNames: GOLDEN_PHOTO_NAMES,
    });
    const res = simulateTimeline({
      ...built.base,
      rng: new NeutralRng(),
      criticalProvider: () => false,
    });
    // 【2026-09-27 Phase 14-F 採用で更新】前ビート満了バフの延長復活を実装した新確定値
    // （旧 2,580,397,520・改ざん復元＋実効N-1 Decay適正化に伴う値）。
    // 根拠: research/26_data_integrity/phase14f_revival_audit.md
    expect(res.totalScore).toBe(2581114209);
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

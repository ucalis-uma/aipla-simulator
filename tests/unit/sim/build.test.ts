/**
 * src/sim/build.ts（CLI / UI 共通ビルダー・Phase 4）の単体テスト。
 * ゴールデン（T5）リプレイは t5-scores.golden.test.ts が同一経路で検証するため
 * ここでは構築ロジックの単位（属性導出・レベル解決・内訳集計・警告/エラー）を検証する。
 */
import { describe, expect, it } from "vitest";
import {
  availableLevels,
  buildSimulateInput,
  laneAttributeOf,
  laneBreakdown,
  type DeckJsonV2,
  type SimSourceData,
} from "../../../src/sim/build.js";
import { simulateTimeline } from "../../../src/timeline/engine.js";
import { NeutralRng } from "../../../src/rng/neutral.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));

const data: SimSourceData = {
  cards: (readJson(path.join(repoRoot, "data/cards.json")) as { cards: never[] }).cards as never,
  cardParameters: (readJson(path.join(repoRoot, "data/card_parameters.json")) as { rows: never[] })
    .rows as never,
  skillsGolden: (readJson(path.join(repoRoot, "data/skills_golden.json")) as { skills: never[] })
    .skills as never,
  stages: {
    "qt-daily-003-19": readJson(path.join(repoRoot, "data/stages/qt-daily-003-19.json")) as never,
  },
  charts: {
    "chart-hsm-004-001": readJson(path.join(repoRoot, "data/charts/chart-hsm-004-001.json")) as never,
  },
  audienceAdvantage: readJson(path.join(repoRoot, "data/stages/audience_advantage.json")) as never,
};

const T5_DECK = readJson(
  path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"),
) as DeckJsonV2;

const MENTAL: Record<string, number> = { 1: 105, 2: 102, 3: 104, 4: 103, 5: 101 };
const MISSED_B1 = [1, 2, 3, 4, 5].map((lane) => ({ beat: 1, lane }));

describe("laneAttributeOf", () => {
  it("qt-daily-003-19（laneAttributes=[2,2,1,2,2]）で L4 のみ dance になる", () => {
    // POSITION_TO_LANE=[3,2,4,1,5]: L4 の position=3 → コード1=dance
    const attrs = [1, 2, 3, 4, 5].map((l) =>
      laneAttributeOf(l as 1, [2, 2, 1, 2, 2]),
    );
    expect(attrs).toEqual(["vocal", "vocal", "vocal", "dance", "vocal"]);
  });

  it("未知の属性コードはエラー", () => {
    expect(() => laneAttributeOf(1, [9, 9, 9, 9, 9])).toThrow();
  });
});

describe("availableLevels", () => {
  it("カードのパラメータ行に存在するレベル列を昇順で返す", () => {
    const levels = availableLevels(data, "card-chs-05-fest-03");
    expect(levels.length).toBeGreaterThan(0);
    expect(levels).toContain(230);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!).toBeGreaterThan(levels[i - 1]!);
    }
  });

  it("存在しないカードは空配列", () => {
    expect(availableLevels(data, "card-not-exist")).toEqual([]);
  });
});

describe("buildSimulateInput", () => {
  const built = buildSimulateInput({
    deck: T5_DECK,
    stageFile: "qt-daily-003-19",
    chartFile: "chart-hsm-004-001",
    data,
    missedNotes: MISSED_B1,
    mentalOverride: MENTAL,
  });

  it("5レーン構築・レーン属性導出・メンタル上書き", () => {
    expect(built.base.lanes).toHaveLength(5);
    expect(built.base.lanes.map((l) => l.attribute)).toEqual([
      "vocal",
      "vocal",
      "vocal",
      "dance",
      "vocal",
    ]);
    expect(built.base.lanes.map((l) => l.deck.mental)).toEqual([105, 102, 104, 103, 101]);
    // T5 実測のデッキ値（research/14）
    expect(built.base.lanes[2]!.deck.vocal).toBe(626223);
    expect(built.base.lanes[3]!.deck.dance).toBe(284769);
  });

  it("警告ゼロ（T5 編成は golden スキルと一致）", () => {
    expect(built.warnings).toEqual([]);
  });

  it("選択カードと golden スキルの元カードが不一致なら警告", () => {
    const swapped: DeckJsonV2 = {
      ...T5_DECK,
      characters: T5_DECK.characters.map((c) =>
        c.lane === 3 ? { ...c, card_id: "card-yu-05-birt-02" } : c,
      ),
    };
    const b2 = buildSimulateInput({
      deck: swapped,
      stageFile: "qt-daily-003-19",
      chartFile: "chart-hsm-004-001",
      data,
    });
    expect(b2.warnings.length).toBeGreaterThan(0);
    expect(b2.warnings[0]).toContain("L3");
  });

  it("disabledSkillIds でスキル/フォトを除外できる", () => {
    const someSkill = built.base.lanes[2]!.skills[0]!.id;
    const somePhoto = built.base.lanes[2]!.photos[0]!.id;
    const b2 = buildSimulateInput({
      deck: T5_DECK,
      stageFile: "qt-daily-003-19",
      chartFile: "chart-hsm-004-001",
      data,
      disabledSkillIds: [someSkill, somePhoto],
    });
    expect(b2.base.lanes[2]!.skills.some((s) => s.id === someSkill)).toBe(false);
    expect(b2.base.lanes[2]!.photos.some((s) => s.id === somePhoto)).toBe(false);
  });

  it("audience 指定でファンファクターをテーブル引きする（16,000→1620‰）", () => {
    const b2 = buildSimulateInput({
      deck: T5_DECK,
      stageFile: "qt-daily-003-19",
      chartFile: "chart-hsm-004-001",
      data,
      audience: 16000,
    });
    expect(b2.base.fanFactorPermil).toBe(1620);
  });

  it("存在しないステージ/チャート/レベルはエラー", () => {
    expect(() =>
      buildSimulateInput({
        deck: T5_DECK,
        stageFile: "no-such-stage",
        chartFile: "chart-hsm-004-001",
        data,
      }),
    ).toThrow(/stage not found/);
    expect(() =>
      buildSimulateInput({
        deck: T5_DECK,
        stageFile: "qt-daily-003-19",
        chartFile: "no-such-chart",
        data,
      }),
    ).toThrow(/chart not found/);
    expect(() =>
      buildSimulateInput({
        deck: { ...T5_DECK, characters: T5_DECK.characters.map((c) => ({ ...c, level: 9999 })) },
        stageFile: "qt-daily-003-19",
        chartFile: "chart-hsm-004-001",
        data,
      }),
    ).toThrow(/card parameter not found/);
  });

  it("確定値ラン（NeutralRng・crit なし）が完了し、レーン内訳の合計が総スコアと一致", () => {
    const res = simulateTimeline({
      ...built.base,
      rng: new NeutralRng(),
      criticalProvider: () => false,
    });
    const breakdown = laneBreakdown(res.beats);
    expect(breakdown.reduce((s, l) => s + l.total, 0)).toBe(res.totalScore);
    expect(breakdown).toHaveLength(5);
    // 全イベントに sourceKind が付与されている
    for (const bt of res.beats) {
      for (const e of bt.events) {
        expect(["beat", "A", "SP", "P", "photo"]).toContain(e.sourceKind);
      }
    }
  });
});

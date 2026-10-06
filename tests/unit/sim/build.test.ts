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
import { ContinuousRng } from "../../../src/rng/random.js";
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
  skillsByCard: (readJson(path.join(repoRoot, "data/skills_master.json")) as {
    byCard: Record<string, never[]>;
  }).byCard as never,
};

const T5_DECK = readJson(
  path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json"),
) as DeckJsonV2;

const MENTAL: Record<string, number> = { 1: 105, 2: 102, 3: 104, 4: 103, 5: 101 };
const MISSED_B1 = [1, 2, 3, 4, 5].map((lane) => ({ beat: 1, lane }));
/**
 * 【Phase 16-A9c F3】golden フォトスキル（photo-L*）注入ゲートに渡す T5 実測フォト名。
 * F3 でゲートの既定が「未指定＝注入しない」になったため、T5 実測経路を再現する呼び出しは
 * 名前を明示する（CLI `loadGoldenPhotoNames()` / UI `GOLDEN_PHOTO_NAMES` と同一）。
 */
const T5_GOLDEN_PHOTO_NAMES: string[][] = T5_DECK.characters.map((c) =>
  (c.photos ?? []).map((p) => String(p.name ?? "")),
);

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
    goldenPhotoNames: T5_GOLDEN_PHOTO_NAMES,
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

  it("選択カードにマスタスキル（skillsByCard）があればそちらを使用する（Phase 6）", () => {
    // golden は fest-03 のスキル。birt カードに差し替えると golden スキルではなく
    // マスタ解析スキル（sk-yu-05-birt-02-*）が L3 にセットされる
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
      mentalOverride: MENTAL,
    });
    const l3 = b2.base.lanes[2]!;
    expect(l3.skills.length).toBeGreaterThan(0);
    for (const s of l3.skills) {
      expect(s.id.startsWith("sk-yu-05-birt-02")).toBe(true);
      expect(s.lane).toBe(3);
    }
    // 元カード一致の golden スキルは存在しないため不一致警告は出ない
    expect(b2.warnings).toEqual([]);
  });

  it("skillsByCard が無いデータでは golden スキルにフォールバックし不一致を警告する（旧動作）", () => {
    const dataNoMaster: SimSourceData = { ...data, skillsByCard: undefined };
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
      data: dataNoMaster,
    });
    // golden スキル（fest-03 のもの）がレーンのまま使われ、元カード不一致の警告が出る
    expect(b2.base.lanes[2]!.skills.length).toBeGreaterThan(0);
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

  // 【Phase 16-A4・2026-09-30】レーン別来場数モード（満員ガード付き）。
  // レーン別来場数は fan.png 実測（research/23_beat_score_analysis/tmp_lane_fans_out.txt）。
  // 未指定時は従来の単一 audience / fanFactorPermil 経路を完全互換で維持する。
  describe("laneFans（レーン別来場数・満員ガード付き）", () => {
    it("満員（S3: 合計 40,000 = cap）は全レーン一律 f(cap/5)=1375‰ を注入する", () => {
      const b = buildSimulateInput({
        deck: T5_DECK,
        stageFile: "qt-daily-003-19",
        chartFile: "chart-hsm-004-001",
        data,
        laneFans: [8515, 7748, 8535, 8518, 6684],
        maxCapacity: 40000,
      });
      expect(b.base.laneFanFactorPermil).toEqual([1375, 1375, 1375, 1375, 1375]);
      expect(b.base.fanFactorPermil).toBe(1375);
      expect(b.warnings.some((w) => w.includes("満員: 全レーン一律"))).toBe(true);
      // 満員ガードがないと L5 が 1342‰（−2.4%）へ後退することを同時に固定
      expect(b.base.laneFanFactorPermil?.[4]).not.toBe(1342);
    });

    it("空席（S2: 合計 66,031 < cap 70,000）はレーン別表引きを注入する", () => {
      const b = buildSimulateInput({
        deck: T5_DECK,
        stageFile: "qt-daily-003-19",
        chartFile: "chart-hsm-004-001",
        data,
        laneFans: [11996, 13543, 13741, 13255, 13496],
        maxCapacity: 70000,
      });
      expect(b.base.laneFanFactorPermil).toEqual([1539, 1570, 1574, 1565, 1569]);
      // 参考値（レーン平均）は単一 audience 13,206 → 1564‰ 相当の近似値
      expect(b.base.fanFactorPermil).toBe(1563);
      expect(b.warnings.some((w) => w.includes("空席: レーン別表引き"))).toBe(true);
    });

    it("laneFans 未指定時は laneFanFactorPermil を付与しない（従来経路＝完全互換）", () => {
      const legacy = buildSimulateInput({
        deck: T5_DECK,
        stageFile: "qt-daily-003-19",
        chartFile: "chart-hsm-004-001",
        data,
        audience: 16000,
      });
      expect(legacy.base.laneFanFactorPermil).toBeUndefined();
      expect(legacy.base.fanFactorPermil).toBe(1620);
    });

    it("laneFans の要素数不足・不正値はエラー", () => {
      expect(() =>
        buildSimulateInput({
          deck: T5_DECK,
          stageFile: "qt-daily-003-19",
          chartFile: "chart-hsm-004-001",
          data,
          laneFans: [1000, 1000, 1000, 1000],
          maxCapacity: 5000,
        }),
      ).toThrow();
      expect(() =>
        buildSimulateInput({
          deck: T5_DECK,
          stageFile: "qt-daily-003-19",
          chartFile: "chart-hsm-004-001",
          data,
          laneFans: [1000, 1000, 1000, 1000, -1],
          maxCapacity: 5000,
        }),
      ).toThrow();
    });

    it("組み上げたレーン別ファンファクターがビートスコアへ適用される（満員ガード vs 素朴表引き）", () => {
      const l5BeatTotal = (opts: { laneFans: number[]; maxCapacity?: number }): number => {
        const b = buildSimulateInput({
          deck: T5_DECK,
          stageFile: "qt-daily-003-19",
          chartFile: "chart-hsm-004-001",
          data,
          ...opts,
        });
        const res = simulateTimeline({
          ...b.base,
          rng: new NeutralRng(),
          criticalProvider: () => false,
        });
        return res.beats
          .flatMap((bt) => bt.events)
          .filter((e) => e.lane === 5 && e.sourceKind === "beat")
          .reduce((sum, e) => sum + e.gainedScore, 0);
      };
      const laneFans = [8515, 7748, 8535, 8518, 6684]; // S3（合計 40,000）
      const guarded = l5BeatTotal({ laneFans, maxCapacity: 40000 }); // 満員 → 1375‰
      const naive = l5BeatTotal({ laneFans }); // 満員ガードなし → 1342‰（−2.4%）
      expect(guarded).toBeGreaterThan(naive);
      // L5 のビートスコア比がファンファクター比（1375/1342）に一致する
      expect(guarded / naive).toBeCloseTo(1375 / 1342, 2);
    });
  });

  it("baseCritRate を SimulateInput へ透過する（Peing確定・動的クリティカル用）", () => {
    const withRate = buildSimulateInput({
      deck: T5_DECK,
      stageFile: "qt-daily-003-19",
      chartFile: "chart-hsm-004-001",
      data,
      baseCritRate: 0.5,
    });
    expect(withRate.base.baseCritRate).toBe(0.5);
    // 未指定時は undefined（criticalProvider フォールバック）
    const withoutRate = buildSimulateInput({
      deck: T5_DECK,
      stageFile: "qt-daily-003-19",
      chartFile: "chart-hsm-004-001",
      data,
    });
    expect(withoutRate.base.baseCritRate).toBeUndefined();
  });

  it("baseCritRate=0.5 の動的モードで MC 相当ランが完走し crit が発生する", () => {
    const b2 = buildSimulateInput({
      deck: T5_DECK,
      stageFile: "qt-daily-003-19",
      chartFile: "chart-hsm-004-001",
      data,
      baseCritRate: 0.5,
      missedNotes: MISSED_B1,
      mentalOverride: MENTAL,
    });
    const res = simulateTimeline({
      ...b2.base,
      rng: new ContinuousRng(3),
      criticalProvider: () => false,
    });
    const critEvents = res.beats.flatMap((bt) => bt.events).filter((e) => e.critFactorPermil > 1000);
    // 基礎50%で156ビート×5レーン相当の抽選 → crit ゼロはほぼ起きない
    expect(critEvents.length).toBeGreaterThan(10);
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

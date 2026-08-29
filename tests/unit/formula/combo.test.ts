/**
 * combo.ts 単体テスト。
 *
 * 出典: research/07 §3（ComboAdvantage.json 全7行・Confirmed）、
 *       PLAN.md §3.3 / research/02 §1.7（コンボスコア上昇の乗算方式）、
 *       research/01 §3.4（表記揺れの対立記録）。
 */
import { describe, expect, it } from "vitest";
import {
  COMBO_ADVANTAGE_TABLE,
  baseComboBonusPermil,
  comboFactorPermil,
} from "../../../src/formula/combo.js";
import { mulPermil } from "../../../src/rounding.js";
import { readUnitJson } from "../helpers.js";

interface ComboRowJson {
  combo: number;
  advantagePermil: number;
}

describe("COMBO_ADVANTAGE_TABLE（既定テーブル）", () => {
  it("data/stages/combo_advantage.json と完全一致する（同期担保）", () => {
    const file = readUnitJson<ComboRowJson[]>("data/stages/combo_advantage.json");
    expect(COMBO_ADVANTAGE_TABLE).toEqual(file);
  });

  it("7行・閾値昇順・全行が合計係数（1000 + ボーナス）形式", () => {
    expect(COMBO_ADVANTAGE_TABLE).toHaveLength(7);
    for (let i = 0; i < COMBO_ADVANTAGE_TABLE.length; i++) {
      const row = COMBO_ADVANTAGE_TABLE[i];
      expect(row).toBeDefined();
      expect(row?.advantagePermil).toBeGreaterThanOrEqual(1000);
      if (i > 0) {
        expect(row?.combo).toBeGreaterThan(COMBO_ADVANTAGE_TABLE[i - 1]?.combo ?? 0);
      }
    }
  });
});

describe("baseComboBonusPermil（基本コンボボーナス・増分‰）", () => {
  it.each([
    [0, 0],
    [1, 0],
    [9, 0],
    [10, 50],
    [19, 50],
    [20, 100],
    [29, 100],
    [30, 150],
    [39, 150],
    [40, 200],
    [49, 200],
    [50, 250],
    [69, 250],
    [70, 300],
    [99, 300],
    [100, 500],
    [155, 500],
    [999, 500],
  ])("combo=%i → %i‰", (combo, expected) => {
    expect(baseComboBonusPermil(combo)).toBe(expected);
  });

  it("閾値は「コンボ数が行の値以上のとき適用」（research/07 §3・コンボ155→+50%実測確認）", () => {
    expect(baseComboBonusPermil(99)).toBe(300);
    expect(baseComboBonusPermil(100)).toBe(500);
  });

  it("テーブル注入が効く", () => {
    const custom = [{ combo: 5, advantagePermil: 1100 }];
    expect(baseComboBonusPermil(4, custom)).toBe(0);
    expect(baseComboBonusPermil(5, custom)).toBe(100);
    expect(baseComboBonusPermil(155, custom)).toBe(100);
  });

  it.each([-1, 1.5])("不正な combo=%j は throw", (combo) => {
    expect(() => baseComboBonusPermil(combo)).toThrow();
  });
});

describe("comboFactorPermil（コンボファクター）", () => {
  // ============================================================
  // 【乗算方式の記録 — research/02 との差異（ゴールデン段階で最終判定）】
  //
  // 実装したのは PLAN.md §3.3 の確定式:
  //   factor = (1 + 基本ボーナス) × (1 + 10% × コンボスコア上昇段)
  //          = mulPermil(1000 + baseComboBonusPermil, 1000 + 100×段)
  //
  // コンボ155（実測最終ビート156のAスキル検算, research/02 §3.3）での候補値:
  //   (A) ×6.0 = mulPermil(1500, 4000) … 本実装（30段）。
  //       research/02 §3.3 が採用した値で、実測 1,708,961,981 に対し
  //       乱数 r = 97.7% と ±5% 内に収まる【有力】。
  //   (B) ×3.0 = 1 + 0.5×(1+3.0) … research/01 §3.4 の例記述「+50%×3=+150%」
  //       （ボーナス増分だけに乗算する読み）。この説だとビート156の乱数が
  //       r≈0.49 となり ±5% を大きく外れるため非有力。
  //   (C) ×10.0 = mulPermil(2500, 4000) = (1+1.5)×(1+3.0) … タスク指示に記載の
  //       検証値。テーブルの合計係数 1500‰ を「ボーナス」と誤認して二重加算した
  //       値であり、PLAN §3.3 の式と不整合のため本実装では採用しない。
  //       ゴールデンテストで実測と突合し、もし (C) でしか合わない場合は
  //       式の見直し（テーブル値の解釈変更）を要する。
  //   (C') ×7.5 = mulPermil(2500, 3000) = (1+1.5)×(1+2.0) … 同じく二重加算
  //       （20段版）。タスク指示文中の「(1+1.5)×(1+2.0) = 7.5」はこれ。
  //   (A') ×4.5 = mulPermil(1500, 3000) … 本実装の 20段（基本上限）値。
  //
  // research/01 §3.4 内の対立（[T1]「20段で2.5倍」vs [S1]「20段=3倍係数」）は
  // research/01 が「[S1] の数値表を正とする」と結論済み（§3.4・§5-7）。
  // Phase 2 の完了条件（3点検算が乱数レンジ内）はゴールデン段階で (A) を支持する。
  // ============================================================
  it("combo=155, stages=30 → 6000（×6.0・PLAN §3.3 式。×10.0/×7.5 は二重加算の誤り・上記コメント参照）", () => {
    expect(comboFactorPermil(155, 30)).toBe(mulPermil(1500, 4000));
    expect(comboFactorPermil(155, 30)).toBe(6000);
  });

  it("combo=155, stages=20 → 4500（×4.5・基本上限）", () => {
    expect(comboFactorPermil(155, 20)).toBe(4500);
  });

  it("combo=155, stages=0 → 1500（バフなし＝基本ボーナスのみ）", () => {
    expect(comboFactorPermil(155, 0)).toBe(1500);
  });

  it("combo=0, stages=0 → 1000（ボーナスなし）", () => {
    expect(comboFactorPermil(0, 0)).toBe(1000);
  });

  it("combo=10, stages=1 → 1155（mulPermil(1050,1100)・整数演算）", () => {
    expect(comboFactorPermil(10, 1)).toBe(mulPermil(1050, 1100));
    expect(comboFactorPermil(10, 1)).toBe(1155);
  });

  it("combo=100, stages=30 → 6000（上限解放30段）", () => {
    expect(comboFactorPermil(100, 30)).toBe(6000);
  });

  it("テーブル注入が効く", () => {
    const custom = [{ combo: 5, advantagePermil: 1100 }];
    expect(comboFactorPermil(5, 2, custom)).toBe(mulPermil(1100, 1200));
    expect(comboFactorPermil(5, 2, custom)).toBe(1320);
  });

  it.each([[-1], [1.5]])("不正な stages=%j は throw", (stages) => {
    expect(() => comboFactorPermil(10, stages)).toThrow();
  });
});

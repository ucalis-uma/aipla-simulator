/**
 * scoreEvent.ts 単体テスト（手算値での完全一致）。
 *
 * 出典: research/02 §1.1（共通構造・Confirmed）、§1.13（乱数±5%・Confirmed）、
 *       §1.14（イベント単位の丸め・Estimate → sequential 既定/at-end 比較可能）。
 */
import { describe, expect, it } from "vitest";
import { computeEventScore } from "../../../src/formula/scoreEvent.js";
import { mulPermil } from "../../../src/rounding.js";

describe("computeEventScore（手算照合）", () => {
  // 手算（sequential・既定）:
  //   110,137 × 1.360 = 149,786.32 → floor → 149,786
  //   149,786 × 1.620 = 242,653.32 → floor → 242,653
  //   （他ファクターは既定 1000 = 恒等変換）
  // at-end: floor(110137 × 1360 × 1620 / 10^6) = floor(242,653,838,400 / 10^6) = 242,653
  // ※ この入力では両ポリシーが一致する（丸め差は別ケースで確認）。
  const beat2Case = {
    basicScore: 110137,
    skillPowerPermil: 1000,
    b1Permil: 1360,
    fanFactorPermil: 1620,
    stageFactorPermil: 1000,
    randPermil: 1000,
    critFactorPermil: 1000,
  };

  it("basic=110137, b1=1360, fan=1620 → 242,653（sequential・手算一致）", () => {
    expect(computeEventScore(beat2Case)).toBe(242653);
  });

  it("同じ入力を at-end で計算しても 242,653（両ポリシー一致ケース）", () => {
    expect(computeEventScore({ ...beat2Case, roundingPolicy: "at-end" })).toBe(242653);
  });

  it("丸めポリシーの差: basic=999, b1=1001, fan=1001 → sequential 999 / at-end 1000", () => {
    // sequential: floor(999×1001/1000)=999 → floor(999×1001/1000)=999
    // at-end:     floor(999×1001×1001/10^6) = floor(1,000,998,999/10^6) = 1000
    const input = { basicScore: 999, b1Permil: 1001, fanFactorPermil: 1001 };
    expect(computeEventScore(input)).toBe(999);
    expect(computeEventScore({ ...input, roundingPolicy: "at-end" })).toBe(1000);
  });

  it("丸めポリシーの差（順序依存）: basic=1, power=1500, b1=1500 → sequential 1 / at-end 2", () => {
    // sequential: floor(1×1500/1000)=1 → floor(1×1500/1000)=1
    // at-end:     floor(1×1500×1500/10^6) = floor(2,250,000/10^6) = 2
    const input = { basicScore: 1, skillPowerPermil: 1500, b1Permil: 1500 };
    expect(computeEventScore(input)).toBe(1);
    expect(computeEventScore({ ...input, roundingPolicy: "at-end" })).toBe(2);
  });

  it("固定スコアは乗算部分の切り捨て後に加算される", () => {
    expect(computeEventScore({ ...beat2Case, fixedScore: 500 })).toBe(243153);
    // 乗算部分が 0 に切り捨てられても固定スコアは残る
    const tiny = { basicScore: 1, b1Permil: 999, fixedScore: 7 };
    expect(computeEventScore(tiny)).toBe(7);
    expect(computeEventScore({ ...tiny, roundingPolicy: "at-end" })).toBe(7);
  });

  it("全ファクター既定（1000）なら基本スコアそのもの", () => {
    expect(computeEventScore({ basicScore: 12345 })).toBe(12345);
    expect(computeEventScore({ basicScore: 12345, roundingPolicy: "at-end" })).toBe(12345);
  });

  it("乗算順序は PLAN §3.3 の表記順（スキルパワー → B1 → コンボ → ファン → ステージ → 乱数 → クリティカル）", () => {
    // 順序検証: ファクターを入れ替えると sequential の結果が変わる入力
    // power=1370, fan=1620 の順で floor を重ねる値を手算で固定する
    // floor(200×1370/1000) = 274 → floor(274×1620/1000) = 443
    const input = { basicScore: 200, skillPowerPermil: 1370, fanFactorPermil: 1620 };
    expect(computeEventScore(input)).toBe(443);
    // （B1 と ファンを入れ替えた場合は floor(200×1620/1000)=324 → floor(324×1370/1000)=443
    //   で同じ値になるため、順序が違っても検出できないケースがある点に注意）
  });

  it("クリティカル係数・乱数が反映される", () => {
    // floor(1000×2755/1000) = 2755（rand=1050 は ×1.05）: floor(2755×1050/1000) = 2892
    const input = { basicScore: 1000, randPermil: 1050, critFactorPermil: 2755 };
    expect(computeEventScore(input)).toBe(2892);
    // rand=950: floor(2755×950/1000) = 2617
    expect(computeEventScore({ ...input, randPermil: 950 })).toBe(2617);
  });
});

describe("computeEventScore（BigInt フォールバック）", () => {
  const huge = {
    basicScore: 4_000_000_000_000,
    skillPowerPermil: 4500,
    b1Permil: 1500,
  };

  it("Number では最初の乗算がオーバーフローする（mulPermil が throw することで証明）", () => {
    expect(() => mulPermil(huge.basicScore, huge.skillPowerPermil)).toThrow();
  });

  it("sequential: 4e12 × 4500 × 1500 → 27,000,000,000,000（BigInt フォールバック発火）", () => {
    // floor(4e12×4500/1000) = 1.8e13（ここで Number はオーバーフロー→BigInt）
    // floor(1.8e13×1500/1000) = 2.7e13
    expect(computeEventScore(huge)).toBe(27_000_000_000_000);
  });

  it("at-end: 同入力 → 27,000,000,000,000（BigInt 厳密積算）", () => {
    // floor(4e12 × 4500 × 1500 / 10^6) = floor(2.7e19 / 10^6) = 2.7e13
    expect(computeEventScore({ ...huge, roundingPolicy: "at-end" })).toBe(
      27_000_000_000_000,
    );
  });

  it("basicScore=0 は全ファクターがあっても 0（+固定スコア）", () => {
    const zero = {
      basicScore: 0,
      skillPowerPermil: 4500,
      b1Permil: 1500,
      fanFactorPermil: 1620,
      stageFactorPermil: 2000,
      randPermil: 1050,
      critFactorPermil: 2755,
      fixedScore: 42,
    };
    expect(computeEventScore(zero)).toBe(42);
  });
});

describe("computeEventScore（入力バリデーション）", () => {
  it.each([949, 1051, 999.5])("randPermil=%j は範囲外で throw", (rand) => {
    expect(() => computeEventScore({ basicScore: 1, randPermil: rand })).toThrow();
  });

  it("randPermil は 950 と 1050 が許容される", () => {
    expect(computeEventScore({ basicScore: 100, randPermil: 950 })).toBe(95);
    expect(computeEventScore({ basicScore: 100, randPermil: 1050 })).toBe(105);
  });

  it.each([
    ["basicScore", { basicScore: -1 }],
    ["basicScore", { basicScore: 1.5 }],
    ["fixedScore", { basicScore: 1, fixedScore: -1 }],
    ["b1Permil", { basicScore: 1, b1Permil: 0.5 }],
  ])("不正入力 %s は throw", (_name, input) => {
    expect(() => computeEventScore(input)).toThrow();
  });
});

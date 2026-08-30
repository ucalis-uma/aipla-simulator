/**
 * スコアイベント共通構造（ビート / A / SP / P 通常型に共通）。
 *
 *   イベントスコア = 基本スコア × スキルパワー × B1 × コンボ × ファン × ステージ
 *                    × 乱数 × クリティカル + 固定スコア
 *
 * 出典:
 * - 構造: research/02 §1.1（S2/S1/S4 で同型）【Confirmed】。PLAN.md §3.3 も同一。
 *   B1 = 対象スコアボーナス（100% + 各種上昇バフ + テンション + エール/フォト% の加算合算）。
 *   乗算順序は PLAN.md §3.3 の表記順（スキルパワー → B1 → コンボ → ファン → ステージ → 乱数 → クリティカル）。
 * - スコア乱数 ±5%（950〜1050‰・0.1%刻み・101択・イベント毎）【Confirmed】（research/02 §1.13）。
 * - 丸め位置【Estimate】（research/02 §1.14: 「イベントごとに整数化（floor）してから累積」は
 *   S4 実装からの推定で S2 に明記なし）:
 *   - "sequential"（既定）: 各乗算のたびに 1000 で割って切り捨てる（research/02 §1.14 Estimate）。
 *   - "at-end": 全乗算を厳密に行い最後に一度だけ切り捨てる（比較・検証用の代替ポリシー）。
 *   どちらがゲーム本体と一致するかはゴールデンテスト（T4/T5）で判定する。
 * - 割合型スキル（コンボ/ファン不適用）は呼び出し側で comboFactorPermil/fanFactorPermil を
 *   省略（=1000）することで表現する（research/02 §1.4【Strong estimate】）。
 *
 * 数値規律:
 * - 全演算は千分率整数演算（src/rounding.ts を経由。本モジュールで Math.floor は使わない）。
 * - sequential では乗算途中が Number.MAX_SAFE_INTEGER を超えた場合、BigInt にフォールバックする
 *   （mulPermilBig を利用。最終値が 2^53 を超える場合は Number 変換で精度が落ちるが、
 *    実スコアの範囲（〜10^12 程度）では発生しない）。
 * - at-end は厳密性を優先し常に BigInt で積算してから一度だけ切り捨てる
 *   （Number の浮動小数除算では巨大積の境界で誤差が出得るため）。
 */
import { floorDiv, mulPermilBig } from "../rounding.js";
import {
  SCORE_ROLL_MAX_PERMIL,
  SCORE_ROLL_MIN_PERMIL,
} from "../rng/types.js";

/** イベント単位の丸めポリシー（research/02 §1.14: 採用値は Estimate・ゴールデンで判定） */
export type RoundingPolicy = "sequential" | "at-end";

/** スコア乱数の許容範囲（±5%・Confirmed）: 950〜1050‰ */
export const EVENT_RAND_MIN_PERMIL = SCORE_ROLL_MIN_PERMIL;
export const EVENT_RAND_MAX_PERMIL = SCORE_ROLL_MAX_PERMIL;

/** スコア乱数の選択肢数（0.1%刻み・101択・離散一様。research/02 §1.13） */
export const EVENT_RAND_CHOICES = SCORE_ROLL_MAX_PERMIL - SCORE_ROLL_MIN_PERMIL + 1;

/** computeEventScore の入力（省略時の既定値は各フィールドの JSDoc 参照） */
export interface EventScoreInput {
  /** 基本スコア（ビート: Σ重み込みステータス / A・SP・P: レーン色ライブ中ステータス / 割合型: 対象累積スコア×SkillPower） */
  basicScore: number;
  /** スキルパワー permil（例「450%」→ 4500）。既定 1000（ビートでは 1 倍で不使用） */
  skillPowerPermil?: number;
  /** B1: 対象スコアボーナス permil（エール/フォト/バフ合算込み・既定 1000） */
  b1Permil?: number;
  /** コンボファクター permil（既定 1000 = 不適用・割合型） */
  comboFactorPermil?: number;
  /** ファンファクター permil（既定 1000 = 不適用・割合型） */
  fanFactorPermil?: number;
  /** ステージファクター permil（ライブ固有倍率。既定 1000） */
  stageFactorPermil?: number;
  /** スコア乱数 permil（950〜1050・既定 1000） */
  randPermil?: number;
  /** クリティカル係数 permil（非発生時 1000・発生時 criticalFactorPermil() の値。既定 1000） */
  critFactorPermil?: number;
  /** 固定スコア（フォト等。乗算結果の切り捨て後に加算。既定 0） */
  fixedScore?: number;
  /** 丸めポリシー（既定 "sequential"） */
  roundingPolicy?: RoundingPolicy;
}

function requireNonNegInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${value}`);
  }
}

/** 乗算に参加するファクター列（PLAN.md §3.3 の表記順） */
function factorList(input: {
  skillPowerPermil: number;
  b1Permil: number;
  comboFactorPermil: number;
  fanFactorPermil: number;
  stageFactorPermil: number;
  randPermil: number;
  critFactorPermil: number;
}): [number, number, number, number, number, number, number] {
  return [
    input.skillPowerPermil,
    input.b1Permil,
    input.comboFactorPermil,
    input.fanFactorPermil,
    input.stageFactorPermil,
    input.randPermil,
    input.critFactorPermil,
  ];
}

/**
 * スコアイベント1点分を計算する（純粋関数）。
 *
 * @param input スコアイベントの入力
 * @returns イベントスコア（非負整数。乗算部分を切り捨てた後に固定スコアを加算）
 */
export function computeEventScore(input: EventScoreInput): number {
  const {
    basicScore,
    skillPowerPermil = 1000,
    b1Permil = 1000,
    comboFactorPermil = 1000,
    fanFactorPermil = 1000,
    stageFactorPermil = 1000,
    randPermil = 1000,
    critFactorPermil = 1000,
    fixedScore = 0,
    roundingPolicy = "sequential",
  } = input;

  requireNonNegInt(basicScore, "basicScore");
  requireNonNegInt(skillPowerPermil, "skillPowerPermil");
  requireNonNegInt(b1Permil, "b1Permil");
  requireNonNegInt(comboFactorPermil, "comboFactorPermil");
  requireNonNegInt(fanFactorPermil, "fanFactorPermil");
  requireNonNegInt(stageFactorPermil, "stageFactorPermil");
  requireNonNegInt(critFactorPermil, "critFactorPermil");
  requireNonNegInt(fixedScore, "fixedScore");
  if (
    !Number.isFinite(randPermil) ||
    randPermil < EVENT_RAND_MIN_PERMIL ||
    randPermil > EVENT_RAND_MAX_PERMIL
  ) {
    throw new Error(
      `randPermil must be a finite number in [${EVENT_RAND_MIN_PERMIL}, ${EVENT_RAND_MAX_PERMIL}], got ${randPermil}`,
    );
  }

  const factors = factorList({
    skillPowerPermil,
    b1Permil,
    comboFactorPermil,
    fanFactorPermil,
    stageFactorPermil,
    randPermil,
    critFactorPermil,
  });

  const multiplied =
    roundingPolicy === "at-end"
      ? multiplyAtEnd(basicScore, factors)
      : multiplySequential(basicScore, factors);

  return multiplied + fixedScore;
}

/**
 * sequential: 各乗算の後に 1000 で割って切り捨てる。
 * 乗算途中が安全整数を超えたら BigInt にフォールバックする。
 */
function multiplySequential(basicScore: number, factors: readonly number[]): number {
  let isBig = false;
  let value = basicScore;
  let valueBig = 0n;
  for (const permil of factors) {
    if (!Number.isInteger(permil)) {
      // 連続乱数（float）ステップ: float64 で計算（値域は安全整数内）
      if (!isBig) {
        value = Math.floor((value * permil) / 1000);
      } else {
        value = Number(valueBig) >= 0 ? Math.floor((Number(valueBig) * permil) / 1000) : 0;
        isBig = false;
        valueBig = 0n;
      }
      continue;
    }
    if (!isBig) {
      const product = value * permil;
      if (Number.isSafeInteger(product)) {
        value = floorDiv(product, 1000);
      } else {
        isBig = true;
        valueBig = mulPermilBig(BigInt(value), BigInt(permil));
      }
    } else {
      valueBig = mulPermilBig(valueBig, BigInt(permil));
    }
  }
  return isBig ? Number(valueBig) : value;
}

/**
 * at-end: 全ファクターを厳密に積算し、最後に 1000^n で切り捨てる。
 *
 * T5確定: ゲーム本体はこの方式（最終floorのみ）。sequential では crit 係数との
 * 二重 floor により約21.5%の目標値が到達不能になり（b156で実際に発生）、
 * 実測と矛盾するため。連続乱数（float）ステップは float64 で積算する
 * （ BigInt 基数の相対誤差 2^-53 ≪ score 刻みで floor 結果は不変）。
 */
function multiplyAtEnd(basicScore: number, factors: readonly number[]): number {
  let numerator = BigInt(basicScore);
  let denominator = 1n;
  let floatMul = 1;
  for (const permil of factors) {
    if (Number.isInteger(permil)) {
      numerator *= BigInt(permil);
      denominator *= 1000n;
    } else {
      floatMul *= permil / 1000;
    }
  }
  if (floatMul === 1) {
    return Number(numerator / denominator);
  }
  return Math.floor((Number(numerator) * floatMul) / Number(denominator));
}

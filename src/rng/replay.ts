/**
 * 実測系列のリプレイ RNG（ゴールデンテスト Mode R 用）。
 *
 * research/06_test_plan.md §T4/T5: 実測のスコア乱数・クリティカル列を注入し、
 * 非乱数ロジック（バフ・CT・スタミナ・コンボ・発動順）を累積完全一致で検証する。
 *
 * 契約:
 * - rolls / crits を先頭から順に消費する（roll と crit は独立した列）。
 * - 枯渇した呼び出しは即座に throw（fail-closed。黙って 0 を返さない）。
 * - 不正値（範囲外の roll・boolean 以外）はコンストラクタで検出して throw する。
 */
import {
  SCORE_ROLL_MAX_PERMIL,
  SCORE_ROLL_MIN_PERMIL,
  type ScoreRng,
} from "./types.js";

export class ReplayRng implements ScoreRng {
  private rollIndex = 0;
  private critIndex = 0;

  constructor(
    private readonly rolls: readonly number[],
    private readonly crits: readonly boolean[],
  ) {
    for (let i = 0; i < rolls.length; i++) {
      const roll = rolls[i];
      if (
        roll === undefined ||
        !Number.isInteger(roll) ||
        roll < SCORE_ROLL_MIN_PERMIL ||
        roll > SCORE_ROLL_MAX_PERMIL
      ) {
        throw new Error(
          `ReplayRng: rolls[${i}] must be an integer in [${SCORE_ROLL_MIN_PERMIL}, ${SCORE_ROLL_MAX_PERMIL}], got ${roll}`,
        );
      }
    }
    for (let i = 0; i < crits.length; i++) {
      if (typeof crits[i] !== "boolean") {
        throw new Error(`ReplayRng: crits[${i}] must be a boolean, got ${crits[i]}`);
      }
    }
  }

  nextScoreRoll(): number {
    const roll = this.rolls[this.rollIndex];
    if (roll === undefined) {
      throw new Error(
        `ReplayRng: score rolls exhausted (consumed ${this.rollIndex} of ${this.rolls.length})`,
      );
    }
    this.rollIndex++;
    return roll;
  }

  nextCritical(): boolean {
    const crit = this.crits[this.critIndex];
    if (typeof crit !== "boolean") {
      throw new Error(
        `ReplayRng: critical flags exhausted (consumed ${this.critIndex} of ${this.crits.length})`,
      );
    }
    this.critIndex++;
    return crit;
  }

  /**
   * 動的クリティカル抽選用の一様実数。リプレイは実測 crit 列の注入が目的のため
   * fail-closed（呼ばれたら契約違反として throw）。
   */
  nextFloat(): number {
    throw new Error(
      "ReplayRng: nextFloat() is not supported — replay mode injects measured crit flags via criticalProvider",
    );
  }
}

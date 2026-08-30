/**
 * 境界 RNG（レンジ照合用）。
 *
 * research/06_test_plan.md Mode D: Min/Max で「min ≤ 実測 ≤ max」を検証する。
 * - MinRng: スコア乱数 950（−5%）固定・クリティカル非発生
 * - MaxRng: スコア乱数 1050（+5%）固定・クリティカル常に発生
 */
import { SCORE_ROLL_MAX_PERMIL, SCORE_ROLL_MIN_PERMIL, type ScoreRng } from "./types.js";

/** 常に最小値を返す RNG（950 / 非クリティカル / nextFloat=0） */
export class MinRng implements ScoreRng {
  nextScoreRoll(): number {
    return SCORE_ROLL_MIN_PERMIL;
  }

  nextCritical(): boolean {
    return false;
  }

  nextFloat(): number {
    return 0;
  }
}

/** 常に最大値を返す RNG（1050 / 常にクリティカル / nextFloat=最大） */
export class MaxRng implements ScoreRng {
  nextScoreRoll(): number {
    return SCORE_ROLL_MAX_PERMIL;
  }

  nextCritical(): boolean {
    return true;
  }

  nextFloat(): number {
    return 1 - Number.EPSILON;
  }
}

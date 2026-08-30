/**
 * シード決定論の連続値スコア乱数源（Phase 4: モンテカルロ用）。
 *
 * 【T5確定】スコア乱数は連続値 float ∈ [0.95, 1.05]（rng/types.ts 参照）。
 * mulberry32（32ビット PRNG・FixedRng と同一実装）の出力 u32 を
 * `950 + u32 / 2^32 × 100` で [950, 1050] の連続値へ写像する
 * （u32/2^32 は倍精度で誤差なく表現できるため決定論的）。
 *
 * クリティカル: 動的モード（SimulateInput.baseCritRate・Peing確定式）では
 * nextFloat() が使われる。critProbability 注入式（nextCritical）は
 * 確率/成功率ゲート用に残置（既定 0）。
 */
import { floorOf } from "../rounding.js";
import { SCORE_ROLL_MIN_PERMIL, type ScoreRng } from "./types.js";

/** スコア乱数の幅（1050 − 950 = 100 permil） */
const ROLL_WIDTH_PERMIL = 100;
/** 2^32（u32 出力を [0,1) 実数に正規化する分母） */
const TWO_POW_32 = 4294967296;

function mulberry32U32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * シード決定論の連続値 RNG。
 *
 * @param seed 任意の整数（内部的に >>> 0 で正規化）。同一シードは常に同一系列を返す
 * @param critProbability クリティカル発生確率（0〜1。既定 0。発生確率の式は Unknown のため注入式）
 */
export class ContinuousRng implements ScoreRng {
  private readonly nextU32: () => number;
  private readonly critThreshold: number;

  constructor(seed: number, critProbability = 0) {
    if (!Number.isInteger(seed)) {
      throw new Error(`ContinuousRng: seed must be an integer, got ${seed}`);
    }
    if (!Number.isFinite(critProbability) || critProbability < 0 || critProbability > 1) {
      throw new Error(
        `ContinuousRng: critProbability must be in [0, 1], got ${critProbability}`,
      );
    }
    this.nextU32 = mulberry32U32(seed);
    this.critThreshold = floorOf(critProbability * TWO_POW_32);
  }

  nextScoreRoll(): number {
    return SCORE_ROLL_MIN_PERMIL + (this.nextU32() / TWO_POW_32) * ROLL_WIDTH_PERMIL;
  }

  nextCritical(): boolean {
    return this.nextU32() < this.critThreshold;
  }

  /** [0, 1) 一様実数（動的クリティカル抽選用。Peing確定仕様） */
  nextFloat(): number {
    return this.nextU32() / TWO_POW_32;
  }
}

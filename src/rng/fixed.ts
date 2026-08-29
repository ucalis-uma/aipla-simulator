/**
 * シード決定論 RNG（モンテカルロ・最適編成探索用）。
 *
 * PRNG 実装: mulberry32（Tommy Ettinger 提案・2018。32ビット状態の高速 PRNG。
 * `t = a += 0x6D2B79F5; t = imul(t ^ t>>>15, t | 1); t ^= t + imul(t ^ t>>>7, t | 61);
 *  return (t ^ t>>>14) >>> 0` の定義。シードが同じなら常に同一系列を返す）。
 *
 * 抽選規則（本プロジェクトの契約・ゲーム本体の内部実装とは無関係）:
 * - roll = 950 + floor(u32 / 2^32 × 101) ≡ 950 + floorDiv(u32 × 101, 2^32)
 *   （u32/2^32 は倍精度で誤差なく表現できるため整数演算と厳密に一致する）
 * - crit = u32' / 2^32 < p（p はコンストラクタで注入・既定 0）
 *
 * 数値規律: Math.floor を直接使わず rounding.ts の floorDiv / floorOf を使う。
 */
import { floorDiv, floorOf } from "../rounding.js";
import { SCORE_ROLL_MIN_PERMIL, type ScoreRng } from "./types.js";

/** スコア乱数の選択肢数（950〜1050 の 101 択） */
const ROLL_CHOICES = 101;
/** 2^32（u32 出力を [0,1) 実数に正規化する分母） */
const TWO_POW_32 = 4294967296;

/** mulberry32 の生出力（32ビット整数）を返すジェネレータ */
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
 * シード決定論 RNG。
 *
 * @param seed 任意の整数（内部的に >>> 0 で正規化）
 * @param critProbability クリティカル発生確率（0〜1。既定 0。発生確率の式は Unknown のため注入式）
 */
export class FixedRng implements ScoreRng {
  private readonly nextU32: () => number;
  private readonly critThreshold: number;

  constructor(seed: number, critProbability = 0) {
    if (!Number.isInteger(seed)) {
      throw new Error(`FixedRng: seed must be an integer, got ${seed}`);
    }
    if (
      !Number.isFinite(critProbability) ||
      critProbability < 0 ||
      critProbability > 1
    ) {
      throw new Error(
        `FixedRng: critProbability must be in [0, 1], got ${critProbability}`,
      );
    }
    this.nextU32 = mulberry32U32(seed);
    this.critThreshold = floorOf(critProbability * TWO_POW_32);
  }

  nextScoreRoll(): number {
    const u32 = this.nextU32();
    return SCORE_ROLL_MIN_PERMIL + floorDiv(u32 * ROLL_CHOICES, TWO_POW_32);
  }

  nextCritical(): boolean {
    return this.nextU32() < this.critThreshold;
  }
}

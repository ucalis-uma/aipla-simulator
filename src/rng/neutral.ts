/**
 * 乱数中立 RNG（確定値ラン用）。
 *
 * スコア乱数を常に 1000（=±5% 乱数の中央値）に固定する。
 * nextCritical() は常に true を返す — これは「確率/成功率ゲート（gate<1000 の抽選）を
 * 常に通過させる」ための契約で、クリティカル係数そのものではない
 * （クリティカル係数は SimulateInput.criticalProvider を別途 () => false にして無効化する。
 *  Phase 4 の CLI / UI が「乱数を除いた確定スコア」を出力する際の構成）。
 */
import type { ScoreRng } from "./types.js";

export class NeutralRng implements ScoreRng {
  nextScoreRoll(): number {
    return 1000;
  }
  nextCritical(): boolean {
    return true;
  }
  /** [0, 1) 一様実数。確定値ランは抽選しないため 0（判定式 `nextFloat() < rate` で成立側） */
  nextFloat(): number {
    return 0;
  }
}

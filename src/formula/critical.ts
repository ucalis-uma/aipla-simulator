/**
 * クリティカル係数（B6・発生時）。
 *
 * 出典: research/02 §1.9【確度: Confirmed】/ research/01 §2.2・§3.5。
 *
 *   発生時係数 = 150% + クリティカル係数上昇(段 × 5%) + エール/フォトのクリスコ%（加算）
 *   非発生時   = 100%（変化なし。呼び出し側で critFactorPermil=1000 を使う）
 *
 * - 実測: エールのクリティカルスコア +25.5% → extrasPermil=255。
 *   実測ライブのビート103 SP 検算では係数 2.255（= 150% + 効果50% + エール25.5%）を使用
 *   （research/02 §3.4）。
 * - 段数上限: 基本20。LimitBreakCriticalBonusPermilUp(81) による上限解放を確認
 *   （research/02 §1.9）。それ以上の厳密上限は Unknown。クランプは呼び出し側の責務。
 * - 【Unknown】クリティカル率（発生確率）の式は三源とも未解明（S4 は TODO）。
 *   確率は ScoreRng（src/rng）側の責務で、本モジュールは係数のみを扱う。
 */

/** クリティカル発生時の基本加算分（150% = 1000 + 500） */
export const CRITICAL_BASE_PERMIL = 1500;

/** クリティカル係数上昇バフの1段あたり加算値（+5%） */
export const CRITICAL_COEFF_UP_PER_STAGE_PERMIL = 50;

/**
 * クリティカル発生時の係数を返す。
 *
 * @param extrasPermil エール/フォト等のクリスコ%合算（permil。実測ライブは 255）
 * @param coeffUpStages クリティカル係数上昇バフの段数（0 以上の整数）
 * @returns 発生時係数 permil（例: stages=0, extras=0 → 1500 / stages=20, extras=255 → 2755）
 */
export function criticalFactorPermil(extrasPermil = 0, coeffUpStages = 0): number {
  if (!Number.isInteger(extrasPermil) || extrasPermil < 0) {
    throw new Error(`extrasPermil must be a non-negative integer, got ${extrasPermil}`);
  }
  if (!Number.isInteger(coeffUpStages) || coeffUpStages < 0) {
    throw new Error(`coeffUpStages must be a non-negative integer, got ${coeffUpStages}`);
  }
  return (
    CRITICAL_BASE_PERMIL +
    CRITICAL_COEFF_UP_PER_STAGE_PERMIL * coeffUpStages +
    extrasPermil
  );
}

/**
 * スコア乱数の供給契約（RNG インターフェース）。
 *
 * - スコア乱数: 連続値 float ∈ [950, 1050] permil（±5% の一様連続値）。
 *   【T5確定 2026-08-30】整数パーミル仮定（0.1%刻み・101択）は初期フェーズの仮説で、
 *   単一 A スキル 9 イベントの ±0.03% wobble が説明不能だったため棄却。
 *   FixedRng（離散）は初期フェーズの近似実装としてテスト用に残置。
 * - クリティカル発生: boolean。
 *   【Unknown】発生確率の式は未解明（research/02 §1.9・S4 は TODO）。
 *   実装では確率 p を外部から注入するか、実測系列のリプレイで対応する。
 *
 * 契約上の注意: nextScoreRoll() と nextCritical() は「1呼び出し = 1抽選」とし、
 * 呼び出しごとに乱数系列を1つ進める（ゲーム本体の抽選単位がビート/スキルイベントの
 * どちらに紐づくかは Unknown。タイムラインエンジン側で呼び出し順を管理する）。
 */
/** スコア乱数の下限（−5%）【Confirmed】 */
export const SCORE_ROLL_MIN_PERMIL = 950;
/** スコア乱数の上限（+5%）【Confirmed】 */
export const SCORE_ROLL_MAX_PERMIL = 1050;

/** スコア乱数源の共通インターフェース */
export interface ScoreRng {
  /** 次のスコア乱数（[950, 1050] の連続値 permil。T5確定仕様） */
  nextScoreRoll(): number;
  /** 次のクリティカル判定結果 */
  nextCritical(): boolean;
}

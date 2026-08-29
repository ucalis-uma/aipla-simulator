/**
 * スコア乱数の供給契約（RNG インターフェース）。
 *
 * - スコア乱数: 950〜1050 の整数 permil（±5%・0.1%刻み・101択・離散一様）。
 *   【Confirmed】research/02 §1.13（S1/S2 一致、3点検算で全て範囲内）。
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
  /** 次のスコア乱数（950〜1050 の整数 permil） */
  nextScoreRoll(): number;
  /** 次のクリティカル判定結果 */
  nextCritical(): boolean;
}

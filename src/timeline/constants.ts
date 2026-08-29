/**
 * タイムラインエンジンの定数（Phase 3b）。
 *
 * 出典: research/01_jp_spec.md §2.1-§2.2・§4、research/02_formulas.md §1.3・§1.6、
 * data/skills_golden.json effectStageValuesPermil（P3a）。数値は全て permil（‰）。
 * 未確定項目には【Estimate】/【Unknown】を付す。
 */
import type { LaneNumber } from "./types.js";

/**
 * position（0-4）→ レーン番号。
 * 発動優先ランク = [センター, 左, 右, 左端, 右端] = [L3, L2, L4, L1, L5]
 * （measured_data_v2.json の発動ログ 21/21 一致。research/12 附録）。
 */
export const POSITION_TO_LANE: readonly [LaneNumber, LaneNumber, LaneNumber, LaneNumber, LaneNumber] = [
  3, 2, 4, 1, 5,
];

/**
 * アイドル処理順・対象選択の優先レーン順。
 * メンタル降順、同値は「左から 4-2-1-3-5」（research/01 §2.1【Confirmed】）。
 */
export const IDOL_PRIORITY_ORDER: readonly LaneNumber[] = [4, 2, 1, 3, 5];

/**
 * ステージ属性コード → 属性名（data/stages/qt-daily-003-19.json laneAttributes=[2,2,1,2,2] が
 * research/11 の position1-5=[Vo,Vo,Da,Vo,Vo] と対応）。
 * 【Estimate】3=visual は本実測に未出現（Vo/Da のみ確認）だがダンス/ボーカルとの対称で仮置き。
 */
export const ATTRIBUTE_CODE_TO_NAME: ReadonlyMap<number, "vocal" | "dance" | "visual"> = new Map([
  [1, "dance"],
  [2, "vocal"],
  [3, "visual"],
]);

/** ステータス系バフの1段あたり値（permil・research/01 §2.2【Confirmed】） */
export const STATUS_UP_PER_STAGE_PERMIL = 50;
/** ブーストは上昇と別系統で加算重複（10段+10段=+125%） */
export const STATUS_BOOST_PER_STAGE_PERMIL = 75;
export const STATUS_DOWN_PER_STAGE_PERMIL = 50;

/** スコアボーナス系バフの1段あたり値（permil・research/02 §1.3 §1.6【Confirmed】） */
export const SCORE_UP_PER_STAGE_PERMIL = 25;
export const BEAT_SCORE_UP_PER_STAGE_PERMIL = 100;
export const P_SKILL_SCORE_UP_PER_STAGE_PERMIL = 100;
export const A_SKILL_SCORE_UP_PER_STAGE_PERMIL = 50;
export const SP_SKILL_SCORE_UP_PER_STAGE_PERMIL = 30;
export const TENSION_UP_PER_STAGE_PERMIL = 50;
export const COMBO_SCORE_UP_PER_STAGE_PERMIL = 100;
export const CRITICAL_COEFF_UP_PER_STAGE_PERMIL = 50;
export const CRITICAL_RATE_UP_PER_STAGE_PERMIL = 50;
export const SKILL_SUCCESS_UP_PER_STAGE_PERMIL = 37.5;
export const FOCUS_APPEAL_PER_STAGE_PERMIL = 50;
export const STEALTH_APPEAL_PER_STAGE_PERMIL = 50;

/** 消費スタミナ係数（research/01 §2.2・§4-4【Confirmed】） */
export const STAMINA_COST_DOWN_PER_STAGE_PERMIL = 50;
export const STAMINA_COST_UP_PER_STAGE_PERMIL = 50;
/** ブースト副効果の消費スタミナ +1%/段 */
export const BOOST_STAMINA_COST_PER_STAGE_PERMIL = 10;

/** 段数上限（research/02 §1.6【Confirmed】）。limitRelease で 30 へ拡張 */
export const DEFAULT_STAGE_CAP = 20;
export const TENSION_STAGE_CAP = 10;
export const FOCUS_STAGE_CAP = 10;
export const SKILL_SUCCESS_STAGE_CAP = 10;
export const LIMIT_RELEASE_STAGE_CAP = 30;

/**
 * 集目（focus）副効果のファンボーナス permil（インデックス=段数 0-9、10段以上は 50 で頭打ち）。
 * research/01 §2.6（3段+2.1%〜10段+5.0%）【Confirmed】。
 */
export const FOCUS_FAN_BONUS_PERMIL: readonly number[] = [0, 0, 21, 28, 35, 42, 46, 48, 49, 50];

/**
 * ステルス副効果のファンボーナス permil（他4人）。 research/01 §2.6（5段+1.8%〜10段+3.7%）。
 * 【Unknown】中間段（6-9段）の値が資料に無い。本実測データにステルス効果は出現しないため
 * 未使用。将来実装時は要実測。
 */
export const STEALTH_FAN_BONUS_PERMIL: readonly number[] | null = null;

/**
 * テンション副効果: 成功率 -1.5%/段（research/01 §2.6【Confirmed】）。
 * 37.5‰ 系との整合のため 2段単位の permil で保持（-30‰/2段）。
 */
export const TENSION_SUCCESS_DOWN_PER_2_STAGES_PERMIL = 30;
/** スキル成功率上昇も 3.75%/段 = 75‰/2段（非整数 permil を整数演算で扱うため） */
export const SKILL_SUCCESS_UP_PER_2_STAGES_PERMIL = 75;

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
 * アイドル処理順・対象選択の同値タイブレーク順。
 * 【ユーザー確定 2026-08-29】メンタル降順が原則で、メンタル同数の場合の発動順は
 * L3 → L2 → L4 → L1 → L5（=発動優先位置①センター→②センター左→③センター右→
 * ④左端→⑤右端の順、POSITION_TO_LANE と一致）。
 * ※ 本実測編成では L2 と L5 のメンタルが同数（5880・research/14 §4）であり、
 *   b3 後半の実測発動順 L2→L5 はこのタイブレーク規則で再現される。
 *   research/01 §2.1 の「4-2-1-3-5」説は本規則に訂正。
 */
export const IDOL_PRIORITY_ORDER: readonly LaneNumber[] = [3, 2, 4, 1, 5];

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

/**
 * クリティカル発生率（確率・0-1）の定数。
 * 【Peing確定 2026-08-30】質問箱 id=1189080032 / id=1186806688 / id=1188731464:
 * - 「クリティカル（固定値）→ 発生確率に影響。最大で発生率 +50%。50% に必要な
 *   クリティカル値はステージによって異なる（要求値はステージ毎に異なる）」
 * - 「クリティカル率バフは 1 段階あたりクリティカル率 +5%。最大の 20 段では +100% と
 *   なり確実にクリティカルが発生する」
 */
/** 基礎クリティカル発生率の上限（50%。ステージ要求値は不明のため UI 設定値をクランプ） */
export const CRIT_RATE_BASE_CAP = 0.5;
/** クリティカル率上昇バフ（critical_rate_up）の 1 段あたり発生率 */
export const CRIT_RATE_UP_PER_STAGE = 0.05;

/** ステータス系バフの1段あたり値（permil・research/01 §2.2【Confirmed】） */
export const STATUS_UP_PER_STAGE_PERMIL = 50;
/**
 * ボーカル上昇超化（vocal_up_extreme・add_effect_value_vocal_up）の1段あたり値。
 * 【Peing確定 2026-08-31】超化はスキル表記上の段階数（「5段階」「10段階」等）が
 * ダミー値で、効果は常に「元のバフの+5段階分（固定）」= vocal_up 50‰×5 = +250‰。
 * 出典: 質問箱 id=1190010925「超化や上限解放は段階数は存在するものの効果は常に一定です
 * （例外: ムーン沙季のスコア超化の5→10段は修整漏れ）」・id=1189874405
 * 「テンション超化はテンション5段相当。10段＋超化は上限解放15段と同価値（+75%）」。
 * 旧 25‰×表記段数説（T5実測フィット）は本確定仕様に訂正（T5の fest-03-2 は
 * 表記10段 → 一律5段で +250‰ となり合計値は同一・golden の stages を 10→5 に修正）。
 */
export const STATUS_UP_EXTREME_PER_STAGE_PERMIL = 50;
/**
 * 超化効果（add_effect_value_*）が付与する固定段数（元のバフの+5段階分）。
 * スキル表記の段階数によらず一律（上記 Peing確定のとおり）。
 */
export const EXTREME_GRANT_STAGES = 5;
/**
 * ライブ中ステータス倍率のクランプ上限（×3.75）。
 * 【T5実測確定 2026-08-30】research/08 §3 のとおり L3 stat_value は b68 以降
 * floor(626,223×3.75) = 2,348,336 に完全固定。内部段数は超過分を保持するが
 * 倍率は 3750‰ で頭打ち。
 */
export const LIVE_STATUS_MULTIPLIER_CAP = 3750;
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
 * 集目（focus）副効果のファンボーナス permil（インデックス=段数-1、10段以上は 50 で頭打ち）。
 * 【Peing確定 2026-08-31・research/16 §2】「1〜5段は +0.7%/段、6〜10段は +0.3%/段」（最大+5.0%）。
 * 旧 research/01 §2.6 の「3段+2.1%〜」は部分観測であり本確定値に訂正。
 */
export const FOCUS_FAN_BONUS_PERMIL: readonly number[] = [
  7, // 1段: +0.7%
  14, // 2段: +1.4%
  21, // 3段: +2.1%
  28, // 4段: +2.8%
  35, // 5段: +3.5%
  38, // 6段: +3.8%
  41, // 7段: +4.1%
  44, // 8段: +4.4%
  47, // 9段: +4.7%
  50, // 10段: +5.0% (上限)
];

/**
 * ステルス（stealth・audience_amount_reduction）副効果のファンボーナス permil
 * （インデックス=段数-1。ステルス中のレーン**以外**の4レーンのファンボーナスに加算）。
 * 【Peing確定 2026-08-31】id=1188720397: 「ステルスは0.3％か0.4％ずつ上がります
 * （10段階で＋3.7％）…5段（＋1.8％）から6段（＋2.1％）の変化で破綻した」。
 * 確定値: 5段=18‰ / 6段=21‰ / 10段=37‰。6→10段は 21→37（+16‰/4段）のため
 * 「0.3% or 0.4% ずつ」の制約から全段 +4‰ で一意確定（25/29/33）。
 * 1〜4段は資料が無く【Unknown】→ 0 で近似（過小評価の可能性あり・要実測）。
 * 自レーンのファン引力度 -5%/段 は来場者数の動的再計算が必要なため未実装（research/01 §2.6）。
 */
export const STEALTH_FAN_BONUS_PERMIL: readonly number[] = [
  0, // 1段: Unknown（0近似）
  0, // 2段: Unknown（0近似）
  0, // 3段: Unknown（0近似）
  0, // 4段: Unknown（0近似）
  18, // 5段: +1.8%
  21, // 6段: +2.1%
  25, // 7段: +2.5%（6→10段が+4‰/段で一意確定）
  29, // 8段: +2.9%
  33, // 9段: +3.3%
  37, // 10段: +3.7%
];

/**
 * テンション副効果: 成功率 -1.5%/段（research/01 §2.6【Confirmed】）。
 * 37.5‰ 系との整合のため 2段単位の permil で保持（-30‰/2段）。
 */
export const TENSION_SUCCESS_DOWN_PER_2_STAGES_PERMIL = 30;
/** スキル成功率上昇も 3.75%/段 = 75‰/2段（非整数 permil を整数演算で扱うため） */
export const SKILL_SUCCESS_UP_PER_2_STAGES_PERMIL = 75;

/**
 * ユニット → 所属キャラクターID（characterId）の対応。
 * 【Phase 9】ライブボーナスのユニット人数条件（tg-more_than_character_count-<unit>-<N>、
 * condition "count_<unit>>=N"）の判定に使用。出典: vendor/SkillTrigger.json の
 * tg-more_than_character_count-* 行の characterIds（マスタ由来・2026-08-31取得）。
 */
export const UNIT_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  moon: ["char-ktn", "char-ngs", "char-mei", "char-suz", "char-ski"], // 月のテンペスト
  sun: ["char-skr", "char-szk", "char-chs", "char-rei", "char-hrk"], // SUNNY PEACE
  liz: ["char-rio", "char-aoi", "char-ai", "char-kkr"], // LizNoir
  tri: ["char-rui", "char-yu", "char-smr"], // TRINITYAiLE
  thrx: ["char-kor", "char-mhk", "char-kan"], // 3RX
  pajm: ["char-smr", "char-szk", "char-chs", "char-kkr", "char-suz"], // パジャマパーティ
  leader: ["char-ktn", "char-skr", "char-rui", "char-rio", "char-kor"], // 各ユニットリーダー
};

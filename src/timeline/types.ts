/**
 * タイムラインエンジンの契約型（Phase 3b）。
 *
 * データ供給: data/skills_golden.json（P3a・検証済み）を SkillDef/SkillEffect としてそのまま受ける。
 * 計算基盤: src/rounding.ts（千分率整数演算）・src/formula/scoreEvent.ts（イベントスコア）。
 * スペック出典: research/01_jp_spec.md §2・§4、research/02_formulas.md §1・§3、
 * research/08_stamina_ct.md §2（CT規則）。各項目に出典と確度を JSDoc で記す。
 * 未確定項目は【Estimate】/【Unknown】タグを必須とする（推測を Confirmed と書かない）。
 */
import type { StatValues } from "../types.js";
import type { ComboAdvantageRow } from "../formula/combo.js";
import type { RoundingPolicy } from "../formula/scoreEvent.js";
import type { ScoreRng } from "../rng/types.js";

/** レーン番号（1=左端, 2=左, 3=センター, 4=右, 5=右端） */
export type LaneNumber = 1 | 2 | 3 | 4 | 5;

/** レーン属性（レーン色） */
export type LaneAttribute = "vocal" | "dance" | "visual";

/** スキル種別（skills_golden.json の kind。live_bonus=ステージのライブボーナス） */
export type SkillKind = "A" | "SP" | "P" | "photo" | "live_bonus";

/**
 * 効果type（skills_golden.json の type 文字列・P3aでマスタ efficacyType から写像）。
 * 本実測に現れた24種＋Phase 6（マスタ一般化）で追加の対称型＋Phase 9（Peing確定仕様）で追加:
 * - vocal_down/dance_down/visual_down: ステータス低下バフ（1段 -5%）
 * - p_skill_score_up: P スキルスコア上昇バフ（1段 +10%・b1 passive に加算）
 * - stealth: ステルス（audience_amount_reduction。副効果で他4レーンのファンボーナス+）
 * - live_bonus_ct_reduction: ライブボーナス（ステージ側）の CT を短縮する即時効果
 * - effect_passing: 【サンプル4実測 2026-09-04】強化効果譲渡
 *   （strength_effect_assignment_all。スキル保持レーンの有効な強化バフ・インスタンスを
 *   対象レーンへコピー。同一種は既存インスタンスと別枠で保持→集計は cap でクランプ）
 * dance_up/dance_boost/visual_up/visual_boost/beat_score_up はマスタ頻出のため追加
 * （【Estimate】実測ゴールデンには出現しない。vocal 系との対称で実装）。
 */
export type EffectType =
  | "score_get"
  | "score_get_by_score_ratio"
  | "vocal_up"
  | "vocal_boost"
  | "vocal_up_extreme"
  | "dance_up"
  | "dance_boost"
  | "dance_up_extreme"
  | "visual_up"
  | "visual_boost"
  | "visual_up_extreme"
  | "beat_score_up"
  | "vocal_down"
  | "dance_down"
  | "visual_down"
  | "tension_up"
  | "tension_limit"
  | "combo_score_up"
  | "combo_score_limit"
  | "critical_coeff_up"
  | "critical_coeff_limit"
  | "critical_rate_up"
  | "a_skill_score_up"
  | "sp_skill_score_up"
  | "p_skill_score_up"
  | "stamina_cost_down"
  | "stamina_cost_up"
  | "stamina_recovery"
  | "combo_continue"
  | "ct_reduction"
  | "ct_increase"
  | "effect_extension"
  | "effect_amplify"
  | "effect_passing"
  | "score_up"
  | "skill_success_up"
  | "focus"
  | "stealth"
  | "live_bonus_ct_reduction";

/** 効果の対象（skills_golden.json の target。12種＋Phase 6/9 マスタ一般化で追加） */
export type EffectTarget =
  | "self"
  | "score_type_1"
  | "score_type_2"
  | "vocal_high_1"
  | "same_lane_other"
  | "all"
  | "neighbors"
  | "vocal_type_2"
  | "center"
  | "vocal_type_1"
  | "single"
  | "vocal_type_3"
  // ---- Phase 6（マスタ SkillTarget 一般化・【Estimate】ゴールデンに同型の実測なし）----
  | "buffer_type_1"
  | "buffer_type_2"
  | "buffer_type_3"
  | "supporter_type_1"
  | "supporter_type_2"
  | "supporter_type_3"
  | "dance_type_1"
  | "dance_type_2"
  | "dance_type_3"
  | "visual_type_1"
  | "visual_type_2"
  | "visual_type_3"
  | "dance_high_1"
  | "visual_high_1"
  | "vocal_high_2"
  | "vocal_high_3"
  // ---- Phase 9（ライブボーナス・マスタ SkillTarget 拡張・【Estimate】）----
  | "score_type_3"
  | "score_type_5"
  | "buffer_type_5"
  | "supporter_type_5"
  | "vocal_type_5"
  | "dance_type_5"
  | "visual_type_5"
  | "dance_high_2"
  | "dance_high_3"
  | "visual_high_2"
  | "visual_high_3"
  | "stamina_high_1"
  | "stamina_low_1"
  | "stamina_low_2"
  | "stamina_low_3"
  // ---- サンプル1実測（2026-09-01）: target-position_attribute_<attr>-<N> =
  //「<属性>レーンN人」。レーン属性（stage laneAttributes）一致レーンをレーン番号順に
  // N 個。実測: 麻奈も立った大舞台（vocal_lane_3）→ L1,L3,L4（ボーカルレーン4本の
  // うち L5 は対象外=レーン番号順の先頭3つと一致）【Measured】
  | "vocal_lane_1"
  | "vocal_lane_2"
  | "vocal_lane_3"
  | "vocal_lane_5"
  | "dance_lane_1"
  | "dance_lane_2"
  | "dance_lane_3"
  | "dance_lane_5"
  | "visual_lane_1"
  | "visual_lane_2"
  | "visual_lane_3"
  | "visual_lane_5"
  /** 条件（トリガー）を満たしたレーン（例: 「X状態の時、その人に…」の X 状態のレーン） */
  | "trigger"
  /** 特定バフ状態を持つレーン N 人（target-status-<type>-<n>） */
  | "status_vocal_up_1"
  | "status_dance_up_1"
  | "status_dance_up_3"
  | "status_a_skill_score_up_1"
  | "status_a_skill_score_up_2"
  | "status_a_skill_score_up_3"
  | "status_a_skill_score_up_5";

/** 発動条件（skills_golden.json の condition。11種＋Phase 9 拡張＋Phase 8-B2 フォトマスタ準拠拡張） */
export type EffectCondition =
  | "none"
  | "self_visual_lane"
  | "self_vocal_lane"
  | "battle_only"
  | "someone_focus"
  | "combo>=80"
  | "someone_score_up"
  | "someone_skill_success_up"
  | "someone_critical_coeff_up"
  | "combo>=50"
  | "combo>=100"
  // ---- Phase 9（ライブボーナス等のトリガー tg-someone_status-* / tg-combo-90 / 編成人数）----
  | "combo>=90"
  /** コンボが N 以上（任意 N・engine は case 列挙外を正規表現フォールバックで評価） */
  | `combo>=${number}`
  | "someone_critical_rate_up"
  | "someone_beat_score_up"
  | "someone_a_skill_score_up"
  | "someone_sp_skill_score_up"
  | "someone_p_skill_score_up"
  | "someone_tension_up"
  | "someone_vocal_up"
  | "someone_dance_up"
  | "someone_visual_up"
  | "someone_vocal_boost"
  | "someone_dance_boost"
  | "someone_visual_boost"
  | "someone_vocal_down"
  | "someone_dance_down"
  | "someone_visual_down"
  | "someone_stamina_cost_down"
  | "someone_stealth"
  /** 誰かがスタミナ回復効果を受けた時（tg-someone_recovered） */
  | "someone_recovered"
  /**
   * 誰かが 低下効果グループ（vocal/dance/visual_down）状態の時
   * （tg-someone_status_group-weekness・サンプル2実測確定 2026-09-02:
   * 低下効果なし編成では全編不発）。
   */
  | "someone_down_group"
  /**
   * 自身が 低下効果グループ（vocal/dance/visual_down）状態の時
   * （tg-status_group-weekness・2026-09-02 確定:「一生懸命、金魚すくい」の
   * 2 行目「自身が低下効果状態の時」。someone_down_group の主語違い）。
   */
  | "self_down_group"
  /** 編成にユニットメンバーまたは指定キャラが N 人以上（tg-more_than_character_count-<unit/char>-<N>） */
  | `count_${string}>=${number}`
  // ---- Phase 8-B2（フォトスキルのマスタ準拠条件・engine 拡張）----
  /** 自レーンがダンス色（tg-position_attribute_dance） */
  | "self_dance_lane"
  /** 自レーンがセンター（L3・tg-center） */
  | "self_center"
  /** 自レーンが左端（L1・tg-most_left） */
  | "self_most_left"
  /** 自レーンが右端（L5・tg-most_right） */
  | "self_most_right"
  /**
   * 自レーンが <BuffKey> 状態（tg-status-*。「ボーカル上昇状態の時」等）。
   * engine は自レーンの実効スナップショットで判定する。
   */
  | `status_${BuffKey}`
  /** 自レーンのスタミナが N% 以上/以下（tg-stamina_higher-N / tg-stamina_lower-N） */
  | `stamina>=${number}`
  | `stamina<=${number}`
  /** コンボが N 以下（tg-combo_less_equal-N） */
  | `combo<=${number}`
  /** 誰かがスタミナ N% 以下（tg-someone_stamina_lower-N） */
  | `someone_stamina<=${number}`
  /** 誰かの状態が N 段階以上（tg-someone_status_effect_grade_higher_<type>-<N>） */
  | `someone_${string}>=${number}`
  /** 自身のSPスキル発動前（tg-before_special_skill） */
  | "self_before_special"
  /** 誰かのAスキル発動前（tg-before_active_skill_by_someone） */
  | "someone_before_active"
  /**
   * 【Estimate: 常時発動近似】楽曲限定（tg-music-*）/ クリティカル発動時（tg-critical）/
   * 誰かがSP発動前（tg-before_special_skill_by_someone）/ 集目段数条件（tg-fan_engage_higher-N）/
   * テンションタイプ条件（tg-mood_type-*）。engine は楽曲/発動履歴の文脈を持たないため
   * 無条件で成立扱いする（UI の条件セレクトには「（常時発動近似）」表記）。
   */
  | "music_limited"
  | "critical_timing"
  | "someone_before_special"
  | "fan_engage_higher"
  | "mood_type"
  // ---- Phase 8-B4（フォト作成の拡張条件）----
  /** 70コンボ以上時（tg-combo-70 相当・やる気士docs） */
  | "combo>=70"
  /**
   * ビート時、N%の確率で（やる気士docs 専用フォトの「ビート時、10%確率で」等）。
   * 発動試行ごとに rng.nextFloat() < N/100 で抽選（確定値ランは NeutralRng.nextFloat()=0
   * により常に成立 = 既存の確率/成功率ゲートと同じ「全抽選成立」規約）。
   */
  | `beat_chance=${number}`;

/** type36（段階数が多い程）のスケーリング計算式 */
export type ScalingFormula =
  | "linear"
  | "comboLessQuad"
  | "comboMoreLinear"
  | "effectCount"
  | "staminaRatioQuad"
  | "staminaConsumedLinear"
  | "skillCountLinear";

/** type36（段階数が多い程）のスケーリング指定 */
export interface EffectScaling {
  /** 参照する段数（例: "vocal_up_stages" = ボーカル上昇の実効段数合計。linear のみ必須） */
  ref: string;
  /** 1段あたりの SkillPower 加算率 permil。P3c フィッティング前は null（=スケーリングなしで計算） */
  perStagePermil: number | null;
  /** フィッティング済みか（data/skills_golden.json 由来のフラグをそのまま運搬） */
  fitted?: boolean;
  /**
   * 計算式の種類。省略時 "linear"。
   * - comboLessQuad: パワー × = 1 + amplitude×((max(0,reference−コンボ)/reference)^exponent)
   *   （やるキ士docs gid=806980235「コンボ数が少ない程」: 200%×((150−combo)/150)²）
   * - comboMoreLinear: パワー × = 1 + perComboPermil×コンボ（「コンボ数が多い程」: +(10/11)%/コンボ）
   * - effectCount: パワー × = 1 + perTypePermil×min(強化効果種類数, maxTypes)
   *   （「強化効果が多い程」: +14%/種類。上限は docs では 2022-06-20 正午後 9 種類 → 二度変更歴あり・現行値未確認）
   * - staminaRatioQuad: パワー × = 1 + maxPermil×(発動後スタミナ率)^2（remainingRatio=false は消費率）
   * - staminaConsumedLinear: パワー × = 1 + perStaminaPermil×累積消費スタミナ
   * - skillCountLinear: パワー × = 1 + perCountPermil×自身の発動スキル数
   * 丸めは共通で「0.1% 切り捨て」（=permil の floor・docs 明記）。
   */
  formula?: ScalingFormula;
  /** comboLessQuad: 最大加算率 permil（2000 = +200%） */
  amplitudePermil?: number;
  /** comboLessQuad: 基準コンボ（150 等） */
  reference?: number;
  /** comboLessQuad: 指数（2） */
  exponent?: number;
  /** comboMoreLinear: 1 コンボあたり permil（(10/11)% = 9.0909…‰） */
  perComboPermil?: number;
  /** effectCount: 1 種類あたり permil（14% = 140‰） */
  perTypePermil?: number;
  /** effectCount: 種類数上限（null = 上限なし。docs では 9 だが審査履歴あり要検証） */
  maxTypes?: number | null;
  /** staminaRatioQuad: 最大加算率 permil（80% = 800‰）。false 時は消費率² */
  maxPermil?: number;
  /** staminaRatioQuad: true=残率²（既定）/ false=消費率² */
  remainingRatio?: boolean;
  /** staminaConsumedLinear: 1 スタミナあたり permil（0.011% = 0.11‰） */
  perStaminaPermil?: number;
  /** skillCountLinear: 1 回あたり permil（9.7% = 97‰） */
  perCountPermil?: number;
}

/** 1効果行（skills_golden.json の effects[] 要素と同型） */
export interface SkillEffect {
  type: EffectType;
  /** スコア獲得系のスキルパワー permil（例: 450% → 4500） */
  powerPermil?: number;
  /** 段階型効果の段数 */
  stages?: number;
  /** 効果時間（ビート）。即時型は null */
  durationBeats?: number | null;
  /** 即時量（ct_reduction:15 / stamina_recovery:2560 / effect_extension:10 等） */
  value?: number;
  /** type36 のスケーリング指定。明示 null は type36 未対応マーカー（スケーリングなしで計算） */
  scaling?: EffectScaling | null;
  /**
   * 【Phase 8-B4】延長/増強の絞り込み対象バフ（与・クリティカル率延長 等）。
   * effect_extension / effect_amplify 専用。未指定 = 全バフが対象（T5 実測の挙動・不変）。
   */
  buffKey?: BuffKey;
  /**
   * 【Phase 8-B4】延長/増強の範囲スコープ。given = 自分が付与した効果のみ（レーン検索・
   * 「与・○○延長」）、received = 自分が受けている効果のみ（従来動作・「被・○○延長」）。
   * 未指定 = received（T5 実測と同一経路・既存テスト不変）。
   */
  scope?: "given" | "received";
  /** 上限解放（同種バフの最大段数を30へ拡張。research/06 BF2） */
  limitRelease?: boolean;
  /**
   * 【Peing確定 2026-08-31・2026-09-02 修正】超化効果（add_effect_value_*）:
   * 段数表記はダミーで効果は「元のバフの+5段階分（固定）」の**増強型**
   * （同種バフのアクティブ・インスタンスが無いと不発・b100 実測で確定）。
   * エンジンは同種バフ最長インスタンスへ段数を加算し、そのインスタンスの
   * capExtend に超化量を記録する（生存中は同種バフの上限をその量ぶん拡張:
   * 通常上限20 → 超化で実効25。テンション10 → 15）。
   * SkillEffect では true（超化行の印）、ActiveEffect では加算量（number）。
   * 出典: 質問箱 id=1190010925「超化や上限解放は段階数は存在するものの効果は常に一定」/
   * id=1189874405「テンション超化はテンション5段相当。10段＋超化は上限解放15段と同価値」
   */
  capExtend?: boolean | number;
  target: EffectTarget;
  condition: EffectCondition;
  confidence?: string;
}

/** 1スキル（カードA/SP/P または フォト） */
export interface SkillDef {
  id: string;
  name: string;
  kind: SkillKind;
  level: number;
  lane: LaneNumber;
  cardId?: string | null;
  cardName?: string | null;
  /** フォトのみ: 装着スロット（1始まり） */
  photoIndex?: number;
  /** フォトのみ: オプションスキルテキスト */
  optionSkill?: string | null;
  /** フォトのみ: 装着制限（supporter_only 等。本実測は全て成立済み） */
  restriction?: string | null;
  /** CT（ビート数）。limitPerLive 型フォト等は null（CT管理なし） */
  ct: number | null;
  /** 消費スタミナ。null は消費なし */
  staminaCost: number | null;
  /** 発動確率 permil（既定 1000） */
  probabilityPermil?: number;
  /** ライブ中の発動回数上限（1=「ライブ中1回のみ」。null は上限なし） */
  limitPerLive?: number | null;
  /**
   * 【2026-09-21 S1実測確定】スキル単位の発動トリガー条件（マスタ levels[].triggerId 由来）。
   * P/フォトの前半/後半タイプ判定に使用する:
   * - "none"（マスタで triggerId 空）かつ効果行条件がすべて静的（レーン属性・配置・
   *   編成人数等・ライブ中不変）→ 前半発動タイプ（b1 開幕ウェーブで発動し、
   *   発動間隔は gap CT−1 系列になる。S1 こころP「ゆらゆらドボーン！」: 実機の b1 表示 +
   *   発動間隔 49/50/50 と完全一致）。
   * - それ以外（スキル単位条件付き: 逆襲のドッキリ企画 = スキル単位 tg-position_attribute_vocal
   *   → 後半発動・gap 50/50/35、過去の私へ = tg-combo-80 → 後半）→ 従来どおり後半タイプ。
   * undefined = データなし（golden/フォト等の従来経路）→ 従来の効果行ベース判定にフォールバック。
   * ※ 効果行の条件（SkillEffect.condition）は行ごとの適用可否ゲートとして従来どおり機能する。
   */
  condition?: EffectCondition;
  effects: SkillEffect[];
}

/** 1レーンの入力（デッキ計算結果 + スキル + スコアボーナス系の外部解決値） */
export interface LaneInput {
  lane: LaneNumber;
  /** レーン属性（ステージ laneAttributes から解決） */
  attribute: LaneAttribute;
  /**
   * 編成上の役割（verification_data の role: "Scorer"/"Buffer"/"Supporter"）。
   * score_type_1/score_type_2/single の対象解決に使う（実測では常にスコアラーに解決）。
   * 省略時は発動レーン自身にフォールバック。
   */
  role?: "Scorer" | "Buffer" | "Supporter";
  /**
   * メンバーのタイプ（装着カードの属性）。*_type_N（ボーカルタイプN人 等）の対象プール。
   * 【サンプル1実測確定 2026-09-01】殻をやぶる（ボーカルタイプ2人）→ L2,L3：ダンスレーンの
   * メンバーがボーカルタイプ対象になるため、レーン属性（attribute）とは独立の概念。
   * 【Estimate】カード属性 = ratiosPermil の vocal/dance/visual 最大（research/07・確度 Medium）。
   * 省略時はレーン属性で代用（旧挙動）。
   */
  cardType?: LaneAttribute;
  /** デッキステータス（Phase 1 computeDeckStatus の deck 値。ライブ中バフ乗算の基準） */
  deck: StatValues<number>;
  /** カードスキル（A/SP/P） */
  skills: SkillDef[];
  /** フォトスキル */
  photos: SkillDef[];
  /** エール+フォトのスコア補正%合算 permil（B1 加算項。呼び出し側で解決済み） */
  scoreBonusPct: {
    beat: number;
    active: number;
    special: number;
    /** Pスキルスコア用（本実測では使用機会なしでも必須字段） */
    passive: number;
  };
  /** エール+フォトのクリスコ%合算 permil（criticalFactorPermil の extras。実測 255） */
  critExtrasPermil: number;
  /** 【2026-09-02 サンプル1確定】写真の「Aスコア（固定値）」合計。A スキルのスコアに平坦加算 */
  aScoreAdditionalFlat?: number;
  /**
   * 【サンプル3・2026-09-04】キャラ優位の全スコア倍率 permil
   * （QuestCharacterAdvantage.advantagePermil。STAGE045 の ⅢX メンバーは 2250。
   * 省略時は 1000 扱い。ユーザー確定「全スコア」）
   */
  characterAdvantagePermil?: number;
}

/**
 * ライブボーナス（ステージ側Pスキル）の定義。レーン非所属のため lane は null
 * （data/live_bonuses.json 由来。発動者はステージ全体・対象解決のアンカーはセンター）。
 */
export type LiveBonusSkillDef = Omit<SkillDef, "lane"> & { lane: LaneNumber | null };

/** ステージ入力（data/stages/qt-daily-003-19.json から） */
export interface StageInput {
  id: string;
  /** position 1-5 の属性コード（1=dance, 2=vocal, 3=visual。research/11 実測対応） */
  laneAttributes: readonly number[];
  /** ビート重み permil（標準 600/250/150。research/02 §1.2） */
  beatWeightsPermil: { vocal: number; dance: number; visual: number };
  /** A/SP 重み permil（標準 1000。research/07 §2） */
  skillWeightsPermil: { active: number; special: number };
  /**
   * 【サンプル3・2026-09-03】スタミナ消費倍率 permil（Quest.skillStaminaWeightPermil。
   * 標準 1000・STAGE045(EXタワー)は 3000。省略時は 1000 扱い）
   */
  skillStaminaWeightPermil?: number;
  /**
   * 【サンプル3・2026-09-03】スタミナ回復倍率 permil（Quest.staminaRecoveryWeightPermil。
   * 標準 1000。0 は「特徴なし」= 1000 扱い。継続回復の tick に乗る。省略時は 1000 扱い）
   */
  staminaRecoveryWeightPermil?: number;
  /** ステージ特徴（スコア倍率）permil。本実測はスコア倍率特徴なし=1000 */
  stageFactorPermil: number;
}

/** 譜面ノート（data/charts/chart-*.json の notes。beat は type≠0 ノートの通し番号済み） */
export interface ChartNote {
  beat: number;
  /** 1=ビート, 2=A, 3=SP */
  noteType: 1 | 2 | 3;
  /**
   * グリッド位置。ビートノートは 0（全レーン共通ノート）。A/SP ノートは 1-5 の
   * 発動優先ランク（1=センターL3, 2=左L2, 3=右L4, 4=左端L1, 5=右端L5。
   * 実測 A/SP 発動 18/18 と一致。research/13 §5.2）。
   */
  position: 0 | 1 | 2 | 3 | 4 | 5;
}

/**
 * クリティカル判定の供給源。
 * 【Peing確定 2026-08-30】動的モード（SimulateInput.baseCritRate 指定時）は
 * エンジンが effectiveCritRate = min(0.50, baseCritRate) + critical_rate_up段 × 5%
 * をスナップショット毎に計算して rng.nextFloat() で抽選するため本契約は使われない
 * （フォト行は従来どおりクリティカル判定の対象外）。
 * - ゴールデン（Mode R）: measured_data_v2.json critical_flags.beats の黄ポップ抽出を注入
 * - 動的モード未指定時のフォールバックとしても使用する
 */
export type CritProvider = (beat: number, lane: LaneNumber) => boolean;

/** タイムライン全体の入力 */
export interface SimulateInput {
  lanes: readonly LaneInput[];
  notes: readonly ChartNote[];
  stage: StageInput;
  /** 来場ファンボーナス係数 permil（B3。全レーン共通既定。実測 1620） */
  fanFactorPermil: number;
  /**
   * 【2026-09-01 docs 引力式】1 アイドルの基礎来場ファン数（= min(容量/5, 50,000)）。
   * 指定時はファンボーナスを「引力度配分→fan_bonus 表」で計算する（buffs.ts
   * fanFactorPermilByAttraction）。未指定時は fanFactorPermil + 集目加算の従来方式。
   */
  fanBaseCount?: number;
  /** コンボテーブル（既定 data/stages/combo_advantage.json 同期の COMBO_ADVANTAGE_TABLE） */
  comboAdvantageTable?: readonly ComboAdvantageRow[];
  /** 成功率の基礎値 permil（min(1, 席埋率×メンタル/要求) の結果。既定 1000。本実測は全成立） */
  successBasePermil?: number;
  /** クリティカル判定の供給源（必須。baseCritRate 指定時の動的モードでは参照されない） */
  criticalProvider: CritProvider;
  /**
   * 【Peing確定 2026-08-30】基礎クリティカル発生率（0-1。UI設定値・既定 0.50）。
   * 指定時は動的クリティカル判定を有効化する:
   *   effectiveCritRate = min(0.50, baseCritRate) + snapshot.critical_rate_up × 5%
   *   - effectiveCritRate >= 1.0 → 確定クリティカル（抽選なし・常に発生）
   *   - それ以外 → rng.nextFloat() < effectiveCritRate で抽選
   *   - フォト行は T5確定どおりクリティカル判定の対象外
   * 根拠: 質問箱 id=1189080032「クリティカル→発生確率に影響、最大で発生率+50%
   * （50%に必要なクリティカル値はステージによって異なる）/ クリティカル率バフは
   * 1段階あたり+5%、20段で+100%となり確実にクリティカルが発生」・
   * id=1186806688「クリ値が高いとクリ発生率最大50%まで上がる、要求値はライブ毎に異なる」。
   * 未指定時は criticalProvider（実測リプレイ等）に委譲（ゴールデンテスト互換）。
   */
  baseCritRate?: number;
  /** スコア乱数源（必須。Mode R は FixedRng(1000) 系） */
  rng: ScoreRng;
  /**
   * ミスノート（谱面ノートをプレイヤーが取りこぼした組）。
   * 指定された (beat, lane) のビートは挑戦自体が発生せず、スコア・乱数・レーンコンボも変動しない。
   * T5実測では b1 の L1/L2/L4/L5（LIVE START 直後の取りこぼし。b1 のポップが全レーン null、
   * かつ b1-4 リージョンの達成帯がミスなしでは不成立）。
   */
  missedNotes?: ReadonlyArray<{ beat: number; lane: LaneNumber }>;
  /** 丸めポリシー（既定 "sequential"。T4/T5 で at-end が確定・推奨は "at-end"） */
  roundingPolicy?: RoundingPolicy;
  /**
   * 【Phase 9・Peing確定】ステージのライブボーナスPスキル（data/live_bonuses.json 由来）。
   * research/16 §1: 全アイドルPスキル（メンタル降順）より**先頭（最優先）**で判定・発動する。
   * 前半発動（無条件・スコア精算前）と後半発動（条件付き・スコア精算後の後半Pスキル群の先頭）に対応。
   * CT はステージ側で個別管理（step9で減算）。
   */
  liveBonusSkills?: readonly LiveBonusSkillDef[];
  /**
   * 編成5レーンのキャラクターID（L1..L5順。data/cards.json の characterId）。
   * ライブボーナスのユニット人数条件（count_liz>=1 等）の判定に使用。
   */
  formationCharacterIds?: readonly string[];
  /**
   * 【デバッグ専用・2026-09-21】ビート処理完了後（ステップ11終了時点）に内部の
   * バフインスタンス状態（sourceSkillId・残りビート付き）を観測するフック。
   * 実測突合ツール（tools/）専用。省略時は何もしない（本番計算へ一切影響しない）。
   * 注意: states はエンジン内部の可変状態への参照（観測時にコピーして使うこと）。
   */
  effectInspector?: (beat: number, states: readonly import("./engine.js").LaneState[]) => void;
}

/** 発動1件のトレース（T4: 発動ログとの突合用） */
export interface ActivationTrace {
  beat: number;
  /** 処理位相（research/01 §4: first=P前半, main=A/SP/ビート発動, last=P後半） */
  phase: "first" | "main" | "last";
  /**
   * 発動レーン。ライブボーナス（ステージ側・レーン非所属）は 0。
   */
  lane: LaneNumber | 0;
  skillId: string;
  kind: SkillKind;
  success: boolean;
  /** 失敗理由（research/01 §4 の FAIL 種別に対応） */
  failReason?: "no_skill" | "stamina_short" | "in_ct" | "probability" | "condition" | "limit";
  /** 実消費スタミナ（成功時。消費低減/増加・ブースト副効果込み） */
  staminaCost?: number;
  /** 獲得スコア（score_get 系のみ） */
  gainedScore?: number;
}

/** レーン1件分のスコアイベントトレース（T5: 検算用） */
export interface LaneScoreEventTrace {
  lane: LaneNumber;
  /** スコアの発生源種（beat=ビートノート / A / SP / P / photo）。レーン別内訳集計用（Phase 4） */
  sourceKind: SkillKind | "beat";
  /** 基本スコア（乗算前。ビート: 重み込みステータス / A・SP: レーン色ステータス×重み×SkillPower前） */
  basicScore: number;
  /** computeEventScore に渡った SkillPower permil（scaling 反映後） */
  skillPowerPermil: number;
  /** computeEventScore に渡った B1 permil */
  b1Permil: number;
  /** computeEventScore に渡ったコンボファクター permil（割合型は 1000） */
  comboFactorPermil: number;
  /** computeEventScore に渡ったファンファクター permil（割合型は 1000） */
  fanFactorPermil: number;
  /** 割合型スコア（score_get_by_score_ratio）か。基本スコアの基準が累積スコア */
  isRatioScore: boolean;
  /**
   * 割合型スコアの基本スコア基準となった累積スコア（自身の加算前・×SkillPower 前）。
   * 逆算ソルバーが乱数変更に伴う basicScore の再計算に使う（T5 b103 等）。
   */
  ratioBaseCumScore?: number;
  /** スコア乱数 permil */
  randPermil: number;
  /** クリティカル係数 permil（非発生 1000） */
  critFactorPermil: number;
  gainedScore: number;
}

/** ビート1回分のトレース */
export interface BeatTrace {
  beat: number;
  noteType: 1 | 2 | 3;
  position: 0 | 1 | 2 | 3 | 4 | 5;
  /** 発動トレース（処理順・スコア精算前後を含む） */
  activations: ActivationTrace[];
  /** スコアイベント（レーン別。スコア精算が行われたビートのみ） */
  events: LaneScoreEventTrace[];
  /** ビート合計獲得スコア */
  gainedScore: number;
  /** ビート後のコンボ（レーン別インデックス 0-4 → L1-L5） */
  comboAfter: readonly number[];
  /** ビート後の残スタミナ（レーン別インデックス 0-4 → L1-L5） */
  staminaAfter: readonly number[];
  /** スコア計算時点のスコアラー（レーン別インデックス 0-4 → L1-L5）実効段数スナップショット */
  buffSnapshots: readonly BuffSnapshot[];
}

/**
 * 段階型バフの集計キー（buffs.ts の段数集計対象）。
 * 段数は実効値（同種加算後・上限適用後）。ステータス系のみ vocal_up_extreme を
 * vocal_up と別キーで保持し（上昇/ブースト別カウント規則・research/01 §2.3）、
 * 合成は buffs.ts 側で行う。
 */
export type BuffKey =
  | "vocal_up"
  | "vocal_boost"
  | "vocal_up_extreme"
  | "vocal_down"
  | "dance_up"
  | "dance_boost"
  | "dance_up_extreme"
  | "dance_down"
  | "visual_up"
  | "visual_boost"
  | "visual_up_extreme"
  | "visual_down"
  | "beat_score_up"
  | "tension_up"
  | "score_up"
  | "a_skill_score_up"
  | "sp_skill_score_up"
  | "p_skill_score_up"
  | "combo_score_up"
  | "critical_coeff_up"
  | "critical_rate_up"
  | "stamina_cost_down"
  | "stamina_cost_up"
  | "skill_success_up"
  | "focus"
  | "stealth"
  | "combo_continue";

/** 1レーンの実効段数スナップショット（全キー必須・未所有は 0） */
export type BuffSnapshot = Record<BuffKey, number>;

/** タイムライン全体の出力 */
export interface TimelineResult {
  totalScore: number;
  beats: BeatTrace[];
  /** 全発動のフラット列（T4 用） */
  activations: ActivationTrace[];
  /** 最終残スタミナ（レーン別インデックス 0-4 → L1-L5） */
  finalStamina: readonly number[];
  /** 最終コンボ（レーン別インデックス 0-4 → L1-L5） */
  finalCombo: readonly number[];
}

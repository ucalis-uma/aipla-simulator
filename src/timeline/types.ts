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

/** スキル種別（skills_golden.json の kind） */
export type SkillKind = "A" | "SP" | "P" | "photo";

/**
 * 効果type（skills_golden.json の type 文字列・P3aでマスタ efficacyType から写像）。
 * 本実測に現れた24種のみを列挙する。未出現の対称型（dance_up 等）は需要が生じた時点で追加。
 */
export type EffectType =
  | "score_get"
  | "score_get_by_score_ratio"
  | "vocal_up"
  | "vocal_boost"
  | "vocal_up_extreme"
  | "tension_up"
  | "tension_limit"
  | "combo_score_up"
  | "combo_score_limit"
  | "critical_coeff_up"
  | "critical_coeff_limit"
  | "critical_rate_up"
  | "a_skill_score_up"
  | "sp_skill_score_up"
  | "stamina_cost_down"
  | "stamina_recovery"
  | "combo_continue"
  | "ct_reduction"
  | "ct_increase"
  | "effect_extension"
  | "effect_amplify"
  | "score_up"
  | "skill_success_up"
  | "focus";

/** 効果の対象（skills_golden.json の target。12種） */
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
  | "vocal_type_3";

/** 発動条件（skills_golden.json の condition。11種） */
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
  | "combo>=100";

/** type36（段階数が多い程）のスケーリング指定 */
export interface EffectScaling {
  /** 参照する段数（例: "vocal_up_stages" = ボーカル上昇の実効段数合計） */
  ref: string;
  /** 1段あたりの SkillPower 加算率 permil。P3c フィッティング前は null（=スケーリングなしで計算） */
  perStagePermil: number | null;
  /** フィッティング済みか（data/skills_golden.json 由来のフラグをそのまま運搬） */
  fitted?: boolean;
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
  /** type36 のスケーリング指定 */
  scaling?: EffectScaling;
  /** 上限解放（同種バフの最大段数を30へ拡張。research/06_test_plan BF2） */
  limitRelease?: boolean;
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
}

/** ステージ入力（data/stages/qt-daily-003-19.json から） */
export interface StageInput {
  id: string;
  /** position 1-5 の属性コード（1=dance, 2=vocal, 3=visual。research/11 実測対応） */
  laneAttributes: readonly number[];
  /** ビート重み permil（標準 600/250/150。research/02 §1.2） */
  beatWeightsPermil: { vocal: number; dance: number; visual: number };
  /** A/SP 重み permil（標準 1000。research/07 §2） */
  skillWeightsPermil: { active: number; special: number };
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
 * 【Unknown】クリティカル率の式は未解明のため、エンジンは判定を外部委譲する。
 * - ゴールデン（Mode R）: measured_data_v2.json critical_flags.beats の黄ポップ抽出を注入
 * - 通常シミュレーション: 実装側で確率ロールを実装（rng.nextCritical() 等）
 */
export type CritProvider = (beat: number, lane: LaneNumber) => boolean;

/** タイムライン全体の入力 */
export interface SimulateInput {
  lanes: readonly LaneInput[];
  notes: readonly ChartNote[];
  stage: StageInput;
  /** 来場ファンボーナス係数 permil（B3。全レーン共通既定。実測 1620） */
  fanFactorPermil: number;
  /** コンボテーブル（既定 data/stages/combo_advantage.json 同期の COMBO_ADVANTAGE_TABLE） */
  comboAdvantageTable?: readonly ComboAdvantageRow[];
  /** 成功率の基礎値 permil（min(1, 席埋率×メンタル/要求) の結果。既定 1000。本実測は全成立） */
  successBasePermil?: number;
  /** クリティカル判定の供給源（必須） */
  criticalProvider: CritProvider;
  /** スコア乱数源（必須。Mode R は FixedRng(1000) 系） */
  rng: ScoreRng;
  /**
   * ミスノート（谱面ノートをプレイヤーが取りこぼした組）。
   * 指定された (beat, lane) のビートは挑戦自体が発生せず、スコア・乱数・レーンコンボも変動しない。
   * T5実測では b1 の L1/L2/L4/L5（LIVE START 直後の取りこぼし。b1 のポップが全レーン null、
   * かつ b1-4 リージョンの達成帯がミスなしでは不成立）。
   */
  missedNotes?: ReadonlyArray<{ beat: number; lane: LaneNumber }>;
  /** 丸めポリシー（既定 "sequential"。T4/T5 で判定） */
  roundingPolicy?: RoundingPolicy;
  /**
   * 【一時・T5調査用】未確定仕様の仮説切替。T5確定後に削除する。
   * - extensionMode: effect_extension の適用範囲（all=延長可能な全インスタンス / longest=最長残りのみ / none=延長なし）
   * - comboBasis: コンボ係数の基準コンボ数（lane=レーン別状態 / global=処理済みビートノート数）
   * - beatSuPermil: ビート B1 の score_up 係数‰/段（既定 25）
   * - beatCsuPermil: ビート CB の combo_score_up 平係数‰/段（既定 11.5。T5実測フィット）
   * - beatCsuAmpPermil: ビート CB のコンボボーナスXに対する csu 連成係数‰/段
   *   （X_eff = X×(1000+amp×csu)/1000。既定 57.5。T5実測フィット）
   * - beatComboBasis: ビート CB の基準コンボ（display=表示コンボ=beat-1【T5確定】/ lane=レーン別）
   * - amplifyMode: effect_amplify の対象選択（perKey=キー毎に最長残り 1 インスタンス【T5確定】/
   *   single=全体で最長 1 インスタンス）
   * - ampAffectsExtreme: 増強の対象に vocal_up_extreme を含むか（実測では false が正）
   * - spDurN1: A/SP（ステップ8）付与の段階型効果が付与ビートのステップ10減算を
   *   スキップするか（実測では true が正）
   */
  debugOptions?: {
    extensionMode?: "all" | "longest" | "none";
    comboBasis?: "lane" | "global";
    beatSuPermil?: number;
    beatCsuPermil?: number;
    beatCsuAmpPermil?: number;
    beatComboBasis?: "lane" | "display";
    amplifyMode?: "single" | "perKey";
    ampAffectsExtreme?: boolean;
    spDurN1?: boolean;
  };
}

/** 発動1件のトレース（T4: 発動ログとの突合用） */
export interface ActivationTrace {
  beat: number;
  /** 処理位相（research/01 §4: first=P前半, main=A/SP/ビート発動, last=P後半） */
  phase: "first" | "main" | "last";
  lane: LaneNumber;
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
  | "tension_up"
  | "score_up"
  | "a_skill_score_up"
  | "sp_skill_score_up"
  | "combo_score_up"
  | "critical_coeff_up"
  | "critical_rate_up"
  | "stamina_cost_down"
  | "skill_success_up"
  | "focus"
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

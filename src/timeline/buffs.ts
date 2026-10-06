/**
 * タイムラインエンジンのバフ集計モジュール（Phase 3b）。
 *
 * レーンに有効な段階型効果（ActiveEffect）から実効段数（BuffSnapshot）を集計し、
 * スコア式の各係数（ライブ中ステータス倍率・消費スタミナ倍率・B1・成功率・
 * ファンボーナス）を千分率整数で算出する純粋関数群。
 *
 * 出典と確度:
 * - 合成=加算・上限超過分は内部保持（付与時に切り捨てない）: 【ユーザー確定 2026-08-30】
 *   「バフは上限段数（通常20段等）を超えて付与されても内部的には切り捨てず超過分を保持する。
 *   計算式・見た目で使う値は上限でクランプされるが、後から一部インスタンスの期限が切れても
 *   内部段数が上限以上であれば上限段数を維持する（例: 19段に+4段→内部23段/表示20段。
 *   次ビートで2段切れても内部21段/表示20段）」。
 *   旧 research/01 §2.2 の「上限超過は付与時に無視」は本確定仕様に訂正される。
 * - 上昇/ブーストは別系統で加算重複（10段+10段=2.25倍）: research/01 §2.3【Confirmed】
 * - B1 の構成: research/02 §1.3（A【Confirmed】/SP【Strong estimate】/P【Estimate】）
 * - 段数上限（基本上限20・テンション/集目/成功率10・vocal_up_extreme 30）と
 *   limit解放（30へ拡張）: research/02 §1.6・research/06 BF2【Confirmed】
 * - テンション副効果（成功率 -1.5%/段）・集目副効果（ファンボーナス 1段+7‰〜10段+50‰・Peing確定）:
 *   research/01 §2.6【Confirmed】
 * - 消費スタミナ（低減 -5%/段・ブースト副効果 +1%/段）: research/01 §2.2・§4-4【Confirmed】
 * - 上限解放変数型（tension_limit 等）の基底キー統合: P3a 写像仕様【Confirmed】
 *
 * 数値規律:
 * - 全て permil（千分率）整数。段数×1段値は「permil 域の整数×整数」で積が厳密なため
 *   そのまま加減算する（mulPermil は「値×率/1000」の適用用であり、率の合成には使わない）。
 *   切り捨てを伴う除算は floorDiv（src/rounding.ts）経由。Math.floor 直書き禁止。
 * - 3.75%/段（skill_success_up）・-1.5%/段（テンション副効果）のような非整数 permil は
 *   constants.ts の 2段単位定数（75‰/30‰ per 2段）+ floorDiv(…, 2) で整数演算に落とす。
 */
import { floorDiv } from "../rounding.js";
import {
  A_SKILL_SCORE_UP_PER_STAGE_PERMIL,
  BEAT_SCORE_UP_PER_STAGE_PERMIL,
  BOOST_STAMINA_COST_PER_STAGE_PERMIL,
  COMBO_SCORE_UP_PER_STAGE_PERMIL,
  CRITICAL_COEFF_UP_PER_STAGE_PERMIL,
  CRITICAL_RATE_UP_PER_STAGE_PERMIL,
  DEFAULT_STAGE_CAP,
  FOCUS_APPEAL_PER_STAGE_PERMIL,
  FOCUS_FAN_BONUS_PERMIL,
  FOCUS_STAGE_CAP,
  LIMIT_RELEASE_STAGE_CAP,
  LIVE_STATUS_MULTIPLIER_CAP,
  P_SKILL_SCORE_UP_PER_STAGE_PERMIL,
  SCORE_UP_PER_STAGE_PERMIL,
  SKILL_SUCCESS_STAGE_CAP,
  SKILL_SUCCESS_UP_PER_2_STAGES_PERMIL,
  SKILL_SUCCESS_UP_PER_STAGE_PERMIL,
  SP_SKILL_SCORE_UP_PER_STAGE_PERMIL,
  STATUS_BOOST_PER_STAGE_PERMIL,
  STATUS_DOWN_PER_STAGE_PERMIL,
  STATUS_UP_EXTREME_PER_STAGE_PERMIL,
  STATUS_UP_PER_STAGE_PERMIL,
  STEALTH_FAN_BONUS_PERMIL,
  STAMINA_COST_DOWN_PER_STAGE_PERMIL,
  STAMINA_COST_UP_PER_STAGE_PERMIL,
  TENSION_STAGE_CAP,
  TENSION_SUCCESS_DOWN_PER_2_STAGES_PERMIL,
  TENSION_UP_PER_STAGE_PERMIL,
} from "./constants.js";
import type { BuffKey, BuffSnapshot, EffectType, LaneAttribute, LaneNumber } from "./types.js";

/**
 * レーンに有効な段階型効果1件（skills_golden.json 由来の SkillEffect を
 * タイムラインエンジンが展開したもの。即時型・スコア取得型は渡さない）。
 */
export interface ActiveEffect {
  /** 元の効果型（skills_golden.json 由来） */
  type: EffectType;
  /**
   * 段数（0は不可、即時型はそもそも渡さない）。
   * 【ユーザー確定 2026-08-30】付与時に上限で切り捨てない（超過分を保持する内部段数）。
   * クランプは aggregateBuffs がスナップショット生成時に行う。
   */
  stages: number;
  /** 上限解放（同種バフの最大段数を30へ拡張。research/06 BF2） */
  limitRelease?: boolean;
  /** 残りビート（呼び出し側が有効なものだけ渡す。>0 前提） */
  remainingBeats: number;
  /** 出所スキルID（トレース用） */
  sourceSkillId: string;
  /**
   * 【Phase 8-B4】付与レーン（与・○○延長/増強の「自分が付与した効果」判定用）。
   * ライブボーナスはレーン非所属のため 3（センター・engine がアンカーに使用する値）を記録。
   */
  sourceLane: LaneNumber;
  /**
   * 【T5実測確定 2026-08-30】付与ビートのステップ10減算をスキップするフラグ。
   * A/SP（ステップ8発動）の段階型効果はステップ10で減算されない
   * （根拠: fest-03-2 の vocal_up_extreme+10[36b] が b2 付与で b38 まで有効 =
   * 37 ビート。減算ありだと b37 まで = 36 ビートで stat 倍率系列と矛盾）。
   * P 前半（ステップ7）は減算対象（表記−1）・P 後半（ステップ11）は
   * 減算対象外（ステップ10 を既に通過）。
   */
  skipFirstDecay?: boolean;
  /**
   * 【Peing確定 2026-08-31・2026-09-02 修正】超化（capExtend）による上限拡張量。
   * 超化は独立インスタンスではなく同種バフ最長インスタンスへの増強型のため、
   * 加算を受け取ったインスタンスの生存中は同種バフの上限をこの量ぶん拡張する
   * （通常上限20 → 実効25。テンション10 → 15）。
   * aggregateBuffs が key ごとの最大拡張量を上限に加算する。
   * engine は number（超化加算量）を設定する。true の場合は stages を
   * 拡張量とみなす（テスト用・旧形式の互換）。
   */
  capExtend?: boolean | number;
}

/** 効果型 → 集計キーの写像結果 */
export interface BuffKeyMapping {
  key: BuffKey;
  /** 上限解放変数型（tension_limit 等）は基底キーへ統合され true になる */
  limitRelease: boolean;
}

/**
 * 段階型 EffectType → BuffKey 対応表（research/01 §2.2 の [S1] Buffs表準拠）。
 *
 * - 通常型は同名キーへ写像。
 * - 上限解放変数型は基底キーへ統合し limitRelease=true（P3a 写像仕様【Confirmed】）:
 *   tension_limit→tension_up / combo_score_limit→combo_score_up / critical_coeff_limit→critical_coeff_up。
 * - vocal_up_extreme は独立キーのまま（上限30固定・1段値は vocal_up と同じ50‰。
 *   research/06 BF2: >20段の出現は上限解放効果と同時でなくても観測される）。
 * - スコア取得・即時系（score_get, score_get_by_score_ratio, stamina_recovery,
 *   ct_reduction, ct_increase, effect_extension, effect_amplify, effect_passing）は
 *   対象外（登録なし→null）。
 */
const STAGED_BUFF_KEY_MAP: ReadonlyMap<EffectType, BuffKeyMapping> = new Map<
  EffectType,
  BuffKeyMapping
>([
  ["vocal_up", { key: "vocal_up", limitRelease: false }],
  ["vocal_boost", { key: "vocal_boost", limitRelease: false }],
  ["vocal_up_extreme", { key: "vocal_up_extreme", limitRelease: false }],
  ["vocal_down", { key: "vocal_down", limitRelease: false }],
  ["dance_up", { key: "dance_up", limitRelease: false }],
  ["dance_boost", { key: "dance_boost", limitRelease: false }],
  ["dance_up_extreme", { key: "dance_up_extreme", limitRelease: false }],
  ["dance_down", { key: "dance_down", limitRelease: false }],
  ["visual_up", { key: "visual_up", limitRelease: false }],
  ["visual_boost", { key: "visual_boost", limitRelease: false }],
  ["visual_up_extreme", { key: "visual_up_extreme", limitRelease: false }],
  ["visual_down", { key: "visual_down", limitRelease: false }],
  ["beat_score_up", { key: "beat_score_up", limitRelease: false }],
  ["tension_up", { key: "tension_up", limitRelease: false }],
  ["score_up", { key: "score_up", limitRelease: false }],
  ["a_skill_score_up", { key: "a_skill_score_up", limitRelease: false }],
  ["sp_skill_score_up", { key: "sp_skill_score_up", limitRelease: false }],
  ["p_skill_score_up", { key: "p_skill_score_up", limitRelease: false }],
  ["combo_score_up", { key: "combo_score_up", limitRelease: false }],
  ["critical_coeff_up", { key: "critical_coeff_up", limitRelease: false }],
  ["critical_rate_up", { key: "critical_rate_up", limitRelease: false }],
  ["stamina_cost_down", { key: "stamina_cost_down", limitRelease: false }],
  ["stamina_cost_up", { key: "stamina_cost_up", limitRelease: false }],
  ["skill_success_up", { key: "skill_success_up", limitRelease: false }],
  ["focus", { key: "focus", limitRelease: false }],
  ["stealth", { key: "stealth", limitRelease: false }],
  ["combo_continue", { key: "combo_continue", limitRelease: false }],
  // 上限解放変数型（基底キーへ統合・P3a 写像仕様）
  ["tension_limit", { key: "tension_up", limitRelease: true }],
  ["combo_score_limit", { key: "combo_score_up", limitRelease: true }],
  ["critical_coeff_limit", { key: "critical_coeff_up", limitRelease: true }],
]);

/**
 * 段階型 EffectType の BuffKey 写像を返す。
 *
 * @param type 効果型（skills_golden.json 由来）
 * @returns 段階型なら写像結果、スコア取得・即時系なら null（段数集計の対象外）
 */
export function mapEffectToBuffKey(type: EffectType): BuffKeyMapping | null {
  return STAGED_BUFF_KEY_MAP.get(type) ?? null;
}

/** BuffKey ごとの1段あたり値（permil）。出典は各定数の JSDoc 参照 */
const PER_STAGE_PERMIL_BY_KEY: Record<BuffKey, number> = {
  vocal_up: STATUS_UP_PER_STAGE_PERMIL,
  vocal_up_extreme: STATUS_UP_EXTREME_PER_STAGE_PERMIL,
  vocal_boost: STATUS_BOOST_PER_STAGE_PERMIL,
  vocal_down: STATUS_DOWN_PER_STAGE_PERMIL,
  dance_up: STATUS_UP_PER_STAGE_PERMIL,
  dance_up_extreme: STATUS_UP_EXTREME_PER_STAGE_PERMIL,
  dance_boost: STATUS_BOOST_PER_STAGE_PERMIL,
  dance_down: STATUS_DOWN_PER_STAGE_PERMIL,
  visual_up: STATUS_UP_PER_STAGE_PERMIL,
  visual_up_extreme: STATUS_UP_EXTREME_PER_STAGE_PERMIL,
  visual_boost: STATUS_BOOST_PER_STAGE_PERMIL,
  visual_down: STATUS_DOWN_PER_STAGE_PERMIL,
  beat_score_up: BEAT_SCORE_UP_PER_STAGE_PERMIL,
  tension_up: TENSION_UP_PER_STAGE_PERMIL,
  score_up: SCORE_UP_PER_STAGE_PERMIL,
  a_skill_score_up: A_SKILL_SCORE_UP_PER_STAGE_PERMIL,
  sp_skill_score_up: SP_SKILL_SCORE_UP_PER_STAGE_PERMIL,
  p_skill_score_up: P_SKILL_SCORE_UP_PER_STAGE_PERMIL,
  combo_score_up: COMBO_SCORE_UP_PER_STAGE_PERMIL,
  critical_coeff_up: CRITICAL_COEFF_UP_PER_STAGE_PERMIL,
  critical_rate_up: CRITICAL_RATE_UP_PER_STAGE_PERMIL,
  stamina_cost_down: STAMINA_COST_DOWN_PER_STAGE_PERMIL,
  stamina_cost_up: STAMINA_COST_UP_PER_STAGE_PERMIL,
  skill_success_up: SKILL_SUCCESS_UP_PER_STAGE_PERMIL,
  focus: FOCUS_APPEAL_PER_STAGE_PERMIL,
  // ステルス自体の段値は「ファン引力度 -5%/段」（来場者数の動的モデルが無いため未使用）。
  // 実装する副効果（他4レーンのファンボーナス加算）は stealthFanBonusPermil のテーブル参照。
  stealth: STATUS_DOWN_PER_STAGE_PERMIL,
  combo_continue: 0,
};

/**
 * 1段あたりの値（permil）を返す。
 *
 * - skill_success_up のみ 37.5（非整数 permil）を返す【Confirmed】。これは表示用の
 *   公称値であり、実際の成功率計算は successRatePermil が 2段単位定数で行う。
 * - 上限解放変数型は基底キーの値（tension_limit→50 等。1段値は上限と無関係）。
 * - スコア取得・即時系は段数を持たないため throw（呼び出し側契約違反）。
 *
 * @param type 効果型
 * @param limitRelease 上限解放（1段値には影響しない・引数整合のため受ける）
 */
export function stageCapPermil(type: EffectType, limitRelease: boolean): number {
  void limitRelease;
  const mapped = mapEffectToBuffKey(type);
  if (mapped === null) {
    throw new Error(`stageCapPermil: non-staged effect type: ${type}`);
  }
  return PER_STAGE_PERMIL_BY_KEY[mapped.key];
}

/**
 * 基本の段数上限（limit解放前）。research/02 §1.6・research/06 BF2【Confirmed】。
 * - vocal_up_extreme: 30（最初から30固定。解放変数型ではない）
 * - tension_up / focus / skill_success_up / stealth: 10
 * - その他の段階型: 20
 */
function baseStageCap(type: EffectType): number {
  switch (type) {
    case "vocal_up_extreme":
    case "dance_up_extreme":
    case "visual_up_extreme":
      return LIMIT_RELEASE_STAGE_CAP;
    case "tension_up":
    case "tension_limit":
      return TENSION_STAGE_CAP;
    case "focus":
    case "stealth":
      return FOCUS_STAGE_CAP;
    case "skill_success_up":
      return SKILL_SUCCESS_STAGE_CAP;
    default:
      return DEFAULT_STAGE_CAP;
  }
}

/**
 * 上限段数を返す。
 *
 * - 基本は baseStageCap（20 / 10系 / vocal_up_extreme 30）。
 * - limitRelease=true または type 自体が上限解放変数型（tension_limit 等）のときは
 *   max(基本上限, 30) = 30 へ拡張（research/02 §1.6・research/06 BF2【Confirmed】）。
 * - スコア取得・即時系は段数を持たないため throw。
 */
export function stageCap(type: EffectType, limitRelease: boolean): number {
  const mapped = mapEffectToBuffKey(type);
  if (mapped === null) {
    throw new Error(`stageCap: non-staged effect type: ${type}`);
  }
  const base = baseStageCap(type);
  if (limitRelease || mapped.limitRelease) {
    return Math.max(base, LIMIT_RELEASE_STAGE_CAP);
  }
  return base;
}

/** 未所有キー 0 の空スナップショット（全24キー必須・types.ts の BuffKey 順） */
function emptySnapshot(): BuffSnapshot {
  return {
    vocal_up: 0,
    vocal_boost: 0,
    vocal_up_extreme: 0,
    vocal_down: 0,
    dance_up: 0,
    dance_boost: 0,
    dance_up_extreme: 0,
    dance_down: 0,
    visual_up: 0,
    visual_boost: 0,
    visual_up_extreme: 0,
    visual_down: 0,
    beat_score_up: 0,
    tension_up: 0,
    score_up: 0,
    a_skill_score_up: 0,
    sp_skill_score_up: 0,
    p_skill_score_up: 0,
    combo_score_up: 0,
    critical_coeff_up: 0,
    critical_rate_up: 0,
    stamina_cost_down: 0,
    stamina_cost_up: 0,
    skill_success_up: 0,
    focus: 0,
    stealth: 0,
    combo_continue: 0,
  };
}

/**
 * アクティブ効果から実効段数スナップショットを集計する（純粋関数）。
 *
 * 規則:
 * - 同一 BuffKey の段数は加算（research/01 §2.2「合成: 加算」【Confirmed】）。
 *   同型複数インスタンスも合算（例: vocal_up 5段×2ソース=10段）。
 * - 【ユーザー確定 2026-08-30】上限超過分は付与時に切り捨てず内部保持する。
 *   呼び出し側（engine.applyEffect / amplifyLongestRemaining）は effect.stages を
 *   切り捨てずに保持し、期限切れはインスタンス単位で除去する。本関数は「合算後に
 *   上限でクランプした値」＝計算式・見た目で使う表示値のみを返す。
 *   これにより「19段に+4段→内部23/表示20 → 2段期限切れ→内部21/表示20」の
 *   保持セマンティクスが成立する（インスタンス配列が内部段数の真実源）。
 *   cap はその key への寄与の中で最も大きいもの（=limit解放があれば30）を使う。
 * - combo_continue は段数ではなく「有効インスタンス数」を入れる
 *   （保護は ≥1 で成立。research/01 §2.2 の効果表では段数を持たない特殊効果）。
 * - 未所有キーは 0。戻り値は全24キーを必ず持つ（BuffSnapshot 契約）。
 * - 上限解放変数型（tension_limit 等）は基底キーに合算される。
 *
 * @param active レーンに有効な段階型効果（remainingBeats>0 のもののみ。即時型は不可）
 * @returns 実効段数スナップショット（全24キー・上限クランプ済みの表示値）
 */
export function aggregateBuffs(active: readonly ActiveEffect[]): BuffSnapshot {
  const snapshot = emptySnapshot();
  const caps = new Map<BuffKey, number>();
  // 【T5実測確定 2026-08-30】上限解放変数型（tension_limit 等）の stages は
  // 「上限解放量（+N 段）」。実効 cap = 基本上限 + 解放量（最大のインスタンス値）。
  // 根拠: テンション上限 = 10+5 = 15 段（やすらぎの tension_limit+5、実測 b101+ で
  // テンション表示 15 固定）・コンボスコア上昇上限 = 20+10 = 30 段（かんしょ
  // combo_score_limit+10、実測 30 固定）・クリティカル係数上限 = 20+10 = 30 段
  // （ハスハス critical_coeff_limit+10、実測 30 固定）。旧仕様「解放で一律 30」は
  // テンション 15 と矛盾するため本仕様に訂正。
  const releases = new Map<BuffKey, number>();
  // 【Peing確定 2026-08-31】超化（capExtend）インスタンスの段数ぶん同種バフの上限を拡張する。
  // 複数の超化が同キーに付与された場合は最大値を採用（「効果は常に一定」の解釈・上限解放
  // releases と同方針。加算説は資料が無いため未採用）。
  const extensions = new Map<BuffKey, number>();
  for (const effect of active) {
    if (!Number.isInteger(effect.stages) || effect.stages <= 0) {
      throw new Error(
        `aggregateBuffs: stages must be a positive integer, got ${effect.stages} (type=${effect.type})`,
      );
    }
    if (!Number.isInteger(effect.remainingBeats) || effect.remainingBeats <= 0) {
      throw new Error(
        `aggregateBuffs: remainingBeats must be a positive integer, got ${effect.remainingBeats} (type=${effect.type})`,
      );
    }
    const mapped = mapEffectToBuffKey(effect.type);
    if (mapped === null) {
      throw new Error(`aggregateBuffs: non-staged effect type: ${effect.type}`);
    }
    const isVarType = mapped.limitRelease;
    const cap = isVarType ? baseStageCap(effect.type) : stageCap(effect.type, effect.limitRelease === true);
    const prevCap = caps.get(mapped.key);
    caps.set(mapped.key, prevCap === undefined ? cap : Math.max(prevCap, cap));
    if (effect.capExtend) {
      // 【2026-09-02 修正】超化は増強型: 加算を受けたインスタンスの capExtend =
      // 超化による加算量（段数ではない）。engine 外で作られるテスト用インスタンス
      // （capExtend=true + 段数=超化量 の旧形式）は stages フォールバックで同一動作。
      const extAmount = typeof effect.capExtend === "number" ? effect.capExtend : effect.stages;
      const prevExt = extensions.get(mapped.key) ?? 0;
      extensions.set(mapped.key, Math.max(prevExt, extAmount));
    }
    if (mapped.key === "combo_continue") {
      snapshot.combo_continue += 1;
    } else if (isVarType) {
      // 上限解放変数型（tension_limit 等）は段数を加算せず、stages を「解放量」として記録。
      // 【実測根拠は releases の JSDoc 参照。b2 の Aスキル検算（csu 6段+limit10 を 16段
      // とすると 41.8M = 乱数域外、6段なら 25.7M で整合）も解放=段数加算なしを支持】
      const prevRel = releases.get(mapped.key) ?? 0;
      releases.set(mapped.key, Math.max(prevRel, effect.stages));
    } else if (effect.limitRelease === true) {
      // 【サンプル3・2026-09-03】limit_break 行（基底型+limitRelease）は上限解放のみで
      // 段数は加算しない（L1A「手を伸ばすのは輝く夢」: b53/b61/b81 の上昇 11/15/15 が
      // lr +10 を除いた 4+3+4 系でのみ一致。マスタ技能文も「10段階上限解放効果」と
      // 「4段階上昇効果」を分離記載。*_limit 変数型・T5 b2 ccu 検算と同一規則）。
      // 上限自体は caps 側の stageCap(type, true) で拡張済みのためここでは何もしない。
    } else {
      snapshot[mapped.key] += effect.stages;
    }
  }
  for (const [key, cap] of caps) {
    const rel = releases.get(key) ?? 0;
    const ext = extensions.get(key) ?? 0;
    snapshot[key] = Math.min(snapshot[key], cap + rel + ext);
  }
  return snapshot;
}

/**
 * ライブ中ステータス倍率（permil）を返す（research/01 §2.2・§2.4【Confirmed】）。
 *
 *   1000 + 50×(上昇段) + 50×(超化段) + 75×(ブースト段) − 50×(低下段)
 *
 * - attr=vocal: 上昇 = vocal_up、超化 = vocal_up_extreme、ブースト = vocal_boost、
 *   低下 = vocal_down。
 * - attr=dance/visual: vocal の対称拡張（Phase 6 マスタ一般化＋Phase 9 低下追加・
 *   【Estimate】実測に dance/visual バフの発動なし。同式で対称実装）。
 * - 【Peing確定 2026-08-31】超化（vocal_up_extreme）は 1段 50‰（元バフと同値）で
 *   常に+5段階分=+250‰（定数 JSDoc 参照。旧 25‰×表記段数説は訂正・合計値は同一）。
 * - 【T5実測確定 2026-08-30】倍率は 3750‰（×3.75）でクランプ。
 */
export function liveStatusMultiplierPermil(
  snapshot: BuffSnapshot,
  attr: LaneAttribute,
): number {
  const upStages =
    attr === "vocal"
      ? snapshot.vocal_up
      : attr === "dance"
        ? snapshot.dance_up
        : snapshot.visual_up;
  const extremeStages =
    upStages > 0
      ? attr === "vocal"
        ? (snapshot.vocal_up_extreme ?? 0)
        : attr === "dance"
          ? (snapshot.dance_up_extreme ?? 0)
          : (snapshot.visual_up_extreme ?? 0)
      : 0;
  const boostStages =
    attr === "vocal"
      ? snapshot.vocal_boost
      : attr === "dance"
        ? snapshot.dance_boost
        : snapshot.visual_boost;
  const downStages =
    attr === "vocal"
      ? snapshot.vocal_down
      : attr === "dance"
        ? snapshot.dance_down
        : snapshot.visual_down;
  const raw =
    1000 +
    STATUS_UP_PER_STAGE_PERMIL * upStages +
    STATUS_UP_EXTREME_PER_STAGE_PERMIL * extremeStages +
    STATUS_BOOST_PER_STAGE_PERMIL * boostStages -
    STATUS_DOWN_PER_STAGE_PERMIL * downStages;
  // 【T5実測確定 2026-08-30】ライブ中ステータス倍率は 3750‰（×3.75）でクランプされる。
  // research/08 §3: L3 stat_value は b68-156 の全 30 サンプルで 2,348,336 = floor(626,223×3.75)
  // に完全固定（この間 b101 の増強等で段数が増えても表示無反応）= 「×3.75（+275%）という
  // 端数のない上限値そのものが上限解放仕様（ボーカル上昇の上昇上限）」。
  // 計算式・見た目で使う値は上限でクランプされる（ユーザー確定 2026-08-30 の over-cap 保持
  // 仕様と整合: 内部段数は超過を保持し、表示・計算は上限値）。
  return Math.min(raw, LIVE_STATUS_MULTIPLIER_CAP);
}

/**
 * 消費スタミナ倍率（permil）を返す（research/01 §2.2「消費スタミナ+1%/段」・§4-4【Confirmed】）。
 *
 *   1000 − 50×stamina_cost_down + 50×stamina_cost_up + 10×(vocal+dance+visual のブースト段数合計)
 *
 * - 【Peing確定 2026-08-31】消費増加（stamina_consumption_increase）は「スタミナ消費量に
 *   最大2倍の補正が入る低下効果」（質問箱 id=1190040607）。50‰×20段=+1000‰=2倍で
 *   上限と整合。バトル主体だが self 対象のものがスコアライブでも消費に乗る
 *
 * - ブースト副効果（消費 +1%/段）は**属性不問**（レーンに乗っている全属性のブースト段数を合計）
 *   【実測確定 2026-10-02: S3 の visual レーンに vocal ブースト 5 段が乗ったセルで
 *   実測 2,085 = floor(662×3)×1.05 / 1,449 = floor(460×3)×1.05（engine は旧・自属性のみで
 *   1,986 / 1,380）。多属性同時は「足し算」で確定（ユーザー確認 2026-10-02・2 件サンプル）。
 *   → 旧確定事項「消費のブースト副効果は自属性ブーストのみ」（Phase12 追補3）は**反証**。
 *   S3 L4 の visual_boost 3/6/9 段セル（1884/1939/1386）は自属性ブーストの特殊例で、
 *   本式でも同じ値になる（回帰セル）。
 * - attr 引数は 2026-10-02 に**撤去**（属性で結果が変わらなくなったため）。
 * - vocal_up_extreme は含めない
 *   （research/01 §2.3 の表は「ブースト」行の副効果。extreme は上昇系の 30段上限版）。
 * - 【Unknown】stamina_cost_down が上限解放で30段に達すると 1000−1500 = −500 と
 *   負になり得る。ゲーム本体の負値時の挙動（0 クランプ等）は未観測のため
 *   本実装ではクランプしない（呼び出し側の消費計算で保護すること）。
 */
export function consumptionMultiplierPermil(snapshot: BuffSnapshot): number {
  const boost = snapshot.vocal_boost + snapshot.dance_boost + snapshot.visual_boost;
  return (
    1000 -
    STAMINA_COST_DOWN_PER_STAGE_PERMIL * snapshot.stamina_cost_down +
    STAMINA_COST_UP_PER_STAGE_PERMIL * snapshot.stamina_cost_up +
    BOOST_STAMINA_COST_PER_STAGE_PERMIL * boost
  );
}

/** B1 の対象スコアボーナス%合算 permil（LaneInput.scoreBonusPct と同型。エール+フォト） */
export interface ScoreBonusPct {
  beat: number;
  active: number;
  special: number;
  passive: number;
}

/** B1 を求める対象スコア種（ビート/A/SP/P） */
export type B1Kind = "beat" | "active" | "special" | "passive";

/**
 * B1 スコアボーナス（permil）を返す（research/02 §1.3）。
 *
 * 各対象式（1000 + 各種上昇バフ + テンション + エール/フォト% の加算合算）:
 * - beat:    1000 + 25×score_up + 100×beat_score_up + bonus.beat
 *   テンションはビートに入らない（S2明記・research/02 §1.3【Confirmed】）。
 *   score_up の 25‰/段係数は T5実測で確定（su 50‰ 説は 80.6%→88.6% の離散整合率低下で棄却）。
 *   beat_score_up（100‰/段・research/02 §1.3）は T5 実測編成に未出現のため検証は間接的
 *   （定数準拠・【Estimate】）。
 * - active:  1000 + 50×a_skill_score_up + 25×score_up + 50×tension_up + bonus.active
 *   （research/02 §1.3【Confirmed・A】）
 * - special: 1000 + 30×sp_skill_score_up + 25×score_up + 50×tension_up + bonus.special
 *   （research/02 §1.3【Strong estimate・SP】）
 * - passive: 1000 + 100×p_skill_score_up + 25×score_up + bonus.passive
 *   （research/02 §1.3【Estimate・P】。Pスキルスコアアップ型は 1段 +10%
 *   （P_SKILL_SCORE_UP_PER_STAGE_PERMIL=100。Phase 9 でマスタ passive_skill_score_up に対応）
 */
export function b1Permil(
  snapshot: BuffSnapshot,
  kind: B1Kind,
  scoreBonusPct: ScoreBonusPct,
): number {
  switch (kind) {
    case "beat":
      return (
        1000 +
        SCORE_UP_PER_STAGE_PERMIL * snapshot.score_up +
        BEAT_SCORE_UP_PER_STAGE_PERMIL * snapshot.beat_score_up +
        scoreBonusPct.beat
      );
    case "active":
      return (
        1000 +
        A_SKILL_SCORE_UP_PER_STAGE_PERMIL * snapshot.a_skill_score_up +
        SCORE_UP_PER_STAGE_PERMIL * snapshot.score_up +
        TENSION_UP_PER_STAGE_PERMIL * snapshot.tension_up +
        scoreBonusPct.active
      );
    case "special":
      return (
        1000 +
        SP_SKILL_SCORE_UP_PER_STAGE_PERMIL * snapshot.sp_skill_score_up +
        SCORE_UP_PER_STAGE_PERMIL * snapshot.score_up +
        TENSION_UP_PER_STAGE_PERMIL * snapshot.tension_up +
        scoreBonusPct.special
      );
    case "passive":
      return (
        1000 +
        P_SKILL_SCORE_UP_PER_STAGE_PERMIL * snapshot.p_skill_score_up +
        SCORE_UP_PER_STAGE_PERMIL * snapshot.score_up +
        scoreBonusPct.passive
      );
  }
}

/**
 * スキル成功率（permil）を返す。
 *
 *   min(1000, max(0, base + 3.75%×skill_success_up段 − 1.5%×tension_up段))
 *
 * - 3.75%/段（research/01 §2.2【Confirmed】）は非整数 permil のため 2段単位定数
 *   SKILL_SUCCESS_UP_PER_2_STAGES_PERMIL（=75‰/2段）と floorDiv(…, 2) で整数演算。
 * - テンション副効果 -1.5%/段（research/01 §2.6【Confirmed】）も同様に
 *   TENSION_SUCCESS_DOWN_PER_2_STAGES_PERMIL（=30‰/2段）を使用。
 * - 結果は [0, 1000] にクランプ（成功率は率のため）。
 */
export function successRatePermil(snapshot: BuffSnapshot, successBasePermil: number): number {
  const up = floorDiv(SKILL_SUCCESS_UP_PER_2_STAGES_PERMIL * snapshot.skill_success_up, 2);
  const tensionDown = floorDiv(
    TENSION_SUCCESS_DOWN_PER_2_STAGES_PERMIL * snapshot.tension_up,
    2,
  );
  return Math.min(1000, Math.max(0, successBasePermil + up - tensionDown));
}

/**
 * docs「来場ファン数のボーナス」gid=969532646 の累積セグメント
 * （0.1% あたりファン数: 10→20→40→2.5→50→100。確認値と全一致:
 *  20人=0.2% / 200=2.0% / 1000=10.0% / 16,000=62.0% / 20,000=70.0% / 25,091=75.0%）。
 * data/stages/fan_bonus.json と同期（test で照合）。
 */
export const FAN_BONUS_SEGMENTS: readonly { upToFans: number | null; fansPer0_1Pct: number }[] = [
  { upToFans: 1000, fansPer0_1Pct: 10 },
  { upToFans: 5000, fansPer0_1Pct: 20 },
  { upToFans: 9800, fansPer0_1Pct: 40 },
  { upToFans: 10000, fansPer0_1Pct: 2.5 },
  { upToFans: 20000, fansPer0_1Pct: 50 },
  { upToFans: null, fansPer0_1Pct: 100 },
];

/** ファン数 → スコアボーナス ‰（1000 を含まない増分。docs 累積セグメントで検算済み） */
export function fanBonusPermilFromCount(fans: number): number {
  let prev = 0;
  let pct = 0;
  for (const s of FAN_BONUS_SEGMENTS) {
    const end = s.upToFans ?? fans;
    const span = Math.min(fans, end) - prev;
    if (span > 0) {
      // docs は 0.1% 刻み → セグメント内のステップ数を floor（例 25,091人 → +5.0% ちょうど）
      pct += Math.floor(span / s.fansPer0_1Pct) * 0.1;
    }
    prev = end;
    if (s.upToFans === null || fans <= s.upToFans) {
      break;
    }
  }
  return Math.round(pct * 10);
}

/**
 * 引力度（‰）: 1000 + 50×集目 − 50×ステルス。
 * docs（gid=969532646）:「集目効果とステルス効果で 1 段階あたり ±5% の変動。
 * ファン数は「自分の引力度」と「全 5 人の引力度」の割合で分布」
 */
export function attractPermil(focusStages: number, stealthStages: number): number {
  return 1000 + 50 * focusStages - 50 * stealthStages;
}

/**
 * 【2026-09-01 docs 引力式】B3 ファンファクター（‰）。
 *   自レーン来場数 = baseCount × 5 × 自引力度 / Σ引力度（全 5 レーン）
 *   → fan_bonus 表（fanBonusPermilFromCount）→ +1000
 *   → 集目固定加算（focusFanBonusPermil、Peing 0.7/0.3 テーブル）を加算。
 * 検算: 16,000人・集目10段（150%, 他4人 100%）→ 21,818人 → 71.8% → 71.8+5.0 = 76.8%（T5 実測 1768 ✓）
 *
 * @param baseCount 1 アイドルあたりの基礎来場ファン数（容量/5）
 * @param focus 自レーンの集目段数
 * @param stealth 自レーンのステルス段数
 * @param others 他 4 レーンの { focus, stealth }
 */
export function fanFactorPermilByAttraction(
  baseCount: number,
  focus: number,
  stealth: number,
  others: readonly { focus: number; stealth: number }[],
): number {
  const self = attractPermil(focus, stealth);
  let sum = self;
  for (const o of others) {
    sum += attractPermil(o.focus, o.stealth);
  }
  const count = Math.max(0, Math.round((baseCount * 5 * self) / sum));
  return 1000 + fanBonusPermilFromCount(count) + focusFanBonusPermil(focus);
}

/** 集目（focus）副効果のファンボーナス（permil）を返す。
 *
 * 【Peing確定 2026-08-31・research/16 §2】「1〜5段は +0.7%/段、6〜10段は +0.3%/段」
 * （最大+5.0%）。FOCUS_FAN_BONUS_PERMIL = [7,14,21,28,35,38,41,44,47,50] を
 * 「インデックス=段数-1」で参照する。旧 research/01 §2.6 の「3段+2.1%〜10段+5.0%」
 * （1-2段=0 の部分観測テーブル）は本確定値に訂正。
 *
 * @param focusStages 集目の実効段数（0 以上の整数）
 * @returns ファンボーナス permil（0段=0、1段=7、6段=38、10段以上=50 で頭打ち）
 */
export function focusFanBonusPermil(focusStages: number): number {
  if (!Number.isInteger(focusStages) || focusStages < 0) {
    throw new Error(`focusFanBonusPermil: focusStages must be a non-negative integer, got ${focusStages}`);
  }
  if (focusStages <= 0) {
    return 0;
  }
  if (focusStages >= FOCUS_STAGE_CAP) {
    const maxBonus = FOCUS_FAN_BONUS_PERMIL[FOCUS_FAN_BONUS_PERMIL.length - 1];
    return maxBonus ?? 50;
  }
  const bonus = FOCUS_FAN_BONUS_PERMIL[focusStages - 1];
  if (bonus === undefined) {
    throw new Error(`focusFanBonusPermil: no table entry for focusStages=${focusStages}`);
  }
  return bonus;
}

/**
 * ステルス（stealth）副効果のファンボーナス（permil）を返す。
 *
 * ステルス中のレーン**以外**の4レーンのファンボーナス（B3）に加算される
 * （research/01 §2.6「他4人のファンボーナス+」）。
 * 【Peing確定 2026-08-31】5段=+1.8% / 6段=+2.1% / 10段=+3.7%、
 * 6→10段は +0.4%/段で一意確定（7段=25・8段=29・9段=33）。
 * 1〜4段は資料が無いため【Unknown】→ 0 近似（STEALTH_FAN_BONUS_PERMIL 参照）。
 *
 * @param stealthStages ステルスの実効段数（0 以上の整数）
 */
export function stealthFanBonusPermil(stealthStages: number): number {
  if (!Number.isInteger(stealthStages) || stealthStages < 0) {
    throw new Error(
      `stealthFanBonusPermil: stealthStages must be a non-negative integer, got ${stealthStages}`,
    );
  }
  if (stealthStages <= 0) {
    return 0;
  }
  if (stealthStages >= STEALTH_FAN_BONUS_PERMIL.length) {
    const maxBonus = STEALTH_FAN_BONUS_PERMIL[STEALTH_FAN_BONUS_PERMIL.length - 1];
    return maxBonus ?? 37;
  }
  const bonus = STEALTH_FAN_BONUS_PERMIL[stealthStages - 1];
  if (bonus === undefined) {
    throw new Error(`stealthFanBonusPermil: no table entry for stealthStages=${stealthStages}`);
  }
  return bonus;
}

/**
 * 来場ファンボーナス係数（permil）を返す。
 *
 *   basePermil + focusFanBonusPermil(focusStages)
 *
 * 集目の副効果はファンボーナス項（B3）に加算される
 * （research/01 §2.6「ファンボーナス項に加算」【Confirmed】・research/02 §1.10）。
 * ステルス（他4人へのボーナス）は本実測に未出現のため未実装（constants.ts 参照）。
 *
 * @param basePermil テーブル引き済みの基本ファンファクター permil（例: 1620）
 * @param focusStages 集目の実効段数
 */
export function fanFactorPermil(basePermil: number, focusStages: number): number {
  if (!Number.isInteger(basePermil) || basePermil < 0) {
    throw new Error(`fanFactorPermil: basePermil must be a non-negative integer, got ${basePermil}`);
  }
  return basePermil + focusFanBonusPermil(focusStages);
}

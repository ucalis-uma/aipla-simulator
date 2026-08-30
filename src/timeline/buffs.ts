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
 * - テンション副効果（成功率 -1.5%/段）・集目副効果（ファンボーナス 3段+21‰〜10段+50‰）:
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
  SCORE_UP_PER_STAGE_PERMIL,
  SKILL_SUCCESS_STAGE_CAP,
  SKILL_SUCCESS_UP_PER_2_STAGES_PERMIL,
  SKILL_SUCCESS_UP_PER_STAGE_PERMIL,
  SP_SKILL_SCORE_UP_PER_STAGE_PERMIL,
  STATUS_BOOST_PER_STAGE_PERMIL,
  STATUS_DOWN_PER_STAGE_PERMIL,
  STATUS_UP_EXTREME_PER_STAGE_PERMIL,
  STATUS_UP_PER_STAGE_PERMIL,
  STAMINA_COST_DOWN_PER_STAGE_PERMIL,
  STAMINA_COST_UP_PER_STAGE_PERMIL,
  TENSION_STAGE_CAP,
  TENSION_SUCCESS_DOWN_PER_2_STAGES_PERMIL,
  TENSION_UP_PER_STAGE_PERMIL,
} from "./constants.js";
import type { BuffKey, BuffSnapshot, EffectType, LaneAttribute } from "./types.js";

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
   * 【T5実測確定 2026-08-30】付与ビートのステップ10減算をスキップするフラグ。
   * A/SP（ステップ8発動）の段階型効果はステップ10で減算されない
   * （根拠: fest-03-2 の vocal_up_extreme+10[36b] が b2 付与で b38 まで有効 =
   * 37 ビート。減算ありだと b37 まで = 36 ビートで stat 倍率系列と矛盾）。
   * P 前半（ステップ7）は減算対象（表記−1）・P 後半（ステップ11）は
   * 減算対象外（ステップ10 を既に通過）。
   */
  skipFirstDecay?: boolean;
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
 *   ct_reduction, ct_increase, effect_extension, effect_amplify）は対象外（登録なし→null）。
 */
const STAGED_BUFF_KEY_MAP: ReadonlyMap<EffectType, BuffKeyMapping> = new Map<
  EffectType,
  BuffKeyMapping
>([
  ["vocal_up", { key: "vocal_up", limitRelease: false }],
  ["vocal_boost", { key: "vocal_boost", limitRelease: false }],
  ["vocal_up_extreme", { key: "vocal_up_extreme", limitRelease: false }],
  ["tension_up", { key: "tension_up", limitRelease: false }],
  ["score_up", { key: "score_up", limitRelease: false }],
  ["a_skill_score_up", { key: "a_skill_score_up", limitRelease: false }],
  ["sp_skill_score_up", { key: "sp_skill_score_up", limitRelease: false }],
  ["combo_score_up", { key: "combo_score_up", limitRelease: false }],
  ["critical_coeff_up", { key: "critical_coeff_up", limitRelease: false }],
  ["critical_rate_up", { key: "critical_rate_up", limitRelease: false }],
  ["stamina_cost_down", { key: "stamina_cost_down", limitRelease: false }],
  ["skill_success_up", { key: "skill_success_up", limitRelease: false }],
  ["focus", { key: "focus", limitRelease: false }],
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
  vocal_up_extreme: STATUS_UP_PER_STAGE_PERMIL,
  vocal_boost: STATUS_BOOST_PER_STAGE_PERMIL,
  tension_up: TENSION_UP_PER_STAGE_PERMIL,
  score_up: SCORE_UP_PER_STAGE_PERMIL,
  a_skill_score_up: A_SKILL_SCORE_UP_PER_STAGE_PERMIL,
  sp_skill_score_up: SP_SKILL_SCORE_UP_PER_STAGE_PERMIL,
  combo_score_up: COMBO_SCORE_UP_PER_STAGE_PERMIL,
  critical_coeff_up: CRITICAL_COEFF_UP_PER_STAGE_PERMIL,
  critical_rate_up: CRITICAL_RATE_UP_PER_STAGE_PERMIL,
  stamina_cost_down: STAMINA_COST_DOWN_PER_STAGE_PERMIL,
  skill_success_up: SKILL_SUCCESS_UP_PER_STAGE_PERMIL,
  focus: FOCUS_APPEAL_PER_STAGE_PERMIL,
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
 * - tension_up / focus / skill_success_up: 10
 * - その他の段階型: 20
 */
function baseStageCap(type: EffectType): number {
  switch (type) {
    case "vocal_up_extreme":
      return LIMIT_RELEASE_STAGE_CAP;
    case "tension_up":
    case "tension_limit":
      return TENSION_STAGE_CAP;
    case "focus":
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

/** 未所有キー 0 の空スナップショット（全14キー必須・types.ts の BuffKey 順） */
function emptySnapshot(): BuffSnapshot {
  return {
    vocal_up: 0,
    vocal_boost: 0,
    vocal_up_extreme: 0,
    tension_up: 0,
    score_up: 0,
    a_skill_score_up: 0,
    sp_skill_score_up: 0,
    combo_score_up: 0,
    critical_coeff_up: 0,
    critical_rate_up: 0,
    stamina_cost_down: 0,
    skill_success_up: 0,
    focus: 0,
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
 * - 未所有キーは 0。戻り値は全14キーを必ず持つ（BuffSnapshot 契約）。
 * - 上限解放変数型（tension_limit 等）は基底キーに合算される。
 *
 * @param active レーンに有効な段階型効果（remainingBeats>0 のもののみ。即時型は不可）
 * @returns 実効段数スナップショット（全14キー・上限クランプ済みの表示値）
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
    if (mapped.key === "combo_continue") {
      snapshot.combo_continue += 1;
    } else if (isVarType) {
      // 上限解放変数型（tension_limit 等）は段数を加算せず、stages を「解放量」として記録。
      // 【実測根拠は releases の JSDoc 参照。b2 の Aスキル検算（csu 6段+limit10 を 16段
      // とすると 41.8M = 乱数域外、6段なら 25.7M で整合）も解放=段数加算なしを支持】
      const prevRel = releases.get(mapped.key) ?? 0;
      releases.set(mapped.key, Math.max(prevRel, effect.stages));
    } else {
      snapshot[mapped.key] += effect.stages;
    }
  }
  for (const [key, cap] of caps) {
    const rel = releases.get(key) ?? 0;
    snapshot[key] = Math.min(snapshot[key], cap + rel);
  }
  return snapshot;
}

/**
 * ライブ中ステータス倍率（permil）を返す（research/01 §2.2・§2.4【Confirmed】）。
 *
 *   1000 + 50×(上昇段) + 25×(超化段) + 75×(ブースト段) − 50×(低下段)
 *
 * - attr=vocal: 上昇 = vocal_up、超化 = vocal_up_extreme、ブースト = vocal_boost。
 * - 【T5実測確定 2026-08-30】vocal_up_extreme の 1 段値は 25‰
 *   （旧 50‰ 説は research/08 §3 の L3 stat_value 倍率差分で否定。定数の JSDoc 参照）。
 *   上昇/ブーストは別系統で加算重複（research/01 §2.3【Confirmed】）。
 * - 低下は BuffKey に低下キーが無いため常に 0（減算の形だけ将来のために用意）。
 * - attr=dance/visual: 該当 type（dance_up 等）が現データに存在しないため常に 1000。
 *   実装としては vocal_up 等と対称のキーが BuffKey に無いだけである。
 */
export function liveStatusMultiplierPermil(
  snapshot: BuffSnapshot,
  attr: LaneAttribute,
): number {
  if (attr !== "vocal") {
    return 1000;
  }
  const upStages = snapshot.vocal_up;
  const extremeStages = snapshot.vocal_up_extreme;
  const boostStages = snapshot.vocal_boost;
  const raw =
    1000 +
    STATUS_UP_PER_STAGE_PERMIL * upStages +
    STATUS_UP_EXTREME_PER_STAGE_PERMIL * extremeStages +
    STATUS_BOOST_PER_STAGE_PERMIL * boostStages -
    STATUS_DOWN_PER_STAGE_PERMIL * 0;
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
 *   1000 − 50×stamina_cost_down + 50×0(増加typeは現データに無い) + 10×vocal_boost
 *
 * - ブースト副効果（消費 +1%/段）は vocal_boost のみ。vocal_up_extreme は含めない
 *   （research/01 §2.3 の表は「ブースト」行の副効果。extreme は上昇系の 30段上限版）。
 *   dance/visual_boost も将来対象だが現データには出現しない。
 * - 【Unknown】stamina_cost_down が上限解放で30段に達すると 1000−1500 = −500 と
 *   負になり得る。ゲーム本体の負値時の挙動（0 クランプ等）は未観測のため
 *   本実装ではクランプしない（呼び出し側の消費計算で保護すること）。
 */
export function consumptionMultiplierPermil(snapshot: BuffSnapshot): number {
  return (
    1000 -
    STAMINA_COST_DOWN_PER_STAGE_PERMIL * snapshot.stamina_cost_down +
    STAMINA_COST_UP_PER_STAGE_PERMIL * 0 +
    BOOST_STAMINA_COST_PER_STAGE_PERMIL * snapshot.vocal_boost
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
 * - beat:    1000 + 25×score_up + bonus.beat
 *   テンションはビートに入らない（S2明記・research/02 §1.3【Confirmed】）。
 *   score_up の 25‰/段係数は T5実測で確定（su 50‰ 説は 80.6%→88.6% の離散整合率低下で棄却）。
 * - active:  1000 + 50×a_skill_score_up + 25×score_up + 50×tension_up + bonus.active
 *   （research/02 §1.3【Confirmed・A】）
 * - special: 1000 + 30×sp_skill_score_up + 25×score_up + 50×tension_up + bonus.special
 *   （research/02 §1.3【Strong estimate・SP】）
 * - passive: 1000 + 25×score_up + bonus.passive
 *   （research/02 §1.3【Estimate・P】。Pスキルスコアアップ型（+10%/段）は現データに
 *   未出現のため除外。出現が確認されたら P_SKILL_SCORE_UP_PER_STAGE_PERMIL 項を追加）
 */
export function b1Permil(
  snapshot: BuffSnapshot,
  kind: B1Kind,
  scoreBonusPct: ScoreBonusPct,
): number {
  switch (kind) {
    case "beat":
      return (
        1000 + SCORE_UP_PER_STAGE_PERMIL * snapshot.score_up + scoreBonusPct.beat
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
      return 1000 + SCORE_UP_PER_STAGE_PERMIL * snapshot.score_up + scoreBonusPct.passive;
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
 * 集目（focus）副効果のファンボーナス（permil）を返す。
 *
 * research/01 §2.6「3段+2.1%〜10段+5.0%」【Confirmed】（research/02 §1.10 も同じ内訳）。
 *
 * テーブル解釈【Estimate】: constants.FOCUS_FAN_BONUS_PERMIL = [0,0,21,28,35,42,46,48,49,50]
 * は要素数10=段数上限(FOCUS_STAGE_CAP)10 と整合するよう「インデックス=段数-1」で参照する
 * （constants のコメント「インデックス=段数 0-9」を素直に読むと table[3]=28 となり、
 * research の「3段+21‰」と矛盾するため。1-2段は研究上の値が無く、副効果は3段からと
 * 解釈して 0）。ゴールデンテスト（T4/T5）の実測突合時に要再確認。
 *
 * @param focusStages 集目の実効段数（0 以上の整数）
 * @returns ファンボーナス permil（0段=0、3段=21、9段=49、10段以上=50 で頭打ち）
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

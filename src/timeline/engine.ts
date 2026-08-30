/**
 * タイムラインエンジン本体（Phase 3b）。
 *
 * 譜面の各ノートビートについて research/01 §4 のビート内処理順11段階を実行し、
 * スキル発動・バフ付与・スコア精算・スタミナ/CT管理を行う。
 * 実装仕様の正本は research/13_engine_spec.md（コメントの §番号はそれに対応）。
 * 確度タグ（【Confirmed】/【Estimate】/【Unknown】）は research/13 から引き継ぐ。
 *
 * 数値規律: 全演算は千分率整数（src/rounding.ts 経由。Math.floor 直書きなし）。
 * スコア計算は src/formula/scoreEvent.ts の computeEventScore に一任する。
 */
import { floorDiv, mulPermil } from "../rounding.js";
import {
  COMBO_ADVANTAGE_TABLE,
  baseComboBonusPermil,
  comboFactorPermil,
  type ComboAdvantageRow,
} from "../formula/combo.js";
import { criticalFactorPermil } from "../formula/critical.js";
import { computeEventScore, type RoundingPolicy } from "../formula/scoreEvent.js";
import {
  aggregateBuffs,
  b1Permil,
  consumptionMultiplierPermil,
  fanFactorPermil,
  liveStatusMultiplierPermil,
  mapEffectToBuffKey,
  stealthFanBonusPermil,
  successRatePermil,
  type ActiveEffect,
  type B1Kind,
} from "./buffs.js";
import {
  CRIT_RATE_BASE_CAP,
  CRIT_RATE_UP_PER_STAGE,
  IDOL_PRIORITY_ORDER,
  POSITION_TO_LANE,
  UNIT_MEMBERS,
} from "./constants.js";
import type {
  ActivationTrace,
  BeatTrace,
  BuffKey,
  BuffSnapshot,
  ChartNote,
  EffectCondition,
  EffectTarget,
  LaneInput,
  LaneNumber,
  LaneScoreEventTrace,
  SimulateInput,
  SkillDef,
  SkillEffect,
  SkillKind,
  TimelineResult,
} from "./types.js";

/**
 * durationBeats が null の段階型効果の残りビート（事実上の永続）。
 * 現データに永続型は出現しない【Estimate: research/13 §6・永続扱いと解釈】。
 */
const PERMANENT_BEATS = 1_000_000_000;

/** レーンの可変状態（research/13 §2） */
interface LaneState {
  readonly input: LaneInput;
  /** 最大スタミナ（=デッキスタミナ。回復はここでクランプ・実測 order9 で確認） */
  readonly maxStamina: number;
  stamina: number;
  combo: number;
  /** このレーンに付与されたアクティブ効果（付与先=このレーン） */
  effects: ActiveEffect[];
  /** 継続型スタミナ回復/ダメージ（ステップ10で処理・research/13 §6） */
  scheduledRecoveries: Array<{ value: number; remainingBeats: number }>;
  /** skillId → 残CT（0=使用可） */
  readonly skillCt: Map<string, number>;
  /** フォトID → ライブ中発動回数（limitPerLive） */
  readonly limitUsed: Map<string, number>;
  /**
   * このビートで発動済みの種別（P/フォト各1回まで・前後半合算）。
   * 【Estimate: 実測 b2 で L5 が前半にフォト発動済み→後半の条件付きフォト(L5-3)は
   * b3 に持ち越された（order 11/15）。位相ごと予算説だと b2 後半で発動するはずなので否定】
   */
  readonly usedThisBeat: Set<"P" | "photo">;
}

/** エンジン全体で不変な文脈 */
interface EngineCtx {
  readonly input: SimulateInput;
  readonly comboTable: readonly ComboAdvantageRow[];
  readonly successBase: number;
  readonly policy: RoundingPolicy;
  /** 累積総スコア（ratio 型スキルの基本スコア基準・§5.2） */
  readonly cumulative: { value: number };
  /**
   * 【T5実測確定】グローバル成功ノート数（combo>=N 条件の判定基準）。
   * ビートノートで +1（全レーン成功扱い）、A/SP は成功時 +1。実測: L4-3(combo>=50)@b51・
   * L4-4/L1-3(combo>=80)@b81・L5-4(combo>=100)@b101 の発火ビートは
   * 「b49 SP FAIL を数えない全曲共通カウンタ」で完全一致（レーン別コンボは否定）。
   */
  readonly globalCombo: { value: number };
  /**
   * 【Phase 9】ライブボーナス（ステージ側）の CT（skillId → 残CT。0=使用可）。
   * ライブボーナスはステージ全体で1つづつの独立エンティティで、アイドルの
   * usedThisBeat 予算とは独立。step9 でアイドルのスキル CT と共に減算される。
   */
  readonly liveBonusCt: Map<string, number>;
  /** このビートで発動済みのライブボーナス skillId（前後半で各1回まで） */
  readonly liveBonusUsedThisBeat: Set<string>;
  /**
   * このビートでスタミナ回復効果を受けたレーン（someone_recovered 条件・
   * target-trigger 対象の解決用）。step10 の継続回復と step7/8 の即時回復で記録。
   */
  readonly recoveredLanes: Set<LaneNumber>;
}

/**
 * 【T5実測フィット確定 2026-08-30】ビート CB の combo_score_up 連成係数‰/段。
 * csu はコンボボーナス X を強化し（X_eff = X×(1000+amp×csu)/1000）、
 * 平係数 c を持つ。c=11.5‰/段・amp=57.5‰/段（L3 118/133 hit、med=1000）。
 */
export const BEAT_CB_CSU_PERMIL = 11.5;
export const BEAT_CB_CSU_AMP_PERMIL = 57.5;

/**
 * タイムラインをシミュレートする（純粋関数）。
 *
 * @param input ライブ構成・譜面・ステージ・RNG・クリティカル供給源
 * @returns ビート列トレースと合計スコア
 * @throws レーン数が5でない等の契約違反
 */
export function simulateTimeline(input: SimulateInput): TimelineResult {
  const lanes = input.lanes;
  if (lanes.length !== 5) {
    throw new Error(`simulateTimeline: exactly 5 lanes required, got ${lanes.length}`);
  }
  for (let i = 0; i < 5; i++) {
    const lane = lanes[i];
    if (lane === undefined || lane.lane !== i + 1) {
      throw new Error(`simulateTimeline: lanes[${i}] must be lane ${i + 1}`);
    }
  }
  const notes = [...input.notes].sort((a, b) => a.beat - b.beat);
  if (notes.length === 0) {
    throw new Error("simulateTimeline: notes must not be empty");
  }

  const ctx: EngineCtx = {
    input,
    comboTable: input.comboAdvantageTable ?? COMBO_ADVANTAGE_TABLE,
    successBase: input.successBasePermil ?? 1000,
    policy: input.roundingPolicy ?? "sequential",
    cumulative: { value: 0 },
    globalCombo: { value: 0 },
    liveBonusCt: new Map<string, number>(),
    liveBonusUsedThisBeat: new Set<string>(),
    recoveredLanes: new Set<LaneNumber>(),
  };

  const states: LaneState[] = lanes.map((laneInput) => ({
    input: laneInput,
    maxStamina: laneInput.deck.stamina,
    stamina: laneInput.deck.stamina,
    combo: 0,
    effects: [],
    scheduledRecoveries: [],
    skillCt: new Map<string, number>(),
    limitUsed: new Map<string, number>(),
    usedThisBeat: new Set<"P" | "photo">(),
  }));

  const beats: BeatTrace[] = [];
  const allActivations: ActivationTrace[] = [];

  for (const note of notes) {
    const result = processBeat(note, ctx, states);
    beats.push(result.beatTrace);
    allActivations.push(...result.beatTrace.activations);
  }

  return {
    totalScore: ctx.cumulative.value,
    beats,
    activations: allActivations,
    finalStamina: states.map((s) => s.stamina),
    finalCombo: states.map((s) => s.combo),
  };
}

/** 1ビート分の処理（research/13 §3 の11段階） */
function processBeat(
  note: ChartNote,
  ctx: EngineCtx,
  states: LaneState[],
): { beatTrace: BeatTrace } {
  const activations: ActivationTrace[] = [];
  const events: LaneScoreEventTrace[] = [];
  const beat = note.beat;

  // ビート開始: 前ビートのステップ10で remaining が 0 になった効果を除去（§2）
  for (const state of states) {
    state.effects = state.effects.filter((e) => e.remainingBeats > 0);
    state.usedThisBeat.clear();
  }
  ctx.liveBonusUsedThisBeat.clear();
  ctx.recoveredLanes.clear();

  // ---- ステップ1〜6 ----
  // 1: ワープ効果（現データなし・将来拡張）2: スキルチャンス譲渡（現データなし）
  // 3〜5: A/SP事前確認はステップ8のレーン処理内で実施（観測順序は同一・§3）
  // 6: バトル発動権（非バトルのため対象外）

  // ---- ステップ6.5: ライブボーナス発動（前半・全アイドルPスキルより最優先）----
  // 【Peing確定 2026-08-31・research/16 §1】「全てのアイドルPスキル（メンタル降順）や
  // フォトよりも先頭（最優先）で判定・発動する」。無条件ライボはここで発動し、
  // 付与バフは同ビートのスコア精算（ステップ8）に乗る（実効ビート数=表記-1）。
  activateLiveBonuses("first", ctx, states, activations, beat);

  // ---- ステップ7: Pスキル発動（前半）----
  for (const state of orderedStates(states)) {
    activatePhaseSkills(state, "first", ctx, states, activations, events, beat);
  }

  // スコア計算時点（ステップ8開始時=P前半発動後）のスナップショット（トレース用・§8）
  const snapshotsAtScoring = states.map((s) => snapshotOf(s));

  // ---- ステップ8: SP/A/ビートの発動・スコア精算 ----
  if (note.noteType === 1) {
    settleBeatNote(note, ctx, states, snapshotsAtScoring, events);
    ctx.globalCombo.value += 1; // ビートノートは常に成功（globalCombo 条件用）
    for (const state of states) {
      state.combo += 1; // ビートノートは常に成功【Estimate: research/13 §9-1】
    }
  } else {
    settleSkillNote(note, ctx, states, activations, events);
  }

  // ---- ステップ9: 全スキル・フォト・ライブボーナスの CT −1 ----
  for (const state of states) {
    for (const [skillId, ct] of state.skillCt) {
      if (ct > 0) {
        state.skillCt.set(skillId, ct - 1);
      }
    }
  }
  for (const [skillId, ct] of ctx.liveBonusCt) {
    if (ct > 0) {
      ctx.liveBonusCt.set(skillId, ct - 1);
    }
  }

  // ---- ステップ10: 全効果のビート数 −1（継続回復/消費はここで処理）----
  for (const state of states) {
    for (const effect of state.effects) {
      if (effect.skipFirstDecay) {
        // A/SP（ステップ8）付与効果は付与ビートの減算をスキップ（T5確定仕様）
        effect.skipFirstDecay = false;
        continue;
      }
      if (effect.remainingBeats < PERMANENT_BEATS) {
        effect.remainingBeats -= 1;
      }
    }
    for (const recovery of state.scheduledRecoveries) {
      state.stamina = clampStamina(state, state.stamina + recovery.value);
      recovery.remainingBeats -= 1;
      if (recovery.value > 0) {
        ctx.recoveredLanes.add(state.input.lane); // someone_recovered 条件用
      }
    }
    state.scheduledRecoveries = state.scheduledRecoveries.filter((r) => r.remainingBeats > 0);
  }

  // ---- ステップ11: ライブボーナス発動（後半・後半Pスキル群の最も最初）----
  // 【Peing確定 2026-08-31・research/16 §1】「スコア精算およびCT・バフ時間の減算処理が
  // 終わった後、後半Pスキル群の中で最も最初に発動」。条件未成立時は保留され、
  // 成立ビートの後半で発動する（実効持続ビート数=表記どおり）。
  activateLiveBonuses("last", ctx, states, activations, beat);

  // ---- ステップ11（続）: Pスキル発動（後半・条件付き等）----
  for (const state of orderedStates(states)) {
    activatePhaseSkills(state, "last", ctx, states, activations, events, beat);
  }

  const beatTrace: BeatTrace = {
    beat,
    noteType: note.noteType,
    position: note.position,
    activations,
    events,
    gainedScore: events.reduce((sum, e) => sum + e.gainedScore, 0),
    comboAfter: states.map((s) => s.combo),
    staminaAfter: states.map((s) => s.stamina),
    buffSnapshots: snapshotsAtScoring,
  };
  return { beatTrace };
}

/** P位相の処理順: メンタル降順・同値は IDOL_PRIORITY_ORDER（§4【Confirmed】） */
function orderedStates(states: readonly LaneState[]): LaneState[] {
  const priority = (lane: LaneNumber): number => IDOL_PRIORITY_ORDER.indexOf(lane);
  return [...states].sort((a, b) => {
    const mentalDiff = b.input.deck.mental - a.input.deck.mental;
    if (mentalDiff !== 0) {
      return mentalDiff;
    }
    return priority(a.input.lane) - priority(b.input.lane);
  });
}

function snapshotOf(state: LaneState): BuffSnapshot {
  // 残り0の効果は次ビート開始時の除去まで配列に残るため、集計では常に除外する
  // （ステップ10で0になった効果は翌ビートのスコアに乗らない・research/13 §2）
  return aggregateBuffs(state.effects.filter((e) => e.remainingBeats > 0));
}

/**
 * 【Peing確定 2026-08-30】クリティカル判定（動的モード / criticalProvider フォールバック）。
 *
 * 動的モード（input.baseCritRate 指定時）:
 *   effectiveCritRate = min(0.50, baseCritRate) + snapshot.critical_rate_up × 5%
 *   - >= 1.0 → 確定クリティカル（抽選なし。基礎50%+10段、または20段で確定）
 *   - それ以外 → rng.nextFloat() < effectiveCritRate で抽選
 * 出典: 質問箱 id=1189080032（クリ率バフ+5%/段・20段で確定・固定値は最大+50%）/
 * id=1186806688（要求値はライブ毎に異なる→baseCritRate は UI 設定値）。
 */
function resolveCritical(
  ctx: EngineCtx,
  snap: BuffSnapshot,
  beat: number,
  lane: LaneNumber,
): boolean {
  const base = ctx.input.baseCritRate;
  if (base === undefined) {
    return ctx.input.criticalProvider(beat, lane);
  }
  const effectiveCritRate =
    Math.min(CRIT_RATE_BASE_CAP, base) + snap.critical_rate_up * CRIT_RATE_UP_PER_STAGE;
  if (effectiveCritRate >= 1.0) {
    return true;
  }
  return ctx.input.rng.nextFloat() < effectiveCritRate;
}

/** スタミナは [0, maxStamina] にクランプ（実測 order9: 18730−866+2560 → 18730 で上限確認） */
function clampStamina(state: LaneState, value: number): number {
  return Math.min(state.maxStamina, Math.max(0, value));
}

/**
 * 対象レーン解決（§7）。
 *
 * - score_type_1/score_type_2/single → **スコアラーレーン**（LaneInput.role === "Scorer"）。
 *   実測: 発動ログの target_idol が全て「白石千紗（スコアラー）」に解決
   （order 1-15・P3a「single は常にスコアラーに解決」注記）。ロール未指定時は発動者にフォールバック。
 * - score_type_3/5（マスタ character_type-1-3/1-5）→ スコアラーレーンのうち
 *   デッキ属性降順で N 人（5=「スコアラータイプ全員」のマスタ記述に対応）【Estimate】。
 * - vocal_type_N/vocal_high_N → 属性 vocal のレーンを**デッキ vocal 降順**で N 個。
 *   実測: vocal_type_3 → [L3, L2, L5]（order4: 千紗626,223 > 沙季L2 401,055 > 沙季L5 339,715、
 *   L1 334,153 は4位・ダンスレーンL4は対象外）で確認【Confirmed】。
 * - dance/visual の type_N/high_N → vocal の対称拡張（Phase 6/9 マスタ一般化・【Estimate】）。
 * - buffer_type_N / supporter_type_N → role（Buffer/Supporter）一致レーンを
 *   デッキの自属性ステータス降順で N 個【Estimate】。
 * - stamina_high_1 / stamina_low_N → 現在スタミナ降順/昇順で N 個（マスタ
 *   target-stamina_higher-1 / target-stamina_lower-N。【Estimate】）。
 * - trigger → 条件（トリガー）を満たしたレーン（activateLiveBonuses が評価して渡す。
 *   例: 「X状態の時、X状態の人に…」の X 状態のレーン。tg-someone_recovered なら回復を受けたレーン）。
 * - status_<type>_<n> → type バフが有効なレーンのうちデッキ属性降順で n 個
 *   （マスタ target-status-<type>-<n>。【Estimate】）。
 * - neighbors → 左右1レーンずつ。実測 order3: L4 の隣接 = L3, L5【Confirmed】。
 * - all → 全5レーン。center → L3。same_lane_other → 非バトルで対象なし【Estimate】。
 */
function resolveTargets(
  target: EffectTarget,
  self: LaneState,
  states: readonly LaneState[],
  triggerLanes: readonly LaneNumber[] = [],
): LaneState[] {
  const byLane = (lane: LaneNumber): LaneState => {
    const found = states.find((s) => s.input.lane === lane);
    if (found === undefined) {
      throw new Error(`resolveTargets: lane state missing: L${lane}`);
    }
    return found;
  };
  const scorer = (): LaneState[] => {
    const found = states.find((s) => s.input.role === "Scorer");
    return found === undefined ? [self] : [found];
  };
  /** role 一致レーンをデッキ属性ステータス降順で N 個（score_type_N の N>=3 もここに統合） */
  const roleTypeLanes = (role: "Scorer" | "Buffer" | "Supporter", n: number): LaneState[] =>
    states
      .filter((s) => s.input.role === role)
      .sort((a, b) => {
        const diff = b.input.deck[b.input.attribute] - a.input.deck[a.input.attribute];
        if (diff !== 0) {
          return diff;
        }
        return IDOL_PRIORITY_ORDER.indexOf(a.input.lane) - IDOL_PRIORITY_ORDER.indexOf(b.input.lane);
      })
      .slice(0, n);
  const vocalLanesByDeckVocalDesc = (): LaneState[] =>
    states
      .filter((s) => s.input.attribute === "vocal")
      .sort((a, b) => b.input.deck.vocal - a.input.deck.vocal);
  /** 属性 N 人（vocal_type_N の対称拡張。デッキ属性ステータス降順） */
  const attrTypeLanes = (
    attr: "vocal" | "dance" | "visual",
    n: number,
  ): LaneState[] =>
    states
      .filter((s) => s.input.attribute === attr)
      .sort((a, b) => b.input.deck[attr] - a.input.deck[attr])
      .slice(0, n);
  const staminaSorted = (desc: boolean): LaneState[] =>
    [...states].sort((a, b) => (desc ? b.stamina - a.stamina : a.stamina - b.stamina));
  switch (target) {
    case "self":
      return [self];
    case "single":
    case "score_type_1":
    case "score_type_2":
      return scorer();
    case "score_type_3":
    case "score_type_5": {
      const n = Number(target.slice("score_type_".length));
      const lanes = roleTypeLanes("Scorer", n);
      return lanes.length > 0 ? lanes : scorer();
    }
    case "center":
      return [byLane(3)];
    case "all":
      return [...states];
    case "neighbors": {
      const a = self.input.lane;
      const targets: LaneState[] = [];
      if (a - 1 >= 1) {
        targets.push(byLane((a - 1) as LaneNumber));
      }
      if (a + 1 <= 5) {
        targets.push(byLane((a + 1) as LaneNumber));
      }
      return targets;
    }
    case "trigger":
      return triggerLanes
        .map((lane) => states.find((s) => s.input.lane === lane))
        .filter((s): s is LaneState => s !== undefined);
    case "stamina_high_1": {
      const first = staminaSorted(true)[0];
      return first === undefined ? [] : [first];
    }
    case "stamina_low_1":
    case "stamina_low_2":
    case "stamina_low_3": {
      const n = Number(target.slice("stamina_low_".length));
      return staminaSorted(false).slice(0, n);
    }
    case "status_vocal_up_1":
      return attrTypeLanesLikeStatus("vocal_up", 1, states);
    case "status_dance_up_1":
      return attrTypeLanesLikeStatus("dance_up", 1, states);
    case "status_dance_up_3":
      return attrTypeLanesLikeStatus("dance_up", 3, states);
    case "status_a_skill_score_up_1":
      return attrTypeLanesLikeStatus("a_skill_score_up", 1, states);
    case "status_a_skill_score_up_2":
      return attrTypeLanesLikeStatus("a_skill_score_up", 2, states);
    case "status_a_skill_score_up_3":
      return attrTypeLanesLikeStatus("a_skill_score_up", 3, states);
    case "status_a_skill_score_up_5":
      return attrTypeLanesLikeStatus("a_skill_score_up", 5, states);
    case "vocal_high_1":
    case "vocal_high_2":
    case "vocal_high_3": {
      const n = Number(target.slice("vocal_high_".length));
      const first = vocalLanesByDeckVocalDesc().slice(0, n);
      return first;
    }
    case "dance_high_1":
    case "dance_high_2":
    case "dance_high_3": {
      const n = Number(target.slice("dance_high_".length));
      return attrTypeLanes("dance", n);
    }
    case "visual_high_1":
    case "visual_high_2":
    case "visual_high_3": {
      const n = Number(target.slice("visual_high_".length));
      return attrTypeLanes("visual", n);
    }
    case "vocal_type_1":
    case "vocal_type_2":
    case "vocal_type_3":
    case "vocal_type_5": {
      const n = Number(target.slice("vocal_type_".length));
      return vocalLanesByDeckVocalDesc().slice(0, n);
    }
    case "dance_type_1":
    case "dance_type_2":
    case "dance_type_3":
    case "dance_type_5": {
      const n = Number(target.slice("dance_type_".length));
      return attrTypeLanes("dance", n);
    }
    case "visual_type_1":
    case "visual_type_2":
    case "visual_type_3":
    case "visual_type_5": {
      const n = Number(target.slice("visual_type_".length));
      return attrTypeLanes("visual", n);
    }
    case "buffer_type_1":
    case "buffer_type_2":
    case "buffer_type_3":
    case "buffer_type_5": {
      const n = Number(target.slice("buffer_type_".length));
      return roleTypeLanes("Buffer", n);
    }
    case "supporter_type_1":
    case "supporter_type_2":
    case "supporter_type_3":
    case "supporter_type_5": {
      const n = Number(target.slice("supporter_type_".length));
      return roleTypeLanes("Supporter", n);
    }
    case "same_lane_other":
      return [];
  }
}

/**
 * target-status-<type>-<n>（「<type>バフ状態の n 人」）の解決。
 * 該当バフが有効なレーンをデッキ属性降順で最大 n 個【Estimate: 順位の基準は属性値と仮定】。
 */
function attrTypeLanesLikeStatus(
  type: SkillEffect["type"],
  n: number,
  states: readonly LaneState[],
): LaneState[] {
  return states
    .filter((s) => s.effects.some((e) => e.type === type))
    .sort(
      (a, b) => b.input.deck[b.input.attribute] - a.input.deck[a.input.attribute],
    )
    .slice(0, n);
}

/**
 * ステップ7/11 共通の Pスキル・フォト発動処理（§4）。
 * 各レーンにつき Pスキル1つ + フォト1つまで（**1ビート合算**・前後半で予算共有）。
 * 候補は配列先頭から【Estimate】。
 * - first（前半）: 無条件スキルのみ。
 * - last（後半）: 条件付き（全条件成立時）+ 無条件（ステップ9でCTが0になり
 *   使用可になったもの。「2回目以降は後半発動」の機構的帰結）。
 *   同ビート内の二重発火は usedThisBeat（前後半予算共有）が担保する。
 *   【T5実測確定】旧実装の「前半使用可だった無条件を後半除外する永続集合」は
 *   b1 でフォト予算を取られた無条件フォト（photo-L1-2 等）が以後の後半発動で
 *   永久に block される誤りで、実測（photo-L1-2 の b51 後半発火）と矛盾したため削除。
 */
function activatePhaseSkills(
  state: LaneState,
  phase: "first" | "last",
  ctx: EngineCtx,
  states: readonly LaneState[],
  activations: ActivationTrace[],
  events: LaneScoreEventTrace[],
  beat: number,
): void {
  for (const skill of [...state.input.skills, ...state.input.photos]) {
    if (skill.kind !== "P" && skill.kind !== "photo") {
      continue; // A/SP はステップ8（settleSkillNote）で処理する
    }
    const kind: "P" | "photo" = skill.kind === "photo" ? "photo" : "P";
    if (state.usedThisBeat.has(kind)) {
      continue;
    }
    const isUnconditional = skill.effects.every(
      (e) => e.condition === "none" || e.condition === "battle_only",
    );
    if (phase === "first") {
      if (!isUnconditional) {
        continue;
      }
    } else {
      if (!isUnconditional && !conditionsHold(state, skill, states, ctx)) {
        continue;
      }
    }
    if (!isReadyIgnoringStaminaAndProbability(state, skill)) {
      continue;
    }
    const outcome = tryActivate(state, skill, phase, ctx, states, events, beat);
    activations.push(outcome.trace);
    if (outcome.activated) {
      state.usedThisBeat.add(kind);
    }
  }
}

/** 確率/成功率/スタミナを除く使用可否（CT・limitPerLive） */
function isReadyIgnoringStaminaAndProbability(state: LaneState, skill: SkillDef): boolean {
  if (skill.kind === "photo" && skill.limitPerLive != null) {
    if ((state.limitUsed.get(skill.id) ?? 0) >= skill.limitPerLive) {
      return false;
    }
  }
  if (skill.ct != null && (state.skillCt.get(skill.id) ?? 0) > 0) {
    return false;
  }
  return true;
}

/**
 * 【Phase 9・Peing確定 2026-08-31】ライブボーナス（ステージ側Pスキル）の発動処理。
 * research/16 §1 のとおり:
 * - 前半（first）: 全アイドルPスキルより**先頭**で判定・発動（ステップ7の直前）。
 *   無条件ライボはここで発動し、そのビートのスコア精算にバフが乗る（実効ビート数=表記-1）。
 * - 後半（last）: スコア精算とCT・バフ時間の減算が終わった後、**後半Pスキル群の中で
 *   最も最初に**発動（ステップ11の先頭）。条件付き（誰かの状態時・コンボ条件・編成条件）は
 *   ここで評価され、未成立時は成立ビートの後半まで保留（実効ビート数=表記どおり）。
 * - CT はライブボーナス毎に個別管理（step9で減算）。前半発動→同ビート減算で実効 CT-1、
 *   後半発動→実効 CT（アイドルPスキルと同じ CT モデル）。
 * - 発動者はレーン非所属のため対象解決のアンカーはセンター（L3）とする
 *   （【Estimate】neighbor 等の自己基準ターゲットは現データのライボに未出現）。
 * - 予算はアイドルの P/フォト（各1回/ビート）と独立で、ライボ毎に前後半合算1回。
 * - トレースは成功時のみ記録（kind="live_bonus"・lane=0。失敗は毎ビート発生するため省略）。
 */
function activateLiveBonuses(
  phase: "first" | "last",
  ctx: EngineCtx,
  states: readonly LaneState[],
  activations: ActivationTrace[],
  beat: number,
): void {
  const skills = ctx.input.liveBonusSkills;
  if (skills === undefined || skills.length === 0) {
    return;
  }
  // 対象解決・条件評価のアンカー（ライブボーナスはレーン非所属 → センター扱い）
  const anchor = states.find((s) => s.input.lane === 3);
  if (anchor === undefined) {
    throw new Error("activateLiveBonuses: center lane state missing");
  }
  for (const skill of skills) {
    if (ctx.liveBonusUsedThisBeat.has(skill.id)) {
      continue;
    }
    // 静的条件（none/battle_only/編成人数）のみのスキル=無条件扱い（前半候補）。
    // someone_*/combo 系の動的条件は後半評価（research/16 §1・後半発動）。
    const isUnconditional = skill.effects.every(
      (e) =>
        e.condition === "none" ||
        e.condition === "battle_only" ||
        e.condition.startsWith("count_"),
    );
    let triggerLanes: LaneNumber[] = [];
    if (phase === "first") {
      if (!isUnconditional) {
        continue;
      }
      // 編成人数条件の静的評価（不成立なら常時不発・編成はライブ中不変）
      const evaluated = liveBonusConditionsHold(skill, ctx, states);
      if (!evaluated.ok) {
        continue;
      }
    } else {
      // 後半はアイドルPスキルと同じ規則: 条件成立（無条件含む）なら発動可。
      // ステップ9で CT が 0 になったスキルの再使用（「2回目以降は後半発動」）を担保する。
      const evaluated = liveBonusConditionsHold(skill, ctx, states);
      if (!evaluated.ok) {
        continue; // 条件未成立 → 成立ビートの後半へ保留
      }
      triggerLanes = evaluated.triggerLanes;
    }
    if (skill.ct != null && (ctx.liveBonusCt.get(skill.id) ?? 0) > 0) {
      continue; // in_ct（トレース省略）
    }
    // 発動確定（ライボは消費スタミナ0・確率100%前提。マスタ値が1000以外の例は未確認）
    if (skill.ct != null) {
      ctx.liveBonusCt.set(skill.id, skill.ct);
    }
    ctx.liveBonusUsedThisBeat.add(skill.id);
    let gained = 0;
    // LiveBonusSkillDef（lane: null）→ SkillDef への適合（engine は lane を参照しない）
    const skillDef: SkillDef = { ...skill, lane: 3 };
    for (const effect of skill.effects) {
      if (effect.condition === "battle_only") {
        continue;
      }
      // 前半発動はステップ10の減算対象（実効=表記-1）・後半発動は減算対象外（表記どおり）。
      // どちらも skipFirstDecay=false（A/SP ステップ8付与の特例とは異なる）。
      gained += applyEffect(anchor, effect, skillDef, ctx, states, [], beat, false, triggerLanes);
    }
    activations.push({
      beat,
      phase,
      lane: 0,
      skillId: skill.id,
      kind: "live_bonus",
      success: true,
      staminaCost: 0,
      gainedScore: gained > 0 ? gained : undefined,
    });
  }
}

/**
 * ライブボーナスの条件評価（後半）。全効果行の条件が成立するかと、
 * target-trigger 解決用の「トリガー成立レーン」を返す。
 * - someone_status-X → X 状態のレーン（誰か）が存在（自レーン含む・T5実測確定の準用）
 * - someone_recovered → このビートで回復効果を受けたレーンが存在
 * - combo>=N → グローバル成功ノート数
 * - count_<unit>>=N → 編成にユニットメンバーが N 人以上（static 成立）
 */
function liveBonusConditionsHold(
  skill: { effects: readonly SkillEffect[] },
  ctx: EngineCtx,
  states: readonly LaneState[],
): { ok: boolean; triggerLanes: LaneNumber[] } {
  let ok = true;
  const triggerLanes = new Set<LaneNumber>();
  for (const effect of skill.effects) {
    if (effect.condition === "none" || effect.condition === "battle_only") {
      continue;
    }
    const res = evaluateCondition(effect.condition, null, states, ctx);
    if (!res.ok) {
      ok = false;
      break;
    }
    for (const lane of res.triggerLanes) {
      triggerLanes.add(lane);
    }
  }
  return { ok, triggerLanes: [...triggerLanes] };
}

/**
 * 後半の条件付きスキル: 全効果行の条件がすべて成立するか（§4【Estimate】）。
 * battle_only は通常ライブで「除外して評価」（P3a 仕様）のため判定から除く。
 */
function conditionsHold(
  state: LaneState,
  skill: SkillDef,
  states: readonly LaneState[],
  ctx: EngineCtx,
): boolean {
  return skill.effects.every(
    (e) =>
      e.condition === "none" ||
      e.condition === "battle_only" ||
      evaluateCondition(e.condition, state.input.lane, states, ctx).ok,
  );
}

/**
 * 条件評価（共通）。
 * - someone_* は「自レーンを含む」全レーンのいずれかに該当バフが有効なら成立
 *   （【T5実測確定】photo-L3-2 の b47 発火の実測による）。
 *   Phase 9 からは union の固定メンバーに加え `someone_<EffectType>` 形を
 *   汎用解釈する（ライブボーナスの tg-someone_status-* 対応）。
 * - 戻り値の triggerLanes は条件を満たしたレーン（target-trigger の解決用）。
 * - combo>=N はグローバル成功ノート数（T5実測確定）。
 * - count_<unit>>=N は編成5レーンのキャラクターID（SimulateInput.formationCharacterIds）
 *   と UNIT_MEMBERS（vendor/SkillTrigger.json 由来）で判定する静的条件。
 */
function evaluateCondition(
  condition: EffectCondition,
  selfLane: LaneNumber | null,
  states: readonly LaneState[],
  ctx: EngineCtx,
): { ok: boolean; triggerLanes: LaneNumber[] } {
  /** 該当 EffectType が有効なレーン（自レーン含む全レーンが対象・T5実測確定） */
  const lanesWith = (type: SkillEffect["type"]): LaneNumber[] =>
    states.filter((s) => s.effects.some((e) => e.type === type)).map((s) => s.input.lane);
  const someone = (type: SkillEffect["type"]): { ok: boolean; triggerLanes: LaneNumber[] } => {
    const lanes = lanesWith(type);
    return { ok: lanes.length > 0, triggerLanes: lanes };
  };
  const self = (): LaneState | undefined =>
    selfLane === null ? undefined : states.find((s) => s.input.lane === selfLane);
  switch (condition) {
    case "none":
      return { ok: true, triggerLanes: [] };
    case "battle_only":
      return { ok: false, triggerLanes: [] }; // 通常ライブでは常に不発（P3a condition 拡張タグ仕様）
    case "self_vocal_lane":
      return { ok: self()?.input.attribute === "vocal", triggerLanes: [] };
    case "self_visual_lane":
      return { ok: self()?.input.attribute === "visual", triggerLanes: [] };
    case "someone_recovered": {
      // 誰かがスタミナ回復効果を受けた時（このビート中・ライブボーナスの tg-someone_recovered）
      const lanes = [...ctx.recoveredLanes];
      return { ok: lanes.length > 0, triggerLanes: lanes };
    }
    case "combo>=50":
    case "combo>=80":
    case "combo>=90":
    case "combo>=100": {
      const n = Number(condition.slice("combo>=".length));
      return { ok: ctx.globalCombo.value >= n, triggerLanes: [] };
    }
    case "count_liz>=1":
    case "count_moon>=1":
    case "count_sun>=1":
    case "count_pajm>=1":
    case "count_leader>=1":
    case "count_tri>=1":
    case "count_thrx>=1": {
      const m = /^count_([a-z_]+)>=(\d+)$/.exec(condition);
      const unit = m?.[1] ?? "";
      const n = Number(m?.[2] ?? 1);
      const members = UNIT_MEMBERS[unit] ?? [];
      const formed = ctx.input.formationCharacterIds ?? [];
      const count = members.filter((id) => formed.includes(id)).length;
      return { ok: count >= n, triggerLanes: [] };
    }
    // 固定メンバー（golden 由来・EffectType と同型の汎用解釈に統合済み）
    case "someone_focus":
      return someone("focus");
    case "someone_score_up":
      return someone("score_up");
    case "someone_skill_success_up":
      return someone("skill_success_up");
    case "someone_critical_coeff_up":
      return someone("critical_coeff_up");
    case "someone_critical_rate_up":
      return someone("critical_rate_up");
    case "someone_beat_score_up":
      return someone("beat_score_up");
    case "someone_a_skill_score_up":
      return someone("a_skill_score_up");
    case "someone_sp_skill_score_up":
      return someone("sp_skill_score_up");
    case "someone_p_skill_score_up":
      return someone("p_skill_score_up");
    case "someone_tension_up":
      return someone("tension_up");
    case "someone_vocal_up":
      return someone("vocal_up");
    case "someone_dance_up":
      return someone("dance_up");
    case "someone_visual_up":
      return someone("visual_up");
    case "someone_vocal_boost":
      return someone("vocal_boost");
    case "someone_dance_boost":
      return someone("dance_boost");
    case "someone_visual_boost":
      return someone("visual_boost");
    case "someone_vocal_down":
      return someone("vocal_down");
    case "someone_dance_down":
      return someone("dance_down");
    case "someone_visual_down":
      return someone("visual_down");
    case "someone_stamina_cost_down":
      return someone("stamina_cost_down");
    case "someone_stealth":
      return someone("stealth");
  }
}

/**
 * 1スキルの発動試行（チェック順: limit → CT → スタミナ → 確率/成功率。§4）。
 * 成功時: スタミナ消費 → CT設定 → 効果適用（スコア行はここで即時精算）。
 */
function tryActivate(
  state: LaneState,
  skill: SkillDef,
  phase: "first" | "last",
  ctx: EngineCtx,
  states: readonly LaneState[],
  events: LaneScoreEventTrace[],
  beat: number,
): { trace: ActivationTrace; activated: boolean } {
  const baseTrace = {
    beat,
    phase: phase === "first" ? ("first" as const) : ("last" as const),
    lane: state.input.lane,
    skillId: skill.id,
    kind: skill.kind,
  };

  if (skill.kind === "photo" && skill.limitPerLive != null) {
    if ((state.limitUsed.get(skill.id) ?? 0) >= skill.limitPerLive) {
      return { trace: { ...baseTrace, success: false, failReason: "limit" }, activated: false };
    }
  }
  if (skill.ct != null && (state.skillCt.get(skill.id) ?? 0) > 0) {
    return { trace: { ...baseTrace, success: false, failReason: "in_ct" }, activated: false };
  }

  const snap = snapshotOf(state);
  const cost = skill.staminaCost == null ? 0 : mulPermil(skill.staminaCost, consumptionMultiplierPermil(snap));
  if (state.stamina < cost) {
    return { trace: { ...baseTrace, success: false, failReason: "stamina_short" }, activated: false };
  }

  // 確率/成功率ゲート【Estimate: 抽選源の割当はUnknown。min(確率, 成功率) を
  // rng.nextCritical() のベルヌーイに流用。ゴールデン実測データは全て1000でこの経路は通らない】
    const probability = skill.probabilityPermil ?? 1000;
    // 成功率の基礎値が既に100%（メンタル盛り）の場合、テンション副効果（-1.5%/段）は
    // メンタル盛りで相殺され成功率は100%のまま（research/01 §2.6。実測 stage:
    // skill_success_rate 100%×5 の下で全82発動が成立）
    const successRate =
      ctx.successBase >= 1000 ? 1000 : successRatePermil(snap, ctx.successBase);
    const gate = Math.min(probability, successRate);
    if (gate < 1000 && !ctx.input.rng.nextCritical()) {
      return { trace: { ...baseTrace, success: false, failReason: "probability" }, activated: false };
    }

  // 発動確定
  state.stamina -= cost;
  if (skill.ct != null) {
    // 【T5実測確定】CT は満タンでセットし、ステップ9の減算に委ねる。
    // 前半発動は同ビート内のステップ9で減算されるため実効 CT−1（CTが0になったビートの
    // step11 で再使用可・gap CT−1）、後半発動は減算されないため実効 CT（gap CT）。
    // 実測 gap 系列（かんしょ 49/50/50、逆襲 50/50/35、さらけ出す 59/46）を完全再現する。
    // 旧「CT−1 初期化」は前半発動で gap CT−2 を生み research/08 §2.3 の実測則
    // （gap ≥ CT−1）に違反していたため修正。
    state.skillCt.set(skill.id, skill.ct);
  }
  if (skill.kind === "photo" && skill.limitPerLive != null) {
    state.limitUsed.set(skill.id, (state.limitUsed.get(skill.id) ?? 0) + 1);
  }
  let gained = 0;
  for (const effect of skill.effects) {
    if (effect.condition === "battle_only") {
      continue; // 効果行レベルでも通常ライブは除外（P3a 仕様）
    }
    gained += applyEffect(state, effect, skill, ctx, states, events, beat);
  }
  return {
    trace: {
      ...baseTrace,
      success: true,
      staminaCost: cost,
      gainedScore: gained > 0 ? gained : undefined,
    },
    activated: true,
  };
}

/**
 * 効果行1件の適用（§6）。スコア獲得行は精算して獲得値を返す。
 * 段階型バフは対象レーンの effects へ付与、即時系は各処理を実行。
 * triggerLanes は target="trigger" の解決用（ライブボーナスの条件成立レーン）。
 */
function applyEffect(
  self: LaneState,
  effect: SkillEffect,
  skill: SkillDef,
  ctx: EngineCtx,
  states: readonly LaneState[],
  events: LaneScoreEventTrace[],
  beat: number,
  skipFirstDecay = false,
  triggerLanes: readonly LaneNumber[] = [],
): number {
  const mapped = mapEffectToBuffKey(effect.type);
  if (mapped !== null) {
    const targets = resolveTargets(effect.target, self, states, triggerLanes);
    for (const target of targets) {
      // 【ユーザー確定 2026-08-30】付与時に上限で切り捨てない（超過分は内部保持）。
      // 19段に+4段→内部23/表示20。期限切れ（インスタンス単位除去）後も内部段数が
      // 上限以上なら上限を維持する。クランプは aggregateBuffs（スナップショット時）のみ。
      target.effects.push({
        type: effect.type,
        stages: effect.stages ?? 1,
        limitRelease: mapped.limitRelease || effect.limitRelease === true,
        capExtend: effect.capExtend === true ? true : undefined,
        remainingBeats: effect.durationBeats == null ? PERMANENT_BEATS : effect.durationBeats,
        sourceSkillId: skill.id,
        skipFirstDecay,
      });
    }
    return 0;
  }
  switch (effect.type) {
    case "score_get":
    case "score_get_by_score_ratio":
      return settleScoreGet(self, effect, skill, ctx, states, events, beat);
    case "stamina_recovery": {
      const value = effect.value ?? 0;
      for (const target of resolveTargets(effect.target, self, states, triggerLanes)) {
        if (effect.durationBeats == null) {
          target.stamina = clampStamina(target, target.stamina + value);
          if (value > 0) {
            ctx.recoveredLanes.add(target.input.lane); // someone_recovered 条件用
          }
        } else {
          target.scheduledRecoveries.push({ value, remainingBeats: effect.durationBeats });
        }
      }
      return 0;
    }
    case "ct_reduction": {
      const value = effect.value ?? 0;
      for (const target of resolveTargets(effect.target, self, states, triggerLanes)) {
        for (const [skillId, ct] of target.skillCt) {
          if (ct > 0) {
            target.skillCt.set(skillId, Math.max(0, ct - value));
          }
        }
      }
      return 0;
    }
    case "ct_increase": {
      const value = effect.value ?? 0;
      for (const target of resolveTargets(effect.target, self, states, triggerLanes)) {
        for (const [skillId, ct] of target.skillCt) {
          target.skillCt.set(skillId, ct + value);
        }
      }
      return 0;
    }
    case "live_bonus_ct_reduction": {
      // 【Phase 9】マスタ live_ability_cool_time_reduction: ステージのライブボーナス CT を短縮
      const value = effect.value ?? 0;
      for (const [skillId, ct] of ctx.liveBonusCt) {
        if (ct > 0) {
          ctx.liveBonusCt.set(skillId, Math.max(0, ct - value));
        }
      }
      return 0;
    }
    case "effect_amplify": {
      const value = effect.value ?? 0;
      for (const target of resolveTargets(effect.target, self, states, triggerLanes)) {
        // 【T5実測確定】増強は BuffKey 毎に最長残り 1 インスタンスへ加算。
        // vocal_up_extreme は対象外（b3/b38 の増強後も vue 段数は不変・amplifyLongestPerKey 参照）
        amplifyLongestPerKey(target, value, false);
      }
      return 0;
    }
    case "effect_extension": {
      const value = effect.value ?? 0;
      // 【T5実測確定】延長は「延長可能（残り<永久）な全インスタンス」へ加算
      // （longest 単一インスタンス説は L3 ビート系列の破綻で棄却・research/12 §T5-2b）
      for (const target of resolveTargets(effect.target, self, states, triggerLanes)) {
        for (const active of target.effects) {
          if (active.remainingBeats < PERMANENT_BEATS) {
            active.remainingBeats += value;
          }
        }
      }
      return 0;
    }
    default:
      throw new Error(`applyEffect: unsupported immediate effect type: ${effect.type as string}`);
  }
}

/**
 * 【T5実測確定 2026-08-30】増強: BuffKey 毎に残りビート最大の 1 インスタンスへ段数加算。
 * 根拠: b38 の L2 A やすらぎの贈り物（amplify+3 → L3）発動後の L3 パネル
 * （research/14）で csu 8→11・su 13→16・テンション 5→8・asu 9→12 が同時に +3、
 * かつ b3 の photo-L5-3（amplify+2）で csu 6→8・su 11→13・テンション 3→5・
 * asu 7→9 が同時に +2。単一インスタンス選択（旧実装）では同時多キー +N を説明できない。
 * vocal_up_extreme は対象外: b3/b38 の増強後も vue 段数は不変
 * （b3-b67 の stat 倍率差分に vue 250‰ が固定で現れる。affectsExtreme=false で固定）。
 */
function amplifyLongestPerKey(state: LaneState, value: number, affectsExtreme: boolean): void {
  const best = new Map<BuffKey, ActiveEffect>();
  for (const active of state.effects) {
    const mapped = mapEffectToBuffKey(active.type);
    if (mapped === null) {
      continue;
    }
    if (mapped.key === "vocal_up_extreme" && !affectsExtreme) {
      continue;
    }
    if (mapped.limitRelease) {
      // 上限解放変数型（tension_limit 等）は段数を持たない実体のため増強対象外
      // （対象に含めると、や長い残りビートを理由に増強が吸収され段数バフが伸びない。
      //  実測: b38 の amplify+3 はテンション（やすらぎの tension_limit ではなく
      //  和歌の tension_up インスタンス）に乗る）
      continue;
    }
    const prev = best.get(mapped.key);
    if (prev === undefined || active.remainingBeats > prev.remainingBeats) {
      best.set(mapped.key, active);
    }
  }
  for (const active of best.values()) {
    // 【ユーザー確定 2026-08-30】増強による加算も上限で切り捨てない（超過分は内部保持）。
    active.stages += value;
  }
}

/**
 * 【Phase 9】ステルス（audience_amount_reduction）副効果のファンボーナス加算。
 * ステルス中のレーン**以外**の4レーンのファンボーナス（B3）に加算される
 * （research/01 §2.6「他4人のファンボーナス+（5段+1.8%…10段+3.7%）」）。
 * ステルス自レーンのファン引力度低下（-5%/段）は来場者数の動的モデルが無いため未実装。
 */
function stealthBonusOthers(selfLane: LaneNumber, states: readonly LaneState[]): number {
  let bonus = 0;
  for (const s of states) {
    if (s.input.lane === selfLane) {
      continue;
    }
    const stages = snapshotOf(s).stealth;
    if (stages > 0) {
      bonus += stealthFanBonusPermil(stages);
    }
  }
  return bonus;
}

/**
 * score_get / score_get_by_score_ratio の精算（§5.2・§5.3）。
 * スコアは発動者レーンのその時点のスナップショットで計算。
 */
function settleScoreGet(
  self: LaneState,
  effect: SkillEffect,
  skill: SkillDef,
  ctx: EngineCtx,
  states: readonly LaneState[],
  events: LaneScoreEventTrace[],
  beat: number,
): number {
  const snap = snapshotOf(self);
  const isRatio = effect.type === "score_get_by_score_ratio";
  const powerPermil = effect.powerPermil ?? 1000;

  let basicScore: number;
  let effectivePower: number;
  let basicScoreRaw: number | undefined;
  if (isRatio) {
    // 割合型: 基本スコア = 累積総スコア × SkillPower（切捨て）、コンボ/ファン不適用
    // 【T5実測確定: 基準はレーン累積+A行加算後（b103検算 basic=533,472,897=4,445,607,475×0.12）】
    basicScoreRaw = ctx.cumulative.value;
    basicScore = floorDiv(ctx.cumulative.value * powerPermil, 1000);
    effectivePower = 1000;
  } else {
    const live = mulPermil(
      self.input.deck[self.input.attribute],
      liveStatusMultiplierPermil(snap, self.input.attribute),
    );
    const weight =
      skill.kind === "SP"
        ? ctx.input.stage.skillWeightsPermil.special
        : skill.kind === "A"
          ? ctx.input.stage.skillWeightsPermil.active
          : 1000; // P/フォト: 重みデータがないため 1000（§5.3【Estimate】）
    basicScore = mulPermil(live, weight);
    // type36 scaling（perStagePermil が null の間はスケーリングなし・P3c でフィッティング）
    // perStagePermil は T5実測フィット値（2.5 等、小数になり得る）のため素の乗算で計算する
    const scaling = effect.scaling;
    if (scaling != null && scaling.perStagePermil != null) {
      const refStages = scalingStages(scaling.ref, snap);
      effectivePower = Math.floor((powerPermil * (1000 + scaling.perStagePermil * refStages)) / 1000);
    } else {
      effectivePower = powerPermil;
    }
  }

  const kind: B1Kind =
    skill.kind === "A" ? "active" : skill.kind === "SP" ? "special" : "passive";
  const b1 = b1Permil(snap, kind, self.input.scoreBonusPct);
  const comboF = isRatio ? 1000 : comboFactorPermil(self.combo, snap.combo_score_up, ctx.comboTable);
  // 【Phase 9】ステルス副効果: 他レーンのステルス段数ぶんファンボーナスに加算
  // （research/01 §2.6・peing id=1188720397。割合型はファン不適用のため 1000 のまま）
  const fanF = isRatio
    ? 1000
    : fanFactorPermil(ctx.input.fanFactorPermil, snap.focus) +
      stealthBonusOthers(self.input.lane, states);
  const rand = ctx.input.rng.nextScoreRoll();
  // 【T5実測確定】フォト行はクリティカル判定の対象外（b47/b132/b125 のポップが
  // 全て非critの達成帯に成立。crit適用では r≈200-930 になり範囲外）。
  // 動的モード（baseCritRate 指定時）も同様にフォト行は判定しない（Peing確定仕様の適用外）
  const crit =
    skill.kind === "photo"
      ? false
      : resolveCritical(ctx, snap, beat, self.input.lane);
  const critF = crit ? criticalFactorPermil(self.input.critExtrasPermil, snap.critical_coeff_up) : 1000;
  const score = computeEventScore({
    basicScore,
    skillPowerPermil: effectivePower,
    b1Permil: b1,
    comboFactorPermil: comboF,
    fanFactorPermil: fanF,
    stageFactorPermil: ctx.input.stage.stageFactorPermil,
    randPermil: rand,
    critFactorPermil: critF,
    roundingPolicy: ctx.policy,
  });
  ctx.cumulative.value += score;
  events.push({
    lane: self.input.lane,
    sourceKind: skill.kind,
    basicScore,
    skillPowerPermil: effectivePower,
    b1Permil: b1,
    comboFactorPermil: comboF,
    fanFactorPermil: fanF,
    isRatioScore: isRatio,
    ratioBaseCumScore: isRatio ? basicScoreRaw : undefined,
    randPermil: rand,
    critFactorPermil: critF,
    gainedScore: score,
  });
  return score;
}

/**
 * scaling.ref（例 "vocal_up_stages"）→ スナップショットの実効段数【Estimate: §5.2】。
 * Phase 6（マスタ一般化）で vocal_up 以外の type36 参照キー（a_skill_score_up 等）にも対応。
 * 未対応の ref は throw（skills_master パーサーは未対応 ref を scaling=null で出力する）。
 */
const SCALING_REF_KEYS: ReadonlyMap<string, readonly BuffKey[]> = new Map([
  ["vocal_up_stages", ["vocal_up", "vocal_up_extreme"]],
  ["dance_up_stages", ["dance_up"]],
  ["visual_up_stages", ["visual_up"]],
  ["dance_boost_stages", ["dance_boost"]],
  ["visual_boost_stages", ["visual_boost"]],
  ["beat_score_up_stages", ["beat_score_up"]],
  ["a_skill_score_up_stages", ["a_skill_score_up"]],
  ["sp_skill_score_up_stages", ["sp_skill_score_up"]],
  ["critical_rate_up_stages", ["critical_rate_up"]],
  ["critical_coeff_up_stages", ["critical_coeff_up"]],
  ["tension_up_stages", ["tension_up"]],
  ["score_up_stages", ["score_up"]],
  ["combo_score_up_stages", ["combo_score_up"]],
  ["vocal_boost_stages", ["vocal_boost"]],
  ["focus_stages", ["focus"]],
]);

function scalingStages(ref: string, snap: BuffSnapshot): number {
  const keys = SCALING_REF_KEYS.get(ref);
  if (keys === undefined) {
    throw new Error(`settleScoreGet: unsupported scaling ref: ${ref}`);
  }
  return keys.reduce((sum, k) => sum + snap[k], 0);
}

/**
 * ビートノートの精算（§5.1）。全5レーンが独立イベント。
 * コンボは「増加前」の値で係数計算（research/02 §3.3 検算【Confirmed】）。
 *
 * 【T5実測確定・Strong estimate】ビート基本スコア:
 *   basic = (vocal×600×liveMult_vocal(レーン) + dance×250 + visual×150) × λ
 * - 重みはステージの beatWeightsPermil（全レーン共通・属性混成。L4/L1 pop比 1.13 と
 *   L4 の b60 跳ね(+19%)が vocal_up 連動で同時説明される。research/12 §T5-2b）。
 * - λ = 8/140 ≈ 0.057143（離散乱数スキャンで L1/L2/L4/L5 の 88% が
 *   |r−round(r)|<1.5 かつ [945,1055] に収束。140 の由来は未解明）。
 * - A/SP ノートの基本スコアは従来どおり属性単一（vocal×600 等。10/13 検定済み）。
 */
const BEAT_LAMBDA_NUM = 8;
const BEAT_LAMBDA_DEN = 140;

function settleBeatNote(
  note: ChartNote,
  ctx: EngineCtx,
  states: readonly LaneState[],
  snapshots: readonly BuffSnapshot[],
  events: LaneScoreEventTrace[],
): void {
  states.forEach((state, idx) => {
    const snap = snapshots[idx];
    if (snap === undefined) {
      throw new Error(`settleBeatNote: snapshot missing for lane index ${idx}`);
    }
    // ミスノート: 挑戦自体が発生しない（スコア・乱数・コンボ不変）
    if (
      ctx.input.missedNotes?.some(
        (m) => m.beat === note.beat && m.lane === state.input.lane,
      )
    ) {
      return;
    }
    const w = ctx.input.stage.beatWeightsPermil;
    // 総和式: 各統計はレーン属性に応じたライブ中倍率が乗る
    // （vocal 以外は dance_up/visual_up 等の対称拡張・Phase 6。実測は vocal のみ検証済み）
    const basicSum =
      mulPermil(
        mulPermil(
          state.input.deck.vocal,
          liveStatusMultiplierPermil(snap, "vocal"),
        ),
        w.vocal,
      ) +
      mulPermil(mulPermil(state.input.deck.dance, liveStatusMultiplierPermil(snap, "dance")), w.dance) +
      mulPermil(mulPermil(state.input.deck.visual, liveStatusMultiplierPermil(snap, "visual")), w.visual);
    const basic = Math.floor((basicSum * BEAT_LAMBDA_NUM) / BEAT_LAMBDA_DEN);
    // ビート B1: score_up は 25‰/段（SCORE_UP_PER_STAGE_PERMIL・T5確定）で乗る
    const b1 = b1Permil(snap, "beat", state.input.scoreBonusPct);
    // 【T5実測確定】ビートCBの基準コンボは表示コンボ（=beat-1、A/SPビートも含む）。
    // L1単独検証: 表示基準で 129/130 が r∈[945,1055] に収束（レーン別基準は 118/130）。
    const comboCount = note.beat - 1;
    const baseX = baseComboBonusPermil(comboCount, ctx.comboTable);
    // 【T5実測フィット確定】csu はコンボボーナスXを強化し（X_eff = X×(1000+amp×csu)/1000）、
    // 平係数 c を持つ（BEAT_CB_CSU_PERMIL / BEAT_CB_CSU_AMP_PERMIL 参照）。
    const xEff = Math.floor(
      (baseX * (1000 + BEAT_CB_CSU_AMP_PERMIL * snap.combo_score_up)) / 1000,
    );
    const comboF = Math.floor(
      ((1000 + xEff) * (1000 + BEAT_CB_CSU_PERMIL * snap.combo_score_up)) / 1000,
    );
    // 【Phase 9】ステルス副効果（他レーンの stealth 段数 → ファンボーナス加算）
    const fanF =
      fanFactorPermil(ctx.input.fanFactorPermil, snap.focus) +
      stealthBonusOthers(state.input.lane, states);
    const rand = ctx.input.rng.nextScoreRoll();
    const crit = resolveCritical(ctx, snap, note.beat, state.input.lane);
    const critF = crit
      ? criticalFactorPermil(state.input.critExtrasPermil, snap.critical_coeff_up)
      : 1000;
    const score = computeEventScore({
      basicScore: basic,
      b1Permil: b1,
      comboFactorPermil: comboF,
      fanFactorPermil: fanF,
      stageFactorPermil: ctx.input.stage.stageFactorPermil,
      randPermil: rand,
      critFactorPermil: critF,
      roundingPolicy: ctx.policy,
    });
    ctx.cumulative.value += score;
    events.push({
      lane: state.input.lane,
      sourceKind: "beat",
      basicScore: basic,
      skillPowerPermil: 1000,
      b1Permil: b1,
      comboFactorPermil: comboF,
      fanFactorPermil: fanF,
      isRatioScore: false,
      randPermil: rand,
      critFactorPermil: critF,
      gainedScore: score,
    });
  });
}

/**
 * A/SPノートの発動と精算（§5.2）。
 *
 * ノートは position（1始まりの優先ランク）で指定されたレーンに属し、**そのレーンのみ**が
 * 挑戦する（実測 A/SP 発動 18/18 が pos→レーン写像と一致: pos1→L3, pos2→L2, pos3→L4,
 * pos4→L1, pos5→L5。他レーンは挑戦しないため FAIL・コンボ変動も発生しない）。
 * 1スキルに複数スコア行がある場合は行ごとに独立イベント（§5.2【Estimate】）。
 */
function settleSkillNote(
  note: ChartNote,
  ctx: EngineCtx,
  states: readonly LaneState[],
  activations: ActivationTrace[],
  events: LaneScoreEventTrace[],
): void {
  const kind: SkillKind = note.noteType === 2 ? "A" : "SP";
  if (note.position < 1 || note.position > 5) {
    throw new Error(
      `settleSkillNote: A/SP note must have position 1-5, got ${note.position} at beat ${note.beat}`,
    );
  }
  const mappedLane = POSITION_TO_LANE[note.position - 1];
  if (mappedLane === undefined) {
    throw new Error(`settleSkillNote: POSITION_TO_LANE missing index ${note.position - 1}`);
  }
  const laneNum: LaneNumber = mappedLane;
  const state = states.find((s) => s.input.lane === laneNum);
  if (state === undefined) {
    throw new Error(
      `settleSkillNote: lane state missing for position ${note.position} (L${laneNum})`,
    );
  }
  const candidates = state.input.skills.filter((s) => s.kind === kind);
  if (candidates.length === 0) {
    activations.push({
      beat: note.beat,
      phase: "main",
      lane: laneNum,
      skillId: "",
      kind,
      success: false,
      failReason: "no_skill",
    });
    // MISS: コンボリセット（コンボ継続で免除・research/01 §2.2）
    if (snapshotOf(state).combo_continue === 0) {
      state.combo = 0;
    }
    return;
  }
  const snap = snapshotOf(state);
  let chosen: SkillDef | null = null;
  let blockedStamina = false;
  let costOfChosen = 0;
  for (const skill of candidates) {
    if (skill.ct != null && (state.skillCt.get(skill.id) ?? 0) > 0) {
      continue; // in_ct
    }
    const cost = skill.staminaCost == null ? 0 : mulPermil(skill.staminaCost, consumptionMultiplierPermil(snap));
    if (state.stamina < cost) {
      blockedStamina = true;
      continue;
    }
    const probability = skill.probabilityPermil ?? 1000;
    // メンタル盛り相殺（tryActivate のコメント参照）
    const successRate =
      ctx.successBase >= 1000 ? 1000 : successRatePermil(snap, ctx.successBase);
    const gate = Math.min(probability, successRate);
    if (gate < 1000 && !ctx.input.rng.nextCritical()) {
      continue; // probability
    }
    chosen = skill;
    costOfChosen = cost;
    break;
  }
  if (chosen === null) {
    activations.push({
      beat: note.beat,
      phase: "main",
      lane: laneNum,
      skillId: candidates[0]?.id ?? "",
      kind,
      success: false,
      failReason: blockedStamina ? "stamina_short" : "in_ct",
    });
    if (snapshotOf(state).combo_continue === 0) {
      state.combo = 0;
    }
    return;
  }
  // 発動: スタミナ消費 → CT設定 → 効果適用（research/13 §5.2・§6。上から順【Confirmed】）
  state.stamina -= costOfChosen;
  if (chosen.ct != null) {
    // 【T5実測確定】CT は満タンでセット（tryActivate のコメント参照。ステップ9減算に委ねる）
    state.skillCt.set(chosen.id, chosen.ct);
  }
  let gained = 0;
  for (const effect of chosen.effects) {
    if (effect.condition === "battle_only") {
      continue;
    }
    // A/SP（ステップ8）付与の段階型効果は付与ビートのステップ10減算をスキップする
    // （【T5実測確定】spDurN1=表記どおりの実効時間。false 説は T5 で棄却済み）
    gained += applyEffect(state, effect, chosen, ctx, states, events, note.beat, true);
  }
  activations.push({
    beat: note.beat,
    phase: "main",
    lane: laneNum,
    skillId: chosen.id,
    kind,
    success: true,
    staminaCost: costOfChosen,
    gainedScore: gained > 0 ? gained : undefined,
  });
  // 成功: コンボ+1（§5.2）
  state.combo += 1;
  ctx.globalCombo.value += 1;
}

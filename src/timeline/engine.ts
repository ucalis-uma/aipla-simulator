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
  successRatePermil,
  type ActiveEffect,
  type B1Kind,
} from "./buffs.js";
import { IDOL_PRIORITY_ORDER, POSITION_TO_LANE } from "./constants.js";
import type {
  ActivationTrace,
  BeatTrace,
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
  /** ステップ7で「前半時点で使用可だった無条件Pスキル」のID集合（後半除外用・§4） */
  readonly unconditionalReadyAtFirstHalf: Set<string>;
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
}

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
    unconditionalReadyAtFirstHalf: new Set<string>(),
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

  // ---- ステップ1〜6 ----
  // 1: ワープ効果（現データなし・将来拡張）2: スキルチャンス譲渡（現データなし）
  // 3〜5: A/SP事前確認はステップ8のレーン処理内で実施（観測順序は同一・§3）
  // 6: バトル発動権（非バトルのため対象外）

  // ---- ステップ7: Pスキル発動（前半）----
  for (const state of orderedStates(states)) {
    activatePhaseSkills(state, "first", ctx, states, activations, events, beat);
  }

  // スコア計算時点（ステップ8開始時=P前半発動後）のスナップショット（トレース用・§8）
  const snapshotsAtScoring = states.map((s) => snapshotOf(s));

  // ---- ステップ8: SP/A/ビートの発動・スコア精算 ----
  if (note.noteType === 1) {
    settleBeatNote(note, ctx, states, snapshotsAtScoring, events);
    for (const state of states) {
      state.combo += 1; // ビートノートは常に成功【Estimate: research/13 §9-1】
    }
  } else {
    settleSkillNote(note, ctx, states, activations, events);
  }

  // ---- ステップ9: 全スキル・フォトの CT −1 ----
  for (const state of states) {
    for (const [skillId, ct] of state.skillCt) {
      if (ct > 0) {
        state.skillCt.set(skillId, ct - 1);
      }
    }
  }

  // ---- ステップ10: 全効果のビート数 −1（継続回復/消費はここで処理）----
  for (const state of states) {
    for (const effect of state.effects) {
      if (effect.remainingBeats < PERMANENT_BEATS) {
        effect.remainingBeats -= 1;
      }
    }
    for (const recovery of state.scheduledRecoveries) {
      state.stamina = clampStamina(state, state.stamina + recovery.value);
      recovery.remainingBeats -= 1;
    }
    state.scheduledRecoveries = state.scheduledRecoveries.filter((r) => r.remainingBeats > 0);
  }

  // ---- ステップ11: Pスキル発動（後半・条件付き等）----
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

/** スタミナは [0, maxStamina] にクランプ（実測 order9: 18730−866+2560 → 18730 で上限確認） */
function clampStamina(state: LaneState, value: number): number {
  return Math.min(state.maxStamina, Math.max(0, value));
}

/**
 * 対象レーン解決（§7）。
 *
 * - score_type_1/score_type_2/single → **スコアラーレーン**（LaneInput.role === "Scorer"）。
 *   実測: 発動ログの target_idol が全て「白石千紗（スコアラー）」に解決
 *   （order 1-15・P3a「single は常にスコアラーに解決」注記）。ロール未指定時は発動者にフォールバック。
 * - vocal_type_N/vocal_high_1 → 属性 vocal のレーンを**デッキ vocal 降順**で N 個。
 *   実測: vocal_type_3 → [L3, L2, L5]（order4: 千紗626,223 > 沙季L2 401,055 > 沙季L5 339,715、
 *   L1 334,153 は4位・ダンスレーンL4は対象外）で確認【Confirmed】。
 * - neighbors → 左右1レーンずつ。実測 order3: L4 の隣接 = L3, L5【Confirmed】。
 * - all → 全5レーン。center → L3。same_lane_other → 非バトルで対象なし【Estimate】。
 */
function resolveTargets(
  target: EffectTarget,
  self: LaneState,
  states: readonly LaneState[],
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
  const vocalLanesByDeckVocalDesc = (): LaneState[] =>
    states
      .filter((s) => s.input.attribute === "vocal")
      .sort((a, b) => b.input.deck.vocal - a.input.deck.vocal);
  switch (target) {
    case "self":
      return [self];
    case "single":
    case "score_type_1":
    case "score_type_2":
      return scorer();
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
    case "vocal_high_1": {
      const first = vocalLanesByDeckVocalDesc()[0];
      return first === undefined ? [] : [first];
    }
    case "vocal_type_1":
    case "vocal_type_2":
    case "vocal_type_3": {
      const n = Number(target.slice("vocal_type_".length));
      return vocalLanesByDeckVocalDesc().slice(0, n);
    }
    case "same_lane_other":
      return [];
  }
}

/**
 * ステップ7/11 共通の Pスキル・フォト発動処理（§4）。
 * 各レーンにつき Pスキル1つ + フォト1つまで（**1ビート合算**・前後半で予算共有）。
 * 候補は配列先頭から【Estimate】。
 * - first（前半）: 無条件スキルのみ。使用可能だったIDを記録（後半除外用）。
 * - last（後半）: 条件付き（全条件成立時）+ 前半で使用可能だった無条件以外の無条件
 *   （=ステップ9でCTが0になり使用可になったもの。「2回目以降は後半発動」の機構的帰結）。
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
      // 後半: 前半で使用可能だった無条件は除外（§4）
      if (isUnconditional && state.unconditionalReadyAtFirstHalf.has(skill.id)) {
        continue;
      }
      if (!isUnconditional && !conditionsHold(state, skill, states)) {
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
  // 前半: 使用可だった無条件Pスキルを全て記録（未選択分も後半で発動しないように）
  if (phase === "first") {
    for (const skill of [...state.input.skills, ...state.input.photos]) {
      if (skill.kind !== "P" && skill.kind !== "photo") {
        continue;
      }
      const isUnconditional = skill.effects.every(
        (e) => e.condition === "none" || e.condition === "battle_only",
      );
      if (isUnconditional && isReadyIgnoringStaminaAndProbability(state, skill)) {
        state.unconditionalReadyAtFirstHalf.add(skill.id);
      }
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
 * 後半の条件付きスキル: 全効果行の条件がすべて成立するか（§4【Estimate】）。
 * battle_only は通常ライブで「除外して評価」（P3a 仕様）のため判定から除く。
 */
function conditionsHold(
  state: LaneState,
  skill: SkillDef,
  states: readonly LaneState[],
): boolean {
  return skill.effects.every(
    (e) =>
      e.condition === "none" ||
      e.condition === "battle_only" ||
      evaluateCondition(e.condition, state, states),
  );
}

function evaluateCondition(
  condition: EffectCondition,
  self: LaneState,
  states: readonly LaneState[],
): boolean {
  const others = states.filter((s) => s.input.lane !== self.input.lane);
  const hasActive = (lane: LaneState, type: SkillEffect["type"]): boolean =>
    lane.effects.some((e) => e.type === type);
  switch (condition) {
    case "none":
      return true;
    case "battle_only":
      return false; // 通常ライブでは常に不発（P3a condition 拡張タグ仕様）
    case "self_vocal_lane":
      return self.input.attribute === "vocal";
    case "self_visual_lane":
      return self.input.attribute === "visual";
    case "someone_focus":
      return others.some((s) => hasActive(s, "focus"));
    case "someone_score_up":
      return others.some((s) => hasActive(s, "score_up"));
    case "someone_skill_success_up":
      return others.some((s) => hasActive(s, "skill_success_up"));
    case "someone_critical_coeff_up":
      return others.some((s) => hasActive(s, "critical_coeff_up"));
    case "combo>=50":
      return self.combo >= 50;
    case "combo>=80":
      return self.combo >= 80;
    case "combo>=100":
      return self.combo >= 100;
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
    // 内部CTは CT−1 で初期化する（research/08 §2.3 実測: 表示は満値だが再使用可能最小
    // 間隔は CT−1。発動ビート内のステップ9減算と合わせ、内部は発動ビートで実質2進む。
    // これにより scoring 時に ct==0 になる最小ビートが 発動+CT−1 となり実測則と一致）
    state.skillCt.set(skill.id, Math.max(0, skill.ct - 1));
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
 */
function applyEffect(
  self: LaneState,
  effect: SkillEffect,
  skill: SkillDef,
  ctx: EngineCtx,
  states: readonly LaneState[],
  events: LaneScoreEventTrace[],
  beat: number,
): number {
  const mapped = mapEffectToBuffKey(effect.type);
  if (mapped !== null) {
    const targets = resolveTargets(effect.target, self, states);
    for (const target of targets) {
      target.effects.push({
        type: effect.type,
        stages: effect.stages ?? 1,
        limitRelease: mapped.limitRelease || effect.limitRelease === true,
        remainingBeats: effect.durationBeats == null ? PERMANENT_BEATS : effect.durationBeats,
        sourceSkillId: skill.id,
      });
    }
    return 0;
  }
  switch (effect.type) {
    case "score_get":
    case "score_get_by_score_ratio":
      return settleScoreGet(self, effect, skill, ctx, events, beat);
    case "stamina_recovery": {
      const value = effect.value ?? 0;
      for (const target of resolveTargets(effect.target, self, states)) {
        if (effect.durationBeats == null) {
          target.stamina = clampStamina(target, target.stamina + value);
        } else {
          target.scheduledRecoveries.push({ value, remainingBeats: effect.durationBeats });
        }
      }
      return 0;
    }
    case "ct_reduction": {
      const value = effect.value ?? 0;
      for (const target of resolveTargets(effect.target, self, states)) {
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
      for (const target of resolveTargets(effect.target, self, states)) {
        for (const [skillId, ct] of target.skillCt) {
          target.skillCt.set(skillId, ct + value);
        }
      }
      return 0;
    }
    case "effect_amplify": {
      const value = effect.value ?? 0;
      for (const target of resolveTargets(effect.target, self, states)) {
        amplifyLongestRemaining(target, value);
      }
      return 0;
    }
    case "effect_extension": {
      const value = effect.value ?? 0;
      for (const target of resolveTargets(effect.target, self, states)) {
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
 * 増強: 残りビート最大の1インスタンスへ段数加算
 * （research/01 §2.2「残りビート数が最長のものだけが増強・延長の対象」【Confirmed】。
 * 対象は全 BuffKey から**単一**インスタンス（実測 b3: photo-L5-3 の +2 は
 * コンボスコア上昇(残42b)のみに付き、ライブ中ステータスは変化しない — 
 * 実測 L3 stat が b4 で不変のことから確認。キー毎の選択は否定される）
 */
function amplifyLongestRemaining(state: LaneState, value: number): void {
  let longest: ActiveEffect | null = null;
  for (const active of state.effects) {
    const mapped = mapEffectToBuffKey(active.type);
    if (mapped === null) {
      continue;
    }
    if (longest === null || active.remainingBeats > longest.remainingBeats) {
      longest = active;
    }
  }
  if (longest !== null) {
    longest.stages += value;
  }
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
  events: LaneScoreEventTrace[],
  beat: number,
): number {
  const snap = snapshotOf(self);
  const isRatio = effect.type === "score_get_by_score_ratio";
  const powerPermil = effect.powerPermil ?? 1000;

  let basicScore: number;
  let effectivePower: number;
  if (isRatio) {
    // 割合型: 基本スコア = 累積総スコア × SkillPower（切捨て）、コンボ/ファン不適用
    // 【Unknown: 累積の厳密な基準（全体かレーン別か等）は T5 の b103 検算で判定】
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
    const scaling = effect.scaling;
    if (scaling != null && scaling.perStagePermil != null) {
      const refStages = scalingStages(scaling.ref, snap);
      effectivePower = mulPermil(powerPermil, 1000 + scaling.perStagePermil * refStages);
    } else {
      effectivePower = powerPermil;
    }
  }

  const kind: B1Kind =
    skill.kind === "A" ? "active" : skill.kind === "SP" ? "special" : "passive";
  const b1 = b1Permil(snap, kind, self.input.scoreBonusPct);
  const comboF = isRatio ? 1000 : comboFactorPermil(self.combo, snap.combo_score_up, ctx.comboTable);
  const fanF = isRatio ? 1000 : fanFactorPermil(ctx.input.fanFactorPermil, snap.focus);
  const rand = ctx.input.rng.nextScoreRoll();
  const crit = ctx.input.criticalProvider(beat, self.input.lane);
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
    basicScore,
    skillPowerPermil: effectivePower,
    b1Permil: b1,
    comboFactorPermil: comboF,
    fanFactorPermil: fanF,
    isRatioScore: isRatio,
    randPermil: rand,
    critFactorPermil: critF,
    gainedScore: score,
  });
  return score;
}

/** scaling.ref（例 "vocal_up_stages"）→ スナップショットの実効段数【Estimate: §5.2】 */
function scalingStages(ref: string, snap: BuffSnapshot): number {
  if (ref === "vocal_up_stages") {
    return snap.vocal_up + snap.vocal_up_extreme;
  }
  throw new Error(`settleScoreGet: unsupported scaling ref: ${ref}`);
}

/**
 * ビートノートの精算（§5.1）。全5レーンが独立イベント。
 * コンボは「増加前」の値で係数計算（research/02 §3.3 検算【Confirmed】）。
 */
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
    const attr = state.input.attribute;
    const live = mulPermil(state.input.deck[attr], liveStatusMultiplierPermil(snap, attr));
    const basic = mulPermil(live, ctx.input.stage.beatWeightsPermil[attr]);
    const b1 = b1Permil(snap, "beat", state.input.scoreBonusPct);
    const comboF = comboFactorPermil(state.combo, snap.combo_score_up, ctx.comboTable);
    const fanF = fanFactorPermil(ctx.input.fanFactorPermil, snap.focus);
    const rand = ctx.input.rng.nextScoreRoll();
    const crit = ctx.input.criticalProvider(note.beat, state.input.lane);
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
    // 内部CTは CT−1 初期化（research/08 §2.3 実測則 gap ≥ CT−1。tryActivate のコメント参照）
    state.skillCt.set(chosen.id, Math.max(0, chosen.ct - 1));
  }
  let gained = 0;
  for (const effect of chosen.effects) {
    if (effect.condition === "battle_only") {
      continue;
    }
    gained += applyEffect(state, effect, chosen, ctx, states, events, note.beat);
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
}

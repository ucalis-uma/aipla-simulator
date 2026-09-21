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
  fanFactorPermilByAttraction,
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
  /** 累積消費スタミナ（type36 staminaConsumedLinear 用） */
  staminaSpent: number;
  /** 自身が成功発動したスキル/フォト数（type36 skillCountLinear 用） */
  activated: number;
  /** 【2026-09-01】自身の累積獲得スコア（ratio 型「自身の獲得スコア」の基準） */
  scoreCum: number;
  /** 【2026-09-01】スキル開始時点の scoreCum（ratio 型の基準。スキル処理中のみ有効） */
  scoreCumAtSkillStart: number;
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
   * 【サンプル1実測確定 2026-09-01】コンボ継続なしの A/SP FAIL では 0 にリセットする:
   * b56 L2 SP FAIL（スキル未習得）でリセット後、過去の私へ(combo>=80) が表示コンボ=80 の
   * b136 で発火（リセットなしだと b81 発火になり実測と矛盾）。
   */
  readonly globalCombo: { value: number };
  /**
   * 【サンプル1実測確定 2026-09-01】表示コンボ（UI の COMBO 数字）。
   * 成功ノートで +1、コンボ継続バフで保護された FAIL ノートも +1（T5 b49: 48→49 実測）、
   * コンボ継続なしの FAIL で 0 にリセット（サンプル1 b56: 55→0）。
   * ビート CB の基準コンボは T5 で「表示コンボ(=beat-1)」と確定済みのため、
   * リセット付き譜面では本カウンタを基準に使う（T5 では beat-1 と完全一致し不変）。
   */
  readonly displayCombo: { value: number };
  /** 処理中のノート（someone_before_special 条件＝「誰かがSPスキル発動前」の判定用） */
  currentNote: ChartNote | null;
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
    displayCombo: { value: 0 },
    currentNote: null,
    liveBonusCt: new Map<string, number>(),
    liveBonusUsedThisBeat: new Set<string>(),
    recoveredLanes: new Set<LaneNumber>(),
  };

  const states: LaneState[] = lanes.map((laneInput) => ({
    input: laneInput,
    maxStamina: laneInput.deck.stamina,
    stamina: laneInput.deck.stamina,
    staminaSpent: 0,
    activated: 0,
    scoreCum: 0,
    scoreCumAtSkillStart: 0,
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
  ctx.currentNote = note;

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
    ctx.displayCombo.value += 1; // 表示コンボも +1
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

/**
 * スキル発動のスタミナ消費量（research/13 §3-4【Confirmed】+ サンプル3 拡張）。
 *
 *   cost = floor(floor(staminaCost × ステージ消費倍率 / 1000) × バフ倍率 / 1000)
 *
 * - 適用順序はステージ→バフ（【Confirmed 2026-09-04: S3 L4 b3 の 1939 =
 *   floor(610×3=1830 ×1.06)。逆順では 1938 になり1ずれる】）
 * - バフ倍率 = consumptionMultiplierPermil（自属性ブースト +1%/段等。
 *   S3 L4 b1/b3/b14/b42/b61 = 1884/1939/1386/1272/1884 で1の位一致）
 * - ステージ消費倍率 = StageInput.skillStaminaWeightPermil
 *   （Quest.skillStaminaWeightPermil。標準 1000・STAGE045 は 3000=3.0倍。
 *   サンプル3 F1: 424×3=1272 等 8 件以上で 1 の位一致【Confirmed: S3 実測】）
 */
function staminaCostOf(
  skill: Pick<SkillDef, "staminaCost">,
  snap: BuffSnapshot,
  stageWeightPermil?: number,
  attr?: "vocal" | "dance" | "visual",
): number {
  if (skill.staminaCost == null) return 0;
  const afterStage = mulPermil(skill.staminaCost, stageWeightPermil ?? 1000);
  return mulPermil(afterStage, consumptionMultiplierPermil(snap, attr));
}

/**
 * 継続回復の 1 tick 量（research/02 §1.8・research/01 §2.2【Confirmed】）。
 *
 *   tick = floor(15 × 段階 × ライブ特徴 / 1000)
 *
 * - 段階 = stamina_recovery 行の value（マスタの回復量段数）
 * - ライブ特徴 = StageInput.staminaRecoveryWeightPermil（Quest 由来。標準 1000。
 *   0 は「特徴なし」= 1000 扱い）
 * - S3 実測: のんびり温泉『出張』(v3)・泥酔者の愚痴(v3)とも +45/beat = 15×3×1.0
 *   （100+ のビートデルタで確定。効果窓ものんびり 42b・泥酔 24b と一致）
 */
function recoveryTickOf(stages: number, featurePermil?: number): number {
  const feat = featurePermil == null || featurePermil === 0 ? 1000 : featurePermil;
  return mulPermil(15 * stages, feat);
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
  /**
   * 【サンプル1実測確定 2026-09-01】「<属性>タイプN人」（*_type_N）の対象解決。
   * プール = メンバーのタイプ（cardType=装着カードの属性。未指定時はレーン属性で代用）が
   * 一致するレーン。順序 = レーン優先度 L3>L2>L4>L1>L5（IDOL_PRIORITY_ORDER）で先頭 N。
   * 実測: 殻をやぶる（ボーカルタイプ2人）→ L3,L2。デッキステータス降順説は棄却
   * （降順 L3,L1 は実測 {L2,L3} と不一致）。
   * 【Estimate】cardType 未指定時の代用で旧来の「レーン属性フィルタ」挙動を維持するが、
   * 順序は本実測どおりレーン優先度に統一（旧: デッキ属性ステータス降順）。
   */
  const memberTypeLanes = (attr: "vocal" | "dance" | "visual", n: number): LaneState[] =>
    states
      .filter((s) => (s.input.cardType ?? s.input.attribute) === attr)
      .sort(
        (a, b) => IDOL_PRIORITY_ORDER.indexOf(a.input.lane) - IDOL_PRIORITY_ORDER.indexOf(b.input.lane),
      )
      .slice(0, n);
  /** <属性>が高いN人（*_higher_N）= メンバーのライブ中属性ステータス降順。
   * 【サンプル3・2026-09-03】STAGE045 のライブボーナス（ビジュアルが高い2人のCT-47）:
   * b1 は deck 順と同じ {L4, L3} だが、b61 はライブ中 visual {L4: 679074, L1: 222021,
   * L3: 172933, ...} の上位2人 = {L4, L1}。deck 順 {L4, L3} では b61 の頑固に加え
   * さらけ出す（L3）も発動してしまい実測（L3 不発）と矛盾するため、ライブ中値で順位付けする。
   * 同値はレーン優先度（IDOL_PRIORITY_ORDER）で解決。レーン属性フィルタは維持。
   */
  const attrStatDescLanes = (
    attr: "vocal" | "dance" | "visual",
    n: number,
  ): LaneState[] =>
    states
      .filter((s) => s.input.attribute === attr)
      .sort((a, b) => {
        const liveA = mulPermil(a.input.deck[attr], liveStatusMultiplierPermil(snapshotOf(a), attr));
        const liveB = mulPermil(b.input.deck[attr], liveStatusMultiplierPermil(snapshotOf(b), attr));
        if (liveB !== liveA) {
          return liveB - liveA;
        }
        return IDOL_PRIORITY_ORDER.indexOf(a.input.lane) - IDOL_PRIORITY_ORDER.indexOf(b.input.lane);
      })
      .slice(0, n);
  const staminaSorted = (desc: boolean): LaneState[] =>
    [...states].sort((a, b) => (desc ? b.stamina - a.stamina : a.stamina - b.stamina));
  /** <属性>レーンN人（*_lane_N・サンプル1実測確定・レーン番号順。states はレーン順） */
  const attrLaneLanes = (attr: "vocal" | "dance" | "visual", n: number): LaneState[] =>
    states.filter((s) => s.input.attribute === attr).slice(0, n);
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
      return attrStatDescLanes("dance", n);
    }
    case "visual_high_1":
    case "visual_high_2":
    case "visual_high_3": {
      const n = Number(target.slice("visual_high_".length));
      return attrStatDescLanes("visual", n);
    }
    case "vocal_type_1":
    case "vocal_type_2":
    case "vocal_type_3":
    case "vocal_type_5": {
      // 【サンプル1実測確定 2026-09-01】メンバータイプ（cardType）プール × レーン優先度順
      const n = Number(target.slice("vocal_type_".length));
      return memberTypeLanes("vocal", n);
    }
    case "dance_type_1":
    case "dance_type_2":
    case "dance_type_3":
    case "dance_type_5": {
      // 【サンプル1実測確定 2026-09-01】メンバータイプ（cardType）プール × レーン優先度順
      const n = Number(target.slice("dance_type_".length));
      return memberTypeLanes("dance", n);
    }
    case "visual_type_1":
    case "visual_type_2":
    case "visual_type_3":
    case "visual_type_5": {
      // 【サンプル1実測確定 2026-09-01】メンバータイプ（cardType）プール × レーン優先度順
      const n = Number(target.slice("visual_type_".length));
      return memberTypeLanes("visual", n);
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
    // ---- 【サンプル1実測確定 2026-09-01】<属性>レーンN人（target-position_attribute_*
    // を正規解像。レーン属性一致レーンをレーン番号順に N 個。実測: 麻奈も立った大舞台
    // (vocal_lane_3) → L1,L3,L4（ボーカルレーン4本のうち L5 対象外=レーン番号順）】
    case "vocal_lane_1":
    case "vocal_lane_2":
    case "vocal_lane_3":
    case "vocal_lane_5": {
      const n = Number(target.slice("vocal_lane_".length));
      return attrLaneLanes("vocal", n);
    }
    case "dance_lane_1":
    case "dance_lane_2":
    case "dance_lane_3":
    case "dance_lane_5": {
      const n = Number(target.slice("dance_lane_".length));
      return attrLaneLanes("dance", n);
    }
    case "visual_lane_1":
    case "visual_lane_2":
    case "visual_lane_3":
    case "visual_lane_5": {
      const n = Number(target.slice("visual_lane_".length));
      return attrLaneLanes("visual", n);
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
 * 前半で評価できる条件（無条件 + SP前置きトリガー）。
 * someone_before_special は「SPノート到来ビートの前半（スコア精算前）」でしか意味を
 * 持たない（後半は SP 精算後のため事前バフにならない・サンプル1 b143 実測）。
 */
function isFirstPhaseCondition(condition: EffectCondition): boolean {
  return (
    condition === "none" ||
    condition === "battle_only" ||
    condition === "someone_before_special" ||
    condition === "self_before_special" ||
    condition === "someone_before_active"
  );
}

/** フォト装着制限（<サポータータイプのみ> 等）の判定。未知の制約文字列は制約なし扱い */
export function restrictionAllows(restriction: string, role: LaneInput["role"]): boolean {
  const want: LaneInput["role"] | undefined =
    restriction === "supporter_only"
      ? "Supporter"
      : restriction === "buffer_only"
        ? "Buffer"
        : restriction === "scorer_only"
          ? "Scorer"
          : undefined;
  return want === undefined || role === want;
}

/**
 * ステップ7/11 共通の Pスキル・フォト発動処理（§4）。
 * 各レーンにつき Pスキル1つ + フォト1つまで（**1ビート合算**・前後半で予算共有）。
 * 候補は配列先頭から【Estimate】。
 * - first（前半）: 無条件スキル + SP前置きトリガー（someone_before_special）のみ。
 *   SP前置きは後半では SP 精算後になるため前半限定（サンプル1 b143 実測）。
 * - last（後半）: 条件付き（全条件成立時）+ 無条件（ステップ9でCTが0になり
 *   使用可になったもの。「2回目以降は後半発動」の機構的帰結）。
 *   同ビート内の二重発火は usedThisBeat（前後半予算共有）が担保する。
 *   【T5実測確定】旧実装の「前半使用可だった無条件を後半除外する永続集合」は
 *   b1 でフォト予算を取られた無条件フォト（photo-L1-2 等）が以後の後半発動で
 *   永久に block される誤りで、実測（photo-L1-2 の b51 後半発火）と矛盾したため削除。
 * - フォトの装着制限（restriction: <サポータータイプのみ> 等）は候補段階で除外する
 *   （サンプル1実測: L4=Buffer 装備の supporter_only フォトは不発）。
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
    if (skill.restriction != null && !restrictionAllows(skill.restriction, state.input.role)) {
      continue; // 装着制限不一致（トレース省略・常時不発スキルのため毎ビート出ない）
    }
    // 【2026-09-02 ユーザー確定・2026-09-03 サンプル3で修正】無条件行（none）を 1 つでも持つ
    // P/フォトは「前発動」タイプ: CT0 で自動発動する（祭り千紗 P3 = 1行目無条件+2行目条件式 が b1 発動）。
    // 全行条件式のスキルは「後発動」（条件成立まで後半で待つ・優 P3 = 不発の根拠）。
    // battle_only 行は通常ライブで適用不能のため無条件扱いしない（S3 L2「誰も知らない雲の向こうへ」
    // [combo>=50, battle_only] が b1 前半発動して limit=1 を消費し b50 発動を潰す誤りを修正。
    // T5「結婚への願望」[none, battle_only] は none 行があるため前発動のまま不変）。
    const isUnconditional = skill.effects.some((e) => e.condition === "none");
    const hasBeforeSpecial = skill.effects.some((e) => e.condition === "someone_before_special");
    // 条件を満たしたレーン（target="trigger" の解決用・Phase 8-B5）。
    // 行ごとの条件は tryActivate 内で個別評価するため、ここでは
    // 前半の someone_before_special ゲート用にのみ解決する。
    let triggerLanes: readonly LaneNumber[] = [];
    if (phase === "first") {
      if (isUnconditional) {
        // 前発動タイプ: CT0 で自動発動（条件付き行は適用時に個別評価）
      } else {
        if (!skill.effects.every((e) => isFirstPhaseCondition(e.condition))) {
          continue; // 条件のみのスキルで前半評価不能条件を含む → 後半へ
        }
        // someone_before_special 等の前半評価可能条件（SP前置きバフ）
        const evaluated = conditionsHold(state, skill, states, ctx);
        if (!evaluated.ok) {
          continue;
        }
        triggerLanes = evaluated.triggerLanes;
      }
    } else {
      if (hasBeforeSpecial) {
        continue; // SP前置きは前半専用（後半 = SP精算後のため不発）
      }
      if (isUnconditional) {
        // 前発動タイプの再発動: ステップ9で CT が 0 になった同ビート後半で発動可
        // （無条件スキルと同一機構・usedThisBeat が同ビート二重発火を担保）
      } else {
        // 【2026-09-02 ユーザー確定】条件のみのスキル（後発動）は行ごと独立評価:
        // **いずれか 1 行でも条件成立なら発動**し、成立した行のみ適用する
        // （祭り千紗 P2 パターン = 2行目は 1行目のビジュアルレーン条件に非依存）。
        const evaluated = rowsHoldAny(state, skill, states, ctx);
        if (!evaluated.ok) {
          continue;
        }
        triggerLanes = evaluated.triggerLanes;
      }
    }
    if (!isReadyIgnoringStaminaAndProbability(state, skill)) {
      continue;
    }
    const outcome = tryActivate(state, skill, phase, ctx, states, events, beat, triggerLanes);
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
      anchor.scoreCumAtSkillStart = anchor.scoreCum; // 【2026-09-01】ratio 基準
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
 * 戻り値の triggerLanes は条件を満たしたレーン（target="trigger" の解決用・Phase 8-B5）。
 */
function conditionsHold(
  state: LaneState,
  skill: SkillDef,
  states: readonly LaneState[],
  ctx: EngineCtx,
): { ok: boolean; triggerLanes: LaneNumber[] } {
  const triggerLanes = new Set<LaneNumber>();
  for (const e of skill.effects) {
    if (e.condition === "none" || e.condition === "battle_only") {
      continue;
    }
    const res = evaluateCondition(e.condition, state.input.lane, states, ctx);
    if (!res.ok) {
      return { ok: false, triggerLanes: [] };
    }
    for (const lane of res.triggerLanes) {
      triggerLanes.add(lane);
    }
  }
  return { ok: true, triggerLanes: [...triggerLanes] };
}

/**
 * 【2026-09-02 ユーザー確定】条件のみのスキル（後発動）の行独立評価:
 * いずれか 1 行でも条件成立なら ok（=発動可）。成立しなかった行は適用時に
 * スキップされる（applyEffect 呼び出し側の行フィルタ参照）。
 * 根拠: 祭り千紗 P2「一生懸命、金魚すくい」の 2 行目（スキル成功率上昇）は
 * 1 行目（ビジュアルレーン条件）に**非依存**で発動する（ユーザー実測）。
 * battle_only は通常ライブで除外（P3a 仕様）。
 */
function rowsHoldAny(
  state: LaneState,
  skill: SkillDef,
  states: readonly LaneState[],
  ctx: EngineCtx,
): { ok: boolean; triggerLanes: LaneNumber[] } {
  const triggerLanes = new Set<LaneNumber>();
  let ok = false;
  for (const e of skill.effects) {
    if (e.condition === "none" || e.condition === "battle_only") {
      continue;
    }
    const res = evaluateCondition(e.condition, state.input.lane, states, ctx);
    if (res.ok) {
      ok = true;
    }
    for (const lane of res.triggerLanes) {
      triggerLanes.add(lane);
    }
  }
  return { ok, triggerLanes: [...triggerLanes] };
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
      // 【2026-09-02 ユーザー確定】tg-position_attribute_* はレーン属性比較で確定
      // （S2 怜 A2 の「発動」は誤認。T5 実測 82/82 発動一致・優=不発 と整合）。
      return { ok: self()?.input.attribute === "vocal", triggerLanes: [] };
    case "self_visual_lane":
      return { ok: self()?.input.attribute === "visual", triggerLanes: [] };
    case "self_dance_lane":
      return { ok: self()?.input.attribute === "dance", triggerLanes: [] };
    case "self_down_group": {
      // 【2026-09-02 確定】自身が低下効果状態の時（tg-status_group-weekness・
      // 「一生懸命、金魚すくい」2行目）。someone_down_group の主語違い（同一グループ判定）。
      const s = self();
      return (
        s !== undefined &&
        (snapshotOf(s).vocal_down > 0 || snapshotOf(s).dance_down > 0 || snapshotOf(s).visual_down > 0)
          ? { ok: true, triggerLanes: [] }
          : { ok: false, triggerLanes: [] }
      );
    }
    case "someone_down_group":
      // 【サンプル2実測確定 2026-09-02】誰かが低下効果状態の時（憧れていた青春 等）。
      // 低下効果（vocal/dance/visual_down）のいずれかが編成の誰かに有効なとき成立。
      return (
        states.some((s) => snapshotOf(s).vocal_down > 0 || snapshotOf(s).dance_down > 0 || snapshotOf(s).visual_down > 0)
          ? { ok: true, triggerLanes: [] }
          : { ok: false, triggerLanes: [] }
      );
    case "someone_recovered": {
      // 誰かがスタミナ回復効果を受けた時（このビート中・ライブボーナスの tg-someone_recovered）
      const lanes = [...ctx.recoveredLanes];
      return { ok: lanes.length > 0, triggerLanes: lanes };
    }
    case "combo>=50":
    case "combo>=70":
    case "combo>=80":
    case "combo>=90":
    case "combo>=100": {
      const n = Number(condition.slice("combo>=".length));
      return { ok: ctx.globalCombo.value >= n, triggerLanes: [] };
    }
    // 【Phase 8-B2】コンボ N 以下（tg-combo_less_equal-N）
    case "combo<=20":
    case "combo<=30":
    case "combo<=40":
    case "combo<=50":
    case "combo<=60":
    case "combo<=70":
    case "combo<=80":
    case "combo<=90":
    case "combo<=100":
    case "combo<=120":
    case "combo<=150": {
      const n = Number(condition.slice("combo<=".length));
      return { ok: ctx.globalCombo.value <= n, triggerLanes: [] };
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
    // ---- 【Phase 8-B2】フォトスキルのマスタ準拠条件 ----
    // self_dance_lane は上で cardType 比較に統一（サンプル2実測確定 2026-09-02）
    case "self_center":
      return { ok: self()?.input.lane === 3, triggerLanes: [] };
    case "self_most_left":
      return { ok: self()?.input.lane === 1, triggerLanes: [] };
    case "self_most_right":
      return { ok: self()?.input.lane === 5, triggerLanes: [] };
    case "music_limited":
    case "critical_timing":
    case "fan_engage_higher":
    case "mood_type":
      // 【Estimate: 常時発動近似】楽曲/発動履歴/集目段数/テンションタイプの文脈を
      // engine は保持しないため無条件で成立扱い（UI に近似表記）
      return { ok: true, triggerLanes: [] };
    case "someone_before_special": {
      // 【サンプル1実測確定 2026-09-01】誰かがSPスキル発動前（スキルトリガー
      // tg-before_special_skill_by_someone）。現在ビートのノートが SP ノートで、
      // そのレーンが SP スキルを発動できる状態（所持・CT outside・スタミナ足りる）
      // のとき成立。トリガー成立レーン = SP ノートのレーン。
      // 実測: L4-3 かっこいい宇宙人さん が b143（L3 の SP ノート）で発動し
      // SPレーン L3 へ事前バフ（クリティカル率上昇7段 = b143 の +7 と一致）。
      // b56（SP ノートはあるが L2 は SP 未所持で FAIL）では不発が実測。
      const note = ctx.currentNote;
      if (note === null || note.noteType !== 3 || note.position < 1 || note.position > 5) {
        return { ok: false, triggerLanes: [] };
      }
      const spLane: LaneNumber = POSITION_TO_LANE[note.position - 1]!;
      const spState = states.find((s) => s.input.lane === spLane);
      if (spState === undefined) {
        return { ok: false, triggerLanes: [] };
      }
      const ready = spState.input.skills.some(
        (s) =>
          s.kind === "SP" &&
          (s.ct == null || (spState.skillCt.get(s.id) ?? 0) === 0) &&
          (s.staminaCost == null || spState.stamina >= s.staminaCost),
      );
      return { ok: ready, triggerLanes: ready ? [spLane] : [] };
    }
    case "self_before_special": {
      // 自身がSPスキル発動前（tg-before_special_skill）。
      // 現在ビートのノートが自レーンの SP ノートで、自身が SP スキルを発動できる状態の時成立。
      const note = ctx.currentNote;
      if (note === null || note.noteType !== 3 || note.position < 1 || note.position > 5) {
        return { ok: false, triggerLanes: [] };
      }
      const spLane: LaneNumber = POSITION_TO_LANE[note.position - 1]!;
      if (selfLane === null || spLane !== selfLane) {
        return { ok: false, triggerLanes: [] };
      }
      const spState = self();
      if (spState === undefined) {
        return { ok: false, triggerLanes: [] };
      }
      const ready = spState.input.skills.some(
        (s) =>
          s.kind === "SP" &&
          (s.ct == null || (spState.skillCt.get(s.id) ?? 0) === 0) &&
          (s.staminaCost == null || spState.stamina >= s.staminaCost),
      );
      return { ok: ready, triggerLanes: ready ? [spLane] : [] };
    }
    case "someone_before_active": {
      // 誰かがAスキル発動前（tg-before_active_skill_by_someone）。
      // 現在ビートのノートが A ノート（noteType 2）で、そのレーンが A スキルを発動できる状態の時成立。
      const note = ctx.currentNote;
      if (note === null || note.noteType !== 2 || note.position < 1 || note.position > 5) {
        return { ok: false, triggerLanes: [] };
      }
      const aLane: LaneNumber = POSITION_TO_LANE[note.position - 1]!;
      const aState = states.find((s) => s.input.lane === aLane);
      if (aState === undefined) {
        return { ok: false, triggerLanes: [] };
      }
      const ready = aState.input.skills.some(
        (s) =>
          s.kind === "A" &&
          (s.ct == null || (aState.skillCt.get(s.id) ?? 0) === 0) &&
          (s.staminaCost == null || aState.stamina >= s.staminaCost),
      );
      return { ok: ready, triggerLanes: ready ? [aLane] : [] };
    }
    default: {
      // 動的パターン: status_<BuffKey>（自レーンが X 状態）/ stamina>=N / stamina<=N /
      // someone_stamina<=N / combo<=N / count_<unit/char>>=N / someone_<status>>=N
      const mCount = /^count_([a-z_]+)>=(\d+)$/.exec(condition);
      if (mCount && mCount[1] !== undefined && mCount[2] !== undefined) {
        const key = mCount[1];
        const n = Number(mCount[2]);
        const members: readonly string[] = UNIT_MEMBERS[key] ?? [`char-${key}`];
        const formed: readonly string[] = ctx.input.formationCharacterIds ?? [];
        const count = members.filter((id: string) => formed.includes(id)).length;
        return { ok: count >= n, triggerLanes: [] };
      }
      const mSomeoneGrade = /^someone_([a-z_]+)>=(\d+)$/.exec(condition);
      if (mSomeoneGrade) {
        const status = mSomeoneGrade[1] as BuffKey;
        const grade = Number(mSomeoneGrade[2]);
        const lanes = states
          .filter((s) => {
            const snap = snapshotOf(s);
            const val = (snap as Record<string, number>)[status] ?? 0;
            return val >= grade;
          })
          .map((s) => s.input.lane);
        return { ok: lanes.length > 0, triggerLanes: lanes };
      }
      const mStatus = /^status_([a-z_]+)$/.exec(condition);
      if (mStatus) {
        const lane = self();
        if (lane === undefined) return { ok: false, triggerLanes: [] };
        // 「自レーンが X 状態」= このレーンに該当 EffectType のアクティブ効果が付与中
        //（lanesWith と同一規則・下限段数は問わない近似【Estimate】）
        const ok = lane.effects.some((e) => e.type === (mStatus[1] as SkillEffect["type"]));
        return { ok, triggerLanes: [lane.input.lane] };
      }
      const mStaminaGE = /^stamina>=(\d+)$/.exec(condition);
      if (mStaminaGE) {
        const lane = self();
        if (lane === undefined) return { ok: false, triggerLanes: [] };
        return {
          ok: (lane.stamina / lane.maxStamina) * 100 >= Number(mStaminaGE[1]),
          triggerLanes: [lane.input.lane],
        };
      }
      const mStaminaLE = /^stamina<=(\d+)$/.exec(condition);
      if (mStaminaLE) {
        const lane = self();
        if (lane === undefined) return { ok: false, triggerLanes: [] };
        return {
          ok: (lane.stamina / lane.maxStamina) * 100 <= Number(mStaminaLE[1]),
          triggerLanes: [lane.input.lane],
        };
      }
      const mSomeoneStaminaLE = /^someone_stamina<=(\d+)$/.exec(condition);
      if (mSomeoneStaminaLE) {
        const n = Number(mSomeoneStaminaLE[1]);
        const lanes = states
          .filter((s) => (s.stamina / s.maxStamina) * 100 <= n)
          .map((s) => s.input.lane);
        return { ok: lanes.length > 0, triggerLanes: lanes };
      }
      const mComboLE = /^combo<=(\d+)$/.exec(condition);
      if (mComboLE) {
        return { ok: ctx.globalCombo.value <= Number(mComboLE[1]), triggerLanes: [] };
      }
      // ビート時、N%の確率で（やる気士docs 専用フォト「ビート時、10%確率で」等）。
      // 発動試行（後半ビート）ごとに抽選。確定値ランは NeutralRng.nextFloat()=0 で常に成立
      //（既存の確率/成功率ゲートと同じ「全抽選成立」規約・T5 ゴールデンはこの条件を未使用で不変）
      const mBeatChance = /^beat_chance=(\d+)$/.exec(condition);
      if (mBeatChance) {
        return { ok: ctx.input.rng.nextFloat() < Number(mBeatChance[1]) / 100, triggerLanes: [] };
      }
      return { ok: false, triggerLanes: [] };
    }
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
  triggerLanes: readonly LaneNumber[] = [],
): { trace: ActivationTrace; activated: boolean } {
  const baseTrace = {
    beat,
    phase: phase === "first" ? ("first" as const) : ("last" as const),
    lane: state.input.lane,
    skillId: skill.id,
    kind: skill.kind,
  };

  // スキル/フォト共通のリミット（limitPerLive: ライブ中発動回数上限）。
  // 【2026-09-01 修正】photo 限定だったため P スキル（過去の私へ型・ライブ中1回のみ）が
  // 毎ビート再発動していた。T5 は該当スキルなしで不検出（サンプル1 b136-176 のトレースで発覚）。
  if (skill.limitPerLive != null) {
    if ((state.limitUsed.get(skill.id) ?? 0) >= skill.limitPerLive) {
      return { trace: { ...baseTrace, success: false, failReason: "limit" }, activated: false };
    }
  }
  if (skill.ct != null && (state.skillCt.get(skill.id) ?? 0) > 0) {
    return { trace: { ...baseTrace, success: false, failReason: "in_ct" }, activated: false };
  }

  const snap = snapshotOf(state);
  const cost = staminaCostOf(
    skill,
    snap,
    ctx.input.stage.skillStaminaWeightPermil,
    state.input.attribute,
  );
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
  state.staminaSpent += cost;
  state.activated += 1;
  if (skill.ct != null) {
    // 【T5実測確定】CT は満タンでセットし、ステップ9の減算に委ねる。
    // 前半発動は同ビート内のステップ9で減算されるため実効 CT−1（CTが0になったビートの
    // step11 で再使用可・gap CT−1）、後半発動は減算されないため実効 CT（gap CT）。
    // 実測 gap 系列（かんしょ 49/50/50、逆襲 50/50/35、さらけ出す 59/46）を完全再現する。
    // 旧「CT−1 初期化」は前半発動で gap CT−2 を生み research/08 §2.3 の実測則
    // （gap ≥ CT−1）に違反していたため修正。
    state.skillCt.set(skill.id, skill.ct);
  }
  if (skill.limitPerLive != null) {
    state.limitUsed.set(skill.id, (state.limitUsed.get(skill.id) ?? 0) + 1);
  }
  let gained = 0;
  state.scoreCumAtSkillStart = state.scoreCum; // 【2026-09-01】ratio 基準（スキル開始時点）
  for (const effect of skill.effects) {
    if (effect.condition === "battle_only") {
      continue; // 効果行レベルでも通常ライブは除外（P3a 仕様）
    }
    // 【2026-09-02 ユーザー確定】行ごとの独立条件評価: 条件行は適用時に個別判定し、
    // 不成立の行はスキップする（スキルは 1 行でも成立行があれば発動）。
    // 根拠: T5 紗季 A2・S2 怜 A2 = 1 行目（無条件スコア）のみ発動で 2 行目以降は
    // スキルウィンドウに表示されない／祭り千紗 P3 = 1 行目無条件で b1 前半発動。
    if (
      effect.condition !== "none" &&
      !evaluateCondition(effect.condition, state.input.lane, states, ctx).ok
    ) {
      continue;
    }
    gained += applyEffect(state, effect, skill, ctx, states, events, beat, false, triggerLanes);
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
      // 【サンプル2実測確定 2026-09-02・ユーザー計算式】超化（add_effect_value_*・
      // capExtend=true の効果行）は**増強型**: 対象レーンに同種バフのアクティブ・
      // インスタンスが存在するときのみ、残りビート最大のインスタンスへ +stages 段
      // （Peing確定: 表記段階数はダミーで一律+5段階分）を加算し、そのインスタンスの
      // 生存中は同種バフの上限を capExtend（加算量）ぶん拡張する。
      // **同種バフが存在しない場合は何もしない**。
      // 実測根拠（S2 L3 の ccu・トレース検証済み。千紗P2 みんなで走った海岸通り =
      // ccu8段[45b] を b1/b50/b100/b150 に付与、千紗A1 星見の海の波 超化(+5) は b14/b88/b148）:
      //   b41 = 13 段（P2@b1 の 8 段へ A1@b14 が +5 → critF 2504 = ユーザー式どおり）
      //   b100 = 0 段（P2@b50 分は b95 期限切れ・A1@b88 の +5 もそのインスタンスと共に消滅 → critF 1854）
      //   b142 = 8 段（P2@b100 分のみ・A1@b148 は基底消滅後で不発 → critF 2254）
      // 旧実装（独立 5 段インスタンス+capExtend）は b100 で ccu 5 を返し実測と矛盾した。
      // T5 golden の vocal_up_extreme（fest-03-2・独立キー）は発動ビート（b2/b69/b156）の
      // すべてで基底 vocal_up（逆襲）が有効なため加算値は同一・golden 不変。
      if (effect.capExtend === true) {
        amplifyLongestOfKey(target, mapped.key, effect.stages ?? 5);
        continue;
      }
      // 【ユーザー確定 2026-08-30】付与時に上限で切り捨てない（超過分は内部保持）。
      // 19段に+4段→内部23/表示20。期限切れ（インスタンス単位除去）後も内部段数が
      // 上限以上なら上限を維持する。クランプは aggregateBuffs（スナップショット時）のみ。
      // capExtend=true の独立付与は存在しない（上で増強型へ分岐・types.ts の型は互換のため残置）。
      target.effects.push({
        type: effect.type,
        stages: effect.stages ?? 1,
        limitRelease: mapped.limitRelease || effect.limitRelease === true,
        // 【実機仕様 2026-09-21 Phase 14】発動ビート終了時にも減算処理が走り、
        // 表記Nビートのバフは実質 N-1 ビート持続する（S1 b67/b131, T5 b32/b39/b44/b97 実機画面確定）
        remainingBeats: effect.durationBeats == null ? PERMANENT_BEATS : Math.max(1, effect.durationBeats - 1),
        sourceSkillId: skill.id,
        // 付与レーン（与・○○延長/増強の「自分が付与した効果」判定用）。
        // ライブボーナスはレーン非所属のためセンター（3）を記録（activateLiveBonus のアンカー）
        sourceLane: self.input.lane,
        skipFirstDecay,
      });
    }
    return 0;
  }
  switch (effect.type) {
    case "score_get":
    case "score_get_by_score_ratio":
      // ratio の基準は self.scoreCumAtSkillStart（スキル開始時点・score_get 行の加算前）を参照
      // 【2026-09-02】A スキルは写真の「Aスコア（固定値）」を平坦加算（b123: +92,262+121,429 等）。
      return settleScoreGet(
        self, effect, skill, ctx, states, events, beat,
        undefined,
        skill.kind === "A" ? self.input.aScoreAdditionalFlat ?? 0 : 0,
      );
    case "stamina_recovery": {
      const value = effect.value ?? 0;
      for (const target of resolveTargets(effect.target, self, states, triggerLanes)) {
        if (effect.durationBeats == null) {
          target.stamina = clampStamina(target, target.stamina + value);
          if (value > 0) {
            ctx.recoveredLanes.add(target.input.lane); // someone_recovered 条件用
          }
        } else {
          // 【サンプル3・2026-09-03】継続回復 tick = 15 × 段階 × ライブ特徴
          // （research/02 §1.8・research/01 §2.2「スタミナ継続回復 +15/段・ライブ特徴と乗算」。
          // S3 実測: のんびり/泥酔とも +45/beat = 15×3×1.0。100+ デルタで確定）。
          // 即時回復（duration なし）は従来どおり生値（T5 order9 +2560 で上限確認済み）。
          const tick = recoveryTickOf(value, ctx.input.stage.staminaRecoveryWeightPermil);
          target.scheduledRecoveries.push({ value: tick, remainingBeats: effect.durationBeats });
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
      if (effect.buffKey !== undefined || effect.scope === "given") {
        applyScopedAmplify(self, effect, value, states);
        return 0;
      }
      for (const target of resolveTargets(effect.target, self, states, triggerLanes)) {
        // 【T5実測確定】増強は BuffKey 毎に最長残り 1 インスタンスへ加算。
        // vocal_up_extreme は対象外（b3/b38 の増強後も vue 段数は不変・amplifyLongestPerKey 参照）
        amplifyLongestPerKey(target, value, false);
      }
      return 0;
    }
    case "effect_passing": {
      // 【サンプル4実測 2026-09-04・SK4#3】強化効果譲渡（strength_effect_assignment_all）。
      // 発動レーンの有効な強化バフ・インスタンスを**コピー**（残りビート・段数そのまま）して
      // 対象レーンへ付与する。源は消えない（実測: b77 の怜 SP で怜自身のバフは存続）。
      // 譲渡されたインスタンスは対象レーンの集計で既存と合算され、上限（20段等）は
      // aggregateBuffs のクランプで効く（実測: 怜Pスキルスコア上昇12→渚へ +12 で
      // 12→20 上限到達、ダンス上昇 20+20→20、ブースト 7+7→14 加算）。
      // buffKey 指定（strength_effect_assignment。全譲渡でなく特定バフのみ）は現データでは
      // 未出現のため、scope/buffKey の絞り込みはとりあえず効かない【Estimate: 全譲渡扱い】。
      const targets = resolveTargets(effect.target, self, states, triggerLanes);
      for (const target of targets) {
        if (target === self) {
          // 自己譲渡（コンボ不足等、マスタ上ありうる現象）はコピーを増やさずスキップ【Estimate】
          continue;
        }
        for (const active of self.effects) {
          if (active.remainingBeats <= 0 || active.stages <= 0) {
            continue;
          }
          if (mapEffectToBuffKey(active.type) === null) {
            continue; // 段階型でないものは対象外（保険。effects には段階型しか入らない）
          }
          // コンボ継続を含め「全強化効果」をそのままコピーする（マスタ文どおり・
          // S4 実測では譲渡側にコンボ継続が無く同定不能のため【Estimate】注記）。
          target.effects.push({
            type: active.type,
            stages: active.stages,
            limitRelease: active.limitRelease,
            remainingBeats: active.remainingBeats, // 残ビート共有（譲渡元と同時に消える）
            sourceSkillId: active.sourceSkillId, // 与・○○延長の「自分が付与した」判定は出所を維持
            sourceLane: active.sourceLane,
            skipFirstDecay: active.skipFirstDecay ?? false,
            capExtend: active.capExtend,
          });
        }
      }
      return 0;
    }
    case "effect_extension": {
      const value = effect.value ?? 0;
      if (effect.buffKey !== undefined || effect.scope === "given") {
        applyScopedExtension(self, effect, value, states);
        return 0;
      }
      // 【T5実測確定】延長は「延長可能（残り<永久）な全インスタンス」へ加算
      // （longest 単一インスタンス説は L3 ビート系列の破綻で棄却・research/12 §T5-2b）
      // 【2026-09-21 S1解明】発動ビート終了時（ステップ10）に remainingBeats が 1→0 に減衰した
      // 同ビート満了バフも、ステップ11（後半）の延長スキル（例: S1 b60 すず P3 センター7延長）の
      // 対象となる（rem=0 に +7 で 7 となり、翌ビート以降 b61〜b67 まで残存・実機画面完全一致）。
      // 前ビート以前に満了したバフはステップ1で除去済みのため rem>=0 で同ビート満了バフのみが安全に延長される。
      // 【2026-09-04 サンプル3】継続回復の予約（scheduledRecoveries）も延長対象
      // （S3 のんびり: さらけ出す b13/b73 の +7 で回復窓が 36→43b に延びる実測）。
      for (const target of resolveTargets(effect.target, self, states, triggerLanes)) {
        for (const active of target.effects) {
          if (active.remainingBeats >= 0 && active.remainingBeats < PERMANENT_BEATS) {
            active.remainingBeats += value;
          }
        }
        for (const recovery of target.scheduledRecoveries) {
          if (recovery.remainingBeats >= 0) {
            recovery.remainingBeats += value;
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
 * 【Phase 8-B4】与・○○延長/増強レタッチ用の対象インスタンス収集。
 * - buffKey 指定 → 該当 BuffKey のインスタンスのみ
 * - scope="given" → 全レーンのうち自レーンが付与した（sourceLane === 自レーン）インスタンス
 *   （「与・ボーカル延長」= 自分の Vo バフが付与先レーンで延長される）
 * - 上記以外（scope="received" 相当）→ 対象レーン解決に従う（被・○○延長 = 自レーンの効果）
 */
function collectScopedInstances(
  self: LaneState,
  effect: SkillEffect,
  states: readonly LaneState[],
): ActiveEffect[] {
  const out: ActiveEffect[] = [];
  const matches = (active: ActiveEffect): boolean => {
    if (effect.buffKey !== undefined) {
      const mapped = mapEffectToBuffKey(active.type);
      if (mapped === null || mapped.key !== effect.buffKey) return false;
    }
    return true;
  };
  if (effect.scope === "given") {
    for (const lane of states) {
      if (lane.input.lane === self.input.lane) {
        // 自レーン自身への自己付与も「与えた」効果に含める【Estimate: 与系レタッチの
        // 自バフ扱いは実機未確認。ゲーム内表記「自分が与える〜」の素直な解釈】
        for (const active of lane.effects) {
          if (matches(active)) out.push(active);
        }
      } else {
        for (const active of lane.effects) {
          if (active.sourceLane === self.input.lane && matches(active)) out.push(active);
        }
      }
    }
    return out;
  }
  for (const target of resolveTargets(effect.target, self, states, [])) {
    for (const active of target.effects) {
      if (matches(active)) out.push(active);
    }
  }
  return out;
}

/** スコープ付き延長（与・○○延長 等）。延長可能（残り<永久）なインスタンスへ加算 */
function applyScopedExtension(
  self: LaneState,
  effect: SkillEffect,
  value: number,
  states: readonly LaneState[],
): void {
  for (const active of collectScopedInstances(self, effect, states)) {
    if (active.remainingBeats < PERMANENT_BEATS) {
      active.remainingBeats += value;
    }
  }
}

/**
 * スコープ付き増強（与・○○増強 等）。収集したインスタンスのうち BuffKey 毎に最長残りの
 * 1 件へ段数加算（T5 実測確定の増強規則・amplifyLongestPerKey と同一。vocal_up_extreme は
 * 対象外・上限解放変数型は段数を持たないため対象外）。
 */
function applyScopedAmplify(
  self: LaneState,
  effect: SkillEffect,
  value: number,
  states: readonly LaneState[],
): void {
  const best = new Map<BuffKey, ActiveEffect>();
  for (const active of collectScopedInstances(self, effect, states)) {
    const mapped = mapEffectToBuffKey(active.type);
    if (
      mapped === null ||
      mapped.key === "vocal_up_extreme" ||
      mapped.key === "dance_up_extreme" ||
      mapped.key === "visual_up_extreme" ||
      mapped.limitRelease
    ) {
      continue;
    }
    const prev = best.get(mapped.key);
    if (prev === undefined || active.remainingBeats > prev.remainingBeats) {
      best.set(mapped.key, active);
    }
  }
  for (const active of best.values()) {
    // 増強の加算も上限で切り捨てない（ユーザー確定 2026-08-30・amplifyLongestPerKey と同一）
    active.stages += value;
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
    if (
      (mapped.key === "vocal_up_extreme" ||
        mapped.key === "dance_up_extreme" ||
        mapped.key === "visual_up_extreme") &&
      !affectsExtreme
    ) {
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
 * 指定キーの同種バフ・インスタンスのうち残りビート最大の 1 件へ段数を加算する。
 * 【サンプル2実測確定 2026-09-02・ユーザー計算式】超化（add_effect_value_*）は
 * この増強型であり、**同種バフのアクティブ・インスタンスが存在しない場合は不発**
 * （独立インスタンスを新規付与しない。b100 の L3 ccu=0 実測が根拠・applyEffect 参照）。
 * 上限解放変数型（limitRelease 実体）は段数を持たないため対象外（amplifyLongestPerKey と同一）。
 * 加算時の上限切り捨てなし（超過分は内部保持・ユーザー確定 2026-08-30）。
 */
function amplifyLongestOfKey(target: LaneState, key: BuffKey, value: number): void {
  let best: ActiveEffect | undefined;
  for (const active of target.effects) {
    const mapped = mapEffectToBuffKey(active.type);
    if (mapped === null || mapped.key !== key || mapped.limitRelease) {
      continue;
    }
    if (best === undefined || active.remainingBeats > best.remainingBeats) {
      best = active;
    }
  }
  if (best !== undefined) {
    best.stages += value;
    // 上限拡張量を受け取ったインスタンスに記録（生存中は同種バフの上限を拡張）。
    // aggregateBuffs が capExtend の最大値を上限へ加算する（buffs.ts）。
    const prevExt = typeof best.capExtend === "number" ? best.capExtend : 0;
    best.capExtend = prevExt + value;
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

/** 【2026-09-01 docs 引力式】他 4 レーンの {focus, stealth} スナップショット一覧 */
function otherFocusStealth(
  selfLane: LaneNumber,
  states: readonly LaneState[],
): ReadonlyArray<{ focus: number; stealth: number }> {
  const out: Array<{ focus: number; stealth: number }> = [];
  for (const s of states) {
    if (s.input.lane === selfLane) {
      continue;
    }
    const snap = snapshotOf(s);
    out.push({ focus: snap.focus, stealth: snap.stealth });
  }
  return out;
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
  ratioBasis?: number,
  aScoreFlat?: number,
): number {
  const snap = snapshotOf(self);
  const isRatio = effect.type === "score_get_by_score_ratio";
  const powerPermil = effect.powerPermil ?? 1000;
  // 【2026-09-01 たろう note 確定】「自身の獲得スコアは、この割合獲得より前の、自身の全獲得スコア」
  // → 基準は RATIO 行の実行時点のレーン累積（同一 SP の score_get 行（前の行）を含む）。
  const ratioBasisScoreCum = ratioBasis ?? self.scoreCum;

  let basicScore: number;
  let effectivePower: number;
  let basicScoreRaw: number | undefined;
  if (isRatio) {
    // 割合型: 基本スコア = 発動レーン自身の累積獲得スコア × SkillPower（切捨て）、コンボ/ファン不適用
    // 【2026-09-01 確定】「自身の獲得スコアの◯%」= 発動者のレーン累積（「自身」）。
    // T5 b103 検算 basic=533,472,897=4,445,607,475×0.12 もレーン累積（4,445,607,475 = L3 累積）。
    basicScoreRaw = ratioBasisScoreCum;
    basicScore = floorDiv(ratioBasisScoreCum * powerPermil, 1000);
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
    // type36 scaling（research/type36_coefficients.md の係数表 / golden フィット値で計算）
    // perStagePermil は T5実測フィット値（2.5 等、小数になり得る）のため素の乗算で計算する。
    // 丸めは「0.1%（=permil）切り捨て」= Math.floor（docs gid=806980235 明記と一致）。
    effectivePower = scaledSkillPowerPermil(powerPermil, effect.scaling, snap, self, ctx);
  }

  const kind: B1Kind =
    skill.kind === "A" ? "active" : skill.kind === "SP" ? "special" : "passive";
  const b1 = b1Permil(snap, kind, self.input.scoreBonusPct);
  const comboF = isRatio
    ? 1000
    : comboFactorPermil(ctx.displayCombo.value, snap.combo_score_up);
  // 【Phase 9】ステルス副効果: 他レーンのステルス段数ぶんファンボーナスに加算
  // （research/01 §2.6・peing id=1188720397。割合型はファン不適用のため 1000 のまま）
  const fanF = isRatio
    ? 1000
    : ctx.input.fanBaseCount !== undefined
      ? fanFactorPermilByAttraction(
          ctx.input.fanBaseCount,
          snap.focus,
          snap.stealth,
          otherFocusStealth(self.input.lane, states),
        )
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
  // 【2026-09-02 ユーザー計算式確定】写真の「Aスコア（固定値）」は A スキルのスコアに平坦加算
  // （b123: +92,262+121,429 = 1,931,275、b66/b176/b40/97/130 も同様に整合。b40/97/130 の
  //   千紗ビームも 177,075 で 98.3%/102.6%/101.7% に収束）
  // 【サンプル3・2026-09-04】キャラ優位は全スコアに乗る（STAGE045 の ⅢX メンバー・
  // ユーザー確定）。computeEventScore のファクター列には入れない（8 因子化で T5 golden が
  // float 丸めで ±1 ずれるため。後段で整数乗算する。flat 加算との前後・ratio 基準への
  // 波及は未観測のため【Estimate】: 乗算分のみに適用し flat は対象外）。
  const advantage = self.input.characterAdvantagePermil ?? 1000;
  const finalScore = mulPermil(score, advantage) + (isRatio ? 0 : aScoreFlat ?? 0);
  ctx.cumulative.value += finalScore;
  self.scoreCum += finalScore;
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
    gainedScore: finalScore,
  });
  return finalScore;
}

/**
 * scaling.ref（例 "vocal_up_stages"）→ スナップショットの実効段数【Estimate: §5.2】。
 * Phase 6（マスタ一般化）で vocal_up 以外の type36 参照キー（a_skill_score_up 等）にも対応。
 * 未対応の ref は throw（skills_master パーサーは未対応 ref を scaling=null で出力する）。
 */
const SCALING_REF_KEYS: ReadonlyMap<string, readonly BuffKey[]> = new Map([
  // 【2026-09-01・簡易検証で確定】type36 の参照段数は「ボーカル上昇」のみ。
  // ボーカル上昇超化（vue）は参照に含まれない（星見プロ A: b51 19段 で k=5.9%・
  // 成宮すず SP: b143 7段（vue 10段 は無視）で k=6% と整合。T5 旧フィットの
  // 「vue 込み 25/30 段」は誤りと判明）。超化自体はステータス +25%（vue=+250‰・別経路）。
  ["vocal_up_stages", ["vocal_up"]],
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
 * type36 スケーリングを適用した SkillPower permil を返す。
 *
 * 式と係数の出典は research/type36_coefficients.md（やるキ士docs gid=806980235 / Peing /
 * T5実測フィットの突合表）。丸めは「0.1%（=permil）切り捨て」= Math.floor。
 * - linear（既定）: power × (1000 + perStagePermil × 参照段数) / 1000
 * - comboLessQuad: power × (1000 + amplitude×((max(0, reference−combo)/reference)^exponent))/1000
 *   参照コンボは「発動前のコンボ数」= このノート処理前の表示コンボ（A/SP は
 *   displayCombo が当該ノートの前の値、P はビート内ノート処理後の値〔§9 の順序どおり〕）。
 * - comboMoreLinear: power × (1000 + perComboPermil×コンボ) / 1000
 * - effectCount: 自身の「強化効果の種類数」（スナップショットで段>0 のバフ種を計数。
 *   combo_continue/stealth は継続・隠蔽効果のため除外【Estimate】）
 * - staminaRatioQuad: 発動後のスタミナ率²（remainingRatio=false なら消費率²）
 * - staminaConsumedLinear: 累積消費スタミナ（本エンジンはスキル/フォト消費のみ計上）
 * - skillCountLinear: 自身の成功発動数（P/フォト/A/SP を計上）
 */
export function scaledSkillPowerPermil(
  powerPermil: number,
  scaling: SkillEffect["scaling"],
  snap: BuffSnapshot,
  self: LaneState,
  ctx: EngineCtx,
): number {
  if (scaling == null) return powerPermil;
  const formula = scaling.formula ?? "linear";
  switch (formula) {
    case "linear": {
      if (scaling.ref == null || scaling.perStagePermil == null) return powerPermil;
      const refStages = scalingStages(scaling.ref, snap);
      return Math.floor((powerPermil * (1000 + scaling.perStagePermil * refStages)) / 1000);
    }
    case "comboLessQuad": {
      const reference = scaling.reference ?? 150;
      const amplitude = scaling.amplitudePermil ?? 0;
      const exponent = scaling.exponent ?? 2;
      const combo = ctx.displayCombo.value;
      const t = Math.max(0, reference - combo) / reference;
      return Math.floor((powerPermil * (1000 + amplitude * Math.pow(t, exponent))) / 1000);
    }
    case "comboMoreLinear": {
      const per = scaling.perComboPermil ?? 0;
      const combo = ctx.displayCombo.value;
      return Math.floor((powerPermil * (1000 + per * combo)) / 1000);
    }
    case "effectCount": {
      const per = scaling.perTypePermil ?? 0;
      let count = 0;
      for (const [key, value] of Object.entries(snap)) {
        if (typeof value === "number" && value > 0 && key !== "combo_continue" && key !== "stealth") {
          count += 1;
        }
      }
      const cap = scaling.maxTypes ?? Number.POSITIVE_INFINITY;
      count = Math.min(count, cap);
      return Math.floor((powerPermil * (1000 + per * count)) / 1000);
    }
    case "staminaRatioQuad": {
      const max = scaling.maxPermil ?? 0;
      const remaining = self.stamina / Math.max(1, self.maxStamina);
      const ratio = scaling.remainingRatio === false ? 1 - remaining : remaining;
      return Math.floor((powerPermil * (1000 + max * ratio * ratio)) / 1000);
    }
    case "staminaConsumedLinear": {
      const per = scaling.perStaminaPermil ?? 0;
      return Math.floor((powerPermil * (1000 + per * self.staminaSpent)) / 1000);
    }
    case "skillCountLinear": {
      const per = scaling.perCountPermil ?? 0;
      return Math.floor((powerPermil * (1000 + per * self.activated)) / 1000);
    }
    default:
      throw new Error(`settleScoreGet: unsupported scaling formula: ${formula}`);
  }
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
    // 【2026-09-01 実測メモ（IMG_1512）で修正】ビート CB も「1000 + 2.5×表示コンボ‰」。
    // 旧式（閾値テーブル × csu 連成 BEAT_CB_CSU_*）は csu を B2 に二重乗算しており
    // 実測（B2 = 1725‰ @cb 290・csu は B1 側のみ）と不一致 → 全種目 B2 は
    // src/formula/combo.ts の comboFactorPermil（B1 が csu を 25‰/段 で持つ）+ csu なし。
    const comboF = comboFactorPermil(ctx.displayCombo.value, snap.combo_score_up);
    // 【Phase 9】ステルス副効果（他レーンの stealth 段数 → ファンボーナス加算）
    const fanF =
      ctx.input.fanBaseCount !== undefined
        ? fanFactorPermilByAttraction(
            ctx.input.fanBaseCount,
            snap.focus,
            snap.stealth,
            otherFocusStealth(state.input.lane, states),
          )
        : fanFactorPermil(ctx.input.fanFactorPermil, snap.focus) +
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
    // 【サンプル3・2026-09-04】キャラ優位は全スコアに乗る（STAGE045 の ⅢX メンバー・
    // ユーザー確定。ファクター列に入れると T5 golden が float 丸めでずれるため後段乗算）
    const advantage = state.input.characterAdvantagePermil ?? 1000;
    const finalBeatScore = mulPermil(score, advantage);
    ctx.cumulative.value += finalBeatScore;
    state.scoreCum += finalBeatScore;
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
      gainedScore: finalBeatScore,
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
    applyComboFailOnNote(state, ctx, states);
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
    const cost = staminaCostOf(
      skill,
      snap,
      ctx.input.stage.skillStaminaWeightPermil,
      state.input.attribute,
    );
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
    applyComboFailOnNote(state, ctx, states);
    return;
  }
  // 発動: スタミナ消費 → CT設定 → 効果適用（research/13 §5.2・§6。上から順【Confirmed】）
  state.stamina -= costOfChosen;
  state.staminaSpent += costOfChosen;
  state.activated += 1;
  if (chosen.ct != null) {
    // 【T5実測確定】CT は満タンでセット（tryActivate のコメント参照。ステップ9減算に委ねる）
    state.skillCt.set(chosen.id, chosen.ct);
  }
  let gained = 0;
  state.scoreCumAtSkillStart = state.scoreCum; // 【2026-09-01】ratio 基準（A/SP/フォト/ライブボーナス開始時点）
  // 【2026-09-02 サンプル1 ユーザー計算式で確定】A/SP の効果行はマスタ順のまま処理する。
  // スキル説明どおり「スコア獲得」→「ステータスアップ」の順で、スコアの基本値は
  // 自身のステータス系バフ（vb 等）の**適用前**のステータスを参照する（PRE）。
  //   b123 の「夏を先取りお祭り騒ぎ」: ステータス 296,208（PRE、自身 vb4 適用前）でスコア
  //   （→ 296,208×3.6×1.286×1.002×1.25+92,262+121,429 = 1,931,275、実測 1,843,767 は ×0.955 で ±5% 内）
  //   b66/b176 も同様（PRE。以前の POST 仮説は誤りと撤回）
  // また写真の「Aスコア（固定値）」は A スキルのスコアに**平坦加算**される（b123: +92,262+121,429）
  const effectsOrdered = [...chosen.effects];
  for (const effect of effectsOrdered) {
    if (effect.condition === "battle_only") {
      continue;
    }
    // 【2026-09-02 ユーザー確定】行ごとの独立条件評価（tryActivate のループと同一規則）:
    // T5 紗季 A2 / S2 怜 A2 = 1 行目（無条件スコア）のみ発動し、レーン属性不一致の
    // 2 行目以降（超化・ccu）はスキルウィンドウに表示されない＝適用されない。
    if (
      effect.condition !== "none" &&
      !evaluateCondition(effect.condition, laneNum, states, ctx).ok
    ) {
      continue;
    }
    // A/SP（ステップ8）付与の段階型効果も付与ビート終了時（ステップ10）に減衰する（実機仕様）
    gained += applyEffect(state, effect, chosen, ctx, states, events, note.beat, false);
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
  // 成功: コンボ+1（§5.2）。表示コンボ・条件用カウンタも +1
  state.combo += 1;
  ctx.globalCombo.value += 1;
  ctx.displayCombo.value += 1;
}

/**
 * A/SP ノート FAIL 時のコンボ処理（サンプル1実測確定 2026-09-01）。
 * - コンボ継続バフなし: 全レーンのコンボ・条件用カウンタ（globalCombo）・表示コンボを
 *   0 にリセット（サンプル1 b56: L2 SP FAIL で COMBO 55→0。以後 b-56。過去の私へ
 *   (combo>=80) が b136 で発火＝リセット後の表示コンボ 80 と整合）。
 * - コンボ継続バフあり（T5 b49 実測）: リセットされず、表示コンボは +1 して消化
 *   （T5 b49: COMBO 48→49。レーン別コンボ自体は加算しないため T5 ゴールデンの
 *   CB 係数は不変）。
 */
function applyComboFailOnNote(
  failing: LaneState,
  ctx: EngineCtx,
  states: readonly LaneState[],
): void {
  if (snapshotOf(failing).combo_continue === 0) {
    for (const s of states) {
      s.combo = 0;
    }
    ctx.globalCombo.value = 0;
    ctx.displayCombo.value = 0;
  } else {
    ctx.displayCombo.value += 1;
  }
}

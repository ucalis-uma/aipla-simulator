/**
 * 最適編成探索（Live Optimizer・Phase 7）。
 *
 * 指定ステージ/譜面に対して最高スコアを出せる 5 人編成（カード選定＋配置レーン）を
 * 「ヒューリスティック事前スクリーニング → 貪欲初期解 → 局所探索（レーン入替え +
 * レーン間スワップ）→ 上位候補の高精度再評価」で探索する。
 *
 * 評価は共通乱数（CRN: 候補間で同一シード列）の Monte Carlo 平均を使用し、
 * ±5% スコア乱数・動的クリティカル（Peing確定式）を含む。乱数源は src/rng のみ、
 * 外部依存なし。UI（単一HTML）からも CLI 相当のデータ注入で再利用可能。
 *
 * 評価条件の共通前提（Estimate レベルの単純化）:
 * - 装備（フォト/アクセサリ）なし・レベル最大・交流Lv1・メンタル100
 * - ロールは全員 Scorer（buffer/supporter_type 系ターゲットは未考慮）
 * - missedNotes なし（オプションで注入可）
 */
import {
  availableLevels,
  buildSimulateInput,
  laneAttributeOf,
  type DeckJsonV2,
  type MasterSkillDef,
  type PhotoOrAccessory,
  type SimSourceData,
} from "../sim/build.js";
import { myPhotoToEquipEntry, myPhotoToSkillDef, validatePhotoEquip, type MyPhotoDef } from "../photos.js";
import { ContinuousRng } from "../rng/random.js";
import { NeutralRng } from "../rng/neutral.js";
import { simulateTimeline } from "../timeline/engine.js";
import type { LaneNumber } from "../timeline/types.js";

export type OptimizerAttr = "vocal" | "dance" | "visual";

export interface OptimizerProgress {
  phase: string;
  evaluations: number;
  best: number;
}

export interface OptimizerOptions {
  data: SimSourceData;
  stageFile: string;
  chartFile: string;
  /** position 1-5 の属性コード（ステージの laneAttributes） */
  laneAttributes: readonly number[];
  audience?: number;
  successBasePermil?: number;
  missedNotes?: ReadonlyArray<{ beat: number; lane: number }>;
  mentalOverride?: Record<string, number>;
  /** 【Peing確定】基礎クリティカル率（MC 評価で動的クリティカル有効） */
  baseCritRate?: number;
  /** 事前スクリーニングで残す候補カード枚数（既定 28） */
  poolSize?: number;
  /** スクリーニング評価の MC 回数（既定 3） */
  screenRuns?: number;
  /** 最終再評価の MC 回数（既定 12） */
  finalRuns?: number;
  /** 乱数シード（既定 1） */
  seed?: number;
  /** ランキング表示件数（既定 5） */
  topN?: number;
  /** 改善パスの最大数（既定 3） */
  maxPasses?: number;
  /** 探索の時間予算 ms（既定 20000） */
  timeBudgetMs?: number;
  /** レーン毎の固定カード（null は自由。例: センター固定） */
  lockedCardIds?: ReadonlyArray<string | null | undefined>;
  /** レーン毎の属性縛り（カードの得意属性。null は自由） */
  attrFilter?: ReadonlyArray<OptimizerAttr | null | undefined>;
  /**
   * 【Phase 8-C】必須採用カード（レーン自由）。編成のどこかに必ず含まれる。
   * 自由枠が尽きた場合は最後の自由レーンに強制配置する。
   */
  requiredCardId?: string | null;
  /**
   * 【Phase 8-C】マイフォト帳のフォトプール（タグ絞り込み済み）。
   * 指定時はカード探索後に各レーンへのフォト配分を貪欲探索する。
   * ゲーム内ルール（レタッチ1枚・1人最大5枚）は validatePhotoEquip で厳守。
   */
  photoPool?: ReadonlyArray<MyPhotoDef>;
  onProgress?: (info: OptimizerProgress) => void;
}

export interface OptimizerEntry {
  /** MC 平均スコア（finalRuns 回・CRN） */
  score: number;
  /** 確定値（乱数中立・クリティカルなし） */
  confirmed: number;
  /** レーン 1-5 のカードID */
  cardIds: string[];
  /**
   * 【Phase 8-C】レーン 1-5 に割り当てたフォト ID（photoPool 由来）。
   * photoPool 未指定時はすべて null。
   */
  photoIds: Array<string | null>;
}

export interface OptimizerResult {
  entries: OptimizerEntry[];
  /** 事前スクリーニングを通過した候補カードID */
  pool: string[];
  evaluations: number;
  elapsedMs: number;
  /** 時間予算で探索を打ち切ったか */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// 内部ヘルパー
// ---------------------------------------------------------------------------

function cardAttrOf(card: SimSourceData["cards"][number]): OptimizerAttr {
  const r = card.ratiosPermil;
  const max = Math.max(r.vocal, r.dance, r.visual);
  if (max === r.vocal) return "vocal";
  if (max === r.dance) return "dance";
  return "visual";
}

/** プール選定用ヒューリスティック（レーン属性ボーナス付き。正確性より高速な大まかな順位付け） */
function heuristicOf(
  card: SimSourceData["cards"][number],
  data: SimSourceData,
  laneAttributes: readonly number[],
  beatWeightsPermil: { vocal: number; dance: number; visual: number },
  skillWeightsPermil: { active: number; special: number },
  lane?: LaneNumber,
): number {
  const w = beatWeightsPermil;
  const attr = cardAttrOf(card);
  let score = attr === "vocal" ? w.vocal : attr === "dance" ? w.dance : w.visual;
  if (lane !== undefined) {
    const laneAttr = laneAttributeOf(lane, laneAttributes);
    if (laneAttr === attr) score *= 1.2;
  }
  const skills = (data.skillsByCard as Record<string, readonly MasterSkillDef[]> | undefined)?.[
    card.id
  ];
  if (skills !== undefined) {
    for (const s of skills) {
      const kindW =
        s.kind === "SP" ? skillWeightsPermil.special : s.kind === "A" ? skillWeightsPermil.active : 400;
      for (const e of s.effects) {
        const raw =
          e.type === "score_get"
            ? (e.powerPermil ?? 0)
            : e.type === "score_get_by_score_ratio"
              ? (e.powerPermil ?? 0) * 2
              : (e.stages ?? 0) * 120 +
                (e.durationBeats ?? 0) * 8 +
                (e.type === "ct_reduction"
                  ? (e.value ?? 0) * 8
                  : e.type === "effect_amplify"
                    ? (e.value ?? 0) * 150
                    : e.type === "effect_extension"
                      ? (e.value ?? 0) * 60
                      : 0);
        score += (raw * kindW) / 1000;
      }
    }
  }
  return score;
}

const yieldToUi = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

export async function optimizeLineup(options: OptimizerOptions): Promise<OptimizerResult> {
  const {
    data,
    stageFile,
    chartFile,
    laneAttributes,
    poolSize = 28,
    screenRuns = 3,
    finalRuns = 12,
    seed = 1,
    topN = 5,
    maxPasses = 3,
    timeBudgetMs = 20000,
    lockedCardIds = [],
    attrFilter = [],
    requiredCardId = null,
    photoPool = [],
    onProgress,
  } = options;

  const stageWeights = data.stages[stageFile];
  if (stageWeights === undefined) {
    throw new Error(`optimizer: stage not found in data: ${stageFile}`);
  }
  if (data.charts[chartFile] === undefined) {
    throw new Error(`optimizer: chart not found in data: ${chartFile}`);
  }
  if (laneAttributes.length !== 5) {
    throw new Error("optimizer: laneAttributes must have 5 entries");
  }

  const startedAt = Date.now();
  const maxLevelCache = new Map<string, number>();
  const cardCache = new Map<string, SimSourceData["cards"][number]>();
  const maxLevelOf = (cardId: string): number => {
    let lv = maxLevelCache.get(cardId);
    if (lv === undefined) {
      const levels = availableLevels(data, cardId);
      lv = levels.length > 0 ? levels[levels.length - 1]! : 1;
      maxLevelCache.set(cardId, lv);
    }
    return lv;
  };
  const cardOf = (cardId: string): SimSourceData["cards"][number] => {
    let c = cardCache.get(cardId);
    if (c === undefined) {
      const found = data.cards.find((x) => x.id === cardId);
      if (found === undefined) throw new Error(`optimizer: card not found: ${cardId}`);
      c = found;
      cardCache.set(cardId, c);
    }
    return c;
  };

  // ---- 候補プール（ヒューリスティック上位 + 固定カード） ----
  const locks: Array<string | null> = [0, 1, 2, 3, 4].map(
    (i) => lockedCardIds[i] ?? null,
  );
  const attrOfLane: Array<OptimizerAttr | null> = [0, 1, 2, 3, 4].map(
    (i) => attrFilter[i] ?? null,
  );
  const passesAttr = (laneIdx: number, cardId: string): boolean => {
    const f = attrOfLane[laneIdx];
    return f === null || f === undefined || cardAttrOf(cardOf(cardId)) === f;
  };

  const scored = data.cards
    .filter((c) => availableLevels(data, c.id).length > 0)
    .map((c) => ({
      id: c.id,
      h: heuristicOf(c, data, laneAttributes, stageWeights.beatWeightsPermil, stageWeights.skillWeightsPermil),
    }))
    .sort((a, b) => b.h - a.h || a.id.localeCompare(b.id));
  const poolSet = new Set<string>();
  for (const s of scored) {
    if (poolSet.size >= Math.max(poolSize, 5)) break;
    poolSet.add(s.id);
  }
  for (const lock of locks) {
    if (lock !== null && data.cards.some((c) => c.id === lock)) poolSet.add(lock);
  }
  // 【Phase 8-C】必須採用カードをプールに強制追加
  if (requiredCardId !== null && requiredCardId !== undefined && data.cards.some((c) => c.id === requiredCardId)) {
    poolSet.add(requiredCardId);
  }
  const pool = [...poolSet];

  // ---- 評価器（CRN: 共通乱数で候補間の比較分散を低減） ----
  let evaluations = 0;
  let truncated = false;
  const budgetLeft = (): boolean => Date.now() - startedAt < timeBudgetMs;

  // ---- 【Phase 8-C】フォトプールの変換（装備エントリ + スキル生成器） ----
  const photoDefs = photoPool.map((p) => ({
    def: p,
    entry: myPhotoToEquipEntry(p) as PhotoOrAccessory,
  }));
  const photoOf = (photoId: string): (typeof photoDefs)[number] | undefined =>
    photoDefs.find((p) => p.def.id === photoId);

  const deckFromLineup = (
    lineup: readonly string[],
    /** レーン 1-5 に割り当てたフォト ID（null = フォトなし。Phase 8-C） */
    photoIds: ReadonlyArray<string | null | undefined> = [],
  ): DeckJsonV2 => ({
    staff_bonus: { vocal: 0, dance: 0, visual: 0, stamina: 0, mental: 0, critical: 0 },
    yale_bonus: {
      vocal_pct: 0,
      dance_pct: 0,
      visual_pct: 0,
      stamina: 0,
      mental: 0,
      critical: 0,
      beat_score_pct: 0,
      a_skill_score_pct: 0,
      sp_skill_score_pct: 0,
      critical_score_pct: 0,
    },
    characters: lineup.map((cardId, i) => {
      const card = cardOf(cardId);
      const photoId = photoIds[i];
      const photo = photoId != null ? photoOf(photoId) : undefined;
      return {
        lane: i + 1,
        card_id: cardId,
        level: maxLevelOf(cardId),
        rarity: card.initialRarity,
        role: "Scorer",
        kouryu_level: 1,
        stats: {
          base: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
          total_after_non_skill_modifiers: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
        },
        photos: photo !== undefined ? [photo.entry] : [],
        accessories: [],
      };
    }),
  });

  const evalLineup = async (
    lineup: readonly string[],
    runs: number,
    photoIds: ReadonlyArray<string | null | undefined> = [],
  ): Promise<number> => {
    if (!budgetLeft()) {
      truncated = true;
      return Number.NEGATIVE_INFINITY;
    }
    try {
      const userPhotoSkills = photoIds
        .map((pid, i) =>
          pid != null ? myPhotoToSkillDef(photoOf(pid)!.def, (i + 1) as LaneNumber, 1) : null,
        )
        .filter((s): s is NonNullable<typeof s> => s !== null);
      const built = buildSimulateInput({
        deck: deckFromLineup(lineup, photoIds),
        stageFile,
        chartFile,
        data,
        audience: options.audience,
        successBasePermil: options.successBasePermil,
        missedNotes: options.missedNotes as Array<{ beat: number; lane: number }> | undefined,
        mentalOverride: options.mentalOverride,
        baseCritRate: options.baseCritRate,
        userPhotoSkills,
      });
      let sum = 0;
      for (let i = 0; i < runs; i++) {
        // CRN: シードは編成によらず同一（候補間の公平な比較）
        const rng = new ContinuousRng(seed * 7919 + i * 104729 + 1);
        sum += simulateTimeline({ ...built.base, rng, criticalProvider: () => false }).totalScore;
      }
      evaluations += 1;
      if (evaluations % 4 === 0) await yieldToUi();
      onProgress?.({ phase: "探索中", evaluations, best: sum / runs });
      return sum / runs;
    } catch {
      // 構築不可カード（レベル行欠損等）は最悪値として扱う
      evaluations += 1;
      return Number.NEGATIVE_INFINITY;
    }
  };

  const confirmedOf = (lineup: readonly string[], photoIds: ReadonlyArray<string | null | undefined> = []): number => {
    try {
      const userPhotoSkills = photoIds
        .map((pid, i) =>
          pid != null ? myPhotoToSkillDef(photoOf(pid)!.def, (i + 1) as LaneNumber, 1) : null,
        )
        .filter((s): s is NonNullable<typeof s> => s !== null);
      const built = buildSimulateInput({
        deck: deckFromLineup(lineup, photoIds),
        stageFile,
        chartFile,
        data,
        audience: options.audience,
        successBasePermil: options.successBasePermil,
        missedNotes: options.missedNotes as Array<{ beat: number; lane: number }> | undefined,
        mentalOverride: options.mentalOverride,
        userPhotoSkills,
      });
      return simulateTimeline({
        ...built.base,
        baseCritRate: undefined,
        rng: new NeutralRng(),
        criticalProvider: () => false,
      }).totalScore;
    } catch {
      return 0;
    }
  };

  // 上位候補の保持（重複排除・score 降順）
  const seen = new Map<string, number>();
  const top: Array<{ lineup: string[]; score: number }> = [];
  const remember = (lineup: readonly string[], score: number): void => {
    if (!Number.isFinite(score)) return;
    const key = lineup.join("|");
    const prev = seen.get(key);
    if (prev !== undefined && prev >= score) return;
    seen.set(key, score);
    const idx = top.findIndex((t) => t.lineup.join("|") === key);
    if (idx >= 0) top[idx]!.score = score;
    else top.push({ lineup: [...lineup], score });
    top.sort((a, b) => b.score - a.score);
    if (top.length > Math.max(topN * 2, 8)) top.pop();
  };

  // ---- 貪欲初期解（レーン重みの高いレーンから、ヒューリスティック最大のカードを配置） ----
  const laneOrder = ([1, 2, 3, 4, 5] as LaneNumber[])
    .map((lane) => {
      const attr = laneAttributeOf(lane, laneAttributes);
      const w = stageWeights.beatWeightsPermil;
      return { lane, w: attr === "vocal" ? w.vocal : attr === "dance" ? w.dance : w.visual };
    })
    .sort((a, b) => b.w - a.w);
  const current: Array<string | null> = [...locks];
  const used = new Set<string>();
  // 【Phase 8-C】必須採用カードを「重み最小の自由レーン」に先に配置する
  // （重み最小 = スコア貢献が最も小さいレーンで、火力カードを高重量レーンに残す）。
  // 属性縛りに適合する自由レーンが無い場合は配置を諦め、局所探索に委ねる。
  if (
    requiredCardId !== null &&
    requiredCardId !== undefined &&
    !locks.includes(requiredCardId)
  ) {
    const freeLanes = laneOrder.filter(({ lane }) => current[lane - 1] === null);
    const fitLane = [...freeLanes]
      .reverse()
      .find(({ lane }) => passesAttr(lane - 1, requiredCardId));
    if (fitLane !== undefined) {
      current[fitLane.lane - 1] = requiredCardId;
      used.add(requiredCardId);
    }
  }
  for (const { lane } of laneOrder) {
    const laneIdx = lane - 1;
    if (current[laneIdx] !== null) {
      used.add(current[laneIdx]!);
      continue;
    }
    const candidates = pool
      .filter((id) => !used.has(id) && passesAttr(laneIdx, id))
      .map((id) => ({
        id,
        h: heuristicOf(
          cardOf(id),
          data,
          laneAttributes,
          stageWeights.beatWeightsPermil,
          stageWeights.skillWeightsPermil,
          lane,
        ),
      }))
      .sort((a, b) => b.h - a.h);
    const pick = candidates[0]?.id;
    if (pick === undefined) {
      throw new Error("optimizer: 制約（属性縛り/固定カード）を満たす編成を構築できません");
    }
    current[laneIdx] = pick;
    used.add(pick);
  }
  const baseLineup = current as string[];

  let bestScore = await evalLineup(baseLineup, screenRuns);
  remember(baseLineup, bestScore);
  let bestLineup = [...baseLineup];

  // ---- 局所探索（レーン入替え + レーン間スワップ） ----
  for (let pass = 0; pass < maxPasses && !truncated && budgetLeft(); pass++) {
    let improved = false;
    for (const { lane } of laneOrder) {
      const laneIdx = lane - 1;
      if (locks[laneIdx] !== null) continue;
      const candidates = pool.filter(
        (id) =>
          !bestLineup.includes(id) &&
          passesAttr(laneIdx, id) &&
          // 【Phase 8-C】必須採用カードが入っているレーンは置き換えない
          bestLineup[laneIdx] !== requiredCardId,
      );
      for (const cand of candidates) {
        if (truncated || !budgetLeft()) break;
        const trial = [...bestLineup];
        trial[laneIdx] = cand;
        const s = await evalLineup(trial, screenRuns);
        remember(trial, s);
        if (s > bestScore + 1e-9) {
          bestScore = s;
          bestLineup = trial;
          improved = true;
        }
      }
      if (truncated || !budgetLeft()) break;
    }
    // レーン間スワップ（配置最適化）
    if (!truncated && budgetLeft()) {
      for (let i = 0; i < 5 && !truncated; i++) {
        for (let j = i + 1; j < 5; j++) {
          if (locks[i] !== null || locks[j] !== null) continue;
          const trial = [...bestLineup];
          [trial[i], trial[j]] = [trial[j]!, trial[i]!];
          const s = await evalLineup(trial, screenRuns);
          remember(trial, s);
          if (s > bestScore + 1e-9) {
            bestScore = s;
            bestLineup = trial;
            improved = true;
          }
          if (!budgetLeft()) {
            truncated = true;
            break;
          }
        }
        if (truncated) break;
      }
    }
    onProgress?.({ phase: `パス${pass + 1}完了`, evaluations, best: bestScore });
    if (!improved) break;
  }

  // ---- 【Phase 8-C】フォト配分（タグ指定プールからの貪欲割り当て） ----
  // カード探索で残った上位編成に対し、ゲーム内ルール（レタッチ1枚・1人最大5枚・
  // 同一フォトは全体で1回）を守りながら「1枚追加で最も伸びる (フォト, レーン) 組」を
  // 繰り返し採用する。時間予算内で打ち切り（打ち切り時点の割当が結果に残る）。
  const assignPhotos = async (
    lineup: readonly string[],
    runs: number,
  ): Promise<Array<string | null>> => {
    const assignment: Array<string | null> = [null, null, null, null, null];
    if (photoDefs.length === 0) return assignment;
    let best = await evalLineup(lineup, runs, assignment);
    if (!Number.isFinite(best)) return assignment;
    let improved = true;
    while (improved && !truncated && budgetLeft()) {
      improved = false;
      const usedIds = new Set(assignment.filter((x): x is string => x !== null));
      let bestGain = 1e-9;
      let bestPick: { photoId: string; laneIdx: number } | null = null;
      for (const pd of photoDefs) {
        if (usedIds.has(pd.def.id)) continue;
        for (let laneIdx = 0; laneIdx < 5; laneIdx++) {
          if (truncated || !budgetLeft()) break;
          const trial = [...assignment];
          trial[laneIdx] = pd.def.id;
          // ゲーム内ルール厳守チェック（レタッチは1人1枚・1人最大5枚）
          const conflicts = validatePhotoEquip(
            assignment
              .filter((pid, i) => pid !== null && i !== laneIdx)
              .map((pid) => photoOf(pid as string)!.def),
            pd.def,
          );
          if (conflicts.length > 0) continue;
          const s = await evalLineup(lineup, runs, trial);
          if (s > best + bestGain) {
            bestGain = s - best;
            bestPick = { photoId: pd.def.id, laneIdx };
          }
          if (truncated) break;
        }
        if (truncated) break;
      }
      if (bestPick !== null) {
        assignment[bestPick.laneIdx] = bestPick.photoId;
        best += bestGain;
        improved = true;
      }
    }
    return assignment;
  };

  // ---- 最終再評価（finalRuns・確定値付き）でランキング確定 ----
  const finalists = top.slice(0, Math.max(topN, 1));
  const entries: OptimizerEntry[] = [];
  for (const f of finalists) {
    // フォト配分は最終評価と同時に行う（配分済み状態の finalRuns 再評価を避けるため
    // 配分探索は screenRuns で行い、確定値は配分結果に対して算出する）
    const photoIds = await assignPhotos(f.lineup, screenRuns);
    if (truncated) {
      entries.push({
        score: f.score,
        confirmed: confirmedOf(f.lineup, photoIds),
        cardIds: f.lineup,
        photoIds,
      });
      continue;
    }
    const s = await evalLineup(f.lineup, finalRuns, photoIds);
    entries.push({
      score: Number.isFinite(s) ? s : f.score,
      confirmed: confirmedOf(f.lineup, photoIds),
      cardIds: f.lineup,
      photoIds,
    });
  }
  entries.sort((a, b) => b.score - a.score);
  onProgress?.({ phase: "完了", evaluations, best: entries[0]?.score ?? bestScore });

  return {
    entries: entries.slice(0, topN),
    pool,
    evaluations,
    elapsedMs: Date.now() - startedAt,
    truncated,
  };
}

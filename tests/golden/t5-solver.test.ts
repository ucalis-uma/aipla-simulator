/**
 * 【一時・T5ソルバー】実測157ビートの乱数逆算ソルバー（連続乱数版）。
 *
 * 【確定事項】ゲームのスコア乱数は連続値（Unity float想定、[0.95,1.05]）。
 * 整数パーミル仮定では単一Aスキル9イベントで ±0.03% の説明不能なズレが発生したが、
 * 連続乱数では全イベントが r∈[950,1050] の成立帯に収まる（tmp_diag6〜diag10参照）。
 *
 * 方式:
 * - 各ビートの実測 gained をターゲットに、ビート単位で連続乱数 r を逆算する。
 *   k=1 イベント: 連鎖逆算で r を一意に決定（floor 精度の中心を選ぶ）。
 *   k≥2 イベント: 前方イベントのスケール f を二分探索し、残余を最終イベントで吸収。
 * - b1-b3 は LIVE START の表示遅延で gained の帰属が崩れるため 3 行統合で総和一致を解く。
 * - b103 の割合型行はレーン累積依存のため反復収束させる。
 * - 収束後 tests/golden/fixtures/t5_replay_rands.json を生成する。
 */
import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeDeckStatus } from "../../src/formula/baseStatus.js";
import { pctToPermil } from "../../src/rounding.js";
import { computeEventScore } from "../../src/formula/scoreEvent.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import type {
  ChartNote,
  LaneInput,
  LaneNumber,
  SimulateInput,
  SkillDef,
  StageInput,
} from "../../src/timeline/types.js";
import type { ScoreRng } from "../../src/rng/types.js";
import type { CardDef, CardParameterRow, StatBonus, StatValues, YellBonus } from "../../src/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = path.join(repoRoot, "data");
const sampleDir = path.join(repoRoot, "スコア分析サンプル");

interface CardsFile {
  cards: CardDef[];
}
interface CardParametersFile {
  rows: CardParameterRow[];
}
interface StructuredStat {
  stat: string;
  type: "pct" | "fixed";
  value: number;
}
interface PhotoOrAccessory {
  name: string;
  structured: StructuredStat[];
}
interface CharacterV2 {
  lane: number;
  card_id: string;
  level: number;
  rarity: number;
  role: string;
  kouryu_level: number;
  stats: {
    base: { vocal: number; dance: number; visual: number; stamina: number };
    total_after_non_skill_modifiers: { vocal: number; dance: number; visual: number; stamina: number };
  };
  photos: PhotoOrAccessory[];
  accessories: PhotoOrAccessory[];
}
interface VerificationV2 {
  staff_bonus: Record<"vocal" | "dance" | "visual" | "stamina" | "mental" | "critical", number>;
  yale_bonus: {
    vocal_pct: number;
    dance_pct: number;
    visual_pct: number;
    stamina: number;
    mental: number;
    critical: number;
    beat_score_pct: number;
    a_skill_score_pct: number;
    sp_skill_score_pct: number;
    critical_score_pct: number;
  };
  characters: CharacterV2[];
}
interface T5Measured {
  results: { total_score: number; scores_by_lane: Record<string, number> };
  timeline: Array<{
    beat: number;
    gained: number;
    cumulative: number;
    stat: Record<string, number>;
    pops: Record<string, number>;
  }>;
  critFlags: Array<{
    beat: number;
    yellow_lanes: string[] | null;
    white_lanes: string[] | null;
    no_pop_lanes: string[] | null;
  }>;
}

function readJson(p: string): unknown {
  return JSON.parse(readFileSync(p, "utf-8"));
}

const cards = (readJson(path.join(dataDir, "cards.json")) as CardsFile).cards;
const params = (readJson(path.join(dataDir, "card_parameters.json")) as CardParametersFile).rows;
const ver = readJson(path.join(sampleDir, "verification_data_v2.json")) as VerificationV2;
const skillsGolden = readJson(path.join(dataDir, "skills_golden.json")) as { skills: SkillDef[] };
const chart = readJson(path.join(dataDir, "charts", "chart-hsm-004-001.json")) as {
  notes: Array<{ beat: number; type: number; position: number }>;
};
const stageData = readJson(path.join(dataDir, "stages", "qt-daily-003-19.json")) as {
  beatWeightsPermil: { vocal: number; dance: number; visual: number };
  skillWeightsPermil: { active: number; special: number };
};
const t5 = readJson(path.join(repoRoot, "tests/golden/fixtures/t5_measured.json")) as T5Measured;

function toStatBonus(items: PhotoOrAccessory[]): StatBonus[] {
  return items.map((item) => {
    const pct: Record<string, number> = {};
    const fixed: Record<string, number> = {};
    for (const s of item.structured) {
      if (s.type === "pct") pct[s.stat] = (pct[s.stat] ?? 0) + pctToPermil(s.value);
      else fixed[s.stat] = (fixed[s.stat] ?? 0) + s.value;
    }
    return { pct, fixed };
  });
}

function sumScorePct(items: PhotoOrAccessory[], key: string): number {
  let sum = 0;
  for (const item of items) {
    for (const s of item.structured) {
      if (s.stat === key && s.type === "pct") {
        sum += pctToPermil(s.value);
      }
    }
  }
  return sum;
}

function yell(): YellBonus {
  const y = ver.yale_bonus;
  return {
    statPct: {
      vocal: pctToPermil(y.vocal_pct),
      dance: pctToPermil(y.dance_pct),
      visual: pctToPermil(y.visual_pct),
    },
    statFix: { stamina: y.stamina, mental: y.mental, critical: y.critical },
    scorePct: {
      beat: pctToPermil(y.beat_score_pct),
      active: pctToPermil(y.a_skill_score_pct),
      special: pctToPermil(y.sp_skill_score_pct),
      criticalScore: pctToPermil(y.critical_score_pct),
    },
  };
}

const STAFF = ver.staff_bonus;
const YELL = yell();

const LANE_ATTRIBUTE: Record<LaneNumber, "vocal" | "dance" | "visual"> = {
  1: "vocal",
  2: "vocal",
  3: "vocal",
  4: "dance",
  5: "vocal",
};

const CALIBRATED_MENTAL: Record<LaneNumber, number> = { 1: 105, 2: 102, 3: 104, 4: 103, 5: 101 };

function buildLanes(): LaneInput[] {
  const lanes: LaneInput[] = [];
  for (const ch of ver.characters) {
    const lane = ch.lane as LaneNumber;
    const card = cards.find((c) => c.id === ch.card_id);
    if (!card) throw new Error(`card not found: ${ch.card_id}`);
    const row = params.find((r) => r.id === card.cardParameterId && r.level === ch.level);
    if (!row) throw new Error(`card parameter not found: ${card.cardParameterId} @Lv${ch.level}`);
    const result = computeDeckStatus(
      {
        card,
        level: ch.level,
        rarity: ch.rarity,
        kouryuLevel: ch.kouryu_level,
        staff: STAFF,
        yell: YELL,
        equipment: {
          photos: toStatBonus(ch.photos),
          accessories: toStatBonus(ch.accessories),
        },
      },
      row,
    );
    const deck: StatValues<number> = {
      ...result.deck,
      mental: CALIBRATED_MENTAL[lane],
      critical: 0,
    };
    const equipment = [...ch.photos, ...ch.accessories];
    const skills = skillsGolden.skills.filter(
      (s) => s.lane === lane && (s.kind === "A" || s.kind === "SP" || s.kind === "P"),
    );
    const photos = skillsGolden.skills.filter(
      (s) => s.lane === lane && s.kind === "photo" && (s.effects?.length ?? 0) > 0,
    );
    lanes.push({
      lane,
      attribute: LANE_ATTRIBUTE[lane],
      role: ch.role as LaneInput["role"],
      deck,
      skills,
      photos,
      scoreBonusPct: {
        beat: YELL.scorePct.beat + sumScorePct(equipment, "beat_score"),
        active: YELL.scorePct.active + sumScorePct(equipment, "a_score"),
        special: YELL.scorePct.special + sumScorePct(equipment, "sp_score"),
        passive: sumScorePct(equipment, "p_score"),
      },
      critExtrasPermil: YELL.scorePct.criticalScore + sumScorePct(equipment, "critical_score"),
    });
  }
  lanes.sort((a, b) => a.lane - b.lane);
  return lanes;
}

class ArrayRng implements ScoreRng {
  private i = 0;
  constructor(private readonly rolls: number[]) {}
  nextScoreRoll(): number {
    const r = this.rolls[this.i];
    if (r === undefined) {
      throw new Error(`ArrayRng: rolls exhausted at ${this.i}`);
    }
    this.i++;
    return r;
  }
  nextCritical(): boolean {
    return false;
  }
  get consumed(): number {
    return this.i;
  }
}

function buildInput(lanes: LaneInput[], rng: ScoreRng): SimulateInput {
  const notes: ChartNote[] = chart.notes.map((n) => ({
    beat: n.beat,
    noteType: n.type as 1 | 2 | 3,
    position: n.position as ChartNote["position"],
  }));
  const stage: StageInput = {
    id: "qt-daily-003-19",
    laneAttributes: [2, 2, 1, 2, 2],
    beatWeightsPermil: stageData.beatWeightsPermil,
    skillWeightsPermil: {
      active: stageData.skillWeightsPermil.active,
      special: stageData.skillWeightsPermil.special,
    },
    stageFactorPermil: 1000,
  };
  return {
    lanes,
    notes,
    stage,
    fanFactorPermil: 1620,
    successBasePermil: 1000,
    criticalProvider: (beat, lane) =>
      t5.critFlags.find((f) => f.beat === beat)?.yellow_lanes?.includes(String(lane)) ?? false,
    rng,
    roundingPolicy: "at-end",
    missedNotes: [
      { beat: 1, lane: 1 },
      { beat: 1, lane: 2 },
      { beat: 1, lane: 3 },
      { beat: 1, lane: 4 },
      { beat: 1, lane: 5 },
    ],
  };
}

/** トレースの1スコアイベント（乱数消費順） */
interface SolveEvent {
  beat: number;
  lane: number;
  factors: {
    basicScore: number;
    skillPowerPermil: number;
    b1Permil: number;
    comboFactorPermil: number;
    fanFactorPermil: number;
    critFactorPermil: number;
  };
  /** 割合型スコア行か（basicScore が累積依存） */
  isRatio?: boolean;
  /** 割合型の基準累積スコア（トレース時点・自身の加算前） */
  ratioBaseCum?: number;
  /** トレース時点の確定スコア（基準累積の差分計算に使用） */
  traceScore?: number;
}

function makeEvent(
  beat: number,
  lane: number,
  e: {
    skillPowerPermil: number;
    basicScore: number;
    b1Permil: number;
    comboFactorPermil: number;
    fanFactorPermil: number;
    critFactorPermil: number;
    isRatioScore: boolean;
    ratioBaseCumScore?: number;
    gainedScore: number;
  },
): SolveEvent {
  return {
    beat,
    lane,
    factors: {
      basicScore: e.basicScore,
      skillPowerPermil: e.skillPowerPermil,
      b1Permil: e.b1Permil,
      comboFactorPermil: e.comboFactorPermil,
      fanFactorPermil: e.fanFactorPermil,
      critFactorPermil: e.critFactorPermil,
    },
    isRatio: e.isRatioScore || undefined,
    ratioBaseCum: e.ratioBaseCumScore,
    traceScore: e.gainedScore,
  };
}

const RMIN = 950;
const RMAX = 1050;

function eventScore(e: SolveEvent, rand: number): number {
  return computeEventScore({
    ...e.factors,
    stageFactorPermil: 1000,
    randPermil: rand,
    roundingPolicy: "at-end",
  });
}

/**
 * 単一イベントで score(target) となる連続乱数 r を返す（at-end 逆算）。
 *
 * at-end: score = floor(base × r / 10^21)、base = basic × Π(非乱数6ファクター)。
 * r の成立区間は [T×10^21/base, (T+1)×10^21/base) で一意に求まり、区間幅は
 * 10^21/base（≈10^-7〜10^-2 permil）。float64 の中央値精度（≈10^-13）で十分。
 */
function invertSingle(e: SolveEvent, target: number): number | null {
  if (target < 0) {
    return null;
  }
  const f = e.factors;
  const intFactors = [
    f.skillPowerPermil,
    f.b1Permil,
    f.comboFactorPermil,
    f.fanFactorPermil,
    1000,
    f.critFactorPermil,
  ];
  let base = BigInt(e.factors.basicScore);
  for (const v of intFactors) {
    if (!Number.isInteger(v) || v < 0) {
      return null;
    }
    base *= BigInt(v);
  }
  if (base <= 0n) {
    return target === 0 ? 1000 : null;
  }
  const loNum = BigInt(target) * 10n ** 21n;
  const hiNum = (BigInt(target) + 1n) * 10n ** 21n;
  const rLo = Number(loNum) / Number(base);
  const rHi = Number(hiNum) / Number(base);
  if (!(rHi > rLo)) {
    return null;
  }
  let r = (rLo + rHi) / 2;
  if (r < RMIN || r > RMAX) {
    return null;
  }
  if (eventScore(e, r) !== target) {
    // 境界の数値誤差に対する極小ナッジ（通常不要）
    let fixed = false;
    for (const d of [1e-9, -1e-9, 1e-8, -1e-8, 1e-7, -1e-7, 1e-6, -1e-6]) {
      const r2 = r + d;
      if (r2 >= RMIN && r2 <= RMAX && eventScore(e, r2) === target) {
        r = r2;
        fixed = true;
        break;
      }
    }
    if (!fixed) {
      return null;
    }
  }
  return r;
}

/**
 * 比率行（score_get_by_score_ratio）を含むグループの結合厳密解。
 *
 * 比率行の basicScore は基準累積スコア（先行イベントの確定スコア和に依存）で決まるため、
 * 先行イベントの乱数を一様 f、比率行の乱数を残余吸収として連立を解く:
 *   base'(f) = ratioBaseCum − Σ(トレース時点の先行確定スコア) + Σ(f での先行スコア)
 *   basic₂'(f) = floor(base'(f) × p_raw / 1000)
 *   必要R(f) = target − Σ(先行スコア)   （f について単調減少）
 *   達成R(f) = basic₂'(f) × b1 × crit / 10^6 × r₂/1000（f について単調増加）
 * の交点 f* を二分探索し、r₂ を invertSingle で確定する。
 * トレースと同一の手順で basic₂' を再計算するため sim と厳密に一致する（振動しない）。
 */
function solveEventGroupWithRatio(events: SolveEvent[], target: number): number[] | null {
  const ri = events.map((e) => e.isRatio === true).lastIndexOf(true);
  if (ri < 0) {
    return null;
  }
  const ratio = events[ri]!;
  if (ratio.ratioBaseCum === undefined || ratio.traceScore === undefined) {
    return null;
  }
  if (ri !== events.length - 1) {
    return null; // 比率行は最終イベント前提（b103 で成立）
  }
  const before = events.slice(0, ri);
  if (before.length === 0) {
    return null;
  }
  // 生 SkillPower（trace の basicScore = floor(base × p_raw / 1000) から復元）
  let pRaw = Math.round((ratio.factors.basicScore * 1000) / ratio.ratioBaseCum);
  if (
    pRaw < 1 ||
    Math.floor((ratio.ratioBaseCum * pRaw) / 1000) !== ratio.factors.basicScore
  ) {
    return null;
  }
  const traceBefore = before.reduce((s, e) => s + (e.traceScore ?? 0), 0);
  // 【構成的不動点】先行イベントの乱数を 1000 に固定すると
  // base'(f) が反復に依存しない定数になり、解は 1 反復で不動点に到達する。
  // （uniform f 版は base' が f の履歴に依存し利得 −1.687 の発散振動を生んだ）
  const attempt = (f: number | null): number[] | null => {
    const sumNew = before.reduce(
      (s, e) => s + eventScore(e, f === null ? 1000 : 1000 * f),
      0,
    );
    const basePrime = ratio.ratioBaseCum! - traceBefore + sumNew;
    const ratioBasic = Math.floor((basePrime * pRaw) / 1000);
    const ratioEvent: SolveEvent = {
      ...ratio,
      factors: { ...ratio.factors, basicScore: ratioBasic },
    };
    const residual = target - sumNew;
    const r2 = invertSingle(ratioEvent, residual);
    if (r2 === null) {
      return null;
    }
    const rands = before.map(() => (f === null ? 1000 : 1000 * f));
    rands.push(r2);
    let total = sumNew + eventScore(ratioEvent, r2);
    if (total !== target) {
      return null;
    }
    return rands;
  };
  // 先行乱数=1000 固定（構成的不動点）。不成立なら従来の一様 f にフォールバック。
  const direct = attempt(null);
  if (direct !== null) {
    return direct;
  }
  // フォールバック: 一様 f 二分探索（g(f) = neededR(f) − achievedAt1000(f) の交点）
  const sumNewAt = (f: number): number =>
    before.reduce((s, e) => s + eventScore(e, 1000 * f), 0);
  const ratioBasicAt = (f: number): number =>
    Math.floor(
      ((ratio.ratioBaseCum! - traceBefore + sumNewAt(f)) * pRaw) / 1000,
    );
  const ratioEventAt = (f: number): SolveEvent => ({
    ...ratio,
    factors: { ...ratio.factors, basicScore: ratioBasicAt(f) },
  });
  const g = (f: number): number =>
    target - sumNewAt(f) - eventScore(ratioEventAt(f), 1000);
  let lo = RMIN / 1000;
  let hi = RMAX / 1000;
  if (g(lo) < 0 || g(hi) > 0) {
    return null;
  }
  for (let i2 = 0; i2 < 90; i2++) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const f = (lo + hi) / 2;
  return attempt(f);
}

/**
 * イベント列（同一ビート or 統合リージョン）の合計が target と一致する
 * 連続乱数列を返す。前方イベントは一様スケール f（二分探索）、残余を最終イベントが吸収する。
 * 残余の狙いは最終イベントの達成帯の中央（r が端に寄らないように）。
 */
function solveEventGroup(events: SolveEvent[], target: number): number[] | null {
  const k = events.length;
  if (k === 0) {
    return target === 0 ? [] : null;
  }
  if (events.some((e) => e.isRatio)) {
    const coupled = solveEventGroupWithRatio(events, target);
    if (coupled !== null) {
      return coupled;
    }
  }
  if (k === 1) {
    const r = invertSingle(events[0]!, target);
    return r === null ? null : [r];
  }
  const last = events[k - 1]!;
  const lastMin = eventScore(last, RMIN);
  const lastMax = eventScore(last, RMAX);
  if (lastMax < lastMin) {
    return null;
  }
  const earlier = events.slice(0, k - 1);
  const sumEarlier = (f: number): number =>
    earlier.reduce((s, e) => s + eventScore(e, 1000 * f), 0);
  const sumMin = sumEarlier(RMIN / 1000);
  const sumMax = sumEarlier(RMAX / 1000);
  if (sumMax < target - lastMax || sumMin > target - lastMin) {
    return null;
  }
  // 残余の狙い: 達成帯の中央 → 端 → 最小（フォールバック順）
  const aims = [
    Math.floor((lastMin + lastMax) / 2),
    lastMax - 1,
    lastMin,
  ];
  for (const aim of aims) {
    const want = target - aim;
    if (sumMin > want || sumMax < want) {
      continue;
    }
    // sumEarlier(f) ≤ want となる最大 f を二分探索
    let fLo = RMIN / 1000;
    let fHi = RMAX / 1000;
    if (sumEarlier(fHi) <= want) {
      fLo = fHi;
    } else {
      for (let i = 0; i < 80; i++) {
        const mid = (fLo + fHi) / 2;
        if (sumEarlier(mid) <= want) {
          fLo = mid;
        } else {
          fHi = mid;
        }
      }
    }
    const rands: number[] = earlier.map(() => 1000 * fLo);
    let partial = 0;
    for (let i = 0; i < k - 1; i++) {
      partial += eventScore(events[i]!, 1000 * fLo);
    }
    const residual = target - partial;
    const rLast = invertSingle(last, residual);
    if (rLast === null) {
      continue;
    }
    rands[k - 1] = rLast;
    const total = events.reduce((s, e, i) => s + eventScore(e, rands[i]!), 0);
    if (total !== target) {
      continue;
    }
    return rands;
  }
  return null;
}

describe("T5 solver", () => {
  it("連続乱数列を逆算して t5_replay_rands.json を生成する", () => {
    const beats = [...new Set(t5.timeline.map((r) => r.beat))].sort((a, b) => a - b);
    const gainedBy = new Map<number, number>();
    for (const row of t5.timeline) {
      gainedBy.set(row.beat, row.gained);
    }
    let rands = new Array<number>(3000).fill(1000);
    let report = "";
    let mergedBeats = new Set<number>();
    let converged = false;
    let finalTotal = 0;
    let okBeats = 0;
    const MAX_ITER = 30;

    for (let iter = 0; iter < MAX_ITER; iter++) {
      const lanes = buildLanes();
      const rng = new ArrayRng(rands);
      const res = simulateTimeline(buildInput(lanes, rng));
      const nUsed = rng.consumed;
      const events: SolveEvent[] = [];
      for (const bt of res.beats) {
        for (const e of bt.events) {
          events.push(
            makeEvent(bt.beat, e.lane, {
              skillPowerPermil: e.skillPowerPermil,
              basicScore: e.basicScore,
              b1Permil: e.b1Permil,
              comboFactorPermil: e.comboFactorPermil,
              fanFactorPermil: e.fanFactorPermil,
              critFactorPermil: e.critFactorPermil,
              isRatioScore: e.isRatioScore,
              ratioBaseCumScore: e.ratioBaseCumScore,
              gainedScore: e.gainedScore,
            }),
          );
        }
      }
      if (events.length !== nUsed) {
        throw new Error(`event count mismatch: trace=${events.length} consumed=${nUsed}`);
      }
      const eventsBy = new Map<number, SolveEvent[]>();
      for (const e of events) {
        const arr = eventsBy.get(e.beat);
        if (arr) {
          arr.push(e);
        } else {
          eventsBy.set(e.beat, [e]);
        }
      }
      // ビート毎に厳密解を試行し、失敗したら前方統合（最大4行）
      const beatsSorted = [...eventsBy.keys()].sort((a, b) => a - b);
      const newRands = [...rands];
      let randIdx = 0;
      let allOk = true;
      mergedBeats = new Set<number>();
      okBeats = 0;
      const solvedGroups: Array<{ rows: number[]; ok: boolean }> = [];
      const ratioRanges: Array<{ lo: number; hi: number }> = [];
      let i = 0;
      while (i < beatsSorted.length) {
        const b0 = beatsSorted[i]!;
        const mergedRows: number[] = [b0];
        const mergedEvents: SolveEvent[] = [...(eventsBy.get(b0) ?? [])];
        let target = gainedBy.get(b0) ?? 0;
        let j = i + 1;
        let sol = solveEventGroup(mergedEvents, target);
        while (sol === null && j < beatsSorted.length && mergedRows.length < 4) {
          const nb = beatsSorted[j]!;
          mergedRows.push(nb);
          mergedEvents.push(...(eventsBy.get(nb) ?? []));
          target += gainedBy.get(nb) ?? 0;
          sol = solveEventGroup(mergedEvents, target);
          j++;
        }
        const rangeLo = randIdx;
        if (sol === null) {
          allOk = false;
          solvedGroups.push({ rows: mergedRows, ok: false });
          const sumE = mergedEvents.reduce(
            (s, e) => s + eventScore(e, 1000),
            0,
          );
          report += `[UNSOLVED] rows=${mergedRows.join(",")} target=${target} ΣE=${sumE} s=${(target / sumE).toFixed(4)} k=${mergedEvents.length}\n`;
          for (const e of mergedEvents) {
            newRands[randIdx++] = 1000;
          }
        } else {
          solvedGroups.push({ rows: mergedRows, ok: true });
          if (mergedRows.length > 1) {
            for (const b of mergedRows) {
              mergedBeats.add(b);
            }
          } else {
            okBeats++;
          }
          if (mergedEvents.some((e) => e.isRatio)) {
            ratioRanges.push({ lo: rangeLo, hi: randIdx + sol.length });
          }
          for (const r of sol) {
            newRands[randIdx++] = r;
          }
        }
        i = j;
      }
      let maxDelta = 0;
      let maxIdx = -1;
      for (let t = 0; t < nUsed; t++) {
        const d = Math.abs(newRands[t]! - rands[t]!);
        if (d > maxDelta) {
          maxDelta = d;
          maxIdx = t;
        }
      }
      finalTotal = res.totalScore;
      const changed = maxDelta > 1e-9;
      rands = newRands;
      report += `[ITER ${iter}] events=${nUsed} allOk=${allOk} maxDelta=${maxDelta.toExponential(2)} okBeats=${okBeats}/${beatsSorted.length} simTotal=${res.totalScore} measuredTotal=${t5.results.total_score}\n`;
      if (allOk && !changed) {
        converged = true;
        break;
      }
    }

    // 累積スコア検証（統合ビートを除く）
    const lanes = buildLanes();
    const rng = new ArrayRng(rands);
    const res = simulateTimeline(buildInput(lanes, rng));
    const cumErrors: Array<{ beat: number; sim: number; meas: number }> = [];
    let simCum = 0;
    for (const bt of res.beats) {
      for (const e of bt.events) {
        simCum += e.gainedScore;
      }
      const measRow = t5.timeline.find((r) => r.beat === bt.beat);
      const measCum = measRow?.cumulative ?? 0;
      if (!mergedBeats.has(bt.beat) && simCum !== measCum) {
        cumErrors.push({ beat: bt.beat, sim: simCum, meas: measCum });
      }
    }
    report += `[CUMCHECK] errors=${cumErrors.length} mergedBeats=${[...mergedBeats].join(",")}\n`;
    for (const ce of cumErrors.slice(0, 10)) {
      report += `  b${ce.beat}: sim=${ce.sim} meas=${ce.meas} diff=${ce.sim - ce.meas}\n`;
    }
    report += `[SOLVER] converged=${converged} okBeats=${okBeats} simTotal=${res.totalScore} measuredTotal=${t5.results.total_score} diff=${res.totalScore - t5.results.total_score}\n`;
    console.log(report);
    writeFileSync(
      path.join(repoRoot, "tests/golden/fixtures/t5_replay_rands.json"),
      JSON.stringify({ rands: rands.slice(0, 3000), mergedBeats: [...mergedBeats] }, null, 1),
    );
    if (!converged) {
      throw new Error("T5 solver did not converge");
    }
    if (res.totalScore !== t5.results.total_score) {
      throw new Error(`total mismatch: sim=${res.totalScore} measured=${t5.results.total_score}`);
    }
    if (cumErrors.length > 0) {
      throw new Error(`cumulative mismatches at ${cumErrors.length} beats`);
    }
  });
});

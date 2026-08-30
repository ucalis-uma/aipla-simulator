/**
 * 編成・ステージ・譜面 → SimulateInput 構築（Phase 4: CLI / UI / テスト共通）。
 *
 * 入力スキーマは「スコア分析サンプル/verification_data_v2.json」と同一
 * （staff_bonus / yale_bonus / characters[5]。photos・accessories は
 * { name, structured: [{ stat, type: "pct"|"fixed", value }] } の実測形式）。
 *
 * データ源（data/ 以下の JSON）は SimSourceData として注入する
 * （CLI はファイル読込、単一HTML UI はビルド時に埋め込み）。
 *
 * レーン属性はステージの laneAttributes（position 1-5 の属性コード）と
 * POSITION_TO_LANE（position→レーン写像・実測 21/21 一致）から導出する
 * （旧 CLI のハードコード {1:vocal,...} を一般化）。
 */
import { computeDeckStatus } from "../formula/baseStatus.js";
import { fanBonusPermil, type AudienceAdvantageRow } from "../formula/fan.js";
import { pctToPermil } from "../rounding.js";
import { ATTRIBUTE_CODE_TO_NAME, POSITION_TO_LANE } from "../timeline/constants.js";
import type {
  BeatTrace,
  ChartNote,
  LaneInput,
  LaneNumber,
  SimulateInput,
  SkillDef,
  StageInput,
} from "../timeline/types.js";
import type {
  CardDef,
  CardParameterRow,
  StatBonus,
  StatValues,
  YellBonus,
} from "../types.js";

// ---------------------------------------------------------------------------
// 入力スキーマ（verification_data_v2.json と同一）
// ---------------------------------------------------------------------------

export interface StructuredStat {
  stat: string;
  type: "pct" | "fixed";
  value: number;
}

export interface PhotoOrAccessory {
  name: string;
  structured: StructuredStat[];
}

export interface DeckCharacter {
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

export interface DeckJsonV2 {
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
  characters: DeckCharacter[];
}

// ---------------------------------------------------------------------------
// データ源
// ---------------------------------------------------------------------------

export interface StageWeights {
  beatWeightsPermil: { vocal: number; dance: number; visual: number };
  skillWeightsPermil: { active: number; special: number };
  /** position 1-5 の属性コード（1=dance, 2=vocal, 3=visual）。省略可（BuildSimOptions で上書き可） */
  laneAttributes?: readonly number[];
}

export interface ChartFile {
  notes: Array<{ beat: number; type: number; position: number }>;
}

export interface SimSourceData {
  cards: CardDef[];
  cardParameters: CardParameterRow[];
  skillsGolden: SkillDef[];
  /** キー: ステージファイルID（例 "qt-daily-003-19"） */
  stages: Record<string, StageWeights>;
  /** キー: チャートファイルID（例 "chart-hsm-004-001"） */
  charts: Record<string, ChartFile>;
  /** 来場ファンボーナステーブル（audience 昇順）。audience 指定時に使用 */
  audienceAdvantage?: AudienceAdvantageRow[];
}

// ---------------------------------------------------------------------------
// ビルドオプション / 結果
// ---------------------------------------------------------------------------

export interface BuildSimOptions {
  deck: DeckJsonV2;
  stageFile: string;
  chartFile: string;
  data: SimSourceData;
  /** position 1-5 の属性コード。省略時は stages[stageFile].laneAttributes */
  laneAttributes?: readonly number[];
  /** 個人来場ファン数。data.audienceAdvantage があればテーブル引きで fanFactorPermil を導出 */
  audience?: number;
  /** ファンファクター permil（audience 未指定時に使用。既定 1620=実測値） */
  fanFactorPermil?: number;
  /** 成功率の基礎値 permil（既定 1000=メンタル盛りで全成立） */
  successBasePermil?: number;
  /** ミスノート（例: T5実測は b1 全レーン取りこぼし） */
  missedNotes?: ReadonlyArray<{ beat: number; lane: number }>;
  /** メンタル値の上書き（P発動順=メンタル降順に影響。キーはレーン番号の文字列） */
  mentalOverride?: Record<string, number>;
  /** 無効化するスキル/フォト ID（UI のチェックボックス用） */
  disabledSkillIds?: readonly string[];
}

/** rng / criticalProvider を除いた SimulateInput（呼び出し側で乱数源を設定して使用） */
export type SimulateInputBase = Omit<SimulateInput, "rng" | "criticalProvider">;

export interface BuildSimResult {
  base: SimulateInputBase;
  lanes: LaneInput[];
  /** 構築時の警告（golden スキルと選択カードの不一致等。ブロックはしない） */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// 変換ヘルパー
// ---------------------------------------------------------------------------

function toStatBonus(items: PhotoOrAccessory[]): StatBonus[] {
  return items.map((item) => {
    const pct: Record<string, number> = {};
    const fixed: Record<string, number> = {};
    for (const s of item.structured) {
      if (s.type === "pct") {
        pct[s.stat] = (pct[s.stat] ?? 0) + pctToPermil(s.value);
      } else {
        fixed[s.stat] = (fixed[s.stat] ?? 0) + s.value;
      }
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

function toYell(y: DeckJsonV2["yale_bonus"]): YellBonus {
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

/**
 * レーン → 属性の導出: レーン L の属性 = laneAttributes[p-1]（p = POSITION_TO_LANE で
 * L に写る position。例: laneAttributes=[2,2,1,2,2] → L4 の position=3 → コード1=dance）。
 */
export function laneAttributeOf(
  lane: LaneNumber,
  laneAttributes: readonly number[],
): "vocal" | "dance" | "visual" {
  const pos = POSITION_TO_LANE.indexOf(lane);
  if (pos < 0) {
    throw new Error(`laneAttributeOf: unknown lane ${lane}`);
  }
  const code = laneAttributes[pos];
  const name = code === undefined ? undefined : ATTRIBUTE_CODE_TO_NAME.get(code);
  if (name === undefined) {
    throw new Error(`laneAttributeOf: unknown attribute code ${code} at position ${pos + 1}`);
  }
  return name;
}

/** カードに存在するレベル行の列（UI のレベル選択用。昇順） */
export function availableLevels(data: SimSourceData, cardId: string): number[] {
  const card = data.cards.find((c) => c.id === cardId);
  if (card === undefined) {
    return [];
  }
  return data.cardParameters
    .filter((r) => r.id === card.cardParameterId)
    .map((r) => r.level)
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

export function buildSimulateInput(options: BuildSimOptions): BuildSimResult {
  const { deck, data } = options;
  const stageWeights = data.stages[options.stageFile];
  if (stageWeights === undefined) {
    throw new Error(`stage not found in data: ${options.stageFile}`);
  }
  const chartFile = data.charts[options.chartFile];
  if (chartFile === undefined) {
    throw new Error(`chart not found in data: ${options.chartFile}`);
  }
  const laneAttributes = options.laneAttributes ?? stageWeights.laneAttributes;
  if (laneAttributes === undefined || laneAttributes.length !== 5) {
    throw new Error(`stage ${options.stageFile}: laneAttributes must have 5 entries`);
  }

  const warnings: string[] = [];
  const Y = toYell(deck.yale_bonus);
  const disabled = new Set(options.disabledSkillIds ?? []);
  const lanes: LaneInput[] = [];

  for (const ch of deck.characters) {
    const lane = ch.lane as LaneNumber;
    const card = data.cards.find((c) => c.id === ch.card_id);
    if (card === undefined) {
      throw new Error(`card not found: ${ch.card_id} (lane ${lane})`);
    }
    const row = data.cardParameters.find(
      (r) => r.id === card.cardParameterId && r.level === ch.level,
    );
    if (row === undefined) {
      throw new Error(`card parameter not found: ${card.cardParameterId} @Lv${ch.level}`);
    }
    const result = computeDeckStatus(
      {
        card,
        level: ch.level,
        rarity: ch.rarity,
        kouryuLevel: ch.kouryu_level,
        staff: deck.staff_bonus,
        yell: Y,
        equipment: {
          photos: toStatBonus(ch.photos),
          accessories: toStatBonus(ch.accessories),
        },
      },
      row,
    );
    const mental = Number(options.mentalOverride?.[String(lane)] ?? 100);
    const deckStatus: StatValues<number> = { ...result.deck, mental, critical: 0 };
    const equipment = [...ch.photos, ...ch.accessories];
    const laneSkills = data.skillsGolden.filter(
      (s) =>
        s.lane === lane &&
        (s.kind === "A" || s.kind === "SP" || s.kind === "P") &&
        !disabled.has(s.id),
    );
    const lanePhotos = data.skillsGolden.filter(
      (s) =>
        s.lane === lane &&
        s.kind === "photo" &&
        (s.effects?.length ?? 0) > 0 &&
        !disabled.has(s.id),
    );
    // golden スキルの元カードと選択カードの不一致は警告（スキル効果の較正が
    // 実測カード由来のため。ブロックはしない）
    // ※ skills_golden.json の cardId は "sk-" 接頭辞形式（sk-yu-05-birt-02 ↔ card-yu-05-birt-02）
    for (const s of [...laneSkills, ...lanePhotos]) {
      if (s.cardId != null && s.cardId !== "") {
        const ownerCardId = s.cardId.startsWith("sk-") ? `card-${s.cardId.slice(3)}` : s.cardId;
        if (ownerCardId !== card.id) {
          warnings.push(
            `L${lane}: skill "${s.id}" (${s.name}) belongs to card ${ownerCardId}, not selected card ${card.id}`,
          );
        }
      }
    }
    lanes.push({
      lane,
      attribute: laneAttributeOf(lane, laneAttributes),
      role: ch.role as LaneInput["role"],
      deck: deckStatus,
      skills: laneSkills,
      photos: lanePhotos,
      scoreBonusPct: {
        beat: Y.scorePct.beat + sumScorePct(equipment, "beat_score"),
        active: Y.scorePct.active + sumScorePct(equipment, "a_score"),
        special: Y.scorePct.special + sumScorePct(equipment, "sp_score"),
        passive: sumScorePct(equipment, "p_score"),
      },
      critExtrasPermil: Y.scorePct.criticalScore + sumScorePct(equipment, "critical_score"),
    });
  }
  lanes.sort((a, b) => a.lane - b.lane);

  const notes: ChartNote[] = chartFile.notes.map((n) => ({
    beat: n.beat,
    noteType: n.type as ChartNote["noteType"],
    position: n.position as ChartNote["position"],
  }));
  const stage: StageInput = {
    id: options.stageFile,
    laneAttributes: [...laneAttributes],
    beatWeightsPermil: stageWeights.beatWeightsPermil,
    skillWeightsPermil: {
      active: stageWeights.skillWeightsPermil.active,
      special: stageWeights.skillWeightsPermil.special,
    },
    stageFactorPermil: 1000,
  };
  let fanFactorPermil = options.fanFactorPermil ?? 1620;
  if (options.audience !== undefined) {
    if (data.audienceAdvantage === undefined) {
      throw new Error("audience specified but audienceAdvantage table is missing");
    }
    fanFactorPermil = fanBonusPermil(options.audience, data.audienceAdvantage);
  }

  const base: SimulateInputBase = {
    lanes,
    notes,
    stage,
    fanFactorPermil,
    successBasePermil: options.successBasePermil ?? 1000,
    roundingPolicy: "at-end",
    missedNotes: options.missedNotes?.map((m) => ({
      beat: m.beat,
      lane: m.lane as LaneNumber,
    })),
  };
  return { base, lanes, warnings };
}

// ---------------------------------------------------------------------------
// 集計ヘルパー（レーン別内訳）
// ---------------------------------------------------------------------------

export type ScoreKind = "beat" | "A" | "SP" | "P" | "photo";

export interface LaneBreakdownEntry {
  lane: LaneNumber;
  total: number;
  byKind: Record<ScoreKind, number>;
  /** スコアイベント数 */
  events: number;
  /** 発動数（成功のみ） */
  activations: number;
}

/** ビート列からレーン別・種別の獲得スコア内訳を集計する */
export function laneBreakdown(beats: readonly BeatTrace[]): LaneBreakdownEntry[] {
  const map = new Map<LaneNumber, LaneBreakdownEntry>();
  const entry = (lane: LaneNumber): LaneBreakdownEntry => {
    let e = map.get(lane);
    if (e === undefined) {
      e = {
        lane,
        total: 0,
        byKind: { beat: 0, A: 0, SP: 0, P: 0, photo: 0 },
        events: 0,
        activations: 0,
      };
      map.set(lane, e);
    }
    return e;
  };
  for (const bt of beats) {
    for (const ev of bt.events) {
      const e = entry(ev.lane);
      e.total += ev.gainedScore;
      e.byKind[ev.sourceKind] += ev.gainedScore;
      e.events += 1;
    }
    for (const act of bt.activations) {
      if (act.success) {
        entry(act.lane).activations += 1;
      }
    }
  }
  return [...map.values()].sort((a, b) => a.lane - b.lane);
}

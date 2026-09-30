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
import { fanBonusPermil, laneFanFactorsPermil, type AudienceAdvantageRow } from "../formula/fan.js";
import { parseGrantKey, grantValuePermil } from "../photos.js";
import { decodeSkillLevel, buildSkillLevelIndex } from "../skillLevels.js";
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
import type { SkillLevelData } from "../skillLevels.js";

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
  /**
   * 【Phase 8-B3】スキルレベル上書き（skillId → Lv1-6）。
   * 未指定のスキルは従来どおり golden / マスタ最大レベルの定義を使う。
   * golden 較正済みスキルを最大レベル以外へ変更した場合はマスタ解析値に置き換わり
   * （実測較正は最大レベルのみ）警告に出力する。
   */
  skill_levels?: Record<string, number>;
  /**
   * 【サンプル3・2026-09-04】フォト付与の静的 CT 短縮（スキル枠番号 → 短縮量）。
   * skill はカードのスキル枠（1/2/3 = skillId 末尾。L4 の A = 2）。
   * 装備フォトの CT カット効果（発動せず常時適用・「規定値短縮」）を再現する。
   * S3 L4: 早坂芽衣 6/6 の CTカット2nd → A（-2）の CT-5（ユーザー提供・CT30→25。
   * b14→b42 の gap 28 発動と整合）。マスタ側の schema が未確定のため【Estimate】。
   */
  ct_cuts?: ReadonlyArray<{ skill: number; value: number }>;
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
  /**
   * 【サンプル3・2026-09-03】スタミナ消費倍率 permil（Quest.skillStaminaWeightPermil。
   * 標準 1000。省略時は 1000 扱い）
   */
  skillStaminaWeightPermil?: number;
  /**
   * 【サンプル3・2026-09-03】スタミナ回復倍率 permil（Quest.staminaRecoveryWeightPermil。
   * 0 は「特徴なし」= 1000 扱い。省略時は 1000 扱い）
   */
  staminaRecoveryWeightPermil?: number;
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
  /**
   * 【Phase 6】カードID → A/SP/P スキル（マスタ Skill.json 自動解析・data/skills_master.json）。
   * 効果値は実測較正されていない（skills_golden は実測 5 カード分のみ）ため Estimate。
   * 選択カードに golden スキル（元カード一致）があればそちらを優先する。
   */
  skillsByCard?: Record<string, readonly MasterSkillDef[]>;
  /**
   * 【Phase 9】ステージのライブボーナスPスキル（data/live_bonuses.json・questId → 定義列）。
   * research/16 §1: 全アイドルPスキルより最優先（前半）・後半Pスキル群の先頭（後半）で発動。
   * キーはステージ（Quest）ID。buildSimulateInput が stageFile に対応する定義を
   * SimulateInput.liveBonusSkills へ注入する（disabledSkillIds で個別無効化可）。
   */
  liveBonusesByQuest?: Record<string, readonly MasterSkillDef[]>;
  /** 【Phase 9】characterId → 名前（UI 表示用。CLI/テストでは省略可） */
  characterNames?: Record<string, string>;
  /**
   * 【サンプル3・2026-09-04】クエストID → キャラ優位定義
   * （data/character_advantage.json・QuestCharacterAdvantage 由来。
   * STAGE045 は ⅢX メンバー [fran/kana/miho] に advantagePermil 2250。
   * ユーザー確定「全スコア」に乗る）
   */
  characterAdvantageByQuest?: Record<
    string,
    { characterIds: readonly string[]; advantagePermil: number }
  >;
  /**
   * 【Phase 8-B3】レベル別スキル定義（data/skills_levels.json・全カードスキル Lv1-6）。
   * 指定時は characters[].skill_levels のレベル指定スキルをこのデータから復元する。
   */
  skillLevels?: SkillLevelData;
}

/**
 * フォト付与の静的 CT 短縮をレーン別スキル定義へ適用する
 *（【サンプル3・2026-09-04】S3 L4: A の CT30→25。純粋関数・単体テスト対象）。
 *
 * @param skills 当該レーンの解決済みスキル（A/SP/P）
 * @param cuts DeckCharacter.ct_cuts（スキル枠番号 1-based → 短縮量）
 * @param warn 不一致枠の警告を受け取るコールバック
 */
export function applySkillCtCuts(
  skills: SkillDef[],
  cuts: ReadonlyArray<{ skill: number; value: number }> | undefined,
  warn: (message: string) => void,
): SkillDef[] {
  if (cuts === undefined || cuts.length === 0) return skills;
  return skills.map((s) => {
    const slot = Number(s.id.slice(s.id.lastIndexOf("-") + 1));
    const cut = cuts.find((c) => c.skill === slot);
    if (cut === undefined) return s;
    if (s.ct == null) {
      warn(`ct_cuts: skill "${s.id}" has no CT (cut -${cut.value} ignored)`);
      return s;
    }
    return { ...s, ct: Math.max(0, s.ct - cut.value) };
  });
}

/** マスタ自動解析スキル（lane は構築時に選択レーンへ上書きされる） */
export type MasterSkillDef = Omit<SkillDef, "lane"> & {
  lane: null;
  /** 解析できなかった効果行数（Estimate タグの根拠） */
  unsupportedEffects?: number;
  /** 楽曲限定等の未評価条件（Estimate タグの根拠） */
  conditionalNote?: string | null;
};

// ---------------------------------------------------------------------------
// フォト付与（grant_* キー）の解決【Phase 8-B】
// ---------------------------------------------------------------------------

/**
 * 付与structuredキー（grant_<target>_<stat>・常に pct）から対象レーンを解決する。
 * - neighbors: 左右 1 レーンずつ（L1/L5 は 1 レーン。engine.ts の neighbors 解決と同一規則・Confirmed）
 * - center: L3
 * - scorer: role Scorer のレーン（編成 role 由来）
 * 出典: Peing id=1187940162「センタークリティカルスコアや隣接ステータスは通常の
 * クリティカルスコア%やステータスと同種類として取り扱われます」→ 対象レーンの
 * 装備と同一の加算プールに入れる。
 */
function grantTargetLanes(
  target: "neighbors" | "center" | "scorer",
  fromLane: LaneNumber,
  roles: ReadonlyArray<string>,
): LaneNumber[] {
  switch (target) {
    case "neighbors": {
      const out: LaneNumber[] = [];
      if (fromLane - 1 >= 1) out.push((fromLane - 1) as LaneNumber);
      if (fromLane + 1 <= 5) out.push((fromLane + 1) as LaneNumber);
      return out;
    }
    case "center":
      return [3];
    case "scorer": {
      const out: LaneNumber[] = [];
      roles.forEach((role, i) => {
        if (role === "Scorer") out.push((i + 1) as LaneNumber);
      });
      return out;
    }
  }
}

/** レーン毎に受領する付与を集計する（stat 系 permil / スコア系 permil の2種） */
function collectPhotoGrants(
  deck: DeckJsonV2,
): {
  statGrants: Map<LaneNumber, Partial<Record<string, number>>>;
  scoreGrants: Map<LaneNumber, Partial<Record<string, number>>>;
} {
  const roles = deck.characters.map((c) => c.role);
  const statGrants = new Map<LaneNumber, Partial<Record<string, number>>>();
  const scoreGrants = new Map<LaneNumber, Partial<Record<string, number>>>();
  const SCORE_KEYS = new Set(["beat_score", "a_score", "sp_score", "critical_score", "p_score"]);
  for (const ch of deck.characters) {
    const fromLane = ch.lane as LaneNumber;
    for (const item of ch.photos) {
      for (const s of item.structured) {
        const grant = parseGrantKey(s.stat);
        if (grant === null || s.type !== "pct") continue;
        const permil = grantValuePermil(s.value);
        for (const target of grantTargetLanes(grant.target, fromLane, roles)) {
          const map = SCORE_KEYS.has(grant.stat) ? scoreGrants : statGrants;
          const cur = map.get(target) ?? {};
          cur[grant.stat] = (cur[grant.stat] ?? 0) + permil;
          map.set(target, cur);
        }
      }
    }
  }
  return { statGrants, scoreGrants };
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
  /**
   * 【Phase 16-A4・2026-09-30】レーン別来場ファン数（L1..L5・index = lane-1。fan.png 実測）。
   *
   * 指定時は audience / fanFactorPermil より優先し、fan.ts laneFanFactorsPermil
   * （満員ガード付き表引き）でレーン別ファンファクターを確定して
   * SimulateInput.laneFanFactorPermil へ注入する。引力度配分モデル
   * （fanFactorPermilByAttraction）は使わない——実測のレーン別来場数に
   * 集目/ステルスの配分効果が内包されているため（二重補正の防止）。
   * 未指定時は従来の単一 audience / fanFactorPermil 経路を完全互換で維持する。
   */
  laneFans?: readonly number[];
  /**
   * 会場最大キャパシティ（stages_index の cap）。laneFans の満員判定
   * （合計 >= maxCapacity → 全レーン一律 f(cap/5)）に使用。未指定時はレーン別表引き
   */
  maxCapacity?: number;
  /** 成功率の基礎値 permil（既定 1000=メンタル盛りで全成立） */
  successBasePermil?: number;
  /** ミスノート（例: T5実測は b1 全レーン取りこぼし） */
  missedNotes?: ReadonlyArray<{ beat: number; lane: number }>;
  /** メンタル値の上書き（P発動順=メンタル降順に影響。キーはレーン番号の文字列） */
  mentalOverride?: Record<string, number>;
  /** 無効化するスキル/フォト ID（UI のチェックボックス用） */
  disabledSkillIds?: readonly string[];
  /**
   * 【Peing確定 2026-08-30】基礎クリティカル発生率（0-1。既定 0.50）。
   * 指定時は動的クリティカル判定（min(0.50, base) + crit_rate_up×5%）を有効化する。
   */
  baseCritRate?: number;
  /**
   * 【Phase 8-B】マイフォト帳のユーザー定義フォトスキル（kind:"photo"・lane 設定済み）。
   * data.skillsGolden の photo スキルにマージして LaneInput.photos へ入る
   * （disabledSkillIds で個別無効化可）。
   */
  userPhotoSkills?: ReadonlyArray<SkillDef>;
  /**
   * 【Phase 8-B10 追補3】T5 実測サンプル（verification_data_v2.json）のレーン別フォト名。
   * golden フォトスキル（photo-L*）は「装着位置のフォトが T5 実測フォトと同一名」の場合のみ
   * 注入する（装着位置モデルの限定・汎用編成への T5 由来スキル混入の防止）。
   * レーン内の T5 フォト名と一致すれば同位置でなくても適用する（8-B5 の装備解除による
   * 詰め連動を維持）。マイフォト帳由来のフォトは【マイフォト】接頭辞のため一致しない。
   * 省略時は従来どおり装着位置のみで判定（後方互換）。
   */
  goldenPhotoNames?: ReadonlyArray<ReadonlyArray<string>>;
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

/**
 * 【Phase 8-B10 追補3】golden フォトスキルの注入判定。
 * goldenPhotoNames（T5 実測サンプルのレーン内フォト名一覧）が省略なら従来動作（true）。
 * 指定時は装着位置のフォト名が T5 実測フォトのいずれかと一致する場合のみ true。
 * 名前が無い/読めないフォト（"unreadable" 等）は同一名の T5 フォトが存在する場合のみ一致。
 */
function goldenPhotoSkillApplies(
  goldenNames: ReadonlyArray<string> | undefined,
  photoName: string | undefined,
): boolean {
  if (goldenNames === undefined) return true;
  return photoName !== undefined && goldenNames.includes(photoName);
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

/**
 * 写真・アクセサリのスコアボーナス%最大値（同一ステータス非重複用）。
 * 【サンプル3実測確定・2026-09-04】フォトの「ビートスコア上昇%」は複数枚積んでも
 * 重複加算されず最大値のみ適用される（L4 怜: 17.5%+19.3% を sum すると実測 pop
 * +86.4K に対し +11.4% 過大。max(17.5%, 19.3%) で実測比 1.018 と完璧に乱数内一致）。
 */
function maxScorePct(items: PhotoOrAccessory[], key: string): number {
  let max = 0;
  for (const item of items) {
    for (const s of item.structured) {
      if (s.stat === key && s.type === "pct") {
        const val = pctToPermil(s.value);
        if (val > max) max = val;
      }
    }
  }
  return max;
}

/** 写真のスキルステータス固定値合計（例: a_score 固定値 = Aスキルスコア追加の平坦加算） */
function sumFixedPhotoScore(photos: PhotoOrAccessory[], key: string): number {
  let sum = 0;
  for (const p of photos) {
    for (const s of p.structured) {
      if (s.stat === key && s.type === "fixed") {
        sum += s.value;
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

/** 現行のゲーム内レベルキャップ（2026-08 時点・将来的なキャップ解放時に更新する）。
 *  マスタ（CardParameter）は先行実装分のレベル行を含むため、UI 選択肢と既定値はこの上限で抑える。 */
export const CURRENT_LEVEL_CAP = 230;

/**
 * メンバーのタイプ（装着カードの属性）を導出する。
 * 【Estimate】カード属性 = ratiosPermil の vocal/dance/visual 最大
 * （research/07_master_lookup.md §Card.type・確度 Medium。同率時は vocal > dance > visual 優先）。
 * *_type_N（ボーカルタイプN人 等）の対象プールに使う（サンプル1実測確定の概念・2026-09-01）。
 */
export function cardTypeOf(card: CardDef): LaneInput["cardType"] {
  const r = card.ratiosPermil;
  if (r.visual > r.vocal && r.visual > r.dance) return "visual";
  if (r.dance > r.vocal) return "dance";
  return "vocal";
}

/** カードに存在するレベル行の列（UI のレベル選択用。昇順・現行キャップ 230 まで） */
export function availableLevels(data: SimSourceData, cardId: string): number[] {
  const card = data.cards.find((c) => c.id === cardId);
  if (card === undefined) {
    return [];
  }
  return data.cardParameters
    .filter((r) => r.id === card.cardParameterId && r.level <= CURRENT_LEVEL_CAP)
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
  // 【Phase 8-B】フォト付与（grant_* キー）の受領分をレーン毎に集計
  const { statGrants, scoreGrants } = collectPhotoGrants(deck);
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
          photos: [
            ...toStatBonus(ch.photos),
            // 【Phase 8-B】他レーンのフォト付与（隣接/センター/スコアラー）を受領分に加算。
            // 通常の装備%と同一プール（Peing id=1187940162）
            ...(statGrants.get(lane) !== undefined
              ? [{ pct: statGrants.get(lane)!, fixed: {} }]
              : []),
          ],
          accessories: toStatBonus(ch.accessories),
        },
      },
      row,
    );
    // メンタルはデッキ値式で自動算出される（research/01 §1.4: 全員初期値100・
    // 交流Men%×100・スタッフ固定・エール固定・フォト/アクセ固定を加算。
    // T5 実測 5 レーン（8996/5880/8074/5890/5880）と 1 の位まで一致済み・2026-08-31）。
    // deck.mental は P スキル発動順（メンタル降順）にのみ使用され、スコア式には直接入らない。
    // mentalOverride は任意の上書き（T5 検証ハーネス・UI 手入力用）
    const overrideRaw = options.mentalOverride?.[String(lane)];
    const deckStatus: StatValues<number> = {
      ...result.deck,
      mental: overrideRaw !== undefined ? Number(overrideRaw) : result.deck.mental,
      critical: 0,
    };
    // スコア系フォト加算の対象写真リスト。ch.photos 全体を使う。
    // 【2026-09-04 訂正】装備のみへの絞り込みは S1/S2 の確定値を破壊するため撤回した。
    // S1 L1 の flat +92,262/+121,429・S1 L4 の +177,075（=66641+47601+62833）・
    // S2 L3 の flat 66641 はいずれも未装備フォト由来であり実測と一致するため、
    // 未装備フォトのスコア加算は計上する（deck ステータス計算と同一範囲）。
    // S3 L4 の beat+368‰ 等の扱いは残課題として個別に検証する。
    const equipmentForScore = [...ch.photos, ...ch.accessories];
    // golden スキルの元カード ID（"sk-" 接頭辞 ↔ "card-" の正規化比較）
    const ownerCardIdOf = (s: SkillDef): string | null =>
      s.cardId == null || s.cardId === ""
        ? null
        : s.cardId.startsWith("sk-")
          ? `card-${s.cardId.slice(3)}`
          : s.cardId;
    // レーンの golden スキルのうち、選択カード自身のもの（実測較正済み）
    const cardGoldenSkills = data.skillsGolden.filter(
      (s) =>
        s.lane === lane &&
        (s.kind === "A" || s.kind === "SP" || s.kind === "P") &&
        !disabled.has(s.id) &&
        ownerCardIdOf(s) === ch.card_id,
    );
    const lanePhotos = [
      ...data.skillsGolden.filter(
        (s) =>
          s.lane === lane &&
          s.kind === "photo" &&
          (s.effects?.length ?? 0) > 0 &&
          !disabled.has(s.id) &&
          // 【Phase 8-B5】golden フォトスキル photoIndex=i は「i 番目に装着した実測/JSON
          // フォト」に対応する。装備数を超える photoIndex のスキルは対応フォトが装備されて
          // いないため注入しない（装備解除でステータスとスキルが同時に外れる連動）。
          // T5 実測は photoIndex 1-4 ↔ photos 4 枚で全件該当（不変）。
          (s.photoIndex == null || s.photoIndex <= ch.photos.length) &&
          // 【Phase 8-B10 追補3】T5 由来スキルの汎用編成への混入防止: 装着位置のフォトが
          // T5 実測フォト（goldenPhotoNames・レーン内の名前一覧）と一致する場合のみ注入
          goldenPhotoSkillApplies(options.goldenPhotoNames?.[lane - 1], ch.photos[(s.photoIndex ?? 1) - 1]?.name),
      ),
      // 【Phase 8-B】マイフォト帳のユーザー定義フォトスキルをマージ
      ...(options.userPhotoSkills ?? []).filter(
        (s) => s.lane === lane && s.kind === "photo" && !disabled.has(s.id),
      ),
    ];
    let laneSkills: SkillDef[];
    if (cardGoldenSkills.length > 0) {
      // 実測較正済みスキル（golden）を優先
      laneSkills = cardGoldenSkills;
    } else if (data.skillsByCard && data.skillsByCard[ch.card_id] !== undefined) {
      // 【Phase 6】マスタ自動解析スキル（未較正・Estimate）。
      // lane を選択レーンへ上書きし、未対応効果（unsupportedEffects）は警告に記録
      laneSkills = data.skillsByCard[ch.card_id]!
        .filter((s) => !disabled.has(s.id))
        .map((s) => ({ ...s, lane }));
      for (const s of laneSkills) {
        const master = s as unknown as MasterSkillDef;
        if (master.unsupportedEffects) {
          warnings.push(
            `L${lane}: skill "${s.id}" (${s.name}) has ${master.unsupportedEffects} unsupported effect(s) from master (Estimate)`,
          );
        }
        if (master.conditionalNote) {
          warnings.push(
            `L${lane}: skill "${s.id}" (${s.name}) is conditional [${master.conditionalNote}] — treated as unconditional (Estimate)`,
          );
        }
      }
    } else {
      // マスタ未対応カード: レーンの golden スキルをそのまま使用（旧動作）。
      // 元カード不一致は警告（スキル効果の較正が実測カード由来のため）
      laneSkills = data.skillsGolden.filter(
        (s) =>
          s.lane === lane &&
          (s.kind === "A" || s.kind === "SP" || s.kind === "P") &&
          !disabled.has(s.id),
      );
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
    }
    // 【Phase 8-B3】スキルレベル上書き（skill_levels 指定がある場合）。
    // data.skillLevels（data/skills_levels.json）から該当レベルの SkillDef を復元し、
    // 同一 skillId の定義を差し替える。golden 較正スキルを別レベルへ変更した場合は
    // マスタ解析値（未較正）に置き換わるため警告に出す。
    const skillLevelOverrides = ch.skill_levels;
    if (skillLevelOverrides !== undefined && data.skillLevels !== undefined) {
      const index = buildSkillLevelIndex(data.skillLevels);
      laneSkills = laneSkills.map((s) => {
        const want = skillLevelOverrides[s.id];
        if (want === undefined || want === s.level) return s;
        const decoded = decodeSkillLevel(data.skillLevels!, s.id, want, index);
        if (decoded === null) {
          warnings.push(
            `L${lane}: skill "${s.id}" level ${want} not found in skills_levels (keeping Lv${s.level})`,
          );
          return s;
        }
        if (cardGoldenSkills.some((g) => g.id === s.id)) {
          warnings.push(
            `L${lane}: skill "${s.id}" is golden-calibrated at Lv${s.level}; Lv${want} uses master values (uncalibrated)`,
          );
        }
        return { ...decoded, lane };
      });
    }
    // 【サンプル3・2026-09-04】フォト付与の静的 CT 短縮（S3 L4: A の CT30→25）。
    // レベル解決の後に適用する（短縮はレベル確定後の規定値にかかる）。
    if (ch.ct_cuts !== undefined && ch.ct_cuts.length > 0) {
      const before = laneSkills.map((s) => `${s.id}:${s.ct ?? "-"}`).join(",");
      laneSkills = applySkillCtCuts(laneSkills, ch.ct_cuts, (m) => warnings.push(`L${lane}: ${m}`));
      const after = laneSkills.map((s) => `${s.id}:${s.ct ?? "-"}`).join(",");
      if (before !== after) {
        warnings.push(`L${lane}: ct_cuts applied (${before} → ${after})`);
      }
    }
    lanes.push({
      lane,
      attribute: laneAttributeOf(lane, laneAttributes),
      role: ch.role as LaneInput["role"],
      cardType: cardTypeOf(card),
      // 【サンプル3・2026-09-04】キャラ優位（該当キャラのレーンは advantagePermil。
      // STAGE045 の L5 miho = 2250。それ以外は 1000）
      characterAdvantagePermil: (() => {
        const adv = data.characterAdvantageByQuest?.[options.stageFile];
        if (adv === undefined) return 1000;
        const characterId = card.characterId ?? "";
        return adv.characterIds.includes(characterId) ? adv.advantagePermil : 1000;
      })(),
      deck: deckStatus,
      skills: laneSkills,
      photos: lanePhotos,
      scoreBonusPct: {
        beat:
          Y.scorePct.beat +
          maxScorePct(equipmentForScore, "beat_score") +
          (scoreGrants.get(lane)?.beat_score ?? 0),
        active:
          Y.scorePct.active +
          sumScorePct(equipmentForScore, "a_score") +
          (scoreGrants.get(lane)?.a_score ?? 0),
        special:
          Y.scorePct.special +
          sumScorePct(equipmentForScore, "sp_score") +
          (scoreGrants.get(lane)?.sp_score ?? 0),
        passive:
          sumScorePct(equipmentForScore, "p_score") + (scoreGrants.get(lane)?.p_score ?? 0),
      },
      critExtrasPermil:
        Y.scorePct.criticalScore +
        sumScorePct(equipmentForScore, "critical_score") +
        (scoreGrants.get(lane)?.critical_score ?? 0),
      // 【2026-09-02 サンプル1確定】写真の「Aスコア（固定値）」は A スキルスコアに平坦加算
      // （b123: +92,262+121,429。千紗ビーム b40/97/130 は +177,075。出典: S1 実測とユーザー計算式。
      // 【2026-09-04】未装備フォト由来の flat も計上する（S1/S2 実測と一致））
      aScoreAdditionalFlat: sumFixedPhotoScore(ch.photos, "a_score"),
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
    // 【サンプル3・2026-09-03】スタミナ消費倍率（STAGE045 は 3000=3.0倍。省略時 1000）
    skillStaminaWeightPermil: stageWeights.skillStaminaWeightPermil ?? 1000,
    // 【サンプル3・2026-09-03】スタミナ回復倍率（0 = 特徴なし = 1000 扱い。解決は engine 側）
    staminaRecoveryWeightPermil: stageWeights.staminaRecoveryWeightPermil ?? 0,
    stageFactorPermil: 1000,
  };
  let fanFactorPermil = options.fanFactorPermil ?? 1620;
  let laneFanFactorPermil: number[] | undefined;
  if (options.laneFans !== undefined) {
    // 【Phase 16-A4・2026-09-30】レーン別来場数（fan.png 実測）→ 満員ガード付き表引き。
    // 実測 5 サンプル 25/25 一致の規則（phase16_action3b_fan_full_house.md）:
    //   合計 >= cap（満員）→ 全レーン一律 f(cap/5) ／ 合計 < cap（空席）→ f(lane_fans[i])
    if (data.audienceAdvantage === undefined) {
      throw new Error("laneFans specified but audienceAdvantage table is missing");
    }
    laneFanFactorPermil = laneFanFactorsPermil(
      options.laneFans,
      data.audienceAdvantage,
      options.maxCapacity,
    );
    const laneSum = options.laneFans.reduce((sum, fans) => sum + fans, 0);
    const isFullHouse =
      options.maxCapacity !== undefined && laneSum >= options.maxCapacity;
    // fanFactorPermil（スカラー）は従来互換の参考値（レーン平均）。エンジンは laneFanFactorPermil を優先
    fanFactorPermil = Math.round(
      laneFanFactorPermil.reduce((sum, value) => sum + value, 0) / laneFanFactorPermil.length,
    );
    warnings.push(
      `laneFans=(${options.laneFans.join("/")}) 合計 ${laneSum} / cap ${options.maxCapacity ?? "-"} → ` +
        `${isFullHouse ? "満員: 全レーン一律 f(cap/5)" : "空席: レーン別表引き"}: ` +
        `[${laneFanFactorPermil.join(", ")}]‰（平均 ${fanFactorPermil}‰）`,
    );
  } else if (options.audience !== undefined) {
    if (data.audienceAdvantage === undefined) {
      throw new Error("audience specified but audienceAdvantage table is missing");
    }
    fanFactorPermil = fanBonusPermil(options.audience, data.audienceAdvantage);
  }

  // 【Phase 9】ライブボーナス（ステージ側Pスキル）。無効化リストはスキル/フォトと共用
  const liveBonusSkills = data.liveBonusesByQuest?.[options.stageFile]?.filter(
    (s) => !disabled.has(s.id),
  );
  // ユニット人数条件（count_liz>=1 等）の判定用に編成のキャラクターIDを渡す
  const formationCharacterIds = deck.characters.map((ch) => {
    const card = data.cards.find((c) => c.id === ch.card_id);
    return card?.characterId ?? "";
  });

  const base: SimulateInputBase = {
    lanes,
    notes,
    stage,
    fanFactorPermil,
    // 【Phase 16-A4】レーン別来場数モードのみ注入（未指定時は従来経路＝完全互換）
    ...(laneFanFactorPermil !== undefined ? { laneFanFactorPermil } : {}),
    fanBaseCount: options.audience,
    successBasePermil: options.successBasePermil ?? 1000,
    baseCritRate: options.baseCritRate,
    roundingPolicy: "at-end",
    missedNotes: options.missedNotes?.map((m) => ({
      beat: m.beat,
      lane: m.lane as LaneNumber,
    })),
    liveBonusSkills,
    formationCharacterIds,
  };
  return { base, lanes, warnings };
}

// ---------------------------------------------------------------------------
// 集計ヘルパー（レーン別内訳）
// ---------------------------------------------------------------------------

export type ScoreKind = "beat" | "A" | "SP" | "P" | "photo" | "live_bonus";

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
        byKind: { beat: 0, A: 0, SP: 0, P: 0, photo: 0, live_bonus: 0 },
        events: 0,
        activations: 0,
      };
      map.set(lane, e);
    }
    return e;
  };
  for (const bt of beats) {
    for (const ev of bt.events) {
      // ライブボーナス由来のスコアイベントはレーン非所属のため内訳集計から除外
      if (ev.lane >= 1) {
        const e = entry(ev.lane);
        e.total += ev.gainedScore;
        e.byKind[ev.sourceKind] += ev.gainedScore;
        e.events += 1;
      }
    }
    for (const act of bt.activations) {
      if (act.success && act.lane !== 0) {
        // ライブボーナス（lane=0）の発動はレーン別発動数にカウントしない
        entry(act.lane).activations += 1;
      }
    }
  }
  return [...map.values()].sort((a, b) => a.lane - b.lane);
}

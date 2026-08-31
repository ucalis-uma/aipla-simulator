/**
 * 単一HTML シミュレータ UI（Phase 4 + Phase 6）。
 *
 * - 計算コアは src/（esbuild でバンドル・依存ゼロ）。データは tools/build_ui.mjs が
 *   ビルド時に JSON として埋め込む（file:// 直開きで動作・fetch 不要）。
 * - 【Phase 6】全491カード・全111譜面・全ステージ（5916クエスト）・全624アクセサリを
 *   UI から検索・選択可能（インクリメンタル検索モーダル）。カード選択時に
 *   マスタ解析スキル（data/skills_master.json）とレベル/レアリティを自動セット。
 * - 編成の名前付き保存/読込（LocalStorage）・JSON エクスポート/インポート。
 * - 出力: 確定値（乱数中立）/ Monte Carlo 統計 / レーン別内訳 / スコア推移グラフ /
 *   バフ推移ヒートマップ / ビート別タイムライン表 / 確度タグ。
 */
import {
  buildSimulateInput,
  laneBreakdown,
  availableLevels,
  CURRENT_LEVEL_CAP,
  laneAttributeOf,
  fanBonusPermil,
  simulateTimeline,
  optimizeLineup,
  ContinuousRng,
  NeutralRng,
  defaultPhotoTemplates,
  grantStructuredKey,
  myPhotoToEquipEntry,
  myPhotoToSkillDef,
  parseGrantKey,
  userPhotoSkillId,
  photoMasterToMyPhoto,
  photoSummary,
  statFrameLimit,
  validateMyPhoto,
  validatePhotoEquip,
  type DeckJsonV2,
  type SimSourceData,
  type SkillDef,
  type SkillEffect,
  type LaneNumber,
  type TimelineResult,
  type BuffKey,
  type LaneBreakdownEntry,
  type StageWeights,
  type ChartFile,
  type OptimizerEntry,
  type OptimizerResult,
  type CardRole,
  type MyPhotoDef,
  type PhotoFrame,
  type PhotoFrameKind,
  type PhotoSkillDef,
  type PhotoMasterEntry,
  type EffectType,
  buildSkillLevelIndex,
  decodeSkillLevel,
  maxSkillLevelOf,
  type SkillLevelData,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// 埋め込みデータ
// ---------------------------------------------------------------------------

interface UiMusic {
  id: string;
  n: string;
  s: string;
  o: number;
}
interface UiConfig {
  a: number[];
  w: number[];
  aw: number[];
  mt: number;
  cap: number;
}
interface UiQuest {
  id: string;
  n: string;
  m: number;
  d: number;
  c: number;
  ch: number;
  clear: number;
  /** 【Phase 8】大分類エリア参照（stagesIndex.areas の添字・-1 は不明） */
  ar: number;
}
interface UiArea {
  /** 大分類カテゴリコード */
  c: string;
  /** エリア名（例: ハイスコアライブ / 月のテンペスト / STAGE19 の「撮影フィルム」） */
  n: string;
}
interface UiStagesIndex {
  musics: UiMusic[];
  configs: UiConfig[];
  charts: string[];
  /** 【Phase 8】一意エリア一覧（大分類 + エリア名。Quest.json の areaId → Area.json の type/name から導出） */
  areas: UiArea[];
  quests: UiQuest[];
}
interface UiAccessory {
  id: string;
  assetId: string;
  name: string;
  classification: string;
  rarity: number;
  characterId: string;
  structured: Array<{ stat: string; type: "pct" | "fixed"; value: number }>;
}
interface MasterSkillDef extends Omit<SkillDef, "lane"> {
  lane: null;
  unsupportedEffects?: number;
  conditionalNote?: string | null;
}

interface UiData {
  data: SimSourceData;
  chartsAll: Record<string, Array<[number, number]>>;
  stagesIndex: UiStagesIndex;
  accessories: UiAccessory[];
  /** 【Phase 8-B2】フォトマスタ（メモリアルフォト一覧・初期品質・フォトスキル辞書） */
  photosMaster: { photos: PhotoMasterEntry[]; skillsById: Record<string, SkillDef> };
  /** 【Phase 8-B3】カードレベル解放テーブル */
  unlocks: {
    skillSlotUnlockLevels: number[];
    photoSlotUnlockLevels: number[];
    accessorySlotUnlockLevels: number[];
    skillLevelRequirements: Record<string, number[]>;
  };
  characters: Record<string, string>;
  sampleDeck: DeckJsonV2;
  defaultMissedNotes: Array<{ beat: number; lane: number }>;
  stageFile: string;
  chartFile: string;
  builtAt: string;
}

const DATA: UiData = JSON.parse(
  (document.getElementById("embedded-data") as HTMLScriptElement).textContent ?? "{}",
);

// ---------------------------------------------------------------------------
// ステージ/譜面の動的切替（Phase 6: 全ステージ・全譜面対応）
// ---------------------------------------------------------------------------

function stageWeightsFromConfig(cfg: UiConfig): StageWeights {
  return {
    beatWeightsPermil: { vocal: cfg.w[0]!, dance: cfg.w[1]!, visual: cfg.w[2]! },
    skillWeightsPermil: { active: cfg.aw[0]!, special: cfg.aw[1]! },
    laneAttributes: cfg.a,
  };
}

function chartFileFromCompact(compact: ReadonlyArray<[number, number]>): ChartFile {
  return {
    notes: compact.map(([type, position], i) => ({
      beat: i + 1,
      type: type as 1 | 2 | 3,
      position: position as ChartFile["notes"][number]["position"],
    })),
  };
}

/** ステージ・譜面データを data.stages / data.charts へ注入し state の参照を更新（ファンファクターは変更しない） */
function injectStage(stageId: string): UiQuest {
  const idx = DATA.stagesIndex;
  const quest = idx.quests.find((q) => q.id === stageId);
  if (quest === undefined) {
    throw new Error(`ステージが見つかりません: ${stageId}`);
  }
  const chartId = idx.charts[quest.ch]!;
  const compact = DATA.chartsAll[chartId];
  if (compact === undefined) {
    throw new Error(`譜面が見つかりません: ${chartId}`);
  }
  DATA.data.stages[stageId] = stageWeightsFromConfig(idx.configs[quest.c]!);
  DATA.data.charts[chartId] = chartFileFromCompact(compact);
  state.stageId = stageId;
  state.chartId = chartId;
  return quest;
}

/** ステージ選択の適用: データ注入＋会場キャパからのファンファクター再導入＋UI 反映 */
function applyStage(stageId: string): void {
  const quest = injectStage(stageId);
  // 【Phase 8】会場の最大キャパシティから個人来場ファン数（容量÷5）と
  // 最大ファンファクターを導出して初期値にセット（手打ちで上書き可）
  const cap = DATA.stagesIndex.configs[quest.c]!.cap;
  const audience = Math.max(0, Math.min(50000, Math.floor(cap / 5)));
  state.audience = audience;
  state.fanFactorPermil = fanBonusPermil(audience, DATA.data.audienceAdvantage ?? []);
  // 既存のデッキ値プレビュー・スキル一覧はレーン属性に依存するため再描画
  renderConfig();
}

function currentQuest(): UiQuest | undefined {
  return DATA.stagesIndex.quests.find((q) => q.id === state.stageId);
}

function currentMusicName(quest: UiQuest | undefined): string {
  if (quest === undefined) return "—";
  const music = DATA.stagesIndex.musics[quest.m];
  return music ? music.n : "—";
}

// ---------------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------------

interface LaneUiState {
  cardId: string;
  level: number;
  rarity: number;
  kouryu: number;
  /** ロールはカード固有（data/cards.json の role・vendors Card.type から導出）。UI では表示のみ */
  role: CardRole;
  /** メンタル値（P スキル発動順のタイブレークにのみ使用）。
   *  null = 自動算出（100×(1+交流Men%)+スタッフ+エール+装備・research/01 §1.4）。
   *  数値 = 手入力による任意上書き */
  mental: number | null;
  /** 絆覚醒（リンクカードの第4スキル有効化・アイコン変化） */
  bondAwake: boolean;
  enabledSkillIds: Set<string>;
  enabledPhotoIds: Set<string>;
  photosJson: string;
  accessoriesJson: string;
  /** 【Phase 8-B】マイフォト帳から装備したフォト ID 列（順序 = 装着順） */
  photoEquip: string[];
  /**
   * 【Phase 8-B5】個別無効化したマイフォトスキル ID（uph-*）。
   * 帳装備行の「スキル」チェックボックスで制御（golden スキルは enabledPhotoIds）。
   */
  disabledUserPhotoSkills: Set<string>;
  /**
   * 【Phase 8-B3】スキルレベル上書き（skillId → Lv1-6）。
   * 未指定 = カードレベルから許可される最大レベル（現行 UI の既定動作）。
   */
  skillLevels: Record<string, number>;
}

interface AppState {
  stageId: string;
  chartId: string;
  audience: number;
  /** ファンファクター permil（1000=1.0倍。手打ちで上書き可・applyStage で会場キャパから再導出） */
  fanFactorPermil: number;
  successBasePct: number;
  critRate: number;
  mcRuns: number;
  seed: number;
  missedNotesText: string;
  staff: DeckJsonV2["staff_bonus"];
  yell: DeckJsonV2["yale_bonus"];
  lanes: LaneUiState[];
}

const LANE_LABELS = ["L1 左端", "L2 左", "L3 センター", "L4 右", "L5 右端"];

function defaultLaneState(): AppState {
  const lanes: LaneUiState[] = DATA.sampleDeck.characters.map((ch) => {
    const skills = DATA.data.skillsGolden.filter(
      (s) => s.lane === ch.lane && (s.kind === "A" || s.kind === "SP" || s.kind === "P"),
    );
    const photos = DATA.data.skillsGolden.filter(
      (s) => s.lane === ch.lane && s.kind === "photo" && s.effects.length > 0,
    );
    return {
      cardId: ch.card_id,
      level: ch.level,
      rarity: ch.rarity,
      kouryu: ch.kouryu_level,
      // ロールはカード固有の情報（Card.type 導出）。サンプルの role 値と一致することを検証済み
      role: cardRoleOf(ch.card_id),
      // メンタルは null（自動算出: 100×(1+交流Men%)+スタッフ+エール+装備）
      mental: null,
      bondAwake: false,
      enabledSkillIds: new Set(skills.map((s) => s.id)),
      enabledPhotoIds: new Set(photos.map((s) => s.id)),
      photosJson: JSON.stringify(ch.photos, null, 1),
      accessoriesJson: JSON.stringify(ch.accessories, null, 1),
      photoEquip: [],
      disabledUserPhotoSkills: new Set(),
      skillLevels: { ...(ch.skill_levels ?? {}) },
    };
  });
  return {
    stageId: DATA.stageFile,
    chartId: DATA.chartFile,
    audience: 16000,
    fanFactorPermil: 1620,
    successBasePct: 100,
    critRate: 0.5,
    mcRuns: 300,
    seed: 1,
    missedNotesText: JSON.stringify(DATA.defaultMissedNotes),
    staff: { ...DATA.sampleDeck.staff_bonus },
    yell: { ...DATA.sampleDeck.yale_bonus },
    lanes,
  };
}

let state: AppState = defaultLaneState();

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector(sel);
  if (el === null) throw new Error(`element not found: ${sel}`);
  return el as T;
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("ja-JP");
}

/** ゲーム表示風の短縮（億/万） */
function fmtScore(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(2) + "億";
  if (a >= 1e4) return (n / 1e4).toFixed(1) + "万";
  return fmtInt(n);
}

function cardOf(id: string) {
  return DATA.data.cards.find((c) => c.id === id);
}

/** 新規カード選択時の既定レベル（現行ゲーム内キャップ 230 内。将来的なキャップ解放時は要更新） */
const DEFAULT_LEVEL = 215;
/** 新規カード選択時の既定開花（現在☆・限界突破最大） */
const DEFAULT_RARITY = 10;

const ROLE_LABEL: Record<CardRole, string> = {
  Scorer: "スコアラー",
  Buffer: "バッファ",
  Supporter: "サポーター",
};

/** カード固有ロール（vendors Card.json type 1=Scorer / 2=Buffer / 3=Supporter → data/cards.json の role）。 */
function cardRoleOf(cardId: string): CardRole {
  return cardOf(cardId)?.role ?? "Scorer";
}

function charName(characterId: string): string {
  return DATA.characters[characterId] ?? characterId;
}

/** カードの得意属性（ステータス比率の最大）— 検索フィルタ用 */
function cardAttr(c: { ratiosPermil: { vocal: number; dance: number; visual: number } }): "vocal" | "dance" | "visual" {
  const r = c.ratiosPermil;
  const max = Math.max(r.vocal, r.dance, r.visual);
  if (max === r.vocal) return "vocal";
  if (max === r.dance) return "dance";
  return "visual";
}

const ATTR_SHORT = { vocal: "Vo", dance: "Da", visual: "Vi" } as const;

// ---------------------------------------------------------------------------
// カード・アクセサリのサムネイル画像（INFO PRIDE CDN・フォールバック付き）
// ---------------------------------------------------------------------------

const CDN_IMG_BASE = "https://idoly-ac.outv.im/api/img/";
/** ローカル同梱アイコン（tools/download_card_icons.mjs が dist/images/cards/ へ保存・Tauri はビルド時埋め込み） */
const LOCAL_IMG_BASE = "./images/cards/";

function cardSuffixOf(cardId: string): string {
  return cardId.startsWith("card-") ? cardId.slice(5) : cardId;
}

/**
 * アイコンのアセットベース名。マスタの assetId を優先
 * （card-ktn-02-casl-00 → "ktn-02-eve-00" のように id サフィックスと不一致のカードが 4 枚ある）。
 */
function cardAssetBase(cardId: string): string {
  const card = cardOf(cardId);
  return card?.assetId && card.assetId !== "" ? card.assetId : cardSuffixOf(cardId);
}

/** 開花レベル・絆覚醒からサムネイル variation を決定（INFO PRIDE 仕様: 1=開花後・初期☆5, 2=絆覚醒, 0=未開花(初期☆4以下のみ)） */
function cardThumbVariation(l: { cardId: string; rarity: number; bondAwake: boolean }): 0 | 1 | 2 {
  const card = cardOf(l.cardId);
  if (l.bondAwake) return 2;
  if (card !== undefined && card.initialRarity < 5 && l.rarity < 5) return 0;
  return 1;
}

function cardThumbUrl(cardId: string, variation: number): string {
  return `${CDN_IMG_BASE}img_card_thumb_${variation}_${cardAssetBase(cardId)}`;
}

/**
 * サムネイル候補 URL 列（フォールバック順）:
 * 1. ローカル同梱（dist/images/cards/・単一HTML は同梱ディレクトリ、Tauri は埋め込み＝完全オフライン）
 * 2. INFO PRIDE CDN（同 variation）
 * 3. INFO PRIDE CDN 開花後（variation 1・未開花画像が両方に無い場合の最終画像フォールバック）
 */
function cardThumbSources(cardId: string, variation: number): string[] {
  const base = cardAssetBase(cardId);
  const sources = [`${LOCAL_IMG_BASE}img_card_thumb_${variation}_${base}.jpg`, cardThumbUrl(cardId, variation)];
  if (variation !== 1) sources.push(cardThumbUrl(cardId, 1));
  return sources;
}

/**
 * サムネイル HTML。
 * referrerpolicy="no-referrer" でローカル HTML からの CDN 画像表示を保証
 * （crossorigin は付けない: file:// 直開きでのローカル画像読込を優先するため）。
 */
function thumbHtml(cardId: string, variation: number, extraClass = ""): string {
  const card = cardOf(cardId);
  const attr = card ? cardAttr(card) : "vocal";
  const initial = card ? charName(card.characterId).slice(0, 1) : "?";
  const sources = cardThumbSources(cardId, variation);
  return `<span class="card-thumb ${extraClass}" data-thumb data-card-id="${esc(cardId)}">
    <img src="${esc(sources[0]!)}" data-srcs="${esc(JSON.stringify(sources))}" alt="" data-thumb-img data-attempt="0" loading="lazy" referrerpolicy="no-referrer">
    <span class="card-fallback attr-${attr}" data-thumb-fallback hidden>${esc(initial)}</span>
  </span>`;
}

/** レンダー直後に呼ぶ: サムネイルの onerror フォールバック（ローカル→CDN→開花後CDN→バッジ）を束ねる */
function bindThumbErrors(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>("img[data-thumb-img]").forEach((img) => {
    img.addEventListener("error", () => {
      const holder = img.closest("[data-thumb]") as HTMLElement | null;
      if (holder === null) return;
      let sources: string[] = [];
      try {
        sources = JSON.parse(img.dataset.srcs ?? "[]") as string[];
      } catch {
        sources = [];
      }
      const attempt = Number(img.dataset.attempt ?? "0") + 1;
      if (attempt < sources.length) {
        // 次点候補（CDN → 開花後 CDN）へ
        img.dataset.attempt = String(attempt);
        img.src = sources[attempt]!;
        return;
      }
      img.hidden = true;
      const fb = holder.querySelector("[data-thumb-fallback]") as HTMLElement | null;
      if (fb !== null) fb.hidden = false;
    });
  });
}

/** 開花レベル・絆覚醒の変更をサムネイルへ即時反映（レーン再描画なし） */
function updateLaneThumb(i: number): void {
  const holder = document.querySelector(`.lane-card[data-lane="${i + 1}"] [data-thumb]`) as HTMLElement | null;
  if (holder === null) return;
  const l = state.lanes[i]!;
  const img = holder.querySelector("img[data-thumb-img]") as HTMLImageElement;
  const fb = holder.querySelector("[data-thumb-fallback]") as HTMLElement | null;
  const variation = cardThumbVariation(l);
  img.hidden = false;
  if (fb !== null) fb.hidden = true;
  img.dataset.attempt = "0";
  const sources = cardThumbSources(l.cardId, variation);
  img.dataset.srcs = JSON.stringify(sources);
  const next = sources[0]!;
  if (img.getAttribute("src") !== next) img.src = next;
}

/**
 * アクセサリサムネイル（全36種＝分類×ティアの共有アセット）。
 * ローカル（./images/accessories/）優先 → CDN（img_acc_thumb_{assetId}）フォールバック →
 * どちらも不可なら非表示（種別チップがフォールバックとして残る）。
 */
function accAssetIdOf(idOrName: string): string {
  const acc =
    DATA.accessories.find((a) => a.id === idOrName) ??
    DATA.accessories.find((a) => a.name === idOrName);
  return acc?.assetId ?? "";
}

/**
 * アクセサリのサムネイル assetId を決定する。
 * 限界突破（+1〜20）スピリット・専用スピリット（ac-1-personal-*）に個別画像は無く、
 * 全624件が assetId（分類×ティア a〜f の 36 種）を共有する。assetId が空の旧データは
 * 分類の最上位ティア画像（{classification}-f）へフォールバックする。
 */
function accAssetIdFor(acc: { assetId?: string; id?: string; name?: string; classification?: string }): string {
  const known = acc.assetId ?? accAssetIdOf(acc.id ?? acc.name ?? "");
  if (known !== "") return known;
  const cls = acc.classification ?? DATA.accessories.find((a) => a.id === (acc.id ?? ""))?.classification ?? "";
  return cls !== "" ? `${cls}-f` : "";
}

function accThumbHtml(assetId: string): string {
  if (assetId === "") return "";
  const localSrc = `./images/accessories/img_acc_thumb_${assetId}.jpg`;
  const cdnSrc = `${CDN_IMG_BASE}img_acc_thumb_${assetId}`;
  return `<img class="acc-thumb" data-acc-thumb src="${esc(localSrc)}" data-fallback="${esc(cdnSrc)}" alt="" loading="lazy" onerror="if(this.src!=='${cdnSrc}'){this.src='${cdnSrc}';}else{this.hidden=true;}">`;
}

function skillConfidence(s: SkillDef): "Confirmed" | "Estimate" | "Unknown" {
  const confs = s.effects.map((e) => e.confidence ?? "");
  if (confs.some((c) => c.includes("Unknown") || c === "")) return "Unknown";
  if (confs.every((c) => c.includes("Confirmed"))) return "Confirmed";
  return "Estimate";
}

const CONF_BADGE: Record<string, string> = {
  Confirmed: "badge-c",
  Estimate: "badge-e",
  Unknown: "badge-u",
};

/** 効果行の短い要約（プレーンテキスト版・title 属性等に使用） */
function effectSummary(e: SkillEffect): string {
  const dur = e.durationBeats != null ? `[${e.durationBeats}b]` : "";
  const tgt =
    e.target === "self" ? "" : e.target.startsWith("score_type") ? "(スコアラー)" : `(${e.target})`;
  switch (e.type) {
    case "score_get":
      return `スコア${(e.powerPermil ?? 0) / 100}%${tgt}`;
    case "score_get_by_score_ratio":
      return `累積×${(e.powerPermil ?? 0) / 10}%${tgt}`;
    case "stamina_recovery":
      return `回復${e.value ?? 0}${tgt}`;
    case "ct_reduction":
      return `CT-${e.value ?? 0}`;
    case "ct_increase":
      return `CT+${e.value ?? 0}`;
    case "effect_extension":
    case "effect_amplify": {
      // スコープなし = 対象セレクトの対象への作用（T5 の「びっくりした?」等）。
      // 与/被 はレタッチ系。表記はゲーム内準拠（与・クリ率延長 / 被・Voブースト延長 等）
      const scopePrefix = e.scope === "given" ? "与・" : e.scope === "received" ? "被・" : "";
      const keyLabel = e.buffKey
        ? (BUFF_KEY_OPTIONS.find((o) => o.v === e.buffKey)?.label ?? e.buffKey).replace(/上昇$/, "")
        : "全バフ";
      const verb = e.type === "effect_extension" ? "延長" : "増強";
      return `${scopePrefix}${keyLabel}${verb}+${e.value ?? 0}${tgt}`;
    }
    case "combo_continue":
      return `コンボ継続${dur}`;
    default: {
      const label: Record<string, string> = {
        vocal_up: "Vo上昇",
        vocal_boost: "Voブースト",
        vocal_up_extreme: "Vo超化",
        dance_up: "Da上昇",
        dance_boost: "Daブースト",
        visual_up: "Vi上昇",
        visual_boost: "Viブースト",
        beat_score_up: "ビートスコア",
        tension_up: "テンション",
        score_up: "スコア",
        a_skill_score_up: "Aスコア",
        sp_skill_score_up: "SPスコア",
        combo_score_up: "コンスコ",
        critical_coeff_up: "クリ係数",
        critical_rate_up: "クリ率",
        stamina_cost_down: "消費低下",
        skill_success_up: "成功率",
        focus: "集目",
      };
      const limit = e.limitRelease ? "+上限解放" : "";
      return `${label[e.type] ?? e.type}+${e.stages ?? 0}段${dur}${limit}${tgt}`;
    }
  }
}

/** 効果type → 日本語短縮ラベル（リッチ表示用） */
const FX_TYPE_LABEL: Record<string, string> = {
  score_get: "スコア獲得",
  score_get_by_score_ratio: "累積比スコア獲得",
  vocal_up: "Vo上昇",
  vocal_boost: "Voブースト",
  vocal_up_extreme: "Vo超化",
  dance_up: "Da上昇",
  dance_boost: "Daブースト",
  visual_up: "Vi上昇",
  visual_boost: "Viブースト",
  beat_score_up: "ビートスコア",
  tension_up: "テンション",
  score_up: "スコア",
  a_skill_score_up: "Aスコア",
  sp_skill_score_up: "SPスコア",
  p_skill_score_up: "Pスコア",
  combo_score_up: "コンボスコア",
  critical_coeff_up: "クリ係数",
  critical_rate_up: "クリ率",
  stamina_recovery: "スタ回復",
  stamina_cost_down: "消費低下",
  stamina_cost_up: "消費増加",
  skill_success_up: "成功率",
  focus: "集目",
  stealth: "ステルス",
  ct_reduction: "CT短縮",
  ct_increase: "CT延長",
  effect_extension: "効果延長",
  effect_amplify: "効果増強",
  combo_continue: "コンボ継続",
  live_bonus_ct_reduction: "ライボCT短縮",
};

/** 効果type → チップ色カテゴリ */
function fxCssClass(type: string): string {
  if (type === "score_get" || type === "score_get_by_score_ratio") return "fx-score";
  if (type.endsWith("_score_up") || type === "score_up") return "fx-score";
  if (type.includes("critical")) return "fx-crit";
  if (type === "stamina_recovery" || type === "ct_reduction" || type === "effect_extension" || type === "effect_amplify" || type === "focus" || type === "stealth" || type === "combo_continue" || type === "skill_success_up") return "fx-utility";
  if (type.endsWith("_down")) return "fx-debuff";
  return "fx-buff";
}

/** 対象 → 短縮ラベル */
const FX_TARGET_LABEL: Record<string, string> = {
  self: "自身",
  all: "全員",
  neighbors: "隣接",
  center: "センター",
  single: "対象1人",
  trigger: "条件を満たした人",
};

function fxTargetLabel(target: string): string {
  if (FX_TARGET_LABEL[target] !== undefined) return FX_TARGET_LABEL[target];
  const m = /^(vocal|dance|visual)_type_(\d)$/.exec(target);
  if (m) {
    const attr = m[1] === "vocal" ? "ボーカル" : m[1] === "dance" ? "ダンス" : "ビジュアル";
    const n = Number(m[2]);
    return `${attr}タイプ${n === 5 ? "全員" : n + "人"}`;
  }
  const sm = /^(score|buffer|supporter)_type_(\d)$/.exec(target);
  if (sm) {
    const role = sm[1] === "score" ? "スコアラー" : sm[1] === "buffer" ? "バッファー" : "サポーター";
    const n = Number(sm[2]);
    return `${role}${n === 5 ? "全員" : n + "人"}`;
  }
  const hm = /^(vocal|dance|visual)_high_(\d)$/.exec(target);
  if (hm) {
    const attr = hm[1] === "vocal" ? "Vo" : hm[1] === "dance" ? "Da" : "Vi";
    return `${attr}上位${hm[2]}人`;
  }
  const st = /^status_([a-z_]+)_(\d)$/.exec(target);
  if (st) {
    const key = st[1] as string;
    return `${FX_TYPE_LABEL[key] ?? key}保持${st[2]}人`;
  }
  return target;
}

/** 発動条件 → 短縮ラベル（PHOTO_SKILL_CONDITIONS と整合） */
function fxConditionLabel(condition: string): string {
  const found = PHOTO_SKILL_CONDITIONS.find((c) => c.v === condition);
  return found ? found.label.replace(/（常時発動近似）/, "") : condition;
}

/**
 * 効果1行 → リッチ表示チップ（Phase 8-B2: 平文ではなく視覚的に整理）。
 * 例: [Voブースト +4段] [28b] [ボーカルタイプ1人] ／ 条件付きは [80コンボ以上時] を前置。
 */
function fxChipHtml(e: SkillEffect): string {
  const cls = fxCssClass(e.type);
  const label = FX_TYPE_LABEL[e.type] ?? e.type;
  const parts: string[] = [];
  if (e.type === "score_get" || e.type === "score_get_by_score_ratio") {
    parts.push(`<span class="fx fx-score" title="${esc(effectSummary(e))}">${esc(label)} <b>${esc(String((e.powerPermil ?? 0) / 10))}%</b></span>`);
  } else if (e.type === "stamina_recovery" || e.type === "ct_reduction" || e.type === "ct_increase" || e.type === "effect_extension" || e.type === "effect_amplify" || e.type === "live_bonus_ct_reduction") {
    parts.push(`<span class="fx ${cls}" title="${esc(effectSummary(e))}">${esc(label)} <b>${esc(String(e.value ?? 0))}</b></span>`);
  } else {
    const stages = e.stages ?? 0;
    const cap = e.capExtend ? "（超化+5段）" : e.limitRelease ? "+上限解放" : "";
    parts.push(`<span class="fx ${cls}" title="${esc(effectSummary(e))}">${esc(label)} <b>+${esc(String(stages))}段</b>${esc(cap)}</span>`);
  }
  if (e.durationBeats != null) {
    parts.push(`<span class="fx fx-dur">${esc(String(e.durationBeats))}b</span>`);
  }
  if (e.target !== undefined && e.target !== "self") {
    parts.push(`<span class="fx fx-target">→${esc(fxTargetLabel(e.target))}</span>`);
  }
  if (e.condition !== undefined && e.condition !== "none") {
    parts.push(`<span class="fx fx-cond">⏳${esc(fxConditionLabel(e.condition))}</span>`);
  }
  return parts.join("");
}

/**
 * 【Phase 8-B8】ステータス色の法則: Vo=ピンク・Da=青・Vi=黄。
 * フォトの自己ステ/付与チップ・実測/JSON フォト行・アクセサリチップに適用する
 * （その他のスコア系キーは fx-utility/fx-grant の従来色）。
 */
const STAT_FX_CLASS: Record<string, string> = {
  vocal: "fx-stat-vocal",
  dance: "fx-stat-dance",
  visual: "fx-stat-visual",
};

/** フォト1枚のリッチ要約（帳・装備行・マスタ一覧用。HTML を返す） */
function photoSummaryHtml(photo: MyPhotoDef): string {
  const parts: string[] = [];
  if (photo.skill !== null) {
    const s = photo.skill;
    const pseudo: SkillEffect = {
      type: s.type,
      ...(s.powerPermil !== undefined ? { powerPermil: s.powerPermil } : {}),
      ...(s.stages !== undefined ? { stages: s.stages } : {}),
      ...(s.value !== undefined ? { value: s.value } : {}),
      ...(s.buffKey ? { buffKey: s.buffKey as SkillEffect["buffKey"] } : {}),
      ...(s.scope ? { scope: s.scope } : {}),
      durationBeats: s.durationBeats ?? null,
      target: s.target,
      condition: s.condition,
    };
    parts.push(fxChipHtml(pseudo));
    const meta: string[] = [];
    if (s.ct != null) meta.push(`CT${s.ct}`);
    if (s.staminaCost != null) meta.push(`消費${s.staminaCost}`);
    if ((s.limitPerLive ?? 0) > 0) meta.push("ライブ中1回");
    if (meta.length > 0) {
      parts.push(`<span class="fx fx-meta">${esc(meta.join("・"))}</span>`);
    }
  }
  const kindLabel: Record<string, string> = {
    grant_neighbors: "隣接→",
    grant_center: "センター→",
    grant_scorer: "スコアラー→",
  };
  for (const f of photo.frames) {
    const statLabel =
      f.stat === "critical_score" ? "クリスコ" :
      f.stat === "beat_score" ? "ビートスコア" :
      f.stat === "a_score" ? "Aスコア" :
      f.stat === "sp_score" ? "SPスコア" :
      f.stat === "p_score" ? "Pスコア" :
      f.stat === "vocal" ? "Vo" : f.stat === "dance" ? "Da" : f.stat === "visual" ? "Vi" :
      f.stat === "stamina" ? "Sta" : f.stat === "mental" ? "Men" : f.stat === "critical" ? "Cri" :
      f.stat;
    // 【Phase 8-B8】ステータス色の法則: Vo=ピンク・Da=青・Vi=黄（自己ステ/付与とも同色）。
    // その他のキーは自己ステ=グレー・付与=黄色（fx-grant）
    const cls =
      STAT_FX_CLASS[f.stat] ??
      (f.kind === "self" ? "fx-utility" : "fx-grant");
    const prefix = kindLabel[f.kind] ?? "";
    parts.push(
      `<span class="fx ${cls}" title="${esc((prefix ? prefix.slice(0, -1) + ": " : "") + statLabel)}">${esc(prefix + statLabel)} <b>${esc(String(f.type === "pct" ? "+" + f.value + "%" : "+" + f.value))}</b></span>`,
    );
  }
  return parts.join(" ") || `<span class="dim">（効果なし）</span>`;
}

// ---------------------------------------------------------------------------
// カードレベル解放・スキルLv制約（Phase 8-B3・data/unlocks.json はマスタ CardLevelRelease 準拠）
// ---------------------------------------------------------------------------

/** スキル枠 slot（0始まり index・3=絆覚醒）の解放カードレベル（未定義は Lv1） */
function skillSlotUnlockLevel(slotIdx: number): number {
  return DATA.unlocks.skillSlotUnlockLevels[slotIdx] ?? 1;
}

/** カードレベルに対してスキル枠 slot が解放済みか */
function skillSlotLocked(slotIdx: number, cardLevel: number): boolean {
  return cardLevel < skillSlotUnlockLevel(slotIdx);
}

/** スキルLv lv を枠 slot で選ぶのに必要なカードレベル */
function skillLevelRequirement(slotIdx: number, lv: number): number {
  return DATA.unlocks.skillLevelRequirements[String(slotIdx + 1)]?.[lv - 1] ?? 0;
}

/** カードレベルから選択できる最大スキルLv（1-6） */
function maxSkillLevelForSlot(slotIdx: number, cardLevel: number): number {
  const req = DATA.unlocks.skillLevelRequirements[String(slotIdx + 1)] ?? [0, 0, 0, 0, 0, 0];
  return maxSkillLevelOf(req, cardLevel);
}

/** フォト枠数（カードレベルから導出: 初期2・Lv65で3枚目・Lv105で4枚目） */
function photoSlotLimitOf(cardLevel: number): number {
  const levels = DATA.unlocks.photoSlotUnlockLevels;
  let count = 0;
  for (const lv of levels) {
    if (cardLevel >= lv) count++;
  }
  return Math.max(1, count);
}

// ---------------------------------------------------------------------------
// レーンのスキル解決（build.ts と同一経路: golden 優先 → マスタ）
// ---------------------------------------------------------------------------

function ownerCardIdOf(s: SkillDef): string | null {
  if (s.cardId == null || s.cardId === "") return null;
  return s.cardId.startsWith("sk-") ? `card-${s.cardId.slice(3)}` : s.cardId;
}

interface ResolvedLane {
  skills: Array<SkillDef & { fromMaster?: boolean; unsupported?: number; conditional?: string | null }>;
  photos: SkillDef[];
}

function resolveLaneSkills(lane: LaneNumber, cardId: string): ResolvedLane {
  const goldenSkills = DATA.data.skillsGolden.filter(
    (s) => s.lane === lane && (s.kind === "A" || s.kind === "SP" || s.kind === "P"),
  );
  const photos = DATA.data.skillsGolden.filter(
    (s) => s.lane === lane && s.kind === "photo" && s.effects.length > 0,
  );
  const own = goldenSkills.filter((s) => ownerCardIdOf(s) === cardId);
  if (own.length > 0) {
    return { skills: own.map((s) => ({ ...s })), photos };
  }
  const masterDefs = (DATA.data.skillsByCard as Record<string, MasterSkillDef[]> | undefined)?.[
    cardId
  ];
  if (masterDefs !== undefined) {
    return {
      skills: masterDefs.map((s) => ({
        ...s,
        lane,
        fromMaster: true,
        unsupported: s.unsupportedEffects ?? 0,
        conditional: s.conditionalNote ?? null,
      })),
      photos,
    };
  }
  return { skills: goldenSkills.map((s) => ({ ...s })), photos };
}

// ---------------------------------------------------------------------------
// 状態 ↔ 編成データ
// ---------------------------------------------------------------------------

function parseEquipment(
  json: string,
  lane: number,
  what: string,
): DeckJsonV2["characters"][number]["photos"] {
  const parsed: unknown = JSON.parse(json.trim() === "" ? "[]" : json);
  if (!Array.isArray(parsed)) {
    throw new Error(`L${lane} の ${what} は配列である必要があります`);
  }
  return parsed as never;
}

/** 現在の UI 状態 → 編成（verification_data_v2.json と同一スキーマ + grant_ 拡張キー） */
function toDeck(): DeckJsonV2 {
  const characters = state.lanes.map((l, i) => {
    const lane = (i + 1) as LaneNumber;
    // マイフォト帳装備分を structured 形式へ変換して photos にマージ
    //（grant_ キーは buildSimulateInput が隣接/センター/スコアラーへ解決する）
    const userEntries = l.photoEquip
      .map((pid) => photoById(pid))
      .filter((p): p is MyPhotoDef => p !== undefined)
      .map((p) => myPhotoToEquipEntry(p));
    // 【Phase 8-B3】スキルLv上書き（枠ロック中は含めない・全て最大Lvなら空で golden/マスタ既定に任せる）
    const card = cardOf(l.cardId);
    const skill_levels: Record<string, number> = {};
    for (const [sid, lv] of Object.entries(l.skillLevels)) {
      const slotIdx = card ? card.skillIds.indexOf(sid) : -1;
      if (slotIdx < 0 || skillSlotLocked(slotIdx, l.level)) continue;
      skill_levels[sid] = lv;
    }
    return {
      lane,
      card_id: l.cardId,
      level: l.level,
      rarity: l.rarity,
      role: l.role,
      kouryu_level: l.kouryu,
      stats: {
        base: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
        total_after_non_skill_modifiers: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
      },
      photos: [...parseEquipment(l.photosJson, lane, "フォト(JSON)"), ...userEntries],
      accessories: parseEquipment(l.accessoriesJson, lane, "アクセサリ(JSON)"),
      skill_levels: Object.keys(skill_levels).length > 0 ? skill_levels : undefined,
    };
  });
  return { staff_bonus: { ...state.staff }, yale_bonus: { ...state.yell }, characters };
}

/** 全レーンのマイフォト装備からユーザー定義フォトスキル（SkillDef・lane 設定済み）を収集 */
function collectUserPhotoSkills(): SkillDef[] {
  const out: SkillDef[] = [];
  state.lanes.forEach((l, i) => {
    l.photoEquip.forEach((pid, j) => {
      const p = photoById(pid);
      if (p === undefined) return;
      // 【Phase 8-B5】装備行の「スキル」チェックで個別無効化した分は除外
      if (l.disabledUserPhotoSkills.has(userPhotoSkillId(pid))) return;
      const def = myPhotoToSkillDef(p, (i + 1) as LaneNumber, j + 1);
      if (def !== null) out.push(def);
    });
  });
  return out;
}

function missedNotes(): Array<{ beat: number; lane: number }> {
  if (state.missedNotesText.trim() === "") return [];
  const parsed: unknown = JSON.parse(state.missedNotesText);
  if (!Array.isArray(parsed)) throw new Error("missedNotes は配列である必要があります");
  return parsed as Array<{ beat: number; lane: number }>;
}

/** メンタルの手入力上書き（null = 自動算出のレーンは含めない） */
function mentalOverride(): Record<string, number> {
  const entries: Array<[string, number]> = [];
  state.lanes.forEach((l, i) => {
    if (l.mental !== null) {
      entries.push([String(i + 1), l.mental]);
    }
  });
  return Object.fromEntries(entries);
}

/** レーンの解決済みスキルから未チェック（無効化）ID を収集 */
function collectDisabled(): string[] {
  const out: string[] = [];
  state.lanes.forEach((l, i) => {
    const lane = (i + 1) as LaneNumber;
    const resolved = resolveLaneSkills(lane, l.cardId);
    const card = cardOf(l.cardId);
    resolved.skills.forEach((s, si) => {
      // 【Phase 8-B3】カードレベル未満で解放されていないスキル枠は無効化扱い
      const slotIdx = card ? card.skillIds.indexOf(s.id) : si;
      if (skillSlotLocked(slotIdx, l.level) || !l.enabledSkillIds.has(s.id)) {
        out.push(s.id);
      }
    });
    // 【Phase 8-B5】実測/JSON フォトの装備数を超える photoIndex の golden フォトスキルは
    // 対応するフォトが装備されていないため無効（装備解除でスキルも外れる）
    let legacyCount = 0;
    try {
      legacyCount = parseEquipment(l.photosJson, lane, "フォト(JSON)").length;
    } catch {
      legacyCount = 0;
    }
    for (const s of resolved.photos) {
      if (!l.enabledPhotoIds.has(s.id)) out.push(s.id);
      else if ((s.photoIndex ?? 1) > legacyCount) out.push(s.id);
    }
    // マイフォトスキルの個別無効化（装備行のチェックボックス）
    for (const pid of l.photoEquip) {
      const p = photoById(pid);
      if (p?.skill !== null && p !== undefined && p.skill !== null) {
        const id = userPhotoSkillId(pid);
        if (l.disabledUserPhotoSkills.has(id)) out.push(id);
      }
    }
  });
  return out;
}

/** レーンカードの入力値を state へ収集 */
function collectLaneInputs(i: number): void {
  const card = document.querySelector(`.lane-card[data-lane="${i + 1}"]`);
  if (card === null) return;
  const l = state.lanes[i]!;
  const cardSel = card.querySelector('[data-act="card-id"]');
  if (cardSel !== null) {
    l.cardId = (cardSel as HTMLInputElement).value;
  }
  const levelSel = card.querySelector('[data-act="level"]');
  if (levelSel !== null) {
    l.level = Number((levelSel as HTMLSelectElement).value);
  }
  const rarity = card.querySelector('[data-act="rarity"]');
  if (rarity !== null) {
    l.rarity = Number((rarity as HTMLInputElement).value) || 1;
  }
  const kouryu = card.querySelector('[data-act="kouryu"]');
  if (kouryu !== null) {
    l.kouryu = Number((kouryu as HTMLInputElement).value) || 1;
  }
  // メンタルは空欄なら null（自動算出: 100×(1+交流Men%)+スタッフ+エール+装備）・
  // 数値入力時は任意上書き。ロールはカード固有値のため input なし
  const mental = card.querySelector('[data-act="mental"]');
  if (mental !== null) {
    const raw = (mental as HTMLInputElement).value.trim();
    l.mental = raw === "" ? null : Math.max(0, Math.round(Number(raw) || 0));
  }
  const bond = card.querySelector('[data-act="bond"]') as HTMLInputElement | null;
  if (bond !== null) {
    l.bondAwake = bond.checked;
  }
  const photos = card.querySelector('[data-act="photos-json"]');
  if (photos !== null) {
    l.photosJson = (photos as HTMLTextAreaElement).value;
  }
  // アクセサリはスロット UI 経由で state を直接更新するため入力収集は不要（Phase 8）
  // 【Phase 8-B3】スキルLvセレクトの収集（state へ記録・build の skill_levels になる）
  card.querySelectorAll<HTMLSelectElement>("select[data-skill-lv]").forEach((sel) => {
    const sid = sel.getAttribute("data-skill-lv")!;
    l.skillLevels[sid] = Math.max(1, Math.min(6, Number(sel.value) || 1));
  });
  const checks = [...card.querySelectorAll<HTMLInputElement>("input[data-skill]")];
  if (checks.length > 0) {
    l.enabledSkillIds = new Set(
      checks
        .filter((el) => el.checked && !el.dataset.skill!.startsWith("photo-"))
        .map((el) => el.dataset.skill!),
    );
    l.enabledPhotoIds = new Set(
      checks
        .filter((el) => el.checked && el.dataset.skill!.startsWith("photo-"))
        .map((el) => el.dataset.skill!),
    );
  }
}

function collectAllLaneInputs(): void {
  state.lanes.forEach((_, i) => collectLaneInputs(i));
}

// ---------------------------------------------------------------------------
// モーダル共通
// ---------------------------------------------------------------------------

function openModal(html: string): void {
  const modal = $("#modal");
  $("#modal-box").innerHTML = html;
  modal.hidden = false;
  modal.querySelector("[data-close]")?.addEventListener("click", closeModal);
}

function closeModal(): void {
  const modal = $("#modal");
  modal.hidden = true;
  $("#modal-box").innerHTML = "";
}

// ---------------------------------------------------------------------------
// マイフォト帳（Phase 8-B: タグ付きフォトインベントリ・LocalStorage）
// ---------------------------------------------------------------------------

const LS_PHOTOS_KEY = "aipura-sim-myphotos-v1";

function saveMyPhotos(photos: MyPhotoDef[]): void {
  try {
    localStorage.setItem(LS_PHOTOS_KEY, JSON.stringify(photos));
  } catch {
    // localStorage 利用不可の環境では無視
  }
}

/**
 * T5 実測フォトのテンプレート化（data.skillsGolden の photo スキル × sampleDeck の
 * 実測 structured 値）。実測較正済み（T5 ゴールデン）の構成をそのまま再利用できる。
 * レタッチ有無は実測からは不明のため retouch: false（制限対象外・【Estimate】）。
 */
function buildT5PhotoTemplates(): MyPhotoDef[] {
  const out: MyPhotoDef[] = [];
  for (let lane = 1; lane <= 5; lane++) {
    // 実測 JSON は actual_title / kind などの拡張フィールドを持つ（UI 型は name/structured のみ）
    const deckPhotos =
      (DATA.sampleDeck.characters[lane - 1]?.photos ?? []) as Array<
        DeckJsonV2["characters"][number]["photos"][number] & { actual_title?: string | null; kind?: string }
      >;
    // スキルなしフォト（effects 空の実測 4 枚: photo-L1-4・L3-1/3/4）もテンプレート化する
    //（実測プリセット復元時に 4 枚/レーンを再現するため）
    const golden = DATA.data.skillsGolden
      .filter((s) => s.lane === lane && s.kind === "photo")
      .sort((a, b) => (a.photoIndex ?? 0) - (b.photoIndex ?? 0));
    for (const g of golden) {
      const deckPhoto =
        deckPhotos.find((p) => p.actual_title != null && p.actual_title === g.name) ??
        deckPhotos[g.photoIndex != null ? g.photoIndex - 1 : -1];
      const frames: PhotoFrame[] = (deckPhoto?.structured ?? [])
        .slice(0, 5)
        .map((s) => ({ kind: "self" as const, stat: s.stat, type: s.type, value: s.value }));
      const e0 = g.effects[0];
      const skill: PhotoSkillDef | null =
        e0 === undefined
          ? null
          : {
              type: e0.type as EffectType,
              ...(e0.powerPermil !== undefined ? { powerPermil: e0.powerPermil } : {}),
              ...(e0.stages !== undefined ? { stages: e0.stages } : {}),
              ...(e0.value !== undefined ? { value: e0.value } : {}),
              durationBeats: e0.durationBeats ?? null,
              target: e0.target,
              condition: e0.condition,
              ct: g.ct,
              staminaCost: g.staminaCost,
              limitPerLive: g.limitPerLive ?? null,
            };
      out.push({
        id: `tpl-t5-${g.id}`,
        name: g.name ?? deckPhoto?.name ?? `T5 L${lane} スロット${g.photoIndex ?? "?"}`,
        kindLabel: "メモリアル",
        tags: ["テンプレート", "T5実測", `L${lane}`],
        retouch: false,
        skill,
        frames,
      });
    }
  }
  return out;
}

function loadMyPhotos(): MyPhotoDef[] {
  try {
    const raw = localStorage.getItem(LS_PHOTOS_KEY);
    if (raw !== null) {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const loaded = (arr as MyPhotoDef[]).filter((p) => p && typeof p.id === "string");
        // 【Phase 8-B7】同梱テンプレートの定義更新を既存帳に反映（レタッチ誤登録の訂正等）。
        // ユーザーが数値を編集した可能性があるため value 系は触らずフラグのみ上書きする
        const templateDefs = [...buildT5PhotoTemplates(), ...defaultPhotoTemplates()];
        let migrated = false;
        for (const def of templateDefs) {
          const stored = loaded.find((p) => p.id === def.id);
          if (stored !== undefined && stored.retouch !== def.retouch) {
            stored.retouch = def.retouch;
            migrated = true;
          }
        }
        if (migrated) saveMyPhotos(loaded);
        return loaded;
      }
    }
  } catch {
    // 破損時は初期化し直す
  }
  const seeded = [...buildT5PhotoTemplates(), ...defaultPhotoTemplates()];
  saveMyPhotos(seeded);
  return seeded;
}

let myPhotos: MyPhotoDef[] = [];

function photoById(id: string): MyPhotoDef | undefined {
  return myPhotos.find((p) => p.id === id);
}

/** タグ一覧（帳の絞り込みチップ用・出現順） */
function allPhotoTags(): string[] {
  const tags: string[] = [];
  for (const p of myPhotos) {
    for (const t of p.tags) {
      if (!tags.includes(t)) tags.push(t);
    }
  }
  return tags;
}

// ---------------------------------------------------------------------------
// フォト設定モーダル（5スロット入力フォーム・JSON 不要）
// ---------------------------------------------------------------------------

/** フォトスキル種別の選択肢（効果カテゴリで入力欄が変わる） */
const PHOTO_SKILL_TYPES: Array<{ type: EffectType; label: string }> = [
  { type: "vocal_up", label: "Vo上昇" },
  { type: "vocal_boost", label: "Voブースト" },
  { type: "vocal_up_extreme", label: "Vo超化" },
  { type: "dance_up", label: "Da上昇" },
  { type: "dance_boost", label: "Daブースト" },
  { type: "visual_up", label: "Vi上昇" },
  { type: "visual_boost", label: "Viブースト" },
  { type: "beat_score_up", label: "ビートスコア上昇" },
  { type: "score_up", label: "スコア上昇" },
  { type: "a_skill_score_up", label: "Aスコア上昇" },
  { type: "sp_skill_score_up", label: "SPスコア上昇" },
  { type: "p_skill_score_up", label: "Pスコア上昇" },
  { type: "combo_score_up", label: "コンボスコア上昇" },
  { type: "critical_coeff_up", label: "クリティカル係数上昇" },
  { type: "critical_rate_up", label: "クリティカル率上昇" },
  { type: "tension_up", label: "テンション上昇" },
  { type: "skill_success_up", label: "スキル成功率上昇" },
  { type: "score_get", label: "スコア獲得（%値）" },
  { type: "ct_reduction", label: "CT短縮（即時値）" },
  { type: "effect_extension", label: "強化効果延長（対象へ/レタッチ）" },
  { type: "effect_amplify", label: "強化効果増強（対象へ/レタッチ）" },
  { type: "stamina_recovery", label: "スタミナ回復（即時値）" },
];

const PHOTO_SKILL_TARGETS: Array<{ v: string; label: string }> = [
  { v: "self", label: "自身" },
  { v: "score_type_1", label: "スコアラー1人" },
  { v: "score_type_2", label: "スコアラー2人" },
  { v: "neighbors", label: "隣接レーン" },
  { v: "center", label: "センター" },
  { v: "all", label: "全員" },
  { v: "vocal_type_1", label: "ボーカルタイプ1人" },
  { v: "vocal_type_3", label: "ボーカルタイプ3人" },
  { v: "dance_type_1", label: "ダンスタイプ1人" },
  { v: "visual_type_1", label: "ビジュアルタイプ1人" },
  // 条件付きスキルの「条件を満たした対象」（例: 明るく君を照らしたい = 集目状態の1人へ延長）
  { v: "trigger", label: "条件を満たした対象（誰かが集目状態の時・その人 等）" },
];

/**
 * 【Phase 8-B4】延長/増強レタッチの絞り込みバフ（与・クリティカル率延長 等）。
 * 段階型バフ（BuffKey）のみが延長/増強の対象。
 */
const BUFF_KEY_OPTIONS: Array<{ v: string; label: string }> = [
  { v: "vocal_up", label: "Vo上昇" },
  { v: "vocal_boost", label: "Voブースト" },
  { v: "vocal_up_extreme", label: "Vo超化" },
  { v: "dance_up", label: "Da上昇" },
  { v: "dance_boost", label: "Daブースト" },
  { v: "visual_up", label: "Vi上昇" },
  { v: "visual_boost", label: "Viブースト" },
  { v: "beat_score_up", label: "ビートスコア上昇" },
  { v: "score_up", label: "スコア上昇" },
  { v: "a_skill_score_up", label: "Aスコア上昇" },
  { v: "sp_skill_score_up", label: "SPスコア上昇" },
  { v: "p_skill_score_up", label: "Pスコア上昇" },
  { v: "combo_score_up", label: "コンボスコア上昇" },
  { v: "critical_coeff_up", label: "クリティカル係数上昇" },
  { v: "critical_rate_up", label: "クリティカル率上昇" },
  { v: "tension_up", label: "テンション上昇" },
  { v: "skill_success_up", label: "スキル成功率上昇" },
  { v: "stamina_cost_down", label: "消費スタミナ低下" },
  { v: "focus", label: "集目" },
];

/**
 * 延長/増強の範囲。null = スコープ指定なし（対象セレクトの対象にいる効果を
 * 延長/増強する通常フォトスキル・T5 の「びっくりした?」等）。
 * given = 自分が与えたバフ（与・○○延長レタッチ）、received = 自分が受けているバフ
 * （被・○○延長レタッチ）。レタッチの 与/被 はスコープ指定がある場合のみ。
 */
const SCOPE_OPTIONS: Array<{ v: string; label: string }> = [
  { v: "", label: "指定なし（対象セレクトの対象を延長/増強）" },
  { v: "received", label: "被（自分が受けているバフを延長/増強・レタッチ）" },
  { v: "given", label: "与（自分が与えたバフを延長/増強・レタッチ）" },
];

/**
 * フォトスキルの発動条件（マスタ SkillTrigger / 実データの sk-phot-* から抽出・Phase 8-B2）。
 * 【Estimate】タグ付きは engine が文脈を評価できないため常時発動近似。
 */
const PHOTO_SKILL_CONDITIONS: Array<{ v: string; label: string }> = [
  { v: "none", label: "条件なし" },
  { v: "combo>=50", label: "50コンボ以上時" },
  { v: "combo>=70", label: "70コンボ以上時" },
  { v: "combo>=80", label: "80コンボ以上時" },
  { v: "combo>=90", label: "90コンボ以上時" },
  { v: "combo>=100", label: "100コンボ以上時" },
  { v: "combo<=50", label: "50コンボ以下時" },
  { v: "combo<=80", label: "80コンボ以下時" },
  { v: "beat_chance=10", label: "ビート時、10%の確率で" },
  { v: "self_vocal_lane", label: "自分がボーカルレーン" },
  { v: "self_dance_lane", label: "自分がダンスレーン" },
  { v: "self_visual_lane", label: "自分がビジュアルレーン" },
  { v: "self_center", label: "自分がセンター" },
  { v: "self_most_left", label: "自分が左端" },
  { v: "self_most_right", label: "自分が右端" },
  { v: "status_vocal_up", label: "自分がボーカル上昇状態" },
  { v: "status_dance_up", label: "自分がダンス上昇状態" },
  { v: "status_visual_up", label: "自分がビジュアル上昇状態" },
  { v: "status_vocal_boost", label: "自分がボーカルブースト状態" },
  { v: "status_dance_boost", label: "自分がダンスブースト状態" },
  { v: "status_visual_boost", label: "自分がビジュアルブースト状態" },
  { v: "status_beat_score_up", label: "自分がビートスコア上昇状態" },
  { v: "status_score_up", label: "自分がスコア上昇状態" },
  { v: "status_a_skill_score_up", label: "自分がAスキルスコア上昇状態" },
  { v: "status_sp_skill_score_up", label: "自分がSPスコア上昇状態" },
  { v: "status_combo_score_up", label: "自分がコンボスコア上昇状態" },
  { v: "status_critical_coeff_up", label: "自分がクリティカル係数上昇状態" },
  { v: "status_critical_rate_up", label: "自分がクリティカル率上昇状態" },
  { v: "status_tension_up", label: "自分がテンション上昇状態" },
  { v: "status_skill_success_up", label: "自分がスキル成功率上昇状態" },
  { v: "status_stamina_cost_down", label: "自分が消費スタミナ低下状態" },
  { v: "status_focus", label: "自分が集目状態" },
  { v: "status_stealth", label: "自分がステルス状態" },
  { v: "someone_vocal_up", label: "誰かがボーカル上昇状態" },
  { v: "someone_dance_up", label: "誰かがダンス上昇状態" },
  { v: "someone_visual_up", label: "誰かがビジュアル上昇状態" },
  { v: "someone_vocal_boost", label: "誰かがボーカルブースト状態" },
  { v: "someone_dance_boost", label: "誰かがダンスブースト状態" },
  { v: "someone_visual_boost", label: "誰かがビジュアルブースト状態" },
  { v: "someone_beat_score_up", label: "誰かがビートスコア上昇状態" },
  { v: "someone_score_up", label: "誰かがスコア上昇状態" },
  { v: "someone_a_skill_score_up", label: "誰かがAスコア上昇状態" },
  { v: "someone_sp_skill_score_up", label: "誰かがSPスコア上昇状態" },
  { v: "someone_p_skill_score_up", label: "誰かがPスコア上昇状態" },
  { v: "someone_combo_score_up", label: "誰かがコンボスコア上昇状態" },
  { v: "someone_critical_coeff_up", label: "誰かがクリティカル係数上昇状態" },
  { v: "someone_critical_rate_up", label: "誰かがクリティカル率上昇状態" },
  { v: "someone_tension_up", label: "誰かがテンション上昇状態" },
  { v: "someone_skill_success_up", label: "誰かがスキル成功率上昇状態" },
  { v: "someone_stamina_cost_down", label: "誰かが消費スタミナ低下状態" },
  { v: "someone_focus", label: "誰かが集目状態" },
  { v: "someone_stealth", label: "誰かがステルス状態" },
  { v: "someone_recovered", label: "誰かがスタミナ回復を受けた時" },
  { v: "someone_stamina<=30", label: "誰かがスタミナ30%以下" },
  { v: "someone_stamina<=50", label: "誰かがスタミナ50%以下" },
  { v: "someone_stamina<=70", label: "誰かがスタミナ70%以下" },
  { v: "stamina>=30", label: "自分のスタミナ30%以上" },
  { v: "stamina>=50", label: "自分のスタミナ50%以上" },
  { v: "stamina>=60", label: "自分のスタミナ60%以上" },
  { v: "stamina>=80", label: "自分のスタミナ80%以上" },
  { v: "stamina<=30", label: "自分のスタミナ30%以下" },
  { v: "stamina<=50", label: "自分のスタミナ50%以下" },
  { v: "stamina<=60", label: "自分のスタミナ60%以下" },
  { v: "stamina<=70", label: "自分のスタミナ70%以下" },
  { v: "stamina<=80", label: "自分のスタミナ80%以下" },
  { v: "count_liz>=1", label: "編成にLizNoir 1人以上" },
  { v: "count_moon>=1", label: "編成に月のテンペスト1人以上" },
  { v: "count_sun>=1", label: "編成にSUNNY PEACE 1人以上" },
  { v: "count_pajm>=1", label: "編成にパジャマパーティ1人以上" },
  { v: "count_leader>=1", label: "編成に各ユニットリーダー1人以上" },
  { v: "count_tri>=1", label: "編成にTRINITYAiLE 1人以上" },
  { v: "count_thrx>=1", label: "編成に3RX 1人以上" },
  { v: "music_limited", label: "楽曲限定（常時発動近似）" },
  { v: "critical_timing", label: "クリティカル発動時（常時発動近似）" },
  { v: "someone_before_special", label: "誰かがSPスキル発動前（常時発動近似）" },
  { v: "fan_engage_higher", label: "集目段数条件（常時発動近似）" },
  { v: "mood_type", label: "テンションタイプ条件（常時発動近似）" },
];

const PHOTO_KIND_LABELS = ["イメトレ", "メモリアル", "プレミアム", "レタッチ", "その他"];

const FRAME_KIND_OPTIONS: Array<{ v: PhotoFrameKind; label: string }> = [
  { v: "self", label: "自己ステ" },
  { v: "grant_neighbors", label: "隣接付与" },
  { v: "grant_center", label: "センター付与" },
  { v: "grant_scorer", label: "スコアラー付与" },
];

const FRAME_STAT_OPTIONS: Array<{ v: string; label: string }> = [
  { v: "vocal", label: "Vo" },
  { v: "dance", label: "Da" },
  { v: "visual", label: "Vi" },
  { v: "stamina", label: "Sta" },
  { v: "mental", label: "Men" },
  { v: "critical", label: "Cri" },
  { v: "beat_score", label: "ビートスコア" },
  { v: "a_score", label: "Aスコア" },
  { v: "sp_score", label: "SPスコア" },
  { v: "critical_score", label: "クリスコ" },
  { v: "p_score", label: "Pスコア" },
];

/** フォトエディタの作業ドラフト（モーダル表示中のみ有効） */
let photoDraft: MyPhotoDef | null = null;
/** 保存後に装備するレーン（null = 帳に保存するのみ） */
let photoDraftEquipLane: number | null = null;

function newPhotoDraft(): MyPhotoDef {
  return {
    id: `uph-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: "",
    kindLabel: "イメトレ",
    tags: ["手持ち"],
    retouch: false,
    skill: null,
    frames: [],
  };
}

/** 枠行（自己ステ/付与）の HTML */
function photoFrameRowHtml(r: number, f: PhotoFrame | undefined, skillLocked: boolean): string {
  const kind = f?.kind ?? "self";
  const stat = f?.stat ?? "vocal";
  const type = f?.type ?? "pct";
  const value = f?.value ?? 0;
  const isGrant = kind !== "self";
  const statOpts = FRAME_STAT_OPTIONS.map(
    (o) => `<option value="${o.v}"${o.v === stat ? " selected" : ""}>${o.label}</option>`,
  ).join("");
  const disabledAttr = skillLocked && r === 4 ? " disabled" : "";
  const lockNote = skillLocked && r === 4 ? `<span class="dim">（スキル持ちのため使用不可）</span>` : "";
  return `<div class="photo-frame"${disabledAttr} data-frame-row="${r}">
    <span class="photo-frame-no">枠${r + 2}</span>
    <select data-pf="kind"${disabledAttr}>${FRAME_KIND_OPTIONS.map(
      (o) => `<option value="${o.v}"${o.v === kind ? " selected" : ""}>${o.label}</option>`,
    ).join("")}</select>
    <select data-pf="stat"${disabledAttr}>${statOpts}</select>
    ${isGrant
      ? `<span class="chip">%</span>`
      : `<select data-pf="type"${disabledAttr}>
          <option value="pct"${type === "pct" ? " selected" : ""}>%</option>
          <option value="fixed"${type === "fixed" ? " selected" : ""}>固定値</option>
        </select>`}
    <input type="number" data-pf="value" step="any" value="${value}"${disabledAttr} placeholder="+0">
    <button class="mini-btn" data-pf-del="${r}" title="この枠を空にする"${disabledAttr}>✕</button>
    ${lockNote}
  </div>`;
}

function photoSkillHtml(s: PhotoSkillDef): string {
  const scoreLike = s.type === "score_get" || s.type === "score_get_by_score_ratio";
  const instant =
    s.type === "ct_reduction" ||
    s.type === "effect_extension" ||
    s.type === "effect_amplify" ||
    s.type === "stamina_recovery";
  // 延長/増強は 対象セレクト＋スコープ（指定なし/与/被）と絞り込みバフを選べる（Phase 8-B5）。
  // スコープ指定なし = 純粋な対象指定フォトスキル（T5 の「びっくりした?」等）、
  // 与/被 = レタッチ系。対象が trigger の場合は条件成立者への作用になる。
  const extAmplify = s.type === "effect_extension" || s.type === "effect_amplify";
  const scopeSel = extAmplify
    ? `<label class="inline">範囲</label><select data-ps="scope">${SCOPE_OPTIONS.map(
        (o) => `<option value="${o.v}"${(s.scope ?? "") === o.v ? " selected" : ""}>${o.label}</option>`,
      ).join("")}</select>
      <select data-ps="buffkey"><option value="">（バフ指定なし=全バフ）</option>${BUFF_KEY_OPTIONS.map(
        (o) => `<option value="${o.v}"${s.buffKey === o.v ? " selected" : ""}>${o.label}</option>`,
      ).join("")}</select>`
    : "";
  return `
    <div class="photo-frame">
      <span class="photo-frame-no">枠1</span>
      <select data-ps="type">${PHOTO_SKILL_TYPES.map(
        (o) => `<option value="${o.type}"${o.type === s.type ? " selected" : ""}>${o.label}</option>`,
      ).join("")}</select>
      ${scoreLike
        ? `<label class="inline">効果値%</label><input type="number" data-ps="power-pct" step="any" value="${(s.powerPermil ?? 0) / 10}">`
        : instant
          ? `<label class="inline">値</label><input type="number" data-ps="value" step="any" value="${s.value ?? 0}">${scopeSel}`
          : `<label class="inline">段数</label><input type="number" data-ps="stages" step="1" value="${s.stages ?? 0}">
             <label class="inline">持続ビート</label><input type="number" data-ps="dur" step="1" value="${s.durationBeats ?? ""}" placeholder="—">`}
      <select data-ps="target">${PHOTO_SKILL_TARGETS.map(
        (o) => `<option value="${o.v}"${o.v === s.target ? " selected" : ""}>${o.label}</option>`,
      ).join("")}</select>
    </div>
    <div class="photo-frame photo-frame-sub">
      <span class="photo-frame-no">条件</span>
      <select data-ps="condition">${PHOTO_SKILL_CONDITIONS.map(
        (o) => `<option value="${o.v}"${o.v === s.condition ? " selected" : ""}>${o.label}</option>`,
      ).join("")}</select>
      <label class="inline">CT（空欄=管理なし）</label><input type="number" data-ps="ct" step="1" value="${s.ct ?? ""}">
      <label class="inline">消費スタミナ（空欄=なし）</label><input type="number" data-ps="cost" step="1" value="${s.staminaCost ?? ""}">
      <label class="inline"><input type="checkbox" data-ps="limit"${(s.limitPerLive ?? 0) > 0 ? " checked" : ""}> ライブ中1回のみ</label>
      <button class="mini-btn" data-ps-remove title="スキルを外してステータス5枠のフォトに戻す（押し間違いの取り消し）">↩ スキルなしに戻す</button>
    </div>`;
}

function renderPhotoEditor(): void {
  const d = photoDraft;
  if (d === null) return;
  const limit = statFrameLimit(d);
  const skillLocked = d.skill !== null;
  const frameRows: string[] = [];
  // 枠1: スキル or ステータス枠
  if (skillLocked) {
    frameRows.push(photoSkillHtml(d.skill!));
  } else {
    frameRows.push(`<div class="photo-frame" data-frame-row="-1">
      <span class="photo-frame-no">枠1</span>
      <button class="btn-like" data-ps-add>＋ スキル持ちにする（ステータス枠が4枠に減少）</button>
    </div>`);
  }
  // 枠2-5 = frames[0..3]（スキルあり）/ frames[0..4]（スキルなし・枠1 に frames[0] を表示）
  for (let r = 0; r < 4; r++) {
    const f = d.frames[r];
    frameRows.push(photoFrameRowHtml(r, f, skillLocked));
  }
  if (!skillLocked) {
    const f5 = d.frames[4];
    frameRows.push(
      `<div class="photo-frame-slot5">
        <span class="photo-frame-no">枠5</span>
        ${f5 === undefined
          ? `<button class="btn-like" data-pf-add4>＋ 枠5に効果を追加</button>`
          : photoFrameRowHtml(4, f5, false)}
      </div>`,
    );
  }
  const errors = validateMyPhoto(d);
  openModal(`
    <div class="modal-head"><h3>フォト設定（5スロット入力）</h3><button data-close>閉じる</button></div>
    <div class="photo-editor">
      <div class="photo-frame">
        <label class="inline">フォト名</label><input type="text" data-p="name" value="${esc(d.name)}" placeholder="例: 琴乃用イメトレVo特化">
        <label class="inline">種別</label><select data-p="kindLabel">${PHOTO_KIND_LABELS.map(
          (k) => `<option value="${k}"${k === d.kindLabel ? " selected" : ""}>${k}</option>`,
        ).join("")}</select>
        <label class="inline"><input type="checkbox" data-p="retouch"${d.retouch ? " checked" : ""}> レタッチ（1人1枚制限の対象）</label>
      </div>
      <div class="photo-frame">
        <label class="inline">タグ（カンマ区切り）</label>
        <input type="text" data-p="tags" value="${esc(d.tags.join(","))}" placeholder="手持ち, Vo特化, 琴乃用">
      </div>
      ${frameRows.join("")}
      ${errors.length > 0 ? `<div class="note error-note">${errors.map(esc).join("<br>")}</div>` : ""}
      <div class="note">※ 枠1をスキルにするとステータス枠は4枠になります（ゲーム内仕様: 第1枠がスキルで占有）。
      ※ 隣接/センター/スコアラー付与は対象レーンの装備と同一の加算プールに入ります
      （Peing id=1187940162・隣接 = 左右1レーンずつ、センター = L3、スコアラー = role Scorer のレーン）。</div>
    </div>
    <div class="actions">
      <button class="primary" data-photo-save="save">マイフォト帳に保存</button>
      ${photoDraftEquipLane !== null ? `<button class="primary" data-photo-save="equip">保存してこのレーンに装備</button>` : ""}
    </div>`);
  bindPhotoEditorEvents();
}

/** フォトエディタ内の入力（ドラフト更新のみ・再描画しない） */
function bindPhotoEditorEvents(): void {
  const box = $("#modal-box");
  // モーダルは #config-root の外側にあるため保存ボタンはここで直接束ねる
  box.querySelectorAll<HTMLButtonElement>("[data-photo-save]").forEach((btn) =>
    btn.addEventListener("click", () =>
      savePhotoDraft(btn.getAttribute("data-photo-save") === "equip"),
    ),
  );
  box.querySelectorAll<HTMLInputElement>('[data-p="name"]').forEach((el) =>
    el.addEventListener("input", () => {
      if (photoDraft) photoDraft.name = el.value;
    }),
  );
  box.querySelectorAll<HTMLInputElement>('[data-p="tags"]').forEach((el) =>
    el.addEventListener("input", () => {
      if (photoDraft)
        photoDraft.tags = el.value
          .split(/[,、，]/)
          .map((t) => t.trim())
          .filter((t) => t !== "");
    }),
  );
  box.querySelectorAll<HTMLInputElement>('[data-p="retouch"]').forEach((el) =>
    el.addEventListener("change", () => {
      if (photoDraft) photoDraft.retouch = el.checked;
    }),
  );
  box.querySelectorAll<HTMLSelectElement>('[data-p="kindLabel"]').forEach((el) =>
    el.addEventListener("change", () => {
      if (photoDraft) photoDraft.kindLabel = el.value;
    }),
  );
  // 枠入力（枠の位置は DOM 構造から解決する）
  box.querySelectorAll<HTMLElement>("[data-frame-row]").forEach((row) => {
    const rowAttr = row.getAttribute("data-frame-row");
    if (rowAttr === null) return;
    const rowIdx = Number(rowAttr); // -1 = 枠1（スキルなし時のステ枠）, 0-4 = frames index
    const frameIdxOf = (): number => (rowIdx === -1 ? 0 : rowIdx);
    const upd = (patch: Partial<PhotoFrame>): void => {
      if (!photoDraft) return;
      const i = frameIdxOf();
      const cur: PhotoFrame = photoDraft.frames[i] ?? { kind: "self", stat: "vocal", type: "pct", value: 0 };
      photoDraft.frames[i] = { ...cur, ...patch };
    };
    const kindSel = row.querySelector<HTMLSelectElement>('[data-pf="kind"]');
    kindSel?.addEventListener("change", () => {
      upd({ kind: (kindSel.value as PhotoFrameKind) ?? "self" });
      renderPhotoEditor();
    });
    const statSel = row.querySelector<HTMLSelectElement>('[data-pf="stat"]');
    statSel?.addEventListener("change", () => upd({ stat: statSel.value }));
    const typeSel = row.querySelector<HTMLSelectElement>('[data-pf="type"]');
    typeSel?.addEventListener("change", () => upd({ type: (typeSel.value as "pct" | "fixed") ?? "pct" }));
    const valueInput = row.querySelector<HTMLInputElement>('[data-pf="value"]');
    valueInput?.addEventListener("input", () => upd({ value: Number(valueInput.value) || 0 }));
  });
  box.querySelectorAll<HTMLButtonElement>("[data-pf-del]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (!photoDraft) return;
      const r = Number(btn.getAttribute("data-pf-del"));
      photoDraft.frames.splice(r === -1 ? 0 : r, 1);
      renderPhotoEditor();
    }),
  );
  const add4 = box.querySelector("[data-pf-add4]");
  add4?.addEventListener("click", () => {
    if (!photoDraft) return;
    while (photoDraft.frames.length < 5) photoDraft.frames.push({ kind: "self", stat: "vocal", type: "pct", value: 0 });
    renderPhotoEditor();
  });
  const psAdd = box.querySelector("[data-ps-add]");
  psAdd?.addEventListener("click", () => {
    if (!photoDraft) return;
    // スキル持ちにする: 枠5（frames[4]）は自動で空にする（ステ枠4の過剰盛り防止）
    if (photoDraft.frames.length > 4) {
      photoDraft.frames = photoDraft.frames.slice(0, 4);
    }
    photoDraft.skill = {
      type: "vocal_boost",
      stages: 4,
      durationBeats: 28,
      target: "vocal_type_1",
      condition: "none",
      ct: 60,
      staminaCost: 1795,
      limitPerLive: null,
    };
    renderPhotoEditor();
  });
  // 【Phase 8-B7】スキルなしに戻す（スキル持ちにする の取り消し・枠5を復活）
  const psRemove = box.querySelector("[data-ps-remove]");
  psRemove?.addEventListener("click", () => {
    if (!photoDraft) return;
    photoDraft.skill = null;
    while (photoDraft.frames.length < 5) {
      photoDraft.frames.push({ kind: "self", stat: "vocal", type: "pct", value: 0 });
    }
    renderPhotoEditor();
  });
  // スキル入力
  const skillType = box.querySelector<HTMLSelectElement>('[data-ps="type"]');
  skillType?.addEventListener("change", () => {
    if (!photoDraft || !photoDraft.skill) return;
    photoDraft.skill.type = skillType.value as EffectType;
    renderPhotoEditor();
  });
  const skillNum = (sel: string, apply: (v: number, raw: string) => void): void => {
    box.querySelectorAll<HTMLInputElement>(sel).forEach((el) =>
      el.addEventListener("input", () => {
        if (!photoDraft || !photoDraft.skill) return;
        const raw = el.value.trim();
        apply(raw === "" ? NaN : Number(raw), raw);
      }),
    );
  };
  skillNum('[data-ps="power-pct"]', (v) => {
    if (photoDraft?.skill) photoDraft.skill.powerPermil = Number.isNaN(v) ? 0 : Math.round(v * 10);
  });
  skillNum('[data-ps="value"]', (v) => {
    if (photoDraft?.skill) photoDraft.skill.value = Number.isNaN(v) ? 0 : v;
  });
  skillNum('[data-ps="stages"]', (v) => {
    if (photoDraft?.skill) photoDraft.skill.stages = Number.isNaN(v) ? 0 : Math.round(v);
  });
  skillNum('[data-ps="dur"]', (v, raw) => {
    if (photoDraft?.skill) photoDraft.skill.durationBeats = raw === "" || Number.isNaN(v) ? null : Math.round(v);
  });
  const skillSel = (sel: string, apply: (v: string) => void): void => {
    box.querySelectorAll<HTMLSelectElement>(sel).forEach((el) =>
      el.addEventListener("change", () => {
        if (!photoDraft || !photoDraft.skill) return;
        apply(el.value);
      }),
    );
  };
  skillSel('[data-ps="target"]', (v) => {
    if (photoDraft?.skill) photoDraft.skill.target = v as PhotoSkillDef["target"];
  });
  skillSel('[data-ps="condition"]', (v) => {
    if (photoDraft?.skill) photoDraft.skill.condition = v as PhotoSkillDef["condition"];
  });
  // スコープ（指定なし=純粋な対象指定・与/被=レタッチ）・絞り込みバフ（Phase 8-B4/B5）
  skillSel('[data-ps="scope"]', (v) => {
    if (photoDraft?.skill)
      photoDraft.skill.scope =
        v === "given" ? "given" : v === "received" ? "received" : null;
  });
  skillSel('[data-ps="buffkey"]', (v) => {
    if (photoDraft?.skill) photoDraft.skill.buffKey = v === "" ? null : v;
  });
  skillNum('[data-ps="ct"]', (_v, raw) => {
    if (photoDraft?.skill) photoDraft.skill.ct = raw === "" ? null : Math.round(Number(raw));
  });
  skillNum('[data-ps="cost"]', (_v, raw) => {
    if (photoDraft?.skill) photoDraft.skill.staminaCost = raw === "" ? null : Math.round(Number(raw));
  });
  box.querySelectorAll<HTMLInputElement>('[data-ps="limit"]').forEach((el) =>
    el.addEventListener("change", () => {
      if (!photoDraft || !photoDraft.skill) return;
      photoDraft.skill.limitPerLive = el.checked ? 1 : null;
    }),
  );
}

/** フォトの保存（帳へ）と装備（レーンへ）。エラーは status 行へ出す */
function savePhotoDraft(equip: boolean): void {
  const d = photoDraft;
  if (d === null) return;
  const errors = validateMyPhoto(d);
  if (errors.length > 0) {
    setStatus(`フォトを保存できません: ${errors.join(" / ")}`, true);
    return;
  }
  if (!myPhotos.some((p) => p.id === d.id)) {
    myPhotos.push(d);
  } else {
    const idx = myPhotos.findIndex((p) => p.id === d.id);
    myPhotos[idx] = d;
  }
  saveMyPhotos(myPhotos);
  setStatus(`マイフォト帳に保存しました: ${d.name || "(無題)"}`);
  if (equip && photoDraftEquipLane !== null) {
    const laneIdx = photoDraftEquipLane;
    const conflicts = validatePhotoEquip(
      state.lanes[laneIdx]!.photoEquip
        .map((pid) => photoById(pid))
        .filter((p): p is MyPhotoDef => p !== undefined),
      d,
    );
    // 【Phase 8-B3】フォト枠数上限
    const l0 = state.lanes[laneIdx]!;
    const legacyCount0 = (() => {
      try {
        return parseEquipment(l0.photosJson, laneIdx + 1, "フォト(JSON)").length;
      } catch {
        return 0;
      }
    })();
    if (legacyCount0 + l0.photoEquip.length >= photoSlotLimitOf(l0.level)) {
      conflicts.push(
        `フォト枠が上限です（カードLv${l0.level} では ${photoSlotLimitOf(l0.level)} 枚まで）`,
      );
    }
    if (conflicts.length > 0) {
      setStatus(`装備できません: ${conflicts.join(" / ")}`, true);
      return;
    }
    // 【Phase 8-B5】同じフォトは1編成に1枚まで: 他レーンに装備中なら付け替え（奪う）
    const stolenFrom: number[] = [];
    state.lanes.forEach((l, i) => {
      if (i !== laneIdx && l.photoEquip.includes(d.id)) {
        l.photoEquip = l.photoEquip.filter((pid) => pid !== d.id);
        stolenFrom.push(i + 1);
        renderLaneCard(i);
      }
    });
    state.lanes[laneIdx]!.photoEquip.push(d.id);
    renderLaneCard(laneIdx);
    setStatus(
      stolenFrom.length > 0
        ? `L${laneIdx + 1} に付け替え: ${d.name || "(無題)"}（L${stolenFrom.join("/L")} から装備を移動）`
        : `L${laneIdx + 1} に装備: ${d.name || "(無題)"}`,
    );
  }
  photoDraft = null;
  photoDraftEquipLane = null;
  closeModal();
}

function openPhotoEditor(laneIdx: number | null, photoId: string | null): void {
  photoDraftEquipLane = laneIdx;
  if (photoId !== null) {
    const src = photoById(photoId);
    photoDraft = src !== undefined ? JSON.parse(JSON.stringify(src)) as MyPhotoDef : null;
  } else {
    photoDraft = newPhotoDraft();
  }
  if (photoDraft === null) {
    setStatus(`フォトが見つかりません: ${photoId}`, true);
    return;
  }
  renderPhotoEditor();
}

// ---------------------------------------------------------------------------
// マイフォト帳ピッカー（タグ絞り込み・装備/編集/削除）
// ---------------------------------------------------------------------------

/** 帳ピッカーの選択状態（モーダル表示中のみ有効・再描画で保持） */
let albumSelection: Set<string> = new Set();

function openPhotoAlbum(laneIdx: number): void {
  albumSelection = new Set();
  openModal(`
    <div class="modal-head"><h3>マイフォト帳（${myPhotos.length}枚・L${laneIdx + 1} に装備）</h3>
      <button data-close>閉じる</button></div>
    <div class="modal-filters">
      <input type="search" id="ph-search" placeholder="フォト名・タグ・効果で検索…">
      <button class="btn-like" id="ph-new">＋ 新規フォト作成</button>
      <button class="btn-like" id="ph-master">📖 フォトマスタから追加（メモリアル/撮影キャラ付き）</button>
    </div>
    <div class="sp-tabs" id="ph-tags">${allPhotoTags()
      .map((t) => `<button type="button" data-tag="${esc(t)}">${esc(t)}</button>`)
      .join("")}</div>
    <div class="bulk-bar" id="ph-bulk-bar" hidden>
      <span id="ph-bulk-count" class="dim"></span>
      <button class="btn-like" id="ph-bulk-mochi-add">手持ちタグを付ける</button>
      <button class="btn-like" id="ph-bulk-mochi-del">手持ちタグを外す</button>
      <input type="text" id="ph-bulk-tags" placeholder="タグを追加（カンマ区切り）" style="flex:1;min-width:120px">
      <button class="btn-like" id="ph-bulk-tags-add">タグ追加</button>
      <button class="btn-like" id="ph-bulk-del">🗑 選択を削除</button>
    </div>
    <div id="ph-list" class="modal-list"></div>
    <div class="note">※ 行の左端チェックで複数選択→上部バーで一括編集（手持ちタグ付与など）。
    レタッチフォトは1人1枚まで・スキル持ちフォトはステータス枠4枠の制限は装備時に自動チェックされます。</div>`);
  let tagFilter = "";
  // 【Phase 8-B5】同じフォトは1編成に1枚まで。編成中フォトはグレー表示＋
  // 装備時に「付け替え（奪う）」確認を出す（確認中のフォト ID）
  let confirmingId: string | null = null;
  /** このフォトを装備しているレーン番号（1始まり） */
  const usedLanesOf = (pid: string): number[] =>
    state.lanes
      .map((l, i) => (l.photoEquip.includes(pid) ? i + 1 : 0))
      .filter((n) => n > 0);
  /** 他レーンから装備を奪って laneIdx に付け替える（編成内 1 枚ルール） */
  const stealAndEquip = (pid: string): void => {
    const p = photoById(pid);
    if (p === undefined) return;
    const stolen: number[] = [];
    state.lanes.forEach((l, i) => {
      if (i !== laneIdx && l.photoEquip.includes(pid)) {
        l.photoEquip = l.photoEquip.filter((x) => x !== pid);
        stolen.push(i + 1);
        renderLaneCard(i);
      }
    });
    const l = state.lanes[laneIdx]!;
    l.photoEquip.push(pid);
    renderLaneCard(laneIdx);
    setStatus(
      stolen.length > 0
        ? `L${laneIdx + 1} に付け替え: ${p.name || "(無題)"}（L${stolen.join("/L")} から装備を移動）`
        : `L${laneIdx + 1} に装備: ${p.name || "(無題)"}（装備 ${l.photoEquip.length}枚）`,
    );
  };
  const render = (): void => {
    const q = ($("#ph-search") as HTMLInputElement).value.trim().toLowerCase();
    const list = myPhotos.filter((p) => {
      if (tagFilter !== "" && !p.tags.includes(tagFilter)) return false;
      if (q === "") return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.kindLabel.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)) ||
        photoSummary(p).toLowerCase().includes(q)
      );
    });
    $("#ph-list").innerHTML =
      list
        .map((p) => {
          const used = usedLanesOf(p.id);
          const usedHere = used.includes(laneIdx + 1);
          const usedElsewhere = used.filter((n) => n !== laneIdx + 1);
          const confirmUi =
            confirmingId === p.id
              ? `<span class="fx-row photo-swap-confirm">もうすでに編成されています（L${usedElsewhere.join("/")} が装備中）。このキャラに付け替えますか？
                <button class="mini-btn" data-ph-swap="${esc(p.id)}">付け替える</button>
                <button class="mini-btn" data-ph-cancel>キャンセル</button></span>`
              : "";
          return `<div class="pick-row photo-row${usedElsewhere.length > 0 ? " photo-used" : ""}" data-photo-id="${esc(p.id)}">
          <input type="checkbox" data-ph-sel="${esc(p.id)}"${albumSelection.has(p.id) ? " checked" : ""} title="選択（一括編集）">
          <b>${esc(p.name || "(無題)")}</b>
          <span class="chip">${esc(p.kindLabel)}</span>
          ${p.retouch ? `<span class="chip chip-retouch">レタッチ</span>` : ""}
          ${p.tags.map((t) => `<span class="chip tag-chip${t === "手持ち" ? " chip-mochi" : ""}">${esc(t)}</span>`).join("")}
          ${usedHere ? `<span class="chip chip-used">このレーンに装備済み</span>` : ""}
          ${usedElsewhere.map((n) => `<span class="chip chip-used" title="同じフォトは1編成に1枚まで・装備すると付け替えになります">編成中:L${n}</span>`).join("")}
          <span class="fx-row">${photoSummaryHtml(p)}</span>
          ${confirmUi}
          <span class="photo-row-ops">
            <button class="mini-btn" data-ph-mochi="${esc(p.id)}" title="手持ちタグをワンタッチ付与/解除">🎒</button>
            <button class="mini-btn" data-ph-equip="${esc(p.id)}" title="${usedElsewhere.length > 0 ? "装備中のキャラから付け替える" : "このレーンに装備"}">▶装備</button>
            <button class="mini-btn" data-ph-edit="${esc(p.id)}" title="編集">✎</button>
            <button class="mini-btn" data-ph-del="${esc(p.id)}" title="削除">✕</button>
          </span>
        </div>`;
        })
        .join("") || `<div class="dim">該当するフォトがありません</div>`;
    const bulkBar = $("#ph-bulk-bar") as HTMLElement;
    bulkBar.hidden = albumSelection.size === 0;
    ($("#ph-bulk-count") as HTMLElement).textContent = `${albumSelection.size} 枚選択中`;
    $("#ph-list")
      .querySelectorAll<HTMLInputElement>("[data-ph-sel]")
      .forEach((cb) =>
        cb.addEventListener("change", () => {
          const id = cb.getAttribute("data-ph-sel")!;
          if (cb.checked) albumSelection.add(id);
          else albumSelection.delete(id);
          const bulkBar2 = $("#ph-bulk-bar") as HTMLElement;
          bulkBar2.hidden = albumSelection.size === 0;
          ($("#ph-bulk-count") as HTMLElement).textContent = `${albumSelection.size} 枚選択中`;
        }),
      );
    const toggleMochi = (id: string): void => {
      const p = photoById(id);
      if (p === undefined) return;
      if (p.tags.includes("手持ち")) p.tags = p.tags.filter((t) => t !== "手持ち");
      else p.tags.push("手持ち");
      saveMyPhotos(myPhotos);
      render();
    };
    $("#ph-list")
      .querySelectorAll<HTMLButtonElement>("[data-ph-mochi]")
      .forEach((btn) =>
        btn.addEventListener("click", () => toggleMochi(btn.getAttribute("data-ph-mochi")!)),
      );
    $("#ph-list")
      .querySelectorAll<HTMLButtonElement>("[data-ph-cancel]")
      .forEach((btn) =>
        btn.addEventListener("click", () => {
          confirmingId = null;
          render();
        }),
      );
    $("#ph-list")
      .querySelectorAll<HTMLButtonElement>("[data-ph-swap]")
      .forEach((btn) =>
        btn.addEventListener("click", () => {
          const pid = btn.getAttribute("data-ph-swap")!;
          confirmingId = null;
          stealAndEquip(pid);
          render();
        }),
      );
    $("#ph-list")
      .querySelectorAll<HTMLButtonElement>("[data-ph-equip]")
      .forEach((btn) =>
        btn.addEventListener("click", () => {
          const p = photoById(btn.getAttribute("data-ph-equip")!);
          if (p === undefined) return;
          const l = state.lanes[laneIdx]!;
          // 同じフォトは1編成に1枚まで（Phase 8-B5）:
          // このレーン装備済みは何もしない・他レーン装備中は付け替え確認を出す
          const used = usedLanesOf(p.id);
          if (used.includes(laneIdx + 1)) {
            setStatus(`このレーンにすでに装備されています: ${p.name || "(無題)"}`, true);
            return;
          }
          if (used.length > 0) {
            confirmingId = p.id;
            render();
            return;
          }
          const conflicts = validatePhotoEquip(
            l.photoEquip.map((pid) => photoById(pid)).filter((x): x is MyPhotoDef => x !== undefined),
            p,
          );
          // 【Phase 8-B3】フォト枠数上限（実測/JSON フォト + 帳装備の合計）
          const legacyCount = (() => {
            try {
              return parseEquipment(l.photosJson, laneIdx + 1, "フォト(JSON)").length;
            } catch {
              return 0;
            }
          })();
          if (legacyCount + l.photoEquip.length >= photoSlotLimitOf(l.level)) {
            conflicts.push(
              `フォト枠が上限です（カードLv${l.level} では ${photoSlotLimitOf(l.level)} 枚まで・3枚目=Lv65・4枚目=Lv105 で解放）`,
            );
          }
          if (conflicts.length > 0) {
            setStatus(`装備できません: ${conflicts.join(" / ")}`, true);
            return;
          }
          if (!p.tags.includes("手持ち")) {
            p.tags.push("手持ち");
            saveMyPhotos(myPhotos);
          }
          l.photoEquip.push(p.id);
          renderLaneCard(laneIdx);
          setStatus(`L${laneIdx + 1} に装備: ${p.name || "(無題)"}（装備 ${l.photoEquip.length}枚）`);
          render();
        }),
      );
    $("#ph-list")
      .querySelectorAll<HTMLButtonElement>("[data-ph-edit]")
      .forEach((btn) =>
        btn.addEventListener("click", () => openPhotoEditor(laneIdx, btn.getAttribute("data-ph-edit")!)),
      );
    $("#ph-list")
      .querySelectorAll<HTMLButtonElement>("[data-ph-del]")
      .forEach((btn) =>
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-ph-del")!;
          myPhotos = myPhotos.filter((p) => p.id !== id);
          state.lanes.forEach((l) => {
            l.photoEquip = l.photoEquip.filter((pid) => pid !== id);
          });
          albumSelection.delete(id);
          saveMyPhotos(myPhotos);
          render();
          renderConfig();
          setStatus("フォトを削除しました");
        }),
      );
  };
  const bulkAction = (apply: (p: MyPhotoDef) => void): void => {
    const targets = myPhotos.filter((p) => albumSelection.has(p.id));
    for (const p of targets) apply(p);
    saveMyPhotos(myPhotos);
    render();
    renderConfig();
    setStatus(`${targets.length} 枚を一括編集しました`);
  };
  $("#ph-bulk-mochi-add").addEventListener("click", () =>
    bulkAction((p) => {
      if (!p.tags.includes("手持ち")) p.tags.push("手持ち");
    }),
  );
  $("#ph-bulk-mochi-del").addEventListener("click", () =>
    bulkAction((p) => {
      p.tags = p.tags.filter((t) => t !== "手持ち");
    }),
  );
  $("#ph-bulk-tags-add").addEventListener("click", () => {
    const raw = ($("#ph-bulk-tags") as HTMLInputElement).value.trim();
    if (raw === "") return;
    const tags = raw.split(/[,、，]/).map((t) => t.trim()).filter((t) => t !== "");
    bulkAction((p) => {
      for (const t of tags) {
        if (!p.tags.includes(t)) p.tags.push(t);
      }
    });
    ($("#ph-bulk-tags") as HTMLInputElement).value = "";
  });
  $("#ph-bulk-del").addEventListener("click", () => {
    const ids = [...albumSelection];
    if (ids.length === 0) return;
    myPhotos = myPhotos.filter((p) => !albumSelection.has(p.id));
    state.lanes.forEach((l) => {
      l.photoEquip = l.photoEquip.filter((pid) => !albumSelection.has(pid));
    });
    albumSelection = new Set();
    saveMyPhotos(myPhotos);
    render();
    renderConfig();
    setStatus(`${ids.length} 枚のフォトを削除しました`);
  });
  ($("#ph-search") as HTMLInputElement).addEventListener("input", render);
  $("#ph-new").addEventListener("click", () => openPhotoEditor(laneIdx, null));
  $("#ph-master").addEventListener("click", () => openPhotoMasterPicker(laneIdx));
  $("#ph-tags")
    .querySelectorAll<HTMLButtonElement>("button[data-tag]")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-tag") ?? "";
        tagFilter = tagFilter === t ? "" : t;
        $("#ph-tags")
          .querySelectorAll<HTMLButtonElement>("button[data-tag]")
          .forEach((b) => b.classList.toggle("active", b.getAttribute("data-tag") === tagFilter));
        render();
      }),
    );
  render();
}

// ---------------------------------------------------------------------------
// フォトマスタピッカー（INFO PRIDE のメモリアルフォト一覧・撮影キャラ付き・初期品質）。
// ※ 専用フォト（やる気士docs のキャラ別フィルム）は別系統のマスタに存在しないため対象外。
// ---------------------------------------------------------------------------

function openPhotoMasterPicker(laneIdx: number): void {
  const master = DATA.photosMaster;
  openModal(`
    <div class="modal-head"><h3>フォトマスタ（${master.photos.length}枚・INFO PRIDE 初期品質の値を初期値に）</h3>
      <button data-close>閉じる</button></div>
    <div class="modal-filters">
      <input type="search" id="pm-search" placeholder="フォト名・撮影キャラ・場所で検索…">
      <select id="pm-kind">
        <option value="">種別:すべて</option>
        <option value="メモリアルフォト">メモリアルフォト</option>
        <option value="研修用フォト">研修用フォト</option>
        <option value="focused">撮影キャラ付き（キャラ指定）</option>
        <option value="skilled">スキル付き</option>
      </select>
    </div>
    <div id="pm-list" class="modal-list"></div>
    <div class="note">※ マスタ（PhotoAllInOne）由来の初期品質の値を初期値として帳に追加します。
    イメトレ・レタッチによる強化値は編集（✎）で上書きしてください。フォト画像はマスタに存在しないため
    名前＋能力チップで表示します（[フォトマスタ] タグ付きで帳に追加・▶装備でレーンに装備）。</div>`);
  const render = (): void => {
    const q = ($("#pm-search") as HTMLInputElement).value.trim().toLowerCase();
    const kindF = ($("#pm-kind") as HTMLSelectElement).value;
    const list = master.photos.filter((p) => {
      if (kindF === "focused" && !p.focusCharacterId) return false;
      if (kindF === "skilled" && p.skills.length === 0) return false;
      if (kindF !== "" && kindF !== "focused" && kindF !== "skilled" && p.eventName !== kindF) {
        return false;
      }
      if (q === "") return true;
      const preview = photoMasterToMyPhoto(p, master.skillsById);
      return (
        p.name.toLowerCase().includes(q) ||
        (p.placeName ?? "").toLowerCase().includes(q) ||
        (p.focusCharacterName ?? "").toLowerCase().includes(q) ||
        photoSummary(preview).toLowerCase().includes(q)
      );
    });
    $("#pm-list").innerHTML =
      list
        .slice(0, 150)
        .map((p) => {
          const preview = photoMasterToMyPhoto(p, master.skillsById);
          const exists = photoById(p.id) !== undefined;
          return `<div class="pick-row photo-row" data-pm-id="${esc(p.id)}">
          <b>${esc(p.name)}</b>
          <span class="chip">${esc(p.eventName || "通常")}</span>
          <span class="chip">品質${p.initialQuality ?? "—"}</span>
          <span class="dim">★${p.rarity ?? "?"}</span>
          ${p.focusCharacterId ? `<span class="chip chip-focus">撮影:${esc(p.focusCharacterName || p.focusCharacterId)}</span>` : ""}
          ${p.skills.length > 0 && master.skillsById[p.skills[0]!] ? `<span class="chip chip-skill">スキル: ${esc(master.skillsById[p.skills[0]!]!.name)}</span>` : ""}
          ${p.placeName ? `<span class="dim">${esc(p.placeName)}</span>` : ""}
          <span class="fx-row">${photoSummaryHtml(preview)}</span>
          <span class="photo-row-ops">
            <button class="mini-btn" data-pm-add="${esc(p.id)}" title="${exists ? "帳に追加済み（再追加で上書き）" : "マイフォト帳に追加"}">${exists ? "再追加" : "＋帳に追加"}</button>
          </span>
        </div>`;
        })
        .join("") || `<div class="dim">該当するフォトがありません</div>`;
    $("#pm-list")
      .querySelectorAll<HTMLButtonElement>("[data-pm-add]")
      .forEach((btn) =>
        btn.addEventListener("click", () => {
          const entry = master.photos.find((p) => p.id === btn.getAttribute("data-pm-add")!);
          if (entry === undefined) return;
          const def = photoMasterToMyPhoto(entry, master.skillsById);
          const existing = photoById(def.id);
          if (existing !== undefined) {
            // マスタ由来の同 ID は上書き（装備中のレーンも同 ID なので破壊しない）
            const idx = myPhotos.findIndex((p) => p.id === def.id);
            myPhotos[idx] = def;
          } else {
            myPhotos.push(def);
          }
          saveMyPhotos(myPhotos);
          setStatus(`マイフォト帳に追加: ${def.name}（初期品質${def.quality ?? "—"}）`);
          render();
        }),
      );
  };
  ($("#pm-search") as HTMLInputElement).addEventListener("input", render);
  ($("#pm-kind") as HTMLSelectElement).addEventListener("change", render);
  render();
}

// ---------------------------------------------------------------------------
// ステージ・曲選択モーダル（大分類カテゴリタブ付き）
// ---------------------------------------------------------------------------

/** 大分類カテゴリ定義（data/stages_index.json の areas[].c と同期） */
const STAGE_CATS: Array<{ code: string; label: string }> = [
  { code: "", label: "すべて（曲から探す）" },
  { code: "highscore", label: "ハイスコアライブ" },
  { code: "ex", label: "EXタワー" },
  { code: "tower", label: "VENUSタワー" },
  { code: "main", label: "メインライブ" },
  { code: "daily", label: "デイリーライブ" },
  { code: "other", label: "合宿・その他" },
];

function areaOfQuest(q: UiQuest): UiArea | undefined {
  return q.ar >= 0 ? DATA.stagesIndex.areas[q.ar] : undefined;
}

function catOfQuest(q: UiQuest): string {
  return areaOfQuest(q)?.c ?? "other";
}

/** クエストの表示名（n が空なら曲名） */
function questDisplayName(q: UiQuest | undefined): string {
  if (q === undefined) return "—";
  return q.n || currentMusicName(q);
}

function stageRowHtml(q: UiQuest): string {
  const cfg = DATA.stagesIndex.configs[q.c]!;
  const chartId = DATA.stagesIndex.charts[q.ch]!;
  const notes = DATA.chartsAll[chartId]?.length ?? 0;
  const attrLabels = cfg.a
    .map((code) => (code === 1 ? "Da" : code === 2 ? "Vo" : code === 3 ? "Vi" : String(code)))
    .join("-");
  const counts = new Map<string, number>();
  for (const code of cfg.a) {
    const label = code === 1 ? "Da" : code === 2 ? "Vo" : code === 3 ? "Vi" : String(code);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const rec = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  return `<div class="pick-row" data-stage="${esc(q.id)}">
    <span class="diff">難易度${q.d}</span> <b>${esc(questDisplayName(q))}</b>
    <span class="dim">${esc(currentMusicName(q))}</span>
    <span class="dim">${esc(q.id)}</span>
    <span class="dim">ビート${notes}・レーン色 ${attrLabels}（推奨 ${rec}）・重み Vo${cfg.w[0]}/Da${cfg.w[1]}/Vi${cfg.w[2]}・キャパ${fmtInt(cfg.cap)}・メンタル${cfg.mt}・クリア${fmtScore(q.clear)}</span>
  </div>`;
}

function openStagePicker(): void {
  openModal(`
    <div class="modal-head"><h3>ステージ・曲選択（全${DATA.stagesIndex.quests.length}ステージ／${DATA.stagesIndex.musics.length}曲）</h3>
      <button data-close>閉じる</button></div>
    <div class="sp-tabs" id="sp-tabs">${STAGE_CATS.map(
      (c, i) => `<button type="button" data-cat="${c.code}"${i === 0 ? ' class="active"' : ""}>${c.label}</button>`,
    ).join("")}</div>
    <input type="search" id="sp-search" placeholder="曲名・アーティスト名・ステージ名で検索…" class="modal-search">
    <div id="sp-songs" class="modal-list"></div>
    <div id="sp-stages" class="modal-list hidden"></div>`);
  const bindStageClicks = (container: HTMLElement): void => {
    container.querySelectorAll("[data-stage]").forEach((el) => {
      el.addEventListener("click", () => {
        const stageId = el.getAttribute("data-stage")!;
        try {
          applyStage(stageId);
          closeModal();
          setStatus(`ステージを変更しました: ${stageId}`);
        } catch (e) {
          setStatus(`ステージ変更エラー: ${e instanceof Error ? e.message : String(e)}`, true);
        }
      });
    });
  };
  const renderSongs = (): void => {
    const q = ($("#sp-search") as HTMLInputElement).value.trim().toLowerCase();
    const counts = new Map<number, number>();
    for (const quest of DATA.stagesIndex.quests) {
      counts.set(quest.m, (counts.get(quest.m) ?? 0) + 1);
    }
    const songs = DATA.stagesIndex.musics
      .map((m, i) => ({ m, i }))
      .filter(
        ({ m }) =>
          q === "" ||
          m.n.toLowerCase().includes(q) ||
          m.s.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q),
      );
    $("#sp-songs").innerHTML = songs
      .map(
        ({ m, i }) =>
          `<div class="pick-row" data-music="${i}"><b>${esc(m.n)}</b> <span class="dim">${esc(m.s)}</span> <span class="dim">（${counts.get(i) ?? 0}ステージ）</span></div>`,
      )
      .join("");
    $("#sp-songs").classList.remove("hidden");
    $("#sp-stages").classList.add("hidden");
    $("#sp-songs").querySelectorAll("[data-music]").forEach((el) => {
      el.addEventListener("click", () => {
        renderStages(Number(el.getAttribute("data-music")));
      });
    });
  };
  const renderStages = (musicIdx: number): void => {
    const music = DATA.stagesIndex.musics[musicIdx];
    if (music === undefined) return;
    const quests = DATA.stagesIndex.quests
      .filter((q) => q.m === musicIdx)
      .sort((a, b) => a.d - b.d);
    $("#sp-stages").innerHTML =
      `<div class="pick-head"><b>${esc(music.n)}</b>（${esc(music.s)}）のステージ</div>` +
      quests.map(stageRowHtml).join("");
    $("#sp-songs").classList.add("hidden");
    $("#sp-stages").classList.remove("hidden");
    bindStageClicks($("#sp-stages"));
  };
  /** 大分類カテゴリの一覧（エリア名でグループ化・検索クエリで絞り込み） */
  const renderCategory = (cat: string): void => {
    const q = ($("#sp-search") as HTMLInputElement).value.trim().toLowerCase();
    const quests = DATA.stagesIndex.quests.filter((quest) => {
      if (cat === "other" ? !(catOfQuest(quest) === "exercise" || catOfQuest(quest) === "tutorial" || catOfQuest(quest) === "other") : catOfQuest(quest) !== cat) {
        return false;
      }
      if (q === "") return true;
      return (
        quest.id.toLowerCase().includes(q) ||
        questDisplayName(quest).toLowerCase().includes(q) ||
        currentMusicName(quest).toLowerCase().includes(q)
      );
    });
    // エリア名ごとにグループ化（areas の並び順＝タブ内の表示順）
    const byArea = new Map<number, UiQuest[]>();
    for (const quest of quests) {
      const ar = quest.ar;
      if (!byArea.has(ar)) byArea.set(ar, []);
      byArea.get(ar)!.push(quest);
    }
    const areaOrders = [...byArea.keys()].sort((a, b) => a - b);
    $("#sp-stages").innerHTML = areaOrders
      .map((ar) => {
        const area = DATA.stagesIndex.areas[ar];
        const label = area ? area.n : "その他";
        const list = byArea.get(ar)!.sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
        return (
          `<div class="pick-head"><b>${esc(label)}</b>（${list.length}ステージ）</div>` +
          list.map(stageRowHtml).join("")
        );
      })
      .join("");
    $("#sp-songs").classList.add("hidden");
    $("#sp-stages").classList.remove("hidden");
    bindStageClicks($("#sp-stages"));
  };
  $("#sp-tabs").querySelectorAll("button[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#sp-tabs").querySelectorAll("button[data-cat]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const cat = btn.getAttribute("data-cat") ?? "";
      if (cat === "") renderSongs();
      else renderCategory(cat);
    });
  });
  ($("#sp-search") as HTMLInputElement).addEventListener("input", () => {
    const active = $("#sp-tabs").querySelector("button.active")?.getAttribute("data-cat") ?? "";
    if (active === "") renderSongs();
    else renderCategory(active);
  });
  renderSongs();
}

// ---------------------------------------------------------------------------
// カード選択モーダル（レーン毎）
// ---------------------------------------------------------------------------

function openCardPicker(laneIdx: number): void {
  const lane = (laneIdx + 1) as LaneNumber;
  const attr = laneAttributeOf(lane, currentLaneAttrs());
  openModal(`
    <div class="modal-head"><h3>カード選択（L${lane}・${attr === "dance" ? "Da" : attr === "visual" ? "Vi" : "Vo"}レーン・全${DATA.data.cards.length}枚）</h3>
      <button data-close>閉じる</button></div>
    <div class="modal-filters">
      <input type="search" id="cp-search" placeholder="カード名・キャラ名で検索…">
      <select id="cp-attr"><option value="">属性:すべて</option><option value="vocal">Vo</option><option value="dance">Da</option><option value="visual">Vi</option></select>
      <select id="cp-rarity"><option value="">レアリティ:すべて</option>${[1, 2, 3, 4, 5]
        .map((r) => `<option value="${r}">☆${r}</option>`)
        .join("")}</select>
    </div>
    <div id="cp-list" class="modal-list"></div>`);
  const render = (): void => {
    const q = ($("#cp-search") as HTMLInputElement).value.trim().toLowerCase();
    const attrF = ($("#cp-attr") as HTMLSelectElement).value;
    const rarF = ($("#cp-rarity") as HTMLSelectElement).value;
    const list = DATA.data.cards
      .filter((c) => {
        if (attrF !== "" && cardAttr(c) !== attrF) return false;
        if (rarF !== "" && c.initialRarity !== Number(rarF)) return false;
        if (q === "") return true;
        return (
          c.name.toLowerCase().includes(q) ||
          charName(c.characterId).toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q)
        );
      })
      .slice(0, 120);
    $("#cp-list").innerHTML = list
      .map((c) => {
        const a = cardAttr(c);
        const r = c.ratiosPermil;
        return `<div class="pick-row" data-card="${esc(c.id)}">
          ${thumbHtml(c.id, 1, "thumb-sm")}
          <span class="attr attr-${a}">${ATTR_SHORT[a]}</span>
          <b>${esc(c.name)}</b> <span class="dim">☆${c.initialRarity}</span>
          <span class="dim">${esc(charName(c.characterId))}</span>
          <span class="dim">比 Vo${(r.vocal / 10).toFixed(1)}% Da${(r.dance / 10).toFixed(1)}% Vi${(r.visual / 10).toFixed(1)}%</span>
        </div>`;
      })
      .join("");
    bindThumbErrors($("#cp-list"));
    $("#cp-list").querySelectorAll("[data-card]").forEach((el) => {
      el.addEventListener("click", () => {
        selectCard(laneIdx, el.getAttribute("data-card")!);
        closeModal();
      });
    });
  };
  ($("#cp-search") as HTMLInputElement).addEventListener("input", render);
  ($("#cp-attr") as HTMLSelectElement).addEventListener("change", render);
  ($("#cp-rarity") as HTMLSelectElement).addEventListener("change", render);
  render();
}

/** カード選択: レベル/開花/スキルを自動セット（絆覚醒は既定 OFF・第4スキルは無効）。
 *  ロールはカード固有のため自動導出する。 */
function selectCard(laneIdx: number, cardId: string): void {
  const l = state.lanes[laneIdx]!;
  l.cardId = cardId;
  const levels = availableLevels(DATA.data, cardId);
  if (levels.length > 0) {
    // 既定レベルは 215（キャップ解放で変わる場合に備え 215 が無ければ最大値にフォールバック）
    l.level = levels.includes(DEFAULT_LEVEL) ? DEFAULT_LEVEL : levels[levels.length - 1]!;
  }
  // 開花（現在☆）の既定は限界突破最大の ☆10
  l.rarity = DEFAULT_RARITY;
  l.role = cardRoleOf(cardId);
  l.bondAwake = false;
  // スキルは解決経路（golden or マスタ）から自動セット。
  // 絆覚醒対応カード（4スキル）は既定で第4スキルを無効化（トグルで有効化）
  const resolved = resolveLaneSkills((laneIdx + 1) as LaneNumber, cardId);
  l.enabledSkillIds = new Set(resolved.skills.slice(0, 3).map((s) => s.id));
  // 【Phase 8-B3】スキルLvの既定 = カードレベルから選択できる最大レベル（枠別要求テーブル順守）
  const selCard = cardOf(cardId);
  l.skillLevels = {};
  selCard?.skillIds.forEach((sid, slotIdx) => {
    l.skillLevels[sid] = maxSkillLevelForSlot(slotIdx, l.level);
  });
  renderConfig();
  setStatus(
    `カードをセットしました: ${cardOf(cardId)?.name ?? cardId}（ロール ${ROLE_LABEL[cardRoleOf(cardId)]}・スキル ${Math.min(3, resolved.skills.length)} 件自動設定${resolved.skills.length >= 4 ? "・絆覚醒対応（トグルで第4スキル有効化）" : ""}）`,
  );
}

// ---------------------------------------------------------------------------
// アクセサリ選択モーダル（レーン・スロット指定・属性タブ付き）
// ---------------------------------------------------------------------------

const ACC_CLASS_LABEL: Record<string, string> = {
  vocal: "Vo",
  dance: "Da",
  visual: "Vi",
  stamina: "Sta",
  mental: "Men",
  technique: "Cri",
};

/** 属性タブ定義（"personal" は専用アクセサリ＝characterId 付き） */
const ACC_TABS: Array<{ cls: string; label: string }> = [
  { cls: "", label: "すべて" },
  { cls: "vocal", label: "Vo" },
  { cls: "dance", label: "Da" },
  { cls: "visual", label: "Vi" },
  { cls: "stamina", label: "Sta" },
  { cls: "mental", label: "Men" },
  { cls: "technique", label: "Cri" },
  { cls: "personal", label: "専用" },
];

function accessoryChips(acc: UiAccessory): string {
  return acc.structured
    .map((s) => `<span class="chip">${s.stat === "critical" ? "Cri" : s.stat} ${s.type === "pct" ? "+" + s.value + "%" : "+" + fmtInt(s.value)}</span>`)
    .join("");
}

function openAccessoryPicker(laneIdx: number, slotIdx: number): void {
  // 【Phase 8-A】スロット役割に合わない分類はリストから除外する
  const allowed = ACC_SLOT_CLASSES[slotIdx] ?? ["vocal", "dance", "visual", "stamina", "mental", "technique"];
  const roleLabel = accSlotRoleLabel(slotIdx);
  openModal(`
    <div class="modal-head"><h3>アクセサリ選択（L${laneIdx + 1}・${esc(roleLabel)}・全${DATA.accessories.length}件）</h3>
      <button data-close>閉じる</button></div>
    <div class="sp-tabs" id="ap-tabs">${ACC_TABS.filter(
      (t) => t.cls === "" || t.cls === "personal" || allowed.includes(t.cls),
    )
      .map(
        (t, i) => `<button type="button" data-cls="${t.cls}"${i === 0 ? ' class="active"' : ""}>${t.label}</button>`,
      )
      .join("")}</div>
    <div class="modal-filters">
      <input type="search" id="ap-search" placeholder="アクセサリ名・キャラ名・効果で検索…">
      <select id="ap-rarity"><option value="">レアリティ:すべて</option>${[1, 2, 3, 4, 5]
        .map((r) => `<option value="${r}">★${r}</option>`)
        .join("")}</select>
      <select id="ap-sort" title="効果値の大きさ順（このスロットの分類の効果値で比較）">
        <option value="desc">効果値: 大きい順</option>
        <option value="asc">効果値: 小さい順</option>
        <option value="none">既定順</option>
      </select>
    </div>
    <div id="ap-list" class="modal-list"></div>
    <div class="note">※ このスロットは ${esc(roleLabel)} のみ選択できます（スロット1 = 基礎3ステータス・スロット2 = Sta/Men/Cri）。
    アイコンはローカル同梱（./images/accessories/）→ INFO PRIDE CDN（img_acc_thumb_{assetId}）の順で読み込み、両方不可の場合は種別チップ（Vo/Da/Vi/Sta/Men/Cri）を表示します。</div>`);
  let classFilter = "";
  // 【Phase 8-B7】効果値での昇順/降順ソート（このスロットの分類の効果値で比較）
  let sortMode: "desc" | "asc" | "none" = "desc";
  // 専用（キャラ指定）アクセサリはそのキャラにしか装備できないため、
  // レーンのカードキャラ以外の専用品は全タブで非表示にする
  const laneCharId = cardOf(state.lanes[laneIdx]!.cardId)?.characterId ?? "";
  const render = (): void => {
    const q = ($("#ap-search") as HTMLInputElement).value.trim().toLowerCase();
    const rarF = ($("#ap-rarity") as HTMLSelectElement).value;
    const list = DATA.accessories
      .filter((a) => {
        if (!allowed.includes(a.classification)) return false;
        if (a.characterId !== "" && a.characterId !== laneCharId) return false;
        if (classFilter === "personal") {
          if (a.characterId === "") return false;
        } else if (classFilter !== "" && a.classification !== classFilter) {
          return false;
        }
        if (rarF !== "" && a.rarity !== Number(rarF)) return false;
        if (q === "") return true;
        return (
          a.name.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          (a.characterId !== "" && charName(a.characterId).toLowerCase().includes(q)) ||
          a.structured.some((s) => s.stat.toLowerCase().includes(q))
        );
      });
    if (sortMode !== "none") {
      // 選択タブの分類（すべてタブはこのスロットの許可分類全体）の効果値で比較。
      // 同じ分類の効果が複数行ある場合は最大値を採用。
      // technique（Cri）分類の効果行 stat は critical のため分類→stat の写像が必要
      const statsOf = (cls: string): string[] =>
        cls === "technique" ? ["critical", "technique"] : [cls];
      const valueOf = (a: UiAccessory): number => {
        const cls = classFilter !== "" && classFilter !== "personal" ? classFilter : "";
        const stats = cls !== "" ? statsOf(cls) : allowed.flatMap(statsOf);
        const vals = a.structured.filter((s) => stats.includes(s.stat)).map((s) => s.value);
        return vals.length > 0 ? Math.max(...vals) : -1;
      };
      list.sort((a, b) => (sortMode === "desc" ? valueOf(b) - valueOf(a) : valueOf(a) - valueOf(b)));
    }
    const page = list.slice(0, 150);
    $("#ap-list").innerHTML = page
      .map(
        (a) => `<div class="pick-row" data-acc="${esc(a.id)}">
          ${accThumbHtml(accAssetIdFor(a))}
          <span class="chip acc-${esc(a.classification)}">${ACC_CLASS_LABEL[a.classification] ?? a.classification}</span>
          <b>${esc(a.name)}</b> <span class="dim">★${a.rarity}</span>
          ${a.characterId ? `<span class="dim">専用:${esc(charName(a.characterId))}</span>` : ""}
          ${accessoryChips(a)}
        </div>`,
      )
      .join("");
    $("#ap-list").querySelectorAll("[data-acc]").forEach((el) => {
      el.addEventListener("click", () => {
        setAccessory(laneIdx, slotIdx, el.getAttribute("data-acc")!);
        closeModal();
      });
    });
  };
  $("#ap-tabs").querySelectorAll("button[data-cls]").forEach((btn) => {
    btn.addEventListener("click", () => {
      classFilter = btn.getAttribute("data-cls") ?? "";
      $("#ap-tabs").querySelectorAll("button[data-cls]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      render();
    });
  });
  ($("#ap-search") as HTMLInputElement).addEventListener("input", render);
  ($("#ap-rarity") as HTMLSelectElement).addEventListener("change", render);
  ($("#ap-sort") as HTMLSelectElement).addEventListener("change", () => {
    const v = ($("#ap-sort") as HTMLSelectElement).value;
    sortMode = v === "asc" ? "asc" : v === "none" ? "none" : "desc";
    render();
  });
  render();
}

// ---------------------------------------------------------------------------
// 描画: 設定パネル
// ---------------------------------------------------------------------------

function currentLaneAttrs(): readonly number[] {
  const st = DATA.data.stages[state.stageId];
  return st?.laneAttributes ?? [2, 2, 1, 2, 2];
}

function stageInfoHtml(): string {
  const q = currentQuest();
  const chart = DATA.data.charts[state.chartId];
  const st = DATA.data.stages[state.stageId];
  const cfg = q !== undefined ? DATA.stagesIndex.configs[q.c] : undefined;
  const area = q !== undefined ? areaOfQuest(q) : undefined;
  const catLabel = STAGE_CATS.find((c) => c.code === (area?.c ?? "other"))?.label ?? "その他";
  const notes = chart?.notes ?? [];
  const aCount = notes.filter((n) => n.type === 2).length;
  const spBeats = notes.filter((n) => n.type === 3).map((n) => n.beat);
  const attrs = currentLaneAttrs().map(
    (code) => (code === 1 ? "Da" : code === 2 ? "Vo" : code === 3 ? "Vi" : String(code)) as string,
  );
  const attrCounts = new Map<string, number>();
  for (const a of attrs) attrCounts.set(a, (attrCounts.get(a) ?? 0) + 1);
  const rec = [...attrCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  return `<b>${esc(questDisplayName(q))}</b>
    <span class="cat-chip cat-${esc(area?.c ?? "other")}">${esc(catLabel)}${area ? `・${esc(area.n)}` : ""}</span>
    <span class="diff">難易度${q?.d ?? "—"}</span><br>
    曲 <b>${esc(currentMusicName(q))}</b>／ステージ <b>${esc(state.stageId)}</b>／
    譜面 <b>${esc(state.chartId)}</b>（${notes.length}ノート・A×${aCount}・SP×${spBeats.length}${spBeats.length > 0 ? ` @b${spBeats.join(",b")}` : ""}）<br>
    レーン色 ${attrs.join("-")}（推奨 ${rec}）／重み Vo${st?.beatWeightsPermil.vocal ?? "—"}/Da${st?.beatWeightsPermil.dance ?? "—"}/Vi${st?.beatWeightsPermil.visual ?? "—"}‰／
    A/SP重み ${st?.skillWeightsPermil.active ?? "—"}/${st?.skillWeightsPermil.special ?? "—"}‰${
      cfg ? `／メンタル要求 <b>${cfg.mt}</b>／最大キャパシティ <b>${fmtInt(cfg.cap)}</b>（個人来場上限 ${fmtInt(Math.min(50000, Math.floor(cfg.cap / 5)))}人）／クリアスコア ${fmtScore(q?.clear ?? 0)}` : ""
    }${liveBonusInfoHtml()}`;
}

/**
 * 【Phase 9】選択ステージのライブボーナス表示（アイコン＋説明テキスト）。
 * data/live_bonuses.json（questId → 定義列）から引き、無いステージでは非表示。
 */
function liveBonusInfoHtml(): string {
  const defs = (DATA.data as { liveBonusesByQuest?: Record<string, Array<Record<string, unknown>>> })
    .liveBonusesByQuest?.[state.stageId];
  if (defs === undefined || defs.length === 0) {
    return "";
  }
  return defs
    .map((lb) => {
      const desc = String(lb.description ?? "") || String(lb.name ?? "");
      const ct = lb.ct != null ? `CT${String(lb.ct)}` : "";
      const cond =
        lb.condition != null && lb.condition !== "none"
          ? `<span class="badge badge-u">条件: ${esc(String(lb.condition))}（後半発動）</span>`
          : "";
      return `<br><span class="lb-chip">🎁 ライブボーナス</span> <b>${esc(desc.replaceAll("\n", " / "))}</b> <span class="dim">${esc(ct)}</span>${cond}`;
    })
    .join("");
}

function skillRow(
  s: SkillDef & { fromMaster?: boolean; unsupported?: number; conditional?: string | null },
  enabled: boolean,
  extraTag?: string,
  /** 【Phase 8-B3】スキルLvセレクト用の制約情報（省略時はセレクトなし） */
  opts?: { slotIdx: number; cardLevel: number; locked: boolean; maxLevel: number },
): string {
  const badge = CONF_BADGE[skillConfidence(s)] ?? "badge-u";
  const kindLabel = { A: "A", SP: "SP", P: "P", photo: "フォト", live_bonus: "ライボ" }[s.kind];
  const ct = s.ct != null ? `CT${s.ct}` : "CT—";
  const cost = s.staminaCost != null ? `消費${s.staminaCost}` : "消費—";
  const fxChips = s.effects.map(fxChipHtml).join(" ") || `<span class="dim">（効果なし）</span>`;
  const tags: string[] = [];
  if (s.fromMaster) tags.push("マスタ解析");
  if (s.unsupported) tags.push(`未対応効果${s.unsupported}行`);
  if (s.conditional) tags.push(s.conditional.startsWith("music") ? "楽曲限定" : s.conditional);
  if (extraTag) tags.push(extraTag);
  // 【Phase 8-B3】スキルLvセレクト（枠の解放カードレベル・Lv別要求カードレベルを反映）
  let levelCtrl = "";
  if (opts !== undefined) {
    if (opts.locked) {
      const unlockLv = skillSlotUnlockLevel(opts.slotIdx);
      levelCtrl = `<span class="chip chip-warn" title="カードレベル ${unlockLv} で解放">🔒 Lv${unlockLv}で解放</span>`;
    } else {
      const lvOpts = [1, 2, 3, 4, 5, 6]
        .map((lv) => {
          const req = skillLevelRequirement(opts.slotIdx, lv);
          const tooHigh = req > opts.cardLevel;
          const sel = lv === s.level ? " selected" : "";
          const dis = tooHigh ? " disabled" : "";
          const hint = tooHigh ? `（カードLv${req}が必要）` : "";
          return `<option value="${lv}"${sel}${dis}>Lv${lv}${hint}</option>`;
        })
        .join("");
      levelCtrl = `<select data-skill-lv="${esc(s.id)}" data-slot="${opts.slotIdx}" title="スキルレベル（要求カードレベル順守・マスタ解析値は Lv6 以外未較正）">${lvOpts}</select>`;
    }
  }
  const lockCls = opts?.locked ? " skill-row-locked" : "";
  return `<label class="skill-row${lockCls}"><input type="checkbox" data-skill="${esc(s.id)}"${enabled && !opts?.locked ? " checked" : ""}${opts?.locked ? " disabled" : ""}>
    <span class="kind kind-${s.kind}">${kindLabel}</span> ${esc(s.name)}
    ${levelCtrl}
    <span class="skill-meta">Lv${s.level}・${ct}・${cost}</span>
    <span class="fx-row">${fxChips}</span>
    <span class="badge ${badge}">${skillConfidence(s)}</span>
    ${tags.length > 0 ? `<span class="badge badge-u">${esc(tags.join("・"))}</span>` : ""}
  </label>`;
}

/** アクセサリ装備エントリ（保存 JSON の1要素） */
interface AccEntry {
  name?: string;
  id?: string;
  assetId?: string;
  structured?: Array<{ stat: string; value: number; type: string }>;
}

/** レーンのアクセサリ JSON を安全に配列へパースする（不正時は null） */
function parseAccList(json: string): AccEntry[] | null {
  try {
    const parsed: unknown = JSON.parse(json.trim() === "" ? "[]" : json);
    if (!Array.isArray(parsed)) return null;
    return parsed as AccEntry[];
  } catch {
    return null;
  }
}

/** レーン 1 あたりの装備スロット数（ゲーム仕様: 2） */
const ACC_SLOTS = 2;

/**
 * 【Phase 8-A】スロットの役割: スロット1 = 基礎3ステータス（Vo/Da/Vi 分類）用、
 * スロット2 = Sta/Men/Cri（stamina/mental/technique 分類）用。
 * マスタ由来（data/accessories.json）のアクセサリは分類で自動振り分け可能。
 */
const ACC_SLOT_CLASSES: ReadonlyArray<readonly string[]> = [
  ["vocal", "dance", "visual"],
  ["stamina", "mental", "technique"],
];

/** スロット1/2 の役割ラベル（ピッカー見出し・エラー表示用） */
function accSlotRoleLabel(slotIdx: number): string {
  return slotIdx === 0 ? "スロット1（Vo/Da/Vi用）" : "スロット2（Sta/Men/Cri用）";
}

/** アクセサリ（マスタ or 装備エントリ）の分類。不明は null */
function accClassificationOf(acc: { id?: string; name?: string; classification?: string }): string | null {
  if (acc.classification !== undefined) return acc.classification;
  const found =
    DATA.accessories.find((a) => a.id === acc.id) ?? DATA.accessories.find((a) => a.name === acc.name);
  return found?.classification ?? null;
}

/** アクセサリ2スロット UI（未装備クリックでピッカー・✕で解除） */
function accessorySlotsHtml(l: LaneUiState, laneIdx: number): string {
  const items = parseAccList(l.accessoriesJson);
  if (items === null) {
    return `<div class="note error-note">アクセサリ(JSON)の形式が不正です（おまかせ装備で再構築できます）</div>`;
  }
  // 表示は先頭 2 件のみ（旧 3 スロット保存データの正規化は load 時に実施）
  const shown = items.slice(0, ACC_SLOTS);
  const cells: string[] = [];
  for (let i = 0; i < ACC_SLOTS; i++) {
    const it = shown[i];
    const roleLabel = accSlotRoleLabel(i);
    if (it === undefined || (it.name === undefined && it.id === undefined)) {
      cells.push(
        `<div class="acc-slot acc-slot-empty" data-act="open-acc-slot" data-slot="${i}" title="クリックでアクセサリを選択（${esc(roleLabel)}）"><span class="dim">＋ 装備なし（${esc(roleLabel)}）</span></div>`,
      );
      continue;
    }
    const chips = (it.structured ?? [])
      .map((s) => `<span class="chip">${s.stat === "critical" ? "Cri" : s.stat}${s.type === "pct" ? "+" + s.value + "%" : "+" + fmtInt(s.value)}</span>`)
      .join("");
    const assetId = accAssetIdFor(it);
    // 【Phase 8-A】スロット役割と分類の不一致警告（旧データ・手入力 JSON のみ起こりうる）
    const cls = accClassificationOf(it);
    const mismatch = cls !== null && !ACC_SLOT_CLASSES[i]?.includes(cls);
    cells.push(
      `<div class="acc-slot${mismatch ? " acc-slot-warn" : ""}" data-act="open-acc-slot" data-slot="${i}" title="クリックで変更・✕で解除（${esc(roleLabel)}）">
        ${accThumbHtml(assetId)}
        <span class="acc-slot-body"><span class="acc-slot-name">${esc(it.name ?? `#${i + 1}`)}${mismatch ? ` <span class="chip chip-warn">役割外（${esc(ACC_CLASS_LABEL[cls!] ?? cls!)}系）</span>` : ""}</span><span class="acc-slot-chips">${chips}</span></span>
        <button class="mini-btn" data-rm-acc="${i}" title="解除">✕</button>
      </div>`,
    );
  }
  return `<div class="acc-slots" data-lane-slots="${laneIdx + 1}">${cells.join("")}</div>`;
}

/**
 * スロット指定でアクセサリを装備（既存エントリは置き換え・末尾追加）。
 * 【Phase 8-A】マスタ由来のアクセサリは分類でスロット役割を判定し、指定スロットと
 * 役割が合わない場合は正役割のスロットへ自動振り分けする（同名の役割スロットが
 * 空いていなければ上書き）。
 */
function setAccessory(laneIdx: number, slotIdx: number, accId: string): void {
  const acc = DATA.accessories.find((a) => a.id === accId);
  if (acc === undefined) return;
  const l = state.lanes[laneIdx]!;
  const list = parseAccList(l.accessoriesJson);
  if (list === null) {
    setStatus("アクセサリ(JSON)の解析に失敗したため装備できません", true);
    return;
  }
  let targetSlot = slotIdx;
  let note = "";
  if (!ACC_SLOT_CLASSES[slotIdx]?.includes(acc.classification)) {
    const other = slotIdx === 0 ? 1 : 0;
    if (ACC_SLOT_CLASSES[other]?.includes(acc.classification)) {
      targetSlot = other;
      note = `（${acc.classification} 分類のため ${accSlotRoleLabel(other)} へ自動振り分け）`;
    }
  }
  const entry = { name: acc.name, id: acc.id, assetId: acc.assetId ?? "", structured: acc.structured };
  while (list.length <= targetSlot) list.push({});
  list[targetSlot] = entry;
  l.accessoriesJson = JSON.stringify(
    list.filter((e) => e.name !== undefined || e.id !== undefined).slice(0, ACC_SLOTS),
    null,
    1,
  );
  renderLaneCard(laneIdx);
  setStatus(`L${laneIdx + 1} ${accSlotRoleLabel(targetSlot)} に装備: ${acc.name}${note}`);
}

/** 旧保存データ（3 スロット時代）の正規化: 先頭 2 件のみ残す */
function normalizeAccSlots(l: LaneUiState): void {
  const arr = parseAccList(l.accessoriesJson);
  if (arr !== null && arr.length > ACC_SLOTS) {
    l.accessoriesJson = JSON.stringify(arr.slice(0, ACC_SLOTS), null, 1);
  }
}

/** おまかせ装備（最強装備の自動配分・ヒューリスティック）:
 *  【Phase 8-A】スロット1（Vo/Da/Vi 分類）はレーン属性一致を優先、スロット2（Sta/Men/Cri 分類）
 *  は補正値の合成スコア最大を装着する。専用アクセサリは同一キャラのみ。
 *  他レーンで使用中の ID は可能な範囲で重複しないようにする。【Estimate】 */
function autoEquipLane(laneIdx: number): void {
  const lane = (laneIdx + 1) as LaneNumber;
  const l = state.lanes[laneIdx]!;
  const laneAttr = laneAttributeOf(lane, currentLaneAttrs());
  const card = cardOf(l.cardId);
  const charId = card?.characterId ?? "";
  // 他レーンが既に装備している ID（重複回避）
  const usedIds = new Set<string>();
  state.lanes.forEach((other, i) => {
    if (i === laneIdx) return;
    for (const it of parseAccList(other.accessoriesJson) ?? []) {
      if (it.id !== undefined) usedIds.add(it.id);
    }
  });
  const power = (it: AccEntry): number =>
    (it.structured ?? []).reduce((s, e) => s + (e.type === "pct" ? e.value * 1500 : e.value), 0);
  const scored = DATA.accessories
    .filter((a) => a.characterId === "" || a.characterId === charId)
    .map((a) => ({
      acc: a,
      attrMatch: a.classification === laneAttr ? 1 : 0,
      power: power(a),
    }));
  /** 【Phase 8-A】スロット役割に合う分類から最強候補を選ぶ（スロット1は属性一致を優先） */
  const pickForSlot = (slotIdx: number, requireAttrMatch: boolean): (typeof scored)[number] | undefined => {
    const allowed = ACC_SLOT_CLASSES[slotIdx] ?? [];
    const candidates = scored
      .filter((c) => allowed.includes(c.acc.classification))
      .filter((c) => !requireAttrMatch || c.attrMatch === 1)
      .sort((x, y) => {
        if (x.attrMatch !== y.attrMatch) return y.attrMatch - x.attrMatch;
        if (x.acc.rarity !== y.acc.rarity) return y.acc.rarity - x.acc.rarity;
        return y.power - x.power;
      });
    // 1周目: 他レーン未使用の ID を優先・2周目: 再利用を許容
    for (const cand of candidates) {
      if (!usedIds.has(cand.acc.id)) return cand;
    }
    return candidates[0];
  };
  const slots: Array<(typeof scored)[number] | undefined> = [
    pickForSlot(0, true) ?? pickForSlot(0, false),
    pickForSlot(1, false),
  ];
  const entries = slots
    .filter((s): s is (typeof scored)[number] => s !== undefined)
    .map((c) => ({
      name: c.acc.name,
      id: c.acc.id,
      assetId: c.acc.assetId ?? "",
      structured: c.acc.structured,
    }));
  l.accessoriesJson = JSON.stringify(entries, null, 1);
  renderLaneCard(laneIdx);
  setStatus(
    `L${laneIdx + 1} におまかせ装備しました: ${entries.map((e) => e.name).join(" / ") || "（候補なし）"}`,
  );
}

/** レーンのマイフォト装備 UI（Phase 8-B） */
function photoEquipHtml(l: LaneUiState, laneIdx: number): string {
  // 旧形式（verification_data_v2.json 互換・T5 実測プリセット等）のフォト行。
  // スキル持ち/なしを問わず全件表示する（T5 プリセットは 4 枚/レーン）。
  // 【Phase 8-B5】スキル表示をこの装備リストに統合（従来は別の「フォト（N）」details）。
  // 実測/JSON フォト i 番目 ↔ golden フォトスキル photoIndex=i+1 の対応で、装備が外れたら
  // スキルも同時に外れる（解除がステータスのみに効く不具合の修正）。
  const legacyItems = parseEquipment(l.photosJson, laneIdx + 1, "フォト(JSON)");
  const goldenPhotos = resolveLaneSkills((laneIdx + 1) as LaneNumber, l.cardId).photos;
  /** golden フォトスキルのスキル行（チェック = 有効・enabledPhotoIds と連動） */
  const goldenSkillHtml = (s: SkillDef): string =>
    `<span class="photo-skill-ctrl">
      <label class="inline"><input type="checkbox" data-skill="${esc(s.id)}"${l.enabledPhotoIds.has(s.id) ? " checked" : ""}> スキル</label>
      <span class="fx-row">${s.effects.map(fxChipHtml).join(" ")}</span>
      <span class="fx fx-meta">${esc(`Lv${s.level}・CT${s.ct ?? "—"}・消費${s.staminaCost ?? "—"}`)}</span>
    </span>`;
  const legacyRows = legacyItems
    .map((item, i) => {
      const structuredChips = item.structured
        .map((s) => {
          const grant = parseGrantKey(s.stat);
          const bareStat = s.stat.replace(/^grant_(neighbors|center|scorer)_/, "");
          const label = grant !== null
            ? (grant.target === "neighbors" ? "隣接→" : grant.target === "center" ? "センター→" : "スコアラー→") +
              (bareStat === "critical_score" ? "クリスコ" : bareStat)
            : s.stat === "critical_score" ? "クリスコ" : s.stat === "a_score" ? "Aスコア" : s.stat === "sp_score" ? "SPスコア" :
              s.stat === "beat_score" ? "ビートスコア" : s.stat === "vocal" ? "Vo" : s.stat === "dance" ? "Da" :
              s.stat === "visual" ? "Vi" : s.stat === "stamina" ? "Sta" : s.stat === "mental" ? "Men" :
              s.stat === "critical" ? "Cri" : s.stat;
          // 【Phase 8-B8】ステータス色の法則（Vo=ピンク・Da=青・Vi=黄）
          const cls = STAT_FX_CLASS[bareStat] ?? (grant !== null ? "fx-grant" : "fx-utility");
          return `<span class="fx ${cls}">${esc(label)} <b>${esc(String(s.type === "pct" ? "+" + s.value + "%" : "+" + s.value))}</b></span>`;
        })
        .join("");
      // 装備されている i 番目のフォトに対応する実測（golden）フォトスキル
      const golden = goldenPhotos.find((s) => s.photoIndex === i + 1);
      return `<div class="photo-eq-row">
        <span class="chip">通常</span>
        <b class="photo-eq-name">${esc(item.name || `(フォト${i + 1})`)}</b>
        <span class="fx-row photo-eq-summary">${structuredChips || `<span class="dim">（効果なし）</span>`}</span>
        ${golden ? goldenSkillHtml(golden) : ""}
        <span class="photo-row-ops">
          <button class="mini-btn" data-photo-json-rm="${i}" title="このフォトをJSONから削除">✕</button>
        </span>
      </div>`;
    })
    .join("");
  const rows = l.photoEquip
    .map((pid, i) => {
      const p = photoById(pid);
      if (p === undefined) {
        return `<div class="photo-eq-row"><span class="dim">不明なフォト: ${esc(pid)}</span>
          <button class="mini-btn" data-photo-rm="${i}" title="装備解除">✕</button></div>`;
      }
      // マイフォトのスキル（チェック = 有効・disabledUserPhotoSkills と連動）
      const userSkillHtml = p.skill !== null
        ? `<span class="photo-skill-ctrl">
            <label class="inline"><input type="checkbox" data-user-photo-skill="${esc(userPhotoSkillId(pid))}"${l.disabledUserPhotoSkills.has(userPhotoSkillId(pid)) ? "" : " checked"}> スキル</label>
            <span class="fx fx-meta">チェックを外すとシミュレーションで発動しません</span>
          </span>`
        : "";
      return `<div class="photo-eq-row">
        <span class="chip">${esc(p.kindLabel)}</span>${p.retouch ? `<span class="chip chip-retouch">レタッチ</span>` : ""}
        <b class="photo-eq-name">${esc(p.name || "(無題)")}</b>
        ${p.tags.map((t) => `<span class="chip tag-chip">${esc(t)}</span>`).join("")}
        <span class="fx-row photo-eq-summary">${photoSummaryHtml(p)}</span>
        ${userSkillHtml}
        <span class="photo-row-ops">
          <button class="mini-btn" data-photo-edit="${esc(pid)}" title="編集">✎</button>
          <button class="mini-btn" data-photo-rm="${i}" title="装備解除">✕</button>
        </span>
      </div>`;
    })
    .join("");
  const totalCount = legacyItems.length + l.photoEquip.length;
  const retouchCount = l.photoEquip.filter((pid) => photoById(pid)?.retouch === true).length;
  // 【Phase 8-B3】フォト枠数上限（マスタ CardLevelRelease type7: 初期2・Lv65で3・Lv105で4）
  const slotLimit = photoSlotLimitOf(l.level);
  const overLimit = totalCount > slotLimit;
  const warn =
    (retouchCount > 1
      ? `<div class="note error-note">レタッチフォトが ${retouchCount} 枚装備されています（ゲーム内では1人1枚まで）</div>`
      : "") +
    (overLimit
      ? `<div class="note error-note">フォトが ${totalCount} 枚装備されていますが、カードLv${l.level} での上限は ${slotLimit} 枚です（3枚目=Lv65・4枚目=Lv105 で解放）</div>`
      : "");
  return `<div class="photo-eq-head">フォト（${totalCount} 枚 = 実測/JSON ${legacyItems.length} + マイフォト帳 ${l.photoEquip.length}・上限 ${slotLimit} 枚@Lv${l.level}）
    ${totalCount > 0 ? `<button class="mini-btn" data-act="photo-clear" title="このキャラのフォト（実測/JSON＋マイフォト帳）を全て装備解除">🗑 全て外す</button>` : ""}</div>
    ${warn}
    <div class="photo-eq-list">${legacyRows}${rows || (legacyRows ? "" : `<div class="dim">装備なし（帳から装備または新規作成）</div>`)}</div>
    <div class="grid2">
      <div class="field"><button class="btn-like wide" data-act="photo-album">📚 マイフォト帳から装備</button></div>
      <div class="field"><button class="btn-like wide" data-act="photo-new">＋ 新規フォト作成</button></div>
    </div>`;
}

function laneCardHtml(i: number): string {
  const l = state.lanes[i]!;
  const lane = (i + 1) as LaneNumber;
  const card = cardOf(l.cardId);
  const resolved = resolveLaneSkills(lane, l.cardId);
  // 【Phase 8-B3】表示用スキル定義: 記録済みレベルがある場合はそのレベルの定義を復元
  const index = DATA.data.skillLevels !== undefined ? buildSkillLevelIndex(DATA.data.skillLevels) : undefined;
  const displaySkills = resolved.skills.map((s) => {
    const want = l.skillLevels[s.id];
    if (want === undefined || want === s.level || DATA.data.skillLevels === undefined) return s;
    const decoded = decodeSkillLevel(DATA.data.skillLevels, s.id, want, index);
    return decoded !== null ? { ...decoded, lane } : s;
  });
  const levels = availableLevels(DATA.data, l.cardId);
  const levelOpts = levels
    .map((lv) => `<option value="${lv}"${lv === l.level ? " selected" : ""}>Lv${lv}</option>`)
    .join("");
  const attr = laneAttributeOf(lane, currentLaneAttrs());
  const hasBond = resolved.skills.length >= 4;
  return `<div class="lane-card" data-lane="${i + 1}">
    <h3>${LANE_LABELS[i]} <span class="attr attr-${attr}">${ATTR_SHORT[attr]}</span></h3>
    <input type="hidden" data-act="card-id" value="${esc(l.cardId)}">
    <div class="card-head">
      ${thumbHtml(l.cardId, cardThumbVariation(l))}
      <div class="card-name">${card ? esc(card.name) : "—"} <span class="dim">☆${card?.initialRarity ?? "?"}・${esc(charName(card?.characterId ?? ""))}</span></div>
    </div>
    <div class="field"><button class="btn-like wide" data-act="pick-card">カードを選択（検索）</button></div>
    ${hasBond ? `<label class="bond-ctrl"><input type="checkbox" data-act="bond"${l.bondAwake ? " checked" : ""}> 絆覚醒（リンクスキル第4択を有効化・アイコン変化）</label>` : ""}
    <div class="grid2">
      <div class="field"><label>レベル</label><select data-act="level">${levelOpts}</select></div>
      <div class="field"><label>開花（現在☆）</label><input type="number" data-act="rarity" min="1" max="10" step="1" value="${l.rarity}"></div>
      <div class="field"><label>交流Lv</label><input type="number" data-act="kouryu" min="1" max="60" step="1" value="${l.kouryu}"></div>
      <div class="field"><label>メンタル（空欄=自動）</label><input type="number" data-act="mental" min="0" step="1" value="${l.mental ?? ""}" placeholder="自動" title="P スキルの発動順（メンタル降順→同値は配置優先度）のみに使用。スコア式には影響しない。空欄で自動算出（100×(1+交流Men%)+スタッフ+エール+装備）、実機の値を入れて上書きも可能"><div class="hint" id="mental-hint-${i + 1}"></div></div>
      <div class="field"><label>ロール（カード固有）</label><span class="chip role-chip role-${l.role.toLowerCase()}">${ROLE_LABEL[l.role]}</span></div>
    </div>
    <div class="deck-preview" id="deck-preview-${i + 1}"></div>
    <details><summary>スキル（A/SP/P ${resolved.skills.length}${hasBond ? `・絆覚醒${l.bondAwake ? "ON" : "OFF"}で第4択${l.bondAwake ? "有効" : "無効"}` : ""}・Lvはカードレベル順守）</summary>${displaySkills
      .map((s, si) => {
        const slotIdx = card ? card.skillIds.indexOf(s.id) : si;
        const locked = skillSlotLocked(slotIdx, l.level);
        return skillRow(
          s,
          l.enabledSkillIds.has(s.id),
          hasBond && si === 3 ? "絆覚醒スキル" : undefined,
          { slotIdx, cardLevel: l.level, locked, maxLevel: maxSkillLevelForSlot(slotIdx, l.level) },
        );
      })
      .join("")}</details>
    <div class="acc-head">アクセサリ（スロット1=Vo/Da/Vi用・スロット2=Sta/Men/Cri用・空き枠クリックで選択）
      ${(() => {
        const hasAcc = parseAccList(l.accessoriesJson)?.length ?? 0;
        return hasAcc > 0 ? `<button class="mini-btn" data-act="acc-clear" title="このキャラのアクセサリを全て装備解除">🗑 全て外す</button>` : "";
      })()}</div>
    ${accessorySlotsHtml(l, i)}
    <div class="grid2">
      <div class="field"><button class="btn-like wide" data-act="auto-acc" title="スロット1に属性一致・スロット2にSta/Men/Criの最高ティアを自動配分">⚡ おまかせ装備</button></div>
      <div class="field"><button class="btn-like wide" data-act="pick-acc">＋ アクセサリ（検索）</button></div>
    </div>
    ${photoEquipHtml(l, i)}
    <details><summary>上級: フォト(JSON)・旧形式の直接編集</summary>
      <div class="note">※ 通常のフォト入力は上の「マイフォト帳」を使用してください。ここは旧形式（verification_data_v2.json 互換）の直接編集用です。</div>
      <div class="field"><textarea data-act="photos-json" rows="4" spellcheck="false">${esc(l.photosJson)}</textarea></div>
    </details>
  </div>`;
}

function numberInputs(
  obj: Record<string, number>,
  keys: readonly string[],
  labels: Record<string, string>,
  act: string,
): string {
  return keys
    .map(
      (k) =>
        `<div class="field"><label>${labels[k] ?? k}</label><input type="number" data-${act}="${k}" value="${obj[k] ?? 0}" step="any"></div>`,
    )
    .join("");
}

const STAFF_LABELS = { vocal: "Vo", dance: "Da", visual: "Vi", stamina: "Sta", mental: "Men", critical: "Cri" };
const YELL_LABELS = {
  vocal_pct: "Vo%",
  dance_pct: "Da%",
  visual_pct: "Vi%",
  stamina: "Sta",
  mental: "Men",
  critical: "Cri",
  beat_score_pct: "ビート%",
  a_skill_score_pct: "A%",
  sp_skill_score_pct: "SP%",
  critical_score_pct: "クリスコ%",
};

function renderConfig(): void {
  const root = $("#config-root");
  root.innerHTML = `
  <div class="panels">
    <div class="panel">
      <h2>共通設定</h2>
      <div class="stage-info" id="stage-info">${stageInfoHtml()}</div>
      <div class="field"><button class="btn-like wide" id="btn-pick-stage">ステージ・曲を選択（検索）</button></div>
      <div class="grid3">
        <div class="field"><label>個人来場ファン数</label><input type="number" id="g-audience" value="${state.audience}" step="1" min="0"></div>
        <div class="field"><label>ファンファクター（‰・手打ち可）</label><input type="number" id="g-fan" value="${state.fanFactorPermil}" step="1" min="0"><div class="hint" id="g-fan-hint"></div></div>
        <div class="field"><label>成功率 基礎値%</label><input type="number" id="g-success" value="${state.successBasePct}" step="1" min="0" max="100"></div>
        <div class="field"><label>基礎クリティカル率</label><input type="number" id="g-crit" value="${state.critRate}" step="0.01" min="0" max="1"></div>
        <div class="field"><label>Monte Carlo 回数</label><input type="number" id="g-runs" value="${state.mcRuns}" step="1" min="1" max="20000"></div>
        <div class="field"><label>乱数シード</label><input type="number" id="g-seed" value="${state.seed}" step="1"></div>
      </div>
      <div class="field"><label>ミスノート（JSON: [{beat,lane}]）</label>
        <textarea id="g-missed" rows="2" spellcheck="false">${esc(state.missedNotesText)}</textarea></div>
      <div class="note">※ クリティカル発生率は Peing 確定仕様（2026-08-30）: 実効率 = min(50%, 基礎率) + クリ率バフ5%/段。
      基礎率はステージ要求値に対する達成率のため UI 設定値（既定 0.50=上限）。20段バフで確定。
      ※ 各レーンのメンタルはスコア式には直接関係せず、P スキルの発動順（メンタル降順・
      同値は配置優先度 センター→左→右→左端→右端）にのみ使用されます。
      既定では自動算出（100×(1+交流Men%)＋スタッフ＋エール＋フォト/アクセ固定値・research/01 §1.4）され、
      レーンのメンタル欄に実機の値を入れると上書きできます。</div>
    </div>
    <div class="panel">
      <h2>スタッフ育成ボーナス</h2>
      <div class="grid3">${numberInputs(
        state.staff as unknown as Record<string, number>,
        ["vocal", "dance", "visual", "stamina", "mental", "critical"],
        STAFF_LABELS,
        "staff",
      )}</div>
      <h2>ライブエール</h2>
      <div class="grid3">${numberInputs(
        state.yell as unknown as Record<string, number>,
        ["vocal_pct", "dance_pct", "visual_pct", "stamina", "mental", "critical", "beat_score_pct", "a_skill_score_pct", "sp_skill_score_pct", "critical_score_pct"],
        YELL_LABELS,
        "yell",
      )}</div>
      <h2>編成の保存・読込</h2>
      <div class="grid2">
        <div class="field"><label>編成名</label><input type="text" id="deck-name" placeholder="例: T5検証編成"></div>
        <div class="field"><label>&nbsp;</label><button class="btn-like wide" id="btn-deck-save">名前を付けて保存</button></div>
      </div>
      <div class="field"><label>保存済み編成（ブラウザ LocalStorage）</label><div id="deck-slots" class="deck-slots"></div></div>
    </div>
  </div>
  <h2>編成（アイドル 5 人）
    <button class="mini-btn" id="btn-clear-all-equip" title="全レーンのフォト（実測/JSON＋マイフォト帳）とアクセサリを全て装備解除">🗑 全レーンのフォト・アクセサリを外す</button>
  </h2>
  <div class="lanes">${state.lanes.map((_, i) => laneCardHtml(i)).join("")}</div>
  <div class="actions">
    <button id="btn-run" class="primary">シミュレーション実行</button>
    <button id="btn-export">編成JSON エクスポート</button>
    <label class="btn-like">編成JSON インポート<input type="file" id="file-import" accept=".json" hidden></label>
    <button id="btn-preset">T5実測プリセットに戻す</button>
    <button id="btn-save">現在状態を自動保存</button>
    <button id="btn-load">自動保存から復元</button>
  </div>
  <div id="status" class="status"></div>`;
  bindConfigEvents();
  bindThumbErrors(root);
  updateFanFactor();
  updateDeckPreviews();
  renderDeckSlots();
}

function readGlobalInputs(): void {
  state.audience = Number(($("#g-audience") as HTMLInputElement).value) || 0;
  state.fanFactorPermil = Math.max(1, Math.round(Number(($("#g-fan") as HTMLInputElement).value) || 1000));
  state.successBasePct = Number(($("#g-success") as HTMLInputElement).value) || 0;
  state.critRate = Number(($("#g-crit") as HTMLInputElement).value) || 0;
  state.mcRuns = Math.max(1, Math.floor(Number(($("#g-runs") as HTMLInputElement).value) || 1));
  state.seed = Math.floor(Number(($("#g-seed") as HTMLInputElement).value) || 1);
  state.missedNotesText = ($("#g-missed") as HTMLTextAreaElement).value;
}

/** ファンファクター input と補助表示を state に同期（手打ち上書きに対応） */
function updateFanFactor(): void {
  const input = $("#g-fan") as HTMLInputElement;
  const hint = $("#g-fan-hint") as HTMLElement;
  input.value = String(state.fanFactorPermil);
  hint.textContent = `+${((state.fanFactorPermil - 1000) / 10).toFixed(1)}%（1000‰=ボーナスなし・来場16,000人で+62.0%）`;
}

function refreshLevelOptions(i: number): void {
  const card = document.querySelector(`.lane-card[data-lane="${i + 1}"]`);
  if (card === null) return;
  const l = state.lanes[i]!;
  const levels = availableLevels(DATA.data, l.cardId);
  const sel = card.querySelector('[data-act="level"]') as HTMLSelectElement;
  sel.innerHTML = levels
    .map((lv) => `<option value="${lv}"${lv === l.level ? " selected" : ""}>Lv${lv}</option>`)
    .join("");
  if (!levels.includes(l.level) && levels.length > 0) {
    l.level = levels[levels.length - 1]!;
    sel.value = String(l.level);
  }
}

/** デッキ値プレビュー（buildSimulateInput と同一経路で計算） */
function updateDeckPreviews(): void {
  try {
    collectAllLaneInputs();
    const built = buildSimulateInput({
      deck: toDeck(),
      stageFile: state.stageId,
      chartFile: state.chartId,
      data: DATA.data,
      mentalOverride: mentalOverride(),
      disabledSkillIds: collectDisabled(),
      userPhotoSkills: collectUserPhotoSkills(),
    });
    built.base.lanes.forEach((laneInput) => {
      const preview = $(`#deck-preview-${laneInput.lane}`);
      // 【Phase 8-B8】ステータス色の法則: Vo=ピンク・Da=青・Vi=黄
      preview.innerHTML =
        `<span class="stat-vocal">Vo ${fmtInt(laneInput.deck.vocal)}</span><span class="stat-dance">Da ${fmtInt(laneInput.deck.dance)}</span>` +
        `<span class="stat-visual">Vi ${fmtInt(laneInput.deck.visual)}</span><span class="stat-stamina">Sta ${fmtInt(laneInput.deck.stamina)}</span>`;
      // メンタルの反映値（空欄=自動算出値・手入力時はその値）を表示
      const mentalHint = document.getElementById(`mental-hint-${laneInput.lane}`);
      if (mentalHint !== null) {
        mentalHint.textContent = `反映値: ${fmtInt(laneInput.deck.mental)}`;
      }
    });
  } catch {
    // 入力が未完成（JSON 不備等）の間はプレビューを更新しない
  }
}

// ---------------------------------------------------------------------------
// 編成の保存・読込（LocalStorage・名前付きスロット）
// ---------------------------------------------------------------------------

const LS_KEY = "aipura-sim-state-v1";
const LS_DECKS_KEY = "aipura-sim-decks-v1";

interface SavedDeck {
  name: string;
  savedAt: string;
  state: string;
}

function listSavedDecks(): SavedDeck[] {
  try {
    return JSON.parse(localStorage.getItem(LS_DECKS_KEY) ?? "[]") as SavedDeck[];
  } catch {
    return [];
  }
}

function renderDeckSlots(): void {
  const el = $("#deck-slots");
  if (el === null) return;
  const decks = listSavedDecks();
  if (decks.length === 0) {
    el.innerHTML = `<span class="dim">保存された編成はありません</span>`;
    return;
  }
  el.innerHTML = decks
    .map(
      (d, i) =>
        `<span class="acc-item"><button class="mini-btn" data-load-deck="${i}" title="読込">▶</button> ${esc(d.name)}
         <span class="dim">${esc(d.savedAt.slice(0, 10))}</span>
         <button class="mini-btn" data-del-deck="${i}" title="削除">✕</button></span>`,
    )
    .join(" ");
}

function serializeState(): string {
  collectAllLaneInputs();
  readGlobalInputs();
  return JSON.stringify({
    ...state,
    lanes: state.lanes.map((l) => ({
      ...l,
      enabledSkillIds: [...l.enabledSkillIds],
      enabledPhotoIds: [...l.enabledPhotoIds],
      disabledUserPhotoSkills: [...l.disabledUserPhotoSkills],
      photoEquip: [...l.photoEquip],
    })),
    myPhotos,
  });
}

function saveState(): void {
  try {
    localStorage.setItem(LS_KEY, serializeState());
  } catch {
    // localStorage 利用不可の環境では無視
  }
}

/** 連続値化された state JSON を適用して再描画する */
function loadSerializedState(raw: string): void {
  const parsed = JSON.parse(raw) as AppState & {
    lanes: Array<LaneUiState & { enabledSkillIds: string[]; enabledPhotoIds: string[]; photoEquip?: string[] }>;
    myPhotos?: MyPhotoDef[];
  };
  state = { ...defaultLaneState(), ...parsed };
  // マイフォト帳の復元（自動保存に含まれる場合）
  if (Array.isArray(parsed.myPhotos) && parsed.myPhotos.length > 0) {
    myPhotos = parsed.myPhotos;
    saveMyPhotos(myPhotos);
  }
  state.lanes = parsed.lanes.map((l) => {
    const lane: LaneUiState = {
      ...l,
      // メンタル: 保存済みの数値は任意上書きとして復元・未保存/ null は自動算出
      mental: l.mental ?? null,
      bondAwake: l.bondAwake ?? false,
      enabledSkillIds: new Set(l.enabledSkillIds),
      enabledPhotoIds: new Set(l.enabledPhotoIds),
      photoEquip: Array.isArray(l.photoEquip) ? l.photoEquip.filter((id) => typeof id === "string") : [],
      disabledUserPhotoSkills: new Set(
        Array.isArray((l as unknown as { disabledUserPhotoSkills?: string[] }).disabledUserPhotoSkills)
          ? (l as unknown as { disabledUserPhotoSkills: string[] }).disabledUserPhotoSkills
          : [],
      ),
      skillLevels: l.skillLevels && typeof l.skillLevels === "object" ? l.skillLevels : {},
    };
    // ロールはカード固有（Card.type 導出）・レベルは現行キャップでクランプ
    lane.role = cardRoleOf(lane.cardId);
    if (lane.level > CURRENT_LEVEL_CAP) lane.level = CURRENT_LEVEL_CAP;
    normalizeAccSlots(lane);
    return lane;
  });
  // 保存時のステージ/譜面を復元（injectStage はファンファクターを触らないため
  // 保存済みの手打ち値・来場者数がそのまま復元される）
  if (state.stageId !== DATA.stageFile) {
    injectStage(state.stageId);
  }
  renderConfig();
}

function loadState(): void {
  const raw = localStorage.getItem(LS_KEY);
  if (raw === null) {
    setStatus("保存された状態はありません", true);
    return;
  }
  try {
    loadSerializedState(raw);
    setStatus("保存した状態を復元しました");
  } catch (e) {
    setStatus(`復元失敗: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

// ---------------------------------------------------------------------------
// イベント束ね
// ---------------------------------------------------------------------------

function setStatus(msg: string, isError = false): void {
  const el = $("#status");
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

function renderLaneCard(i: number): void {
  const el = document.querySelector(`.lane-card[data-lane="${i + 1}"]`);
  if (el === null) return;
  el.outerHTML = laneCardHtml(i);
  updateDeckPreviews();
}

function laneIdxOf(el: Element): number {
  const laneCard = el.closest(".lane-card");
  return laneCard === null ? 0 : Number((laneCard as HTMLElement).dataset.lane) - 1;
}

/** 絆覚醒トグル: 第4スキル（リンクスキル）の有効/無効を切り替えてレーンを再描画 */
function handleBondToggle(i: number): void {
  collectLaneInputs(i);
  const l = state.lanes[i]!;
  const lane = (i + 1) as LaneNumber;
  const resolved = resolveLaneSkills(lane, l.cardId);
  if (resolved.skills.length >= 4) {
    const bondSkillId = resolved.skills[3]!.id;
    if (l.bondAwake) {
      l.enabledSkillIds.add(bondSkillId);
    } else {
      l.enabledSkillIds.delete(bondSkillId);
    }
  } else {
    l.bondAwake = false;
  }
  renderLaneCard(i);
  setStatus(
    l.bondAwake
      ? "絆覚醒 ON: 4つ目のリンクスキルを有効化しました（アイコンも絆覚醒版へ切替）"
      : "絆覚醒 OFF: 通常の3スキル構成に戻しました",
  );
}

/**
 * 設定パネルのイベント束ね（1度だけ #config-root への委任で束ねる）。
 * renderConfig / renderLaneCard で DOM を作り直してもリスナーが生存する
 * （旧実装の「renderLaneCard 後に data-rm-acc 等のリスナーが失われる」問題も解消）。
 */
let configEventsBound = false;

function bindConfigEvents(): void {
  if (configEventsBound) return;
  configEventsBound = true;
  const root = $("#config-root");
  root.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest("#btn-pick-stage")) {
      openStagePicker();
      return;
    }
    if (t.closest('[data-act="pick-card"]')) {
      openCardPicker(laneIdxOf(t.closest('[data-act="pick-card"]')!));
      return;
    }
    if (t.closest('[data-act="auto-acc"]')) {
      autoEquipLane(laneIdxOf(t.closest('[data-act="auto-acc"]')!));
      return;
    }
    // ✕（解除）はスロットの内側にあるため open-acc-slot より先に判定する
    const rmAcc = t.closest("[data-rm-acc]");
    if (rmAcc !== null) {
      const laneIdx = laneIdxOf(rmAcc);
      const rmIdx = Number(rmAcc.getAttribute("data-rm-acc"));
      const l = state.lanes[laneIdx]!;
      const arr = parseAccList(l.accessoriesJson);
      if (arr === null) {
        setStatus("アクセサリ(JSON)の解析に失敗しました", true);
        return;
      }
      arr.splice(rmIdx, 1);
      l.accessoriesJson = JSON.stringify(arr, null, 1);
      renderLaneCard(laneIdx);
      setStatus(`L${laneIdx + 1} のアクセサリを解除しました`);
      return;
    }
    const openSlot = t.closest('[data-act="open-acc-slot"]');
    if (openSlot !== null) {
      const laneIdx = laneIdxOf(openSlot);
      const slotIdx = Number((openSlot as HTMLElement).dataset.slot ?? "0");
      openAccessoryPicker(laneIdx, slotIdx);
      return;
    }
    if (t.closest('[data-act="pick-acc"]')) {
      // 空きスロット（無ければスロット1）を対象にピッカーを開く
      const laneIdx = laneIdxOf(t.closest('[data-act="pick-acc"]')!);
      const items = parseAccList(state.lanes[laneIdx]!.accessoriesJson) ?? [];
      const empty = items.findIndex((it) => it.name === undefined && it.id === undefined);
      const slotIdx = empty >= 0 ? empty : Math.min(items.length, ACC_SLOTS - 1);
      openAccessoryPicker(laneIdx, slotIdx);
      return;
    }
    // 【Phase 8-B】マイフォト装備の操作
    const photoEditBtn = t.closest("[data-photo-edit]");
    if (photoEditBtn !== null) {
      openPhotoEditor(laneIdxOf(photoEditBtn), photoEditBtn.getAttribute("data-photo-edit"));
      return;
    }
    const photoRmBtn = t.closest("[data-photo-rm]");
    if (photoRmBtn !== null) {
      const laneIdx = laneIdxOf(photoRmBtn);
      const rmIdx = Number(photoRmBtn.getAttribute("data-photo-rm"));
      state.lanes[laneIdx]!.photoEquip.splice(rmIdx, 1);
      renderLaneCard(laneIdx);
      setStatus(`L${laneIdx + 1} のフォトを装備解除しました`);
      return;
    }
    // 旧形式（JSON）フォト行の削除
    const photoJsonRmBtn = t.closest("[data-photo-json-rm]");
    if (photoJsonRmBtn !== null) {
      const laneIdx = laneIdxOf(photoJsonRmBtn);
      const rmIdx = Number(photoJsonRmBtn.getAttribute("data-photo-json-rm"));
      const l = state.lanes[laneIdx]!;
      try {
        const arr = parseEquipment(l.photosJson, laneIdx + 1, "フォト(JSON)");
        arr.splice(rmIdx, 1);
        l.photosJson = JSON.stringify(arr, null, 1);
        renderLaneCard(laneIdx);
        setStatus(`L${laneIdx + 1} のフォト（JSON）を削除しました`);
      } catch (e) {
        setStatus(`削除失敗: ${e instanceof Error ? e.message : String(e)}`, true);
      }
      return;
    }
    if (t.closest('[data-act="photo-album"]')) {
      openPhotoAlbum(laneIdxOf(t.closest('[data-act="photo-album"]')!));
      return;
    }
    if (t.closest('[data-act="photo-new"]')) {
      openPhotoEditor(laneIdxOf(t.closest('[data-act="photo-new"]')!), null);
      return;
    }
    // 【Phase 8-B7】一括装備解除（レーン別フォト/アクセサリ・編成全体）
    if (t.closest('[data-act="photo-clear"]')) {
      const i = laneIdxOf(t.closest('[data-act="photo-clear"]')!);
      const l = state.lanes[i]!;
      const n = l.photoEquip.length + (() => {
        try {
          return parseEquipment(l.photosJson, i + 1, "フォト(JSON)").length;
        } catch {
          return 0;
        }
      })();
      l.photosJson = "[]";
      l.photoEquip = [];
      renderLaneCard(i);
      updateDeckPreviews();
      setStatus(`L${i + 1} のフォトを全て装備解除しました（${n} 枚）`);
      return;
    }
    if (t.closest('[data-act="acc-clear"]')) {
      const i = laneIdxOf(t.closest('[data-act="acc-clear"]')!);
      const before = parseAccList(state.lanes[i]!.accessoriesJson)?.length ?? 0;
      state.lanes[i]!.accessoriesJson = "[]";
      renderLaneCard(i);
      updateDeckPreviews();
      setStatus(`L${i + 1} のアクセサリを全て装備解除しました（${before} 件）`);
      return;
    }
    if (t.closest("#btn-clear-all-equip")) {
      let photos = 0;
      let accs = 0;
      state.lanes.forEach((l, i) => {
        photos += l.photoEquip.length;
        l.photoEquip = [];
        try {
          photos += parseEquipment(l.photosJson, i + 1, "フォト(JSON)").length;
        } catch {
          // 破損 JSON は空にして復旧
        }
        l.photosJson = "[]";
        accs += parseAccList(l.accessoriesJson)?.length ?? 0;
        l.accessoriesJson = "[]";
      });
      renderConfig();
      setStatus(`全レーンの装備を解除しました（フォト ${photos} 枚・アクセサリ ${accs} 件）`);
      return;
    }
    // フォトエディタの保存/装備ボタン（モーダル内）
    const photoSaveBtn = t.closest("[data-photo-save]");
    if (photoSaveBtn !== null) {
      savePhotoDraft(photoSaveBtn.getAttribute("data-photo-save") === "equip");
      return;
    }
    const loadDeck = t.closest("[data-load-deck]");
    if (loadDeck !== null) {
      const deck = listSavedDecks()[Number(loadDeck.getAttribute("data-load-deck"))];
      if (deck !== undefined) {
        loadSerializedState(deck.state);
        setStatus(`編成「${deck.name}」を読み込みました`);
      }
      return;
    }
    const delDeck = t.closest("[data-del-deck]");
    if (delDeck !== null) {
      const idx = Number(delDeck.getAttribute("data-del-deck"));
      const decks = listSavedDecks();
      decks.splice(idx, 1);
      localStorage.setItem(LS_DECKS_KEY, JSON.stringify(decks));
      renderDeckSlots();
      setStatus("編成を削除しました");
      return;
    }
    if (t.closest("#btn-run")) {
      runSimulation();
      return;
    }
    if (t.closest("#btn-export")) {
      exportConfig();
      return;
    }
    if (t.closest("#btn-preset")) {
      state = defaultLaneState();
      applyStage(DATA.stageFile);
      setStatus("T5 実測プリセットを復元しました");
      return;
    }
    if (t.closest("#btn-save")) {
      saveState();
      setStatus("ブラウザに保存しました");
      return;
    }
    if (t.closest("#btn-load")) {
      loadState();
      return;
    }
    if (t.closest("#btn-deck-save")) {
      const nameInput = $("#deck-name") as HTMLInputElement;
      const name = nameInput.value.trim() || `編成 ${new Date().toLocaleString("ja-JP")}`;
      const decks = listSavedDecks();
      decks.unshift({ name, savedAt: new Date().toISOString(), state: serializeState() });
      try {
        localStorage.setItem(LS_DECKS_KEY, JSON.stringify(decks));
        renderDeckSlots();
        setStatus(`編成「${name}」を保存しました`);
      } catch (e) {
        setStatus(`保存失敗（容量上限？）: ${e instanceof Error ? e.message : String(e)}`, true);
      }
      return;
    }
  });
  root.addEventListener("input", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (!(t instanceof Element)) return;
    if (t.matches("#g-fan")) {
      // 手打ち中も state を即時更新（再描画はしない・スコアは実行時に反映）
      state.fanFactorPermil = Math.max(1, Math.round(Number((t as HTMLInputElement).value) || 1000));
      const hint = $("#g-fan-hint") as HTMLElement;
      hint.textContent = `+${((state.fanFactorPermil - 1000) / 10).toFixed(1)}%（1000‰=ボーナスなし・来場16,000人で+62.0%）`;
    }
  });
  root.addEventListener("change", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (!(t instanceof Element)) return;
    // ファンファクターの手打ち（input イベント＝タイピング中も即時反映・change は blur 時）
    if (t.matches("#g-fan")) {
      state.fanFactorPermil = Math.max(1, Math.round(Number((t as HTMLInputElement).value) || 1000));
      updateFanFactor();
      return;
    }
    if (t.matches('[data-act="bond"]')) {
      handleBondToggle(laneIdxOf(t));
      return;
    }
    if (t.matches('[data-act="level"]')) {
      collectLaneInputs(laneIdxOf(t));
      // 【Phase 8-B3】カードレベル変更時: 解放されないスキル枠を無効化し、
      // 要求カードレベルを超えるスキルLvを最大可能レベルへクランプ
      const i = laneIdxOf(t);
      const l = state.lanes[i]!;
      const card = cardOf(l.cardId);
      card?.skillIds.forEach((sid, slotIdx) => {
        if (skillSlotLocked(slotIdx, l.level)) {
          l.enabledSkillIds.delete(sid);
          delete l.skillLevels[sid];
          return;
        }
        const maxLv = maxSkillLevelForSlot(slotIdx, l.level);
        const cur = l.skillLevels[sid] ?? maxLv;
        l.skillLevels[sid] = Math.min(cur, maxLv);
        if (l.skillLevels[sid] !== cur) l.enabledSkillIds.add(sid);
      });
      renderLaneCard(i);
      updateDeckPreviews();
      return;
    }
    if (t.matches("select[data-skill-lv]")) {
      collectLaneInputs(laneIdxOf(t));
      renderLaneCard(laneIdxOf(t));
      updateDeckPreviews();
      return;
    }
    if (t.matches('[data-act="rarity"]')) {
      const i = laneIdxOf(t);
      collectAllLaneInputs();
      updateLaneThumb(i);
      updateDeckPreviews();
      return;
    }
    if (t.matches('[data-act="kouryu"], [data-act="mental"]')) {
      collectAllLaneInputs();
      updateDeckPreviews();
      return;
    }
    if (t.matches("input[data-skill]")) {
      updateDeckPreviews();
      return;
    }
    // 【Phase 8-B5】マイフォトスキルの個別有効/無効（装備行のチェックボックス）
    if (t.matches("input[data-user-photo-skill]")) {
      const laneIdx = laneIdxOf(t);
      const l = state.lanes[laneIdx]!;
      const id = t.getAttribute("data-user-photo-skill")!;
      const checked = (t as HTMLInputElement).checked;
      if (checked) l.disabledUserPhotoSkills.delete(id);
      else l.disabledUserPhotoSkills.add(id);
      updateDeckPreviews();
      return;
    }
    if (t.matches("input[data-staff]")) {
      state.staff = {
        ...state.staff,
        [t.dataset.staff!]: Number((t as HTMLInputElement).value) || 0,
      };
      updateDeckPreviews();
      return;
    }
    if (t.matches("input[data-yell]")) {
      state.yell = {
        ...state.yell,
        [t.dataset.yell!]: Number((t as HTMLInputElement).value) || 0,
      };
      updateDeckPreviews();
      return;
    }
    if (t.matches("#g-audience")) {
      state.audience = Math.max(0, Math.floor(Number((t as HTMLInputElement).value) || 0));
      // 来場者数変更時はファンファクターをテーブル引きで再計算（手打ち値は上書きされる）
      if (DATA.data.audienceAdvantage !== undefined) {
        state.fanFactorPermil = fanBonusPermil(state.audience, DATA.data.audienceAdvantage);
      }
      updateFanFactor();
      return;
    }
    if (t.matches("#g-fan")) {
      state.fanFactorPermil = Math.max(1, Math.round(Number((t as HTMLInputElement).value) || 1000));
      updateFanFactor();
      return;
    }
    if (t.matches("#file-import")) {
      importConfig(ev);
      return;
    }
  });
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

interface RunOutput {
  confirmed: { totalScore: number; lanes: LaneBreakdownEntry[] };
  stats: {
    min: number;
    max: number;
    mean: number;
    median: number;
    p10: number;
    p90: number;
    laneMeans: Array<{ lane: number; mean: number }>;
  };
  result: TimelineResult;
  fanFactorPermil: number;
  warnings: string[];
}

let lastOutput: RunOutput | null = null;

function runSimulation(): void {
  try {
    readGlobalInputs();
    collectAllLaneInputs();
    const built = buildSimulateInput({
      deck: toDeck(),
      stageFile: state.stageId,
      chartFile: state.chartId,
      data: DATA.data,
      // ファンファクターは手打ち可能な state 値を直接使用（audience は導出元の表示値）
      fanFactorPermil: state.fanFactorPermil,
      successBasePermil: Math.round(state.successBasePct * 10),
      missedNotes: missedNotes(),
      mentalOverride: mentalOverride(),
      disabledSkillIds: collectDisabled(),
      baseCritRate: state.critRate,
      userPhotoSkills: collectUserPhotoSkills(),
    });
    const base = built.base;

    // 確定値ラン（乱数中立・クリティカルなし）
    const confirmedRes = simulateTimeline({
      ...base,
      baseCritRate: undefined,
      rng: new NeutralRng(),
      criticalProvider: () => false,
    });
    const confirmed = {
      totalScore: confirmedRes.totalScore,
      lanes: laneBreakdown(confirmedRes.beats),
    };

    // Monte Carlo（シード固定・連続値乱数・クリティカルは Peing 確定式で動的抽選）
    const runs = state.mcRuns;
    const scores: number[] = [];
    const laneSums = new Map<number, number>();
    for (let i = 0; i < runs; i++) {
      const rng = new ContinuousRng(state.seed + i);
      const res = simulateTimeline({ ...base, rng, criticalProvider: () => false });
      scores.push(res.totalScore);
      for (const bt of res.beats) {
        for (const e of bt.events) {
          laneSums.set(e.lane, (laneSums.get(e.lane) ?? 0) + e.gainedScore);
        }
      }
    }
    scores.sort((a, b) => a - b);
    const pct = (p: number): number =>
      scores[Math.min(scores.length - 1, Math.max(0, Math.round((scores.length - 1) * p)))]!;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

    lastOutput = {
      confirmed,
      stats: {
        min: scores[0]!,
        max: scores[scores.length - 1]!,
        mean,
        median: pct(0.5),
        p10: pct(0.1),
        p90: pct(0.9),
        laneMeans: [...laneSums.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([lane, sum]) => ({ lane, mean: sum / runs })),
      },
      result: confirmedRes,
      fanFactorPermil: base.fanFactorPermil,
      warnings: built.warnings,
    };
    $("#results").hidden = false;
    renderResults();
    setStatus(
      `完了: 確定値 ${fmtScore(confirmed.totalScore)} ／ MC ${runs}回 mean ${fmtScore(mean)}` +
        (built.warnings.length > 0 ? ` ／ 警告 ${built.warnings.length}件（コンソール参照）` : ""),
    );
    for (const w of built.warnings) {
      console.warn("[warn]", w);
    }
    saveState();
  } catch (e) {
    setStatus(`エラー: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

// ---------------------------------------------------------------------------
// 描画: 結果
// ---------------------------------------------------------------------------

function renderResults(): void {
  const out = lastOutput;
  if (out === null) return;
  const s = out.stats;
  $("#kpi-root").innerHTML = `
    <div class="kpi"><div class="kpi-label">確定値（乱数1000・critなし）</div><div class="kpi-value confirmed">${fmtScore(out.confirmed.totalScore)}</div><div class="kpi-sub">${fmtInt(out.confirmed.totalScore)}</div></div>
    <div class="kpi"><div class="kpi-label">期待値（MC mean・クリティカル込）</div><div class="kpi-value">${fmtScore(s.mean)}</div><div class="kpi-sub">${fmtInt(s.mean)}</div></div>
    <div class="kpi"><div class="kpi-label">中央値</div><div class="kpi-value">${fmtScore(s.median)}</div><div class="kpi-sub">${fmtInt(s.median)}</div></div>
    <div class="kpi"><div class="kpi-label">10-90% レンジ</div><div class="kpi-value sm">${fmtScore(s.p10)} 〜 ${fmtScore(s.p90)}</div><div class="kpi-sub">±5% スコア乱数</div></div>
    <div class="kpi"><div class="kpi-label">min / max</div><div class="kpi-value sm">${fmtScore(s.min)} / ${fmtScore(s.max)}</div><div class="kpi-sub">${fmtInt(s.min)} / ${fmtInt(s.max)}</div></div>`;
  renderLaneTable();
  drawScoreGraph();
  renderBuffPanel();
  renderTimelineTable();
}

function renderLaneTable(): void {
  const out = lastOutput!;
  const rows = out.confirmed.lanes
    .map((l) => {
      const ui = state.lanes[l.lane - 1]!;
      const card = cardOf(ui.cardId);
      const mean = out.stats.laneMeans.find((m) => m.lane === l.lane)?.mean ?? 0;
      const share = ((l.total / out.confirmed.totalScore) * 100).toFixed(1);
      return `<tr>
      <td>L${l.lane}</td><td>${card ? esc(card.name) : "—"}</td><td>${esc(ui.role)}</td>
      <td class="num">${fmtInt(l.total)}</td><td class="num">${share}%</td><td class="num">${fmtInt(mean)}</td>
      <td class="num">${fmtInt(l.byKind.beat)}</td><td class="num">${fmtInt(l.byKind.A)}</td>
      <td class="num">${fmtInt(l.byKind.SP)}</td><td class="num">${fmtInt(l.byKind.photo)}</td>
      <td class="num">${fmtInt(l.byKind.P)}</td><td class="num">${l.activations}</td></tr>`;
    })
    .join("");
  $("#lane-table").innerHTML = `<thead><tr>
    <th>レーン</th><th>カード</th><th>ロール</th><th>確定値合計</th><th>構成比</th><th>MC平均</th>
    <th>ビート</th><th>A</th><th>SP</th><th>フォト</th><th>P</th><th>発動数</th>
  </tr></thead><tbody>${rows}</tbody>`;
}

function drawScoreGraph(): void {
  const canvas = $("#score-graph") as HTMLCanvasElement;
  const beats = lastOutput!.result.beats;
  let cum = 0;
  const points: Array<[number, number]> = [[0, 0]];
  for (const bt of beats) {
    cum += bt.events.reduce((s, e) => s + e.gainedScore, 0);
    points.push([bt.beat, cum]);
  }
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = 300;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  const padL = 70;
  const padB = 28;
  const padT = 12;
  const padR = 12;
  const maxB = beats[beats.length - 1]?.beat ?? 1;
  const maxS = points[points.length - 1]![1] || 1;
  const x = (b: number): number => padL + ((cssW - padL - padR) * b) / maxB;
  const y = (v: number): number => padT + (cssH - padT - padB) * (1 - v / maxS);
  ctx.strokeStyle = "#ddd";
  ctx.fillStyle = "#666";
  ctx.font = "11px sans-serif";
  for (let g = 0; g <= 5; g++) {
    const v = (maxS * g) / 5;
    ctx.beginPath();
    ctx.moveTo(padL, y(v));
    ctx.lineTo(cssW - padR, y(v));
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(fmtScore(v), padL - 6, y(v) + 4);
  }
  for (let b = 0; b <= maxB; b += Math.max(1, Math.floor(maxB / 10))) {
    ctx.textAlign = "center";
    ctx.fillText(String(b), x(b), cssH - 10);
  }
  ctx.strokeStyle = "#4a6fd4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [b, v] of points) {
    if (b === 0) ctx.moveTo(x(b), y(v));
    else ctx.lineTo(x(b), y(v));
  }
  ctx.stroke();
  ctx.fillStyle = "#4a6fd4";
  ctx.textAlign = "left";
  ctx.fillText(`最終 ${fmtScore(maxS)}`, Math.max(padL, x(maxB) - 90), y(maxS) + 14);
}

const BUFF_KEYS: BuffKey[] = [
  "vocal_up",
  "vocal_boost",
  "vocal_up_extreme",
  "dance_up",
  "dance_boost",
  "visual_up",
  "visual_boost",
  "beat_score_up",
  "tension_up",
  "score_up",
  "a_skill_score_up",
  "sp_skill_score_up",
  "combo_score_up",
  "critical_coeff_up",
  "critical_rate_up",
  "stamina_cost_down",
  "skill_success_up",
  "focus",
  "combo_continue",
];

function renderBuffPanel(): void {
  const sel = $("#buff-lane") as HTMLSelectElement;
  if (sel.options.length === 0) {
    sel.innerHTML = LANE_LABELS.map((t, i) => `<option value="${i + 1}">${t}</option>`).join("");
    sel.value = "3";
    const keys = $("#buff-keys") as HTMLElement;
    keys.innerHTML = BUFF_KEYS.map(
      (k) => `<label class="buff-key"><input type="checkbox" data-buffkey="${k}" checked> ${k}</label>`,
    ).join("");
    keys.addEventListener("change", renderBuffHeatmap);
    sel.addEventListener("change", renderBuffHeatmap);
  }
  renderBuffHeatmap();
}

function renderBuffHeatmap(): void {
  const out = lastOutput;
  if (out === null) return;
  const lane = Number(($("#buff-lane") as HTMLSelectElement).value);
  const keys = [...document.querySelectorAll<HTMLInputElement>("input[data-buffkey]")]
    .filter((el) => el.checked)
    .map((el) => el.dataset.buffkey as BuffKey);
  const maxByKey = new Map<BuffKey, number>();
  for (const bt of out.result.beats) {
    const snap = bt.buffSnapshots[lane - 1]!;
    for (const k of keys) {
      maxByKey.set(k, Math.max(maxByKey.get(k) ?? 0, snap[k] ?? 0));
    }
  }
  const head = `<tr><th>key＼beat</th>${out.result.beats.map((bt) => `<th>${bt.beat}</th>`).join("")}</tr>`;
  const body = keys
    .map((k) => {
      const max = Math.max(1, maxByKey.get(k) ?? 1);
      const hue = k.includes("vocal") || k.includes("tension") ? 340 : k.includes("critical") ? 45 : 210;
      const cells = out.result.beats
        .map((bt) => {
          const v = bt.buffSnapshots[lane - 1]![k] ?? 0;
          const alpha = (v / max) * 0.85;
          return `<td class="buff-cell" style="background:hsla(${hue},70%,50%,${alpha.toFixed(3)})" title="b${bt.beat} ${k}=${v}">${v > 0 ? v : ""}</td>`;
        })
        .join("");
      return `<tr><th>${k}</th>${cells}</tr>`;
    })
    .join("");
  $("#buff-heatmap").innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

const TYPE_LABEL: Record<number, string> = { 1: "ビート", 2: "A", 3: "SP" };

function renderTimelineTable(): void {
  const out = lastOutput!;
  let cum = 0;
  const rows = out.result.beats
    .map((bt) => {
      const perLane = new Map<number, { sum: number; crit: boolean }>();
      for (const e of bt.events) {
        const cur = perLane.get(e.lane) ?? { sum: 0, crit: false };
        cur.sum += e.gainedScore;
        cur.crit = cur.crit || e.critFactorPermil > 1000;
        perLane.set(e.lane, cur);
      }
      const gained = bt.events.reduce((s, e) => s + e.gainedScore, 0);
      cum += gained;
      const cells = [1, 2, 3, 4, 5]
        .map((lane) => {
          const v = perLane.get(lane);
          if (v === undefined || v.sum === 0) return `<td class="num dim">—</td>`;
          return `<td class="num${v.crit ? " crit" : ""}">${fmtScore(v.sum)}${v.crit ? "★" : ""}</td>`;
        })
        .join("");
      const acts = bt.activations
        .map((a) => {
          const skill =
            DATA.data.skillsGolden.find((s) => s.id === a.skillId) ??
            Object.values((DATA.data.skillsByCard as unknown as Record<string, SkillDef[]>) ?? {})
              .flat()
              .find((s) => s.id === a.skillId);
          const name = skill ? skill.name : a.skillId;
          return `<span class="act ${a.success ? "ok" : "ng"}" title="${esc(name)}（${a.kind}・${a.phase}${a.staminaCost != null ? `・消費${a.staminaCost}` : ""}${a.failReason ? `・${a.failReason}` : ""}）">${esc(shortName(name))}${a.success ? "" : "✕"}</span>`;
        })
        .join(" ");
      return `<tr><td>${bt.beat}</td><td><span class="kind kind-${bt.noteType === 1 ? "beat" : bt.noteType === 2 ? "A" : "SP"}">${TYPE_LABEL[bt.noteType]}</span></td>
        ${cells}<td class="num">${fmtScore(gained)}</td><td class="num">${fmtScore(cum)}</td><td class="acts">${acts}</td></tr>`;
    })
    .join("");
  $("#timeline-table").innerHTML = `<thead><tr>
    <th>beat</th><th>種別</th><th>L1</th><th>L2</th><th>L3</th><th>L4</th><th>L5</th><th>獲得</th><th>累積</th><th>発動</th>
  </tr></thead><tbody>${rows}</tbody>`;
}

function shortName(name: string): string {
  return name.length > 8 ? name.slice(0, 8) + "…" : name;
}

// ---------------------------------------------------------------------------
// インポート / エクスポート
// ---------------------------------------------------------------------------

function exportConfig(): void {
  try {
    readGlobalInputs();
    collectAllLaneInputs();
    const config = {
      deck: toDeck(),
      stage: { file: state.stageId },
      chart: { file: state.chartId },
      // ファンファクターは手打ち値をそのままエクスポート（CLI の fanFactorPermil と相互運用）。
      // audience を併せて出力すると CLI 側で audience が優先され上書きが失われるため出力しない
      fanFactorPermil: state.fanFactorPermil,
      successBasePermil: Math.round(state.successBasePct * 10),
      missedNotes: missedNotes(),
      mentalOverride: mentalOverride(),
      disabledSkillIds: collectDisabled(),
      critRate: state.critRate,
      // 【Phase 8-B】マイフォト帳と装備状態（UI 再インポート用。
      // deck.characters[].photos には structured 変換済みのフォトが含まれるため CLI でも再現可。
      // フォトスキルは CLI では反映されない（data/skills_golden.json の photo のみ））
      myPhotos,
      photoEquip: state.lanes.map((l) => l.photoEquip),
    };
    const blob = new Blob([JSON.stringify(config, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "aipura-sim-config.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("編成JSONをエクスポートしました（npm run simulate -- --input で利用可）");
  } catch (e) {
    setStatus(`エクスポート失敗: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

function importConfig(ev: Event): void {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (file === undefined) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      applyConfig(JSON.parse(String(reader.result)));
      setStatus(`インポート完了: ${file.name}`);
    } catch (e) {
      setStatus(`インポート失敗: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  };
  reader.readAsText(file);
}

function applyConfig(cfg: Record<string, unknown> & { characters?: unknown }): void {
  state = defaultLaneState();
  // 【Phase 8-B】マイフォト帳の復元（エクスポートに含まれる場合）
  if (Array.isArray(cfg.myPhotos)) {
    myPhotos = (cfg.myPhotos as MyPhotoDef[]).filter((p) => p && typeof p.id === "string");
    saveMyPhotos(myPhotos);
  }
  if (typeof cfg.stage === "object" && cfg.stage !== null) {
    const stageFile = (cfg.stage as { file?: string }).file;
    if (typeof stageFile === "string" && DATA.stagesIndex.quests.some((q) => q.id === stageFile)) {
      state.stageId = stageFile;
    }
  }
  applyStage(state.stageId);
  if (cfg.staff_bonus !== undefined) state.staff = cfg.staff_bonus as AppState["staff"];
  if (cfg.yale_bonus !== undefined) state.yell = cfg.yale_bonus as AppState["yell"];
  if (Array.isArray(cfg.characters)) {
    for (const chRaw of cfg.characters) {
      const ch = chRaw as Record<string, unknown> & { lane: number };
      const l = state.lanes[ch.lane - 1];
      if (l === undefined) continue;
      if (ch.card_id !== undefined) {
        l.cardId = String(ch.card_id);
        // スキルはカードに連動して自動セット（Phase 6）
        const resolved = resolveLaneSkills(ch.lane as LaneNumber, l.cardId);
        l.enabledSkillIds = new Set(resolved.skills.map((s) => s.id));
      }
      if (ch.level !== undefined) {
        l.level = Math.min(Number(ch.level) || 1, CURRENT_LEVEL_CAP);
      }
      if (ch.rarity !== undefined) l.rarity = Number(ch.rarity);
      if (ch.kouryu_level !== undefined) l.kouryu = Number(ch.kouryu_level);
      // 【Phase 8-B3】スキルLv上書きの復元（deck JSON の skill_levels）
      l.skillLevels =
        ch.skill_levels && typeof ch.skill_levels === "object"
          ? { ...(ch.skill_levels as Record<string, number>) }
          : {};
      // ロールはカード固有（Card.type 導出）。設定ファイルの role 値は無視する
      l.role = cardRoleOf(l.cardId);
      if (Array.isArray(ch.photos)) l.photosJson = JSON.stringify(ch.photos, null, 1);
      if (Array.isArray(ch.accessories)) {
        l.accessoriesJson = JSON.stringify(ch.accessories, null, 1);
        normalizeAccSlots(l);
      }
    }
  }
  if (typeof cfg.fanFactorPermil === "number") {
    state.fanFactorPermil = cfg.fanFactorPermil;
  } else if (typeof cfg.audience === "number" && DATA.data.audienceAdvantage !== undefined) {
    // 旧スキーマ（audience 指定）との互換: テーブル引きで導出
    state.fanFactorPermil = fanBonusPermil(Math.max(0, Math.floor(cfg.audience)), DATA.data.audienceAdvantage);
  }
  if (typeof cfg.audience === "number") state.audience = cfg.audience;
  if (typeof cfg.critRate === "number") state.critRate = cfg.critRate;
  if (typeof cfg.successBasePermil === "number") state.successBasePct = cfg.successBasePermil / 10;
  if (Array.isArray(cfg.missedNotes)) state.missedNotesText = JSON.stringify(cfg.missedNotes);
  if (cfg.mentalOverride !== undefined && typeof cfg.mentalOverride === "object") {
    for (const [k, v] of Object.entries(cfg.mentalOverride as Record<string, unknown>)) {
      const l = state.lanes[Number(k) - 1];
      if (l !== undefined) l.mental = Number(v);
    }
  }
  const disabled = new Set<string>((cfg.disabledSkillIds as string[] | undefined) ?? []);
  if (disabled.size > 0) {
    state.lanes.forEach((l, i) => {
      const lane = (i + 1) as LaneNumber;
      const resolved = resolveLaneSkills(lane, l.cardId);
      for (const s of resolved.skills) {
        if (disabled.has(s.id)) l.enabledSkillIds.delete(s.id);
      }
      for (const s of resolved.photos) {
        if (disabled.has(s.id)) l.enabledPhotoIds.delete(s.id);
      }
    });
  }
  // 【Phase 8-B】フォト装備の復元（帳に存在する ID のみ・レーン毎）
  if (Array.isArray(cfg.photoEquip)) {
    (cfg.photoEquip as unknown[]).forEach((ids, i) => {
      const l = state.lanes[i];
      if (l === undefined || !Array.isArray(ids)) return;
      l.photoEquip = (ids as string[]).filter((id) => typeof id === "string" && photoById(id) !== undefined);
    });
  }
  renderConfig();
}

// ---------------------------------------------------------------------------
// オプティマイザタブ（🌟 最適編成を自動探索・Phase 7）
// ---------------------------------------------------------------------------

let optEntries: OptimizerEntry[] = [];
let optRunning = false;

function switchTab(tab: "sim" | "opt"): void {
  const sim = $("#view-sim");
  const opt = $("#view-opt");
  const tabSim = $("#tab-sim");
  const tabOpt = $("#tab-opt");
  if (tab === "sim") {
    sim.hidden = false;
    opt.hidden = true;
    tabSim.classList.add("active");
    tabOpt.classList.remove("active");
  } else {
    sim.hidden = true;
    opt.hidden = false;
    tabSim.classList.remove("active");
    tabOpt.classList.add("active");
    renderOptConstraints();
  }
}

function renderOptConstraints(): void {
  $("#opt-stage-info").innerHTML = stageInfoHtml();
  $("#opt-constraints").innerHTML = `
    ${state.lanes
      .map((l, i) => {
        const card = cardOf(l.cardId);
        return `<div class="opt-lane-ctrl">
        <label><input type="checkbox" id="opt-lock-${i}"> L${i + 1} 固定</label>
        <span class="dim">${esc(card?.name ?? l.cardId)}</span>
        <select id="opt-attr-${i}">
          <option value="">属性:自由</option>
          <option value="vocal">Vo限定</option>
          <option value="dance">Da限定</option>
          <option value="visual">Vi限定</option>
        </select>
      </div>`;
      })
      .join("")}
    <div class="opt-lane-ctrl">
      <label>必須採用（レーン自由・どこかに入る）</label>
      <select id="opt-required">
        <option value="">なし</option>
        ${DATA.data.cards
          .map((c) => `<option value="${esc(c.id)}">${esc(charName(c.characterId))}・${esc(c.name)}（☆${c.initialRarity}）</option>`)
          .join("")}
      </select>
    </div>
    <div class="opt-lane-ctrl opt-photo-ctrl">
      <label><input type="checkbox" id="opt-use-photos"> フォトを含めて探索（マイフォト帳のタグ指定プールから自動配分）</label>
      <span id="opt-photo-tags">${allPhotoTags()
        .map(
          (t, i) =>
            `<label class="tag-chip"><input type="checkbox" data-opt-tag="${esc(t)}"${i === 0 ? " checked" : ""}> ${esc(t)}</label>`,
        )
        .join("") || `<span class="dim">（フォトなし）</span>`}</span>
    </div>
    <div class="note">※ フォト込み評価は「装備=フォトのみ・交流Lv1・メンタル100・全員Scorer」の共通前提で行います
    （アクセサリ・交流は対象外）。レタッチ1枚制限・1人最大5枚は自動で厳守されます。</div>`;
}

function optNum(id: string, dflt: number): number {
  const el = document.getElementById(id) as HTMLInputElement | null;
  const v = Number(el?.value);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

async function runOptimizer(): Promise<void> {
  if (optRunning) return;
  optRunning = true;
  ($("#btn-optimize") as HTMLButtonElement).disabled = true;
  try {
    readGlobalInputs();
    collectAllLaneInputs();
    const lockedCardIds = [0, 1, 2, 3, 4].map((i) => {
      const cb = document.getElementById(`opt-lock-${i}`) as HTMLInputElement | null;
      return cb?.checked ? state.lanes[i]!.cardId : null;
    });
    const attrFilter = [0, 1, 2, 3, 4].map((i) => {
      const sel = document.getElementById(`opt-attr-${i}`) as HTMLSelectElement | null;
      return (sel?.value || null) as "vocal" | "dance" | "visual" | null;
    });
    // 【Phase 8-C】必須採用カード・タグ指定フォトプール
    const reqSel = document.getElementById("opt-required") as HTMLSelectElement | null;
    const requiredCardId = reqSel && reqSel.value !== "" ? reqSel.value : null;
    const usePhotos = (document.getElementById("opt-use-photos") as HTMLInputElement | null)?.checked ?? false;
    const selectedTags = [
      ...document.querySelectorAll<HTMLInputElement>("#opt-photo-tags input[data-opt-tag]"),
    ]
      .filter((el) => el.checked)
      .map((el) => el.dataset.optTag!);
    // 選択タグのいずれかを持つフォトをプール化（タグ未選択なら全フォト）
    const photoPool = usePhotos
      ? myPhotos.filter((p) => selectedTags.length === 0 || p.tags.some((t) => selectedTags.includes(t)))
      : [];
    $("#opt-results").innerHTML = `<div class="dim">探索中…（進捗は下のステータス行に表示）</div>`;
    $("#opt-progress").textContent = "準備中…";
    const res = await optimizeLineup({
      data: DATA.data,
      stageFile: state.stageId,
      chartFile: state.chartId,
      laneAttributes: currentLaneAttrs(),
      audience: state.audience > 0 ? state.audience : undefined,
      successBasePermil: Math.round(state.successBasePct * 10),
      baseCritRate: state.critRate,
      poolSize: Math.floor(optNum("opt-pool", 28)),
      screenRuns: Math.floor(optNum("opt-screen-runs", 3)),
      finalRuns: Math.floor(optNum("opt-final-runs", 12)),
      seed: Math.floor(optNum("opt-seed", 1)),
      topN: Math.floor(optNum("opt-topn", 5)),
      timeBudgetMs: optNum("opt-budget-sec", 20) * 1000,
      lockedCardIds,
      attrFilter,
      requiredCardId,
      photoPool,
      onProgress: (p) => {
        $("#opt-progress").textContent = `${p.phase}：編成評価 ${p.evaluations} 回／現状最高 ${fmtScore(p.best)}`;
      },
    });
    optEntries = res.entries;
    renderOptResults(res);
    $("#opt-progress").textContent = `探索完了: 評価 ${res.evaluations} 回・${(res.elapsedMs / 1000).toFixed(1)} 秒${res.truncated ? "（時間予算で打切）" : ""}`;
    setStatus(`最適編成探索完了: TOP${res.entries.length} を表示（評価 ${res.evaluations} 回）`);
  } catch (e) {
    $("#opt-progress").textContent = "";
    $("#opt-results").innerHTML = "";
    setStatus(`探索エラー: ${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    optRunning = false;
    ($("#btn-optimize") as HTMLButtonElement).disabled = false;
  }
}

function renderOptResults(res: OptimizerResult): void {
  const el = $("#opt-results");
  if (res.entries.length === 0) {
    el.innerHTML = `<div class="note error-note">編成候補を構築できませんでした（属性縛り・固定の制約が厳しすぎます）</div>`;
    return;
  }
  el.innerHTML =
    res.entries
      .map((e, idx) => {
        const cards = e.cardIds
          .map((cid, i) => {
            const card = cardOf(cid);
            const a = card ? cardAttr(card) : "vocal";
            const photoId = e.photoIds?.[i] ?? null;
            const photo = photoId !== null ? photoById(photoId) : undefined;
            const photoChip =
              photo !== undefined
                ? ` <span class="chip tag-chip" title="${esc(photoSummary(photo))}">📷 ${esc(photo.name || "(無題)")}</span>`
                : "";
            return `<li>${thumbHtml(cid, 1, "thumb-sm")}<span class="attr attr-${a}">${ATTR_SHORT[a]}</span> ${esc(card?.name ?? cid)} <span class="dim">${LANE_LABELS[i]}</span>${photoChip}</li>`;
          })
          .join("");
        return `<div class="opt-entry" data-cards="${esc(e.cardIds.join(","))}">
          <div class="opt-rank">#${idx + 1}</div>
          <div class="opt-main">
            <div class="opt-score">MC平均 <b>${fmtScore(e.score)}</b> <span class="dim">（確定値 ${fmtScore(e.confirmed)}）</span></div>
            <ol class="opt-cards">${cards}</ol>
          </div>
          <button class="primary" data-apply-lineup="${idx}">この編成を反映</button>
        </div>`;
      })
      .join("") +
    (res.truncated ? `<div class="dim">※ 時間予算に達したため探索を打ち切りました（設定で予算を伸ばすと改善する場合があります）</div>` : "") +
    `<div class="dim">※ 候補プール ${res.pool.length} 枚（ヒューリスティック事前選別）・評価条件: アクセサリなし/交流Lv1/メンタル100/全員Scorer${
      res.entries.some((e) => (e.photoIds ?? []).some((p) => p !== null)) ? "・フォト配分はタグ指定プールからの貪欲割当（レタッチ1枚厳守）" : ""
    }</div>`;
  bindThumbErrors(el);
}

/** オプティマイザ結果 → 編成エディタへ一括反映 */
function applyLineupEntry(e: OptimizerEntry): void {
  state.lanes = e.cardIds.map((cid, i) => laneStateFromCard(i, cid));
  // フォト配分も反映（レタッチ制限は探索時に厳守済み）
  state.lanes.forEach((l, i) => {
    const pid = e.photoIds?.[i] ?? null;
    if (pid !== null && photoById(pid) !== undefined) {
      l.photoEquip.push(pid);
    }
  });
  switchTab("sim");
  renderConfig();
  setStatus("オプティマイザの結果を編成に反映しました（シミュレーション実行で詳細を確認できます）");
}

/** カードIDから装備なしの初期 LaneUiState を構築（オプティマイザ反映用） */
function laneStateFromCard(i: number, cardId: string): LaneUiState {
  const resolved = resolveLaneSkills((i + 1) as LaneNumber, cardId);
  const levels = availableLevels(DATA.data, cardId);
  const cardLevel = levels.length > 0 ? levels[levels.length - 1]! : 1;
  const skillLevels: Record<string, number> = {};
  cardOf(cardId)?.skillIds.forEach((sid, slotIdx) => {
    skillLevels[sid] = maxSkillLevelForSlot(slotIdx, cardLevel);
  });
  return {
    cardId,
    level: cardLevel,
    rarity: DEFAULT_RARITY,
    kouryu: 1,
    role: cardRoleOf(cardId),
    mental: null,
    bondAwake: false,
    enabledSkillIds: new Set(resolved.skills.slice(0, 3).map((s) => s.id)),
    enabledPhotoIds: new Set(),
    photosJson: "[]",
    accessoriesJson: "[]",
    photoEquip: [],
    disabledUserPhotoSkills: new Set(),
    skillLevels,
  };
}

// ---------------------------------------------------------------------------
// 初期化
// ---------------------------------------------------------------------------

function confidenceHtml(): string {
  return `
  <dl class="conf-list">
    <dt><span class="badge badge-c">Confirmed</span></dt>
    <dd>スコア乱数 ±5% 連続値／at-end 丸め／ビート基本式（総和×8/140）／B1・CB・ファン・クリティカル係数／
    CT 規則（発動時満タン・前半実効 CT−1）／対象解決（スコアラー・vocal 降順・隣接）／
    combo&gt;=N はグローバル成功数／増強=キー毎最長・延長=全インスタンス／バフ超過分の内部保持。
    クリティカル発生率式（Peing確定 2026-08-30: min(50%, 基礎率) + クリ率バフ5%/段・20段確定）。
    実測 1 ライブ（STAGE19）で総スコア 1 の位まで検証済み。</dd>
    <dt><span class="badge badge-e">Estimate</span></dt>
    <dd>P/フォトのスコア重み=1000‰／成功率の副効果（テンション −1.5%/段）／
    発動候補の配列順ルール／スコア乱数とクリティカルの抽選順／
    マスタ自動解析スキル（data/skills_master.json・効果値は実測較正なし）／
    dance/visual バフ・beat_score_up（vocal 対称の実装・実測に同型なし）／
    buffer/supporter_type・dance/visual_type ターゲット。</dd>
    <dt><span class="badge badge-u">Unknown</span></dt>
    <dd>ステージ別のクリティカル要求値（基礎率は UI 設定値で代替）／type36 の perStagePermil
    （実測較正は 2 スキルのみ）／条件参照スコア（more_combo_count 等は常時発動で近似）／
    個人来場ファン数の算出式／ミスノート時の再挑戦仕様。</dd>
  </dl>`;
}

function init(): void {
  state.stageId = DATA.stageFile;
  state.chartId = DATA.chartFile;
  // マイフォト帳の初期化（初回は T5 実測フォト + 理論値/実用テンプレートを同梱）
  myPhotos = loadMyPhotos();
  renderConfig();
  $("#confidence-body").innerHTML = confidenceHtml();
  $("#built-at").textContent = DATA.builtAt;
  // タブ切替
  $("#tab-sim").addEventListener("click", () => switchTab("sim"));
  $("#tab-opt").addEventListener("click", () => switchTab("opt"));
  $("#btn-optimize").addEventListener("click", () => {
    void runOptimizer();
  });
  // オプティマイザ結果の「この編成を反映」（#opt-results は静的コンテナなので委任で束ねる）
  $("#opt-results").addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest("[data-apply-lineup]");
    if (btn === null) return;
    const e = optEntries[Number(btn.getAttribute("data-apply-lineup"))];
    if (e !== undefined) applyLineupEntry(e);
  });
}

init();

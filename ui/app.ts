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

/** 効果行の短い要約（スキル一覧表示用） */
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
      return `延長+${e.value ?? 0}`;
    case "effect_amplify":
      return `増強+${e.value ?? 0}`;
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

/** 現在の UI 状態 → 編成（verification_data_v2.json と同一スキーマ） */
function toDeck(): DeckJsonV2 {
  const characters = state.lanes.map((l, i) => {
    const lane = (i + 1) as LaneNumber;
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
      photos: parseEquipment(l.photosJson, lane, "フォト(JSON)"),
      accessories: parseEquipment(l.accessoriesJson, lane, "アクセサリ(JSON)"),
    };
  });
  return { staff_bonus: { ...state.staff }, yale_bonus: { ...state.yell }, characters };
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
    for (const s of resolved.skills) {
      if (!l.enabledSkillIds.has(s.id)) out.push(s.id);
    }
    for (const s of resolved.photos) {
      if (!l.enabledPhotoIds.has(s.id)) out.push(s.id);
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
  openModal(`
    <div class="modal-head"><h3>アクセサリ選択（L${laneIdx + 1}・スロット${slotIdx + 1}・全${DATA.accessories.length}件）</h3>
      <button data-close>閉じる</button></div>
    <div class="sp-tabs" id="ap-tabs">${ACC_TABS.map(
      (t, i) => `<button type="button" data-cls="${t.cls}"${i === 0 ? ' class="active"' : ""}>${t.label}</button>`,
    ).join("")}</div>
    <div class="modal-filters">
      <input type="search" id="ap-search" placeholder="アクセサリ名・キャラ名・効果で検索…">
      <select id="ap-rarity"><option value="">レアリティ:すべて</option>${[1, 2, 3, 4, 5]
        .map((r) => `<option value="${r}">★${r}</option>`)
        .join("")}</select>
    </div>
    <div id="ap-list" class="modal-list"></div>
    <div class="note">※ アイコンはローカル同梱（./images/accessories/）→ INFO PRIDE CDN（img_acc_thumb_{assetId}）の順で読み込み、両方不可の場合は種別チップ（Vo/Da/Vi/Sta/Men/Cri）を表示します。限界突破・専用スピリットは分類のベース画像（img_acc_thumb_{分類}-f）へフォールバックします。</div>`);
  let classFilter = "";
  // 専用（キャラ指定）アクセサリはそのキャラにしか装備できないため、
  // レーンのカードキャラ以外の専用品は全タブで非表示にする
  const laneCharId = cardOf(state.lanes[laneIdx]!.cardId)?.characterId ?? "";
  const render = (): void => {
    const q = ($("#ap-search") as HTMLInputElement).value.trim().toLowerCase();
    const rarF = ($("#ap-rarity") as HTMLSelectElement).value;
    const list = DATA.accessories
      .filter((a) => {
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
      })
      .slice(0, 150);
    $("#ap-list").innerHTML = list
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
): string {
  const badge = CONF_BADGE[skillConfidence(s)] ?? "badge-u";
  const kindLabel = { A: "A", SP: "SP", P: "P", photo: "フォト", live_bonus: "ライボ" }[s.kind];
  const ct = s.ct != null ? `CT${s.ct}` : "CT—";
  const cost = s.staminaCost != null ? `消費${s.staminaCost}` : "消費—";
  const fx = s.effects.map(effectSummary).join(" / ") || "（効果なし）";
  const tags: string[] = [];
  if (s.fromMaster) tags.push("マスタ解析");
  if (s.unsupported) tags.push(`未対応効果${s.unsupported}行`);
  if (s.conditional) tags.push(s.conditional.startsWith("music") ? "楽曲限定" : s.conditional);
  if (extraTag) tags.push(extraTag);
  return `<label class="skill-row"><input type="checkbox" data-skill="${esc(s.id)}"${enabled ? " checked" : ""}>
    <span class="kind kind-${s.kind}">${kindLabel}</span> ${esc(s.name)}
    <span class="skill-meta">Lv${s.level}・${ct}・${cost}・${esc(fx)}</span>
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
    if (it === undefined || (it.name === undefined && it.id === undefined)) {
      cells.push(
        `<div class="acc-slot acc-slot-empty" data-act="open-acc-slot" data-slot="${i}" title="クリックでアクセサリを選択"><span class="dim">＋ 装備なし</span></div>`,
      );
      continue;
    }
    const chips = (it.structured ?? [])
      .map((s) => `<span class="chip">${s.stat === "critical" ? "Cri" : s.stat}${s.type === "pct" ? "+" + s.value + "%" : "+" + fmtInt(s.value)}</span>`)
      .join("");
    const assetId = accAssetIdFor(it);
    cells.push(
      `<div class="acc-slot" data-act="open-acc-slot" data-slot="${i}" title="クリックで変更・✕で解除">
        ${accThumbHtml(assetId)}
        <span class="acc-slot-body"><span class="acc-slot-name">${esc(it.name ?? `#${i + 1}`)}</span><span class="acc-slot-chips">${chips}</span></span>
        <button class="mini-btn" data-rm-acc="${i}" title="解除">✕</button>
      </div>`,
    );
  }
  return `<div class="acc-slots" data-lane-slots="${laneIdx + 1}">${cells.join("")}</div>`;
}

/** スロット指定でアクセサリを装備（既存エントリは置き換え・末尾追加） */
function setAccessory(laneIdx: number, slotIdx: number, accId: string): void {
  const acc = DATA.accessories.find((a) => a.id === accId);
  if (acc === undefined) return;
  const l = state.lanes[laneIdx]!;
  const list = parseAccList(l.accessoriesJson);
  if (list === null) {
    setStatus("アクセサリ(JSON)の解析に失敗したため装備できません", true);
    return;
  }
  const entry = { name: acc.name, id: acc.id, assetId: acc.assetId ?? "", structured: acc.structured };
  while (list.length <= slotIdx) list.push({});
  list[slotIdx] = entry;
  l.accessoriesJson = JSON.stringify(
    list.filter((e) => e.name !== undefined || e.id !== undefined).slice(0, ACC_SLOTS),
    null,
    1,
  );
  renderLaneCard(laneIdx);
  setStatus(`L${laneIdx + 1} スロット${slotIdx + 1} に装備: ${acc.name}`);
}

/** 旧保存データ（3 スロット時代）の正規化: 先頭 2 件のみ残す */
function normalizeAccSlots(l: LaneUiState): void {
  const arr = parseAccList(l.accessoriesJson);
  if (arr !== null && arr.length > ACC_SLOTS) {
    l.accessoriesJson = JSON.stringify(arr.slice(0, ACC_SLOTS), null, 1);
  }
}

/** おまかせ装備（最強装備の自動配分・ヒューリスティック）:
 *  レーン属性に一致する分類を優先し、専用アクセサリは同一キャラのみ、
 *  ティア（レアリティ）と補正値の合成スコアで降順に上位2件を装着する。
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
    }))
    .sort((x, y) => {
      if (x.attrMatch !== y.attrMatch) return y.attrMatch - x.attrMatch;
      if (x.acc.rarity !== y.acc.rarity) return y.acc.rarity - x.acc.rarity;
      return y.power - x.power;
    });
  const chosen: typeof scored = [];
  // 1周目: 他レーン未使用の ID を優先
  for (const cand of scored) {
    if (chosen.length >= ACC_SLOTS) break;
    if (usedIds.has(cand.acc.id)) continue;
    if (chosen.some((c) => c.acc.id === cand.acc.id)) continue;
    chosen.push(cand);
  }
  // 2周目: 候補が尽きた場合は使用中 ID の再利用を許容
  for (const cand of scored) {
    if (chosen.length >= ACC_SLOTS) break;
    if (chosen.some((c) => c.acc.id === cand.acc.id)) continue;
    chosen.push(cand);
  }
  const entries = chosen.map((c) => ({
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

function laneCardHtml(i: number): string {
  const l = state.lanes[i]!;
  const lane = (i + 1) as LaneNumber;
  const card = cardOf(l.cardId);
  const resolved = resolveLaneSkills(lane, l.cardId);
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
    <details><summary>スキル（A/SP/P ${resolved.skills.length}${hasBond ? `・絆覚醒${l.bondAwake ? "ON" : "OFF"}で第4択${l.bondAwake ? "有効" : "無効"}` : ""}）</summary>${resolved.skills
      .map((s, si) => skillRow(s, l.enabledSkillIds.has(s.id), hasBond && si === 3 ? "絆覚醒スキル" : undefined))
      .join("")}</details>
    <details><summary>フォト（${resolved.photos.length}）</summary>${resolved.photos
      .map((s) => skillRow(s, l.enabledPhotoIds.has(s.id)))
      .join("")}</details>
    <div class="acc-head">アクセサリ（2スロット・空き枠クリックで選択）</div>
    ${accessorySlotsHtml(l, i)}
    <div class="grid2">
      <div class="field"><button class="btn-like wide" data-act="auto-acc" title="レーン属性・キャラに合わせて手持ち最高ティアの装備を自動配分">⚡ おまかせ装備</button></div>
      <div class="field"><button class="btn-like wide" data-act="pick-acc">＋ アクセサリ（検索）</button></div>
    </div>
    <details><summary>フォト（ステータス補正 JSON）</summary>
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
  <h2>編成（アイドル 5 人）</h2>
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
    });
    built.base.lanes.forEach((laneInput) => {
      const preview = $(`#deck-preview-${laneInput.lane}`);
      preview.innerHTML =
        `<span>Vo ${fmtInt(laneInput.deck.vocal)}</span><span>Da ${fmtInt(laneInput.deck.dance)}</span>` +
        `<span>Vi ${fmtInt(laneInput.deck.visual)}</span><span>Sta ${fmtInt(laneInput.deck.stamina)}</span>`;
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
    })),
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
    lanes: Array<LaneUiState & { enabledSkillIds: string[]; enabledPhotoIds: string[] }>;
  };
  state = { ...defaultLaneState(), ...parsed };
  state.lanes = parsed.lanes.map((l) => {
    const lane: LaneUiState = {
      ...l,
      // メンタル: 保存済みの数値は任意上書きとして復元・未保存/ null は自動算出
      mental: l.mental ?? null,
      bondAwake: l.bondAwake ?? false,
      enabledSkillIds: new Set(l.enabledSkillIds),
      enabledPhotoIds: new Set(l.enabledPhotoIds),
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
  $("#opt-constraints").innerHTML = state.lanes
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
    .join("");
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
            return `<li>${thumbHtml(cid, 1, "thumb-sm")}<span class="attr attr-${a}">${ATTR_SHORT[a]}</span> ${esc(card?.name ?? cid)} <span class="dim">${LANE_LABELS[i]}</span></li>`;
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
    `<div class="dim">※ 候補プール ${res.pool.length} 枚（ヒューリスティック事前選別）・評価条件: 装備なし/メンタル100/missedNotesなし/全員Scorer</div>`;
  bindThumbErrors(el);
}

/** オプティマイザ結果 → 編成エディタへ一括反映 */
function applyLineupEntry(e: OptimizerEntry): void {
  state.lanes = e.cardIds.map((cid, i) => laneStateFromCard(i, cid));
  switchTab("sim");
  renderConfig();
  setStatus("オプティマイザの結果を編成に反映しました（シミュレーション実行で詳細を確認できます）");
}

/** カードIDから装備なしの初期 LaneUiState を構築（オプティマイザ反映用） */
function laneStateFromCard(i: number, cardId: string): LaneUiState {
  const resolved = resolveLaneSkills((i + 1) as LaneNumber, cardId);
  const levels = availableLevels(DATA.data, cardId);
  return {
    cardId,
    level: levels.length > 0 ? levels[levels.length - 1]! : 1,
    rarity: DEFAULT_RARITY,
    kouryu: 1,
    role: cardRoleOf(cardId),
    mental: null,
    bondAwake: false,
    enabledSkillIds: new Set(resolved.skills.slice(0, 3).map((s) => s.id)),
    enabledPhotoIds: new Set(),
    photosJson: "[]",
    accessoriesJson: "[]",
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

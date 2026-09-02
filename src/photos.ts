/**
 * マイフォト帳（ユーザー定義フォト）のコアモデル（Phase 8-B）。
 *
 * ゲーム内フォトのモデル化:
 * - 1枚のフォトは最大 5 枠で構成される。枠1はフォトスキル（スキル持ちフォト）で、
 *   スキルがある場合ステータス枠は実質 4 枠に減少する（過剰盛りの自動防止）。
 * - 枠2-5 は「自己ステータス」（Vo/Da/Vi/Sta/Men/Cri の固定値 or %）または
 *   「特殊付与」（隣接/センター/スコアラーへの ステータス% / スコア%）。
 * - 「レタッチタグ」付きフォトは 1 人のアイドルにつき最大 1 枚のみ装備可能。
 *
 * 付与効果のセマンティクス（Peing 確定 2026-08-31・id=1187940162）:
 *   「センタークリティカルスコアや隣接ステータスは通常のクリティカルスコア%や
 *    ステータスと同種類として取り扱われます」
 *   → 付与は対象レーンの装備と同一の加算プール（デッキ値%プール / スコア%プール）に入る。
 *   隣接 = 左右 1 レーンずつ（L1/L5 は 1 レーン。engine.ts の neighbors 解決と同一規則・Confirmed）。
 *   センター = L3。スコアラー = role Scorer のレーン。
 *
 * ストレージ（LocalStorage キー規約は UI 側）: マイフォト帳は MyPhotoDef[] として
 * JSON 保存され、装備時に PhotoOrAccessory（structured）+ SkillDef（kind:"photo"）へ変換して
 * 既存の計算経路（build.ts）に乗る。CLI エクスポートとの相互運用のため structured への
 * 変換は安定キー（grant_* を含む）で行う。
 */
import { pctToPermil } from "./rounding.js";
import type { StatKey } from "./types.js";
import type {
  EffectCondition,
  EffectTarget,
  EffectType,
  LaneNumber,
  SkillDef,
  SkillEffect,
} from "./timeline/types.js";

/** フォト1枠の種類（自己ステータス or 特殊付与） */
export type PhotoFrameKind = "self" | "grant_neighbors" | "grant_center" | "grant_scorer";

/** 自己ステ枠に置けるステータス/スコアキー */
export const PHOTO_SELF_STAT_KEYS = [
  "vocal",
  "dance",
  "visual",
  "stamina",
  "mental",
  "critical",
  "beat_score",
  "a_score",
  "sp_score",
  "critical_score",
  "p_score",
] as const satisfies readonly (StatKey)[];

/** 特殊付与枠に置けるキー（付与は % のみ。Peing id=1187940162 準拠の同種類扱い） */
export const PHOTO_GRANT_KEYS = [
  "vocal",
  "dance",
  "visual",
  "stamina",
  "mental",
  "critical",
  "beat_score",
  "a_score",
  "sp_score",
  "critical_score",
  "p_score",
] as const;

/** 1枠（自己ステータス or 特殊付与）。value は % 表記値（structured と同一・例: 44.0 = +44%） */
export interface PhotoFrame {
  kind: PhotoFrameKind;
  /** ステータス/スコアキー（PHOTO_SELF_STAT_KEYS / PHOTO_GRANT_KEYS のいずれか） */
  stat: string;
  /** 自己ステ枠のみ fixed 可。付与枠は常に pct */
  type: "pct" | "fixed";
  value: number;
}

/**
 * フォトスキル（枠1）。SkillDef（kind:"photo"）互換へ変換される。
 * 型は既存 EffectType/EffectTarget/EffectCondition のサブセット文字列。
 */
export interface PhotoSkillDef {
  /** 効果type（vocal_boost / score_get / ct_reduction / effect_extension 等） */
  type: EffectType;
  /** 段階型効果の段数（score_get 系では未使用） */
  stages?: number;
  /** スコア獲得系のスキルパワー permil（例: 45% → 450） */
  powerPermil?: number;
  /** 即時量（ct_reduction / effect_extension / effect_amplify / stamina_recovery） */
  value?: number;
  /** 効果時間（ビート）。即時型は null */
  durationBeats?: number | null;
  target: EffectTarget;
  condition: EffectCondition;
  /**
   * 【Phase 8-B4】延長/増強レタッチの絞り込みバフ（vocal_up / critical_rate_up 等）。
   * effect_extension / effect_amplify 専用。null/未指定 = 全バフが対象。
   */
  buffKey?: string | null;
/**
 * 延長/増強の範囲。null = スコープ指定なし（target で指定した対象の効果を
 * 延長/増強する通常フォトスキル・T5 の「びっくりした?」等）、
 * given = 自分が与えたバフのみ（与・○○延長レタッチ）、
 * received = 自分が受けているバフのみ（被・○○延長レタッチ）。
 */
scope?: "given" | "received" | null;
  /** CT（ビート数）。null = CT管理なし */
  ct: number | null;
  /** 消費スタミナ。null = 消費なし */
  staminaCost: number | null;
  /** ライブ中の発動回数上限（1 =「ライブ中1回のみ」） */
  limitPerLive?: number | null;
  /**
   * 【サンプル1実測確定 2026-09-01】装着制限（スキルテキストの <サポータータイプのみ> 等）。
   * "supporter_only" / "buffer_only" / "scorer_only"。制約に合わないロールのレーンに
   * 装着されたフォトスキルは常時不発（エンジン restrictionAllows でゲート）。
   * 実測: L4=Buffer 装備の「小美山愛 輝く光を受けて」（supporter_only）は不発。
   * null/未指定 = 制約なし。
   */
  restriction?: string | null;
}

/** マイフォト帳の1定義 */
export interface MyPhotoDef {
  id: string;
  name: string;
  /** 種別ラベル（イメトレ/メモリアル等・表示のみ） */
  kindLabel: string;
  /** タグ（複数可。帳の絞り込みに使用） */
  tags: string[];
  /** レタッチ（1人1枚制限の対象） */
  retouch: boolean;
  /** 枠1のフォトスキル。null = スキルなし（ステータス枠5） */
  skill: PhotoSkillDef | null;
  /** ステータス枠（スキルあり: 最大4（スキル持ちフォト）/5（なし）） */
  frames: PhotoFrame[];
  /** 品質（表示のみ。マスタ由来は INFO PRIDE の初期品質） */
  quality?: number;
}

/**
 * フォトマスタ（data/photos_master.json・tools/importers/build_data_phase6.mjs 生成）の1行。
 * PhotoAllInOne.json（INFO PRIDE のメモリアルフォト一覧に相当）から生成する。
 */
export interface PhotoMasterEntry {
  id: string;
  name: string;
  assetId?: string;
  rarity?: number | null;
  placeName?: string;
  /** 種別（メモリアルフォト/研修用フォト 等） */
  eventName?: string;
  /** 初期品質（フォト獲得時の品質。frames はこの品質の初期値） */
  initialQuality?: number | null;
  /**
   * 撮影キャラ（char-xxx。そのキャラが写っているフォトを示す。空は汎用）。
   * ※ やる気士docs の「専用フォト」（キャラ別フィルム）とは別物。
   */
  focusCharacterId?: string;
  focusCharacterName?: string;
  /** 能力の structured 形式（自己ステ + grant_* 付与キー。値は初期品質での初期値） */
  structured: Array<{ stat: string; type: "pct" | "fixed"; value: number }>;
  /** 参照するフォトスキル ID（photos_master.json の skillsById で解決） */
  skills: string[];
}

/** ステータス枠の上限（スキル持ちフォトは第1枠がスキルで占有されるため 4） */
export const PHOTO_STAT_FRAME_LIMIT_WITH_SKILL = 4;
/** ステータス枠の上限（スキルなしフォト） */
export const PHOTO_STAT_FRAME_LIMIT_NO_SKILL = 5;

/** フォトのステータス枠上限（スキルの有無で決まる） */
export function statFrameLimit(photo: Pick<MyPhotoDef, "skill">): number {
  return photo.skill !== null
    ? PHOTO_STAT_FRAME_LIMIT_WITH_SKILL
    : PHOTO_STAT_FRAME_LIMIT_NO_SKILL;
}

/** フォト定義の検証（編集・保存時）。問題のメッセージ列を返す（空配列 = OK） */
export function validateMyPhoto(photo: MyPhotoDef): string[] {
  const errors: string[] = [];
  if (photo.name.trim() === "") errors.push("フォト名が空です");
  const limit = statFrameLimit(photo);
  if (photo.frames.length > limit) {
    errors.push(
      `ステータス枠が上限を超えています（${photo.frames.length}枠 > 上限${limit}枠。スキル持ちフォトは第1枠がスキルで占有されます）`,
    );
  }
  for (const f of photo.frames) {
    if (f.kind === "self" && !(PHOTO_SELF_STAT_KEYS as readonly string[]).includes(f.stat)) {
      errors.push(`自己ステ枠に使えないキー: ${f.stat}`);
    }
    if (f.kind !== "self" && !(PHOTO_GRANT_KEYS as readonly string[]).includes(f.stat)) {
      errors.push(`付与枠に使えないキー: ${f.stat}`);
    }
    if (f.kind !== "self" && f.type !== "pct") {
      errors.push("付与枠は % のみ指定できます");
    }
    if (!Number.isFinite(f.value)) errors.push("効果値が数値ではありません");
  }
  const skill = photo.skill;
  if (skill !== null) {
    const stageLike =
      skill.type === "score_get" || skill.type === "score_get_by_score_ratio";
    if (stageLike && (skill.powerPermil ?? 0) <= 0) {
      errors.push("スコア獲得系スキルには効果値（%）が必要です");
    }
    const instantLike =
      skill.type === "ct_reduction" ||
      skill.type === "effect_extension" ||
      skill.type === "effect_amplify" ||
      skill.type === "stamina_recovery";
    if (!stageLike && !instantLike && (skill.stages ?? 0) <= 0) {
      errors.push("段階型スキルには段数が必要です");
    }
  }
  return errors;
}

/**
 * レーンへの装備検証（レタッチ1枚制限）。同一レーンに装備済みのフォト列に
 * 追加候補を加えた際の問題メッセージ列を返す（空配列 = 装備可）。
 */
export function validatePhotoEquip(
  equipped: ReadonlyArray<Pick<MyPhotoDef, "id" | "name" | "retouch">>,
  candidate: Pick<MyPhotoDef, "id" | "name" | "retouch">,
): string[] {
  const errors: string[] = [];
  if (equipped.length >= 5) {
    errors.push("フォトは1人最大5枚までです");
  }
  if (candidate.retouch && equipped.some((p) => p.retouch)) {
    const holder = equipped.find((p) => p.retouch)!;
    errors.push(`レタッチフォトは1人1枚までです（装備済み: ${holder.name}）`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 変換（structured / SkillDef 互換）
// ---------------------------------------------------------------------------

/** structured キー（既存 stat キーに加えて grant_* を解釈する）の付与プレフィックス */
export const GRANT_KEY_PREFIX = "grant_";

/** 付与枠 → structured キー（例: grant_neighbors_vocal）。付与は常に pct */
export function grantStructuredKey(kind: Exclude<PhotoFrameKind, "self">, stat: string): string {
  return `${GRANT_KEY_PREFIX}${kind.slice("grant_".length)}_${stat}`;
}

/**
 * マイフォト1枚 → 装備エントリ（PhotoOrAccessory 互換の structured 形式）。
 * 自己ステ枠は既存キー（vocal 等）そのまま、付与枠は grant_<target>_<stat> キー（常に pct）。
 */
export function myPhotoToStructured(photo: MyPhotoDef): Array<{ stat: string; type: "pct" | "fixed"; value: number }> {
  return photo.frames.map((f) => ({
    stat: f.kind === "self" ? f.stat : grantStructuredKey(f.kind, f.stat),
    type: f.kind === "self" ? f.type : ("pct" as const),
    value: f.value,
  }));
}

/** マイフォト装備エントリの name 接頭辞（photos 配列内での識別用） */
export const USER_PHOTO_EQUIP_PREFIX = "【マイフォト】";

/** マイフォト1枚 → 装備エントリ（PhotoOrAccessory と同型・name に接頭辞を付ける） */
export function myPhotoToEquipEntry(photo: MyPhotoDef): { name: string; structured: Array<{ stat: string; type: "pct" | "fixed"; value: number }> } {
  return { name: `${USER_PHOTO_EQUIP_PREFIX}${photo.name}`, structured: myPhotoToStructured(photo) };
}

/**
 * 【Phase 8-B10】photos エントリが myPhoto の重複表現か（素の名前 or 接頭辞付き）。
 * 画像→JSON 生成フロー（prompts/deck-json-from-images.md）は myPhotos ステータスを
 * characters[].photos 側にも書く規約で、UI エクスポートは接頭辞付きで書く。
 * 統合時の二重計算防止判定（mergePhotoEquipStatuses・UI applyConfig の重複除去と共通）。
 */
export function isPhotoEquipDuplicate(entryName: string, photoName: string): boolean {
  return entryName === photoName || entryName === `${USER_PHOTO_EQUIP_PREFIX}${photoName}`;
}

/**
 * 【Phase 8-B10】photoEquip に装着された myPhotos のステータスを photos 配列へ統合する
 * （UI toDeck 相当の処理を CLI でも行う・8-B9 の「CLI/UI 同一スコア」契約の完全化）。
 * legacy 側に同名のエントリが既にある場合は既存表現を優先して追加しない
 * （二重計算の防止・isPhotoEquipDuplicate 判定）。
 */
export function mergePhotoEquipStatuses<T extends { name: string }>(
  legacy: readonly T[],
  equipped: readonly MyPhotoDef[],
): T[] {
  const out = [...legacy];
  for (const p of equipped) {
    if (out.some((e) => isPhotoEquipDuplicate(e.name, p.name))) continue;
    // myPhotoToEquipEntry の戻り値は { name, structured } で T と構造的に一致する
    out.push(myPhotoToEquipEntry(p) as unknown as T);
  }
  return out;
}

/** マイフォトのユーザースキル ID（レーン装備ごとに生成する SkillDef の id） */
export function userPhotoSkillId(photoId: string): string {
  return `uph-${photoId}`;
}

/**
 * マイフォト1枚 → SkillDef（kind:"photo"）。スキルなしフォトは null。
 * lane / photoIndex は装備時に渡す（エンジンは lane 単位で解決する）。
 */
export function myPhotoToSkillDef(photo: MyPhotoDef, lane: LaneNumber, photoIndex: number): SkillDef | null {
  if (photo.skill === null) return null;
  const s = photo.skill;
  const effects: SkillDef["effects"] = [];
  const stageLike = s.type === "score_get" || s.type === "score_get_by_score_ratio";
  if (stageLike) {
    effects.push({
      type: s.type,
      powerPermil: s.powerPermil ?? 0,
      durationBeats: null,
      target: s.target,
      condition: s.condition,
    });
  } else if (s.type === "ct_reduction" || s.type === "effect_extension" || s.type === "effect_amplify" || s.type === "stamina_recovery") {
    effects.push({
      type: s.type,
      value: s.value ?? 0,
      durationBeats: null,
      target: s.target,
      condition: s.condition,
      // 与/被スコープ・絞り込みバフ（延長/増強レタッチ・Phase 8-B4）
      ...(s.buffKey ? { buffKey: s.buffKey as SkillEffect["buffKey"] } : {}),
      ...(s.scope ? { scope: s.scope } : {}),
    });
  } else {
    effects.push({
      type: s.type,
      stages: s.stages ?? 0,
      durationBeats: s.durationBeats ?? null,
      target: s.target,
      condition: s.condition,
    });
  }
  return {
    id: userPhotoSkillId(photo.id),
    name: photo.name,
    kind: "photo",
    level: 1,
    lane,
    photoIndex,
    optionSkill: `マイフォト: ${photo.name}`,
    restriction: s.restriction ?? null,
    ct: s.ct,
    staminaCost: s.staminaCost,
    limitPerLive: s.limitPerLive ?? null,
    effects,
  };
}

/** BuffKey → 表示短縮ラベル（photoSummary の延長/増強レタッチ用） */
const BUFF_KEY_SHORT: Record<string, string> = {
  vocal_up: "Vo",
  vocal_boost: "Voブースト",
  vocal_up_extreme: "Vo超化",
  vocal_down: "Vo低下",
  dance_up: "Da",
  dance_boost: "Daブースト",
  dance_down: "Da低下",
  visual_up: "Vi",
  visual_boost: "Viブースト",
  visual_down: "Vi低下",
  beat_score_up: "ビートスコア",
  tension_up: "テンション",
  score_up: "スコア",
  a_skill_score_up: "Aスコア",
  sp_skill_score_up: "SPスコア",
  p_skill_score_up: "Pスコア",
  combo_score_up: "コンボスコア",
  critical_coeff_up: "クリ係数",
  critical_rate_up: "クリ率",
  stamina_cost_down: "消費低下",
  stamina_cost_up: "消費増加",
  skill_success_up: "成功率",
  focus: "集目",
  stealth: "ステルス",
  combo_continue: "コンボ継続",
};

/** フォト1枚の効果サマリ（一覧表示用） */
export function photoSummary(photo: MyPhotoDef): string {
  const parts: string[] = [];
  if (photo.skill !== null) {
    const s = photo.skill;
    const stageLike = s.type === "score_get" || s.type === "score_get_by_score_ratio";
    if (stageLike) {
      parts.push(`スキル: ${(s.powerPermil ?? 0) / 10}%スコア獲得`);
    } else if (s.type === "effect_extension" || s.type === "effect_amplify") {
      // スコープなし = 対象セレクトの対象への作用（T5 の「びっくりした?」等）、
      // 与/被 = レタッチ系。絞り込みバフは指定時のみ写像
      const scopePrefix = s.scope === "given" ? "与・" : s.scope === "received" ? "被・" : "";
      const keyLabel = s.buffKey ? (BUFF_KEY_SHORT[s.buffKey] ?? s.buffKey) : "全バフ";
      const verb = s.type === "effect_extension" ? "延長" : "増強";
      parts.push(`スキル: ${scopePrefix}${keyLabel}${verb}+${s.value ?? 0}`);
    } else {
      const dur = s.durationBeats != null ? `${s.durationBeats}b` : "";
      parts.push(`スキル: ${s.type}${s.stages ? `+${s.stages}段` : ""}${dur}`);
    }
  }
  const kindLabel: Record<string, string> = {
    self: "",
    grant_neighbors: "隣接",
    grant_center: "センター",
    grant_scorer: "スコアラー",
  };
  for (const f of photo.frames) {
    const prefix = kindLabel[f.kind] ?? "";
    const statLabel = f.stat.replace(/_score$/, "スコア").replace("critical", "Cri").replace("vocal", "Vo").replace("dance", "Da").replace("visual", "Vi").replace("stamina", "Sta").replace("mental", "Men").replace("beat", "ビート");
    parts.push(`${prefix}${prefix ? "・" : ""}${statLabel} ${f.type === "pct" ? "+" + f.value + "%" : "+" + f.value}`);
  }
  return parts.join(" / ") || "（効果なし）";
}

// ---------------------------------------------------------------------------
// 同梱テンプレート（初期同梱・公式/理論値テンプレート）
// ---------------------------------------------------------------------------

/** テンプレート ID プレフィックス（UI が LocalStorage 初期化時に投入する） */
export const PHOTO_TEMPLATE_PREFIX = "tpl-";

/**
 * 理論値・実用ラインの同梱テンプレート【Estimate】。
 * 数値は質問箱・実測運用で言及される代表ライン（Vo+72%/SP+13%/クリスコ+30% 等）。
 * T5 実測フォト（実測較正済み）は UI 側で data から生成する（本関数には含めない）。
 */
export function defaultPhotoTemplates(): MyPhotoDef[] {
  const t = (
    id: string,
    name: string,
    kindLabel: string,
    tags: string[],
    retouch: boolean,
    skill: PhotoSkillDef | null,
    frames: PhotoFrame[],
  ): MyPhotoDef => ({ id: `${PHOTO_TEMPLATE_PREFIX}${id}`, name, kindLabel, tags, retouch, skill, frames });
  return [
    // ---- 理論値イメトレ極振り（Vo スコアラー用の代表構成）【Estimate】 ----
    // 【Phase 8-B7】レタッチ枠は 1 人 1 枚のためブースト等の実レタッチを優先
    //（イメトレ極振りはレタッチ扱いにしない・ユーザー指摘）
    t("theo-vo-01", "理論値Vo70%イメトレ", "イメトレ", ["テンプレート", "理論値", "Vo特化"], false, null, [
      { kind: "self", stat: "vocal", type: "pct", value: 72 },
      { kind: "self", stat: "a_score", type: "pct", value: 13 },
      { kind: "self", stat: "sp_score", type: "pct", value: 13 },
      { kind: "self", stat: "critical_score", type: "pct", value: 30 },
      { kind: "self", stat: "vocal", type: "fixed", value: 70000 },
    ]),
    // ---- 実用・標準ライン ----
    t("practical-vo-01", "実用Vo53%イメトレ", "イメトレ", ["テンプレート", "実用", "Vo特化"], false, null, [
      { kind: "self", stat: "vocal", type: "pct", value: 53 },
      { kind: "self", stat: "a_score", type: "pct", value: 13 },
      { kind: "self", stat: "vocal", type: "fixed", value: 30000 },
    ]),
    // ---- 隣接レタッチ（Peing id=1187728074 / id=1187981925: 隣接ボーカルが定番） ----
    t("retouch-neighbor-01", "隣接Voレタッチ", "レタッチ", ["テンプレート", "レタッチ", "隣接"], true, null, [
      { kind: "grant_neighbors", stat: "vocal", type: "pct", value: 15 },
      { kind: "grant_neighbors", stat: "dance", type: "pct", value: 15 },
      { kind: "grant_neighbors", stat: "visual", type: "pct", value: 15 },
    ]),
    // ---- センタークリスコ（Peing id=1187940162: センクリは通常のクリスコ%と同種類） ----
    t("retouch-center-01", "センタークリスコレタッチ", "レタッチ", ["テンプレート", "レタッチ", "センクリ"], true, null, [
      { kind: "grant_center", stat: "critical_score", type: "pct", value: 27 },
    ]),
    // ---- ブーストレタッチ（Peing id=1188319136: 3色1枚ずつ・4段28b が定番） ----
    t("retouch-boost-vo-01", "Voブーストレタッチ（4段28b）", "レタッチ", ["テンプレート", "レタッチ", "ブースト"], true, {
      type: "vocal_boost",
      stages: 4,
      durationBeats: 28,
      target: "vocal_type_1",
      condition: "none",
      ct: 60,
      staminaCost: 1795,
      limitPerLive: null,
    }, []),
    // ---- スコア獲得フォト（T5 実測 photo-L5-1 同型・40%スコア獲得） ----
    t("score-get-40-01", "スコア獲得40%フォト", "メモリアル", ["テンプレート", "スコア獲得"], false, {
      type: "score_get",
      powerPermil: 4000,
      durationBeats: null,
      target: "self",
      condition: "none",
      ct: 70,
      staminaCost: 180,
      limitPerLive: null,
    }, [{ kind: "self", stat: "vocal", type: "pct", value: 20 }]),
  ];
}

/** 付与キーのパース: "grant_<target>_<stat>" → { target, stat }。非付与キーは null */
export function parseGrantKey(key: string): { target: "neighbors" | "center" | "scorer"; stat: string } | null {
  if (!key.startsWith(GRANT_KEY_PREFIX)) return null;
  const rest = key.slice(GRANT_KEY_PREFIX.length);
  for (const t of ["neighbors", "center", "scorer"] as const) {
    if (rest.startsWith(`${t}_`)) {
      return { target: t, stat: rest.slice(t.length + 1) };
    }
  }
  return null;
}

/** 付与値の permil 化（structured の value は % 表記） */
export function grantValuePermil(value: number): number {
  return pctToPermil(value);
}

// ---------------------------------------------------------------------------
// フォトマスタ（data/photos_master.json）→ マイフォト帳エントリ変換
// ---------------------------------------------------------------------------

/**
 * フォトマスタの1行 → MyPhotoDef。
 * - 種別は eventName（メモリアルフォト/研修用フォト 等）をそのまま使う
 * - structured を frames へ写像（自己ステ/付与とも frame.kind を自動判定）
 * - skills[0] を枠1のスキルに変換（photoSkillsById 由来の SkillDef から写像）。
 *   スキル効果行は最初の1行のみ反映（フォトのオプションスキルは実データ上 1 効果が大半）。
 * - 初期品質を quality に記録【マスタ由来の初期値・INFO PRIDE と同じ値】
 * - 撮影キャラ（focusCharacterId あり）は tags に「撮影キャラ」「<キャラ名>」を付与
 */
export function photoMasterToMyPhoto(
  entry: PhotoMasterEntry,
  photoSkillsById: Record<string, SkillDef> | undefined,
): MyPhotoDef {
  const frames: PhotoFrame[] = entry.structured.map((s) => {
    const grant = parseGrantKey(s.stat);
    if (grant !== null) {
      return {
        kind:
          grant.target === "neighbors"
            ? ("grant_neighbors" as const)
            : grant.target === "center"
              ? ("grant_center" as const)
              : ("grant_scorer" as const),
        stat: grant.stat,
        type: "pct" as const,
        value: s.value,
      };
    }
    return { kind: "self" as const, stat: s.stat, type: s.type, value: s.value };
  });
  const skillDef = photoSkillsById !== undefined ? photoSkillsById[entry.skills[0] ?? ""] : undefined;
  let skill: PhotoSkillDef | null = null;
  if (skillDef !== undefined && skillDef.effects.length > 0) {
    const e = skillDef.effects[0]!;
    skill = {
      type: e.type,
      ...(e.powerPermil !== undefined ? { powerPermil: e.powerPermil } : {}),
      ...(e.stages !== undefined ? { stages: e.stages } : {}),
      ...(e.value !== undefined ? { value: e.value } : {}),
      durationBeats: e.durationBeats ?? null,
      target: e.target,
      condition: e.condition,
      ct: skillDef.ct,
      staminaCost: skillDef.staminaCost,
      limitPerLive: skillDef.limitPerLive ?? null,
    };
  }
  const tags: string[] = ["手持ち"];
  if (entry.focusCharacterId) {
    // focusCharacterId は「そのキャラが写っているフォト」を示すだけ（専用フォトは別物。
    // やる気士docs の専用フォト = キャラ別フィルム（☆3/☆9 以上条件）であり
    // PhotoAllInOne のメモリアルフォトには含まれない）
    tags.push("撮影キャラ");
    if (entry.focusCharacterName) tags.push(entry.focusCharacterName);
  }
  if (entry.initialQuality != null) tags.push(`品質${entry.initialQuality}`);
  return {
    id: `${entry.id}`,
    name: entry.name,
    kindLabel: entry.eventName || "メモリアル",
    tags,
    retouch: false,
    skill,
    frames,
    quality: entry.initialQuality ?? undefined,
  };
}

/** フォトマスタ全体 → マイフォト帳エントリ列（スキル辞書付き） */
export function photoMasterToMyPhotos(
  photos: ReadonlyArray<PhotoMasterEntry>,
  photoSkillsById: Record<string, SkillDef> | undefined,
): MyPhotoDef[] {
  return photos.map((p) => photoMasterToMyPhoto(p, photoSkillsById));
}

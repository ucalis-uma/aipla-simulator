/**
 * レベル別スキル定義（data/skills_levels.json）のデコーダ（Phase 8-B3）。
 *
 * インポータ（tools/importers/build_data_phase6.mjs の buildSkillsLevels）が
 * 全カードスキル（1482種 × Lv1-6）を parseSkillLevel で解析し、短キー +
 * 型/対象/条件のテーブル参照でコンパクト化した形式を UI/CLI が復元するための
 * 純粋関数。フル形式だと ~4MB になるため ~1.2MB に圧縮して埋め込む。
 *
 * 裏取り済み仕様（research/12 Phase 8-B3 参照）:
 * - スキルLvごとの要求カードレベル（requiredCardLevel）は全1482スキルで枠別に完全一致
 * - T5 ゴールデンの実スキルレベル（L1/L2/L4/L5=215→3枠目Lv5・L3=230→Lv6）とも整合
 */
import type { SkillDef, SkillEffect } from "./timeline/types.js";

/** 効果行のコンパクト形式（短キー・undefined は省略） */
interface PackedEffect {
  /** 型テーブル番号 */
  t: number;
  /** 対象テーブル番号 */
  tg: number;
  /** 条件テーブル番号 */
  c: number;
  /** 効果時間（ビート） */
  d?: number;
  /** 段数 */
  st?: number;
  /** スコア系スキルパワー permil */
  p?: number;
  /** 即時量 */
  v?: number;
  /** 上限解放 */
  lr?: 1;
  /** 超化（capExtend） */
  ce?: 1;
  /** type36 スケーリング */
  sc?: SkillEffect["scaling"];
  /** scaling が明示 null（type36 未対応マーカー） */
  sn?: 1;
  /** 確度メモ */
  cf?: string;
}

/** レベル行（Lv1-6・levels 配列の添字 = level - 1） */
interface PackedLevel {
  /** 要求カードレベル */
  req: number;
  /** CT（ビート） */
  ct: number | null;
  /** 消費スタミナ */
  cost: number | null;
  /** 効果行 */
  eff: PackedEffect[];
  /** 発動確率 permil（1000 の場合は省略） */
  pr?: number;
  /** ライブ中発動回数上限（0 の場合は省略） */
  lim?: number;
}

/** スキル1件（レベル別行を持つ） */
export interface SkillLevelsEntry {
  id: string;
  kind: SkillDef["kind"];
  name: string;
  /**
   * 【2026-09-21 S1実測確定】スキル単位トリガー条件の条件テーブル番号
   * （マスタ levels[].triggerId 由来・全レベル共通であることを全 2043 スキルで検証済み。
   * triggerId 空 = "none"）。旧データ（フィールド欠落）は undefined = データなし
   * → engine は従来の効果行ベース判定にフォールバックする。
   */
  tc?: number;
  levels: PackedLevel[];
}

/** data/skills_levels.json 全体 */
export interface SkillLevelData {
  types: string[];
  targets: string[];
  conditions: string[];
  skills: SkillLevelsEntry[];
}

/** skillId → entry の索引（buildSimulateInput の繰り返し解決用） */
export type SkillLevelIndex = Map<string, SkillLevelsEntry>;

/** 索引を構築する（毎評価の線形探索を避ける。データは不変なので冪等） */
export function buildSkillLevelIndex(data: SkillLevelData): SkillLevelIndex {
  const map = new Map<string, SkillLevelsEntry>();
  for (const s of data.skills) map.set(s.id, s);
  return map;
}

/**
 * 指定レベルの SkillDef を復元する。未定義（存在しない skillId / レベル行欠落）は null。
 * kind はスキル単位で共通（マスタの categoryType 由来）。lane はダミー値 1 で復元される
 * （buildSimulateInput / UI 側が選択レーンで上書きする）。
 */
export function decodeSkillLevel(
  data: SkillLevelData,
  skillId: string,
  level: number,
  index?: SkillLevelIndex,
): SkillDef | null {
  const entry =
    index !== undefined ? index.get(skillId) : data.skills.find((s) => s.id === skillId);
  if (entry === undefined) return null;
  const row = entry.levels[level - 1];
  if (row === undefined) return null;
  const effects: SkillEffect[] = row.eff.map((e) => {
    const out: SkillEffect = {
      type: data.types[e.t] as SkillEffect["type"],
      target: data.targets[e.tg] as SkillEffect["target"],
      condition: data.conditions[e.c] as SkillEffect["condition"],
    };
    // durationBeats はマスタ解析行が明示 null を持つため常に設定する
    out.durationBeats = e.d ?? null;
    if (e.st !== undefined) out.stages = e.st;
    if (e.p !== undefined) out.powerPermil = e.p;
    if (e.v !== undefined) out.value = e.v;
    if (e.lr !== undefined) out.limitRelease = true;
    if (e.ce !== undefined) out.capExtend = true;
    if (e.sc !== undefined) out.scaling = e.sc;
    else if (e.sn !== undefined) out.scaling = null;
    if (e.cf !== undefined) out.confidence = e.cf;
    return out;
  });
  const def: SkillDef = {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    level,
    lane: 1,
    ct: row.ct,
    staminaCost: row.cost,
    probabilityPermil: row.pr ?? 1000,
    limitPerLive: row.lim ?? null,
    effects,
  };
  // スキル単位トリガー条件（tc 欠落の旧データは undefined のまま = データなし）
  const skillCondition = entry.tc !== undefined ? data.conditions[entry.tc] : undefined;
  if (skillCondition !== undefined) {
    def.condition = skillCondition as SkillEffect["condition"];
  }
  return def;
}

/**
 * スキル枠 slot（1始まり・4=絆覚醒）でカードレベル cardLevel から選択できる
 * 最大スキルレベル（1-6）。skills_levels.json の req（= requiredCardLevel）ではなく
 * 全スキルで枠別に完全一致が検証済みの要求テーブル（unlocks.json）を UI 側で持つ前提の
 * 純粋関数として requirements を受ける。
 */
export function maxSkillLevelOf(
  requirements: ReadonlyArray<number>,
  cardLevel: number,
): number {
  let max = 1;
  for (let lv = 6; lv >= 2; lv--) {
    if (cardLevel >= (requirements[lv - 1] ?? 0)) {
      max = lv;
      break;
    }
  }
  return max;
}

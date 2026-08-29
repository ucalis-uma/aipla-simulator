/**
 * T0 データ健全性テスト共通ヘルパー。
 *
 * - 実測データは リポジトリルート直下の「スコア分析サンプル/」から import.meta.url 経由で解決する
 *   （作業ディレクトリに依存しない。research/06 §7 の日本語パス対策: Path API のみ使用）。
 * - 失敗メッセージは research/06 §6 の紐付け規約に従い
 *   (beat, lane, field, expected, actual[, 根拠画像file]) を含める。
 *   発動ログには file: IMG_####.PNG が付くため、失敗時の目視再検証が 1 クリックで可能。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sampleDir = path.join(repoRoot, "スコア分析サンプル");

export const TOTAL_SCORE = 17_529_132_014; // 2^53 未満 → Number で安全
export const BEAT_COUNT = 157;
export const LAST_BEAT = 156;
export const LANE_IDS = [1, 2, 3, 4, 5] as const;
export type LaneId = (typeof LANE_IDS)[number];

export interface EffectRow {
  id: string;
  name: string;
  stage: number | null;
}

export interface LaneCell {
  idol_name: string;
  stat_value: number;
  current_stamina: number;
  max_stamina: number;
  effects: EffectRow[];
  gained_score_displayed: string | null;
  gained_score: number | null;
  /** v2 修正適用済みセルの印（例: stamina 217 セル修正） */
  v2_fixed_stamina?: boolean;
}

export interface TimelineActivation {
  order: number;
  file: string;
  beat: number;
  lane: LaneId;
  idol: string;
  skill_type: "A" | "P" | "SP" | "Photo";
  skill_name: string;
  effects: { effect_text: string; target_idol: string }[];
  stamina: string; // "発動後/max" 表記
  stat_value: number;
}

export interface TimelineEntry {
  beat: number;
  combo: number;
  cumulative_score: number;
  beat_gained_score: number;
  skill_activations: TimelineActivation[];
  skill_cts: Record<string, { skill1: number; skill2: number; skill3: number }>;
  lanes: Record<string, LaneCell>;
}

export interface CharacterSkill {
  name: string;
  type: "A" | "P" | "SP";
  level: number;
  ct: number;
  stamina: number;
  effect: string;
}

export interface Character {
  lane: LaneId;
  idol_name: string;
  card_name: string;
  skills: CharacterSkill[];
  stats: {
    base: Record<"vocal" | "dance" | "visual" | "stamina", number>;
    total_after_non_skill_modifiers: Record<"vocal" | "dance" | "visual" | "stamina", number>;
  };
  photos: { name: string; skill: string }[];
}

export interface SkillActivationsSummary {
  total_activations: number;
  activations_by_lane: Record<string, number>;
  all_activations: TimelineActivation[];
}

export interface CriticalBeatFlag {
  any_yellow: boolean;
  any_white: boolean;
  yellow_lanes: string[];
  white_lanes: string[];
  no_pop_lanes: string[];
  consensus_flag: number;
}

export interface CriticalFlags {
  method: string;
  per_lane_counts: Record<string, { yellow: number; white: number; no_pop: number; yellow_rate_of_visible: number }>;
  beats: Record<string, CriticalBeatFlag>;
}

export interface MeasuredDataV2 {
  stage: Record<string, unknown>;
  staff_bonus: Record<string, number>;
  yale_bonus: Record<string, number>;
  characters: Character[];
  results: {
    total_score: number;
    critical_rate_pct: number;
    hit_rate_pct: number;
    miss: number;
    combo: number;
    scores_by_lane: Record<string, number>;
  };
  skill_activations_summary: SkillActivationsSummary;
  timeline: TimelineEntry[];
  critical_flags: CriticalFlags;
  ct_reconstruction: Record<string, unknown>;
  v2_meta: Record<string, unknown>;
}

export interface VerificationDataV2 {
  characters: Character[];
  results: MeasuredDataV2["results"];
}

function readJson(p: string): unknown {
  return JSON.parse(readFileSync(p, "utf-8"));
}

let measuredCache: MeasuredDataV2 | undefined;
export function loadMeasured(): MeasuredDataV2 {
  measuredCache ??= readJson(path.join(sampleDir, "measured_data_v2.json")) as MeasuredDataV2;
  return measuredCache;
}

let verificationCache: VerificationDataV2 | undefined;
export function loadVerification(): VerificationDataV2 {
  verificationCache ??= readJson(path.join(sampleDir, "verification_data_v2.json")) as VerificationDataV2;
  return verificationCache;
}

/**
 * research/06 §6 紐付け規約: 失敗メッセージに
 * (beat, lane, field, expected, actual[, 根拠画像file]) を出す。
 */
export function ctx(
  beat: number | string,
  lane: number | string,
  field: string,
  expected: unknown,
  actual: unknown,
  file?: string,
): string {
  const base =
    `(beat=${beat}, lane=${lane}, field=${field}, expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)})`;
  return file ? `${base} [根拠画像: ${file}]` : base;
}

/**
 * timeline[b] を取得する。範囲外・欠落はデータ破損なので即エラー
 * （I-01 が担保するはずの構造だが、後続テストを意味不明な TS エラーで落とさないための防護）。
 */
export function beatAt(timeline: TimelineEntry[], beat: number): TimelineEntry {
  const e = timeline[beat];
  if (!e || e.beat !== beat) {
    throw new Error(ctx(beat, "-", "timeline[beat].beat", beat, e ? e.beat : undefined));
  }
  return e;
}

export function laneAt(entry: TimelineEntry, lane: LaneId): LaneCell {
  const c = entry.lanes[String(lane)];
  if (!c) {
    throw new Error(ctx(entry.beat, lane, "lanes[lane]", "存在する", undefined));
  }
  return c;
}

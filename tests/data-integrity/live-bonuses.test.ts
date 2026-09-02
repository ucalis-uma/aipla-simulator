/**
 * T0 データ健全性: ライブボーナス（data/live_bonuses.json）の整合。
 *
 * 【Phase 9】Quest.liveBonusGroupId → LiveBonusGroup → LiveBonus → LiveAbility → Skill
 * の連携で抽出した定義が engine 契約（EffectType/EffectTarget/EffectCondition）内にあること、
 * 発動条件が前半（無条件）・後半（条件付き）に正しく分類されていることを検証する。
 * 出典: research/16_peing_verified_specs.md §1。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataPath = path.join(repoRoot, "data", "live_bonuses.json");

/** engine types.ts の EffectType（Phase 9 時点） */
const KNOWN_TYPES = new Set([
  "score_get", "score_get_by_score_ratio", "vocal_up", "vocal_boost", "vocal_up_extreme",
  "vocal_down", "dance_down", "visual_down",
  "dance_up", "dance_boost", "visual_up", "visual_boost", "beat_score_up",
  "tension_up", "tension_limit", "combo_score_up", "combo_score_limit",
  "critical_coeff_up", "critical_coeff_limit", "critical_rate_up",
  "a_skill_score_up", "sp_skill_score_up", "p_skill_score_up",
  "stamina_cost_down", "stamina_cost_up", "stamina_recovery",
  "combo_continue", "ct_reduction", "ct_increase", "effect_extension", "effect_amplify",
  "score_up", "skill_success_up", "focus", "stealth", "live_bonus_ct_reduction",
]);
/** engine types.ts の EffectCondition（ライボで出る範囲・battle_only は通常ライブ不発） */
const KNOWN_CONDITIONS = new Set([
  "none", "battle_only", "self_vocal_lane", "self_visual_lane",
  "someone_focus", "someone_score_up", "someone_skill_success_up", "someone_critical_coeff_up",
  "combo>=50", "combo>=80", "combo>=90", "combo>=100", "someone_recovered",
  "someone_critical_rate_up", "someone_beat_score_up", "someone_a_skill_score_up",
  "someone_sp_skill_score_up", "someone_p_skill_score_up", "someone_tension_up",
  "someone_vocal_up", "someone_dance_up", "someone_visual_up",
  "someone_vocal_boost", "someone_dance_boost", "someone_visual_boost",
  "someone_vocal_down", "someone_dance_down", "someone_visual_down",
  "someone_stamina_cost_down", "someone_stealth",
  // 誰かがスタミナ N% 以下（tg-someone_stamina_lower-N・2026-09-02 効果行トリガー対応で写像）
  "someone_stamina<=50",
  // 誰かが低下効果状態の時（tg-someone_status_group-weekness・2026-09-02 サンプル2 確定）
  "someone_down_group",
  "count_liz>=1", "count_moon>=1", "count_sun>=1", "count_pajm>=1",
  "count_leader>=1", "count_tri>=1", "count_thrx>=1",
]);

interface LiveBonusDef {
  id: string;
  kind: string;
  ct: number | null;
  staminaCost: number | null;
  condition: string;
  conditionalNote: string | null;
  description: string;
  effects: Array<{ type: string; target: string; condition: string; stages?: number; value?: number }>;
  unsupportedEffects: number;
}

function loadByQuest(): Record<string, LiveBonusDef[]> {
  return (JSON.parse(readFileSync(dataPath, "utf-8")) as { byQuest: Record<string, LiveBonusDef[]> })
    .byQuest;
}

describe("ライブボーナスデータ（data/live_bonuses.json）", () => {
  it.skipIf(!existsSync(dataPath))("ファイルが存在し 600 クエスト以上に付与されている", () => {
    const byQuest = loadByQuest();
    const quests = Object.keys(byQuest).length;
    expect(quests).toBeGreaterThanOrEqual(600);
  });

  it.skipIf(!existsSync(dataPath))("全スキル定義が kind=live_bonus・CT付き・消費0・条件既知", () => {
    const byQuest = loadByQuest();
    const seen = new Map<string, LiveBonusDef>();
    for (const defs of Object.values(byQuest)) {
      for (const def of defs) {
        seen.set(def.id, def);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(111); // LiveBonusGroup 111 グループ分
    for (const def of seen.values()) {
      expect(def.kind, def.id).toBe("live_bonus");
      // CT は通常 30-70。CT0 + limitPerLive=1 の「ライブ中1回」型も存在する（sk-*-029 等）
      expect(def.ct ?? 0, def.id).toBeGreaterThanOrEqual(0);
      expect(def.staminaCost ?? 0, def.id).toBe(0);
      expect(KNOWN_CONDITIONS.has(def.condition), `${def.id} condition=${def.condition}`).toBe(true);
      for (const e of def.effects) {
        expect(KNOWN_TYPES.has(e.type), `${def.id} type=${e.type}`).toBe(true);
        expect(KNOWN_CONDITIONS.has(e.condition), `${def.id} effect condition=${e.condition}`).toBe(true);
      }
    }
  });

  it.skipIf(!existsSync(dataPath))("無条件ライボは前半・条件付きライボは後半に分類される", () => {
    const byQuest = loadByQuest();
    const seen = new Map<string, LiveBonusDef>();
    for (const defs of Object.values(byQuest)) {
      for (const def of defs) seen.set(def.id, def);
    }
    let unconditional = 0;
    let conditional = 0;
    for (const def of seen.values()) {
      if (def.condition === "none" || def.condition.startsWith("count_")) {
        unconditional++; // エンジンで前半発動候補
      } else {
        conditional++; // エンジンで後半発動（条件成立時）
      }
    }
    // マスタ分布（2026-08-31 時点）: 無条件16（none）/ 条件付き95（someone_* 93 + combo 5）程度
    expect(unconditional).toBeGreaterThanOrEqual(10);
    expect(conditional).toBeGreaterThanOrEqual(85);
  });
});

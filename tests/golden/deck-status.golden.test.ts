/**
 * T3 ゴールデンテスト: beat 0 の補正後ステータス（デッキ値）と基礎ステータスの照合。
 *
 * 根拠:
 * - PLAN.md §3.1（カード外ステータス式・Confirmed）
 * - research/05_data_quality.md I-09
 * - 実測: スコア分析サンプル/verification_data_v2.json（L4/L5フォト入れ替え修正済み）
 *   × マスタデータ（Card.json / CardParameter.json）
 *
 * 合否: 5レーン × 4ステータス × {basic, deck} = 40項目の 1の位完全一致。
 *   ただし verification_data には basic(基礎) の値があるため、
 *   deck=total_after_non_skill_modifiers / basic=base を照合する。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeDeckStatus } from "../../src/formula/baseStatus.js";
import { pctToPermil } from "../../src/rounding.js";
import type { CardDef, CardParameterRow, StatBonus, YellBonus } from "../../src/types.js";

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
  /** 開花・限界突破後の現在レアリティ（☆）*/
  rarity: number;
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

function readJson(p: string): unknown {
  return JSON.parse(readFileSync(p, "utf-8"));
}

const cards = (readJson(path.join(dataDir, "cards.json")) as CardsFile).cards;
const params = (readJson(path.join(dataDir, "card_parameters.json")) as CardParametersFile).rows;
const ver = readJson(path.join(sampleDir, "verification_data_v2.json")) as VerificationV2;

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

describe("T3 golden: beat 0 ステータス（verification_data_v2 × マスタデータ）", () => {
  for (const ch of ver.characters) {
    describe(`Lane ${ch.lane} ${ch.card_id}`, () => {
      const card = cards.find((c) => c.id === ch.card_id);
      if (!card) throw new Error(`card not found in data/cards.json: ${ch.card_id}`);
      const row = params.find(
        (r) => r.id === card.cardParameterId && r.level === ch.level,
      );
      if (!row) throw new Error(`card parameter not found: ${card.cardParameterId} @ Lv${ch.level}`);

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

      const stats = ["vocal", "dance", "visual", "stamina"] as const;

      it("deck（補正後総合ステータス）が 1 の位まで一致する", () => {
        for (const s of stats) {
          expect(result.deck[s], `deck.${s} @L${ch.lane}`).toBe(
            ch.stats.total_after_non_skill_modifiers[s],
          );
        }
      });

      it("basic（基礎ステータス表示値）が 1 の位まで一致する", () => {
        for (const s of stats) {
          expect(result.basic[s], `basic.${s} @L${ch.lane}`).toBe(ch.stats.base[s]);
        }
      });
    });
  }
});

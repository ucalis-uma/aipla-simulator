/**
 * type36（条件参照スコア）のスケーリング計算式の単体テスト。
 *
 * - 式の由来: やるキ士スプレッドシート gid=806980235（research/type36_coefficients.md）
 * - 検証対象: src/timeline/engine.ts の scaledSkillPowerPermil
 */
import { describe, expect, it } from "vitest";
import { scaledSkillPowerPermil } from "../../../src/timeline/engine.js";
import type { BuffSnapshot } from "../../../src/timeline/types.js";

const emptySnap = (): BuffSnapshot => {
  const s: Record<string, number> = {};
  const keys = [
    "vocal_up", "vocal_boost", "vocal_up_extreme", "vocal_down",
    "dance_up", "dance_boost", "dance_down", "visual_up", "visual_boost", "visual_down",
    "beat_score_up", "tension_up", "score_up", "a_skill_score_up", "sp_skill_score_up",
    "p_skill_score_up", "combo_score_up", "critical_coeff_up", "critical_rate_up",
    "stamina_cost_down", "stamina_cost_up", "skill_success_up", "focus", "stealth",
    "combo_continue",
  ] as const;
  for (const k of keys) s[k] = 0;
  return s as unknown as BuffSnapshot;
};

const baseCtx = (combo: number) => ({
  input: {} as never,
  displayCombo: { value: combo },
  cumulative: { value: 0 },
  comboTable: [] as never,
  successBase: 1000,
  policy: "at-end" as never,
}) as never;

const selfOf = (overrides: Partial<{ stamina: number; maxStamina: number; staminaSpent: number; activated: number }> = {}) =>
  ({
    stamina: overrides.stamina ?? 10000,
    maxStamina: overrides.maxStamina ?? 10000,
    staminaSpent: overrides.staminaSpent ?? 0,
    activated: overrides.activated ?? 0,
  } as never);

describe("scaledSkillPowerPermil（type36 スケーリング）", () => {
  // --- linear ---
  it("linear: power×(1000+perStage×ref)/1000 を 0.1%（permil）切り捨てで返す", () => {
    const snap = emptySnap();
    snap.focus = 10;
    const out = scaledSkillPowerPermil(
      10000,
      { ref: "focus_stages", perStagePermil: 70, formula: "linear", fitted: false },
      snap,
      selfOf(),
      baseCtx(0),
    );
    expect(out).toBe(17000); // 10000 × 1.7
  });

  it("linear: perStagePermil=null はスケーリングなし（そのまま返す）", () => {
    const out = scaledSkillPowerPermil(
      4700,
      { ref: "focus_stages", perStagePermil: null, formula: "linear", fitted: false },
      emptySnap(),
      selfOf(),
      baseCtx(0),
    );
    expect(out).toBe(4700);
  });

  it("linear: scaling=null はそのまま返す", () => {
    const out = scaledSkillPowerPermil(3600, null, emptySnap(), selfOf(), baseCtx(0));
    expect(out).toBe(3600);
  });

  // --- comboLessQuad（docs: 200%×((150-combo)/150)²）---
  it("comboLessQuad: 0コンボ→+200% / 50コンボ→+88.89% / 100コンボ→+22.22% / 150+→+0%", () => {
    const scaling = {
      ref: "combo_prior",
      perStagePermil: null,
      formula: "comboLessQuad" as const,
      amplitudePermil: 2000,
      reference: 150,
      exponent: 2,
    };
    // 4700% を基本に
    expect(scaledSkillPowerPermil(4700, scaling, emptySnap(), selfOf(), baseCtx(0))).toBe(14100); // ×3.0
    expect(scaledSkillPowerPermil(4700, scaling, emptySnap(), selfOf(), baseCtx(50))).toBe(8877); // ×1.8888… → floor
    expect(scaledSkillPowerPermil(4700, scaling, emptySnap(), selfOf(), baseCtx(100))).toBe(5744); // ×1.2222… → floor
    expect(scaledSkillPowerPermil(4700, scaling, emptySnap(), selfOf(), baseCtx(150))).toBe(4700);
    expect(scaledSkillPowerPermil(4700, scaling, emptySnap(), selfOf(), baseCtx(200))).toBe(4700); // 負の無効化
  });

  it("comboLessQuad: 0.1% 切り捨て（例: ×2.6 の端数）", () => {
    const scaling = {
      ref: "combo_prior", perStagePermil: null,
      formula: "comboLessQuad" as const,
      amplitudePermil: 1000, reference: 150, exponent: 1,
    };
    // 1500: (1 + 1×((150-60)/150)) = ×1.6 → 2400
    expect(scaledSkillPowerPermil(1500, scaling, emptySnap(), selfOf(), baseCtx(60))).toBe(2400);
  });

  // --- comboMoreLinear（docs: +(10/11)%/コンボ）---
  it("comboMoreLinear: 110 コンボで +100%", () => {
    const scaling = {
      ref: "combo_prior", perStagePermil: null,
      formula: "comboMoreLinear" as const, perComboPermil: 9.090909,
    };
    const out = scaledSkillPowerPermil(1000, scaling, emptySnap(), selfOf(), baseCtx(110));
    // 厳密値: 9.090909×110 = 999.9999… → floor(1000×1999.9999…/1000) = 1999（±1 で丸め）
    expect([1999, 2000]).toContain(out);
  });

  // --- effectCount（docs: +14%/種類・上限未設定=無上限）---
  it("effectCount: バフ種類数×140‰（combo_continue/stealth 除外）", () => {
    const snap = emptySnap();
    snap.vocal_up = 3;
    snap.vocal_boost = 4;
    snap.focus = 10;
    snap.critical_rate_up = 5;
    snap.combo_continue = 1; // 除外される
    snap.stealth = 2; // 除外される
    const scaling = {
      ref: "effect_count", perStagePermil: null,
      formula: "effectCount" as const, perTypePermil: 140, maxTypes: null,
    };
    // count=4 → 1000 × (1 + 0.14×4) = 1560
    expect(scaledSkillPowerPermil(1000, scaling, snap, selfOf(), baseCtx(0))).toBe(1560);
  });

  it("effectCount: maxTypes 指定時は上限でクランプ", () => {
    const snap = emptySnap();
    for (const k of ["vocal_up", "vocal_boost", "focus", "score_up", "tension_up", "combo_score_up", "critical_rate_up", "critical_coeff_up", "a_skill_score_up", "sp_skill_score_up"] as const) {
      snap[k] = 1;
    }
    const scaling = {
      ref: "effect_count", perStagePermil: null,
      formula: "effectCount" as const, perTypePermil: 140, maxTypes: 9,
    };
    // count=10 → clamp 9 → 1000×(1+1.26) = 2260
    expect(scaledSkillPowerPermil(1000, scaling, snap, selfOf(), baseCtx(0))).toBe(2260);
  });

  // --- staminaRatioQuad（docs: 80%×率²）---
  it("staminaRatioQuad: 残率50% → +20% / 残率100% → +80%", () => {
    const scaling = {
      ref: "stamina_remaining", perStagePermil: null,
      formula: "staminaRatioQuad" as const, maxPermil: 800, remainingRatio: true,
    };
    expect(scaledSkillPowerPermil(1000, scaling, emptySnap(), selfOf({ stamina: 5000, maxStamina: 10000 }), baseCtx(0))).toBe(1200);
    expect(scaledSkillPowerPermil(1000, scaling, emptySnap(), selfOf({ stamina: 10000, maxStamina: 10000 }), baseCtx(0))).toBe(1800);
  });

  it("staminaRatioQuad: remainingRatio=false（消費率²）", () => {
    const scaling = {
      ref: "stamina_consumed", perStagePermil: null,
      formula: "staminaRatioQuad" as const, maxPermil: 800, remainingRatio: false,
    };
    // 50% 消費 → +20%
    expect(scaledSkillPowerPermil(1000, scaling, emptySnap(), selfOf({ stamina: 5000, maxStamina: 10000 }), baseCtx(0))).toBe(1200);
  });

  // --- staminaConsumedLinear（docs: 0.011%/スタミナ）---
  it("staminaConsumedLinear: 5000 スタミナで +55%", () => {
    const scaling = {
      ref: "stamina_consumed_total", perStagePermil: null,
      formula: "staminaConsumedLinear" as const, perStaminaPermil: 0.11,
    };
    expect(scaledSkillPowerPermil(1000, scaling, emptySnap(), selfOf({ staminaSpent: 5000 }), baseCtx(0))).toBe(1550);
  });

  // --- skillCountLinear（docs: 9.7%/回）---
  it("skillCountLinear: 10 回で +97%", () => {
    const scaling = {
      ref: "skill_count", perStagePermil: null,
      formula: "skillCountLinear" as const, perCountPermil: 97,
    };
    expect(scaledSkillPowerPermil(1000, scaling, emptySnap(), selfOf({ activated: 10 }), baseCtx(0))).toBe(1970);
  });

  it("未対応 formula は throw（fail-fast）", () => {
    const scaling = {
      ref: "foobar", perStagePermil: null,
      formula: "magic" as never,
    };
    expect(() => scaledSkillPowerPermil(1000, scaling, emptySnap(), selfOf(), baseCtx(0))).toThrow();
  });
});

/**
 * buffs.ts 単体テスト（合成データのみ。実測大ファイルは読まない）。
 *
 * 出典: research/01 §2.2（合成=加算・上限超過は付与時に無視）・§2.3（10段+10段=2.25倍）・
 *       §2.6（テンション副効果 -1.5%/段・集目 3段+21‰〜10段+50‰）、
 *       research/02 §1.3（B1 構成）・§1.6（段数上限・limit解放 20→30）、
 *       P3a 写像仕様（上限解放変数型の基底キー統合）。
 */
import { describe, expect, it } from "vitest";
import {
  aggregateBuffs,
  b1Permil,
  consumptionMultiplierPermil,
  fanFactorPermil,
  focusFanBonusPermil,
  liveStatusMultiplierPermil,
  mapEffectToBuffKey,
  stageCap,
  stageCapPermil,
  successRatePermil,
  type ActiveEffect,
} from "../../../src/timeline/buffs.js";
import type { BuffKey, BuffSnapshot, EffectType } from "../../../src/timeline/types.js";

/** 未所有キー 0 のスナップショット（テスト用。全14キー） */
function snapshotOf(overrides: Partial<BuffSnapshot> = {}): BuffSnapshot {
  return {
    vocal_up: 0,
    vocal_boost: 0,
    vocal_up_extreme: 0,
    tension_up: 0,
    score_up: 0,
    a_skill_score_up: 0,
    sp_skill_score_up: 0,
    combo_score_up: 0,
    critical_coeff_up: 0,
    critical_rate_up: 0,
    stamina_cost_down: 0,
    skill_success_up: 0,
    focus: 0,
    combo_continue: 0,
    ...overrides,
  };
}

/** ActiveEffect の簡易ビルダ（既定: 1段・残り10ビート） */
function effect(overrides: Partial<ActiveEffect> & { type: EffectType }): ActiveEffect {
  return {
    stages: 1,
    remainingBeats: 10,
    sourceSkillId: "test-skill",
    ...overrides,
  };
}

const ALL_BUFF_KEYS: readonly BuffKey[] = [
  "vocal_up",
  "vocal_boost",
  "vocal_up_extreme",
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

describe("mapEffectToBuffKey", () => {
  it("通常型は同名キーに写像（代表3種+独立キーの vocal_up_extreme）", () => {
    expect(mapEffectToBuffKey("vocal_up")).toEqual({ key: "vocal_up", limitRelease: false });
    expect(mapEffectToBuffKey("focus")).toEqual({ key: "focus", limitRelease: false });
    expect(mapEffectToBuffKey("combo_continue")).toEqual({
      key: "combo_continue",
      limitRelease: false,
    });
    expect(mapEffectToBuffKey("vocal_up_extreme")).toEqual({
      key: "vocal_up_extreme",
      limitRelease: false,
    });
  });

  it("上限解放変数型は基底キーへ統合し limitRelease=true（P3a 写像仕様）", () => {
    expect(mapEffectToBuffKey("tension_limit")).toEqual({ key: "tension_up", limitRelease: true });
    expect(mapEffectToBuffKey("combo_score_limit")).toEqual({
      key: "combo_score_up",
      limitRelease: true,
    });
    expect(mapEffectToBuffKey("critical_coeff_limit")).toEqual({
      key: "critical_coeff_up",
      limitRelease: true,
    });
  });

  it("スコア取得・即時系は null（段数集計の対象外）", () => {
    expect(mapEffectToBuffKey("score_get")).toBeNull();
    expect(mapEffectToBuffKey("score_get_by_score_ratio")).toBeNull();
    expect(mapEffectToBuffKey("stamina_recovery")).toBeNull();
    expect(mapEffectToBuffKey("ct_reduction")).toBeNull();
    expect(mapEffectToBuffKey("ct_increase")).toBeNull();
    expect(mapEffectToBuffKey("effect_extension")).toBeNull();
    expect(mapEffectToBuffKey("effect_amplify")).toBeNull();
  });
});

describe("stageCap", () => {
  const base20Cases: readonly [EffectType, number][] = [
    ["vocal_up", 20],
    ["vocal_boost", 20],
    ["score_up", 20],
    ["combo_score_up", 20],
    ["critical_rate_up", 20],
    ["stamina_cost_down", 20],
    ["combo_continue", 20],
  ];

  it.each(base20Cases)("%s → 基本上限20", (type, expected) => {
    expect(stageCap(type, false)).toBe(expected);
  });

  const cap10Cases: readonly [EffectType, number][] = [
    ["tension_up", 10],
    ["focus", 10],
    ["skill_success_up", 10],
  ];

  it.each(cap10Cases)("%s → 上限10", (type, expected) => {
    expect(stageCap(type, false)).toBe(expected);
  });

  it("vocal_up_extreme → 30（上限30固定・解放変数型ではない）", () => {
    expect(stageCap("vocal_up_extreme", false)).toBe(30);
    expect(stageCap("vocal_up_extreme", true)).toBe(30);
  });

  it("limitRelease=true で基本上限10/20が30へ拡張", () => {
    expect(stageCap("vocal_up", true)).toBe(30);
    expect(stageCap("tension_up", true)).toBe(30);
    expect(stageCap("skill_success_up", true)).toBe(30);
  });

  it("上限解放変数型自身は limitRelease=false でも30", () => {
    expect(stageCap("tension_limit", false)).toBe(30);
    expect(stageCap("combo_score_limit", false)).toBe(30);
    expect(stageCap("critical_coeff_limit", false)).toBe(30);
  });

  it("スコア取得・即時型は throw（段数を持たない）", () => {
    expect(() => stageCap("score_get", false)).toThrow();
    expect(() => stageCap("ct_reduction", false)).toThrow();
  });
});

describe("stageCapPermil", () => {
  const cases: readonly [EffectType, number][] = [
    ["vocal_up", 50],
    ["vocal_up_extreme", 50],
    ["vocal_boost", 75],
    ["tension_up", 50],
    ["score_up", 25],
    ["a_skill_score_up", 50],
    ["sp_skill_score_up", 30],
    ["combo_score_up", 100],
    ["critical_coeff_up", 50],
    ["critical_rate_up", 50],
    ["stamina_cost_down", 50],
    ["skill_success_up", 37.5],
    ["focus", 50],
    ["combo_continue", 0],
  ];

  it.each(cases)("%s → %j‰/段", (type, expected) => {
    expect(stageCapPermil(type, false)).toBe(expected);
    expect(stageCapPermil(type, true)).toBe(expected);
  });

  it("上限解放変数型は基底キーの1段値", () => {
    expect(stageCapPermil("tension_limit", false)).toBe(50);
    expect(stageCapPermil("combo_score_limit", false)).toBe(100);
    expect(stageCapPermil("critical_coeff_limit", false)).toBe(50);
  });

  it("スコア取得・即時型は throw", () => {
    expect(() => stageCapPermil("score_get", false)).toThrow();
  });
});

describe("aggregateBuffs", () => {
  it("空入力 → 全キー0（全14キーが揃う）", () => {
    const snap = aggregateBuffs([]);
    expect(Object.keys(snap).sort()).toEqual([...ALL_BUFF_KEYS].sort());
    for (const key of ALL_BUFF_KEYS) {
      expect(snap[key]).toBe(0);
    }
  });

  it("同種2ソースは合算（vocal_up 5段×2 → 10段）", () => {
    const snap = aggregateBuffs([
      effect({ type: "vocal_up", stages: 5, sourceSkillId: "s1" }),
      effect({ type: "vocal_up", stages: 5, sourceSkillId: "s2" }),
    ]);
    expect(snap.vocal_up).toBe(10);
  });

  it("上限クランプ: vocal_up 12段+12段=24 → 20（research/01 §2.2・超過分は無視）", () => {
    const snap = aggregateBuffs([
      effect({ type: "vocal_up", stages: 12, sourceSkillId: "s1" }),
      effect({ type: "vocal_up", stages: 12, sourceSkillId: "s2" }),
    ]);
    expect(snap.vocal_up).toBe(20);
  });

  it("limitRelease 付きソースが混ざるとキー上限が30へ拡張", () => {
    const snap = aggregateBuffs([
      effect({ type: "vocal_up", stages: 12, sourceSkillId: "s1" }),
      effect({ type: "vocal_up", stages: 12, sourceSkillId: "s2", limitRelease: true }),
    ]);
    expect(snap.vocal_up).toBe(24);
  });

  it("上限解放変数型は基底キーに合算される（tension_up 4 + tension_limit 3 → 7）", () => {
    const snap = aggregateBuffs([
      effect({ type: "tension_up", stages: 4, sourceSkillId: "s1" }),
      effect({ type: "tension_limit", stages: 3, sourceSkillId: "s2" }),
    ]);
    expect(snap.tension_up).toBe(7);
    expect(snap.combo_score_up).toBe(0);
  });

  it("combo_continue は段数ではなく有効インスタンス数（≥1で保護成立）", () => {
    const snap = aggregateBuffs([
      effect({ type: "combo_continue", stages: 3, sourceSkillId: "s1" }),
      effect({ type: "combo_continue", stages: 5, sourceSkillId: "s2" }),
    ]);
    expect(snap.combo_continue).toBe(2);
  });

  it("未所有キーは0のまま", () => {
    const snap = aggregateBuffs([effect({ type: "focus", stages: 3 })]);
    expect(snap.focus).toBe(3);
    for (const key of ALL_BUFF_KEYS) {
      if (key !== "focus") {
        expect(snap[key]).toBe(0);
      }
    }
  });

  it("即時型・段数0・remainingBeats<=0 は throw（呼び出し側契約）", () => {
    expect(() => aggregateBuffs([effect({ type: "score_get", stages: 1 })])).toThrow();
    expect(() => aggregateBuffs([effect({ type: "vocal_up", stages: 0 })])).toThrow();
    expect(() =>
      aggregateBuffs([effect({ type: "vocal_up", stages: 1, remainingBeats: 0 })]),
    ).toThrow();
  });
});

describe("liveStatusMultiplierPermil", () => {
  it("バフなし → 1000", () => {
    expect(liveStatusMultiplierPermil(snapshotOf(), "vocal")).toBe(1000);
  });

  it("vocal_up 10段 + vocal_boost 10段 → 2250（research/01 §2.3「10段+10段=2.25倍」実測整合値）", () => {
    const snap = snapshotOf({ vocal_up: 10, vocal_boost: 10 });
    expect(liveStatusMultiplierPermil(snap, "vocal")).toBe(1000 + 500 + 750);
    expect(liveStatusMultiplierPermil(snap, "vocal")).toBe(2250);
  });

  it("vocal_up_extreme は vocal_up（上昇系）に加算される【Estimate】", () => {
    expect(
      liveStatusMultiplierPermil(snapshotOf({ vocal_up: 10, vocal_up_extreme: 10 }), "vocal"),
    ).toBe(2000);
    expect(liveStatusMultiplierPermil(snapshotOf({ vocal_up_extreme: 30 }), "vocal")).toBe(2500);
  });

  it("dance/visual は常に 1000（対称 type が現データに無いため）", () => {
    const snap = snapshotOf({ vocal_up: 10, vocal_boost: 10, vocal_up_extreme: 5 });
    expect(liveStatusMultiplierPermil(snap, "dance")).toBe(1000);
    expect(liveStatusMultiplierPermil(snap, "visual")).toBe(1000);
  });
});

describe("consumptionMultiplierPermil", () => {
  it("バフなし → 1000", () => {
    expect(consumptionMultiplierPermil(snapshotOf())).toBe(1000);
  });

  it("stamina_cost_down 5段 → 750（-5%/段）", () => {
    expect(consumptionMultiplierPermil(snapshotOf({ stamina_cost_down: 5 }))).toBe(750);
  });

  it("vocal_boost 4段 → 1040（ブースト副効果 +1%/段）", () => {
    expect(consumptionMultiplierPermil(snapshotOf({ vocal_boost: 4 }))).toBe(1040);
  });

  it("vocal_up_extreme は消費に影響しない（ブースト副効果の対象外）", () => {
    expect(consumptionMultiplierPermil(snapshotOf({ vocal_up_extreme: 10 }))).toBe(1000);
  });
});

describe("b1Permil", () => {
  const bonus = { beat: 300, active: 275, special: 0, passive: 100 };

  it("beat: score_up のみ+エール%。テンションは入らない（S2明記）", () => {
    const snap = snapshotOf({ score_up: 4, tension_up: 10 });
    expect(b1Permil(snap, "beat", bonus)).toBe(1000 + 25 * 4 + 300);
    expect(b1Permil(snap, "beat", bonus)).toBe(1400);
  });

  it("active: A上昇+スコア上昇+テンション+エール%加算（research/02 §1.3【Confirmed・A】）", () => {
    const snap = snapshotOf({ a_skill_score_up: 8, score_up: 2, tension_up: 3 });
    expect(b1Permil(snap, "active", bonus)).toBe(1000 + 400 + 50 + 150 + 275);
    expect(b1Permil(snap, "active", bonus)).toBe(1875);
  });

  it("special: SP上昇+スコア上昇+テンション（【Strong estimate・SP】）", () => {
    const snap = snapshotOf({ sp_skill_score_up: 10, score_up: 2, tension_up: 3 });
    expect(b1Permil(snap, "special", bonus)).toBe(1000 + 300 + 50 + 150 + 0);
    expect(b1Permil(snap, "special", bonus)).toBe(1500);
  });

  it("passive: スコア上昇のみ（Pスキルスコアアップ型は現データ未出現【Unknown】）", () => {
    const snap = snapshotOf({ score_up: 2 });
    expect(b1Permil(snap, "passive", bonus)).toBe(1000 + 50 + 100);
    expect(b1Permil(snap, "passive", bonus)).toBe(1150);
  });
});

describe("successRatePermil", () => {
  it("skill_success_up 10段 → +375（3.75%/段・2段単位整数演算）", () => {
    expect(successRatePermil(snapshotOf({ skill_success_up: 10 }), 600)).toBe(975);
  });

  it("tension_up 4段 → -60（副効果 -1.5%/段）", () => {
    expect(successRatePermil(snapshotOf({ tension_up: 4 }), 1000)).toBe(940);
  });

  it("成功率上昇とテンション低下は同時に効く", () => {
    const snap = snapshotOf({ skill_success_up: 10, tension_up: 4 });
    expect(successRatePermil(snap, 600)).toBe(600 + 375 - 60);
  });

  it("下限 0 でクランプ", () => {
    expect(successRatePermil(snapshotOf({ tension_up: 10 }), 100)).toBe(0);
  });

  it("上限 1000 でクランプ", () => {
    expect(successRatePermil(snapshotOf({ skill_success_up: 10 }), 1000)).toBe(1000);
  });

  it("バフなし → successBasePermil そのまま", () => {
    expect(successRatePermil(snapshotOf(), 850)).toBe(850);
  });
});

describe("focusFanBonusPermil", () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 21],
    [9, 49],
    [10, 50],
    [12, 50],
  ])("focus %i段 → +%i‰（research/01 §2.6: 3段+2.1%〜10段+5.0%）", (stages, expected) => {
    expect(focusFanBonusPermil(stages)).toBe(expected);
  });

  it("非整数・負の段数は throw", () => {
    expect(() => focusFanBonusPermil(-1)).toThrow();
    expect(() => focusFanBonusPermil(1.5)).toThrow();
  });
});

describe("fanFactorPermil", () => {
  it("1620 + focus 10段 → 1670（副効果はファンボーナス項に加算）", () => {
    expect(fanFactorPermil(1620, 10)).toBe(1670);
  });

  it("focus 0段 → basePermil そのまま", () => {
    expect(fanFactorPermil(1620, 0)).toBe(1620);
  });
});

/**
 * buffs.ts 単体テスト（合成データのみ。実測大ファイルは読まない）。
 *
 * 出典: research/01 §2.2（合成=加算。上限超過は付与時に切り捨てず内部保持=【ユーザー確定
 *       2026-08-30】・表示値のみスナップショット時にクランプ）・§2.3（10段+10段=2.25倍）・
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

/** 未所有キー 0 のスナップショット（テスト用。全24キー） */
function snapshotOf(overrides: Partial<BuffSnapshot> = {}): BuffSnapshot {
  return {
    vocal_up: 0,
    vocal_boost: 0,
    vocal_up_extreme: 0,
    vocal_down: 0,
    dance_up: 0,
    dance_boost: 0,
    dance_up_extreme: 0,
    dance_down: 0,
    visual_up: 0,
    visual_boost: 0,
    visual_up_extreme: 0,
    visual_down: 0,
    beat_score_up: 0,
    tension_up: 0,
    score_up: 0,
    a_skill_score_up: 0,
    sp_skill_score_up: 0,
    p_skill_score_up: 0,
    combo_score_up: 0,
    critical_coeff_up: 0,
    critical_rate_up: 0,
    stamina_cost_down: 0,
    stamina_cost_up: 0,
    skill_success_up: 0,
    focus: 0,
    stealth: 0,
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
    sourceLane: 1,
    ...overrides,
  };
}

const ALL_BUFF_KEYS: readonly BuffKey[] = [
  "vocal_up",
  "vocal_boost",
  "vocal_up_extreme",
  "vocal_down",
  "dance_up",
  "dance_boost",
  "dance_up_extreme",
  "dance_down",
  "visual_up",
  "visual_boost",
  "visual_up_extreme",
  "visual_down",
  "beat_score_up",
  "tension_up",
  "score_up",
  "a_skill_score_up",
  "sp_skill_score_up",
  "p_skill_score_up",
  "combo_score_up",
  "critical_coeff_up",
  "critical_rate_up",
  "stamina_cost_down",
  "stamina_cost_up",
  "skill_success_up",
  "focus",
  "stealth",
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

  it("Phase 6 対称型（dance/visual/beat_score）も同名キーに写像", () => {
    expect(mapEffectToBuffKey("dance_up")).toEqual({ key: "dance_up", limitRelease: false });
    expect(mapEffectToBuffKey("dance_boost")).toEqual({ key: "dance_boost", limitRelease: false });
    expect(mapEffectToBuffKey("visual_up")).toEqual({ key: "visual_up", limitRelease: false });
    expect(mapEffectToBuffKey("visual_boost")).toEqual({ key: "visual_boost", limitRelease: false });
    expect(mapEffectToBuffKey("beat_score_up")).toEqual({ key: "beat_score_up", limitRelease: false });
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

  it("上限クランプ: vocal_up 12段+12段=24 → 20（表示値のみクランプ・超過分は内部保持）", () => {
    const snap = aggregateBuffs([
      effect({ type: "vocal_up", stages: 12, sourceSkillId: "s1" }),
      effect({ type: "vocal_up", stages: 12, sourceSkillId: "s2" }),
    ]);
    expect(snap.vocal_up).toBe(20);
  });

  it("【ユーザー確定 2026-08-30】over-cap 内部保持: 19段+4段 → 表示20（切り捨てない）", () => {
    // 付与時に切り捨てないため aggregateBuffs には未整形の19段+4段が渡る。
    // スナップショット（計算式・見た目で使う値）だけが上限20でクランプされる。
    const snap = aggregateBuffs([
      effect({ type: "vocal_up", stages: 19, sourceSkillId: "s1" }),
      effect({ type: "vocal_up", stages: 4, sourceSkillId: "s2" }),
    ]);
    expect(snap.vocal_up).toBe(20);
  });

  it("【ユーザー確定 2026-08-30】over-cap 保持: 期限切れ後も内部段数が上限以上なら上限維持", () => {
    // 内部23段（19+2+2）→ 2段のインスタンスが期限切れ → 内部21段 → 表示20のまま維持。
    // 旧仕様（付与時に超過分を無視）では2段目が付与されず期限切れ後に 19 に落ちるため、
    // 本テストは保持セマンティクスの回帰検知になる。
    // 期待値は old 説だと 19、new 説だと 20。
    const before = aggregateBuffs([
      effect({ type: "vocal_up", stages: 19, remainingBeats: 3, sourceSkillId: "s1" }),
      effect({ type: "vocal_up", stages: 2, remainingBeats: 1, sourceSkillId: "s2" }),
      effect({ type: "vocal_up", stages: 2, remainingBeats: 3, sourceSkillId: "s3" }),
    ]);
    expect(before.vocal_up).toBe(20);
    // s2（2段）が期限切れした直後の集計
    const after = aggregateBuffs([
      effect({ type: "vocal_up", stages: 19, remainingBeats: 2, sourceSkillId: "s1" }),
      effect({ type: "vocal_up", stages: 2, remainingBeats: 2, sourceSkillId: "s3" }),
    ]);
    expect(after.vocal_up).toBe(20);
  });

  it("over-cap 保持は limitRelease なしの内部23段にも適用され、解放時に露出する", () => {
    // 内部24段（12+12）を保持。limitRelease 到着で cap30 になると保持分の 24 が表示される。
    // 【サンプル3・2026-09-03 修正】limit_break 行（基底型+limitRelease）は段数不加算
    // （S3 L1A「手を伸ばす」の上昇 11/15/15 が +4 のみで一致）のため、s3 の 1 段は
    // 加算されず 24 が表示される（旧期待値 25 は加算説に基づく推測だった）。
    const withoutLimit = aggregateBuffs([
      effect({ type: "vocal_up", stages: 12, sourceSkillId: "s1" }),
      effect({ type: "vocal_up", stages: 12, sourceSkillId: "s2" }),
    ]);
    expect(withoutLimit.vocal_up).toBe(20);
    const withLaterLimit = aggregateBuffs([
      effect({ type: "vocal_up", stages: 12, sourceSkillId: "s1" }),
      effect({ type: "vocal_up", stages: 12, sourceSkillId: "s2" }),
      effect({ type: "vocal_up", stages: 1, sourceSkillId: "s3", limitRelease: true }),
    ]);
    expect(withLaterLimit.vocal_up).toBe(24);
  });

  it("limitRelease 付きソースが混ざるとキー上限が30へ拡張（段数は加算しない）", () => {
    // 【サンプル3・2026-09-03 修正】旧期待値 24（12+12 加算説）は S3 実測と矛盾するため
    // 12（limit_break 行は上限解放のみ）に更新。根拠は上記テストと同一。
    const snap = aggregateBuffs([
      effect({ type: "vocal_up", stages: 12, sourceSkillId: "s1" }),
      effect({ type: "vocal_up", stages: 12, sourceSkillId: "s2", limitRelease: true }),
    ]);
    expect(snap.vocal_up).toBe(12);
  });

  it("上限解放変数型は段数を加算せず上限のみ拡張する（実測確定: T5 b2 A検算）", () => {
    // tension_limit 3段を 7 に合算する旧仕様は実測で否定された:
    // combo_score_up 6段+limit10 を16段とすると b2 Aスコアが 41.8M（実測 25.58M の
    // 1.63 倍=乱数域外）。6段（limit は上限拡張のみ）なら 25.7M（乱数 ~995）で整合。
    const snap = aggregateBuffs([
      effect({ type: "tension_up", stages: 4, sourceSkillId: "s1" }),
      effect({ type: "tension_limit", stages: 3, sourceSkillId: "s2" }),
    ]);
    expect(snap.tension_up).toBe(4);
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

  it("vocal_up_extreme の1段値は 50‰（Peing確定: 超化=一律+5段階分・表記段数はダミー）", () => {
    // 【Peing確定 2026-08-31 / サンプル3実測確定 2026-09-04】
    // 超化は表記段階数によらず「元のバフの+5段階分（固定・250‰）」。
    // かつ、基底バフ（vocal_up > 0）が存在する場合のみ発動する。
    expect(
      liveStatusMultiplierPermil(snapshotOf({ vocal_up: 7, vocal_up_extreme: 5 }), "vocal"),
    ).toBe(1000 + 350 + 250);
    // 基底バフがない場合は超化は乗らない（1000‰）
    expect(liveStatusMultiplierPermil(snapshotOf({ vocal_up_extreme: 5 }), "vocal")).toBe(1000);
    // 基底バフが1段以上あれば +250‰ が乗る
    expect(
      liveStatusMultiplierPermil(snapshotOf({ vocal_up: 1, vocal_up_extreme: 5 }), "vocal"),
    ).toBe(1000 + 50 + 250);
  });

  it("dance/visual: 対称キーが効く（Phase 6 一般化）・vocal バフは流入しない", () => {
    const snap = snapshotOf({ dance_up: 4, dance_boost: 2, visual_up: 6, vocal_up: 10 });
    // dance: 1000 + 50×4 + 75×2 = 1350
    expect(liveStatusMultiplierPermil(snap, "dance")).toBe(1350);
    // visual: 1000 + 50×6 = 1300
    expect(liveStatusMultiplierPermil(snap, "visual")).toBe(1300);
    // vocal バフは dance/visual に流入しない
    expect(liveStatusMultiplierPermil(snap, "dance")).not.toBe(
      liveStatusMultiplierPermil(snap, "vocal"),
    );
    // dance/visual に超化キーはない（extreme は vocal 専用）
    expect(liveStatusMultiplierPermil(snapshotOf({ vocal_up_extreme: 30 }), "dance")).toBe(1000);
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
    [1, 7],
    [2, 14],
    [3, 21],
    [5, 35],
    [6, 38],
    [9, 47],
    [10, 50],
    [12, 50],
  ])("focus %i段 → +%i‰（Peing確定 2026-08-31: 1-5段+0.7%/段・6-10段+0.3%/段）", (stages, expected) => {
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

// ---------------------------------------------------------------------------
// Phase 9（Peing確定仕様 2026-08-31）: 超化 capExtend・ステルス・低下バフ・Pスコア
// ---------------------------------------------------------------------------
import { stealthFanBonusPermil } from "../../../src/timeline/buffs.js";

describe("Phase 9: 超化（capExtend）の上限拡張", () => {
  it("通常上限20に達した score_up に超化+5段 → 実効25（上限も+5拡張）", () => {
    const snap = aggregateBuffs([
      effect({ type: "score_up", stages: 20 }),
      effect({ type: "score_up", stages: 5, capExtend: true, sourceSkillId: "choka" }),
    ]);
    expect(snap.score_up).toBe(25);
  });

  it("テンション10（上限10）+ 超化5段 → 実効15（peing: 「10段＋超化は上限解放15段と同価値」）", () => {
    const snap = aggregateBuffs([
      effect({ type: "tension_up", stages: 10 }),
      effect({ type: "tension_up", stages: 5, capExtend: true, sourceSkillId: "choka" }),
    ]);
    expect(snap.tension_up).toBe(15);
  });

  it("超化なしの通常20段は従来どおり 20 でクランプ", () => {
    const snap = aggregateBuffs([
      effect({ type: "score_up", stages: 23 }),
      effect({ type: "score_up", stages: 4, sourceSkillId: "other" }),
    ]);
    expect(snap.score_up).toBe(20);
  });

  it("超化の上限拡張は最大のインスタンスを採用（効果は常に一定の解釈）", () => {
    const snap = aggregateBuffs([
      effect({ type: "score_up", stages: 5, capExtend: true, sourceSkillId: "choka-a" }),
      effect({ type: "score_up", stages: 5, capExtend: true, sourceSkillId: "choka-b" }),
    ]);
    expect(snap.score_up).toBe(10);
  });
});

describe("Phase 9: ステータス低下バフ（vocal/dance/visual_down）", () => {
  it("低下バフは -50‰/段でライブ中ステータス倍率から減算される", () => {
    const snap = snapshotOf({ vocal_up: 4, vocal_down: 2 });
    expect(liveStatusMultiplierPermil(snap, "vocal")).toBe(1000 + 200 - 100);
    expect(liveStatusMultiplierPermil(snap, "dance")).toBe(1000);
  });

  it("dance_down/visual_down も対称に効く", () => {
    const snap = snapshotOf({ dance_down: 3, visual_down: 1 });
    expect(liveStatusMultiplierPermil(snap, "dance")).toBe(1000 - 150);
    expect(liveStatusMultiplierPermil(snap, "visual")).toBe(1000 - 50);
  });
});

describe("Phase 9: P スキルスコア上昇（p_skill_score_up）", () => {
  it("b1 passive に 100‰/段で加算される", () => {
    const snap = snapshotOf({ p_skill_score_up: 3, score_up: 2 });
    const b1 = b1Permil(snap, "passive", { beat: 0, active: 0, special: 0, passive: 0 });
    expect(b1).toBe(1000 + 300 + 50);
  });

  it("beat/active/special には乗らない", () => {
    const snap = snapshotOf({ p_skill_score_up: 5 });
    expect(b1Permil(snap, "beat", { beat: 0, active: 0, special: 0, passive: 0 })).toBe(1000);
    expect(b1Permil(snap, "active", { beat: 0, active: 0, special: 0, passive: 0 })).toBe(1000);
  });
});

describe("Phase 9: ステルス副効果（stealthFanBonusPermil）", () => {
  it.each([
    [0, 0],
    [5, 18], // peing確定: 5段 +1.8%
    [6, 21], // peing確定: 6段 +2.1%
    [10, 37], // peing確定: 10段 +3.7%
    [12, 37],
  ])("stealth %i段 → +%i‰（peing id=1188720397・1-4段は Unknown=0 近似）", (stages, expected) => {
    expect(stealthFanBonusPermil(stages)).toBe(expected);
  });

  it("7-9段は 6→10段が +4‰/段で一意確定（25/29/33）", () => {
    expect(stealthFanBonusPermil(7)).toBe(25);
    expect(stealthFanBonusPermil(8)).toBe(29);
    expect(stealthFanBonusPermil(9)).toBe(33);
  });
});

/**
 * 与/被スコープ付き延長・増強レタッチとビート確率条件（Phase 8-B4）の単体テスト。
 *
 * - 延長/増強に buffKey（絞り込みバフ）と scope（与/被）を指定できる
 *   （与・クリティカル率延長 等、やる気士docs の専用フォト由来の効果をフォト作成で再現）
 * - 「ビート時、10%の確率で」（beat_chance=10）は発動試行ごとの確率ゲート
 *   （確定値ランの NeutralRng/ConstRng float=0 は常に成立・既存ゲートと同一規約）
 */
import { describe, expect, it } from "vitest";
import { simulateTimeline } from "../../../src/timeline/engine.js";
import type {
  ChartNote,
  LaneInput,
  LaneNumber,
  SimulateInput,
  SkillDef,
  StageInput,
} from "../../../src/timeline/types.js";
import type { ScoreRng } from "../../../src/rng/types.js";
import type { StatValues } from "../../../src/types.js";

/** 常に固定値を返す RNG（数値検証用・スコア乱数 1000=中立・クリティカルなし） */
class ConstRng implements ScoreRng {
  constructor(
    private readonly roll: number = 1000,
    private readonly crit: boolean = false,
    private readonly float: number = 0,
  ) {}
  nextScoreRoll(): number {
    return this.roll;
  }
  nextCritical(): boolean {
    return this.crit;
  }
  nextFloat(): number {
    return this.float;
  }
}

function deck(overrides: Partial<StatValues<number>> = {}): StatValues<number> {
  return {
    vocal: 100000,
    dance: 50000,
    visual: 25000,
    stamina: 100000,
    mental: 1000,
    critical: 0,
    ...overrides,
  };
}

function lane(lane: LaneNumber, overrides: Partial<LaneInput> = {}): LaneInput {
  return {
    lane,
    attribute: "vocal",
    deck: deck(),
    skills: [],
    photos: [],
    scoreBonusPct: { beat: 0, active: 0, special: 0, passive: 0 },
    critExtrasPermil: 0,
    ...overrides,
  };
}

function defaultLanes(): LaneInput[] {
  return [
    lane(1),
    lane(2),
    lane(3, { deck: deck({ vocal: 120000 }) }),
    lane(4, { attribute: "dance" }),
    lane(5),
  ];
}

function stage(overrides: Partial<StageInput> = {}): StageInput {
  return {
    id: "test-stage",
    laneAttributes: [2, 2, 1, 2, 2],
    beatWeightsPermil: { vocal: 600, dance: 250, visual: 150 },
    skillWeightsPermil: { active: 1000, special: 1000 },
    stageFactorPermil: 1000,
    ...overrides,
  };
}

function chart(beats: number): ChartNote[] {
  return Array.from({ length: beats }, (_, i) => ({
    beat: i + 1,
    noteType: 1 as const,
    position: 3 as const,
  }));
}

function skill(partial: Partial<SkillDef> & { id: string }): SkillDef {
  return {
    name: partial.id,
    kind: "P",
    level: 6,
    lane: 1,
    ct: null,
    staminaCost: 0,
    probabilityPermil: 1000,
    limitPerLive: null,
    effects: [],
    ...partial,
  };
}

function input(lanes: LaneInput[], overrides: Partial<SimulateInput> = {}): SimulateInput {
  return {
    lanes,
    notes: chart(24),
    stage: stage(),
    fanFactorPermil: 1000,
    criticalProvider: () => false,
    rng: new ConstRng(),
    ...overrides,
  };
}

/** 自レーンに自己バフを付与する P スキル（vocal_up 5段 10b・CT大で 1 回のみ発動） */
function selfBuffSkill(lane: LaneNumber, target: SkillDef["effects"][number]["target"] = "self"): SkillDef {
  return skill({
    id: `sk-test-buff-${lane}`,
    lane,
    ct: 999, // テスト譜面内で再発動しない（バフの切れ目を可視化するため）
    effects: [
      {
        type: "vocal_up",
        stages: 5,
        durationBeats: 10,
        target,
        condition: "none",
      },
    ],
  });
}

/** 延長/増強レタッチのフォトスキル（即時・値 = ビート数 or 段数） */
function retouchPhoto(
  lane: LaneNumber,
  id: string,
  type: "effect_extension" | "effect_amplify",
  opts: {
    value: number;
    buffKey?: "vocal_up" | "dance_up";
    scope?: "given" | "received";
    target?: "self" | "score_type_1";
  },
): SkillDef {
  return skill({
    id,
    kind: "photo",
    lane,
    ct: 0,
    effects: [
      {
        type,
        value: opts.value,
        durationBeats: null,
        target: opts.target ?? "self",
        condition: "none",
        ...(opts.buffKey !== undefined ? { buffKey: opts.buffKey } : {}),
        ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
      },
    ],
  });
}

describe("与/被スコープ付き延長・増強レタッチ（Phase 8-B4）", () => {
  const run = (lanes: LaneInput[]): number => simulateTimeline(input(lanes)).totalScore;

  it("被・バフ延長: buffKey 一致のバフのみ延長され、不一致は無効果（全バフ延長より弱い）", () => {
    const base = (): LaneInput[] => [
      lane(1, { skills: [selfBuffSkill(1)] }),
      lane(2),
      lane(3, { deck: deck({ vocal: 120000 }) }),
      lane(4, { attribute: "dance" }),
      lane(5),
    ];
    // 被・Vo延長+5: 自分の vocal_up（10b）が 15b になる → スコア増
    const withVo = base();
    withVo[0]!.photos = [retouchPhoto(1, "uph-ext-vo", "effect_extension", { value: 5, buffKey: "vocal_up" })];
    // 被・Da延長+5: vocal_up は延長されない → 無効果
    const withDa = base();
    withDa[0]!.photos = [retouchPhoto(1, "uph-ext-da", "effect_extension", { value: 5, buffKey: "dance_up" })];
    expect(run(withVo)).toBeGreaterThan(run(withDa));
  });

  it("被・バフ増強: buffKey 一致のバフのみ増強される", () => {
    const base = (): LaneInput[] => [
      lane(1, { skills: [selfBuffSkill(1)] }),
      lane(2),
      lane(3, { deck: deck({ vocal: 120000 }) }),
      lane(4, { attribute: "dance" }),
      lane(5),
    ];
    const withVo = base();
    withVo[0]!.photos = [retouchPhoto(1, "uph-amp-vo", "effect_amplify", { value: 3, buffKey: "vocal_up" })];
    const withDa = base();
    withDa[0]!.photos = [retouchPhoto(1, "uph-amp-da", "effect_amplify", { value: 3, buffKey: "dance_up" })];
    expect(run(withVo)).toBeGreaterThan(run(withDa));
  });

  it("与・バフ延長: 自分が付与した他レーンのバフが延長される（他レーン付与者では無効果）", () => {
    const base = (): LaneInput[] => [
      // L1 が全レーンに vocal_up 5段 10b を付与
      lane(1, { skills: [selfBuffSkill(1, "all")] }),
      lane(2),
      lane(3, { deck: deck({ vocal: 120000 }) }),
      lane(4, { attribute: "dance" }),
      lane(5),
    ];
    // L1 のフォト（与・Vo延長+5）: L1 が付与した全レーンの vocal_up が延長される
    const givenByL1 = base();
    givenByL1[0]!.photos = [
      retouchPhoto(1, "uph-ext-given", "effect_extension", { value: 5, buffKey: "vocal_up", scope: "given" }),
    ];
    // L2 のフォト（同一効果）: L2 は何も付与していないため無効果
    const givenByL2 = base();
    givenByL2[1]!.photos = [
      retouchPhoto(2, "uph-ext-given2", "effect_extension", { value: 5, buffKey: "vocal_up", scope: "given" }),
    ];
    expect(run(givenByL1)).toBeGreaterThan(run(givenByL2));
  });

  it("与・バフ増強: 自分が付与したバフの最長インスタンスが増強される", () => {
    const base = (): LaneInput[] => [
      lane(1, { skills: [selfBuffSkill(1, "all")] }),
      lane(2),
      lane(3, { deck: deck({ vocal: 120000 }) }),
      lane(4, { attribute: "dance" }),
      lane(5),
    ];
    const givenByL1 = base();
    givenByL1[0]!.photos = [
      retouchPhoto(1, "uph-amp-given", "effect_amplify", { value: 3, buffKey: "vocal_up", scope: "given" }),
    ];
    const givenByL2 = base();
    givenByL2[1]!.photos = [
      retouchPhoto(2, "uph-amp-given2", "effect_amplify", { value: 3, buffKey: "vocal_up", scope: "given" }),
    ];
    expect(run(givenByL1)).toBeGreaterThan(run(givenByL2));
  });
});

describe("対象指定の延長/増強（スコープ指定なし・Phase 8-B5）", () => {
  const run = (lanes: LaneInput[]): number => simulateTimeline(input(lanes)).totalScore;

  it("スコープ指定なしは target 解決の対象（スコアラー1人）のバフを延長する（T5「びっくりした?」同型）", () => {
    const base = (): LaneInput[] => [
      // L1 = スコアラー。L2 の P スキルがスコアラー（L1）に vocal_up 5段 10b を付与
      lane(1, { role: "Scorer" }),
      lane(2, { skills: [selfBuffSkill(2, "score_type_1")] }),
      lane(3, { deck: deck({ vocal: 120000 }) }),
      lane(4, { attribute: "dance" }),
      lane(5),
    ];
    const withExt = base();
    // L2 のフォト（スコープ指定なし・対象=スコアラー1人・Vo バフを延長）
    withExt[1]!.photos = [
      retouchPhoto(2, "uph-ext-scorer", "effect_extension", {
        value: 5,
        buffKey: "vocal_up",
        target: "score_type_1",
      }),
    ];
    const withoutExt = base();
    expect(run(withExt)).toBeGreaterThan(run(withoutExt));
  });

  it("trigger 対象: 条件を満たしたレーン（集目状態の1人）への延長が発動する（T5「明るく君を照らしたい」同型）", () => {
    // L1 が集目（focus）を自己付与・L2 のフォトは「誰かが集目状態の時・その人に延長」
    const focusSkill = skill({
      id: "sk-test-focus",
      lane: 1,
      ct: 999,
      effects: [
        { type: "focus", stages: 3, durationBeats: 12, target: "self", condition: "none" },
      ],
    });
    const vocalSkill = skill({
      id: "sk-test-vo2",
      lane: 2,
      ct: 999,
      effects: [
        { type: "vocal_up", stages: 5, durationBeats: 10, target: "self", condition: "none" },
      ],
    });
    const extPhoto = skill({
      id: "uph-ext-trigger",
      kind: "photo",
      lane: 2,
      ct: 0,
      effects: [
        {
          type: "effect_extension",
          value: 6,
          durationBeats: null,
          target: "trigger",
          condition: "someone_focus" as never,
        },
      ],
    });
    const withPhoto = (): LaneInput[] => [
      lane(1, { skills: [focusSkill, vocalSkill] }),
      lane(2, { photos: [extPhoto] }),
      lane(3, { deck: deck({ vocal: 120000 }) }),
      lane(4, { attribute: "dance" }),
      lane(5),
    ];
    const withoutPhoto = (): LaneInput[] => [
      lane(1, { skills: [focusSkill, vocalSkill] }),
      lane(2),
      lane(3, { deck: deck({ vocal: 120000 }) }),
      lane(4, { attribute: "dance" }),
      lane(5),
    ];
    // L1 の vocal_up（自己付与・集目状態の本人）が延長されてスコア増
    expect(run(withPhoto())).toBeGreaterThan(run(withoutPhoto()));
  });
});

describe("ビート時、N%の確率で（beat_chance・Phase 8-B4）", () => {
  it("beat_chance=10 は抽選成立時のみ発動（float=0 で常時・float>=0.1 で不発）", () => {
    const lanes = (): LaneInput[] => [
      lane(1, {
        photos: [
          skill({
            id: "uph-chance",
            kind: "photo",
            lane: 1,
            ct: 0,
            effects: [
              {
                type: "vocal_up",
                stages: 5,
                durationBeats: 10,
                target: "self",
                condition: "beat_chance=10" as never,
              },
            ],
          }),
        ],
      }),
      lane(2),
      lane(3, { deck: deck({ vocal: 120000 }) }),
      lane(4, { attribute: "dance" }),
      lane(5),
    ];
    const always = simulateTimeline(input(lanes(), { rng: new ConstRng(1000, false, 0) })).totalScore;
    const never = simulateTimeline(input(lanes(), { rng: new ConstRng(1000, false, 0.99) })).totalScore;
    const noPhoto = simulateTimeline(
      input([
        lane(1),
        lane(2),
        lane(3, { deck: deck({ vocal: 120000 }) }),
        lane(4, { attribute: "dance" }),
        lane(5),
      ]),
    ).totalScore;
    // 成立側はバフが乗り、不成立側はフォトなしと同一
    expect(always).toBeGreaterThan(noPhoto);
    expect(never).toBe(noPhoto);
  });

  it("combo>=70 条件は 70 コンボ到達後のみ発動する（無条件より弱い・条件なしより強い）", () => {
    const photo = (condition: SkillDef["effects"][number]["condition"]): SkillDef =>
      skill({
        id: "uph-combo",
        kind: "photo",
        lane: 1,
        ct: 0,
        effects: [
          {
            type: "vocal_up",
            stages: 5,
            durationBeats: 10,
            target: "self",
            condition,
          },
        ],
      });
    const lanes = (p: SkillDef | null): LaneInput[] => [
      lane(1, { photos: p ? [p] : [] }),
      lane(2),
      lane(3, { deck: deck({ vocal: 120000 }) }),
      lane(4, { attribute: "dance" }),
      lane(5),
    ];
    // 120 ビートでコンボが 70 以上に達する区間を作る
    const mk = (p: SkillDef | null): SimulateInput => ({
      ...input(lanes(p)),
      notes: chart(120),
    });
    const none = simulateTimeline(mk(null)).totalScore;
    const gated = simulateTimeline(mk(photo("combo>=70"))).totalScore;
    const unconditional = simulateTimeline(mk(photo("none"))).totalScore;
    // 条件付きは 70 コンボ到達後のみ発動（発動ビートが減る）・無発動よりは増える
    expect(gated).toBeGreaterThan(none);
    expect(gated).toBeLessThan(unconditional);
  });
});

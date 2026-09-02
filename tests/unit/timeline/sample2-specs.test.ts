/**
 * サンプル2実測（2026-09-02）で確定・対応した仕様の単体テスト（合成ミニフィクスチャのみ）。
 *
 * 検証観点（aipura_nox/サンプル2/issues.md・research/20_sample2_gap_analysis）:
 * - S2-2: tg-someone_status_group-weekness（誰かが低下効果状態の時）の条件化。
 *   低下効果なし編成では全編不発（実測: 憧れていた青春 が L1 の P 予算を独占し
   * 本当は起きてた の発動間隔 b1→b55 を崩していた）→ someone_down_group 条件で不発。
 * - S2-3: 効果行単位の triggerId（skillDetails[].triggerId → importer）により
 *   「score_get 行は無条件・バフ行のみ <属性>レーン条件」の混合スキルが正しく
 *   条件化される（データ側の検証: skills_master.json の 似た者親子のメッセージ）。
 * - S2-4: CLI の audience 明示時は cap/5 で上書きしない（buildSimulateInput への
 *   入力経路の確認。実測 fan.png 由来の個人来場ファン数を尊重）。
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

class ConstRng implements ScoreRng {
  nextScoreRoll(): number {
    return 1000;
  }
  nextCritical(): boolean {
    return false;
  }
  nextFloat(): number {
    return 0;
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

function note(beat: number, noteType: 1 | 2 | 3, position: 0 | 1 | 2 | 3 | 4 | 5): ChartNote {
  return { beat, noteType, position };
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

function input(
  notes: ChartNote[],
  lanes: LaneInput[] = defaultLanes(),
  overrides: Partial<SimulateInput> = {},
): SimulateInput {
  return {
    lanes,
    notes,
    stage: stage(),
    fanFactorPermil: 1000,
    criticalProvider: () => false,
    rng: new ConstRng(),
    ...overrides,
  };
}

/** S2-2: 誰かが低下効果状態の時（tg-someone_status_group-weekness） */
describe("サンプル2確定仕様: 誰かが低下効果状態の時（someone_down_group）", () => {
  // 憧れていた青春 型: 低下効果条件付き P スキル（visual_boost を trigger へ付与）
  const weaknessSkill = (laneNumber: LaneNumber): SkillDef =>
    skill({
      id: "sk-test-weakness",
      lane: laneNumber,
      kind: "P",
      ct: 60,
      staminaCost: 100,
      effects: [
        {
          type: "visual_boost",
          stages: 10,
          durationBeats: 41,
          target: "trigger",
          condition: "someone_down_group",
        },
      ],
    });

  it("低下効果なし編成では全編不発する（サンプル2 の憧れていた青春）", () => {
    const lanes = defaultLanes().map((l) =>
      l.lane === 1 ? { ...l, skills: [weaknessSkill(1)] } : l,
    );
    const result = simulateTimeline(input([note(1, 1, 3), note(2, 1, 3), note(3, 1, 3)], lanes));
    // b1 〜 b3 のどこでも発動しない
    for (const bt of result.beats) {
      expect(bt.activations.filter((a) => a.skillId === "sk-test-weakness" && a.success)).toEqual([]);
    }
  });

  it("誰かが低下効果（vocal_down）を持つと発動する", () => {
    // L2 に vocal_down バフを直接与えた状態は作れないため、低下効果を付与するスキルを L2 に置く
    const downSkill = skill({
      id: "sk-test-down",
      lane: 2,
      kind: "P",
      ct: null,
      staminaCost: 0,
      effects: [
        { type: "vocal_down", stages: 5, durationBeats: 40, target: "self", condition: "none" },
      ],
    });
    const lanes = defaultLanes().map((l) => {
      if (l.lane === 1) return { ...l, skills: [weaknessSkill(1)] };
      if (l.lane === 2) return { ...l, skills: [downSkill] };
      return l;
    });
    const result = simulateTimeline(input([note(1, 1, 3)], lanes));
    const fired = result.beats[0]?.activations.find(
      (a) => a.skillId === "sk-test-weakness" && a.success,
    );
    expect(fired).toBeDefined();
  });
});

/** S2-3: 効果行単位トリガー（importer の skillDetails[].triggerId 写像）のデータ検証 */
describe("サンプル2確定仕様: 効果行単位トリガーの写像", () => {
  it("似た者親子のメッセージ: score_get 行は無条件・バフ行のみ self_visual_lane 条件", () => {
    const master = JSON.parse(
      JSON.stringify(require("../../../data/skills_master.json")),
    ) as { byCard: Record<string, Array<{ id: string; effects: Array<{ condition?: string }> }>> };
    const skillDef = master.byCard["card-rei-05-fest-01"]?.find(
      (s) => s.id === "sk-rei-05-fest-01-2",
    );
    expect(skillDef).toBeDefined();
    const rows = skillDef!.effects;
    // 行1: score_get（無条件）
    expect(rows[0]?.condition).toBe("none");
    // 行2以降: tg-position_attribute_visual 由来の self_visual_lane
    const conditioned = rows.filter((r) => r.condition === "self_visual_lane");
    expect(conditioned.length).toBeGreaterThanOrEqual(1);
  });

  it("憧れていた青春: 効果行が someone_down_group 条件を持つ", () => {
    const master = JSON.parse(
      JSON.stringify(require("../../../data/skills_master.json")),
    ) as { byCard: Record<string, Array<{ id: string; effects: Array<{ condition?: string }> }>> };
    const skillDef = master.byCard["card-hrk-05-sail-00"]?.find(
      (s) => s.id === "sk-hrk-05-sail-00-2",
    );
    expect(skillDef).toBeDefined();
    expect(skillDef!.effects.some((r) => r.condition === "someone_down_group")).toBe(true);
  });
});

/** S2-4: CLI の audience 明示時の扱い（実測 fan.png 由来の audience を尊重する） */
describe("サンプル2確定仕様: audience の取り扱い", () => {
  it("audience 明示時は会場キャパ cap/5 で上書きされない（fanFactorPermil が実測 audience 由来になる）", async () => {
    const { execFileSync } = await import("node:child_process");
    const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const repoRoot = path.resolve(path.dirname(__filename.replace(/\\/g, "/")), "../../..");
    const runCli = (audience: number | undefined): number => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "aipura-s2-"));
      const input = path.join(dir, "config.json");
      const cfg: Record<string, unknown> = {
        deck: {
          staff_bonus: { vocal: 0, dance: 0, visual: 0, stamina: 0, mental: 0, critical: 0 },
          yale_bonus: {
            vocal_pct: 0,
            dance_pct: 0,
            visual_pct: 0,
            stamina: 0,
            mental: 0,
            critical: 0,
            beat_score_pct: 0,
            a_skill_score_pct: 0,
            sp_skill_score_pct: 0,
            critical_score_pct: 0,
          },
          characters: Array.from({ length: 5 }, (_, i) => ({
            lane: i + 1,
            card_id: i === 0 ? "card-rio-05-fest-01" : "card-yu-05-birt-02",
            level: 215,
            rarity: 10,
            role: "Scorer",
            kouryu_level: 1,
            stats: {
              base: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
              total_after_non_skill_modifiers: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
            },
            photos: [],
            accessories: [],
          })),
        },
        stage: { file: "qt-daily-003-19" },
        chart: { file: "chart-hsm-004-001" },
        critRate: 0,
      };
      if (audience !== undefined) cfg.audience = audience;
      writeFileSync(input, JSON.stringify(cfg));
      try {
        const out = execFileSync(
          "npx",
          [
            "tsx",
            path.join(repoRoot, "src/cli/simulate.ts"),
            "--input",
            input,
            "--n",
            "0",
            "--crit-rate",
            "0",
          ],
          { encoding: "utf-8", cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], shell: true },
        );
        return JSON.parse(out).settings.fanFactorPermil;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    // audience 未指定 → cap/5 = 80,000/5 = 16,000 → 1620‰（従来どおり）
    expect(runCli(undefined)).toBe(1620);
    // audience 明示（サンプル2 実測値 13,206）→ テーブル引き 1564‰（cap 80,000 の 16,000 に上書きされない）
    expect(runCli(13206)).toBe(1564);
  });
});

/**
 * 【2026-09-02 ユーザー確定仕様】の回帰テスト:
 * - 超化（add_effect_value_*）は増強型: 同種バフ最長インスタンスへ +5 段・基底なしで不発
 *   （S2 実測: b41 ccu=13 / b100 ccu=0 / b142 ccu=8 → critF 2504/1854/2254 が完全一致）
 * - 効果行は行ごとに独立条件評価（T5 紗季 A2・S2 怜 A2 = 1 行目のみ発動）
 * - 無条件行を 1 つでも持つ P は前発動（祭り千紗 P3 = b1 前半発動）
 */
describe("2026-09-02 確定仕様: 超化は増強型（同種バフ最長インスタンスへ加算）", () => {
  const baseSkill = skill({
    id: "sk-test-ccu-base",
    lane: 1,
    kind: "P",
    ct: 50,
    staminaCost: 0,
    effects: [
      {
        type: "critical_coeff_up",
        stages: 8,
        durationBeats: 40,
        target: "score_type_1",
        condition: "none",
      },
    ],
  });
  const chokaSkill = skill({
    id: "sk-test-ccu-choka",
    lane: 1,
    kind: "P",
    ct: null,
    staminaCost: 0,
    effects: [
      {
        type: "critical_coeff_up",
        stages: 5,
        durationBeats: 40,
        target: "score_type_1",
        condition: "none",
        capExtend: true,
      },
    ],
  });

  it("同種バフが有効なとき最長インスタンスへ +5 段する（8 → 13）", () => {
    const lanes = defaultLanes().map((l) =>
      l.lane === 1 ? { ...l, skills: [baseSkill, chokaSkill] } : l,
    );
    const result = simulateTimeline(input([note(1, 1, 3), note(2, 1, 3)], lanes));
    // b1: 基底 8 段（超化は予算を取られて不発）・b2: 超化が b1 インスタンスへ +5 → 13
    expect(result.beats[0]?.buffSnapshots[0]?.critical_coeff_up).toBe(8);
    expect(result.beats[1]?.buffSnapshots[0]?.critical_coeff_up).toBe(13);
  });

  it("同種バフが存在しないときは不発（独立インスタンスを作らない・b100 実測）", () => {
    const lanes = defaultLanes().map((l) =>
      l.lane === 1 ? { ...l, skills: [chokaSkill] } : l,
    );
    const result = simulateTimeline(input([note(1, 1, 3)], lanes));
    for (const bt of result.beats) {
      expect(bt.buffSnapshots[0]?.critical_coeff_up).toBe(0);
    }
  });

  it("超化後の段数が通常上限を超える場合は上限も拡張される（20+5 → 25）", () => {
    const base20 = skill({
      id: "sk-test-su-base",
      lane: 1,
      kind: "P",
      ct: 50,
      staminaCost: 0,
      effects: [
        { type: "score_up", stages: 20, durationBeats: 40, target: "all", condition: "none" },
      ],
    });
    const chokaSu = skill({
      id: "sk-test-su-choka",
      lane: 1,
      kind: "P",
      ct: null,
      staminaCost: 0,
      effects: [
        {
          type: "score_up",
          stages: 5,
          durationBeats: 40,
          target: "all",
          condition: "none",
          capExtend: true,
        },
      ],
    });
    const lanes = defaultLanes().map((l) =>
      l.lane === 1 ? { ...l, skills: [base20, chokaSu] } : l,
    );
    const result = simulateTimeline(input([note(1, 1, 3), note(2, 1, 3)], lanes));
    expect(result.beats[1]?.buffSnapshots[0]?.score_up).toBe(25);
  });
});

describe("2026-09-02 確定仕様: 効果行の行ごと独立条件評価", () => {
  /** S2 怜 A2 型: 1 行目 無条件 score_get + 2 行目 self_visual_lane バフ */
  const aSkill = skill({
    id: "sk-test-row-a",
    lane: 3,
    kind: "A",
    ct: 30,
    staminaCost: 0,
    effects: [
      { type: "score_get", target: "self", condition: "none", powerPermil: 1000 },
      {
        type: "visual_up",
        stages: 5,
        durationBeats: 10,
        target: "self",
        condition: "self_visual_lane",
      },
    ],
  });

  it("条件不一致レーンの A は 1 行目（スコア）のみ発動し 2 行目は適用されない", () => {
    // L3 はボーカルレーン（self_visual_lane 不成立）
    const lanes = defaultLanes().map((l) => (l.lane === 3 ? { ...l, skills: [aSkill] } : l));
    const result = simulateTimeline(input([note(1, 2, 1), note(2, 1, 3)], lanes));
    const act = result.beats[0]?.activations.find((a) => a.skillId === "sk-test-row-a");
    expect(act?.success).toBe(true);
    expect(act?.gainedScore).toBeGreaterThan(0);
    // buffSnapshots はステップ8（A発動）前のスナップショットのため b2 で確認
    expect(result.beats[1]?.buffSnapshots[2]?.visual_up).toBe(0);
  });

  it("条件一致レーンの A は 2 行目も適用する", () => {
    const lanes = defaultLanes().map((l) =>
      l.lane === 3 ? { ...l, skills: [aSkill], attribute: "visual" as const } : l,
    );
    const result = simulateTimeline(input([note(1, 2, 1), note(2, 1, 3)], lanes));
    expect(result.beats[1]?.buffSnapshots[2]?.visual_up).toBe(5);
  });

  /** 祭り千紗 P2 型: 1 行目 self_visual_lane + 2 行目 someone_down_group（独立） */
  const pSkill = skill({
    id: "sk-test-row-p",
    lane: 1,
    kind: "P",
    ct: 50,
    staminaCost: 0,
    effects: [
      {
        type: "score_up",
        stages: 5,
        durationBeats: 40,
        target: "visual_type_2",
        condition: "self_visual_lane",
      },
      {
        type: "skill_success_up",
        stages: 5,
        durationBeats: 40,
        target: "all",
        condition: "someone_down_group",
      },
    ],
  });

  it("条件のみの P は 1 行でも成立すれば発動し、成立行のみ適用する", () => {
    // L2 に低下効果源 → 2 行目（someone_down_group）のみ成立で発動
    const downSkill = skill({
      id: "sk-test-row-down",
      lane: 2,
      kind: "P",
      ct: null,
      staminaCost: 0,
      effects: [
        { type: "vocal_down", stages: 5, durationBeats: 40, target: "self", condition: "none" },
      ],
    });
    const lanes = defaultLanes().map((l) => {
      if (l.lane === 1) return { ...l, skills: [pSkill] };
      if (l.lane === 2) return { ...l, skills: [downSkill] };
      return l;
    });
    const result = simulateTimeline(input([note(1, 1, 3), note(2, 1, 3)], lanes));
    const act = result.beats[0]?.activations.find((a) => a.skillId === "sk-test-row-p");
    expect(act?.success).toBe(true);
    // 1 行目（score_up）は不成立 → なし・2 行目（skill_success_up）は適用。
    // 条件のみの P は後半発動（前半は CT0 でも自動発動しない）→ b2 スナップショットで確認
    expect(result.beats[1]?.buffSnapshots[0]?.score_up).toBe(0);
    expect(result.beats[1]?.buffSnapshots[0]?.skill_success_up).toBe(5);
  });

  it("全行不成立の条件のみ P は不発する（T5 優 P3 = レーン属性不一致で不発）", () => {
    const lanes = defaultLanes().map((l) => (l.lane === 1 ? { ...l, skills: [pSkill] } : l));
    const result = simulateTimeline(input([note(1, 1, 3)], lanes));
    const acts = result.beats[0]?.activations.filter(
      (a) => a.skillId === "sk-test-row-p" && a.success,
    );
    expect(acts).toEqual([]);
  });
});

describe("2026-09-02 確定仕様: 無条件行を含む P は前発動（some 判定）", () => {
  /** 祭り千紗 P3 型: 1 行目 無条件 + 2 行目 self_visual_lane */
  const p3Skill = skill({
    id: "sk-test-p3-mixed",
    lane: 1,
    kind: "P",
    ct: 45,
    staminaCost: 0,
    effects: [
      { type: "critical_rate_up", stages: 5, durationBeats: 35, target: "all", condition: "none" },
      {
        type: "skill_success_up",
        stages: 5,
        durationBeats: 35,
        target: "self",
        condition: "self_visual_lane",
      },
    ],
  });

  it("b1 の前半で自動発動し、無条件行のみ適用される（1 ビート目に必ず発動）", () => {
    const lanes = defaultLanes().map((l) => (l.lane === 1 ? { ...l, skills: [p3Skill] } : l));
    const result = simulateTimeline(input([note(1, 1, 3)], lanes));
    const act = result.beats[0]?.activations.find(
      (a) => a.skillId === "sk-test-p3-mixed" && a.success,
    );
    expect(act).toBeDefined();
    expect(act?.phase).toBe("first");
    // 無条件行は適用・ビジュアルレーン条件の 2 行目は不適用（L1 はボーカル）
    expect(result.beats[0]?.buffSnapshots[0]?.critical_rate_up).toBe(5);
    expect(result.beats[0]?.buffSnapshots[0]?.skill_success_up).toBe(0);
  });
});

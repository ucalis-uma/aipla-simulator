/**
 * 【デバッグ用】extension-revival テストの最小フィクスチャで A スキル延長の発動を観測する。
 * 実行: npx -y tsx tools/dbg_extension_revival.ts
 * 目的: tests/unit/timeline/extension-revival.test.ts（Phase 14-F）の
 *   「ステップ8 の A スキル延長が前ビート満了インスタンスを復活させる」経路を
 *   トレース表示する（発動の有無・位相・vocal_boost 段数のビート推移）。
 */
import { simulateTimeline } from "../src/timeline/engine.js";
import type { ChartNote, LaneInput, SimulateInput, SkillDef, StageInput } from "../src/timeline/types.js";
import type { ScoreRng } from "../src/rng/types.js";

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

const deck = (o: Record<string, number> = {}) => ({
  vocal: 100000,
  dance: 50000,
  visual: 25000,
  stamina: 100000,
  mental: 1000,
  critical: 0,
  ...o,
});
const lane = (n: number, o: Partial<LaneInput> = {}): LaneInput => ({
  lane: n as LaneInput["lane"],
  attribute: "vocal",
  deck: deck() as LaneInput["deck"],
  skills: [],
  photos: [],
  scoreBonusPct: { beat: 0, active: 0, special: 0, passive: 0 },
  critExtrasPermil: 0,
  ...o,
});
const skill = (p: Partial<SkillDef> & { id: string }): SkillDef =>
  ({
    name: p.id,
    kind: "P",
    level: 6,
    lane: 1,
    ct: null,
    staminaCost: 0,
    probabilityPermil: 1000,
    limitPerLive: null,
    effects: [],
    ...p,
  }) as SkillDef;
const stage = (): StageInput => ({
  id: "test-stage",
  laneAttributes: [2, 2, 1, 2, 2],
  beatWeightsPermil: { vocal: 600, dance: 250, visual: 150 },
  skillWeightsPermil: { active: 1000, special: 1000 },
  stageFactorPermil: 1000,
});

/** ケース1: テスト本文と同じ構成（grantP は ct なし / extA は A ノートで発動狙い） */
function run(caseName: string, grantCt: number | null, extCt: number | null) {
  const grantP = skill({
    id: "sk-test-grant",
    condition: "none",
    ct: grantCt,
    effects: [{ type: "vocal_boost", stages: 3, durationBeats: 3, target: "self", condition: "none" }],
  });
  const extA = skill({
    id: "sk-test-ext-a",
    kind: "A",
    ct: extCt,
    effects: [{ type: "effect_extension", value: 10, target: "self", condition: "none" }],
  });
  const lanes = [1, 2, 3, 4, 5].map((n) => lane(n));
  lanes[0] = lane(1, { skills: [grantP, extA] });
  const notes: ChartNote[] = [
    { beat: 1, noteType: 1, position: 0 },
    { beat: 2, noteType: 1, position: 0 },
    { beat: 3, noteType: 2, position: 1 },
    ...Array.from({ length: 12 }, (_, i) => ({ beat: i + 4, noteType: 1 as const, position: 0 as const })),
  ];
  const input = {
    lanes,
    notes,
    stage: stage(),
    fanFactorPermil: 1000,
    criticalProvider: () => false,
    rng: new ConstRng(),
  } as unknown as SimulateInput;
  const res = simulateTimeline(input);
  console.log(`=== ${caseName} (grantCt=${grantCt}, extCt=${extCt}) ===`);
  for (const a of res.activations.slice(0, 12)) {
    console.log(
      `  b${a.beat} ${a.phase} L${a.lane} ${a.skillId} kind=${a.kind} ok=${a.success} fail=${a.failReason ?? "-"}`,
    );
  }
  console.log(
    "  L1 vb: " + res.beats.map((b) => `b${b.beat}:${b.buffSnapshots[0]?.vocal_boost ?? "-"}`).join(" "),
  );
}

run("テスト本文と同じ（ct なし）", null, null);
run("grantP に ct=50", 50, null);
run("両方に ct=50", 50, 50);

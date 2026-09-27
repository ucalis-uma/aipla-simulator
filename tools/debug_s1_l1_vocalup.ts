/**
 * tools/debug_s1_l1_vocalup.ts
 * S1 L1 vocal_up のインスタンス推移（付与元・残りビート）を b95-b145 でダンプ。
 * 【2026-09-21】SimulateInput.effectInspector フック（デバッグ専用・types.ts 参照）で
 * エンジン内部のバフインスタンス（sourceSkillId・残りビート付き）を直接観測する版。
 * あわせて S1 の主要 P スキル（ゆらゆらドボーン！/ 過去の私へ / かっこいい宇宙人さん）の
 * 発動ビート・位相を実測（measured_data_v2.json: 1/50/100/149, b136 のみ, 1/50/100/149）と
 * 突合するための発動ログも出力する。
 * 実行: npx tsx tools/debug_s1_l1_vocalup.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSimulateInput, type SimSourceData } from "../src/sim/build.js";
import { simulateTimeline } from "../src/timeline/engine.js";
import { NeutralRng } from "../src/rng/neutral.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const dataDir = path.join(repoRoot, "data");

const idx = readJson(path.join(dataDir, "stages_index.json"));
const allCharts = readJson(path.join(dataDir, "charts_all.json"));
const q1 = idx.quests.find((x: any) => x.id === "qt-area-1-001")!;
const c1 = idx.configs[q1.c]!;

const data: SimSourceData = {
  cards: readJson(path.join(dataDir, "cards.json")).cards,
  cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
  skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
  stages: {
    "qt-area-1-001": {
      beatWeightsPermil: { vocal: c1.w[0], dance: c1.w[1], visual: c1.w[2] },
      skillWeightsPermil: { active: c1.aw[0], special: c1.aw[1] },
      laneAttributes: c1.a,
    },
  },
  charts: {
    "chart-hsm-006-001": {
      notes: (allCharts["chart-hsm-006-001"] as Array<[number, number]>).map(([t, p], i) => ({
        beat: i + 1, type: t, position: p,
      })),
    },
  },
  audienceAdvantage: readJson(path.join(dataDir, "stages/audience_advantage.json")),
  skillsByCard: readJson(path.join(dataDir, "skills_master.json")).byCard,
  skillLevels: readJson(path.join(dataDir, "skills_levels.json")),
  liveBonusesByQuest: readJson(path.join(dataDir, "live_bonuses.json")).byQuest,
  characterAdvantageByQuest: readJson(path.join(dataDir, "character_advantage.json")).byQuest,
} as any;

const cfgJson = readJson(path.join(repoRoot, "../aipura_nox/サンプル1/deck.json"));
const built = buildSimulateInput({
  deck: cfgJson.deck,
  stageFile: "qt-area-1-001",
  chartFile: "chart-hsm-006-001",
  data,
  audience: cfgJson.audience,
  mentalOverride: cfgJson.mentalOverride,
  missedNotes: cfgJson.missedNotes,
  disabledSkillIds: cfgJson.disabledSkillIds,
} as any);

// effectInspector: ビート処理完了時点（ステップ11終了後）の内部バフインスタンスを
// コピーして保持する（states は可変内部状態への参照のため、観測時にコピー必須）。
interface EffectInstanceRow {
  type: string;
  stages: number;
  remainingBeats: number;
  sourceSkillId: string;
}
const l1EffectsByBeat = new Map<number, EffectInstanceRow[]>();

const res = simulateTimeline({
  ...built.base,
  rng: new NeutralRng(),
  criticalProvider: () => false,
  effectInspector: (beat, states) => {
    const l1 = states[0];
    if (l1 === undefined) return;
    l1EffectsByBeat.set(
      beat,
      l1.effects.map((e) => ({
        type: e.type,
        stages: e.stages,
        remainingBeats: e.remainingBeats,
        sourceSkillId: e.sourceSkillId,
      })),
    );
  },
});

// ---- Pスキル発動ログ（実測突合用）----
console.log("== P activations (success) ==");
for (const a of res.activations) {
  if (a.kind !== "P" || !a.success) continue;
  console.log(`b${a.beat} [${a.phase}] L${a.lane} ${a.skillId}`);
}

// ---- L1 バフインスタンス推移（b95-b145・発動直後=ステップ11終了時点）----
console.log("\n== L1 internal effect instances (b95-b145, post-step11 via effectInspector) ==");
for (const bt of res.beats) {
  if (bt.beat < 95 || bt.beat > 145) continue;
  const inst = (l1EffectsByBeat.get(bt.beat) ?? [])
    .filter((e) => ["vocal_up", "vocal_boost", "combo_score_up"].includes(e.type))
    .map((e) => `${e.type}(${e.stages}段,残${e.remainingBeats},src=${e.sourceSkillId})`)
    .join(" | ");
  const snap = bt.buffSnapshots[0] as any;
  const acts = bt.activations
    .filter((a) => a.success)
    .map((a) => `${a.skillId}(L${a.lane},${a.phase})`)
    .join(", ");
  console.log(
    `b${bt.beat}: snapshot vu=${snap.vocal_up} vb=${snap.vocal_boost} csu=${snap.combo_score_up} | inst: ${inst} | acts: ${acts}`,
  );
}
console.log("total:", res.totalScore);


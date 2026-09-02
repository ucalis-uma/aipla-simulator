/**
 * サンプル1 b143（それが勇気になるから SP・集目10段）のシミュ内訳チェック（診断用）。
 * 実行: npx tsx research/17_sample1_gap_analysis/b143_check.ts
 *
 * 【結果メモ 2026-09-01】
 * - L3 score_get 行: gained=39,883,175（basic 456,442 × power 10000‰=Lv5 1000%
 *   × b1 1.677 × combo 3.120 × fan 1.670・crit なし）
 * - L3 ratio 行: gained=19,589,380（獲得スコアの14% × シミュ累積）
 * - ビート合計 59,472,555（SPノートビートのため他レーンのスコアなし）
 * - 実測 beat_gained 51,566,931（**crit 込み**・L3 ポップ=critical・L3 集目10段）
 *   → シミュは type36 scaling 未適用でも実測を約1.5倍上回る（crit 分を差し引いても過大）
 * - シミュ L3 snapshot: focus=10/crit_rate=20/csu=14/spu=2/vocal_boost=12
 *   実測 effects: 率20/ブースト9/集目10/コンボスコア9/SPスコア2
 *   （csu 14 vs 9・boost 12 vs 9 = 内部保持値と表示値の差か、付与過大か要確認）
 * - Peing アンカー（集目10で1921% = Lv6 1130%×1.7）の +7%/段 を足すとさらに過大に
 *   なるため、基礎チェーンの過大を先に分解する必要がある
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
import { buildSimulateInput } from "../../src/sim/build.ts";
import { simulateTimeline } from "../../src/timeline/engine.ts";
const read = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const cards = read(path.join(repoRoot, "data/cards.json")).cards;
const cardParameters = read(path.join(repoRoot, "data/card_parameters.json")).rows;
const skillsGolden = read(path.join(repoRoot, "data/skills_golden.json")).skills;
const skillsByCard = read(path.join(repoRoot, "data/skills_master.json")).byCard;
const idx = read(path.join(repoRoot, "data/stages_index.json"));
const q = idx.quests.find((x: any) => x.id === "qt-area-1-001")!;
const cfg = idx.configs[q.c]!;
const all = read(path.join(repoRoot, "data/charts_all.json"));
const chart = { notes: all["chart-hsm-006-001"].map(([t, p]: any, i: number) => ({ beat: i + 1, type: t, position: p })) };
const audienceAdvantage = read(path.join(repoRoot, "data/stages/audience_advantage.json"));
const skillLevels = read(path.join(repoRoot, "data/skills_levels.json"));
const cfgJson = JSON.parse(readFileSync("C:/Users/umaro/Documents/aipura_nox/サンプル1/deck.json", "utf-8"));
const stages: any = { "qt-area-1-001": { beatWeightsPermil: { vocal: cfg.w[0], dance: cfg.w[1], visual: cfg.w[2] }, skillWeightsPermil: { active: cfg.aw[0], special: cfg.aw[1] }, laneAttributes: cfg.a } };
const built = buildSimulateInput({ deck: cfgJson.deck, stageFile: "qt-area-1-001", chartFile: "chart-hsm-006-001",
  data: { cards, cardParameters, skillsGolden, stages, charts: { "chart-hsm-006-001": chart }, audienceAdvantage, skillsByCard, skillLevels } } as any);
const res = simulateTimeline({ ...built.base, baseCritRate: undefined, criticalProvider: () => false, rng: { nextScoreRoll: () => 1000, nextCritical: () => false, nextFloat: () => 0 } } as any);
const b = res.beats.find((x) => x.beat === 143)!;
for (const e of b.events) {
  console.log(`L${e.lane} ${e.sourceKind}: gained=${e.gainedScore} basic=${e.basicScore} power=${e.skillPowerPermil} b1=${e.b1Permil} combo=${e.comboFactorPermil} fan=${e.fanFactorPermil} crit=${e.critFactorPermil} ratio=${e.isRatioScore}`);
}
console.log("beat total:", b.gainedScore);
// 集目スナップショット（L3）
const snap = b.buffSnapshots[2];
console.log("L3 buff snapshot focus:", snap.focus, "crit_rate:", snap.critical_rate_up, "csu:", snap.combo_score_up, "spu:", snap.sp_skill_score_up, "vocal_boost:", snap.vocal_boost);

/**
 * サンプル4 乖離分析 診断用: 完全な LaneScoreEventTrace ダンプ + クリティカル再現ラン。
 * 実行: npx tsx research/22_sample4_gap_analysis/trace_dump.ts
 *
 * CLI と同じ入力（deck + myPhotos + photoEquip・乱数中立）で simulateTimeline を直接呼び、
 * 実測 critical_flags（黄pop）を criticalProvider に注入して全ビートの完全トレースを JSON 化する。
 * 出力: research/22_sample4_gap_analysis/sim_trace_full.json
 *       research/22_sample4_gap_analysis/sim_skills.json（解決済みレーン別スキル定義）
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.ts";
import { simulateTimeline, type TimelineResult } from "../../src/timeline/engine.ts";
import { NeutralRng } from "../../src/rng/neutral.ts";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../../src/photos.ts";
import type { CardDef, CardParameterRow } from "../../src/types.ts";

const read = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const STAGE = "qt-ex-tower-004-054";
const CHART = "chart-tri-004-001";

// ---- loadSourceData 複製（src/cli/simulate.ts から） ----
const cards: CardDef[] = read(path.join(repoRoot, "data/cards.json")).cards;
const cardParameters: CardParameterRow[] = read(path.join(repoRoot, "data/card_parameters.json")).rows;
const skillsGolden = read(path.join(repoRoot, "data/skills_golden.json")).skills;
const stages: any = {};
const idx = read(path.join(repoRoot, "data/stages_index.json"));
const quest = idx.quests.find((x: any) => x.id === STAGE)!;
const scfg = idx.configs[quest.c]!;
stages[STAGE] = {
  beatWeightsPermil: { vocal: scfg.w[0]!, dance: scfg.w[1]!, visual: scfg.w[2]! },
  skillWeightsPermil: { active: scfg.aw[0]!, special: scfg.aw[1]! },
  // 【サンプル4】スタミナ消費倍率（STAGE054 は 3000）
  skillStaminaWeightPermil: scfg.st ?? 1000,
  // スタミナ回復倍率（0 = 特徴なし）
  staminaRecoveryWeightPermil: scfg.rw ?? 0,
  laneAttributes: scfg.a,
};
const all = read(path.join(repoRoot, "data/charts_all.json"));
const chart = { notes: (all[CHART] as Array<[number, number]>).map(([t, p]: any, i: number) => ({ beat: i + 1, type: t, position: p })) };
const audienceAdvantage = read(path.join(repoRoot, "data/stages/audience_advantage.json"));
const skillsByCard = read(path.join(repoRoot, "data/skills_master.json")).byCard;
const skillLevels = read(path.join(repoRoot, "data/skills_levels.json"));
const liveBonusesByQuest = read(path.join(repoRoot, "data/live_bonuses.json")).byQuest;
// 【サンプル3・2026-09-04】キャラ優位（STAGE045 の ⅢX メンバー）
const characterAdvantageByQuest = read(path.join(repoRoot, "data/character_advantage.json")).byQuest;

// ---- 入力 JSON（deck + myPhotos + photoEquip = CLI と同一） ----
// 【サンプル4】deck.json は aipura_nox/サンプル4 と同一内容のものを使用（改変しない規律）。
const cfgJson = JSON.parse(readFileSync("C:/Users/umaro/Documents/aipura_nox/サンプル4/deck.json", "utf-8"));
const d = cfgJson.deck;
const myPhotos: MyPhotoDef[] = cfgJson.myPhotos ?? [];
const photoEquip: string[][] = cfgJson.photoEquip ?? [];
photoEquip.forEach((ids, i) => {
  const ch = d.characters[i];
  if (ch === undefined || !Array.isArray(ch.photos)) return;
  const equipped = ids.map((pid) => myPhotos.find((x) => x?.id === pid)).filter((p): p is MyPhotoDef => p !== undefined);
  ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
});
const userPhotoSkills =
  myPhotos.length > 0
    ? photoEquip.flatMap((ids, i) =>
        ids.flatMap((pid, j) => {
          const p = myPhotos.find((x) => x?.id === pid);
          if (p === undefined) return [];
          const def = myPhotoToSkillDef(p, (i + 1) as any, j + 1);
          return def !== null ? [def] : [];
        }),
      )
    : undefined;

const data: SimSourceData = {
  cards,
  cardParameters,
  skillsGolden,
  stages,
  charts: { [CHART]: chart },
  audienceAdvantage,
  skillsByCard,
  liveBonusesByQuest,
  characterAdvantageByQuest,
  skillLevels,
} as any;

const built = buildSimulateInput({
  deck: d,
  stageFile: STAGE,
  chartFile: CHART,
  data,
  audience: cfgJson.audience ?? 8000, // 実測個人来場ファン数（fan.png 各レーン 8,000 = 全員 40,000 の均等割）
  mentalOverride: cfgJson.mentalOverride,
  missedNotes: cfgJson.missedNotes,
  disabledSkillIds: cfgJson.disabledSkillIds,
  baseCritRate: undefined,
  userPhotoSkills,
  // CLI と同一の名前一致モデル（T5 実測フォト名と一致しない限り golden photo-L* は注入しない）
  goldenPhotoNames: (() => {
    try {
      const sample = read("C:/Users/umaro/Documents/アイプラ/スコア分析サンプル/verification_data_v2.json");
      return (sample.characters as Array<{ photos: Array<{ name?: string }> }>).map((c) =>
        c.photos.map((p) => p.name ?? ""),
      );
    } catch {
      return undefined;
    }
  })(),
} as any);
for (const w of built.warnings) console.error(`[warn] ${w}`);

// 実測のクリティカルフラグ（サンプル4 形式: critical_flags.beats[{beat, lanes[5]}]）
const critRaw = read("C:/Users/umaro/Documents/aipura_nox/サンプル4/measured_data_v2.json").critical_flags;
const critByBeat = new Map<number, boolean[]>();
for (const row of critRaw.beats as Array<{ beat: number; lanes: boolean[] }>) {
  critByBeat.set(row.beat, row.lanes);
}
const res: TimelineResult = simulateTimeline({
  ...built.base,
  baseCritRate: undefined,
  criticalProvider: (beat: number, lane: number) => {
    return critByBeat.get(beat)?.[lane - 1] === true;
  },
  rng: new NeutralRng(),
} as any);

const out = {
  laneInputs: ((res as any).input?.lanes ?? []).map((l: any) => ({ lane: l.lane, role: l.role, bonus: l.scoreBonusPct, critExtras: l.critExtrasPermil })),
  simTotal: res.totalScore,
  totalScore: res.totalScore,
  fanFactorPermil: built.base.fanFactorPermil,
  beats: res.beats.map((bt) => ({
    beat: bt.beat,
    noteType: bt.noteType,
    position: bt.position,
    gained: bt.gainedScore,
    comboAfter: [...bt.comboAfter],
    staminaAfter: [...bt.staminaAfter],
    activations: bt.activations.map((a) => ({
      lane: a.lane,
      skillId: a.skillId,
      kind: a.kind,
      phase: a.phase,
      success: a.success,
      failReason: a.failReason ?? null,
      staminaCost: a.staminaCost ?? null,
      gainedScore: a.gainedScore ?? null,
    })),
    events: bt.events.map((e) => ({
      lane: e.lane,
      sourceKind: e.sourceKind,
      basicScore: e.basicScore,
      skillPowerPermil: e.skillPowerPermil,
      b1Permil: e.b1Permil,
      comboFactorPermil: e.comboFactorPermil,
      fanFactorPermil: e.fanFactorPermil,
      randPermil: e.randPermil,
      critFactorPermil: e.critFactorPermil,
      isRatioScore: e.isRatioScore,
      ratioBaseCumScore: e.ratioBaseCumScore ?? null,
      gainedScore: e.gainedScore,
    })),
    buffSnapshots: bt.buffSnapshots.map((s) => ({ ...s })),
  })),
  finalStamina: [...res.finalStamina],
  finalCombo: [...res.finalCombo],
};
writeFileSync(path.join(repoRoot, "research/22_sample4_gap_analysis/sim_trace_full.json"), JSON.stringify(out));
console.error(`written: sim_trace_full.json (${out.beats.length} beats, total ${out.totalScore})`);

// ---- 解決済みレーン別スキル定義 ----
const skillsOut = built.lanes.map((ln) => ({
  lane: ln.lane,
  attribute: ln.attribute,
  role: ln.role,
  cardType: ln.cardType,
  deck: ln.deck,
  scoreBonusPct: ln.scoreBonusPct,
  critExtrasPermil: ln.critExtrasPermil,
  skills: ln.skills.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    level: s.level,
    lane: s.lane,
    ct: s.ct,
    staminaCost: s.staminaCost,
    probabilityPermil: s.probabilityPermil,
    limitPerLive: s.limitPerLive,
    effects: s.effects,
  })),
  photos: ln.photos.map((s) => ({ id: s.id, name: s.name, kind: s.kind, level: s.level, ct: s.ct, staminaCost: s.staminaCost, effects: s.effects })),
}));
writeFileSync(path.join(repoRoot, "research/22_sample4_gap_analysis/sim_skills.json"), JSON.stringify(skillsOut, null, 1));
console.error(`written: sim_skills.json`);

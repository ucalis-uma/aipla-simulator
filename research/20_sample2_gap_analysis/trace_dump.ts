/**
 * サンプル2 乖離分析 診断用: 完全な LaneScoreEventTrace ダンプ（診断専用・読み取りのみ）。
 * 実行: npx tsx research/20_sample2_gap_analysis/trace_dump.ts
 *
 * CLI の confirmed.json と同じ入力（deck + myPhotos + photoEquip・crit なし・乱数中立）で
 * simulateTimeline を直接呼び、全ビートの完全トレース（factor 付き）を JSON 化する。
 * 出力: research/20_sample2_gap_analysis/sim_trace_full.json
 *       研究/20_sample2_gap_analysis/sim_skills.json（解決済みレーン別スキル定義）
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

// ---- loadSourceData 複製（src/cli/simulate.ts から） ----
const cards: CardDef[] = read(path.join(repoRoot, "data/cards.json")).cards;
const cardParameters: CardParameterRow[] = read(path.join(repoRoot, "data/card_parameters.json")).rows;
const skillsGolden = read(path.join(repoRoot, "data/skills_golden.json")).skills;
const stages: any = {};
const idx = read(path.join(repoRoot, "data/stages_index.json"));
const quest = idx.quests.find((x: any) => x.id === "qt-tower-680")!;
const cfg = idx.configs[quest.c]!;
stages["qt-tower-680"] = {
  beatWeightsPermil: { vocal: cfg.w[0]!, dance: cfg.w[1]!, visual: cfg.w[2]! },
  skillWeightsPermil: { active: cfg.aw[0]!, special: cfg.aw[1]! },
  laneAttributes: cfg.a,
};
const all = read(path.join(repoRoot, "data/charts_all.json"));
const chart = { notes: (all["chart-sun-004-001"] as Array<[number, number]>).map(([t, p]: any, i: number) => ({ beat: i + 1, type: t, position: p })) };
const audienceAdvantage = read(path.join(repoRoot, "data/stages/audience_advantage.json"));
const skillsByCard = read(path.join(repoRoot, "data/skills_master.json")).byCard;
const skillLevels = read(path.join(repoRoot, "data/skills_levels.json"));
const liveBonusesByQuest = read(path.join(repoRoot, "data/live_bonuses.json")).byQuest;

// ---- 入力 JSON（deck + myPhotos + photoEquip = CLI と同一） ----
const cfgJson = JSON.parse(readFileSync("C:/Users/umaro/Documents/aipura_nox/サンプル2/deck.json", "utf-8"));
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
  charts: { "chart-sun-004-001": chart },
  audienceAdvantage,
  skillsByCard,
  liveBonusesByQuest,
  skillLevels,
} as any;

const built = buildSimulateInput({
  deck: d,
  stageFile: "qt-tower-680",
  chartFile: "chart-sun-004-001",
  data,
  audience: 13206, // 実測個人来場ファン数（fan.png 合計 66,031 の 1/5）
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

// 実測のクリティカルフラグ（サンプル2 形式: critical_flags["b%03d_L%d"] = boolean）
const critFlagsRaw = read("C:/Users/umaro/Documents/aipura_nox/サンプル2/measured_data_v2.json").critical_flags;
const critFlags = critFlagsRaw;
const res: TimelineResult = simulateTimeline({
  ...built.base,
  baseCritRate: undefined,
  criticalProvider: (beat: number, lane: number) => {
    return critFlags[`b${String(beat).padStart(3, "0")}_L${lane}`] === true;
  },
  rng: new NeutralRng(),
} as any);

const out = {
  laneInputs: ((res as any).input?.lanes ?? []).map((l: any) => ({ lane: l.lane, role: l.role, bonus: l.scoreBonusPct, critExtras: l.critExtrasPermil })),
  simTotal: res.totalScore,
  totalScore: res.totalScore,
  fanFactorPermil: built.base.fanFactorPermil,
  buffTest: res.beats.find((bt) => bt.beat === 143)?.buffSnapshots?.map((s) => ({
    combo_score_up: s.combo_score_up, score_up: s.score_up, tension_up: s.tension_up,
    sp_skill_score_up: s.sp_skill_score_up, a_skill_score_up: s.a_skill_score_up,
    critical_coeff_up: s.critical_coeff_up, focus: s.focus,
    vocal_up: s.vocal_up, vocal_boost: s.vocal_boost,
  })),
  buffTest66: {
    b66: res.beats.find((bt) => bt.beat === 66)?.buffSnapshots?.map((s) => ({
      vocal_up: s.vocal_up, vocal_boost: s.vocal_boost, dance_up: s.dance_up, visual_up: s.visual_up,
      score_up: s.score_up, tension_up: s.tension_up, critical_rate_up: s.critical_rate_up,
    })),
    b123: res.beats.find((bt) => bt.beat === 123)?.buffSnapshots?.map((s) => ({
      vocal_up: s.vocal_up, vocal_boost: s.vocal_boost, dance_up: s.dance_up, visual_up: s.visual_up,
      score_up: s.score_up, tension_up: s.tension_up, critical_rate_up: s.critical_rate_up,
      a_skill_score_up: s.a_skill_score_up, sp_skill_score_up: s.sp_skill_score_up,
    })),
    b176: res.beats.find((bt) => bt.beat === 176)?.buffSnapshots?.map((s) => ({
      vocal_up: s.vocal_up, vocal_boost: s.vocal_boost, dance_up: s.dance_up, visual_up: s.visual_up,
      score_up: s.score_up, tension_up: s.tension_up, critical_rate_up: s.critical_rate_up,
    })),
    b40: res.beats.find((bt) => bt.beat === 40)?.buffSnapshots?.map((s) => ({
      vocal_up: s.vocal_up, vocal_boost: s.vocal_boost, tension_up: s.tension_up, score_up: s.score_up,
      combo_score_up: s.combo_score_up, critical_rate_up: s.critical_rate_up,
    })),
  },
  tensionHistory: res.beats
    .filter((bt) => bt.beat >= 45 && bt.beat <= 155 && bt.beat % 5 === 0)
    .map((bt) => ({ beat: bt.beat, l3: bt.buffSnapshots?.[2]?.tension_up, l1: bt.buffSnapshots?.[0]?.tension_up })),
  tensionInst: res.beats
    .filter((bt) => bt.beat === 120 || bt.beat === 135 || bt.beat === 136 || bt.beat === 137 || bt.beat === 145)
    .map((bt) => { const x = res.instances?.find?.((i) => i.beat === bt.beat); return { beat: bt.beat, inst: x ?? null }; }),
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
writeFileSync(path.join(repoRoot, "research/20_sample2_gap_analysis/sim_trace_full.json"), JSON.stringify(out));
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
writeFileSync(path.join(repoRoot, "research/20_sample2_gap_analysis/sim_skills.json"), JSON.stringify(skillsOut, null, 1));
console.error(`written: sim_skills.json`);

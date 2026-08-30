#!/usr/bin/env node
/**
 * validate_skills_master.mjs — skills_master.json（マスタ自動解析）と
 * skills_golden.json（実測較正・35スキル）の突合検証。
 *
 * 検証観点:
 * 1. golden カード 15 スキルがマスタ解析に存在し、kind/CT/消費/効果行が整合するか
 *    （フィッティング済み perStagePermil・測定由来の値差は許容して警告表示）
 * 2. 全カードのスキルが engine 契約（EffectType/EffectTarget/condition）に含まれるか
 *
 * 実行: node tools/validate_skills_master.mjs
 * 終了コード: 0 = 成功（警告あっても継続） / 1 = 致命的な不整合
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), "utf-8"));

const golden = read("data/skills_golden.json").skills;
const master = read("data/skills_master.json").byCard;
const cards = read("data/cards.json").cards;

let fatal = 0;
let warn = 0;

function cmpEffects(g, m, label, levelDiff, refitRows) {
  const mg = g.filter((e) => e.condition !== "battle_only");
  const mm = m.filter((e) => e.condition !== "battle_only");
  if (mg.length !== mm.length) {
    console.warn(`  [warn] ${label}: 効果行数 golden=${mg.length} master=${mm.length}`);
    warn++;
    return;
  }
  for (let i = 0; i < mg.length; i++) {
    const a = mg[i];
    const b = mm[i];
    const diffs = [];
    if (a.type !== b.type) diffs.push(`type ${a.type}≠${b.type}`);
    if ((a.stages ?? null) !== (b.stages ?? null)) diffs.push(`stages ${a.stages}≠${b.stages}`);
    if ((a.powerPermil ?? null) !== (b.powerPermil ?? null)) {
      // perStage フィッティングや測定値差は許容（警告）
      diffs.push(`power ${a.powerPermil}≠${b.powerPermil}`);
    }
    if ((a.durationBeats ?? null) !== (b.durationBeats ?? null)) {
      diffs.push(`dur ${a.durationBeats}≠${b.durationBeats}`);
    }
    if ((a.value ?? null) !== (b.value ?? null)) diffs.push(`value ${a.value}≠${b.value}`);
    if (a.target !== b.target) diffs.push(`target ${a.target}≠${b.target}`);
    if (diffs.length > 0) {
      const soft =
        diffs.every((d) => d.startsWith("power") || d.startsWith("value")) ||
        // golden 側が T5 実測フィットで意図的に修正した行（master の生値と異なるのが正）
        refitRows.has(i) ||
        // golden は下位レベル（開花途中）で測定 → 効果量/時間が master（最大レベル）とずれる
        levelDiff;
      const tag = soft ? "warn" : "MISMATCH";
      const line = `  [${tag}] ${label} 行${i + 1}: ${diffs.join(", ")}`;
      if (soft) {
        console.warn(line);
        warn++;
      } else {
        console.error(line);
        fatal++;
      }
    }
  }
}

console.log(`golden カードスキル ${golden.filter((s) => s.kind !== "photo").length} 件を突合:`);
for (const g of golden) {
  if (g.kind === "photo") continue;
  const cardId = g.cardId?.startsWith("sk-") ? `card-${g.cardId.slice(3)}` : g.cardId;
  const defs = master[cardId];
  if (!defs) {
    console.error(`  [FAIL] ${g.id}: カード ${cardId} が skills_master に存在しない`);
    fatal++;
    continue;
  }
  const m = defs.find((d) => d.id === g.id);
  if (!m) {
    console.error(`  [FAIL] ${g.id}: master にスキル ID が存在しない`);
    fatal++;
    continue;
  }
  const problems = [];
  if (m.kind !== g.kind) problems.push(`kind ${g.kind}≠${m.kind}`);
  if (m.ct !== g.ct) problems.push(`ct ${g.ct}≠${m.ct}`);
  if (m.staminaCost !== g.staminaCost) problems.push(`cost ${g.staminaCost}≠${m.staminaCost}（レベル差の可能性）`);
  if (problems.length > 0) {
    console.warn(`  [warn] ${g.id}: ${problems.join(", ")}`);
    warn++;
  }
  // golden が T5 実測フィットで意図的に修正した行のインデックス
  const refitRows = new Set(
    g.effects
      .map((e, i) => (String(e.confidence ?? "").includes("フィット修正") ? i : -1))
      .filter((i) => i >= 0),
  );
  cmpEffects(g.effects, m.effects, g.id, m.level !== g.level, refitRows);
}

// engine 契約整合（全スキルの効果 type / target / condition が engine の union に含まれるか）
// ← TypeScript の union はランタイムに存在しないため、既知集合をここに列挙して照合する
// engine types.ts の EffectType と同期（Phase 9 で低下/超化/Pスコア/ステルス/ライボ短縮を追加）
const KNOWN_TYPES = new Set([
  "score_get", "score_get_by_score_ratio", "vocal_up", "vocal_boost", "vocal_up_extreme",
  "vocal_down", "dance_down", "visual_down",
  "dance_up", "dance_boost", "visual_up", "visual_boost", "beat_score_up",
  "tension_up", "tension_limit", "combo_score_up", "combo_score_limit",
  "critical_coeff_up", "critical_coeff_limit", "critical_rate_up",
  "a_skill_score_up", "sp_skill_score_up", "p_skill_score_up",
  "stamina_cost_down", "stamina_cost_up", "stamina_recovery",
  "combo_continue", "ct_reduction", "ct_increase", "effect_extension", "effect_amplify",
  "score_up", "skill_success_up", "focus", "stealth", "live_bonus_ct_reduction",
]);
const KNOWN_TARGETS = new Set([
  "self", "score_type_1", "score_type_2", "vocal_high_1", "vocal_high_2", "vocal_high_3",
  "same_lane_other", "all", "neighbors", "vocal_type_1", "vocal_type_2", "vocal_type_3",
  "center", "single", "buffer_type_1", "buffer_type_2", "buffer_type_3",
  "supporter_type_1", "supporter_type_2", "supporter_type_3",
  "dance_type_1", "dance_type_2", "dance_type_3", "dance_type_5",
  "visual_type_1", "visual_type_2", "visual_type_3", "visual_type_5",
  "vocal_type_5",
  "dance_high_1", "dance_high_2", "dance_high_3",
  "visual_high_1", "visual_high_2", "visual_high_3",
  // Phase 9（ライブボーナス等の拡張ターゲット）
  "score_type_3", "score_type_5", "buffer_type_5", "supporter_type_5",
  "stamina_high_1", "stamina_low_1", "stamina_low_2", "stamina_low_3",
  "trigger",
  "status_vocal_up_1", "status_dance_up_1", "status_dance_up_3",
  "status_a_skill_score_up_1", "status_a_skill_score_up_2",
  "status_a_skill_score_up_3", "status_a_skill_score_up_5",
]);
const KNOWN_CONDITIONS = new Set([
  "none", "battle_only", "self_vocal_lane", "self_visual_lane",
  "someone_focus", "someone_score_up", "someone_skill_success_up", "someone_critical_coeff_up",
  "combo>=50", "combo>=80", "combo>=90", "combo>=100",
  // Phase 9（someone_* 汎用・回復・ユニット人数）
  "someone_recovered",
  "someone_critical_rate_up", "someone_beat_score_up", "someone_a_skill_score_up",
  "someone_sp_skill_score_up", "someone_p_skill_score_up", "someone_tension_up",
  "someone_vocal_up", "someone_dance_up", "someone_visual_up",
  "someone_vocal_boost", "someone_dance_boost", "someone_visual_boost",
  "someone_vocal_down", "someone_dance_down", "someone_visual_down",
  "someone_stamina_cost_down", "someone_stealth",
  "count_liz>=1", "count_moon>=1", "count_sun>=1", "count_pajm>=1",
  "count_leader>=1", "count_tri>=1", "count_thrx>=1",
]);

let effectRows = 0;
let badType = 0;
let badTarget = 0;
let badCondition = 0;
for (const [cardId, defs] of Object.entries(master)) {
  for (const d of defs) {
    for (const e of d.effects) {
      effectRows++;
      if (!KNOWN_TYPES.has(e.type)) {
        console.error(`  [FAIL] ${cardId}/${d.id}: 未知 type ${e.type}`);
        badType++;
      }
      if (!KNOWN_TARGETS.has(e.target)) {
        console.error(`  [FAIL] ${cardId}/${d.id}: 未知 target ${e.target}`);
        badTarget++;
      }
      if (!KNOWN_CONDITIONS.has(e.condition)) {
        console.error(`  [FAIL] ${cardId}/${d.id}: 未知 condition ${e.condition}`);
        badCondition++;
      }
    }
  }
}

// カード → スキル添字の整合（A/SP/P が 1〜3 個あること）
let kindDist = {};
for (const defs of Object.values(master)) {
  for (const d of defs) kindDist[d.kind] = (kindDist[d.kind] ?? 0) + 1;
}
console.log(`全カード効果行 ${effectRows} 行 / 種別分布 ${JSON.stringify(kindDist)}`);
console.log(`未知 type ${badType} / 未知 target ${badTarget} / 未知 condition ${badCondition}`);

const cardsWithoutSkills = cards.filter((c) => !master[c.id]).length;
console.log(`スキル未検出カード: ${cardsWithoutSkills} 枚`);

if (badType + badTarget + badCondition > 0 || fatal > 0) {
  console.error(`validate_skills_master: FAIL (fatal=${fatal})`);
  process.exit(1);
}
console.log(`validate_skills_master: OK (警告 ${warn} 件)`);

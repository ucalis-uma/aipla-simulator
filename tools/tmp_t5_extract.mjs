// T5用の実測データ抽出（measured_data_v2.json は直接 read 禁止のため node で部分抽出する）
// 出力: tests/golden/fixtures/t5_measured.json
// 使い回し後は削除する一時スクリプト。
import { readFileSync, writeFileSync } from "node:fs";

const raw = JSON.parse(readFileSync("スコア分析サンプル/measured_data_v2.json", "utf8"));

const parsePop = (s) => {
  if (s == null) return null;
  const m = /^\+(\d+(?:\.\d+)?)([KM]?)$/.exec(String(s));
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  if (m[2] === "K") return Math.round(v * 1000);
  if (m[2] === "M") return Math.round(v * 1000000);
  return Math.round(v);
};

const timeline = raw.timeline.map((row) => ({
  beat: row.beat,
  combo: row.combo,
  cumulative: row.cumulative_score,
  gained: row.beat_gained_score,
  stamina: Object.fromEntries(
    Object.entries(row.lanes).map(([k, v]) => [k, v.current_stamina]),
  ),
  pops: Object.fromEntries(
    Object.entries(row.lanes).map(([k, v]) => [
      k,
      parsePop(v.gained_score_displayed) ?? v.gained_score,
    ]),
  ),
  stat: Object.fromEntries(
    Object.entries(row.lanes).map(([k, v]) => [k, v.stat_value]),
  ),
  effects: Object.fromEntries(
    Object.entries(row.lanes).map(([k, v]) => [
      k,
      (v.effects ?? []).map((e) => ({ id: e.id, stage: e.stage })),
    ]),
  ),
}));

// critical_flags の構造を確認してから整形
const cf = raw.critical_flags;
console.log("critical_flags keys:", Object.keys(cf));
const sampleKey = Array.isArray(cf.beats) ? "array" : "object";
console.log("beats type:", sampleKey, "len:", cf.beats.length ?? Object.keys(cf.beats).length);
const firstBeat = Array.isArray(cf.beats) ? cf.beats[0] : cf.beats[Object.keys(cf.beats)[0]];
console.log("first beat entry:", JSON.stringify(firstBeat));

const beats = Array.isArray(cf.beats)
  ? cf.beats
  : Object.entries(cf.beats).map(([k, v]) => ({ ...v, beat: Number(k) }));
const critFlags = beats.map((b) => ({
  beat: b.beat,
  any_yellow: b.any_yellow ?? null,
  yellow_lanes: b.yellow_lanes ?? null,
  white_lanes: b.white_lanes ?? null,
  no_pop_lanes: b.no_pop_lanes ?? null,
}));

const acts = raw.skill_activations_summary.all_activations.map((a) => ({
  order: a.order,
  beat: a.beat,
  lane: a.lane,
  skill_type: a.skill_type,
  skill_name: a.skill_name,
  target_idols: (a.effects ?? []).map((e) => e.target_idol),
  effect_texts: (a.effects ?? []).map((e) => e.effect_text),
  stamina: a.stamina,
  stat_value: a.stat_value,
}));

const out = {
  results: raw.results,
  timeline,
  critFlags,
  activations: acts,
};

writeFileSync("tests/golden/fixtures/t5_measured.json", JSON.stringify(out, null, 1));
console.log("timeline rows:", timeline.length, "crit beats:", critFlags.length, "activations:", acts.length);
console.log("results:", JSON.stringify(raw.results).slice(0, 600));
// コンボ列の検査: +1/beat か、A/SP成功後に +2 があるか
let jumps = [];
for (let i = 1; i < timeline.length; i++) {
  const d = timeline[i].combo - timeline[i - 1].combo;
  if (d !== 1) jumps.push({ beat: timeline[i].beat, d });
}
console.log("combo jumps (≠+1):", JSON.stringify(jumps));
// L3 stat の変化点
const stat3 = timeline.map((r) => r.stat["3"]);
const changes = [];
for (let i = 1; i < stat3.length; i++) {
  if (stat3[i] !== stat3[i - 1]) changes.push({ beat: timeline[i].beat, from: stat3[i - 1], to: stat3[i] });
}
console.log("L3 stat changes:", JSON.stringify(changes));

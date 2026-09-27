/**
 * 【Phase 14-F 検証監査】前ビート満了バフの延長復活（expiredThisBeat）仕様の実測突合
 * 作成: 2026-09-27（引継ぎ中に判明した未コミット実装の選別用）
 *
 * 背景:
 * - src/timeline/engine.ts に「前ビート終了時に満了したインスタンスを、当ビートの
 *   ステップ7/8 の延長効果で復活させる」処理が未コミットで残っている
 *   （tests/unit/timeline/extension-revival.test.ts も未追跡・research/12 に記録なし）。
 * - この実装は T5 総スコアを +5,076,936 変化させる（17,516,522,572 → 17,521,599,508）。
 *   実測 17,521,461,739 への誤差は 0.028% → 0.00079% に改善するが、実装コメントが
 *   主張する「T5 b86〜b99 で vocal_boost 20段が連続表示」は fixtures の effects と
 *   素朴には一致しない（b87=20, b91=20, b97=5, b99=20 と散発）。
 *
 * 論点: 表示バフ段数（実測 effects[].stage）を ビート×レーン×バフ種 で突合し、
 *   復活 ON（作業ツリーのトレース）/ OFF（HEAD トレース）のどちらが実測表示を
 *   正しく再現するか件数で判定する。表示遅延 1 ビートを許容する比較も併記。
 *
 * 実行（リポジトリ直下から）: node research/26_data_integrity/audit_phase14f_revival.mjs
 * 出力: research/26_data_integrity/phase14f_revival_audit.json / .md
 *
 * 前提: 作業ツリーの research/25_buff_audit/t5_sim_trace_full.json は revival ON の
 *   現行エンジンで再生成済み（tools/dump_samples_trace.ts）であること。
 *   HEAD 版は同じパスのコミット済み内容＝revival OFF のトレースとして使う
 *   （スキル単位トリガー変更は T5 で発動系列を一切変えないことを別途実証済み）。
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const readFs = (p) => JSON.parse(readFileSync(p, "utf-8"));
const readHead = (p) =>
  JSON.parse(execSync(`git show HEAD:${p}`, { encoding: "utf-8", maxBuffer: 1 << 28 }));

const measured = readFs("tests/golden/fixtures/t5_measured.json");
const onTrace = readFs("research/25_buff_audit/t5_sim_trace_full.json"); // revival ON
const offTrace = readHead("research/25_buff_audit/t5_sim_trace_full.json"); // revival OFF

/** 実測 effects[].id は sim buffSnapshots と同名。対応の明確なバフ種のみを対象にする */
const WATCHED = [
  "vocal_boost",
  "vocal_up",
  "dance_boost",
  "dance_up",
  "visual_boost",
  "visual_up",
  "skill_success_up",
  "combo_score_up",
  "critical_coeff_up",
  "focus",
];

const idxBeats = (t) => new Map((t.beats ?? []).map((b) => [b.beat, b]));
const ON = idxBeats(onTrace);
const OFF = idxBeats(offTrace);

/** 実測表示の段数（同一 id の重複表示は合算＝安全側）。stage=null は観測外なので対象外 */
function measuredStages(row, laneKey) {
  const out = {};
  for (const e of row?.effects?.[laneKey] ?? []) {
    if (e?.stage == null) continue;
    out[e.id] = (out[e.id] ?? 0) + Number(e.stage);
  }
  return out;
}

function simStage(map, beat, laneIdx, key) {
  const snap = map.get(beat)?.buffSnapshots?.[laneIdx];
  return snap ? Number(snap[key] ?? 0) : null;
}

const rows = [];
let total = 0;
let onHit = 0;
let offHit = 0;
const perBuff = {};

for (const row of measured.timeline ?? []) {
  const beat = Number(row.beat);
  for (const lane of ["1", "2", "3", "4", "5"]) {
    const laneIdx = Number(lane) - 1;
    const ms = measuredStages(row, lane);
    for (const key of WATCHED) {
      if (!(key in ms)) continue;
      const want = ms[key];
      const on0 = simStage(ON, beat, laneIdx, key);
      const off0 = simStage(OFF, beat, laneIdx, key);
      // 表示遅延 1 ビート（前一ビートの表示が 1 枚遅れて映る）も許容した判定
      const onOk = on0 === want || simStage(ON, beat - 1, laneIdx, key) === want;
      const offOk = off0 === want || simStage(OFF, beat - 1, laneIdx, key) === want;
      total++;
      if (onOk) onHit++;
      if (offOk) offHit++;
      const pb = (perBuff[key] ||= { comparisons: 0, on: 0, off: 0 });
      pb.comparisons++;
      if (onOk) pb.on++;
      if (offOk) pb.off++;
      if (onOk !== offOk) {
        rows.push({
          beat,
          lane: Number(lane),
          buff: key,
          measured: want,
          sim_on: on0,
          sim_off: off0,
          better: onOk && !offOk ? "ON" : "OFF",
        });
      }
    }
  }
}

/** 実装コメントが根拠とした b80-b100 窓の vocal_boost 推移（実測 vs ON vs OFF） */
const window = [];
for (let b = 80; b <= 100; b++) {
  const row = measured.timeline.find((x) => Number(x.beat) === b);
  const per = {};
  for (const lane of ["1", "2", "3", "4", "5"]) {
    const m = measuredStages(row, lane).vocal_boost;
    if (m == null) continue;
    per[`L${lane}`] = {
      measured: m,
      sim_on: simStage(ON, b, Number(lane) - 1, "vocal_boost"),
      sim_off: simStage(OFF, b, Number(lane) - 1, "vocal_boost"),
    };
  }
  if (Object.keys(per).length) window.push({ beat: b, ...per });
}

const summary = {
  generated: "2026-09-27",
  purpose: "Phase 14-F expiredThisBeat 復活仕様の実測突合（T5・表示バフ段数）",
  total_score: {
    revival_on: onTrace.totalScore,
    revival_off: offTrace.totalScore,
    measured: measured.results?.total_score ?? null,
  },
  buff_display_comparisons: total,
  match_with_lag1: { revival_on: onHit, revival_off: offHit },
  match_rate_pct: {
    revival_on: Number(((onHit / total) * 100).toFixed(3)),
    revival_off: Number(((offHit / total) * 100).toFixed(3)),
  },
  per_buff: perBuff,
  differing_cases: rows.length,
};

writeFileSync(
  "research/26_data_integrity/phase14f_revival_audit.json",
  JSON.stringify({ summary, differing: rows, b80_b100_vocal_boost: window }, null, 1),
);
console.log(JSON.stringify({ ...summary, cases: rows.slice(0, 40) }, null, 1));


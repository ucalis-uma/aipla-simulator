/**
 * 24_analysis 第2段階: 丸め unit 判別 + セル分類の精緻化
 *
 * 丸め仮説（full-readable ビートで Σlo ≤ bgs < Σhi の合格率を比較）:
 *   A: 小数1桁切捨て（+39K→[39000,39100)、.0省略込み）／四捨五入版 C
 *   B: 整数位切捨て（+39K→[39000,40000)）
 *   D: 小数1桁四捨五入（+38.6K→真値は表示値±50）
 *
 * 実行: node research/24_result_vs_pop_sum/rounding_test.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "C:/Users/umaro/Documents/アイプラ";
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

/** パース（G 対応）: "+38.6K"→38600, "+1.2M"→1200000, "+15.1G"→15100000000 */
function parsePop(displayed) {
  if (typeof displayed !== "string") return null;
  const m = /^\+?([\d.]+)([KMG])$/.exec(displayed.trim());
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * { K: 1e3, M: 1e6, G: 1e9 }[m[2]]);
}

/** unit（統一版: 表示値の 0.1 単位で切捨て。整数表示も .0 省略扱い）: K→100, M→100000, G→1e8 */
function popUnit(displayed) {
  const m = /^\+?([\d.]+)([KMG])$/.exec(displayed.trim());
  if (!m) return null;
  return { K: 100, M: 100000, G: 100000000 }[m[2]];
}

const SAMPLES = [
  { tag: "T5", dir: `${REPO}/スコア分析サンプル` },
  { tag: "S1", dir: `${NOX}/サンプル1` },
  { tag: "S2", dir: `${NOX}/サンプル2` },
  { tag: "S3", dir: `${NOX}/サンプル3` },
];

// collect all readable cells + beat_gained_score
for (const sample of SAMPLES) {
  const act = read(`${sample.dir}/measured_data_v2.json`);
  const tl = act.timeline;
  const bf = read(`${sample.dir}/lane_pops_backfill.json`);
  const cells = {};
  for (const p of bf.pops) {
    (cells[p.beat] ??= {})[p.lane] = p;
  }
  for (const b of tl) {
    for (const [k, v] of Object.entries(b.lanes ?? {})) {
      const L = String(Number(String(k).replace(/^lane/, "")));
      const text = v.gained_score_displayed ?? v.gained_score_pop?.text ?? null;
      if (text) {
        cells[b.beat] ??= {};
        const c = cells[b.beat][L];
        if (!c || c.covered_by_existing || !c.readable) {
          cells[b.beat][L] = { displayed: text, readable: true, covered: c?.covered_by_existing ?? false, note: c?.note ?? "existing" };
        }
      }
    }
  }
  // full-readable beats
  const results = { total: 0, pass: 0, pass_round: 0, viol: [] };
  for (const b of tl) {
    const row = [1, 2, 3, 4, 5].map((L) => cells[b.beat]?.[L]);
    if (!row.every((c) => c && c.readable && c.displayed)) continue;
    const vals = row.map((c) => ({ lo: parsePop(c.displayed), u: popUnit(c.displayed), d: c.displayed }));
    if (vals.some((v) => v.lo === null || v.u === null)) continue;
    const bgs = b.beat_gained_score ?? 0;
    results.total++;
    const sumLo = vals.reduce((s, v) => s + v.lo, 0);
    const sumHi = vals.reduce((s, v) => s + v.lo + v.u, 0);
    const pass = sumLo <= bgs && bgs < sumHi;
    // 四捨五入版: 真値∈[表示値-unit/2, 表示値+unit/2)
    const midLo = sumLo - vals.reduce((s, v) => s + v.u / 2, 0);
    const midHi = sumHi - vals.reduce((s, v) => s + v.u / 2, 0);
    const round = midLo <= bgs && bgs < midHi;
    if (pass) results.pass++;
    if (round) results.pass_round++;
    if (!pass) {
      results.viol.push({ beat: b.beat, bgs, sumLo, sumHi, pops: vals.map((v) => v.d) });
    }
  }
  console.log(`===== ${sample.tag} =====`);
  console.log(`full-readable: ${results.total}`);
  console.log(`切捨て(unit=0.1表示位): ${results.pass} / 四捨五入版: ${results.pass_round}`);
  if (results.viol.length) {
    console.log(`violations: ${results.viol.length}`);
    for (const v of results.viol.slice(0, 8)) {
      console.log(`  b${v.beat}: bgs=${v.bgs} Σlo=${v.sumLo} Σhi=${v.sumHi} pops=${v.pops.join(",")}`);
    }
  }
  console.log("");
}

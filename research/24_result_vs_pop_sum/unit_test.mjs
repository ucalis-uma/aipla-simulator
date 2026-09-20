/**
 * 24_analysis 第3段階: 整数 K/M 表示の unit 判別
 * 「+39K」= [39000,39100)（.0省略＝小数1桁表示と同じ分解能）説 vs
 * 「+39K」= [39000,40000)（整数位切捨て）説
 *
 * 判定手法: full-readable ビートの D = bgs - Σ(表示下限) は「5セルの真値端数の合計」。
 * 整数K表示セルを含むビートで D の分布を比較。
 *   unit100 説なら D < 5×100 = 500 厳密には [0, 500)
 *   unit1000 説なら整数セル端数が [0,1000) まで動ける → D の上限が上がる
 * 更に: 他 4 セルの端数は unit100 説では最大 400。D - 400 > 0 の観測値（整数セル端数 > 0）
 *   が 100 を超えれば unit1000 説確定。
 *
 * 実行: node research/24_result_vs_pop_sum/unit_test.mjs
 */
import { readFileSync } from "node:fs";

const REPO = "C:/Users/umaro/Documents/アイプラ";
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

function parsePop(displayed) {
  if (typeof displayed !== "string") return null;
  const m = /^\+?([\d.]+)([KMG])$/.exec(displayed.trim());
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * { K: 1e3, M: 1e6, G: 1e9 }[m[2]]);
}
function decimals(displayed) {
  const m = /^\+?([\d.]+)([KMG])$/.exec(displayed.trim());
  if (!m) return null;
  return (m[1].split(".")[1] ?? "").length;
}
function suffix(displayed) {
  const m = /^\+?([\d.]+)([KMG])$/.exec(displayed.trim());
  return m ? m[2] : null;
}

const SAMPLES = [
  { tag: "T5", dir: `${REPO}/スコア分析サンプル` },
  { tag: "S1", dir: `${NOX}/サンプル1` },
  { tag: "S2", dir: `${NOX}/サンプル2` },
  { tag: "S3", dir: `${NOX}/サンプル3` },
];

for (const sample of SAMPLES) {
  const act = read(`${sample.dir}/measured_data_v2.json`);
  const tl = act.timeline;
  const bf = read(`${sample.dir}/lane_pops_backfill.json`);
  const cells = {};
  for (const p of bf.pops) (cells[p.beat] ??= {})[p.lane] = p;
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
  const rows = [];
  for (const b of tl) {
    const row = [1, 2, 3, 4, 5].map((L) => cells[b.beat]?.[L]);
    if (!row.every((c) => c && c.readable && c.displayed)) continue;
    const cells2 = row.map((c) => ({ d: c.displayed, lo: parsePop(c.displayed), dec: decimals(c.displayed), sf: suffix(c.displayed) }));
    if (cells2.some((c) => c.lo === null)) continue;
    const bgs = b.beat_gained_score ?? 0;
    const sumLo = cells2.reduce((s, c) => s + c.lo, 0);
    const D = bgs - sumLo;
    rows.push({ beat: b.beat, bgs, D, cells: cells2 });
  }
  // unit100 仮説下の理論上限（.0省略込み: 全セル unit=100）→ D < 500 が必須
  // → D >= 500 のビートは unit100 説の反証（あるいは欠落スコアありビート）
  const viol100 = rows.filter((r) => r.D >= 500);
  // 整数Kセルのみを含むビートでの D 分布
  const withIntK = rows.filter((r) => r.cells.some((c) => c.sf === "K" && c.dec === 0));
  const withoutInt = rows.filter((r) => !r.cells.some((c) => c.dec === 0));
  const fmtArr = (a) => `n=${a.length} min=${Math.min(...a, 1e9) === 1e9 ? "n/a" : Math.min(...a)} max=${a.length ? Math.max(...a) : "n/a"}`;
  console.log(`===== ${sample.tag} =====`);
  console.log(`full-readable: ${rows.length}`);
  console.log(`D=bgs-Σlo: 全体 ${fmtArr(rows.map((r) => r.D))}`);
  console.log(`  整数表示なしビート ${fmtArr(withoutInt.map((r) => r.D))}`);
  console.log(`  整数表示ありビート ${fmtArr(withIntK.map((r) => r.D))}`);
  console.log(`  D>=500（unit100説反証候補）: ${viol100.length}`);
  for (const r of viol100.slice(0, 8)) {
    console.log(`    b${r.beat}: D=${r.D} bgs=${r.bgs} pops=${r.cells.map((c) => c.d).join(",")}`);
  }
  console.log("");
}

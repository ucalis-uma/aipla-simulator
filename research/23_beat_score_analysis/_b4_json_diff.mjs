/** B4: 2 つの JSON を深く比較して「どのパスが違うか」を列挙する
 *   node research/23_beat_score_analysis/_b4_json_diff.mjs a.json b.json
 */
import fs from "node:fs";
const [pa, pb] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(pa, "utf8"));
const B = JSON.parse(fs.readFileSync(pb, "utf8"));
const diffs = [];
const walk = (a, b, p) => {
  if (typeof a !== typeof b) {
    diffs.push({ path: p, a, b });
    return;
  }
  if (a === null || b === null || typeof a !== "object") {
    if (a !== b) diffs.push({ path: p, a, b });
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    diffs.push({ path: p, a: "(array?)", b: "(array?)" });
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) walk(a[k], b[k], `${p}.${k}`);
};
walk(A, B, "$");
const byPrefix = new Map();
for (const d of diffs) {
  const norm = d.path.replace(/\.\d+/g, ".[]").replace(/^(\$[^.]*(\.[^.]*){0,4}).*/, "$1");
  byPrefix.set(norm, (byPrefix.get(norm) ?? 0) + 1);
}
console.log(`差分パス総数: ${diffs.length}`);
console.log("--- 差分の分布（先頭 4 階層・数値インデックスは [] に正規化） ---");
for (const [k, v] of [...byPrefix.entries()].sort((x, y) => y[1] - x[1]).slice(0, 30)) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}
console.log("--- 先頭 12 件の実例 ---");
for (const d of diffs.slice(0, 12)) console.log(`  ${d.path}: ${JSON.stringify(d.a)} → ${JSON.stringify(d.b)}`);
/** 数値だけを持つ差分（スコア系）を抽出 */
const numeric = diffs.filter((d) => typeof d.a === "number" && typeof d.b === "number");
console.log(`数値差分: ${numeric.length} 件`);
for (const d of numeric.slice(0, 15)) console.log(`  ${d.path}: ${d.a} → ${d.b}（Δ${d.b - d.a}）`);

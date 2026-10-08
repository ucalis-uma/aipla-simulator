/** 監査出力から「sim(可読)/Σpop」列を抜き出して分布を見る（A4 の閾値検討用）
 *   node research/23_beat_score_analysis/_a14_readable_dist.mjs research/23_beat_score_analysis/_audit_run.txt
 */
import fs from "node:fs";
const file = process.argv[2] ?? "research/23_beat_score_analysis/_audit_run.txt";
const txt = fs.readFileSync(file, "utf8");
const lines = txt.split(/\r?\n/);
const out = [];
let sample = null;
for (const raw of lines) {
  const s = raw.replace(/\s+/g, " ").trim();
  const sm = /^\[sim\] (S\d)/.exec(s);
  if (sm !== null) sample = sm[1];
  const m = /^(L[1-5]) \| ([\d,]+) \| (\d+) \| ([\d,]+) \| ([\d,]+) \| ([\d,]+) \| ([\d.]+) \|(.*)$/.exec(s);
  if (m === null) continue;
  const tail = m[8];
  const nums = tail
    .split("|")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  // tail の並び: Σpop(内生)|隠れ枠(内生)|sim(隠れ・内生)|比|sim(隠れセル数)|sim(可読)/Σpop|比(対称)|判定
  const readable = tail.match(/\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([^|]+)$/);
  out.push({
    sample,
    lane: m[1],
    pop: Number(m[2].replace(/,/g, "")),
    laneTotal: Number(m[4].replace(/,/g, "")),
    readableRatio: readable === null ? null : Number(readable[2]),
    sym: readable === null ? null : Number(readable[3]),
    verdict: readable === null ? null : readable[4].trim(),
    raw: nums.join(" | "),
  });
}
console.log("sample lane    Σpop        可読比   対称比  判定");
for (const r of out) {
  console.log(
    `${String(r.sample).padEnd(6)} ${r.lane}  ${String(r.pop).padStart(11)}  ${String(r.readableRatio).padStart(7)}  ${String(r.sym).padStart(6)}  ${r.verdict}`,
  );
}
const vals = out.map((r) => r.readableRatio).filter((x) => x !== null && Number.isFinite(x));
vals.sort((a, b) => a - b);
console.log(`\nn=${vals.length} min ${vals[0]} / max ${vals[vals.length - 1]}`);
console.log(`一覧: ${vals.join(", ")}`);

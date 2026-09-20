/**
 * 24_analysis 第3段階b: 純小数Kビートのみでの D 分布（丸め unit 判別の決定版）
 */
import { readFileSync } from "node:fs";

const REPO = "C:/Users/umaro/Documents/アイプラ";
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

function parsePop(d) {
  const m = /^\+?([\d.]+)([KMG])$/.exec(d.trim());
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * { K: 1e3, M: 1e6, G: 1e9 }[m[2]]);
}
function dec(d) {
  const m = /^\+?([\d.]+)([KMG])$/.exec(d.trim());
  return m ? (m[1].split(".")[1] ?? "").length : null;
}
function sf(d) {
  const m = /^\+?([\d.]+)([KMG])$/.exec(d.trim());
  return m ? m[2] : null;
}

const SAMPLES = [
  { tag: "T5", dir: `${REPO}/スコア分析サンプル` },
  { tag: "S1", dir: `${NOX}/サンプル1` },
  { tag: "S2", dir: `${NOX}/サンプル2` },
  { tag: "S3", dir: `${NOX}/サンプル3` },
];

for (const s of SAMPLES) {
  const act = read(s.dir + "/measured_data_v2.json");
  const bf = read(s.dir + "/lane_pops_backfill.json");
  const cells = {};
  for (const p of bf.pops) (cells[p.beat] ??= {})[p.lane] = p;
  for (const b of act.timeline) {
    for (const [k, v] of Object.entries(b.lanes ?? {})) {
      const L = String(Number(String(k).replace(/^lane/, "")));
      const t = v.gained_score_displayed ?? v.gained_score_pop?.text ?? null;
      if (t) {
        cells[b.beat] ??= {};
        const c = cells[b.beat][L];
        if (!c || c.covered_by_existing || !c.readable) {
          cells[b.beat][L] = { displayed: t, readable: true, covered: c?.covered_by_existing ?? false };
        }
      }
    }
  }
  const rows = [];
  for (const b of act.timeline) {
    const row = [1, 2, 3, 4, 5].map((L) => cells[b.beat]?.[L]);
    if (!row.every((c) => c && c.readable && c.displayed)) continue;
    const cs = row.map((c) => ({ d: c.displayed, lo: parsePop(c.displayed), dec: dec(c.displayed), sf: sf(c.displayed) }));
    if (cs.some((c) => c.lo === null)) continue;
    const D = (b.beat_gained_score ?? 0) - cs.reduce((a, c) => a + c.lo, 0);
    rows.push({ beat: b.beat, D, cs });
  }
  const pureDecK = rows.filter((r) => r.cs.every((c) => c.sf === "K" && c.dec === 1));
  const dArr = pureDecK.map((r) => r.D);
  const stat = (a) => (a.length ? `n=${a.length} min=${Math.min(...a)} max=${Math.max(...a)} mean=${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(0)}` : "n/a");
  console.log(`===== ${s.tag} =====`);
  console.log(`小数Kのみビート D: ${stat(dArr)}`);
  console.log(`  [0-100):${dArr.filter((v) => v < 100).length} [100-200):${dArr.filter((v) => v >= 100 && v < 200).length} [200-300):${dArr.filter((v) => v >= 200 && v < 300).length} [300-400):${dArr.filter((v) => v >= 300 && v < 400).length} [400-500):${dArr.filter((v) => v >= 400 && v < 500).length} [500+):${dArr.filter((v) => v >= 500).length}`);
  // 5セル分の端数が一様 [0,100) なら合計は [0,500) の山型。四捨五入なら -250..250 中心0
  const neg = dArr.filter((v) => v < 0).length;
  console.log(`  負の D: ${neg}`);
}

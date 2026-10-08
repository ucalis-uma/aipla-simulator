/**
 * Phase 16 Action14 / A1: 「セル単位突合」に基づく隠れスコアの再定義（分母は不変）
 *
 * 現行（`tools/audit_hidden_cells.mjs` 検査2）:
 *   分母 = レーン合計 − Σpop（K/M 切り捨てで **上界**）※不変
 *   分子 = sim(pop 読込不能セル) のみ
 *
 * 問題（A1 で判明）: pop が読めていても **その pop が実測の一部しか覆っていない**セルがある。
 *   代表例 = S3 b2 L3: pop は +123.3K（フォト）だけだが、同じビートに L3 の A スキル
 *   「殻をやぶる」が発動しており、実測の残差（bgs − Σpop）2,109,487 がそのスコア。
 *   → 実測側では 2.11M が「未読」として分母に入るのに、sim 側の同セル 1,883,500 は
 *     「可読セル」として分母の外に置かれる（**非対称**）。その結果 0.04× という偽の FAIL になる。
 *
 * 本スクリプトの再定義（**分子のみ**を対称化・分母と閾値は一切動かさない）:
 *   分子 = sim(不能セル) + Σ_{可読セル} max(0, sim_cell − pop_cell)
 *        = simLane − Σ_{可読セル} min(sim_cell, pop_cell)
 *   ※ これは現行分子以上（≥）なので **上側ゲートは厳しくなる方向にしか動かない**。
 *   ※ 下側ゲートは比が上がる方向＝判定が緩くなる。閾値（0.25/0.5・2.0/1.5）は不変。
 *
 * 実行: node research/23_beat_score_analysis/phase16_action14_a1_coverage.mjs
 */
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(process.cwd());
const nox = path.resolve(repo, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);

const parseK = (text) => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(text ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const n = Number(m[1]);
  const u = { "": 1, K: 1e3, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : Math.round(n * u);
};
/** 表示粒度（切り捨ての最大損失 +1）: 表示単位の 1/10（"+2M" も "+123.3K" も 1 桁小数まで） */
const granOf = (text) => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(text ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const u = { "": 1, K: 1e3, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : u / 10;
};
const laneOf = (row, l) => {
  const L = row?.lanes;
  if (L === null || L === undefined) return null;
  return Array.isArray(L) ? (L[l - 1] ?? null) : (L[String(l)] ?? L[`lane${l}`] ?? null);
};

const SAMPLES = [
  { tag: "S1", dir: path.join(nox, "サンプル1"), fallback: "measured_data_s1_v3.json" },
  { tag: "S2", dir: path.join(nox, "サンプル2"), fallback: "measured_data_s2_v3.json" },
  { tag: "S3", dir: path.join(nox, "サンプル3"), fallback: "measured_data_s3_v3.json" },
];
const SIM = J(path.join(repo, "research", "23_beat_score_analysis", "phase16_action10_sim_cells_off.json"));

const out = [];
console.log("lane | レーン合計 | Σpop | 隠れ枠(不変) | sim(不能)=旧分子 | sim(不能)+可読超過=新分子 | 旧比 | 新比 | 可読超過の内訳(上位3)");
for (const s of SAMPLES) {
  const cands = ["measured_data_v3.json", "measured_data_v2.json", "measured_data.json"].map((f) =>
    path.join(s.dir, f),
  );
  cands.push(path.join(repo, "research", "26_data_integrity", s.fallback));
  let meas = null;
  for (const p of cands) {
    if (!exists(p)) continue;
    const d = J(p);
    if (Array.isArray(d.timeline)) {
      meas = d;
      break;
    }
  }
  if (meas === null) continue;
  const merged = new Map();
  for (const e of meas.timeline) {
    for (let l = 1; l <= 5; l++) {
      const g = laneOf(e, l)?.gained_score_pop;
      const t = typeof g === "string" ? g : (g?.text ?? null);
      if (parseK(t) !== null) merged.set(`${e.beat}:${l}`, String(t));
    }
  }
  const bfFile = path.join(s.dir, "lane_pops_backfill.json");
  if (exists(bfFile)) {
    for (const x of J(bfFile).pops ?? []) {
      if (x.readable === false || parseK(x.displayed) === null) continue;
      const k = `${x.beat}:${x.lane}`;
      if (!merged.has(k)) merged.set(k, String(x.displayed));
    }
  }
  const sim = SIM.samples[s.tag].cells;
  for (let l = 1; l <= 5; l++) {
    const LT = meas.results?.scores_by_lane ?? meas.results?.lane_scores ?? {};
    const laneTotal = LT[String(l)] ?? LT[`lane${l}`] ?? (Array.isArray(LT) ? LT[l - 1] : null) ?? null;
    let popSum = 0;
    for (const [k, t] of merged) if (Number(k.split(":")[1]) === l) popSum += parseK(t) ?? 0;
    const hiddenCap = laneTotal - popSum;
    let simLane = 0;
    let simHidden = 0;
    let covered = 0; // Σ min(sim, pop) over readable cells
    let truncMax = 0;
    const excess = [];
    for (const [k, v] of Object.entries(sim)) {
      if (Number(k.split(":")[1]) !== l) continue;
      simLane += v;
      const t = merged.get(k);
      if (t === undefined) {
        simHidden += v;
        continue;
      }
      const pop = parseK(t) ?? 0;
      covered += Math.min(v, pop);
      truncMax += (granOf(t) ?? 0) - 1;
      if (v > pop) excess.push({ cell: k, sim: v, pop, d: v - pop });
    }
    const newNum = simLane - covered;
    excess.sort((a, b) => b.d - a.d);
    const ratioOld = hiddenCap > 0 ? simHidden / hiddenCap : null;
    const ratioNew = hiddenCap > 0 ? newNum / hiddenCap : null;
    out.push({
      tag: s.tag,
      lane: l,
      laneTotal,
      popSum,
      hiddenCap,
      simLane,
      simHidden,
      covered,
      newNum,
      ratioOld,
      ratioNew,
      truncMax,
      excess: excess.slice(0, 3),
    });
    console.log(
      `${s.tag} L${l} | ${laneTotal.toLocaleString().padStart(11)} | ${popSum.toLocaleString().padStart(11)} | ` +
        `${hiddenCap.toLocaleString().padStart(11)} | ${String(simHidden).padStart(11)} | ${String(newNum).padStart(13)} | ` +
        `${ratioOld === null ? "n/a" : ratioOld.toFixed(2).padStart(5)} | ${ratioNew === null ? "n/a" : ratioNew.toFixed(2).padStart(5)} | ` +
        `${excess.slice(0, 3).map((e) => `${e.cell}:+${e.d.toLocaleString()}`).join(" ")}`,
    );
  }
}
console.log("\n--- 判定の変化（旧 → 新・閾値は不変: 上 ≥2.0 FAIL / ≥1.5 WARN・下 ≤0.25 FAIL / ≤0.5 WARN） ---");
const judge = (r) => {
  if (r === null || r === undefined) return "n/a";
  if (r >= 2.0) return "FAIL(上)";
  if (r >= 1.5) return "WARN(上)";
  if (r <= 0.25) return "FAIL(下)";
  if (r <= 0.5) return "WARN(下)";
  return "OK";
};
let changed = 0;
for (const r of out) {
  const o = judge(r.ratioOld);
  const n = judge(r.ratioNew);
  if (o !== n) {
    changed++;
    console.log(`  ${r.tag} L${r.lane}: ${o}(${r.ratioOld?.toFixed(2)}) → ${n}(${r.ratioNew?.toFixed(2)})`);
  }
}
console.log(`  変化したレーン: ${changed} / ${out.length}`);
console.log(`  残る下側 FAIL: ${out.filter((r) => judge(r.ratioNew) === "FAIL(下)").map((r) => `${r.tag} L${r.lane}(${r.ratioNew.toFixed(2)})`).join(" / ") || "なし"}`);
console.log(`  残る下側 WARN: ${out.filter((r) => judge(r.ratioNew) === "WARN(下)").map((r) => `${r.tag} L${r.lane}(${r.ratioNew.toFixed(2)})`).join(" / ") || "なし"}`);
console.log(`  上側 FAIL/WARN: ${out.filter((r) => judge(r.ratioNew).includes("(上)")).map((r) => `${r.tag} L${r.lane}(${r.ratioNew.toFixed(2)})`).join(" / ") || "なし"}`);
fs.writeFileSync(
  path.join(repo, "research", "23_beat_score_analysis", "phase16_action14_a1_coverage.json"),
  `${JSON.stringify({ generatedBy: "phase16_action14_a1_coverage.mjs", rows: out }, null, 1)}\n`,
  "utf8",
);

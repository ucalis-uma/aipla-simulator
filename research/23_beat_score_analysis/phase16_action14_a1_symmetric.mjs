/**
 * Phase 16 Action14 / A1: 分子の対称化（beat 単位の突合）— 分母・閾値は不変
 *
 * 現行分子 = sim(pop 読込不能セル)。
 * しかし実測側の分母（レーン合計 − Σpop）には「**pop が読めているセルの未表示分**」も入る
 * （代表例 S3 b2 L3: pop +123.3K はフォト行のみで、同ビートの A スキル「殻をやぶる」の
 *  約 2.1M は pop に載っていない。sim は同セルに 1,883,500 を置いており、これが
 *  「可読セル」として分母の外に置かれる＝非対称）。
 *
 * 新分子（対称化）:
 *   ビート b ごとに
 *     R_b = max(0, beat_gained_score_b − Σ_{pop 可読セル} pop)   ← 実測が「未記録」と証明した額
 *     H_b = Σ_{pop 不能セル} sim                                   ← sim の未検証配置（従来の分子）
 *     E_b = Σ_{pop 可読セル} max(0, sim − pop)                     ← sim の pop 超過
 *     寄与 = H_b + min(E_b, max(0, R_b − H_b))
 *   分子 = Σ_b 寄与
 *
 * 性質:
 *   - min(...) ≥ 0 なので **新分子 ≥ 旧分子**（上側ゲートは厳しくなる方向にしか動かない）
 *   - 分母（レーン合計 − Σpop）と閾値（上 2.0/1.5・下 0.25/0.5）は一切変更しない
 *   - 実測が「未記録」を証明した分だけを sim 側でも未検証として数える（証明できない超過は数えない）
 *
 * 実行: node research/23_beat_score_analysis/phase16_action14_a1_symmetric.mjs
 */
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(process.cwd());
const nox = path.resolve(repo, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);
const parseK = (t) => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const n = Number(m[1]);
  const u = { "": 1, K: 1e3, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : Math.round(n * u);
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

const judge = (r) => {
  if (r === null || r === undefined) return "n/a";
  if (r >= 2.0) return "FAIL(上)";
  if (r >= 1.5) return "WARN(上)";
  if (r <= 0.25) return "FAIL(下)";
  if (r <= 0.5) return "WARN(下)";
  return "OK";
};

const out = [];
for (const s of SAMPLES) {
  const cands = [
    ...["measured_data_v3.json", "measured_data_v2.json", "measured_data.json"].map((f) =>
      path.join(s.dir, f),
    ),
    path.join(repo, "research", "26_data_integrity", s.fallback),
  ];
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
    let symNum = 0;
    const details = [];
    for (const row of meas.timeline) {
      const b = row.beat;
      /* ビート b の R_b: 実測の未記録額 */
      let popAtBeat = 0;
      for (let ll = 1; ll <= 5; ll++) {
        const t = merged.get(`${b}:${ll}`);
        if (t !== undefined) popAtBeat += parseK(t) ?? 0;
      }
      const R = Math.max(0, (row.beat_gained_score ?? 0) - popAtBeat);
      /* レーン l の H / E */
      let H = 0;
      let E = 0;
      const sCell = sim[`${b}:${l}`] ?? null;
      if (sCell !== null) {
        simLane += sCell;
        const t = merged.get(`${b}:${l}`);
        if (t === undefined) {
          H = sCell;
          simHidden += sCell;
        } else {
          const pop = parseK(t) ?? 0;
          E = Math.max(0, sCell - pop);
        }
      }
      const add = H + Math.min(E, Math.max(0, R - H));
      symNum += add;
      if (sCell !== null && add > 0 && (H > 0 || E > 0)) {
        details.push({ beat: b, sim: sCell, pop: merged.get(`${b}:${l}`) ?? null, H, E, R, add });
      }
    }
    const rOld = hiddenCap > 0 ? simHidden / hiddenCap : null;
    const rNew = hiddenCap > 0 ? symNum / hiddenCap : null;
    out.push({ tag: s.tag, lane: l, laneTotal, popSum, hiddenCap, simLane, simHidden, symNum, rOld, rNew, details });
  }
}
console.log("tag lane | レーン合計 | Σpop | 隠れ枠(分母・不変) | 旧分子 | 新分子 | 旧比 | 新比 | 判定変化");
let changed = 0;
for (const r of out) {
  const o = judge(r.rOld);
  const n = judge(r.rNew);
  if (o !== n) changed++;
  console.log(
    `${r.tag} L${r.lane} | ${r.laneTotal.toLocaleString().padStart(11)} | ${r.popSum.toLocaleString().padStart(11)} | ` +
      `${r.hiddenCap.toLocaleString().padStart(11)} | ${String(r.simHidden).padStart(7)} | ${String(r.symNum).padStart(9)} | ` +
      `${r.rOld === null ? "  n/a" : r.rOld.toFixed(2).padStart(5)} | ${r.rNew === null ? "  n/a" : r.rNew.toFixed(2).padStart(5)} | ` +
      `${o === n ? "" : `${o} → ${n}`}`,
  );
}
console.log(`\n判定が変わったレーン: ${changed} / ${out.length}`);
const up = out.filter((r) => judge(r.rNew).includes("(上)"));
console.log(`新分母での上側 FAIL/WARN: ${up.map((r) => `${r.tag} L${r.lane}(${r.rNew.toFixed(2)})`).join(" / ") || "なし"}`);
const lows = out.filter((r) => judge(r.rNew).includes("(下)"));
console.log(`新分母での下側 FAIL/WARN: ${lows.map((r) => `${r.tag} L${r.lane}(${r.rNew.toFixed(2)})`).join(" / ") || "なし"}`);
console.log("\n--- 新分子で寄与したセル（上位 6 件/レーン・E が効いたもの） ---");
for (const r of out) {
  const withE = r.details.filter((d) => d.E > 0).sort((a, b) => b.add - a.add).slice(0, 6);
  if (withE.length === 0) continue;
  console.log(`  ${r.tag} L${r.lane}: ${withE.map((d) => `b${d.beat}(E${d.E.toLocaleString()}→+${d.add.toLocaleString()}/R${d.R.toLocaleString()})`).join(" ")}`);
}
fs.writeFileSync(
  path.join(repo, "research", "23_beat_score_analysis", "phase16_action14_a1_symmetric.json"),
  `${JSON.stringify({ generatedBy: "phase16_action14_a1_symmetric.mjs", rows: out }, null, 1)}\n`,
  "utf8",
);

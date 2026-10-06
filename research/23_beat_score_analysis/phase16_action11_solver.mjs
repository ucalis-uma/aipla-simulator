/**
 * Phase 16 Action11 タスク2: 素点式の逆算。
 * 「act なし・ビート素点のみ」セルで Ω比 = Σsim/Σpop を取り、implied_i = simSum_i / Ω_i を求めて
 * implied ∝ v·A + d·B + vi·C を最小二乗で解く（サンプル別）。読み取り専用。
 *
 *   node research/23_beat_score_analysis/phase16_action11_solver.mjs
 */
import fs from "node:fs";
const ROOT = "C:/Users/umaro/Documents/アイプラ";
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const dec = readJson(`${ROOT}/research/23_beat_score_analysis/phase16_action11_decouple_out.json`);
const DIRS = { S1: "サンプル1", S2: "サンプル2", S3: "サンプル3" };

function parseK(text) {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(text ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const u = { "": 1, K: 1000, M: 1e6, G: 1e9 }[m[2].toUpperCase()];
  return u === undefined ? null : Math.round(Number(m[1]) * u);
}

/** 3x3 正規方程式をガウス消去で解く */
function solve3(M, y) {
  const a = M.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    [a[c], a[piv]] = [a[piv], a[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= 3; k++) a[r][k] -= f * a[c][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

const out = {};
for (const [id, sim] of Object.entries(dec.samples)) {
  const dir = DIRS[id];
  const mpath = [`${NOX}/${dir}/measured_data_v3.json`, `${NOX}/${dir}/measured_data_v2.json`].find((p) => fs.existsSync(p));
  const meas = readJson(mpath);
  const bf = readJson(`${NOX}/${dir}/lane_pops_backfill.json`);
  const pop = new Map();
  for (const x of bf.pops ?? []) {
    if (typeof x?.beat !== "number" || x.readable === false) continue;
    const v = parseK(x.displayed);
    if (v !== null) pop.set(`${x.beat}:${x.lane}`, v);
  }
  for (const row of meas.timeline ?? []) {
    for (let l = 1; l <= 5; l++) {
      const cell = (row.lanes ?? {})[`lane${l}`] ?? (row.lanes ?? {})[l];
      const p = cell?.gained_score_pop;
      const v = typeof p === "object" && p !== null ? parseK(p.text) : parseK(p);
      if (v !== null && !pop.has(`${row.beat}:${l}`)) pop.set(`${row.beat}:${l}`, v);
    }
  }
  const acts = new Set((meas.skill_activations_summary ?? []).map((a) => `${a.beat}:${a.lane}`));
  console.log(`\n########## ${id} ##########`);
  const info = [];
  for (let l = 1; l <= 5; l++) {
    let sp = 0, ss = 0, n = 0, srand = 0, scb = 0, sfan = 0, scb2 = 0;
    for (const [k, evs] of Object.entries(sim.cells)) {
      const [b, ln] = k.split(":").map(Number);
      if (ln !== l) continue;
      if (acts.has(k)) continue;
      const p = pop.get(k);
      if (p === undefined || p < 3000) continue;
      if (!(evs.length === 1 && evs[0].sourceKind === "beat")) continue;
      sp += p; ss += evs[0].gainedScore; n++;
      srand += evs[0].randPermil; scb += evs[0].comboFactorPermil; sfan += evs[0].fanFactorPermil;
      scb2 += evs[0].b1Permil;
    }
    const lane = sim.lanes.find((x) => x.lane === l);
    const w = sim.stage.beatWeightsPermil;
    const d = lane.deck;
    const simSum = d.vocal * w.vocal + d.dance * w.dance + d.visual * w.visual;
    info.push({
      l, attr: lane.attribute, d, simSum,
      n, sp, ss, ratio: ss / sp, meanRand: srand / n, meanCombo: scb / n, meanFan: sfan / n, meanB1: scb2 / n,
    });
  }
  console.log(
    info
      .map(
        (x) =>
          `  L${x.l} ${x.attr.padEnd(6)} n=${String(x.n).padStart(3)} Ω=Σsim/Σpop=${x.ratio.toFixed(4)} meanRand=${x.meanRand.toFixed(1)} combo=${x.meanCombo.toFixed(1)} fan=${x.meanFan.toFixed(1)} b1=${x.meanB1.toFixed(1)}`,
      )
      .join("\n"),
  );
  // implied = simSum / Ω
  const base = info[0].simSum / info[0].ratio;
  console.log("  ── implied（L1=1 に正規化）──");
  for (const x of info) {
    x.implied = x.simSum / x.ratio;
    console.log(
      `   L${x.l} ${x.attr.padEnd(6)} simSum=${x.simSum.toLocaleString("en-US")} implied=${x.implied.toLocaleString("en-US")} 相対=${(x.implied / base).toFixed(4)}`,
    );
  }
  // 最小二乗: implied ≈ k(v·A + d·B + vi·C)
  // 未知 A,B,C を作る: 各行 [v,d,vi]·[A,B,C] = implied
  const rows = info.map((x) => [x.d.vocal, x.d.dance, x.d.visual]);
  const y = info.map((x) => x.implied);
  // スケール固定: vocal の重みを 600 に固定 → 残り 2 未知を解く
  // 各方程式: d·B + vi·C = implied − v·600
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const yy = [0, 0, 0];
  const design = rows.map((r) => [r[1], r[2]]);
  const rhs = y.map((val, i) => val - rows[i][0] * 600);
  for (let i = 0; i < design.length; i++) {
    for (let a = 0; a < 2; a++) {
      yy[a] += design[i][a] * rhs[i];
      for (let b = 0; b < 2; b++) M[a][b] += design[i][a] * design[i][b];
    }
  }
  // 2x2 解
  const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
  const B = (yy[0] * M[1][1] - M[0][1] * yy[1]) / det;
  const C = (M[0][0] * yy[1] - yy[0] * M[1][0]) / det;
  // 残差
  const fitted = rows.map((r) => r[0] * 600 + r[1] * B + r[2] * C);
  const rel = fitted.map((f, i) => f / y[i] - 1);
  const rms = Math.sqrt(rel.reduce((a, x) => a + x * x, 0) / rel.length);
  console.log(
    `  ── 最小二乗（vocal 重みを 600 に固定）: dance=${B.toFixed(1)} visual=${C.toFixed(1)} / 相対残差 rms=${(rms * 100).toFixed(2)}% 最大=${(Math.max(...rel.map(Math.abs)) * 100).toFixed(2)}%`,
  );
  console.log(`   （現行エンジンは dance=250 / visual=150）`);
  out[id] = { info: info.map(({ d, ...r }) => ({ ...r, deck: d })), fit: { dance: B, visual: C, rms } };
}
fs.writeFileSync(`${ROOT}/research/23_beat_score_analysis/phase16_action11_solver_out.json`, JSON.stringify(out, null, 1), "utf8");
console.log("\n[saved] phase16_action11_solver_out.json");

/**
 * Phase 16 Action14 / A2: S2 の SP セル（b90 L3）と A セル群の「累積スコア比の適用順序」検定
 *
 *   node research/23_beat_score_analysis/phase16_action14_a2_s2_ratio.mjs
 *
 * 入力: `phase16_action14_a2_s2_events.json`（--events=S2 で出力した sim セル別イベント生データ）・
 *       `../aipura_nox/サンプル2/measured_data_v3.json`・`lane_pops_backfill.json`
 *
 * 実測の厳密化: S2 の backfill は 168×5 = 840 セル全てをカバーし、各セルは
 *   - `readable: true`  → pop 値（K/M 表記の切り捨て）
 *   - `readable: false`（note「popなし（Nフレームで確認）」）→ **そのセルは 0 点**（pop が出ないことの観測）
 * のいずれか。よって「そのビートで他レーンが全て可読 or 観測 0」なら
 *   実測(lane) = beat_gained_score − Σ(他レーンの pop)
 * として **切り捨て分（≤ Σ 粒度）を除いて厳密**に決まる。
 */
import fs from "node:fs";
import path from "node:path";

const repo = process.cwd();
const nox = path.resolve(repo, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const OUT = path.join(repo, "research", "23_beat_score_analysis", "phase16_action14_a2_s2_ratio.json");

const parseK = (t) => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const u = { "": 1, K: 1e3, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : Math.round(Number(m[1]) * u);
};
const gran = (t) => {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(t ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const u = { "": 1, K: 1e3, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : u / 10;
};
/** engine の sequential 丸め（src/formula/scoreEvent.ts multiplySequential）を再現 */
const seq = (basic, factors) => {
  let v = basic;
  for (const p of factors) v = Math.floor((v * p) / 1000);
  return v;
};

const simDoc = J(path.join(repo, "research", "23_beat_score_analysis", "phase16_action14_a2_s2_events.json")).samples.S2;
const meas = J(path.join(nox, "サンプル2", "measured_data_v3.json"));
const bf = J(path.join(nox, "サンプル2", "lane_pops_backfill.json"));

/* --- セル状態: value / zero（popなし観測）/ unknown --- */
const cellState = new Map();
for (const x of bf.pops ?? []) {
  const note = String(x.note ?? "");
  const v = parseK(x.displayed);
  if (x.readable === true && v !== null) cellState.set(`${x.beat}:${x.lane}`, { kind: "value", text: String(x.displayed), v });
  else if (note.includes("popなし")) cellState.set(`${x.beat}:${x.lane}`, { kind: "zero", text: null, v: 0 });
  else cellState.set(`${x.beat}:${x.lane}`, { kind: "unknown", text: null, v: null });
}
for (const e of meas.timeline) {
  const L = e.lanes ?? {};
  for (let l = 1; l <= 5; l++) {
    const key = `${e.beat}:${l}`;
    if (cellState.has(key)) continue;
    const g = L[String(l)] ?? L[`lane${l}`] ?? null;
    const t = typeof g === "string" ? g : (g?.text ?? null);
    const v = parseK(t);
    if (v !== null) cellState.set(key, { kind: "value", text: String(t), v });
  }
}
console.log(`S2 セル状態: value ${[...cellState.values()].filter((x) => x.kind === "value").length} / zero ${[...cellState.values()].filter((x) => x.kind === "zero").length} / unknown ${840 - cellState.size}`);

/* --- ビートごとの実測復元 --- */
const beatRows = [];
for (const e of meas.timeline) {
  const b = e.beat;
  const bgs = e.beat_gained_score ?? 0;
  const st = [1, 2, 3, 4, 5].map((l) => cellState.get(`${b}:${l}`) ?? { kind: "unknown", v: null });
  const unknownLanes = [1, 2, 3, 4, 5].filter((l) => st[l - 1].kind === "unknown");
  const knownSum = st.reduce((a, s) => a + (s.kind === "value" ? s.v : 0), 0);
  const slack = st.reduce((a, s) => a + (s.kind === "value" ? (gran(s.text) ?? 0) - 1 : 0), 0);
  const measured = {};
  // 閉包が成立しないビート（pop なしでスコアが出た＝観測漏れ）では、残差を全レーンへ
  // 二重計上してしまうため measured を出さない（【重要】A3 のフィットが壊れる原因だった）
  const closureOk = bgs - knownSum >= 0 && bgs - knownSum <= slack + 5;
  for (let l = 1; l <= 5; l++) {
    const others = [1, 2, 3, 4, 5].filter((x) => x !== l);
    const othersUnknown = others.filter((x) => st[x - 1].kind === "unknown");
    measured[l] =
      othersUnknown.length === 0 && closureOk
        ? bgs - others.reduce((a, x) => a + (st[x - 1].kind === "value" ? st[x - 1].v : 0), 0)
        : null;
  }
  beatRows.push({ beat: b, bgs, states: st, unknownLanes, knownSum, slack, resid: bgs - knownSum, closureOk, measured });
}
const closureBad = beatRows.filter((r) => r.resid < 0 || r.resid > r.slack + 5);
console.log(`閉包検査: ${beatRows.length - closureBad.length}/${beatRows.length} ビートで 0 ≤ (bgs − Σpop) ≤ 切り捨て上界`);
if (closureBad.length > 0) {
  console.log(`  外れ: ${closureBad.slice(0, 5).map((r) => `b${r.beat}(resid ${r.resid.toLocaleString()} > slack ${r.slack.toLocaleString()})`).join(" ")}`);
}

/* --- A/SP セル台帳 --- */
const actCells = [];
for (const [k, evs] of Object.entries(simDoc.cellEvents ?? {})) {
  const [b, l] = k.split(":").map(Number);
  const kind = evs[0]?.sourceKind;
  if (kind !== "A" && kind !== "SP") continue;
  const row = beatRows.find((r) => r.beat === b);
  actCells.push({
    cell: k,
    beat: b,
    lane: l,
    kind,
    sim: evs.reduce((a, e) => a + e.gainedScore, 0),
    measured: row?.measured[l] ?? null,
    bgs: row?.bgs ?? null,
    unknownLanes: row?.unknownLanes ?? [],
    slack: row?.slack ?? null,
    events: evs.map((e) => ({
      kind: e.sourceKind,
      isRatio: e.isRatioScore,
      base: e.ratioBaseCumScore,
      power: e.skillPowerPermil,
      basic: e.basicScore,
      b1: e.b1Permil,
      combo: e.comboFactorPermil,
      fan: e.fanFactorPermil,
      rand: e.randPermil,
      crit: e.critFactorPermil,
      gain: e.gainedScore,
    })),
  });
}
actCells.sort((a, b) => a.beat - b.beat);
const show = (c) => {
  const ratio = c.measured === null ? null : c.sim / c.measured;
  const need = c.measured === null ? null : c.measured / c.sim;
  return `  ${c.cell.padEnd(7)} ${c.kind.padEnd(4)} sim ${String(c.sim).padStart(11)} 実測 ${c.measured === null ? "   n/a" : String(c.measured).padStart(11)} ` +
    `比 ${ratio === null ? "n/a" : ratio.toFixed(4)} 不足 ${c.measured === null ? "n/a" : (c.measured - c.sim).toLocaleString().padStart(9)} ` +
    `必要倍率 ${need === null ? "n/a" : need.toFixed(5)}（他レーン不能 ${c.unknownLanes.filter((x) => x !== c.lane).length}）`;
};
console.log("\n=== S2 の A/SP セル（実測は bgs − Σ他レーン pop で厳密化） ===");
for (const c of actCells) console.log(show(c));
const agg = {};
for (const c of actCells) {
  agg[c.kind] ??= { n: 0, sim: 0, measured: 0, exact: 0 };
  agg[c.kind].n++;
  agg[c.kind].sim += c.sim;
  if (c.measured !== null) {
    agg[c.kind].measured += c.measured;
    agg[c.kind].exact++;
  }
}
console.log("\n=== kind 別（厳密化できたセルのみ） ===");
for (const [k, v] of Object.entries(agg)) {
  console.log(`  ${k}: ${v.n} セル（うち厳密 ${v.exact}）/ sim ${v.sim.toLocaleString()} / 実測 ${v.measured.toLocaleString()} / 比 ${v.exact === 0 ? "n/a" : (v.sim / v.measured).toFixed(4)}`);
}

/* --- b90 SP の ratio 適用順序の検定 --- */
const sp = actCells.find((c) => c.kind === "SP");
console.log("\n=== b90:3 SP（sk-rei-05-fest-01-1）の ratio 適用順序の検定 ===");
const e1 = sp.events[0];
const e2 = sp.events[1];
const cumBeforeSkill = e2.base - e1.gain; // スキル開始時点のレーン累積（row1 の加算前）
const row1Basic = seq(e1.basic, [e1.power]);
const row2Basic = e2.basic;
const baseUsed = e2.base;
const row1Gain = e1.gain;
const row2Gain = e2.gain;
const row2GainPerBase = row2Gain / baseUsed;
console.log(`  row1: power ${e1.power}‰ basic ${row1Basic.toLocaleString()} → ${row1Gain.toLocaleString()}`);
console.log(`  row2: 基本 = floor(base×130/1000) = ${row2Basic.toLocaleString()}（base ${baseUsed.toLocaleString()}）→ ${row2Gain.toLocaleString()}`);
console.log(`  スキル開始時点のレーン累積（= row1 加算前）= ${cumBeforeSkill.toLocaleString()}`);
console.log(`  → 現行の基準は「row1 を含めた最大値」。row1 を除くと base ${cumBeforeSkill.toLocaleString()}（${((cumBeforeSkill / baseUsed - 1) * 100).toFixed(2)}%）`);
const alt = [
  { name: "R1: 基準 = スキル開始時点（row1 を除く）", base: cumBeforeSkill },
  { name: "R2: 基準 = ratio 行の実行時点（row1 を含む）＝現行", base: baseUsed },
];
for (const a of alt) {
  const r2 = Math.floor((a.base * 130) / 1000);
  const gain2 = r2 * (row2Gain / row2Basic);
  const total = row1Gain + gain2;
  console.log(
    `  ${a.name}: base ${a.base.toLocaleString()} → row2 ${Math.round(gain2).toLocaleString()} / セル計 ${Math.round(total).toLocaleString()}` +
      ` （実測 ${sp.measured?.toLocaleString()} との差 ${sp.measured === null ? "n/a" : Math.round(total - sp.measured).toLocaleString()}）`,
  );
}
/** 実測を満たす一様倍率 k を解く: measured = g + 0.13·(C0+g)·(gain2/basic2)·k, g = k·row1Gain */
const C0 = cumBeforeSkill;
const perBase = row2Gain / row2Basic; // = 因数（1/1000 単位の比）
const solve = (target) => {
  let lo = 0.5;
  let hi = 1.5;
  for (let i = 0; i < 200; i++) {
    const k = (lo + hi) / 2;
    const g = k * row1Gain;
    const tot = g + Math.floor((0.13 * (C0 + g))) * perBase * k;
    if (tot < target) lo = k;
    else hi = k;
  }
  return (lo + hi) / 2;
};
if (sp.measured !== null) {
  const kLo = solve(sp.measured - (sp.slack ?? 0));
  const kHi = solve(sp.measured);
  console.log(
    `  実測を満たす一様倍率 k = ${kLo.toFixed(5)}〜${kHi.toFixed(5)}（スキル全体＝両 row に同じ倍率）。` +
      `これは「順序」では作れない（順序を変えると base は現行より小さくなる一方でしかない）`,
  );
  console.log(
    `  ※ row1/row2 の比（実測 sim 値）= ${(row1Gain / row2Gain).toFixed(6)} / モデル予測 = ${(
      seq(seq(seq(seq(row1Basic, [e1.b1 ?? 1000]), [e1.combo]), [e1.fan]), [e1.rand ?? 1000, e1.crit]) /
      seq(seq(seq(row2Basic, [e2.b1 ?? 1000]), [1000]), [e2.rand ?? 1000, e2.crit])
    ).toFixed(6)}（stage は共通なので比で消える）`,
  );
}

/* --- 各 A/SP セルの「末尾倍率（stage×advantage）」逆算 = sim のモデル一貫性検査 --- */
console.log("\n=== 因子連鎖の逆算（basic×power×b1×combo×fan×rand×crit を除いた残り = stage×advantage） ===");
for (const c of actCells) {
  const prefix = c.events.reduce((a, e) => {
    let v = Math.floor((e.basic * e.power) / 1000);
    v = Math.floor((v * (e.b1 ?? 1000)) / 1000);
    v = Math.floor((v * e.combo) / 1000);
    v = Math.floor((v * e.fan) / 1000);
    v = Math.floor((v * (e.rand ?? 1000)) / 1000);
    v = Math.floor((v * e.crit) / 1000);
    return a + v;
  }, 0);
  const tailSim = prefix === 0 ? null : c.sim / prefix;
  const tailMeas = prefix === 0 || c.measured === null ? null : c.measured / prefix;
  console.log(
    `  ${c.cell.padEnd(7)} ${c.kind.padEnd(3)} prefix ${String(prefix).padStart(11)} → tail(sim) ${tailSim === null ? "n/a" : tailSim.toFixed(5)}` +
      ` / tail(実測) ${tailMeas === null ? "n/a" : tailMeas.toFixed(5)} / 必要比 ${tailSim === null || tailMeas === null ? "n/a" : (tailMeas / tailSim).toFixed(5)}`,
  );
}

fs.writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      generatedBy: "phase16_action14_a2_s2_ratio.mjs",
      cellStates: Object.fromEntries(cellState),
      beats: beatRows,
      actCells,
      spRatioOrderTest: {
        cumBeforeSkill,
        baseUsed,
        row1Gain,
        row2Gain,
        row2Basic,
        row2GainPerBase,
        alternatives: alt.map((a) => ({ name: a.name, base: a.base })),
      },
    },
    null,
    1,
  )}\n`,
  "utf8",
);
console.log(`\n[out] ${path.relative(repo, OUT)}`);

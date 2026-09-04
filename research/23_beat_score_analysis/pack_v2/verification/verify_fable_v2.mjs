/**
 * Fable v2 統一モデル提案の検証スクリプト（research/23 pack_v2/05 の再現用）。
 *
 * 各サンプルの sim_trace_full.json（buffSnapshots 込み）+ sim_skills.json（deck 実値）から
 * ビートイベントを own/off に分解し、κ・λ・フォト規則・flat 加算を変えて再計算し、
 * 実測 measured_data*.json のビート獲得スコアと照合する。
 *
 * 実行: node research/23_beat_score_analysis/pack_v2/verification/verify_fable_v2.mjs
 * 出力: 標準出力に各モデルの implied rand 統計（in[950,1050] = 乱数内合格数）
 */
import { readFileSync } from "node:fs";

const REPO = "C:/Users/umaro/Documents/アイプラ";
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

const SAMPLES = [
  {
    tag: "S1",
    dir: `${REPO}/research/17_sample1_gap_analysis`,
    stage: "qt-area-1-001",
    act: `${NOX}/サンプル1/measured_data.json`,
    adv: {},
  },
  {
    tag: "S2",
    dir: `${REPO}/research/20_sample2_gap_analysis`,
    stage: "qt-tower-680",
    act: `${NOX}/サンプル2/measured_data_v2.json`,
    adv: {},
  },
  {
    tag: "S3",
    dir: `${REPO}/research/21_sample3_gap_analysis`,
    stage: "qt-ex-tower-005-045",
    act: `${NOX}/サンプル3/measured_data.json`,
    actV2: `${NOX}/サンプル3/measured_data_v2.json`,
    adv: { 5: 2250 },
  },
  {
    tag: "S4",
    dir: `${REPO}/research/22_sample4_gap_analysis`,
    stage: "qt-ex-tower-004-054",
    act: `${NOX}/サンプル4/measured_data.json`,
    actV2: `${NOX}/サンプル4/measured_data_v2.json`,
    adv: {},
  },
];

// data/stages_index.json から重みを取得
const idx = read(`${REPO}/data/stages_index.json`);
function weightsFor(stage) {
  const q = idx.quests.find((x) => x.id === stage);
  const c = idx.configs[q.c];
  return { vocal: c.w[0], dance: c.w[1], visual: c.w[2] };
}

function liveMult(sn, attr) {
  const up = sn[attr + "_up"];
  const ext = up > 0 ? sn[attr + "_up_extreme"] || 0 : 0;
  const boost = sn[attr + "_boost"];
  const down = sn[attr + "_down"];
  return Math.min(1000 + 50 * up + 50 * ext + 75 * boost - 50 * down, 3750);
}

/** sample1/2 の critical_flags（形式分岐）を {beat:[5]} に正規化 */
function normCrit(cf) {
  if (cf && Array.isArray(cf.beats)) {
    return Object.fromEntries(cf.beats.map((r) => [r.beat, r.lanes.map(Boolean)]));
  }
  if (cf && typeof cf.beats === "object") {
    return Object.fromEntries(
      Object.entries(cf.beats).map(([k, lanes]) => [
        Number(k),
        [1, 2, 3, 4, 5].map((L) => lanes[String(L)] === "critical"),
      ]),
    );
  }
  const out = {};
  for (const [key, v] of Object.entries(cf || {})) {
    const m = /^b(\d+)_L(\d)$/.exec(key);
    if (!m) continue;
    (out[Number(m[1])] ??= [false, false, false, false, false])[Number(m[2]) - 1] = Boolean(v);
  }
  return out;
}

function actuals(sample) {
  const d = read(sample.act);
  const tl = Array.isArray(d.timeline) ? d.timeline : [];
  const act = Object.fromEntries(tl.map((e) => [e.beat, e.beat_gained_score || 0]));
  const crit = normCrit(d.critical_flags);
  return { act, crit };
}

/** トレースを own/off に分解し、指定モデルでビート合計を再計算した {beat: total} を返す */
function recompute(sample, opt) {
  const { kappa = 1000, lam = [8, 140], flat = {}, strictPop = false } = opt;
  const trace = read(`${sample.dir}/sim_trace_full.json`);
  const skills = read(`${sample.dir}/sim_skills.json`);
  const W = weightsFor(sample.stage);
  const lanes = Object.fromEntries(skills.map((l) => [l.lane, l]));
  const ATTR = Object.fromEntries(skills.map((l) => [l.lane, l.attribute]));
  const tl2 = sample.actV2 ? read(sample.actV2).timeline : null;
  const popVisible = (beat) => {
    if (!tl2) return true;
    const e = tl2.find((x) => x.beat === beat);
    if (!e) return false;
    for (let L = 1; L <= 5; L++) {
      const key = Object.keys(e.lanes).find((k) => k === String(L) || k === `lane${L}`);
      const lane = e.lanes[key];
      const pop = lane?.gained_score_pop ?? (lane?.pop_class ? { color: lane.pop_class === "Y" ? "yellow" : "white" } : null);
      if (!pop?.color) return false;
    }
    return true;
  };
  const out = {};
  for (const bt of trace.beats) {
    let total = 0;
    for (const e of bt.events) {
      if (e.sourceKind !== "beat" || e.isRatioScore) continue;
      const L = e.lane;
      const lane = lanes[L];
      const attr = ATTR[L];
      const sn = bt.buffSnapshots[L - 1];
      const own = Math.floor((Math.floor((lane.deck[attr] * liveMult(sn, attr)) / 1000) * W[attr]) / 1000);
      let off = 0;
      for (const a of ["vocal", "dance", "visual"]) {
        if (a === attr) continue;
        off += Math.floor((Math.floor((lane.deck[a] * liveMult(sn, a)) / 1000) * W[a]) / 1000);
      }
      const basic = Math.floor((own + Math.floor((off * kappa) / 1000)) * lam[0] / lam[1]);
      let v = Math.floor((basic * e.b1Permil) / 1000);
      v = Math.floor((v * e.comboFactorPermil) / 1000);
      v = Math.floor((v * e.fanFactorPermil) / 1000);
      v = Math.floor((v * e.critFactorPermil) / 1000);
      v = Math.floor((v * (sample.adv[L] ?? 1000)) / 1000);
      if (flat[L]) v += flat[L];
      total += v;
    }
    out[bt.beat] = total;
  }
  if (!strictPop) return out;
  const filtered = {};
  for (const [beat, total] of Object.entries(out)) {
    if (popVisible(Number(beat))) filtered[beat] = total;
  }
  return filtered;
}

function stats(sample, opt, flatMap = {}) {
  const { act, crit } = actuals(sample);
  const sim = recompute(sample, { ...opt, strictPop: opt.strictPop || false });
  const trace = read(`${sample.dir}/sim_trace_full.json`);
  const pure = [];
  for (const bt of trace.beats) {
    const b = bt.beat;
    if ((crit[b] ?? [false, false, false, false, false]).some(Boolean)) continue;
    if ((act[b] ?? 0) <= 0) continue;
    if (bt.activations.some((a) => a.success)) continue;
    if (opt.strictPop) {
      const e = (sample.actV2 ? read(sample.actV2).timeline : []).find((x) => x.beat === b);
      void e;
    }
    pure.push(b);
  }
  const vals = [];
  for (const b of pure) {
    const s = sim[b];
    if (!s) continue;
    vals.push((act[b] / s) * 1000);
  }
  const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  const sd = vals.length > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1)) : 0;
  const inRange = vals.filter((v) => 950 <= v && v <= 1050).length;
  return { n: vals.length, mean, sd, inRange, min: Math.min(...vals), max: Math.max(...vals) };
}

const fmt = (r) =>
  `n=${r.n} mean=${r.mean.toFixed(1)} sd=${r.sd.toFixed(1)} in=${r.inRange}/${r.n} [${r.min.toFixed(0)}, ${r.max.toFixed(0)}]`;

for (const sample of SAMPLES) {
  console.log(`\n===== ${sample.tag} (${sample.stage}) =====`);
  for (const kappa of [1000, 900, 850, 800, 700]) {
    console.log(`  kappa=${kappa}: ${fmt(stats(sample, { kappa }))}`);
  }
  console.log(`  lam=1/20 k=1000: ${fmt(stats(sample, { kappa: 1000, lam: [1, 20] }))}`);
}

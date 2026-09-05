/**
 * pack_v3 用データ生成スクリプト（02_s2_pure_white_beats.md / 03 の数値出典）。
 *
 * - S2（qt-tower-680）32 純白ビート: ビート合計再計算（現行エンジン係数）+ implied rand、
 *   レーン別ポップ実測（lane_pops_backfill.json）との突合、レーン別 implied rand、
 *   バフスナップショット由来の own/off 分解・レーン別ファクター平均
 * - S3（qt-ex-tower-005-045）70 純白ビート: 対照統計 + ビート表 + レーン別 implied rand
 *   （S3 のレーン別ポップは backfill の covered_by_existing 転記値 + readable 値で全 350 セル）
 * - フォト flat 固定値のビート加算検証（v2 §2.5 の再現・03 の棄却根拠）
 * - κ スキャン（03 の棄却根拠・pack_v2 verify_output.txt と同値のはず）
 *
 * 出典データ:
 * - sim_trace_full.json / sim_skills.json: research/20,21 のエンジン出力（buffSnapshots 込み）
 * - measured_data*.json: 実測（aipura_nox）
 * - lane_pops_backfill.json: レーン別ポップ遡及（aipura_nox・2026-09-05/06 完了）
 *
 * 実行: node research/23_beat_score_analysis/pack_v3/verification/gen_pack_v3_tables.mjs
 * 出力: 標準出力に markdown 断片（02/03 へそのまま転記する。手計算は行わない）
 */
import { readFileSync } from "node:fs";

const REPO = "C:/Users/umaro/Documents/アイプラ";
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

const idx = read(`${REPO}/data/stages_index.json`);
function stageConfig(stage) {
  const q = idx.quests.find((x) => x.id === stage);
  const c = idx.configs[q.c];
  return {
    weights: { vocal: c.w[0], dance: c.w[1], visual: c.w[2] },
    attrs: c.a,
    cap: c.cap,
    staminaWeight: c.st ?? null,
  };
}

const BEAT_LAMBDA = { num: 8, den: 140 }; // src/timeline/engine.ts BEAT_LAMBDA_NUM/DEN

function liveMult(sn, attr) {
  const up = sn[attr + "_up"];
  const ext = up > 0 ? sn[attr + "_up_extreme"] || 0 : 0;
  const boost = sn[attr + "_boost"];
  const down = sn[attr + "_down"];
  return Math.min(1000 + 50 * up + 50 * ext + 75 * boost - 50 * down, 3750);
}

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

function popMap(sample) {
  const d = read(sample.pops);
  const map = {};
  for (const p of d.pops) {
    (map[p.beat] ??= {})[p.lane] = {
      color: p.color,
      displayed: p.displayed,
      readable: p.readable === true,
      covered: p.covered_by_existing === true,
    };
  }
  return map;
}

/** K/M 表示ポップの下限値パース: "+38.6K" → 38600。非対応形式は null */
function parsePop(displayed) {
  if (typeof displayed !== "string") return null;
  const m = /^\+?([\d.]+)([KM])$/.exec(displayed.trim());
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  return m[2] === "K" ? Math.round(num * 1000) : Math.round(num * 1e6);
}

/**
 * トレースからビートごとに own/off 分解→現行モデル（κ=1000・λ=8/140）で再計算。
 * opt.flat: {lane: fixedPerBeat}（フォト flat 加算の仮説検証用）
 * opt.kappa: off 引き下げ率‰（棄却済み κ モデルのスキャン用）
 * opt.lam: {num, den}（λ 比較用）
 */
function recompute(sample, stage, opt = {}) {
  const { lam = BEAT_LAMBDA, adv = {}, kappa = 1000, flat = {} } = opt;
  const trace = read(sample.dir + "/sim_trace_full.json");
  const skills = read(sample.dir + "/sim_skills.json");
  const W = stage.weights;
  const lanes = Object.fromEntries(skills.map((l) => [l.lane, l]));
  const ATTR = Object.fromEntries(skills.map((l) => [l.lane, l.attribute]));
  const out = {};
  for (const bt of trace.beats) {
    let total = 0;
    const laneOut = {};
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
      const basic = Math.floor(((own + Math.floor((off * kappa) / 1000)) * lam.num) / lam.den);
      let v = Math.floor((basic * e.b1Permil) / 1000);
      v = Math.floor((v * e.comboFactorPermil) / 1000);
      v = Math.floor((v * e.fanFactorPermil) / 1000);
      v = Math.floor((v * e.critFactorPermil) / 1000);
      v = Math.floor((v * (adv[L] ?? 1000)) / 1000);
      if (flat[L]) v += flat[L];
      total += v;
      laneOut[L] = {
        sim: v,
        own,
        off,
        basic,
        liveMult: liveMult(sn, attr),
        b1: e.b1Permil,
        combo: e.comboFactorPermil,
        fan: e.fanFactorPermil,
        crit: e.critFactorPermil,
        focus: sn.focus,
        stealth: sn.stealth,
        beatScoreUp: sn.beat_score_up,
      };
    }
    out[bt.beat] = { total, lanes: laneOut, activations: bt.activations };
  }
  return out;
}

function pureWhiteBeats(sample, sim) {
  const act = read(sample.act);
  const tl = Array.isArray(act.timeline) ? act.timeline : [];
  const actMap = Object.fromEntries(tl.map((e) => [e.beat, e.beat_gained_score || 0]));
  const crit = normCrit(act.critical_flags);
  const out = [];
  for (const bt of read(sample.dir + "/sim_trace_full.json").beats) {
    const b = bt.beat;
    if ((crit[b] ?? [false, false, false, false, false]).some(Boolean)) continue;
    if ((actMap[b] ?? 0) <= 0) continue;
    if (bt.activations.some((a) => a.success)) continue;
    out.push({
      beat: b,
      actual: actMap[b],
      sim: sim[b].total,
      ratio: (actMap[b] / sim[b].total) * 1000,
    });
  }
  out.sort((a, b) => a.beat - b.beat);
  return out;
}

function stats(vals) {
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / (n || 1);
  const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const inRange = vals.filter((v) => 950 <= v && v <= 1050).length;
  return { n, mean, sd, inRange, min: Math.min(...vals), max: Math.max(...vals) };
}
const fmt = (r) =>
  `n=${r.n} mean=${r.mean.toFixed(1)} sd=${r.sd.toFixed(1)} in=${r.inRange}/${r.n} [${r.min.toFixed(0)}, ${r.max.toFixed(0)}]`;
const meanOf = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/** deck.json の各レーンからフォト beat_score 情報を抽出 */
function photoBeatInfo(sample) {
  const deck = read(sample.deck);
  const yell = deck.deck.yale_bonus.beat_score_pct;
  const out = { yellPermil: Math.round(yell * 10), lanes: {} };
  for (const ch of deck.deck.characters) {
    const vals = [];
    for (const ph of ch.photos ?? []) {
      for (const s of ph.structured ?? []) {
        if (s.stat === "beat_score" && s.type === "pct") vals.push(Math.round(s.value * 10));
      }
    }
    out.lanes[ch.lane] = { photoBeatPermil: vals, max: Math.max(...vals, 0), sum: vals.reduce((a, b) => a + b, 0) };
  }
  return out;
}

/** deck.json の各レーンからフォト beat_score flat 固定値合計を抽出 */
function photoFlatPerLane(sample) {
  const deck = read(sample.deck);
  const out = {};
  for (const ch of deck.deck.characters) {
    let sum = 0;
    for (const ph of ch.photos ?? []) {
      for (const s of ph.structured ?? []) {
        if (s.stat === "beat_score" && s.type === "fixed") sum += s.value;
      }
    }
    if (sum > 0) out[ch.lane] = sum;
  }
  return out;
}

const SAMPLES = [
  {
    tag: "S2",
    dir: `${REPO}/research/20_sample2_gap_analysis`,
    stage: "qt-tower-680",
    deck: `${NOX}/サンプル2/deck.json`,
    act: `${NOX}/サンプル2/measured_data_v2.json`,
    pops: `${NOX}/サンプル2/lane_pops_backfill.json`,
    popSource: "backfill",
    adv: {},
  },
  {
    tag: "S3",
    dir: `${REPO}/research/21_sample3_gap_analysis`,
    stage: "qt-ex-tower-005-045",
    deck: `${NOX}/サンプル3/deck.json`,
    act: `${NOX}/サンプル3/measured_data.json`,
    pops: `${NOX}/サンプル3/lane_pops_backfill.json`,
    popSource: "backfill+existing",
    adv: { 5: 2250 },
  },
];

/** 実測 measured_data 側の既存ポップ text を {beat: {lane: text}} で抽出（S3 の gained_score_pop 等） */
function existingPopMap(sample) {
  const act = read(sample.act);
  const tl = Array.isArray(act.timeline) ? act.timeline : [];
  const map = {};
  for (const e of tl) {
    for (const [key, lane] of Object.entries(e.lanes ?? {})) {
      const L = Number(String(key).replace(/^lane/, ""));
      const text = lane?.gained_score_pop?.text ?? null;
      if (text) (map[e.beat] ??= {})[L] = text;
    }
  }
  return map;
}

function lanePopDisplayed(sample, popm, exm, beat, L) {
  const bf = (popm[beat] ?? {})[L];
  if (bf && bf.readable && bf.displayed) return bf.displayed;
  const ex = (exm[beat] ?? {})[L];
  if (ex) return ex;
  return null;
}

// ---------------------------------------------------------------------------
console.log("# generated by gen_pack_v3_tables.mjs — markdown fragments below");
console.log("");

for (const sample of SAMPLES) {
  const stage = stageConfig(sample.stage);
  const popm = popMap(sample);
  const pbi = photoBeatInfo(sample);
  const sim = recompute(sample, stage, { adv: sample.adv });
  const pure = pureWhiteBeats(sample, sim);

  console.log(`===== ${sample.tag} (${sample.stage}) =====`);
  console.log("");
  console.log(`pure white beats: ${fmt(stats(pure.map((p) => p.ratio)))}  (ratio = actual/sim ×1000, rand=1000 基準)`);
  console.log("");

  const exm = existingPopMap(sample);

  // --- ビート表 ---
  console.log(`### ${sample.tag} beat table`);
  console.log("");
  console.log("| beat | actual | sim | implied rand | L1 pop | L2 pop | L3 pop | L4 pop | L5 pop |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const p of pure) {
    const pops = [1, 2, 3, 4, 5].map((L) => lanePopDisplayed(sample, popm, exm, p.beat, L) ?? "—");
    console.log(
      `| b${p.beat} | ${p.actual} | ${p.sim} | ${p.ratio.toFixed(1)} | ${pops.join(" | ")} |`,
    );
  }
  console.log("");

  // --- レーン別 implied rand マトリクス ---
  console.log(`### ${sample.tag} per-lane implied rand matrix (‰, pop display floor込み)`);
  console.log("");
  console.log("| beat | L1 | L2 | L3 | L4 | L5 |");
  console.log("|---|---|---|---|---|---|");
  const perLaneVals = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const p of pure) {
    const cells = [1, 2, 3, 4, 5].map((L) => {
      const text = lanePopDisplayed(sample, popm, exm, p.beat, L);
      const val = parsePop(text);
      const sl = sim[p.beat].lanes[L];
      if (val !== null && sl) {
        perLaneVals[L].push((val / sl.sim) * 1000);
        return ((val / sl.sim) * 1000).toFixed(1);
      }
      return "—";
    });
    console.log(`| b${p.beat} | ${cells.join(" | ")} |`);
  }
  console.log("");
  console.log("per-lane aggregates:");
  const allL = Object.values(perLaneVals).flat();
  for (let L = 1; L <= 5; L++) {
    console.log(`- L${L}: ${fmt(stats(perLaneVals[L]))}`);
  }
  console.log(`- ALL: ${fmt(stats(allL))}`);
  console.log("");

  // --- レーン別ファクター平均 ---
  console.log(`### ${sample.tag} per-lane factor means over pure beats`);
  console.log("");
  console.log("| lane | attr | own mean | off mean | off% | liveMult(own) mean | b1 mean | fan mean | focus mean | beat_score_up mean |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  const skills = read(sample.dir + "/sim_skills.json");
  const ATTR = Object.fromEntries(skills.map((l) => [l.lane, l.attribute]));
  for (let L = 1; L <= 5; L++) {
    const rows = pure.map((p) => sim[p.beat].lanes[L]).filter(Boolean);
    const own = meanOf(rows.map((r) => r.own));
    const off = meanOf(rows.map((r) => r.off));
    const lm = meanOf(rows.map((r) => r.liveMult));
    const b1 = meanOf(rows.map((r) => r.b1));
    const fan = meanOf(rows.map((r) => r.fan));
    const fo = meanOf(rows.map((r) => r.focus));
    const bsu = meanOf(rows.map((r) => r.beatScoreUp));
    const attr = ATTR[L];
    console.log(
      `| L${L} | ${attr} | ${own.toFixed(0)} | ${off.toFixed(0)} | ${((off / (own + off)) * 100).toFixed(1)}% | ${lm.toFixed(0)} | ${b1.toFixed(1)} | ${fan.toFixed(1)} | ${fo.toFixed(1)} | ${bsu.toFixed(2)} |`,
    );
  }
  console.log("");
  // フォト beat% の内訳（max/sum 規則の検証材料）
  console.log("photo beat_score pct per lane (deck.json; yell = " + pbi.yellPermil + "‰):");
  for (let L = 1; L <= 5; L++) {
    const info = pbi.lanes[L];
    console.log(
      `- L${L}: photos=[${info.photoBeatPermil.join(", ")}] max=${info.max} sum=${info.sum} (sim_skills scoreBonusPct.beat 参照は上表 b1)`,
    );
  }
  console.log("");

  // --- own/off 分解マトリクス（S2 のみ・S3 は factor means で対照） ---
  if (sample.tag === "S2") {
    console.log("### S2 own/off decomposition matrix (cell = own/off, buffSnapshots 由来)");
    console.log("");
    console.log("| beat | L1 (vocal) | L2 (vocal) | L3 (vocal) | L4 (dance) | L5 (vocal) |");
    console.log("|---|---|---|---|---|---|");
    for (const p of pure) {
      const cells = [1, 2, 3, 4, 5].map((L) => {
        const sl = sim[p.beat].lanes[L];
        return sl ? `${sl.own}/${sl.off}` : "—";
      });
      console.log(`| b${p.beat} | ${cells.join(" | ")} |`);
    }
    console.log("");
  }
}

// --- flat 検証（03 の棄却根拠） ---
console.log("===== flat (photo beat_score fixed) hypothesis check =====");
console.log("");
for (const sample of SAMPLES) {
  const stage = stageConfig(sample.stage);
  const flat = photoFlatPerLane(sample);
  console.log(`${sample.tag} flat per lane (deck.json beat_score/fixed sum): ${JSON.stringify(flat)}`);
  for (const [tag, opt] of [
    ["no-flat", {}],
    ["flat-per-lane-event", { flat }],
  ]) {
    const sim = recompute(sample, stage, { adv: sample.adv, ...opt });
    const pure = pureWhiteBeats(sample, sim);
    console.log(`- ${tag}: ${fmt(stats(pure.map((p) => p.ratio)))}`);
  }
}
console.log("");

// --- κ スキャン（03 の棄却根拠） ---
console.log("===== kappa scan (rejected model: basic=(own+floor(off*k/1000))*lam) =====");
console.log("");
for (const sample of SAMPLES) {
  const stage = stageConfig(sample.stage);
  const lines = [];
  for (const kappa of [1000, 900, 850, 800, 700]) {
    const sim = recompute(sample, stage, { adv: sample.adv, kappa });
    const pure = pureWhiteBeats(sample, sim);
    lines.push(`  kappa=${kappa}: ${fmt(stats(pure.map((p) => p.ratio)))}`);
  }
  const sim20 = recompute(sample, stage, { adv: sample.adv, kappa: 1000, lam: { num: 1, den: 20 } });
  const pure20 = pureWhiteBeats(sample, sim20);
  lines.push(`  lam=1/20 k=1000: ${fmt(stats(pure20.map((p) => p.ratio)))}`);
  console.log(`${sample.tag} (${sample.stage}):`);
  console.log(lines.join("\n"));
}

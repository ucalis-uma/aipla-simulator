/**
 * v0.app 回答「S2/S3 のレーン別スコアオフセット — 機序仮説と判定実験」
 * (https://score-offset-hypothesis.v0.build/ ・webarchive 由来 MD を Downloads から受領)
 * の数値検証スクリプト。
 *
 * ページの数値は lib/data.ts（02 §3/§4/§6/§7 と gen_output.txt の転記）+ クライアント側
 * 再計算（lib/analysis.ts）で作られているため、本スクリプトは gen_pack_v3_tables.mjs と
 * 同一の recompute 経路で一次データ（sim_trace_full.json + lane_pops_backfill.json +
 * measured_data*.json + deck.json）から直接再計算し、以下を機械出力する:
 *
 *   0. 純白ビート合計の再現（02 のヘッドライン統計・スクリプト経路の健全性確認）
 *   1. E2: レーン別回帰 pop = a + b·sim_lane（切片 a vs deck beat_score/fixed、χ² 比較）
 *   2. fixed 補正後のレーン別 implied rand
 *   3. E1: バフ状態（off 値）別コントラスト + 前半/後半分割
 *   4. §2.3: 単一ファクターで生オフセットを吸収するのに必要な値
 *   5. §2.4: 計算可能な仮説パターンの RMS（H4-a/H5-a はページ同型の静的式）
 *   6. E0: A/SP ノートのレーン別 implied rand（ページ未実施・既存データで本検証が新規実行）
 *
 * 注意: S2 トレース（research/20）は 2026-09-03 時点の実装（フォト beat% = sum）で生成され、
 * S3 トレース（research/21）は 657d1ac（2026-09-05・sum→max 変更）以降の実装（max）で生成
 * されている。S2 L4 の b1 = 1000+60+175+206+25su = 1441+25su（sum 前提）である点は
 * §5 の H5-a 解釈と L4 オフセット解釈に影響する（05 レポート参照）。
 *
 * 実行: node research/23_beat_score_analysis/pack_v3/verification/verify_v0_response.mjs > verify_v0_output.txt
 */
import { readFileSync } from "node:fs";

const REPO = "C:/Users/umaro/Documents/アイプラ";
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

// ---------------------------------------------------------------------------
// 共通ヘルパー（gen_pack_v3_tables.mjs と同一経路）
// ---------------------------------------------------------------------------
const idx = read(`${REPO}/data/stages_index.json`);
function stageConfig(stage) {
  const q = idx.quests.find((x) => x.id === stage);
  const c = idx.configs[q.c];
  return {
    weights: { vocal: c.w[0], dance: c.w[1], visual: c.w[2] },
    attrs: c.a,
    cap: c.cap,
  };
}

const BEAT_LAMBDA = { num: 8, den: 140 }; // src/timeline/engine.ts BEAT_LAMBDA_NUM/DEN
const ATTRS = ["vocal", "dance", "visual"];

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

/** K/M 表示ポップの下限値パース: "+38.6K" → {value:38600, unit:100}。非対応形式は null */
function parsePop(displayed) {
  if (typeof displayed !== "string") return null;
  const m = /^\+?([\d.]+)([KM])$/.exec(displayed.trim());
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  return m[2] === "K"
    ? { value: Math.round(num * 1000), unit: 100 }
    : { value: Math.round(num * 1e6), unit: 100000 };
}

/** 実測 measured_data 側の既存ポップ text を {beat: {lane: text}} で抽出 */
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

/** deck.json の各レーンからフォト beat_score / a_score(flat) 情報を抽出 */
function photoInfoPerLane(sample) {
  const deck = read(sample.deck);
  const yell = Math.round(deck.deck.yale_bonus.beat_score_pct * 10);
  const fixed = {};
  const pctMax = {};
  const pctSum = {};
  const aScoreFlat = {};
  for (const ch of deck.deck.characters) {
    let f = 0;
    const pcts = [];
    let af = 0;
    for (const ph of ch.photos ?? []) {
      for (const s of ph.structured ?? []) {
        if (s.stat === "beat_score" && s.type === "fixed") f += s.value;
        if (s.stat === "beat_score" && s.type === "pct") pcts.push(Math.round(s.value * 10));
        if (s.stat === "a_score" && s.type === "fixed") af += s.value;
      }
    }
    fixed[ch.lane] = f;
    pctMax[ch.lane] = pcts.length ? Math.max(...pcts) : 0;
    pctSum[ch.lane] = pcts.reduce((a, b) => a + b, 0);
    aScoreFlat[ch.lane] = af;
  }
  return { yell, fixed, pctMax, pctSum, aScoreFlat };
}

// ---- ファン表（src/timeline/buffs.ts FAN_BONUS_SEGMENTS / fanBonusPermilFromCount と同一） ----
const FAN_BONUS_SEGMENTS = [
  { upToFans: 1000, fansPer0_1Pct: 10 },
  { upToFans: 5000, fansPer0_1Pct: 20 },
  { upToFans: 9800, fansPer0_1Pct: 40 },
  { upToFans: 10000, fansPer0_1Pct: 2.5 },
  { upToFans: 20000, fansPer0_1Pct: 50 },
  { upToFans: null, fansPer0_1Pct: 100 },
];
function fanBonusPermilFromCount(fans) {
  let prev = 0;
  let pct = 0;
  for (const s of FAN_BONUS_SEGMENTS) {
    const end = s.upToFans ?? fans;
    const span = Math.min(fans, end) - prev;
    if (span > 0) pct += Math.floor(span / s.fansPer0_1Pct) * 0.1;
    prev = end;
    if (s.upToFans === null || fans <= s.upToFans) break;
  }
  return Math.round(pct * 10);
}
/** ファンボーナス ‰ → 来場数の連続逆算（§2.3 の「来場数」列・ページと同じ連続解法） */
function countFromBonus(bonusPermil) {
  let remaining = bonusPermil;
  let fans = 0;
  for (const s of FAN_BONUS_SEGMENTS) {
    const segFans = s.upToFans === null ? Infinity : s.upToFans - fans;
    const segPermil = segFans / s.fansPer0_1Pct;
    if (remaining <= segPermil) return fans + remaining * s.fansPer0_1Pct;
    remaining -= segPermil;
    fans += segFans;
  }
  return fans;
}
// 集目固定加算（src/timeline/buffs.ts FOCUS_FAN_BONUS_PERMIL と同一）
const FOCUS_FAN_BONUS_PERMIL = [7, 14, 21, 28, 35, 38, 41, 44, 47, 50];
function focusFanBonusPermil(focus) {
  return focus >= 1 && focus <= 10 ? FOCUS_FAN_BONUS_PERMIL[focus - 1] : 0;
}
function attractPermil(focus, stealth) {
  return 1000 + 50 * focus - 50 * stealth;
}

// ---------------------------------------------------------------------------
// トレース再計算（gen_pack_v3_tables.mjs recompute と同一。opt.liveMultScope で H4-a を注入）
// ---------------------------------------------------------------------------
function recompute(sample, stage, opt = {}) {
  const { lam = BEAT_LAMBDA, adv = {}, kappa = 1000, flat = {}, liveMultScope = "own" } = opt;
  const trace = read(sample.dir + "/sim_trace_full.json");
  const skills = read(sample.dir + "/sim_skills.json");
  const W = stage.weights;
  const lanes = Object.fromEntries(skills.map((l) => [l.lane, l]));
  const ATTR = Object.fromEntries(skills.map((l) => [l.lane, l.attribute]));
  const out = {};
  for (const bt of trace.beats) {
    const laneOut = {};
    for (const e of bt.events) {
      if (e.sourceKind !== "beat" || e.isRatioScore) continue;
      const L = e.lane;
      const lane = lanes[L];
      const attr = ATTR[L];
      const sn = bt.buffSnapshots[L - 1];
      const lmOwn = liveMult(sn, attr);
      const own = Math.floor((Math.floor((lane.deck[attr] * lmOwn) / 1000) * W[attr]) / 1000);
      let off = 0;
      for (const a of ATTRS) {
        if (a === attr) continue;
        // scope "own"（現行エンジン・gen と同一）: off 属性は各属性自身の liveMult。
        // scope "all"（H4-a 診断）: off 属性にも own 属性の liveMult を掛ける。
        const lmA = liveMultScope === "all" ? lmOwn : liveMult(sn, a);
        off += Math.floor((Math.floor((lane.deck[a] * lmA) / 1000) * W[a]) / 1000);
      }
      const basic = Math.floor(((own + Math.floor((off * kappa) / 1000)) * lam.num) / lam.den);
      let v = Math.floor((basic * e.b1Permil) / 1000);
      v = Math.floor((v * e.comboFactorPermil) / 1000);
      v = Math.floor((v * e.fanFactorPermil) / 1000);
      v = Math.floor((v * e.critFactorPermil) / 1000);
      v = Math.floor((v * (adv[L] ?? 1000)) / 1000);
      if (flat[L]) v += flat[L];
      laneOut[L] = {
        sim: v,
        own,
        off,
        basic,
        liveMult: lmOwn,
        b1: e.b1Permil,
        combo: e.comboFactorPermil,
        fan: e.fanFactorPermil,
        crit: e.critFactorPermil,
        focus: sn.focus,
        stealth: sn.stealth,
        scoreUp: sn.score_up,
        beatScoreUp: sn.beat_score_up,
      };
    }
    out[bt.beat] = { lanes: laneOut, snapshots: bt.buffSnapshots, events: bt.events };
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
      sim: Object.values(sim[b].lanes).reduce((s, x) => s + x.sim, 0),
      ratio: (actMap[b] / Object.values(sim[b].lanes).reduce((s, x) => s + x.sim, 0)) * 1000,
    });
  }
  out.sort((a, b) => a.beat - b.beat);
  return out;
}

// ---------------------------------------------------------------------------
// 統計ヘルパー
// ---------------------------------------------------------------------------
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const se = (xs) => sd(xs) / Math.sqrt(xs.length || 1);
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const fmtK = (x) => (Number.isFinite(x) ? (x / 1000).toFixed(1) + "K" : "-");

/** 最小二乗回帰 pop = a + b·sim（se は残差分散による標準誤差・ページの D4 と同一定式） */
function regress(xs, ys) {
  const n = xs.length;
  const xm = mean(xs);
  const ym = mean(ys);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - xm) ** 2;
    sxy += (xs[i] - xm) * (ys[i] - ym);
  }
  const b = sxy / sxx;
  const a = ym - b * xm;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (ys[i] - a - b * xs[i]) ** 2;
  const s2 = ss / (n - 2);
  return {
    n,
    a,
    seA: Math.sqrt(s2 * (1 / n + (xm * xm) / sxx)),
    b,
    seB: Math.sqrt(s2 / sxx),
  };
}

/** RMS（raw / 中心化）: pred と obs のレーン別値（5 レーン）。residual = pred − obs */
function rms(pred, obs) {
  const res = pred.map((p, i) => p - obs[i]);
  const raw = Math.sqrt(mean(res.map((r) => r * r)));
  const m = mean(res);
  const centered = Math.sqrt(mean(res.map((r) => (r - m) * (r - m))));
  return { raw, centered };
}

// ---------------------------------------------------------------------------
// サンプル定義（gen_pack_v3_tables.mjs と同一 + baseCount）
// ---------------------------------------------------------------------------
const SAMPLES = [
  {
    tag: "S2",
    dir: `${REPO}/research/20_sample2_gap_analysis`,
    stage: "qt-tower-680",
    deck: `${NOX}/サンプル2/deck.json`,
    act: `${NOX}/サンプル2/measured_data_v2.json`,
    pops: `${NOX}/サンプル2/lane_pops_backfill.json`,
    adv: {},
    baseCount: 13206, // 個人来場ファン数（fan.png 合計 66,031 の 1/5・trace_dump.ts と同一）
    photoRule: "sum", // トレース生成時点（d9c98c3・2026-09-03）は sumScorePct 実装
  },
  {
    tag: "S3",
    dir: `${REPO}/research/21_sample3_gap_analysis`,
    stage: "qt-ex-tower-005-045",
    deck: `${NOX}/サンプル3/deck.json`,
    act: `${NOX}/サンプル3/measured_data.json`,
    pops: `${NOX}/サンプル3/lane_pops_backfill.json`,
    adv: { 5: 2250 },
    baseCount: 8000,
    photoRule: "max", // トレース生成（657d1ac・2026-09-05 以降）は maxScorePct 実装
  },
];

console.log("# generated by verify_v0_response.mjs — v0.app 回答ページの数値検証");
console.log("");

for (const sample of SAMPLES) {
  const stage = stageConfig(sample.stage);
  const popm = popMap(sample);
  const exm = existingPopMap(sample);
  const pinfo = photoInfoPerLane(sample);
  const sim = recompute(sample, stage, { adv: sample.adv });
  const simAll = recompute(sample, stage, { adv: sample.adv, liveMultScope: "all" }); // H4-a
  const pure = pureWhiteBeats(sample, sim);
  const skills = read(sample.dir + "/sim_skills.json");
  const ATTR = Object.fromEntries(skills.map((l) => [l.lane, l.attribute]));

  console.log(`===== ${sample.tag} (${sample.stage}) =====`);
  console.log("");

  // --- 0. 純白ビート合計（ヘッドライン再現確認） ---
  const rs = pure.map((p) => p.ratio);
  const inR = rs.filter((v) => 950 <= v && v <= 1050).length;
  console.log(
    `[0] pure white totals: n=${rs.length} mean=${mean(rs).toFixed(1)} sd=${sd(rs).toFixed(1)} in=${inR}/${rs.length} [${Math.min(...rs).toFixed(0)}, ${Math.max(...rs).toFixed(0)}]`,
  );
  console.log("");

  // --- レーン別行データ（純白ビート × ポップ存在セル） ---
  const rows = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const p of pure) {
    for (let L = 1; L <= 5; L++) {
      const pp = parsePop(lanePopDisplayed(sample, popm, exm, p.beat, L));
      const sl = sim[p.beat].lanes[L];
      if (pp === null || !sl) continue;
      rows[L].push({
        beat: p.beat,
        pop: pp.value,
        sim: sl.sim,
        implied: (pp.value / sl.sim) * 1000,
        own: sl.own,
        off: sl.off,
        liveMult: sl.liveMult,
        b1: sl.b1,
        fan: sl.fan,
        focus: sl.focus,
        scoreUp: sl.scoreUp,
        beatScoreUp: sl.beatScoreUp,
      });
    }
  }

  const rawMeanImplied = {};
  for (let L = 1; L <= 5; L++) rawMeanImplied[L] = mean(rows[L].map((r) => r.implied));
  const obsOffsets = [1, 2, 3, 4, 5].map((L) => rawMeanImplied[L] - 1000);

  // --- 1. E2 回帰: pop = a + b·sim_lane ---
  console.log("[1] E2 regression: pop = a + b*sim_lane (pure white beats)");
  console.log("| lane | a | ±se | deck fixed | z(a=0) | z(a=fixed) | b | sim range |");
  console.log("|---|---|---|---|---|---|---|---|");
  let chi0 = 0;
  let chiF = 0;
  for (let L = 1; L <= 5; L++) {
    const r = rows[L];
    const reg = regress(r.map((x) => x.sim), r.map((x) => x.pop));
    const f = pinfo.fixed[L] ?? 0;
    const z0 = reg.a / reg.seA;
    const zF = (reg.a - f) / reg.seA;
    chi0 += z0 * z0;
    chiF += zF * zF;
    const sims = r.map((x) => x.sim);
    console.log(
      `| L${L} | ${fmt(reg.a, 0)} | ${fmt(reg.seA, 0)} | ${f} | ${fmt(z0, 2)} | ${fmt(zF, 2)} | ${fmt(reg.b, 3)} | ${fmtK(Math.min(...sims))}–${fmtK(Math.max(...sims))} |`,
    );
  }
  console.log(`chi2(a=0) = ${chi0.toFixed(1)} -> chi2(a=fixed) = ${chiF.toFixed(1)}`);
  console.log("");

  // --- 2. fixed 補正後 implied rand ---
  console.log("[2] fixed-corrected per-lane implied rand (‰)");
  console.log("| lane | raw mean | fixed 補正後 | ±se | 残差‰ |");
  console.log("|---|---|---|---|---|");
  for (let L = 1; L <= 5; L++) {
    const f = pinfo.fixed[L] ?? 0;
    const corr = rows[L].map((r) => ((r.pop - f) / r.sim) * 1000);
    console.log(
      `| L${L} | ${fmt(rawMeanImplied[L], 1)} | ${fmt(mean(corr), 1)} | ${fmt(se(corr), 1)} | ${fmt(mean(corr) - 1000, 1)} |`,
    );
  }
  console.log("");

  // --- 3. E1: 状態別コントラスト + 前半/後半 ---
  console.log("[3] E1 state contrast (off value groups with n>=3, per lane) + first/second half");
  console.log("| lane | off 値 | n | mean | ±se |");
  console.log("|---|---|---|---|---|");
  for (let L = 1; L <= 5; L++) {
    const groups = new Map();
    for (const r of rows[L]) {
      const k = r.off;
      (groups.get(k) ?? groups.set(k, []).get(k)).push(r.implied);
    }
    for (const [k, xs] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      if (xs.length < 3) continue;
      console.log(
        `| L${L} | ${k} | ${xs.length} | ${fmt(mean(xs), 1)} | ${fmt(se(xs), 1)} |`,
      );
    }
  }
  console.log("");
  console.log("first/second half split (raw implied):");
  console.log("| lane | 前半 | 後半 | Δ | ±se(Δ) |");
  console.log("|---|---|---|---|---|");
  for (let L = 1; L <= 5; L++) {
    const r = [...rows[L]].sort((a, b) => a.beat - b.beat);
    const h = Math.floor(r.length / 2);
    const a1 = r.slice(0, h).map((x) => x.implied);
    const a2 = r.slice(h).map((x) => x.implied);
    const d = mean(a2) - mean(a1);
    const seD = Math.sqrt(sd(a1) ** 2 / a1.length + sd(a2) ** 2 / a2.length);
    console.log(`| L${L} | ${fmt(mean(a1), 1)} | ${fmt(mean(a2), 1)} | ${fmt(d, 1)} | ${fmt(seD, 1)} |`);
  }
  console.log("");

  // --- 4. §2.3: 単一ファクター吸収に必要な値 ---
  console.log("[4] single-factor absorption requirements (raw offset basis)");
  console.log("| lane | 比率 | κ_req | liveMult_req‰ (sim) | ΔB1‰ | Δfan‰ | 来場数 (sim→req) |");
  console.log("|---|---|---|---|---|---|---|");
  for (let L = 1; L <= 5; L++) {
    const r = rows[L];
    const own = mean(r.map((x) => x.own));
    const off = mean(r.map((x) => x.off));
    const lm = mean(r.map((x) => x.liveMult));
    const b1m = mean(r.map((x) => x.b1));
    const fanm = mean(r.map((x) => x.fan));
    const ratio = rawMeanImplied[L] / 1000;
    const kappaReq = (ratio * (own + off) - own) / off;
    const lmReq = (lm * (ratio * (own + off) - off)) / own;
    const dB1 = (ratio - 1) * b1m;
    const dFan = (ratio - 1) * fanm;
    const focusMean = mean(r.map((x) => x.focus));
    const fb = focusFanBonusPermil(Math.round(focusMean));
    const cntSim = countFromBonus(fanm - 1000 - fb);
    const cntReq = countFromBonus(fanm * ratio - 1000 - fb);
    // 参考: スナップショットから前向き計算した自レーン来場数の平均
    let cntFwd = null;
    if (sim[pure[0].beat].snapshots) {
      const fwd = [];
      for (const p of pure) {
        const snaps = sim[p.beat].snapshots;
        if (!snaps) continue;
        const attract = snaps.map((s) => attractPermil(s.focus ?? 0, s.stealth ?? 0));
        const total = attract.reduce((a, b) => a + b, 0);
        fwd.push(Math.round((sample.baseCount * 5 * attract[L - 1]) / total));
      }
      cntFwd = mean(fwd);
    }
    console.log(
      `| L${L} | ${fmt(ratio, 4)} | ${fmt(kappaReq, 3)} | ${fmt(lmReq, 0)} ( ${fmt(lm, 0)} ) | ${fmt(dB1, 1)} | ${fmt(dFan, 1)} | ${fmtK(cntSim)} → ${fmtK(cntReq)} (fwd ${cntFwd === null ? "-" : fmtK(cntFwd)}) |`,
    );
  }
  console.log("");

  // --- 5. §2.4: 仮説パターン RMS（ページ同型の静的式・RMS は obs−pred 残差） ---
  console.log("[5] hypothesis pattern RMS (page-style static formulas, residual = pred - obs)");
  const base = rms([0, 0, 0, 0, 0], obsOffsets);
  console.log(
    `observed offsets (‰): ${obsOffsets.map((o) => fmt(o, 1)).join(" / ")}  (baseline RMS raw ${fmt(base.raw, 1)} / centered ${fmt(base.centered, 1)})`,
  );
  // H4-a: ページ同型 — 「off 属性にも own 属性の liveMult が掛かる」ときの予測オフセット
  //   pred_L = off_mean/(own_mean+off_mean) × (liveMult_own_mean − 1000)
  //   （ページは「sim は own にのみ liveMult」を前提にした近似式。実際のエンジンは
  //    off 属性に各属性自身の liveMult を掛けている点に注意・05 レポート参照）
  const h4a = [];
  for (let L = 1; L <= 5; L++) {
    const own = mean(rows[L].map((x) => x.own));
    const off = mean(rows[L].map((x) => x.off));
    const lm = mean(rows[L].map((x) => x.liveMult));
    h4a.push(((off / (own + off)) * (lm - 1000)));
  }
  // H5-a: ページ同型 — b1 内訳の乗算合成。(1+yell)(1+photoMax)(1+0.025·su) vs 加算 b1。
  //   su は b1_mean から逆算（su = (b1−1000−yell−photoMax)/25）。photoRule=sum の S2 L4 では
  //   逆算 su が実トレース su（2.63 段）と食い違う点に注意（05 レポート参照）。
  const h5a = [];
  for (let L = 1; L <= 5; L++) {
    const b1m = mean(rows[L].map((x) => x.b1));
    const y = pinfo.yell;
    const p = pinfo.pctMax[L];
    const su = (b1m - 1000 - y - p) / 25;
    const mult = 1000 * (1 + y / 1000) * (1 + p / 1000) * (1 + 0.025 * su);
    h5a.push((mult / b1m - 1) * 1000);
  }
  // H2-b: 集目再配分なし（非集目レーンが基準値 baseCount に戻る）
  const baseFan = 1000 + fanBonusPermilFromCount(sample.baseCount);
  const h2b = [];
  for (let L = 1; L <= 5; L++) {
    const focusMean = mean(rows[L].map((r) => r.focus));
    if (focusMean >= 0.5) {
      h2b.push(0);
    } else {
      h2b.push(mean(rows[L].map((r) => (baseFan / r.fan - 1) * 1000)));
    }
  }
  // H6: レーン属性 ≠ センター（L3）属性のレーンに +70‰
  const centerAttr = ATTR[3];
  const h6 = [1, 2, 3, 4, 5].map((L) => (ATTR[L] !== centerAttr ? 70 : 0));
  for (const [name, pred] of [
    ["H4-a liveMult 全属性適用", h4a],
    ["H5-a B1 乗算合成", h5a],
    ["H2-b ファン再配分なし", h2b],
    ["H6 非センター属性 +70‰", h6],
  ]) {
    const r = rms(pred, obsOffsets);
    console.log(
      `${name}: pred ${pred.map((p) => fmt(p, 1)).join(" / ")} | RMS raw ${fmt(r.raw, 1)} / centered ${fmt(r.centered, 1)}`,
    );
  }
  console.log("");

  // --- 6. E0: A/SP ノートのレーン別 implied rand ---
  // トレースは NeutralRng（rand=1000 固定）で生成 → gainedScore は乱数 1000 基準。
  // 実機ポップには実機乱数 r が乗るため implied_rand = pop/gainedScore×1000 で復元できる。
  // pop は K/M 表示の下限値 → 真値区間 [pop, pop+unit) から implied 区間を出し、
  // [950,1050]（±5% 乱数帯）との整合を判定する。A スキルはフォト a_score fixed の
  // 平坦加算（aScoreFlat）が乗るため、乗算部分だけで比較する（flat は乱数に乗らない）。
  console.log("[6] E0: A/SP note per-lane implied rand (pop vs rand=1000 trace)");
  const trace = read(sample.dir + "/sim_trace_full.json");
  const e0 = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  const e0out = [];
  let e0skippedNoPop = 0;
  let e0critIncluded = 0;
  for (const bt of trace.beats) {
    const evs = bt.events.filter((e) => e.sourceKind === "A" || e.sourceKind === "SP");
    if (evs.length === 0) continue;
    const lanesPresent = [...new Set(evs.map((e) => e.lane))];
    for (const L of lanesPresent) {
      const laneEvs = evs.filter((e) => e.lane === L);
      const kind = laneEvs[0].sourceKind;
      const gainedMult = laneEvs.reduce((s, e) => s + e.gainedScore, 0) - (pinfo.aScoreFlat[L] ?? 0) * laneEvs.filter((e) => e.sourceKind === "A").length;
      const pp = parsePop(lanePopDisplayed(sample, popm, exm, bt.beat, L));
      if (pp === null) {
        e0skippedNoPop++;
        continue;
      }
      // flat は A イベントにのみ加算。ポップ/トレース双方から除いて乗算部だけで比較
      const flat = kind === "A" ? (pinfo.aScoreFlat[L] ?? 0) : 0;
      const critF = Math.max(...laneEvs.map((e) => e.critFactorPermil));
      if (critF > 1000) e0critIncluded++;
      const lo = ((pp.value - flat) / (gainedMult)) * 1000;
      const hi = ((pp.value + pp.unit - flat) / (gainedMult)) * 1000;
      const mid = ((pp.value + pp.unit / 2 - flat) / (gainedMult)) * 1000;
      const inLoose = hi >= 950 && lo <= 1050;
      const cell = {
        beat: bt.beat,
        lane: L,
        kind,
        lo,
        hi,
        mid,
        inLoose,
        crit: critF > 1000,
        below: hi < 950,
        above: lo > 1050,
      };
      e0[L].push(cell);
      if (!inLoose) e0out.push(cell);
    }
  }
  console.log(`cells: popなし skip=${e0skippedNoPop} / crit込み ${e0critIncluded} 件（crit は pop・gained 双方に係数済みで処理上は無害）`);
  console.log("| lane | kind | n | mean(mid) | 区間 [lo–hi] 例 | in[950,1050]交差 | 完全内 | 外(下) | 外(上) | 比較: ビートoffset‰ |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (let L = 1; L <= 5; L++) {
    const xs = e0[L];
    if (xs.length === 0) {
      console.log(`| L${L} | - | 0 | - | - | - | - | - | - | ${fmt(obsOffsets[L - 1], 1)} |`);
      continue;
    }
    const mids = xs.map((x) => x.mid);
    const kinds = [...new Set(xs.map((x) => x.kind))].join("+");
    const inCnt = xs.filter((x) => x.inLoose).length;
    const full = xs.filter((x) => x.lo >= 950 && x.hi <= 1050).length;
    const below = xs.filter((x) => x.below).length;
    const above = xs.filter((x) => x.above).length;
    const iv = xs.map((x) => `${x.lo.toFixed(0)}–${x.hi.toFixed(0)}`).join(", ");
    console.log(
      `| L${L} | ${kinds} | ${xs.length} | ${fmt(mean(mids), 1)} | ${iv} | ${inCnt}/${xs.length} | ${full} | ${below} | ${above} | ${fmt(obsOffsets[L - 1], 1)} |`,
    );
  }
  if (e0out.length > 0) {
    console.log("out-of-range cells (区間全体が [950,1050] 外・機序差の候補):");
    for (const c of e0out) {
      console.log(`  b${c.beat} L${c.lane} ${c.kind}: implied区間 [${c.lo.toFixed(0)}, ${c.hi.toFixed(0)}] ${c.below ? "下外" : "上外"}`);
    }
  }
  console.log("");
}

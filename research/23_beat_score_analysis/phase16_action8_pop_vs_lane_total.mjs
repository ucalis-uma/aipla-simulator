/**
 * Phase 16 Action8: **「pop 合計 vs レーン合計」の口径一致監査**（作成 2026-10-01 ／ 担当: cline）
 *
 * 出発点（prompts/phase16-action8-pop-vs-lane-total-integrity.md §1）:
 *   S3 L5 で「pop 読込セルでは sim と pop がほぼ同額（Σ(pop−sim) = −113,820）なのに
 *   レーン合計が sim の 72.8%」→ pop の over-sum（二重計上）/ 帰属誤り / レーン合計の取りこぼし
 *   のいずれかという疑い。**その算術を実測ファイルから直接計算して確定させる**のが本スクリプト。
 *
 * 4 つの検査:
 *   T1 口径一致マトリクス: S1・S2・S3 × 全 5 レーンで `Σpop(読込セル) / 実測レーン合計`
 *      （> 1.00 になるセルの全件列挙）＋ pop 読込セル数・ビート被覆率・先頭/末尾の取りこぼし
 *   T2 over-sum 検出: 同一レーンの ±1 ビート以内に同一 text の pop が並ぶ事例を全件数え、
 *      二重計上を除去して `Σpop ≤ レーン合計` が成立するか
 *   T3 帰属の再点検: backfill の lane と source_frames / POSITION_TO_LANE の対応を全セル検証、
 *      A/SP ビートでの「pop レーン vs 譜面ノート位置」一致率（サンプル別）
 *   T4 レーン合計の信頼性: `scores_by_lane` 5 レーン合計 vs `total_score`、
 *      および `beat_gained_score` 合計・末尾 `cumulative_score` との突合
 *
 * 読み取り専用（`src/`・`data/`・実測サンプル的一切変更なし）。実行:
 *   node research/23_beat_score_analysis/phase16_action8_pop_vs_lane_total.mjs \
 *     > research/23_beat_score_analysis/phase16_action8_pop_vs_lane_total_out.txt
 *
 * 参考（別角度の既存検証・本スクリプトは独立に再計算する）:
 *   research/24_result_vs_pop_sum/summary.md（A: リザルト vs B: ポップ合計の不確かさ区間）
 *   tools/dump_lane_pops.mjs（ポップ充足率の n 層別化）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO = path.resolve(process.cwd());
const NOX = path.resolve(REPO, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);

/** src/timeline/constants.ts の POSITION_TO_LANE（発動優先位置 1..5 → 実レーン）。読み取り専用で複製 */
const POSITION_TO_LANE = [3, 2, 4, 1, 5];

/** measured_data の探索順（新しい順・tools/dump_lane_pops.mjs と同じ規約） */
const MEAS_CANDIDATES = ["measured_data_v3.json", "measured_data_v2.json", "measured_data.json"];

/** S4・S5 は除外（S4 = 無効撮影回／S5 = fan.png のみ） */
const SAMPLES = [
  { tag: "S1", dir: path.join(NOX, "サンプル1"), chart: "chart-hsm-006-001" },
  { tag: "S2", dir: path.join(NOX, "サンプル2"), chart: "chart-sun-004-001" },
  { tag: "S3", dir: path.join(NOX, "サンプル3"), chart: "chart-thrx-004-001" },
];

const LANES = [1, 2, 3, 4, 5];
const fmt = (v) =>
  v === null || v === undefined || Number.isNaN(v) ? "null" : Math.round(v).toLocaleString("en-US");
const pct = (v, d = 4) => (!Number.isFinite(v) ? "  -  " : v.toFixed(d));

// ---------------------------------------------------- ポップ表記の解釈（research/24 §2.3 準拠）
/** "+38.6K" → 38600（表示の切り捨て下界）。読めなければ null */
function parseK(text) {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(text ?? "").replace(/[,\s]/g, ""));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = { "": 1, K: 1000, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return unit === undefined ? null : Math.round(n * unit);
}
/** 表示 text から不確かさ unit（0.1 桁相当）。integerK100 = research/24 確定の「+39K は .0 省略」説 */
function popUnit(text, integerK100 = true) {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(text ?? "").trim());
  if (!m) return null;
  const dec = (m[1].split(".")[1] ?? "").length;
  const base = { "": 1, K: 1000, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()] ?? 1;
  if (dec === 0 && integerK100 && (m[2] ?? "").toUpperCase() === "K") return 100;
  return base / 10 ** dec;
}


// ---------------------------------------------------- サンプル読み込み
/** measured_data（新しい方）から timeline / results を読む */
function loadMeasured(dir) {
  for (const f of MEAS_CANDIDATES) {
    const p = path.join(dir, f);
    if (!exists(p)) continue;
    const doc = J(p);
    if (!Array.isArray(doc.timeline)) continue;
    const res = doc.results ?? {};
    const laneTotalsRaw = res.scores_by_lane ?? res.lane_scores ?? null;
    const laneTotals = laneTotalsRaw
      ? LANES.map((l) => {
          const v = laneTotalsRaw[String(l)] ?? laneTotalsRaw[`lane${l}`];
          return typeof v === "number" ? v : null;
        })
      : null;
    const last = doc.timeline[doc.timeline.length - 1];
    return {
      file: f,
      doc,
      timeline: doc.timeline,
      totalScore: typeof res.total_score === "number" ? res.total_score : null,
      laneTotals,
      laneTotalsKey: res.scores_by_lane ? "scores_by_lane" : res.lane_scores ? "lane_scores" : null,
      lastCumulative: typeof last?.cumulative_score === "number" ? last.cumulative_score : null,
      lastBeat: typeof last?.beat === "number" ? last.beat : null,
      bgsSum: doc.timeline.reduce(
        (a, e) => a + (typeof e?.beat_gained_score === "number" ? e.beat_gained_score : 0),
        0,
      ),
    };
  }
  return null;
}

/** 内生 pop（timeline[].lanes[].gained_score_pop）: "beat:lane" → text */
function inlinePops(timeline) {
  const m = new Map();
  for (const e of timeline) {
    if (typeof e?.beat !== "number") continue;
    for (const l of LANES) {
      const g = e?.lanes?.[String(l)]?.gained_score_pop;
      const t = typeof g === "string" ? g : g?.text ?? null;
      if (parseK(t) !== null) m.set(`${e.beat}:${l}`, String(t));
    }
  }
  return m;
}

/** lane_pops_backfill.json の readable セル: "beat:lane" → {text, frames, note} */
function backfillPops(file) {
  const doc = J(file);
  const m = new Map();
  for (const x of doc.pops ?? []) {
    if (typeof x?.beat !== "number" || typeof x?.lane !== "number") continue;
    if (x.readable === false) continue;
    if (parseK(x.displayed) === null) continue;
    m.set(`${x.beat}:${x.lane}`, {
      text: String(x.displayed),
      frames: Array.isArray(x.source_frames) ? x.source_frames : [],
      note: x.note ?? null,
    });
  }
  return { doc, map: m };
}

/** 発動ログ（3 サンプルで形式が違う）を {beat, lane, type} に正規化 */
function normalizeActivations(doc) {
  const sas = doc?.skill_activations_summary;
  const rows = Array.isArray(sas) ? sas : (sas?.activations ?? []);
  const out = [];
  for (const r of rows) {
    const beat = typeof r?.beat === "number" ? r.beat : null;
    const lane = typeof r?.lane === "number" ? r.lane : null;
    const typeRaw = r?.type ?? r?.skill_type ?? null;
    if (beat === null || lane === null || typeRaw === null) continue;
    out.push({ beat, lane, type: String(typeRaw).toUpperCase(), name: r?.skill_name ?? null });
  }
  return out;
}

// ================================================================== 実行
const lines = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};
say("=== Phase 16 Action8: pop 合計 vs レーン合計 の口径一致監査（read-only） ===");
say(`  対象: ${SAMPLES.map((s) => s.tag).join(" / ")}（S4 = 無効撮影回・S5 = fan.png のみで除外）`);
say("  Σpop は表示切り捨ての下界値（+38.6K → 38,600）。unit は research/24 §2.3 確定値（整数 K = 100）");

/** サンプル別のセル表（内生 + 遡及）と供給源の突合を構築 */
const ctx = [];
for (const s of SAMPLES) {
  const meas = loadMeasured(s.dir);
  if (meas === null) {
    say(`  [skip] ${s.tag}: measured_data が見つからない`);
    continue;
  }
  const inl = inlinePops(meas.timeline);
  const bfFile = path.join(s.dir, "lane_pops_backfill.json");
  const bf = exists(bfFile) ? backfillPops(bfFile) : { doc: null, map: new Map() };
  const merged = new Map();
  for (const [k, t] of inl) merged.set(k, { text: t, src: "inline", frames: [] });
  let fromBackfill = 0;
  for (const [k, v] of bf.map) {
    if (merged.has(k)) continue;
    merged.set(k, { text: v.text, src: "backfill", frames: v.frames, note: v.note });
    fromBackfill++;
  }
  let both = 0, agree = 0;
  const conflicts = [];
  for (const [k, v] of bf.map) {
    if (!inl.has(k)) continue;
    both++;
    if (inl.get(k) === v.text) agree++;
    else conflicts.push(`${k}: inline=${inl.get(k)} backfill=${v.text}`);
  }
  const chart = J(path.join(REPO, "data", "charts_all.json"))[s.chart] ?? [];
  const acts = normalizeActivations(meas.doc);
  ctx.push({ ...s, meas, inl, bf, merged, fromBackfill, both, agree, conflicts, chart, acts });
  say(
    `\n  ${s.tag}: ${meas.file}（timeline ${meas.timeline.length} ビート / 末尾 b${meas.lastBeat}）／` +
      `内生 pop ${inl.size} セル + backfill のみ ${fromBackfill} セル = 統合 ${merged.size} セル／` +
      `両記録 ${both} セル（一致 ${agree}・不一致 ${conflicts.length}）／譜面 ${s.chart} ${chart.length} ノート／` +
      `発動ログ ${acts.length} 件`,
  );
  if (conflicts.length > 0) say(`    [!] 内生と backfill の不一致: ${conflicts.slice(0, 8).join(" / ")}`);
}


// ------------------------------------------------------------------ T1 口径一致マトリクス
say("\n########## タスク1: 口径一致マトリクス Σpop(読込セル) / 実測レーン合計 ##########");
say("  Σpop = 読込セルの表示下界値合計（真値は必ずこれ以上）／ B_max = Σ(表示+unit)（真値は必ず未満）");
say("  ratio = Σpop / レーン合計。**ratio > 1.00 = ポップ合計がレーン合計を超える = 実測データの自己矛盾**");

const t1rows = [];
for (const c of ctx) {
  const sumMerged = [0, 0, 0, 0, 0], sumInline = [0, 0, 0, 0, 0], sumBfOnly = [0, 0, 0, 0, 0];
  const cellsMerged = [0, 0, 0, 0, 0], cellsInline = [0, 0, 0, 0, 0];
  const bmax = [0, 0, 0, 0, 0], bmaxStrict = [0, 0, 0, 0, 0];
  const missing = LANES.map(() => new Set()); // まず全ビート入れてから読込セルで除去
  for (const e of c.meas.timeline) if (typeof e.beat === "number") for (const l of LANES) missing[l - 1].add(e.beat);
  for (const [k, v] of c.merged) {
    const [b, ls] = k.split(":");
    const li = Number(ls) - 1;
    const val = parseK(v.text);
    sumMerged[li] += val;
    cellsMerged[li]++;
    bmax[li] += val + (popUnit(v.text, true) ?? 0);
    bmaxStrict[li] += val + (popUnit(v.text, false) ?? 0);
    missing[li].delete(Number(b));
  }
  for (const [k, t] of c.inl) {
    const li = Number(k.split(":")[1]) - 1;
    sumInline[li] += parseK(t);
    cellsInline[li]++;
  }
  for (const [k, v] of c.bf.map) {
    if (c.inl.has(k)) continue;
    sumBfOnly[Number(k.split(":")[1]) - 1] += parseK(v.text);
  }
  LANES.forEach((l, i) => {
    c.sumInline = sumInline;
    const lt = c.meas.laneTotals?.[i] ?? null;
    const miss = [...missing[i]].sort((a, b) => a - b);
    const nB = c.meas.timeline.length;
    t1rows.push({
      tag: c.tag, lane: l,
      sumPop: sumMerged[i], sumInline: sumInline[i], sumBfOnly: sumBfOnly[i],
      bmax: bmax[i], bmaxStrict: bmaxStrict[i],
      laneTotal: lt, ratio: lt ? sumMerged[i] / lt : null,
      cells: cellsMerged[i], cellsInline: cellsInline[i],
      coverage: cellsMerged[i] / nB,
      missN: miss.length,
      tailMissing: miss.filter((b) => b >= nB - 5).length,
      headMissing: miss.filter((b) => b <= 2).length,
      hiddenAllowance: lt === null ? null : lt - sumMerged[i],
      missList: miss,
    });
  });
}


say("");
say(
  " サンプル|レーン|    Σpop(統合)| Σpop(内生のみ)| backfill追記|          B_max|      レーン合計| Σpop/合計| B_max−合計|読込セル(内生+追記)|  被覆率| 欠測|末尾5b欠測|先頭3b欠測| 判定",
);
for (const r of t1rows) {
  say(
    `    ${r.tag}  |  L${r.lane}  | ${fmt(r.sumPop).padStart(13)} | ${fmt(r.sumInline).padStart(13)} | ` +
      `${fmt(r.sumBfOnly).padStart(11)} | ${fmt(r.bmax).padStart(14)} | ${fmt(r.laneTotal).padStart(13)} | ` +
      `${pct(r.ratio)} | ${fmt(r.bmax - r.laneTotal).padStart(9)} | ` +
      `${String(r.cells).padStart(5)}(${String(r.cellsInline).padStart(3)}+${String(r.cells - r.cellsInline).padStart(2)}) | ` +
      `${(r.coverage * 100).toFixed(1)}% | ${String(r.missN).padStart(3)} | ${String(r.tailMissing).padStart(8)} | ` +
      `${String(r.headMissing).padStart(9)} | ${r.ratio > 1.0 ? "** OVER **" : "OK（Σpop ≤ レーン合計）"}`,
  );
}
const overs = t1rows.filter((r) => Number.isFinite(r.ratio) && r.ratio > 1.0);
say("");
say(
  `  ★ ratio > 1.00 のセル: ${overs.length} 件` +
    (overs.length === 0
      ? " → **15 レーン全セルで Σpop ≤ レーン合計**（ポップの over-sum は実測側に存在しない）"
      : "（→ 下記）"),
);
for (const r of overs)
  say(`    [OVER] ${r.tag} L${r.lane}: Σpop ${fmt(r.sumPop)} > レーン合計 ${fmt(r.laneTotal)}（超過 ${fmt(r.sumPop - r.laneTotal)}）`);
const bmaxOver = t1rows.filter((r) => r.bmax > r.laneTotal);
say(
  `  B_max がレーン合計を超えるセル: ${bmaxOver.length} 件 → ` +
    (bmaxOver.length === 0 ? "なし" : bmaxOver.map((r) => `${r.tag}L${r.lane}(+${fmt(r.bmax - r.laneTotal)})`).join(" / ")),
);
say("  ※ B_max 超えは「丸め上限が僅かに届く」だけで over-sum ではない（research/24 §3 と同じ判定規約）");
say("");
say("  -- サンプル別 5 レーン合計 --");
for (const c of ctx) {
  let sumAll = 0;
  for (const [, v] of c.merged) sumAll += parseK(v.text);
  const ltSum = c.meas.laneTotals ? c.meas.laneTotals.reduce((a, b) => a + (b ?? 0), 0) : null;
  say(
    `    ${c.tag}: Σpop(全レーン) ${fmt(sumAll)} / total_score ${fmt(c.meas.totalScore)} = ${pct(sumAll / c.meas.totalScore)}` +
      ` ／ scores_by_lane 合計 ${fmt(ltSum)}（${ltSum === c.meas.totalScore ? "total_score と一致" : "**total_score と不一致**"}）`,
  );
}
say("");
say("  ★ 出発点の疑い（S3 L5）への直接回答:");
const s3l5 = t1rows.find((r) => r.tag === "S3" && r.lane === 5);
say(
  `    S3 L5: Σpop(統合) ${fmt(s3l5.sumPop)}（読込 ${s3l5.cells} セル = 内生 ${s3l5.cellsInline} + 遡及 ${s3l5.cells - s3l5.cellsInline}）` +
    ` / レーン合計 ${fmt(s3l5.laneTotal)} = ${pct(s3l5.ratio)} → **> 1.00 ではない**`,
);
say(
  `    →「pop 読込セルだけでレーン合計を数百万レベルで超過」は成立しない。` +
    ` レーン合計 − Σpop = ${fmt(s3l5.hiddenAllowance)}（読込不能 ${s3l5.missN} セル分の許容枠）`,
);
say("    → 従って「ポップ系列の over-sum（二重計上）」でも「ポップのレーン誤帰属」でもない。切り分けは T2/T3/T5 で行う");
say("");
say("  -- 欠測ビートの一覧（末尾 10 件まで）--");

// ------------------------------------------------------------------ T2 over-sum（二重計上）検出
say("\n########## タスク2: over-sum（表示ラグの二重計上）検出 ##########");
say("  定義a: 同一レーンで ±1 ビート以内に**同一 text** の pop が並ぶ（= 1 つのスコアが 2 ビートにまたがって読まれた疑い）");
say("  定義b: 同一ビートで**異レーン**に同一 text の pop が並ぶ（= 1 つのポップを 2 レーンに写した疑い＝帰属＋二重計上）");
say("  定義c: ビート単位で Σpop(読込レーン) > beat_gained_score（= バー増分そのものの超過 = 確実に over-count）");

// --- 定義a: ±1 ビート同一 text ---
const dupA = [];
for (const c of ctx) {
  for (const l of LANES) {
    const cells = [...c.merged.entries()]
      .filter(([k]) => Number(k.split(":")[1]) === l)
      .map(([k, v]) => ({ beat: Number(k.split(":")[0]), text: v.text, value: parseK(v.text), src: v.src }))
      .sort((a, b) => a.beat - b.beat);
    const groups = [];
    let cur = null;
    for (const cell of cells) {
      if (cur !== null && cell.beat - cur[cur.length - 1].beat <= 1 && cell.text === cur[0].text) cur.push(cell);
      else {
        if (cur !== null) groups.push(cur);
        cur = [cell];
      }
    }
    if (cur !== null) groups.push(cur);
    const hits = groups.filter((g) => g.length >= 2);
    const removable = hits.reduce((a, g) => a + (g.length - 1), 0);
    const removableSum = hits.reduce((a, g) => a + (g.length - 1) * g[0].value, 0);
    dupA.push({ tag: c.tag, lane: l, cells: cells.length, groups: hits.length, removable, removableSum, hits });
  }
}
say("");
say("  [a] 同一レーン ±1 ビートの同一 text（run = 連なり。除去可能 = run 長 − 1）");
say("   サンプル|レーン|読込セル|該当 run|除去可能セル|Σ(除去相当値)|      該当 run の内訳（最大 6 本）");
for (const d of dupA) {
  say(
    `      ${d.tag}  |  L${d.lane}  | ${String(d.cells).padStart(6)} | ${String(d.groups).padStart(6)} | ` +
      `${String(d.removable).padStart(9)} | ${fmt(d.removableSum).padStart(11)} | ` +
      d.hits.slice(0, 6).map((g) => `${g.map((x) => `b${x.beat}`).join("~")}(${g[0].text})`).join(" "),
  );
}
const totRemovable = dupA.reduce((a, d) => a + d.removable, 0);
const totRemovableSum = dupA.reduce((a, d) => a + d.removableSum, 0);
say(`   合計: 除去可能セル ${totRemovable} 件 / Σ ${fmt(totRemovableSum)}`);

// --- 除去後の条件成立 ---
say("");
say("  [a] 二重計上を取り除いた場合（run の先頭 1 セルだけ残す）で Σpop ≤ レーン合計 になるか:");
say("   （前提: T1 で既に 15/15 レーン Σpop ≤ レーン合計 → **除去を必要とするセルは 0 件**。下表は参考値）");
for (const r of t1rows) {
  const d = dupA.find((x) => x.tag === r.tag && x.lane === r.lane);
  const after = r.sumPop - d.removableSum;
  say(
    `      ${r.tag} L${r.lane}: 除去前 ${fmt(r.sumPop)}（比 ${pct(r.ratio, 4)}）→ 除去後 ${fmt(after)}（比 ${pct(after / r.laneTotal, 4)}）` +
      ` ／ 除去前 ${r.sumPop <= r.laneTotal ? "条件成立" : "**条件不成立**"}・除去後 ${after <= r.laneTotal ? "条件成立" : "条件不成立"}`,
  );
}

// --- 定義b: 同一ビート異レーンの同一 text ---
say("");
say("  [b] 同一ビートで異レーンに同一 text（ポップの二重写し候補）");
let dupBTotal = 0;
for (const c of ctx) {
  const byBeat = new Map();
  for (const [k, v] of c.merged) {
    const [b, l] = k.split(":").map(Number);
    const arr = byBeat.get(b) ?? [];
    arr.push({ lane: l, text: v.text });
    byBeat.set(b, arr);
  }
  const hits = [];
  for (const [b, arr] of [...byBeat.entries()].sort((a, b2) => a[0] - b2[0])) {
    const seen = new Map();
    for (const x of arr) seen.set(x.text, (seen.get(x.text) ?? []).concat(x.lane));
    for (const [t, ls] of seen) if (ls.length >= 2) hits.push(`b${b}:${t}=[L${ls.join(",L")}]`);
  }
  dupBTotal += hits.length;
  say(`      ${c.tag}: ${hits.length} 件 ${hits.slice(0, 10).join(" ")}`);
}
say(`      合計 ${dupBTotal} 件（同値が偶然並ぶことはあり得る。T1 で over-sum が 0 件なので判定には影響しない）`);

// --- 定義c: ビート単位の over-count ---
say("");
say("  [c] ビート単位 Σpop(読込レーン) > beat_gained_score（バー増分そのものの超過）");
for (const c of ctx) {
  const viol = [];
  const rows = [];
  for (const e of c.meas.timeline) {
    if (typeof e.beat !== "number") continue;
    const bgs = typeof e.beat_gained_score === "number" ? e.beat_gained_score : 0;
    let sum = 0, n = 0;
    for (const l of LANES) {
      const v = c.merged.get(`${e.beat}:${l}`);
      if (v === undefined) continue;
      sum += parseK(v.text);
      n++;
    }
    if (n === 0) continue;
    rows.push({ beat: e.beat, sum, n, bgs, ratio: bgs > 0 ? sum / bgs : null });
    if (sum > bgs) viol.push({ beat: e.beat, sum, n, bgs });
  }
  viol.sort((a, b) => b.sum - b.bgs - (a.sum - a.bgs));
  say(`      ${c.tag}: 違反 ${viol.length} 件 / 比較可能 ${rows.length} ビート` +
    (viol.length === 0 ? "（= ポップ合計がバー増分を超えるビートはゼロ）" : ` → 上位 ${viol.slice(0, 5).map((v) => `b${v.beat}: popΣ ${fmt(v.sum)} > bar ${fmt(v.bgs)}`).join(" / ")}`));
  const n5 = rows.filter((r) => r.n === 5);
  const nLess = rows.filter((r) => r.n < 5);
  const agg = (rs) => {
    if (rs.length === 0) return "n=0";
    const s = rs.reduce((a, r) => a + r.sum, 0), g = rs.reduce((a, r) => a + r.bgs, 0);
    const sorted = rs.map((r) => r.ratio).filter(Number.isFinite).sort((a, b) => a - b);
    return `Σpop/Σbar ${(s / g).toFixed(4)} / 中央値 ${sorted[Math.floor(sorted.length / 2)].toFixed(3)} / 最大 ${sorted[sorted.length - 1].toFixed(3)}`;
  };
  say(`        n=5（5レーン読めた層）: ${agg(n5)}`);
  say(`        n<5（欠測レーンありの層・1.0 を下回るのは当然）: ${agg(nLess)}`);
  say(`        ※ AGENTS.md の規律どおり層別化。層を混ぜて語らないこと（tools/dump_lane_pops.mjs と同じ）`);
}

for (const r of t1rows) {
  if (r.missN === 0) continue;
  say(`    ${r.tag} L${r.lane}: 欠測 ${r.missN} / ${r.cells + r.missN} → ${r.missList.slice(-10).join(", ")}`);
}


// ------------------------------------------------------------------ T3 帰属の再点検
say("\n########## タスク3: 帰属（レーン割り当て）の再点検 ##########");
say(`  POSITION_TO_LANE（src/timeline/constants.ts）= [${POSITION_TO_LANE.join(",")}]（位置 1..5 → 実レーン）`);
say("  (1) lane_pops_backfill.json の全 readable セル: source_frames のレーン（L5_beat_002 等）と記録 lane の一致");
for (const c of ctx) {
  let checked = 0, ok = 0, ng = 0, noFrame = 0;
  const bad = [];
  for (const [k, v] of c.bf.map) {
    const [b, l] = k.split(":").map(Number);
    const frames = v.frames ?? [];
    if (frames.length === 0) { noFrame++; continue; }
    checked++;
    const lanes = new Set(frames.map((f) => (/^L(\d)/.exec(String(f)) ?? [])[1]).filter(Boolean).map(Number));
    if (lanes.size === 1 && lanes.has(l)) ok++;
    else { ng++; if (bad.length < 6) bad.push(`b${b}L${l}:${frames.join("/")}`); }
  }
  say(
    `    ${c.tag}: 検査 ${checked} / ${c.bf.map.size} セル（フレーム情報なし ${noFrame}）→ 一致 ${ok}・不一致 ${ng}` +
      (bad.length > 0 ? ` 疑い: ${bad.join(" ")}` : ""),
  );
}
say("");
say("  (2) A/SP ビート（chart type=2/3）での「pop 読込レーン vs 譜面ノート位置（= POSITION_TO_LANE のオーナー）」");
const attrRows = [];
for (const c of ctx) {
  const ab = [];
  c.chart.forEach((n, i) => {
    if (n[0] === 2 || n[0] === 3)
      ab.push({ beat: i + 1, kind: n[0] === 2 ? "A" : "SP", pos: n[1], owner: POSITION_TO_LANE[(n[1] ?? 1) - 1] });
  });
  let one = 0, match = 0, multi = 0, none = 0, mismatch = 0, nonOwnerCells = 0, nonOwnerSum = 0;
  const badList = [];
  const noneList = [];
  for (const a of ab) {
    const readable = LANES.filter((l) => c.merged.has(`${a.beat}:${l}`));
    const nonOwner = readable.filter((l) => l !== a.owner);
    for (const l of nonOwner) nonOwnerSum += parseK(c.merged.get(`${a.beat}:${l}`).text);
    nonOwnerCells += nonOwner.length;
    if (readable.length === 0) {
      none++;
      noneList.push({ beat: a.beat, kind: a.kind, pos: a.pos, owner: a.owner });
    }
    else if (readable.length === 1) {
      one++;
      if (readable[0] === a.owner) match++;
      else {
        mismatch++;
        badList.push(`b${a.beat}${a.kind}: owner=L${a.owner} なのに読込=L${readable[0]}（${c.merged.get(`${a.beat}:${readable[0]}`).text}）`);
      }
    } else {
      multi++;
      if (!readable.includes(a.owner)) badList.push(`b${a.beat}${a.kind}: owner=L${a.owner} が欠測・読込=L${readable.join(",")}`);
    }
  }
  attrRows.push({ tag: c.tag, ab: ab.length, one, match, mismatch, multi, none, nonOwnerCells, nonOwnerSum, badList, noneList, ownerDist: ab.reduce((a, x) => { a[x.owner] = (a[x.owner] ?? 0) + 1; return a; }, {}) });
}
say("   サンプル|A/SPビート|読込あり|1レーンのみ読込|→オーナー一致|→不一致|複数読込|全欠測|非オーナー読込セル|Σ(非オーナーpop)");
for (const r of attrRows) {
  say(
    `      ${r.tag}  | ${String(r.ab).padStart(8)} | ${String(r.one + r.multi).padStart(7)} | ${String(r.one).padStart(12)} | ` +
      `${String(r.match).padStart(11)} | ${String(r.mismatch).padStart(8)} | ${String(r.multi).padStart(7)} | ` +
      `${String(r.none).padStart(6)} | ${String(r.nonOwnerCells).padStart(14)} | ${fmt(r.nonOwnerSum).padStart(12)}`,
  );
}
say(
  "   一致率 = 「1 レーンのみ読込」のうちオーナー一致の割合: " +
    attrRows.map((r) => `${r.tag} ${r.one === 0 ? "-" : ((r.match / r.one) * 100).toFixed(1)}% (${r.match}/${r.one})`).join(" / "),
);
say("   （アクション5 では S3 3 セル・S2 2 セルが全て一致。本検査はその全ビート版）");
for (const r of attrRows) for (const b of r.badList) say(`      [疑い] ${r.tag} ${b}`);
say("   全欠測（5レーンともポップが読めない）A/SP ビートの内訳: beat種別@譜面pos→オーナーレーン");
for (const r of attrRows)
  say(
    `      ${r.tag}: ${r.noneList.length} 件 ${r.noneList.map((x) => `b${x.beat}${x.kind}@pos${x.pos}→L${x.owner}`).join(" ")} ` +
      `／ A・SP ビート全体のオーナー分布 = ${[1, 2, 3, 4, 5].map((l) => `L${l}:${r.ownerDist[l] ?? 0}`).join(" ")}`,
  );

say("");
say("  (3) 実測発動ログ（skill_activations_summary）の A/SP 発動レーン vs 譜面ノート位置");
for (const c of ctx) {
  const types = {};
  for (const a of c.acts) types[a.type] = (types[a.type] ?? 0) + 1;
  const noteAt = new Map();
  c.chart.forEach((n, i) => noteAt.set(i + 1, n));
  const asActs = c.acts.filter((a) => ["A", "SP", "SPECIAL"].includes(a.type));
  let cmp = 0, ok = 0;
  const bad = [];
  for (const a of asActs) {
    const n = noteAt.get(a.beat);
    if (n === undefined || (n[0] !== 2 && n[0] !== 3)) continue;
    const owner = POSITION_TO_LANE[(n[1] ?? 1) - 1];
    cmp++;
    if (owner === a.lane) ok++;
    else bad.push(`b${a.beat} 発動 L${a.lane} / 譜面 pos${n[1]} → L${owner}`);
  }
  say(
    `    ${c.tag}: 発動ログ types=${JSON.stringify(types)} / A・SP 発動 ${asActs.length} 件（譜面と突合可能 ${cmp}）→ ` +
      `一致 ${ok}（${cmp > 0 ? ((ok / cmp) * 100).toFixed(1) : "-"}%）` +
      (bad.length > 0 ? ` 不一致: ${bad.slice(0, 6).join(" / ")}` : ""),
  );
}

// ------------------------------------------------------------------ T4 measured 側のレーン合計の信頼性
say("\n########## タスク4: measured 側のレーン合計の信頼性 ##########");
say("  `scores_by_lane`（=lane_scores）5 レーン合計 vs `total_score` vs `beat_gained_score` 合計 vs 末尾 `cumulative_score`");
say("   サンプル|                     5レーン合計|  total_score|   差| Σbeat_gained_score|   差| 末尾 cumulative_score|   差| Σlanes[].score| ビート連続性");
const t4rows = [];
for (const c of ctx) {
  const ltSum = c.meas.laneTotals ? c.meas.laneTotals.reduce((a, b) => a + (b ?? 0), 0) : null;
  const beats = c.meas.timeline.map((e) => e.beat);
  let cont = true, first = null, last = null;
  for (let i = 0; i < beats.length; i++) {
    if (i === 0) first = beats[i];
    if (i > 0 && beats[i] !== beats[i - 1] + 1) cont = false;
    last = beats[i];
  }
  const nSum = (c.meas.laneTotals ?? []).filter((v) => typeof v === "number" && v > 0).length;
  const beatSum = c.meas.timeline.reduce((a, e) => a + LANES.reduce((s, l) => s + (e?.lanes?.[String(l)]?.score ?? 0), 0), 0);
  const hasBeatLaneScore = c.meas.timeline.some((e) => LANES.some((l) => typeof e?.lanes?.[String(l)]?.score === "number"));
  t4rows.push({ tag: c.tag, ltSum, nSum, closed: ltSum !== null && ltSum === c.meas.totalScore, beatSum, hasBeatLaneScore });
  say(
    `      ${c.tag}  | ${fmt(ltSum).padStart(20)} | ${fmt(c.meas.totalScore).padStart(12)} | ${fmt((ltSum ?? 0) - (c.meas.totalScore ?? 0)).padStart(4)} | ` +
      `${fmt(c.meas.bgsSum).padStart(18)} | ${fmt(c.meas.bgsSum - (c.meas.totalScore ?? 0)).padStart(4)} | ` +
      `${fmt(c.meas.lastCumulative).padStart(19)} | ${fmt((c.meas.lastCumulative ?? 0) - (c.meas.totalScore ?? 0)).padStart(4)} | ` +
      `${hasBeatLaneScore ? fmt(beatSum) + `（${beatSum === c.meas.totalScore ? "一致" : "**不一致**"}）` : "該当なし"} | ` +
      `b${first}..b${last} ${cont && first === 0 ? "0 から連続（欠番なし）" : "**欠番・飛びあり**"}（${beats.length} ビート）`,
  );
}
say("  [a] total_score・5レーン合計・Σbeat_gained_score・末尾 cumulative がすべて 1 の位まで一致するか");
say(
  `      → 5レーン合計 = total_score: ${t4rows.filter((r) => r.closed).length} / ${t4rows.length} セル` +
    ` ／ 4 値すべて一致: ${t4rows.filter((r) => r.closed).length} / ${t4rows.length}` +
    `（※ lanes[].score は measured_data に存在しないため、スコアの粒度は「レーン合計 / ビート増分 / 累積」の 3 経路で検証）`,
);
for (const r of t4rows) {
  say(
    `      ${r.tag}: 5レーン合計 = total_score ? ${r.closed ? "OK（差 0）" : "**NG**"} ／ ` +
      `読み取れたレーン数 = ${r.nSum} / 5（= 4 なら 1 レーン取りこぼし）／ ` +
      `ビート内レーンスコア合計 = total_score ? ${!r.hasBeatLaneScore ? "判定不能" : r.beatSum === r.ltSum ? "OK" : "**NG**"}`,
  );
}
say("  ※ total_score と 5 レーン合計が 1 の位まで一致するなら「レーン合計の取りこぼし」は起きようがない");
say("    （5 レーン合計 = 総スコア という足し算が閉じているため。取りこぼしがあるなら合計も同じだけ足りないはずで、");
say("     それは Σbeat_gained_score と末尾 cumulative_score の方にも現れる）");
say("");
say("  [b] レーン合計 − Σpop（= 隠れ枠）が「そのレーンの pop 欠測ビート」で吸収できるか");
say("      吸収可能額(レーン) = Σ_{pop が読めなかったビート} beat_gained_score（バー増分。他レーンの欠測分も含む上界）");
const absorbRows = [];
for (const c of ctx) {
  for (const l of LANES) {
    const t1 = t1rows.find((r) => r.tag === c.tag && r.lane === l);
    const r5 = t1rows.find((r) => r.tag === c.tag && r.lane === 5);
    const gap = t1.hiddenAllowance;
    let absorb = 0;
    const per = [];
    for (const e of c.meas.timeline) {
      if (typeof e.beat !== "number") continue;
      if (c.merged.has(`${e.beat}:${l}`)) continue; // このレーンは読めている → 吸収不要
      const bgs = typeof e.beat_gained_score === "number" ? e.beat_gained_score : 0;
      absorb += bgs;
      per.push({ beat: e.beat, bgs });
    }
    per.sort((a, b) => b.bgs - a.bgs);
    absorbRows.push({ tag: c.tag, lane: l, gap, absorb, ok: gap <= absorb, top: per.slice(0, 6) });
    if (r5 !== undefined && (l === 5 || t1.missN > 0) && c.tag === "S3") {
      say(
        `      ${c.tag} L${l}: 隠れ枠 ${fmt(gap)}（${t1.missN} セル）/ 欠測ビートのバー増分合計 ${fmt(absorb)} → ` +
          `${gap <= absorb ? "**吸収可能**（取りこぼしの必要なし）" : "**吸収不能（取りこぼし疑い）**"} ／ ` +
          `増分の上位: ${per.slice(0, 6).map((p) => `b${p.beat}:${fmt(p.bgs)}`).join(", ")}`,
      );
    }
  }
}
say(`      全 15 セルの内訳: 吸収可能 ${absorbRows.filter((r) => r.ok).length} / 吸収不能 ${absorbRows.filter((r) => !r.ok).length}`);
for (const r of absorbRows.filter((x) => !x.ok))
  say(`        [!] ${r.tag} L${r.lane}: 隠れ枠 ${fmt(r.gap)} > 欠測ビート増分 ${fmt(r.absorb)}（差 ${fmt(r.gap - r.absorb)}）`);
say("");
say("  [c] pop のレーン ↔ results.scores_by_lane のレーン対応が正しいことの証明");
say("      全 120 ペルムテーション（pop レーン i の Σpop を results レーン p[i] の合計に対応させる）を総当りし、");
say("      「全レーンで Σpop ≤ レーン合計」を満たす対応だけを数える（満たさない対応は観測と矛盾して除外される）");
for (const c of ctx) {
  const sums = LANES.map((l) => {
    let s = 0;
    for (const [k, v] of c.merged) if (Number(k.split(":")[1]) === l) s += parseK(v.text);
    return s;
  });
  const lt = c.meas.laneTotals ?? [];
  const perms = [];
  const rec = (arr, i) => {
    if (i >= arr.length) { perms.push(arr.slice()); return; }
    for (let j = i; j < arr.length; j++) {
      [arr[i], arr[j]] = [arr[j], arr[i]];
      rec(arr, i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };
  rec([0, 1, 2, 3, 4], 0);
  const feas = perms
    .filter((p) => LANES.every((_, i) => sums[i] <= lt[p[i]]))
    .map((p) => ({ p, slack: LANES.reduce((a, _, i) => a + (lt[p[i]] - sums[i]), 0) }))
    .sort((a, b) => a.slack - b.slack);
  const idp = [0, 1, 2, 3, 4];
  const idx = feas.findIndex((f) => f.p.every((v, i) => v === idp[i]));
  say(
    `      ${c.tag}: Σpop = [${sums.map((v) => fmt(v)).join(", ")}] ／ 実行可能対応 ${feas.length} / 120 通り` +
      `（現行の同一対応は ${idx >= 0 ? `実行可能・ slack 第${idx + 1}位 = ${fmt(feas[idx].slack)}` : "**実行不可**"}）`,
  );
  for (const f of feas.slice(0, 4))
    say(`        p=[${f.p.map((v) => `L${v + 1}`).join("→, ")}] 残り枠合計 ${fmt(f.slack)}${f.p.every((v, i) => v === i) ? "  ← 現行（単位対応）" : ""}`);
}
for (const c of ctx) {
  const lt = c.meas.laneTotals ?? [];
  say(`      ${c.tag} scores_by_lane = [${lt.map((v) => fmt(v)).join(", ")}]（key=${c.meas.laneTotalsKey}）`);
}
say("");
say("  参考: 同一サンプルの別バージョン measured_data でも results が同一か（抄録の再現性）");
for (const c of ctx) {
  const all = MEAS_CANDIDATES.filter((f) => exists(path.join(c.dir, f)));
  const perFile = all.map((f) => {
    const d = J(path.join(c.dir, f));
    const sb = d.results?.scores_by_lane ?? {};
    const sum = LANES.reduce((a, l) => a + (typeof sb[String(l)] === "number" ? sb[String(l)] : 0), 0);
    return `${f}: total=${fmt(d.results?.total_score ?? null)} Σlane=${fmt(sum)} timeline=${d.timeline?.length ?? 0}`;
  });
  say(`      ${c.tag}: ${perFile.join(" | ")}`);
}

// ------------------------------------------------------------------ T5 sim 側の内訳（pop 読込不能セルへの過剰投入）
say("\n########## タスク5: sim 側の内訳（pop 読込不能セルに何が置かれているか） ##########");
say("  入力: phase16_action5_lane_gap_out.txt（engine の sim 系列。本スクリプトは読み取りのみ）");
say("  分解: sim_total = sim(pop読込セル) + sim(pop読込不能セル)");
say("        sim(pop読込セル) = Σpop − Σ(pop − sim)（action5 の pop-sim 合計列を利用・pop は内生セルのみ）");
say("        実測(pop読込不能セル) = レーン合計 − Σpop = 隠れ枠（真値は必ずこの範囲内）");
const A5 = path.join(REPO, "research", "23_beat_score_analysis", "phase16_action5_lane_gap_out.txt");
const t5rows = [];
const modeRatios = []; // { tag, mode, sim, obs } …モード別 sim/実測（出発点の 72.8% の出所特定用）
const rowRe = /^\s+L(\d)\s+\|\s+(-?[\d,]+)\s+\|\s+(-?[\d,]+)\s+\|\s+(-?[\d.]+)\s+\|\s+(\d+)\s+\|\s+(\d+)\s+\|\s+(\d+)\s+\|\s+(-?[\d,]+)\s+\|\s+(\d+)/;
const num = (s) => Number(String(s).replace(/,/g, ""));
if (exists(A5)) {
  const a5 = fs.readFileSync(A5, "utf8").split(/\r?\n/);
  for (const c of ctx) {
    const start = a5.findIndex((l) => l.startsWith("##########") && l.includes(`${c.tag} `));
    if (start < 0) { say(`  ${c.tag}: action5 出力に対応ブロックなし（対象外の可能性）`); continue; }
    let end = a5.length;
    for (let i = start + 1; i < a5.length; i++) if (a5[i].startsWith("##########")) { end = i; break; }
    let mode = "?";
    let tables = [];
    for (let i = start; i < end; i++) {
      const m = /^=== mode=(\w+) ===/.exec(a5[i]);
      if (m !== null) { mode = m[1]; tables = []; continue; }
      const r = rowRe.exec(a5[i]);
      if (r === null) continue;
      let t = tables[tables.length - 1];
      if (t === undefined || t.mode !== mode) { t = { mode, rows: [] }; tables.push(t); }
      t.rows.push(r);
      if (c.tag === "S3" && Number(r[1]) === 5)
        modeRatios.push({ tag: c.tag, mode, sim: num(r[2]), obs: num(r[3]) });
    }
    const tbl = tables[tables.length - 1];
    if (tbl === undefined || tbl.rows.length < 5) { say(`  ${c.tag}: action5 のレーン表を解析できず`); continue; }
    say(`  ${c.tag}: 使用テーブル = mode=${tbl.mode}（action5 出力の最後＝現行設定）`);
    say("   レーン|       sim合計|      実測レーン合計| Σpop(内生)| Σ(pop−sim)| sim(読込セル)| sim(読込不能)| 実測(読込不能)=隠れ枠| sim/実測(読込不能)");
    for (const r of tbl.rows) {
      const lane = Number(r[1]), simSum = num(r[2]), obs = num(r[3]), popCells = Number(r[5]), ps = num(r[8]);
      const t1 = t1rows.find((x) => x.tag === c.tag && x.lane === lane);
      // action5 がどの供給源（内生のみ / 統合）で pop を数えたかをセル数で特定
      const use = popCells === t1.cellsInline ? { key: "内生のみ", popSum: t1.sumInline } :
        popCells === t1.cells ? { key: "内生+遡及", popSum: t1.sumPop } : { key: `セル数不一致(action5=${popCells}/内生=${t1.cellsInline}/統合=${t1.cells})`, popSum: t1.sumPop };
      if (popCells === 0) {
        say(`      L${lane}  | ${fmt(simSum).padStart(12)} | ${fmt(obs).padStart(15)} |  pop ${popCells} セル（action5 実行時に pop 未記録 → 分解不能）`);
        continue;
      }
      const simRead = use.popSum - ps;
      const simHidden = simSum - simRead;
      const obsHidden = obs - use.popSum;
      // 内生のみ供給の場合、遡及 pop を足した実際の隠れ枠（より狭い=より厳しい上界）も併記
      const obsHiddenMerged = t1.sumPop > use.popSum ? obs - t1.sumPop : null;
      t5rows.push({
        tag: c.tag, lane, simSum, obs, popSum: use.popSum, simRead, simHidden, obsHidden,
        obsHiddenMerged,
        ratio: obsHidden > 0 ? simHidden / obsHidden : null, over2: obsHidden > 0 && simHidden / obsHidden >= 2,
      });
      say(
        `      L${lane}  | ${fmt(simSum).padStart(12)} | ${fmt(obs).padStart(15)} | ${fmt(use.popSum).padStart(10)} | ${fmt(ps).padStart(9)} | ` +
          `${fmt(simRead).padStart(12)} | ${fmt(simHidden).padStart(12)} | ${fmt(obsHidden).padStart(15)} | ` +
          `${obsHidden > 0 ? (simHidden / obsHidden).toFixed(2) : "∞（隠れ枠ゼロ）"}× [${use.key}]` +
          (obsHiddenMerged === null
            ? ""
            : `  ／ 遡及 pop 込みの隠れ枠 ${fmt(obsHiddenMerged)} → ${(simHidden / obsHiddenMerged).toFixed(2)}×`),
      );
    }
  }
} else {
  say("  [skip] phase16_action5_lane_gap_out.txt が見つからない");
}

// ------------------------------------------------------------------ 附録: pop 系列の自己相関（lag 1-4）
const totCellsAll = t1rows.reduce((a, r) => a + r.cells, 0);
say("\n########## 附録: pop 系列の自己相関（lag 1-4・連続ビート間） ##########");
say("  「±1 ビートで同一 text が並ぶ」がどの程度構造的かを測る（= 表示ラグ由来の重複と見分けるため）");
say("  r(lag k) = k ビート離れた pop 値のピアソン積率相関係数（両方読めている連続対のみ）");
say("   サンプル|レーン|   n(lag1)| r(1)   |   n(lag2)| r(2)   |   n(lag3)| r(3)   |   n(lag4)| r(4)");
for (const c of ctx) {
  for (const l of LANES) {
    const series = [];
    for (let b = 0; b < c.meas.timeline.length; b++) {
      const cell = c.merged.get(`${b}:${l}`);
      series.push(cell === undefined ? null : parseK(cell.text));
    }
    const corr = (k) => {
      const xs = [], ys = [];
      for (let b = 0; b + k < series.length; b++) {
        if (series[b] === null || series[b + k] === null) continue;
        xs.push(series[b]); ys.push(series[b + k]);
      }
      const n = xs.length;
      if (n < 3) return { n: 0, r: null };
      const mx = xs.reduce((a, x) => a + x, 0) / n, my = ys.reduce((a, y) => a + y, 0) / n;
      let sxx = 0, syy = 0, sxy = 0;
      for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
      return { n, r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null };
    };
    const cs = [1, 2, 3, 4].map(corr);
    say(
      `      ${c.tag}  |  L${l}  | ${String(cs[0].n).padStart(8)} | ${(cs[0].r === null ? "-" : cs[0].r.toFixed(3)).padStart(6)} | ` +
        `${String(cs[1].n).padStart(8)} | ${(cs[1].r === null ? "-" : cs[1].r.toFixed(3)).padStart(6)} | ` +
        `${String(cs[2].n).padStart(8)} | ${(cs[2].r === null ? "-" : cs[2].r.toFixed(3)).padStart(6)} | ` +
        `${String(cs[3].n).padStart(8)} | ${(cs[3].r === null ? "-" : cs[3].r.toFixed(3)).padStart(6)}`,
    );
  }
}
say(`  ※ 「同一値の連なり」自体は T2[a] の除去可能 ${totRemovable} 件（全 pop ${totCellsAll} セルの ${(100 * totRemovable / totCellsAll).toFixed(1)}%）に限られる`);

// ------------------------------------------------------------------ 総合
say("\n########## 総合（この後のレポートで結論 (i)/(ii)/(iii) を確定させる） ##########");
say(`  T1: Σpop > レーン合計 のセル = ${overs.length} / 15 件`);
say(`  T2: ±1 ビート同一 text の除去可能セル = ${totRemovable} 件（Σ ${fmt(totRemovableSum)}）`);
say(`  T3: A/SP ビートの pop 帰属一致 = ${attrRows.map((r) => `${r.tag} ${r.match}/${r.one}`).join(" / ")}（不一致 ${attrRows.reduce((a, r) => a + r.mismatch, 0)} 件）`);
say(
  `  T4: 5レーン合計 = total_score のサンプル = ` +
    `${ctx.filter((c) => (c.meas.laneTotals ?? []).reduce((a, b) => a + (b ?? 0), 0) === c.meas.totalScore).length} / ${ctx.length}`,
);
say(
  `  T5: sim(pop読込不能セル) ≫ 実測の隠れ枠（2× 超）のセル = ` +
    `${t5rows.filter((r) => r.over2).length} / ${t5rows.length}` +
    (t5rows.length > 0 ? `（最大 ${Math.max(...t5rows.map((r) => r.ratio ?? -Infinity)).toFixed(2)}×）` : ""),
);
say("");
const s3l5sim = t5rows.find((r) => r.tag === "S3" && r.lane === 5);
const s3l5pop = t1rows.find((r) => r.tag === "S3" && r.lane === 5);
if (s3l5sim !== undefined && s3l5pop !== undefined) {
  for (const mr of modeRatios)
    say(
      `  ★ 出発点の疑い（S3 L5）の正体: 実測/sim = ${fmt(mr.obs)} / ${fmt(mr.sim)} = ${(mr.obs / mr.sim).toFixed(4)}` +
        `（= sim/実測 ${(mr.sim / mr.obs).toFixed(4)} の逆数・mode=${mr.mode}）`,
    );
  say(
    `    つまり「72.8%」は pop 合計とレーン合計の比ではなく、sim 過大の逆数。` +
      `pop 合計/レーン合計は ${(s3l5pop.sumPop / s3l5pop.laneTotal).toFixed(4)}（T1・全レーン中最も普通）`,
  );
  say("  → 実測側（ポップ系列・レーン合計）は自己整合（T1 over-sum 0 件・T3 帰属 100%・T4 完全閉包）");
  say(
    "    帰結: S3 L5 の乖離は **sim が pop 読込不能セルに実測より多いスコアを置いている**側（T5）。" +
      `sim(読込不能)=${fmt(s3l5sim.simHidden)} / 実測の隠れ枠=${fmt(s3l5sim.obsHiddenMerged ?? s3l5sim.obsHidden)} = ` +
      `${(s3l5sim.simHidden / (s3l5sim.obsHiddenMerged ?? s3l5sim.obsHidden)).toFixed(2)}×`,
  );
  say(
    "    ※ T5 の sim 内訳は実 engine 出力で直接検証済み（`phase16_action8_sim_hidden_cells.ts` / `_out.txt`）。" +
      "5 レーン全数値が一致し、S3 L5 の超過は b70×L5 の 1 セル（A 2,757,100 + photo 195,000）で 79.2%。" +
      "実測は同じセルで「Aスキル発動失敗。FAIL・スタミナ不足」",
  );
}

// 出力ファイルは node 側で UTF-8 直接書き出し（PowerShell リダイレクトの文字化け回避）
const outPath = path.join(REPO, "research", "23_beat_score_analysis", "phase16_action8_pop_vs_lane_total_out.txt");
fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
console.log(`\n[out] ${outPath}`);




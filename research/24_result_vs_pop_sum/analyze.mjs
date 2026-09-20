/**
 * 24_analysis 本体: リザルト画面のレーン別スコア（A）vs ポップ表示合計（B）の整合検証
 *
 * 検証方法:
 *   A = リザルト画面のレーン別スコア（measured_data.results、1 の位までの実数）
 *   B = そのレーンで表示された全スコアポップ（ビート/A/SP/フォト・P の score_get）の表示値合計
 *       表示は「+38.6K」等の K/M/G 単位切り捨て → 各セル真値区間 [lo, lo+unit)
 *       unit: K=100 / M=100,000 / G=100,000,000（表示最下位 0.1 単位・統計判別済み）
 *   判定: A ∈ [B_min, B_max] か（B_min=Σlo、B_max=Σ(lo+unit)）
 *
 * unknown セル（ポップなし・スコアあり）の推測:
 *   手段1 同条件参照法: 同レーン・同 noteType・同 crit・同 stat_value・同コンボクラス・
 *          同スコア影響バフ段・同 focus/stealth の readable セル群 → 値×[0.95,1.05]
 *   手段2 緩和（バフ段無視→crit 無視→stat 無視）を段階適用し区間を広げる
 *   手段3 ビート内残差: unknown 1 つのビートで bgs が同条件推定と整合する場合のみ絞り込み
 *
 * hidden スコア: bgs > Σ(全ポップ上限) の超過分 = ポップに現れないスコア
 *   （スコア獲得スキル発動ビートでビートスコアポップが上書きされる等の表示仕様）
 *
 * 実行: node research/24_result_vs_pop_sum/analyze.mjs
 * 出力: summary.md / guesses.json / analyze_output.txt
 */
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "C:/Users/umaro/Documents/アイプラ";
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

const UNIT_BY_SF = { K: 100, M: 100000, G: 100000000 };
const POS_TO_LANE = { 1: 3, 2: 2, 3: 4, 4: 1, 5: 5 };

function parsePop(displayed) {
  if (typeof displayed !== "string") return null;
  const m = /^\+?([\d.]+)([KMG])$/.exec(displayed.trim());
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * { K: 1e3, M: 1e6, G: 1e9 }[m[2]]);
}
function popSuffix(displayed) {
  const m = /^\+?([\d.]+)([KMG])$/.exec(displayed.trim());
  return m ? m[2] : null;
}
function comboClass(combo) {
  if (combo >= 100) return 100;
  if (combo >= 70) return 70;
  if (combo >= 50) return 50;
  if (combo >= 40) return 40;
  if (combo >= 30) return 30;
  if (combo >= 20) return 20;
  if (combo >= 10) return 10;
  return 0;
}
/** スコア計算に効くバフ段のキー集合（ポップビートスコア決定要素） */
const SCORE_BUFF_KEYS = [
  "beat_score_up", "score_up", "combo_score_up", "tension_up", "tension_limit",
  "vocal_boost", "focus", "stealth", "critical_coeff_up", "critical_coeff_limit",
];

const SAMPLES = [
  { tag: "T5", stage: "qt-daily-003-19", act: `${REPO}/スコア分析サンプル/measured_data_v2.json`, pops: `${REPO}/スコア分析サンプル/lane_pops_backfill.json`, chart: "chart-hsm-004-001", resultKey: "scores_by_lane" },
  { tag: "S1", stage: "qt-area-1-001", act: `${NOX}/サンプル1/measured_data_v2.json`, pops: `${NOX}/サンプル1/lane_pops_backfill.json`, chart: "chart-hsm-006-001", resultKey: "scores_by_lane" },
  { tag: "S2", stage: "qt-tower-680", act: `${NOX}/サンプル2/measured_data_v2.json`, pops: `${NOX}/サンプル2/lane_pops_backfill.json`, chart: "chart-sun-004-001", resultKey: "lane_scores" },
  { tag: "S3", stage: "qt-ex-tower-005-045", act: `${NOX}/サンプル3/measured_data.json`, pops: `${NOX}/サンプル3/lane_pops_backfill.json`, chart: "chart-thrx-004-001", resultKey: "scores_by_lane" },
];

function buildSample(sample) {
  const act = read(sample.act);
  const tl = act.timeline;
  const bf = read(sample.pops);
  const cells = {};
  for (const p of bf.pops) {
    (cells[p.beat] ??= {})[Number(p.lane)] = { ...p, lane: Number(p.lane) };
  }
  for (const b of tl) {
    for (const [k, v] of Object.entries(b.lanes ?? {})) {
      const L = Number(String(k).replace(/^lane/, ""));
      const text = v.gained_score_displayed ?? v.gained_score_pop?.text ?? null;
      if (text) {
        cells[b.beat] ??= {};
        const c = cells[b.beat][L];
        if (!c || c.covered_by_existing || !c.readable) {
          cells[b.beat][L] = { displayed: text, readable: true, covered: c?.covered_by_existing ?? false, note: c?.note ?? "existing", lane: L };
        }
      }
    }
  }
  const chart = read(`${REPO}/data/charts_all.json`)[sample.chart];
  const notes = chart.map(([t, p], i) => ({ beat: i + 1, type: t, lane: POS_TO_LANE[p] }));
  const critMap = {};
  // critStateMap: 3 値 'crit' | 'white' | 'unknown'（no_pop や色記録なしは unknown）
  const critStateMap = {};
  const cfb = act.critical_flags;
  if (cfb?.beats && typeof cfb.beats === "object") {
    if (typeof cfb.beats[Symbol.iterator] === "function") {
      for (const r of cfb.beats) {
        critMap[r.beat] = [1, 2, 3, 4, 5].map((L) => (r.lanes ? r.lanes[String(L)] === "critical" : false));
      }
    } else {
      for (const [k, v] of Object.entries(cfb.beats)) {
        critMap[Number(k)] = [1, 2, 3, 4, 5].map((L) => v[`L${L}`] === "critical");
      }
    }
  }
  // S3 形式: beats[].lanes 配列（boolean） / S1 形式: beats{beat: {L: "normal"|"critical"}} / T5: beats{beat: {yellow_lanes, white_lanes, no_pop_lanes}}
  if (cfb?.beats && !Array.isArray(cfb.beats) && typeof cfb.beats === "object") {
    const fk = Object.keys(cfb.beats);
    if (fk.length && typeof cfb.beats[fk[0]] === "object" && !Array.isArray(cfb.beats[fk[0]]) && cfb.beats[fk[0]] !== null) {
      const first = cfb.beats[fk[0]];
      if (!("beat" in first)) {
        if ("yellow_lanes" in first) {
          // T5 形式
          for (const k of fk) {
            const v = cfb.beats[k];
            const beatNum = Number(k);
            critStateMap[beatNum] = [1, 2, 3, 4, 5].map((L) => {
              if ((v.yellow_lanes ?? []).includes(String(L))) return "crit";
              if ((v.white_lanes ?? []).includes(String(L))) return "white";
              return "unknown"; // no_pop_lanes または記録なし
            });
          }
        } else {
          // S1 形式
          for (const k of fk) {
            const beatNum = Number(k);
            const v = cfb.beats[k];
            if (v == null) continue;
            critStateMap[beatNum] = [1, 2, 3, 4, 5].map((L) => {
              const x = v[String(L)] ?? v[L];
              if (x === "critical" || x === true) return "crit";
              if (x === "normal" || x === false) return "white";
              return "unknown";
            });
          }
        }
      }
    }
  }
  const laneState = {};
  for (const b of tl) {
    laneState[b.beat] = {};
    for (const [k, v] of Object.entries(b.lanes ?? {})) {
      const L = Number(String(k).replace(/^lane/, ""));
      const eff = {};
      for (const e of v.effects ?? []) {
        if (SCORE_BUFF_KEYS.includes(e.id) && e.stage != null) eff[e.id] = e.stage;
      }
      laneState[b.beat][L] = { stat: v.stat_value ?? null, eff };
    }
  }
  return { act, tl, cells, notes, critMap, critStateMap, laneState };
}

function classify(built, sample) {
  const { tl, cells, notes, critMap, critStateMap, laneState } = built;
  const noteMap = Object.fromEntries(notes.map((n) => [n.beat, n]));
  const rows = [];
  for (const b of tl) {
    const beat = b.beat;
    const bgs = b.beat_gained_score ?? 0;
    const note = noteMap[beat] ?? { type: 0, lane: null };
    const acts = b.skill_activations ?? [];
    const failAct = acts.find((a) => /FAIL/.test(a.skill_name ?? ""));
    const skillLanes = acts.filter((a) => (a.skill_type === "A" || a.skill_type === "SP") && !/FAIL/.test(a.skill_name ?? "")).map((a) => a.lane);
    const scActLanes = acts.filter((a) => !/FAIL/.test(a.skill_name ?? "")).map((a) => a.lane);
    for (let L = 1; L <= 5; L++) {
      const c = cells[beat]?.[L];
      const critState = critStateMap[beat] ? critStateMap[beat][L - 1] : (critMap[beat] ? (critMap[beat][L - 1] ? "crit" : "white") : "unknown");
      const st = laneState[beat]?.[L] ?? {};
      const row = {
        beat, lane: L, bgs, noteType: note.type, noteLane: note.lane, crit: critState,
        combo: b.combo ?? null, comboClass: comboClass(b.combo ?? 0),
        stat: st.stat, eff: st.eff, hasAct: scActLanes.includes(L),
        actLanes: scActLanes, failAct: !!failAct,
      };
      if (c && c.readable && c.displayed) {
        const lo = parsePop(c.displayed);
        row.state = "readable";
        row.displayed = c.displayed;
        row.lo = lo;
        row.hi = lo + UNIT_BY_SF[popSuffix(c.displayed)];
        row.color = c.color ?? null;
      } else if (beat === 0 || bgs === 0) {
        row.state = "zero"; row.reason = beat === 0 ? "b0(開始)" : "bgs=0";
        row.lo = 0; row.hi = 0;
      } else if (note.type === 2 || note.type === 3) {
        if (failAct || skillLanes.length === 0) {
          row.state = "zero"; row.reason = "A/SP FAIL";
          row.lo = 0; row.hi = 0;
        } else if (!skillLanes.includes(L)) {
          row.state = "zero"; row.reason = "A/SP 非発動レーン";
          row.lo = 0; row.hi = 0;
        } else {
          row.state = "unknown"; row.reason = c?.note ?? "A/SP発動レーンのポップなし";
        }
      } else {
        row.state = "unknown"; row.reason = c?.note ?? "通常ビートでポップなし";
      }
      rows.push(row);
    }
  }
  return rows;
}

// ---------------------------------------------------------------- neighbor guess

function candidateCondition(cell) {
  return {
    lane: cell.lane,
    noteType: cell.noteType,
    stat: cell.stat,
    comboClass: cell.comboClass,
    effKey: JSON.stringify(cell.eff),
  };
}

function findNeighbors(rows, cell, tier) {
  // tier1: 全条件一致（stat+comboClass+全バフ段+crit）
  // tier2: バフ段無視（stat+comboClass+crit）
  // tier3: crit 無視（cell の crit が unknown の場合を含む）
  // tier4: comboClass 無視
  return rows.filter((r) => {
    if (r.state !== "readable") return false;
    if (r.lane !== cell.lane) return false;
    if (r.noteType !== cell.noteType) return false;
    if (tier <= 2 && r.stat !== cell.stat) return false;
    if (tier <= 3 && r.comboClass !== cell.comboClass) return false;
    if (tier === 1 && JSON.stringify(r.eff) !== cell.effKey) return false;
    if (tier <= 2 && cell.crit !== "unknown" && r.crit !== cell.crit) return false;
    return true;
  });
}

function guessFromNeighbors(cell, neighbors, tier) {
  if (!neighbors.length) return null;
  const los = neighbors.map((n) => n.lo);
  const his = neighbors.map((n) => n.hi);
  const lo = Math.min(...los) * 0.95;
  const hi = Math.max(...his) * 1.05;
  const condDesc = tier === 1 ? "stat/コンボクラス/バフ段/crit一致" : tier === 2 ? "stat/コンボクラス/crit一致・バフ段差あり" : tier === 3 ? "stat一致・コンボクラス緩和" : "noteType一致のみ";
  return {
    method: `同条件参照(tier${tier})`,
    tier,
    neighbors: neighbors.map((n) => ({ beat: n.beat, displayed: n.displayed, crit: n.crit, combo: n.combo, stat: n.stat })),
    guessLo: Math.floor(lo),
    guessHi: Math.ceil(hi),
    reasoning: `同レーン同条件(tier${tier}: ${condDesc})の近傍実測 ${neighbors.length} セル [${Math.min(...los)}, ${Math.max(...his)}] に乱数幅 [0.95,1.05] を掛けた区間${cell.crit === "unknown" ? "（本セルの crit 状態はフラグ記録なしのため両モードを含む広い区間）" : ""}`,
  };
}

function analyzeSample(sample) {
  const built = buildSample(sample);
  const rows = classify(built, sample);
  const byBeat = {};
  for (const r of rows) (byBeat[r.beat] ??= []).push(r);
  for (const r of rows) r.effKey = JSON.stringify(r.eff);

  // --- unknown セルの推測 ---
  const guesses = [];
  for (const cell of rows) {
    if (cell.state !== "unknown") continue;
    let guess = null;
    for (const tier of [1, 2, 3, 4]) {
      const nbs = findNeighbors(rows, cell, tier);
      // crit 不明の unknown（S2 等 critMap なし）は crit 両方の候補を許すため tier1 でも crit 制約が効かない
      if (nbs.length) {
        guess = guessFromNeighbors(cell, nbs, tier);
        break;
      }
    }
    if (guess) {
      cell.state = "guessed";
      cell.guess = guess;
      cell.lo = guess.guessLo;
      cell.hi = guess.guessHi;
      guesses.push({ beat: cell.beat, lane: cell.lane, noteType: cell.noteType, reason: cell.reason, ...guess });
    } else {
      cell.lo = null; cell.hi = null; // 推測不能
      guesses.push({ beat: cell.beat, lane: cell.lane, noteType: cell.noteType, reason: cell.reason, method: "推測不能", guessLo: null, guessHi: null, reasoning: "同条件の近傍実測なし" });
    }
  }

  // --- ビート内残差による絞り込み（unknown が 1 つのビートのみ）---
  for (const [bs, cells2] of Object.entries(byBeat)) {
    const beat = Number(bs);
    const unknowns = cells2.filter((r) => r.state === "guessed");
    if (unknowns.length !== 1) continue;
    const u = unknowns[0];
    const knownLo = cells2.filter((r) => r !== u).reduce((s, r) => s + (r.lo ?? 0), 0);
    const knownHi = cells2.filter((r) => r !== u).reduce((s, r) => s + (r.hi ?? 0), 0);
    const rLo = u.bgs - knownHi;
    const rHi = u.bgs - knownLo;
    if (rLo < 0) continue; // hidden score あり → 残差法不使用
    // 残差区間と同条件推定の交差
    const newLo = Math.max(u.lo, rLo);
    const newHi = Math.min(u.hi, rHi);
    if (newLo <= newHi) {
      guesses.push({
        beat, lane: u.lane, method: "ビート内残差絞り込み",
        guessLo: Math.floor(newLo), guessHi: Math.ceil(newHi),
        reasoning: `bgs=${u.bgs} から他レーンの表示区間 [${knownLo}, ${knownHi}] を引いた残差 [${rLo}, ${rHi}] と同条件推定 [${u.lo}, ${u.hi}] の交差`,
      });
      u.lo = Math.floor(newLo);
      u.hi = Math.ceil(newHi);
    }
  }

  // --- hidden スコア（full-known ビートの bgs 超過分）---
  const hidden = [];
  for (const [bs, cells2] of Object.entries(byBeat)) {
    const beat = Number(bs);
    const cells3 = cells2.filter((r) => r.lo !== null && r.hi !== null);
    if (cells3.length < 5) continue;
    const sumHi = cells3.reduce((s, r) => s + r.hi, 0);
    const bgs = cells3[0].bgs;
    if (bgs > sumHi) {
      hidden.push({
        beat, bgs, sumHi, excess: bgs - sumHi,
        actLanes: cells3[0].actLanes,
        note: cells3[0].hasAct ? `発動レーン=${cells3[0].actLanes.join(",")}` : "発動記録なし",
        pops: cells3.map((r) => `L${r.lane}:${r.displayed}${r.state === "guessed" ? "(推)" : ""}`).join(" "),
      });
    }
  }

  // --- レーン別集計 ---
  const result = read(sample.act).results ?? {};
  const laneScores = {};
  if (sample.resultKey === "scores_by_lane") {
    for (const [k, v] of Object.entries(result.scores_by_lane ?? {})) laneScores[Number(k)] = v;
  } else {
    for (const [k, v] of Object.entries(result.lane_scores ?? {})) laneScores[Number(String(k).replace(/^lane/, ""))] = v;
  }
  const laneReport = {};
  for (let L = 1; L <= 5; L++) {
    const cells4 = rows.filter((r) => r.lane === L);
    let bMin = 0, bMax = 0, unresolved = 0;
    for (const c of cells4) {
      if (c.lo !== null && c.hi !== null) {
        bMin += c.lo;
        bMax += c.hi;
      } else unresolved++;
    }
    const A = laneScores[L];
    const inRange = A >= bMin && A <= bMax;
    laneReport[L] = {
      A,
      B_min: bMin,
      B_max: bMax,
      unresolved,
      in_range: inRange,
      excess_over_Bmax: A > bMax ? A - bMax : null,
      shortfall_under_Bmin: A < bMin ? bMin - A : null,
      relative_gap_pct: ((A - (bMin + bMax) / 2) / A * 100),
    };
  }
  return { rows, guesses, hidden, laneReport, laneScores };
}

// ---------------------------------------------------------------- run

const lines = [];
const summary = {};
const guessDump = {};
for (const sample of SAMPLES) {
  const { rows, guesses, hidden, laneReport } = analyzeSample(sample);
  console.log(`===== ${sample.tag} (${sample.stage}) =====`);
  lines.push(`===== ${sample.tag} (${sample.stage}) =====`);
  for (const [L, r] of Object.entries(laneReport)) {
    const verdict = r.unresolved ? "判定不能(未解決セルあり)" : r.in_range ? "OK: A∈[B_min,B_max]" : r.excess_over_Bmax != null ? `NG: A > B_max（超過 ${r.excess_over_Bmax.toLocaleString()}）` : `NG: A < B_min（不足 ${(r.shortfall_under_Bmin ?? 0).toLocaleString()}）`;
    console.log(`L${L}: A=${r.A.toLocaleString()} B∈[${r.B_min.toLocaleString()}, ${r.B_max.toLocaleString()}] gap=${r.relative_gap_pct.toFixed(3)}% → ${verdict}`);
    lines.push(`L${L}: A=${r.A} B∈[${r.B_min}, ${r.B_max}] gap=${r.relative_gap_pct.toFixed(3)}% → ${verdict}`);
    summary[`${sample.tag}_L${L}`] = { ...r, verdict };
  }
  console.log(`unknown/guessed cells: ${guesses.length}`);
  console.log(`hidden ビート（ポップ非表示スコアあり）: ${hidden.length}`);
  for (const h of hidden) {
    console.log(`  b${h.beat}: bgs=${h.bgs} Σhi=${h.sumHi} 超過=${h.excess} ${h.note}`);
    lines.push(`hidden b${h.beat}: excess=${h.excess} ${h.note}`);
  }
  console.log("");
  guessDump[sample.tag] = guesses;
  writeFileSync(new URL(`./cells_final_${sample.tag}.json`, import.meta.url), JSON.stringify(rows, null, 1));
}
writeFileSync(new URL("./guesses.json", import.meta.url), JSON.stringify(guessDump, null, 1));
writeFileSync(new URL("./analyze_output.txt", import.meta.url), lines.join("\n"));
writeFileSync(new URL("./summary.json", import.meta.url), JSON.stringify(summary, null, 1));

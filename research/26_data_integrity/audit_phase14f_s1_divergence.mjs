/**
 * 【Phase 15-4 / 手順 B】Phase 14-F（`expiredThisBeat` 満了バフ復活）の単独寄与の分離トレース
 * 作成: 2026-09-28
 *
 * 背景（prompts/phase15-followups.md 15-4）:
 *   14-F 採用監査（`audit_phase14f_divergence.mjs`）は T5 で ON/OFF 分岐 14 セルを実測表示と突合した。
 *   しかし S1 では「比較した HEAD trace が 14-E 導入前のものなので 14-E と 14-F の寄与が混在する」
 *   ため、14-F 単独の寄与を単独トレースで示せていなかった。本スクリプトは **revival だけが異なる
 *   2 本の trace**（同一エンジン・同一入力）を突き合わせ、buffSnapshots の差分セルを全件列挙する。
 *   あわせて 14-E/14-F 採用前コミット（既定 34c6ed7）との差分も列挙し、S1 の変化を
 *   「14-E 単独」「14-F 単独」に分解する。
 *
 * 比較の3系列（セル = beat × lane × buffKey）:
 *   A = diff(OFF, ON)    … 14-F 単独の寄与（本監査の主目的）
 *   B = diff(BASE, ON)   … 14-E + 14-F の合成寄与
 *   C = diff(BASE, OFF)  … 14-E 単独の寄与
 *   加算性検証: セットとして B = A ⊎ C（かつ A ∩ C = ∅）が成立することを確認する。
 *
 * OFF 版 trace の作り方（engine を恒久変更しない・取得後に必ず復元）:
 *   1. `src/timeline/engine.ts` processBeat 冒頭の満了退避を 1 行だけ無効化する:
 *        state.expiredThisBeat = state.effects.filter((e) => e.remainingBeats <= 0);
 *      → state.expiredThisBeat = [];   // 14-F 導入前と同じく満了インスタンスを破棄
 *      ※ effect_extension 側の復活ブロックは expiredThisBeat が空だと発火しないため、
 *        この 1 行だけで 14-F を完全に無効化できる（scoped 延長はもともと 14-F 対象外）。
 *   2. 発火の確認（必ずやる。やらずに 0 セルを「影響なし」と読むのが過去の実失敗）:
 *        npx tsx tools/dump_t5_trace.ts → total が 17,516,522,572（revival OFF の旧値）なら発火
 *        （現行 ON は 17,521,599,508。T5 の分岐 14 セルは L3 vocal_boost のみ）
 *   3. `npx tsx tools/dump_samples_trace.ts` → 出力 trace を OFF 版としてよそへ退避
 *   4. `git checkout -- src/timeline/engine.ts <各 sim_trace_full.json> samples_trace_summary.json`
 *
 * 実行例（S1）:
 *   node research/26_data_integrity/audit_phase14f_s1_divergence.mjs --sample S1 --off <OFF trace>
 *   # --on は既定で現行コミットの trace、--baseline は既定 34c6ed7
 * 出力: research/26_data_integrity/phase14f_<sample>_divergence_audit.json
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const SAMPLE = arg("sample", "S1");
const ON_PATH = arg("on", "research/17_sample1_gap_analysis/sim_trace_full.json");
const OFF_PATH = arg("off", "");
const MEASURED_PATH = arg("measured", "../aipura_nox/サンプル1/measured_data.json");
const BASE_REV = arg("baseline", "34c6ed7"); // 14-E/14-F 採用直前の最終コミット
const OUT = arg("out", `research/26_data_integrity/phase14f_${SAMPLE.toLowerCase()}_divergence_audit.json`);

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const readGit = (rev, p) =>
  execSync(`git show ${rev}:${p}`, { encoding: "utf-8", maxBuffer: 1 << 28 });

if (!OFF_PATH) {
  console.error("--off を指定してください（作り方は本ファイル冒頭コメント参照）");
  process.exit(2);
}
if (!existsSync(OFF_PATH)) {
  console.error(`OFF trace が見つかりません: ${OFF_PATH}`);
  process.exit(2);
}

const onBuf = readFileSync(ON_PATH, "utf-8");
const offBuf = readFileSync(OFF_PATH, "utf-8");
const baseBuf = readGit(BASE_REV, ON_PATH);
const ON = JSON.parse(onBuf);
const OFF = JSON.parse(offBuf);
const BASE = JSON.parse(baseBuf);


/** 実測バフ名 → sim buffKey（`run_audit_post_decay.py` と同じ対応） */
const NAME_TO_KEY = {
  ボーカル上昇: "vocal_up",
  ボーカルブースト: "vocal_boost",
  ボーカル上昇超化: "vocal_up_extreme",
  ボーカル低下: "vocal_down",
  ダンス上昇: "dance_up",
  ダンスブースト: "dance_boost",
  ダンス上昇超化: "dance_up_extreme",
  ダンス低下: "dance_down",
  ビジュアル上昇: "visual_up",
  ビジュアルブースト: "visual_boost",
  ビジュアル上昇超化: "visual_up_extreme",
  ビジュアル低下: "visual_down",
  スコア上昇: "score_up",
  ビートスコア上昇: "beat_score_up",
  Aスキルスコア上昇: "a_skill_score_up",
  SPスキルスコア上昇: "sp_skill_score_up",
  Pスキルスコア上昇: "p_skill_score_up",
  コンボスコア上昇: "combo_score_up",
  クリティカル率上昇: "critical_rate_up",
  クリティカル係数上昇: "critical_coeff_up",
  テンションUP: "tension_up",
  集目: "focus",
  ステルス: "stealth",
  スキル成功率上昇: "skill_success_up",
  消費スタミナ低下: "stamina_cost_down",
  消費スタミナ上昇: "stamina_cost_up",
};

const measured = existsSync(MEASURED_PATH) ? JSON.parse(readFileSync(MEASURED_PATH, "utf-8")) : null;
const measByBeat = new Map((measured?.timeline ?? []).map((r) => [Number(r.beat), r]));
const missingCells = new Set();
for (const mf of measured?.missing_frames ?? []) {
  const beat = Number(mf?.beat);
  const lane = Number(String(mf?.lane ?? "").replace("lane", ""));
  if (Number.isFinite(beat) && Number.isFinite(lane)) missingCells.add(`${beat}|${lane}`);
}

/** 実測表示の段数マップ（同一 id は合算）。レーンが写っていない場合は null */
function measStages(row, lane) {
  if (!row?.lanes) return null;
  const laneObj = row.lanes[String(lane)] ?? row.lanes[`lane${lane}`];
  if (!laneObj || !Array.isArray(laneObj.effects)) return null;
  const map = {};
  for (const e of laneObj.effects) {
    const key = NAME_TO_KEY[e?.name];
    if (!key) continue;
    map[key] = (map[key] ?? 0) + (e.stage == null ? 0 : Number(e.stage));
  }
  return { map, empty: laneObj.effects.length === 0 };
}

// ---------------------------------------------------------------- 入力整形
const idxBeats = (t) => new Map((t?.beats ?? []).map((b) => [Number(b.beat), b]));
const ONI = idxBeats(ON);
const OFFI = idxBeats(OFF);
const BASEI = idxBeats(BASE);

const snap = (map, beat, laneIdx, key) => {
  const s = map.get(beat)?.buffSnapshots?.[laneIdx];
  return s ? Number(s[key] ?? 0) : null;
};

/** 3 trace にまたがる (beat, lane, key) 空間を union で作る（見落とし防止） */
const allBeats = [...new Set([...ONI.keys(), ...OFFI.keys(), ...BASEI.keys()])].sort((a, b) => a - b);
const keyUnion = new Set();
for (const map of [ONI, OFFI, BASEI]) {
  for (const b of map.values()) {
    for (const s of b.buffSnapshots ?? []) for (const k of Object.keys(s)) keyUnion.add(k);
  }
}
const KEYS = [...keyUnion].sort();

/** 2 trace の buffSnapshots 差分セルを全列挙 */
function diffCells(aMap, bMap, aName, bName) {
  const cells = [];
  let compared = 0;
  for (const beat of allBeats) {
    for (let laneIdx = 0; laneIdx < 5; laneIdx++) {
      for (const key of KEYS) {
        const va = snap(aMap, beat, laneIdx, key);
        const vb = snap(bMap, beat, laneIdx, key);
        if (va === null && vb === null) continue;
        compared++;
        if (va === vb) continue;
        cells.push({ beat, lane: laneIdx + 1, buff: key, [aName]: va, [bName]: vb });
      }
    }
  }
  return { cells, compared };
}

const cellId = (c) => `b${c.beat}/L${c.lane}/${c.buff}`;

// ---------------------------------------------------------------- 実測による判定
/** 14-F 単独差分セルを実測表示で判定（T5 の v2 監査 `audit_phase14f_divergence.mjs` と同じ規準） */
function judgeAgainstMeasured(c) {
  const row = measByBeat.get(c.beat);
  if (!measured || !row) return { measured: null, support: "not_captured" };
  if (missingCells.has(`${c.beat}|${c.lane}`)) return { measured: null, support: "not_captured" };
  const ms = measStages(row, c.lane);
  if (!ms) return { measured: null, support: "not_captured" };
  if (c.buff in ms.map) {
    const m = ms.map[c.buff];
    const onOk = c.on === m;
    const offOk = c.off === m;
    return {
      measured: m,
      support: onOk && offOk ? "both" : onOk ? "on" : offOk ? "off" : "neither",
    };
  }
  // 実測はそのバフ行を写していない（表示アイコン数の上限でこぼれる既知挙動を含む）
  const onShows = (c.on ?? 0) > 0;
  const offShows = (c.off ?? 0) > 0;
  return {
    measured: 0,
    support: onShows === offShows ? "neither" : onShows ? "off" : "on",
    note: "当該バフ行が実測表示に無い（表示 0 として扱った）",
  };
}

/** 発動系列・ビート別スコアの同一性（バフ以外の交絡が無いことの担保） */
function structuralEquality(aMap, bMap, aName, bName) {
  const acts = [];
  const gained = [];
  for (const beat of allBeats) {
    const a = aMap.get(beat);
    const b = bMap.get(beat);
    if (!a || !b) {
      acts.push({ beat, reason: `${a ? bName : aName} にビート無し` });
      continue;
    }
    const fa = (a.activations ?? []).map((x) => `${x.lane}:${x.skillId}:${x.success}`).join("|");
    const fb = (b.activations ?? []).map((x) => `${x.lane}:${x.skillId}:${x.success}`).join("|");
    if (fa !== fb) acts.push({ beat, [aName]: fa, [bName]: fb });
    if (Number(a.gained) !== Number(b.gained)) gained.push({ beat, [aName]: a.gained, [bName]: b.gained });
  }
  return { activation_diff_beats: acts.length, gained_diff_beats: gained.length, acts, gained };
}

// ---------------------------------------------------------------- 計算
const pureF = diffCells(OFFI, ONI, "off", "on"); // A: 14-F 単独
const combined = diffCells(BASEI, ONI, "base", "on"); // B: 14-E + 14-F
const pureE = diffCells(BASEI, OFFI, "base", "off"); // C: 14-E 単独

const setA = new Set(pureF.cells.map(cellId));
const setB = new Set(combined.cells.map(cellId));
const setC = new Set(pureE.cells.map(cellId));
const sortedJoin = (s) => [...s].sort().join(",");
const additivity = {
  "A_14f_only": setA.size,
  "B_14e_plus_14f": setB.size,
  "C_14e_only": setC.size,
  "B_equals_A_union_C": sortedJoin(setB) === sortedJoin(new Set([...setA, ...setC])),
  "A_intersect_C": [...setA].filter((k) => setC.has(k)).length,
  "in_B_but_neither_A_nor_C": [...setB].filter((k) => !setA.has(k) && !setC.has(k)).length,
};

function cellMeta(c) {
  return {
    beat: c.beat,
    lane: c.lane,
    buff: c.buff,
    sim_revival_off: c.off ?? snap(OFFI, c.beat, c.lane - 1, c.buff),
    sim_revival_on: c.on ?? snap(ONI, c.beat, c.lane - 1, c.buff),
    sim_pre_14ef: snap(BASEI, c.beat, c.lane - 1, c.buff),
    activations_same_beat_same_lane: (ONI.get(c.beat)?.activations ?? [])
      .filter((a) => Number(a.lane) === c.lane)
      .map((a) => a.skillId),
  };
}
const fCells = pureF.cells.map((c) => {
  const j = judgeAgainstMeasured(c);
  return { ...cellMeta(c), measured_display: j.measured, support: j.support, note: j.note ?? null };
});
const supportCounts = fCells.reduce((acc, c) => {
  acc[c.support] = (acc[c.support] ?? 0) + 1;
  return acc;
}, {});

const WINDOW = [132, 148]; // 15-1 で Step 11 非復活を確定した S1 b136 前後の窓
const windowCells = (cells) => cells.filter((c) => c.beat >= WINDOW[0] && c.beat <= WINDOW[1]).map(cellMeta);

/** 実測表示の段数（撮影欠損・未収録は null） */
function measValueAt(beat, lane, buff) {
  const ms = measStages(measByBeat.get(beat), lane);
  if (!ms || missingCells.has(`${beat}|${lane}`)) return null;
  return buff in ms.map ? ms.map[buff] : 0;
}

/** combined（14-E/14-F 採用前 → 現行）の差分セルに実測値と帰属を付与して全件列挙する */
const combinedAnnotated = combined.cells.map((c) => {
  const m = measValueAt(c.beat, c.lane, c.buff);
  const onOk = m !== null && c.on === m;
  const baseOk = m !== null && c.base === m;
  return {
    beat: c.beat,
    lane: c.lane,
    buff: c.buff,
    sim_pre_14ef: c.base,
    sim_current: c.on,
    revival_off: snap(OFFI, c.beat, c.lane - 1, c.buff),
    measured_display: m,
    attribution: setA.has(cellId(c)) ? "14-F" : "14-E",
    measured_agreement:
      m === null ? "not_captured" : onOk && !baseOk ? "現行模型と一致" : baseOk && !onOk ? "旧模型と一致" : onOk && baseOk ? "both" : "neither",
  };
});


const onReplay = ON.meta?.replayTotalScore ?? ON.simTotal ?? null;
const offReplay = OFF.meta?.replayTotalScore ?? OFF.simTotal ?? null;

const summary = {
  generated: "2026-09-28",
  sample: SAMPLE,
  purpose:
    "Phase 14-F（expiredThisBeat 復活）の単独寄与を、revival だけが異なる trace 2 本の全セル突合で確定させる（phase14f_revival_audit.md §6 手順 B）",
  inputs: {
    on_trace: { path: ON_PATH, sha256: sha256(onBuf), note: "revival ON（現行コミットのエンジンで再生成済み）" },
    off_trace: { path: OFF_PATH, sha256: sha256(offBuf), note: "revival OFF（engine の満了退避 1 行を無効化して生成）" },
    baseline_trace: { rev: BASE_REV, path: ON_PATH, sha256: sha256(baseBuf), note: "14-E/14-F 採用直前の最終コミット" },
    measured: measured
      ? { path: MEASURED_PATH, beats: measByBeat.size }
      : { path: MEASURED_PATH, beats: 0, note: "実測ファイルなし（git 管理外）→ 実測判定は not_captured になる" },
    on_off_byte_identical: onBuf === offBuf,
  },
  space: {
    beats: allBeats.length,
    lanes: 5,
    buff_keys: KEYS.length,
    cells_compared_per_pair: pureF.compared,
  },
  total_scores: {
    revival_on: { neutral: ON.meta?.neutralTotalScore ?? null, replay: onReplay },
    revival_off: { neutral: OFF.meta?.neutralTotalScore ?? null, replay: offReplay },
    pre_14ef: { neutral: BASE.meta?.neutralTotalScore ?? null, replay: BASE.meta?.replayTotalScore ?? BASE.simTotal ?? null },
    "delta_14f_only_replay": onReplay === offReplay ? 0 : offReplay - onReplay,
  },
  structural_identity_revival_on_vs_off: structuralEquality(OFFI, ONI, "revival_off", "revival_on"),
  cell_diffs: {
    "A_14f_only": setA.size,
    "B_pre_14ef_vs_on": setB.size,
    "C_14e_only": setC.size,
    additivity,
  },
  "14f_only_cells_measured_support": supportCounts,
  b136_window: {
    beats: WINDOW,
    note: "15-1 で Step 11 非復活を確定した窓。この窓の差分が 14-E 由来か 14-F 由来かを切り分ける",
    combined_diff_cells: windowCells(combined.cells).length,
    revival_only_diff_cells: windowCells(pureF.cells).length,
    cells: windowCells(combined.cells).slice(0, 80),
  },
};

writeFileSync(
  OUT,
  JSON.stringify(
    { summary, revival_only_cells: fCells, combined_pre_14ef_vs_on: combinedAnnotated },
    null,
    1,
  ),
  "utf-8",
);

console.log(
  JSON.stringify(
    {
      ...summary,
      revival_only_cells_head: fCells.slice(0, 20),
      combined_cells_all: combinedAnnotated,
    },
    null,
    1,
  ),
);
console.log(`written: ${OUT}`);



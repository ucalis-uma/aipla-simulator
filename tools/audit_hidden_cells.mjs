/**
 * Phase 16 Action10: **隠れセル・ゲート**（`node tools/audit_hidden_cells.mjs S1,S2,S3`）
 *
 * 目的（prompts/phase16-action10-hidden-cell-gate.md §1）:
 *   「pop が読めないセル」＝実測で検証できないセルに、sim が実測以上にスコアを置いていないかを
 *   **数値ゲート**として毎回検査する。A8 で見つかった S3 L5（sim(隠れ)=4,039,884 /
 *   隠れ枠=525,474 = 7.69×）を**緩めずに**回帰検出し続けるのが役割。
 *
 * 移植元（実装はそのまま port。テキスト出力の正規表現読みはしない）:
 *   - 実測側: `research/23_beat_score_analysis/phase16_action8_pop_vs_lane_total.mjs`
 *     （内生 pop `timeline[].lanes[].gained_score_pop` ＋ `lane_pops_backfill.json` の統合、
 *       K 表記の切り捨て＝下界、レーン合計は `results.scores_by_lane` / `lane_scores`）
 *   - sim 側: `research/23_beat_score_analysis/phase16_action8_sim_hidden_cells.ts`
 *     → `tools/audit_hidden_cells_sim.ts` として移植（本ツールが tsx で起動し JSON を受け取る）
 *
 * ゲート（§2）:
 *   隠れ枠 = レーン合計 − Σpop（K 表記は切り捨てなので **上限**）
 *   sim(隠れ) = そのレーンの pop 読込不能セルに sim が置いたスコア合計
 *   比 = 分子 / 隠れ枠 →  **比 ≥ 2.0 = FAIL / 1.5 ≤ 比 < 2.0 = WARN / それ未満 = OK**
 *   FAIL が 1 件でもあれば exit 1。**閾値は緩めない**（閾値を上げて通すのは禁止・§8）。
 *
 * 【Phase 16 Action14 タスク A1】**分子を対称化**した（分母・閾値は 1 も動かしていない）:
 *   分子 = sim(pop 不能セル) ＋ Σ_b min( 可読セルの sim 超過 E_b, そのビートの実測未記録額 R_b )
 *   動機 = 実測側の分母には「**pop は読めているが、そのセルを覆いきっていない分**」も入る。
 *     代表例 S3 b2 L3: pop は +123.3K（フォト行）だけだが同ビートに A スキル「殻をやぶる」が
 *     発動しており、実測残差（beat_gained_score − Σpop）= **2,109,487** がその分。
 *     sim は同セルに 1,883,500 を置いており、従来はこれが「可読セル」として分母の外にあった
 *     ＝ 実測 2.11M は分母へ / sim 1.88M は分子の外、という非対称が **0.04×** の正体
 *     （`research/23_beat_score_analysis/phase16_action13_s3_l3_cells.md` §3）。
 *   性質: min(…) ≥ 0 なので **新分子 ≥ 旧分子**。上側ゲートは厳しくなる方向にしか動かない。
 *   現行比（simHidden / 隠れ枠）も全行に併記する（差分の監査用）。
 *
 * 【Phase 16 Action12 タスク2】**下側ゲート**を新設（上側は一切変更しない）:
 *   同じ比の**低い側**も検査する。sim が「実測で検証できないセル」にスコアを置かなさすぎる
 *   ＝ **sim がそのレーンの実測を説明できていない**（不足の在処の候補）ことを検出する。
 *     **比 ≤ 0.25 = FAIL / 0.25 < 比 ≤ 0.5 = WARN / それ超 = OK**
 *   根拠（A10 の記録）: S3 L3 = sim(隠れ) 116,039 / 隠れ枠 2,635,445 = **0.04×**
 *     → **A14 タスク A1 で正体を特定**: pop が読めているセルの未表示分（b2 L3 の A スキル
 *       約 2.11M）が分母にだけ入る非対称が原因で、**分子の対称化により 0.75× = OK** になった
 *       （分母 2,635,445 と閾値 0.25/0.5 は不変・sim 側の不足は レーン比 0.906 として残る）。
 *   上側と同じく photo-gate off/on × Σpop 口径（統合／内生）の**全組み合わせの最悪値**で判定する
 *   （下側の「最悪」＝最小値）。
 *   **下限は `hiddenCells > 0` のレーンにだけ適用する**: pop 読込不能セルが 1 つも無いレーンの
 *   「隠れ枠」は K 表記の切り捨て残差（= 実測の丸め損）だけであり、0 除算同然の比になる
 *   （例: 全 163 セル可読の S1 L3 は隠れ枠 161,728 / sim 0）。分母が「未検証セルの実体」を
 *   表しているときだけ判定する。`--low-gate=warn` で WARN 止まり、`--low-gate=off` で下側を出さない
 *   （**上側の閾値・分母はこのオプションでも一切変わらない**）。
 *   診断用に `sim(可読)/Σpop` も併記する（≒1 なら「配分だけが隠れセル側に寄っている」、
 *   低ければ「レーン合計そのものを説明できていない」）。**A14 タスク A4 でこの列を検査3 に昇格**した:
 *     比 ≥ 1.20 = FAIL(可読) ／ 1.07〜1.20 = WARN(可読) ／ 0.93〜1.07 = OK ／
 *     0.80〜0.93 = WARN(可読・下) ／ ≤ 0.80 = FAIL(可読・下)
 *   閾値の根拠: 15 レーン × photo-gate off/on の実測分布が **0.953〜1.103**（Σpop は K/M 切り捨てで
 *   高々 +0.6% しか過小評価しないため、±7% を超えるずれは測定誤差では説明できない）。
 *   **検査1（閉包）・検査2（隠れセル比）の分母・閾値は 1 も動かしていない**。上側 FAIL は exit に効き、
 *   下側 FAIL は `--low-gate` の扱い（既定 fail／`warn`／`off`）に従う。
 *   ※ スタミナ系列の検査は **検査4**（`--ledger`・A6 と同一規約）。
 *
 *   Σpop の基準は 2 系統を併記し、判定は**悪い方**で行う:
 *     「統合」   = 内生 pop ＋ lane_pops_backfill（全サンプルで使える・既定）
 *     「内生のみ」= A8 の T5 表と同口径（S3 のみ。A8 の headline 7.69× はこの口径）
 *   sim 側も 2 系統を併記する（**F3 の効果そのもの**を数値で見るため）:
 *     photo-gate=off = 素の engine 既定（goldenPhotoNames を渡さない。**F3 前は T5 フォトが素通り**）
 *     photo-gate=on  = 受け入れ基準ハーネスと同一（T5 実測フォト名でゲート）
 *   F3 後は S1/S2/S3 の deck フォト名が T5 名と一致しないため off ≡ on になる（＝欠陥が消える）。
 *   off は常に走らせるので、**素通りが再導入されたらこのゲートは再び FAIL する**。
 *
 * 実行:
 *   node tools/audit_hidden_cells.mjs S1,S2,S3            # 既定（photo-gate off/on の両方）
 *   node tools/audit_hidden_cells.mjs S1,S2,S3 --ledger   # + S1 L1 のスタミナ系列 全ビート一致
 *   npm run audit:hidden
 *   node tools/audit_hidden_cells.mjs S1,S2,S3 --photo-gate=off   # 片方だけ
 *   node tools/audit_hidden_cells.mjs S1,S2,S3 --sim=<file.json>  # 既存の sim ダンプを再利用（off 扱い）
 *   node tools/audit_hidden_cells.mjs S1,S2,S3 --no-sim           # 実測側だけ
 * 出力: `research/23_beat_score_analysis/phase16_action10_audit_out.txt`（`--out=` で変更可）
 *
 * 除外: S4 = 無効撮影回（`サンプル4/` に measured_data が無い・`サンプル4_invalid_capture_20260905`）／
 *       S5 = fan.png のみ（deck.json・measured_data が無い）。どちらも理由を出力に書く。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

const REPO = path.resolve(process.cwd());
const NOX = path.resolve(REPO, "..", "aipura_nox");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};
const positional = argv.filter((a) => !a.startsWith("--"));
const WANT = (positional[0] ?? "S1,S2,S3").split(",").map((s) => s.trim().toUpperCase());
const WITH_LEDGER = flag("ledger");
const NO_SIM = flag("no-sim");
const MODE = opt("mode", "lanefans");
const PHOTO_GATE = opt("photo-gate", "both"); // off | on | both
/** 【A12 タスク2】下側ゲートの扱い: fail（既定・exit 1 に効く）| warn（表示のみ）| off（判定しない） */
const LOW_GATE = opt("low-gate", "fail"); // fail | warn | off
const OUT = path.resolve(
  REPO,
  opt("out", "research/23_beat_score_analysis/phase16_action10_audit_out.txt"),
);
const SIM_JSON_PROVIDED = opt("sim", null);

/** measured_data の探索順（新しい順・tools/dump_lane_pops.mjs と同じ規約） */
const MEAS_CANDIDATES = ["measured_data_v3.json", "measured_data_v2.json", "measured_data.json"];
/** research/26_data_integrity の補正版（aipura_nox 側に無い場合のフォールバック） */
const FALLBACK_MEAS = {
  S1: ["measured_data_s1_v3.json"],
  S2: ["measured_data_s2_v3.json"],
  S3: ["measured_data_s3_v3.json"],
};

const SAMPLES = [
  { tag: "S1", dir: path.join(NOX, "サンプル1"), chart: "chart-hsm-006-001", excluded: null },
  { tag: "S2", dir: path.join(NOX, "サンプル2"), chart: "chart-sun-004-001", excluded: null },
  { tag: "S3", dir: path.join(NOX, "サンプル3"), chart: "chart-thrx-004-001", excluded: null },
  {
    tag: "S4",
    dir: path.join(NOX, "サンプル4"),
    chart: null,
    excluded: "無効撮影回（measured_data なし・`サンプル4_invalid_capture_20260905` に退避）",
  },
  {
    tag: "S5",
    dir: path.join(NOX, "サンプル5"),
    chart: null,
    excluded: "fan.png のみ（deck.json / measured_data なし）",
  },
];

const LANES = [1, 2, 3, 4, 5];
const fmt = (v) =>
  v === null || v === undefined || Number.isNaN(v) ? "null" : Math.round(v).toLocaleString("en-US");
const pad = (s, w) => String(s).padStart(w);
/** 【A14/A1】現行比の併記用（null は "n/a"） */
const fmtRatio = (v) => (v === null || v === undefined || Number.isNaN(v) ? "n/a" : v.toFixed(2));

const lines = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};

// ---------------------------------------------------- ポップ表記の解釈（research/24 §2.3 準拠）
function parseK(text) {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(text ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = { "": 1, K: 1000, M: 1e6, G: 1e9 }[(m[2] ?? "").toUpperCase()];
  return unit === undefined ? null : Math.round(n * unit);
}

// ---------------------------------------------------- 実測側（A8 の port）
function loadMeasured(tag, dir) {
  const cands = [
    ...MEAS_CANDIDATES.map((f) => path.join(dir, f)),
    ...(FALLBACK_MEAS[tag] ?? []).map((f) =>
      path.join(REPO, "research", "26_data_integrity", f),
    ),
  ];
  for (const p of cands) {
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
      file: path.relative(REPO, p),
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

/** レーン配列/オブジェクト両対応（S1/S2 は配列・S3 は "1".."5" キー） */
function laneRead(row, lane) {
  const L = row?.lanes;
  if (L === null || L === undefined) return null;
  if (Array.isArray(L)) return L[lane - 1] ?? null;
  return L[String(lane)] ?? L[`lane${lane}`] ?? null;
}

function inlinePops(timeline) {
  const m = new Map();
  for (const e of timeline) {
    if (typeof e?.beat !== "number") continue;
    for (const l of LANES) {
      const g = laneRead(e, l)?.gained_score_pop;
      const t = typeof g === "string" ? g : (g?.text ?? null);
      if (parseK(t) !== null) m.set(`${e.beat}:${l}`, String(t));
    }
  }
  return m;
}

function backfillPops(file) {
  const doc = J(file);
  const m = new Map();
  for (const x of doc.pops ?? []) {
    if (typeof x?.beat !== "number" || typeof x?.lane !== "number") continue;
    if (x.readable === false) continue;
    if (parseK(x.displayed) === null) continue;
    m.set(`${x.beat}:${x.lane}`, { text: String(x.displayed), frames: x.source_frames ?? [] });
  }
  return m;
}

// ---------------------------------------------------- sim ダンプ（tools/audit_hidden_cells_sim.ts）
function simDumpPath(photoGate) {
  const dir = path.join(REPO, "research", "23_beat_score_analysis");
  return photoGate === null
    ? path.join(dir, "phase16_action10_sim_cells.json")
    : path.join(dir, `phase16_action10_sim_cells_${photoGate}.json`);
}
function runSimDump(photoGate) {
  const out = simDumpPath(photoGate);
  const targets = WANT.filter((t) =>
    SAMPLES.some((s) => s.tag === t && s.excluded === null),
  ).join(",");
  // 子プロセスは直接ファイルへ書く（stdout のパイプ取り込みは使わない）。stdio は inherit。
  const cmd =
    `npx --no-install tsx tools/audit_hidden_cells_sim.ts "${path.relative(REPO, out)}" "${targets}"` +
    ` --mode=${MODE}${photoGate === "off" ? " --legacy-photo" : ""}`;
  try {
    execSync(cmd, { cwd: REPO, stdio: "inherit" });
  } catch (e) {
    say(`  [!] sim ダンプの生成に失敗（tsx 未導入など）: ${String(e.message).split("\n")[0]}`);
  }
  return out;
}

/** 使う photo-gate の一覧を決める */
function photoGates() {
  if (SIM_JSON_PROVIDED !== null) return [null];
  if (PHOTO_GATE === "off") return ["off"];
  if (PHOTO_GATE === "on") return ["on"];
  return ["off", "on"];
}

// ================================================================== 実行
say("=== Phase 16 Action10: 隠れセル・ゲート（pop 読込不能セルへの sim 過剰配置の回帰検出） ===");
say("  実測側: 内生 pop + lane_pops_backfill（K 表記は切り捨て＝下界・隠れ枠は上限）");
say(`  sim 側 : tools/audit_hidden_cells_sim.ts（mode=${MODE}・実測クリ注入／NeutralRng）`);
say("  ゲート : 比 = sim(pop読込不能セル) / (レーン合計 − Σpop)。比 ≥ 2.0 = FAIL ／ 1.5〜2.0 = WARN");
say(
  `  下側   : 比 ≤ 0.25 = FAIL(下) ／ 0.25〜0.5 = WARN(下)（sim が実測を説明できていない）。` +
    `適用は pop 読込不能セルが 1 つ以上あるレーンだけ。扱い=${LOW_GATE}`,
);
say("  基準   : Σpop は「統合」と「内生のみ（A8 口径）」、sim は photo-gate off/on を併記し **悪い方**で判定");
for (const s of SAMPLES) {
  if (WANT.includes(s.tag) && s.excluded !== null) say(`  除外: ${s.tag} = ${s.excluded}`);
}
const unknown = WANT.filter((t) => !SAMPLES.some((s) => s.tag === t));
if (unknown.length > 0) {
  say(`  [!] 未知のサンプル指定: ${unknown.join(",")}（有効: S1,S2,S3）`);
  process.exitCode = 2;
}

const simDocs = [];
if (!NO_SIM) {
  for (const g of photoGates()) {
    const p = SIM_JSON_PROVIDED !== null ? path.resolve(REPO, SIM_JSON_PROVIDED) : runSimDump(g);
    if (exists(p)) {
      simDocs.push({ gate: g, doc: J(p), path: path.relative(REPO, p) });
      say(
        `  sim ダンプ[${g ?? "指定ファイル"}]: ${path.relative(REPO, p)}` +
          `（goldenPhotoNames=${J(p).goldenPhotoNames}）`,
      );
    } else {
      say(`  [!] sim ダンプが見つからない: ${p} → sim 列は出さない`);
    }
  }
} else {
  say("  sim 列は --no-sim のため省略");
}

// ---------------------------------------------------- サンプル別の材料
const ctx = [];
for (const s of SAMPLES) {
  if (!WANT.includes(s.tag) || s.excluded !== null) continue;
  const meas = loadMeasured(s.tag, s.dir);
  if (meas === null) {
    say(`  [skip] ${s.tag}: measured_data が見つからない`);
    continue;
  }
  const inl = inlinePops(meas.timeline);
  const bfFile = path.join(s.dir, "lane_pops_backfill.json");
  const bf = exists(bfFile) ? backfillPops(bfFile) : new Map();
  const merged = new Map();
  for (const [k, t] of inl) merged.set(k, { text: t, src: "inline" });
  let fromBackfill = 0;
  for (const [k, v] of bf) {
    if (merged.has(k)) continue;
    merged.set(k, { text: v.text, src: "backfill" });
    fromBackfill++;
  }
  const sims = simDocs.map((d) => ({
    gate: d.gate,
    sim: d.doc.samples?.[s.tag] ?? null,
    mode: d.doc.mode,
  }));
  ctx.push({ ...s, meas, inl, bf, merged, fromBackfill, sims });
  const simTxt = sims
    .filter((x) => x.sim !== null)
    .map((x) => `sim[${x.gate ?? "file"}] ${fmt(x.sim.totalScore)}`)
    .join(" / ");
  say(
    `\n  ${s.tag}: ${meas.file}（timeline ${meas.timeline.length} ビート / 末尾 b${meas.lastBeat}）／` +
      `内生 pop ${inl.size} セル + 遡及のみ ${fromBackfill} セル = 統合 ${merged.size} セル／` +
      `レーン合計キー ${meas.laneTotalsKey ?? "なし"}` +
      (simTxt === "" ? "" : `／${simTxt}`),
  );
}

// ---------------------------------------------------- 検査1: 4 系統の閉包
say("\n########## 検査1: 実測値の閉包（total_score / レーン合計 / バー増分合計 / 末尾 cumulative） ##########");
say("  サンプル|    total_score|   Σレーン合計|       差| Σbeat_gained|       差| 末尾 cumulative|       差| 判定");
let closureFail = 0;
for (const c of ctx) {
  const laneSum =
    c.meas.laneTotals === null ? null : c.meas.laneTotals.reduce((a, v) => a + (v ?? 0), 0);
  const d1 = laneSum === null || c.meas.totalScore === null ? null : laneSum - c.meas.totalScore;
  const d2 = c.meas.totalScore === null ? null : c.meas.bgsSum - c.meas.totalScore;
  const d3 =
    c.meas.lastCumulative === null || c.meas.totalScore === null
      ? null
      : c.meas.lastCumulative - c.meas.totalScore;
  const tol = c.meas.totalScore === null ? 0 : c.meas.totalScore * 0.005;
  const ok = d1 !== null && d2 !== null && d3 !== null && d1 === 0 && Math.abs(d2) <= tol && d3 === 0;
  if (!ok) closureFail++;
  say(
    `    ${c.tag}   | ${pad(fmt(c.meas.totalScore), 14)} | ${pad(fmt(laneSum), 13)} | ${pad(fmt(d1), 8)} | ` +
      `${pad(fmt(c.meas.bgsSum), 12)} | ${pad(fmt(d2), 8)} | ${pad(fmt(c.meas.lastCumulative), 15)} | ${pad(fmt(d3), 8)} | ` +
      `${ok ? "OK（閉包）" : "要確認"}`,
  );
}
say("  ※ Σbeat_gained_score は各レーンの丸めを含むため ±0.5% を許容（レーン合計・total_score は厳密一致を要求）");

// ---------------------------------------------------- 検査2: 隠れセル比
/**
 * 【Phase 16 Action14 / タスク A1】**分子の対称化**（分母・閾値は不変）。
 *
 * 動機: 実測側の分母（レーン合計 − Σpop）には「**pop は読めているが、その pop が
 * そのセルの実測を覆いきっていない分**」も入る。代表例 = S3 b2 L3:
 *   pop は +123.3K（フォト行）だけだが、同ビートに L3 の A スキル「殻をやぶる」が発動しており、
 *   実測の残差（beat_gained_score − Σpop）= **2,109,487** がその分。
 *   sim は同セルに 1,883,500 を置いており、これは「可読セル」として分母の外に置かれる
 *   → 実測 2.11M は分母へ / sim 1.88M は分子の外、という**非対称**が 0.04× の正体だった。
 *
 * 対称化（ビート単位）:
 *   R_b = max(0, beat_gained_score_b − Σpop(可読セル))   ← 実測が「未記録」と証明した額
 *   H_b = sim(pop 不能セル)                              ← 従来の分子
 *   E_b = Σ max(0, sim − pop) over 可読セル              ← sim の pop 超過
 *   寄与 = H_b + min(E_b, max(0, R_b − H_b))
 *
 * 性質: min(...) ≥ 0 なので **新分子 ≥ 旧分子**。よって
 *   - 上側ゲート（過剰配置の検出）は厳しくなる方向にしか動かない（検出力は落ちない）
 *   - 分母（レーン合計 − Σpop）と閾値（上 2.0/1.5・下 0.25/0.5）は 1 も動かさない
 *   - 実測が「未記録」と証明できない超過は数えない（モデル誤差を過剰配置と誤認しない）
 * R_b はビート単位の共有値なので `R_b − H_b` はレーン単独の H で引く（= 上限側に保守的・厳しい側）。
 */
function residByBeatFor(c, src) {
  const m = new Map();
  for (const row of c.meas.timeline) {
    if (typeof row?.beat !== "number") continue;
    let sp = 0;
    for (const l of LANES) {
      const t = src.get(`${row.beat}:${l}`);
      if (t !== undefined) sp += parseK(t) ?? 0;
    }
    const bgs = typeof row.beat_gained_score === "number" ? row.beat_gained_score : 0;
    m.set(row.beat, Math.max(0, bgs - sp));
  }
  return m;
}

/** 1 基準ぶんの Σpop / 隠れ枠 を作る */
function popBasis(c, basis) {
  const popSum = [0, 0, 0, 0, 0];
  const cells = [0, 0, 0, 0, 0];
  const src = new Map();
  if (basis === "inline") {
    for (const [k, t] of c.inl) src.set(k, t);
  } else {
    for (const [k, v] of c.merged) src.set(k, v.text);
  }
  for (const [k, t] of src) {
    const li = Number(k.split(":")[1]) - 1;
    const val = parseK(t);
    if (val === null) continue;
    popSum[li] += val;
    cells[li]++;
  }
  return { src, popSum, cells };
}

function rowsFor(c, basis, sim) {
  const { src, popSum, cells } = popBasis(c, basis);
  const residByBeat = residByBeatFor(c, src);
  const out = [];
  for (const l of LANES) {
    const li = l - 1;
    const laneTotal = c.meas.laneTotals?.[li] ?? null;
    const hiddenCap = laneTotal === null ? null : laneTotal - popSum[li];
    let simRead = 0;
    let simHidden = 0;
    let symNum = 0;
    let hiddenCells = 0;
    let readCells = 0;
    if (sim !== null) {
      for (const [k, v] of Object.entries(sim.cells ?? {})) {
        const [b, ls] = k.split(":");
        if (Number(ls) !== l) continue;
        if (src.has(`${b}:${l}`)) {
          simRead += v;
          readCells++;
          const pop = parseK(src.get(`${b}:${l}`)) ?? 0;
          const E = Math.max(0, v - pop);
          if (E > 0) {
            const R = residByBeat.get(Number(b)) ?? 0;
            symNum += Math.min(E, R); // H_b = 0（可読セルなので同ビート同レーンの不能分は無い）
          }
        } else {
          simHidden += v;
          symNum += v;
          hiddenCells++;
        }
      }
    }
    out.push({
      tag: c.tag,
      lane: l,
      basis,
      popSum: popSum[li],
      popCells: cells[li],
      laneTotal,
      hiddenCap,
      simRead,
      simHidden,
      /** 【A14/A1】対称化した分子（≥ simHidden）。分母・閾値は不変 */
      symNum,
      hiddenCells,
      readCells,
      ratio: hiddenCap === null || hiddenCap <= 0 ? null : simHidden / hiddenCap,
      /** 【A14/A1】対称比 = symNum / 隠れ枠（分母は現行と同一） */
      ratioSym: hiddenCap === null || hiddenCap <= 0 ? null : symNum / hiddenCap,
      /** 診断用（判定には使わない）: 可読セルへの配置比 = sim(可読)/Σpop */
      readRatio: popSum[li] > 0 && sim !== null ? simRead / popSum[li] : null,
      /** 【A14/A4】検査3 用の内訳 */
      simRead,
      popSumLane: popSum[li],
      simLaneTotal: sim === null ? null : simRead + simHidden,
      /** 【A12 タスク2】レーン合計の未説明分 = 実測レーン合計 − sim レーン合計（正 = sim が不足） */
      laneDeficit: laneTotal === null || sim === null ? null : laneTotal - (simRead + simHidden),
    });
  }
  return out;
}

const allRows = [];
for (const sd of simDocs.length > 0 ? simDocs : [{ gate: null, sim: null }]) {
  say(
    `\n########## 検査2: 隠れセル比 — photo-gate=${sd.gate ?? "（sim なし）"}` +
      `${sd.gate === "off" ? "（素の既定: goldenPhotoNames を渡さない）" : sd.gate === "on" ? "（受け入れ経路: T5 名でゲート）" : ""} ##########`,
  );
  if (sd.gate === "off") {
    say("  ※ F3 前はこのモードで T5 のフォトスキルが素通りし、S3 L5 に過剰配置が出る（A8 の 7.69×）。");
  }
  for (const c of ctx) {
    const sim = sd.sim === null ? null : (sd.doc?.samples?.[c.tag] ?? null);
    const rowsM = rowsFor(c, "merged", sim);
    const rowsI = c.inl.size > 0 ? rowsFor(c, "inline", sim) : [];
    for (const r of rowsM) allRows.push({ ...r, gate: sd.gate });
    for (const r of rowsI) allRows.push({ ...r, gate: sd.gate });
    say(
      `  ${c.tag}: sim 合計 ${fmt(sim?.totalScore ?? null)}` +
        (sim === null ? "" : `（mode=${sd.doc.mode}）`),
    );
    say(
      "   レーン| Σpop(統合)|読込| レーン合計| 隠れ枠(統合)|sim(隠れ・統合)|  比| Σpop(内生)| 隠れ枠(内生)|sim(隠れ・内生)|  比| " +
        "sim(隠れセル数)| sim(可読)/Σpop| 比(対称)| 判定",
    );
    for (const r of rowsM) {
      const ri = rowsI.find((x) => x.lane === r.lane) ?? null;
      const worst =
        ri === null || ri.ratio === null
          ? r.ratio
          : r.ratio === null
            ? ri.ratio
            : Math.max(r.ratio, ri.ratio);
      /* 【A14/A1】判定は対称比（分母・閾値は不変・新分子 ≥ 旧分子）で行う */
      const worstSym =
        ri === null || ri.ratioSym === null
          ? r.ratioSym
          : r.ratioSym === null
            ? ri.ratioSym
            : Math.max(r.ratioSym, ri.ratioSym);
      const judge =
        worstSym === null
          ? "n/a"
          : worstSym >= 2
            ? "FAIL"
            : worstSym >= 1.5
              ? "WARN"
              : r.hiddenCells <= 0
                ? "OK(下対象外)"
                : r.laneDeficit !== null && r.laneDeficit <= 0
                  ? "OK(説明済)"
                  : LOW_GATE === "off"
                    ? "OK"
                    : worstSym <= 0.25
                      ? "FAIL(下)"
                      : worstSym <= 0.5
                        ? "WARN(下)"
                        : "OK";
      say(
        `      L${r.lane}  | ${pad(fmt(r.popSum), 10)} | ${pad(r.popCells, 4)} | ${pad(fmt(r.laneTotal), 10)} | ` +
          `${pad(fmt(r.hiddenCap), 13)} | ${pad(fmt(r.simHidden), 17)} | ${pad(r.ratio === null ? "n/a" : r.ratio.toFixed(2), 4)} | ` +
          `${pad(ri === null ? "-" : fmt(ri.popSum), 10)} | ${pad(ri === null ? "-" : fmt(ri.hiddenCap), 12)} | ` +
          `${pad(ri === null ? "-" : fmt(ri.simHidden), 14)} | ${pad(ri === null || ri.ratio === null ? "-" : ri.ratio.toFixed(2), 4)} | ` +
          `${pad(r.hiddenCells, 14)} | ${pad(r.readRatio === null ? "-" : r.readRatio.toFixed(3), 13)} | ` +
          `${pad(worstSym === null ? "n/a" : worstSym.toFixed(2), 8)} | ${judge}`,
      );
      if (worst !== null && worstSym !== null && Math.abs(worstSym - worst) > 1e-9) {
        const symRow = (r.ratioSym ?? -1) >= (ri?.ratioSym ?? -1) ? r : ri;
        say(
          `          └ 対称分子の内訳: sim(不能) ${fmt(symRow.simHidden)} + 可読セル超過の実測証明分 ${fmt(symRow.symNum - symRow.simHidden)}` +
            ` = ${fmt(symRow.symNum)}（現行分子 ${fmt(symRow.simHidden)}・分母は共通 ${fmt(symRow.hiddenCap)}）`,
        );
      }
    }
  }
}

// ---------------------------------------------------- 判定（全 mode × 全 basis の最悪）
/** 【A14/A1】判定は **対称比**（symNum / 隠れ枠）で行う。分母・閾値は現行と同一。
 *  現行比（simHidden / 隠れ枠）も worstByLane に残して併記する（差分の監査用）。 */
const worstByLane = new Map();
const worstSymByLane = new Map();
for (const r of allRows) {
  const key = `${r.tag} L${r.lane}`;
  if (r.ratio !== null) {
    const cur = worstByLane.get(key);
    if (cur === undefined || r.ratio > cur.ratio) worstByLane.set(key, r);
  }
  if (r.ratioSym !== null) {
    const cur = worstSymByLane.get(key);
    if (cur === undefined || r.ratioSym > cur.ratioSym) worstSymByLane.set(key, r);
  }
}
/** 【A12 タスク2】下側の最悪値 = 最小比。**分母（隠れ枠）が「未検証セルの実体」を表し、
 *  かつレーン合計が未説明（実測 > sim）の行だけ**を対象にする:
 *   - hiddenCells==0 → 隠れ枠は K 表記切り捨ての残差のみ（0 除算同然の比）
 *   - laneDeficit<=0 → sim がレーン合計を説明済み（過剰配置側）。低比は「配分の偏り」であって
 *     「実測を説明できていない」ではない（例: S1 L2 は可読比 1.10・レーン比 1.06）
 */
const lowWorstByLane = new Map();
for (const r of allRows) {
  if (r.ratioSym === null || r.hiddenCells <= 0) continue;
  if (r.laneDeficit === null || r.laneDeficit <= 0) continue;
  const key = `${r.tag} L${r.lane}`;
  const cur = lowWorstByLane.get(key);
  if (cur === undefined || r.ratioSym < cur.ratioSym) lowWorstByLane.set(key, r);
}
const fails = [...worstSymByLane.values()].filter((r) => r.ratioSym >= 2);
const warns = [...worstSymByLane.values()].filter((r) => r.ratioSym >= 1.5 && r.ratioSym < 2);
const lowFails = [...lowWorstByLane.values()].filter((r) => r.ratioSym <= 0.25);
const lowWarns = [...lowWorstByLane.values()].filter((r) => r.ratioSym > 0.25 && r.ratioSym <= 0.5);
const noHidden = [...worstSymByLane.values()].filter((r) => r.hiddenCells <= 0);
/** 下側の対象から外れたレーン（レーン合計を説明済み = sim ≥ 実測） */
const lowExcludedExplained = [...worstSymByLane.values()].filter(
  (r) => r.hiddenCells > 0 && r.laneDeficit !== null && r.laneDeficit <= 0,
);
/** 【A14/A1】対称化で判定が変わったレーン（現行比 → 対称比）の監査表示 */
const legacyOf = (r) => worstByLane.get(`${r.tag} L${r.lane}`)?.ratio ?? null;
say("\n########## 判定（photo-gate × Σpop 基準 の全組み合わせの最悪値） ##########");
say(
  "  ※ 【A14/A1】判定の分子は**対称化**した（分母 = レーン合計 − Σpop と閾値は現行と同一）。",
);
say(
  "     分子 = sim(pop 不能セル) + min( 可読セルの sim 超過, そのビートの実測未記録額 )。",
);
say(
  "     実測側の分母には「pop が読めているセルの未表示分」（例: S3 b2 L3 の A スキル約 2.11M）も",
);
say(
  "     入るため、sim 側でも同額を未検証として数える（min ≥ 0 なので**上側は厳しくなる方向のみ**）。",
);
say(
  `  FAIL（比 ≥ 2.0）= ${fails.length} 件` +
    (fails.length === 0
      ? ""
      : `: ${fails.map((r) => `${r.tag} L${r.lane} ${r.ratioSym.toFixed(2)}×（現行比 ${fmtRatio(legacyOf(r))}）`).join(" / ")}`),
);
say(
  `  WARN（1.5 ≤ 比 < 2.0）= ${warns.length} 件` +
    (warns.length === 0
      ? ""
      : `: ${warns.map((r) => `${r.tag} L${r.lane} ${r.ratioSym.toFixed(2)}×（現行比 ${fmtRatio(legacyOf(r))}）`).join(" / ")}`),
);
say(
  `  【下側】FAIL（比 ≤ 0.25）= ${lowFails.length} 件` +
    (lowFails.length === 0
      ? ""
      : `: ${lowFails.map((r) => `${r.tag} L${r.lane} ${r.ratioSym.toFixed(2)}×（現行比 ${fmtRatio(legacyOf(r))}）`).join(" / ")}`) +
    `（扱い=${LOW_GATE}）`,
);
say(
  `  【下側】WARN（0.25 < 比 ≤ 0.5）= ${lowWarns.length} 件` +
    (lowWarns.length === 0
      ? ""
      : `: ${lowWarns.map((r) => `${r.tag} L${r.lane} ${r.ratioSym.toFixed(2)}×（現行比 ${fmtRatio(legacyOf(r))}）`).join(" / ")}`),
);
say(
  `  【下側】対象外（pop 読込不能セル 0 = 隠れ枠が切り捨て残差のみ）= ${noHidden.length} レーン: ` +
    noHidden.map((r) => `${r.tag} L${r.lane}（残差 ${fmt(r.hiddenCap)}）`).join(" / "),
);
say(
  `  【下側】対象外（レーン合計を説明済み = sim ≥ 実測。低比は配分の偏り）= ${lowExcludedExplained.length} レーン: ` +
    lowExcludedExplained
      .map((r) => `${r.tag} L${r.lane}（比 ${r.ratioSym.toFixed(2)}×・レーン比 ${r.simLaneTotal === null || r.laneTotal === null ? "n/a" : (r.simLaneTotal / r.laneTotal).toFixed(3)}）`)
      .join(" / "),
);
for (const r of lowFails) {
  say(
    `    [FAIL(下)] ${r.tag} L${r.lane}（photo-gate=${r.gate} / Σpop=${r.basis}）: 分子(対称) ${fmt(r.symNum)} / ` +
      `隠れ枠 ${fmt(r.hiddenCap)} = ${r.ratioSym.toFixed(2)}×（sim(不能) ${fmt(r.simHidden)} + 可読超過の実測証明分 ${fmt(r.symNum - r.simHidden)}・` +
      `現行比 ${fmtRatio(legacyOf(r))}・隠れセル ${r.hiddenCells} セル・` +
      `sim レーン合計 ${fmt(r.simLaneTotal)} / 実測レーン合計 ${fmt(r.laneTotal)}・` +
      `sim が実測レーン合計のうち ${fmt(r.laneTotal === null || r.simLaneTotal === null ? null : r.laneTotal - r.simLaneTotal)} を説明できていない）`,
  );
}
// 下側比の一覧（A12 タスク2 の要求: 他サンプルの分布を見てから閾値を 1 つ決める）
say("  -- 下側比の一覧（最小比 = 統合×最悪 photo-gate。可読比 = sim(可読)/Σpop・レーン比 = sim レーン合計/実測レーン合計） --");
const lowListAll = new Map();
for (const r of [...lowWorstByLane.values(), ...lowExcludedExplained, ...noHidden]) lowListAll.set(`${r.tag} L${r.lane}`, r);
for (const r of [...lowListAll.values()].sort((a, b) => a.ratioSym - b.ratioSym)) {
  const rr = allRows
    .filter((x) => x.tag === r.tag && x.lane === r.lane && x.readRatio !== null)
    .map((x) => x.readRatio);
  const judged = lowWorstByLane.get(`${r.tag} L${r.lane}`) !== undefined;
  say(
    `    ${r.tag} L${r.lane} | 比(対称) ${r.ratioSym.toFixed(3)}× | 比(現行) ${fmtRatio(legacyOf(r))} | 可読比 ${rr.length === 0 ? "n/a" : (rr.reduce((a, b) => a + b, 0) / rr.length).toFixed(3)} | ` +
      `レーン比 ${r.laneTotal === null || r.simLaneTotal === null ? "n/a" : (r.simLaneTotal / r.laneTotal).toFixed(3)}` +
      `（sim ${fmt(r.simLaneTotal)} / 実測 ${fmt(r.laneTotal)}・未説明 ${fmt(r.laneDeficit)}） | ` +
      `${judged ? "判定対象" : "参考（下側の対象外）"}`,
  );
}
for (const r of fails) {
  say(
    `    [FAIL] ${r.tag} L${r.lane}（photo-gate=${r.gate} / Σpop=${r.basis}）: 分子(対称) ${fmt(r.symNum)} / ` +
      `隠れ枠 ${fmt(r.hiddenCap)} = ${r.ratioSym.toFixed(2)}×（sim(不能) ${fmt(r.simHidden)}・現行比 ${fmtRatio(legacyOf(r))}・隠れセル ${r.hiddenCells} セル・` +
      `sim レーン合計 ${fmt(r.simLaneTotal)} / 実測レーン合計 ${fmt(r.laneTotal)}）`,
  );
}
// 2× を超えた行を全て列挙する（最悪値だけだと A8 の口径との照合ができないため）
const overRows = allRows.filter((r) => r.ratioSym !== null && r.ratioSym >= 2);
if (overRows.length > 0) {
  say("  -- 比(対称) ≥ 2.0 の全行（photo-gate × Σpop 基準） --");
  for (const r of overRows) {
    say(
      `    ${r.tag} L${r.lane} | photo-gate=${r.gate} | Σpop=${r.basis} | 分子(対称) ${fmt(r.symNum)} / ` +
        `隠れ枠 ${fmt(r.hiddenCap)} = ${r.ratioSym.toFixed(2)}×（現行比 ${fmtRatio(r.ratio)}・sim(不能) ${fmt(r.simHidden)}・隠れセル ${r.hiddenCells}）`,
    );
  }
}

// ---------------------------------------------------- 検査4: スタミナ系列（--ledger）
let ledgerFail = 0;
if (WITH_LEDGER) {
  say("\n########## 検査4: スタミナ系列の全ビート一致（--ledger・A6 と同一規約） ##########");
  say("  sim = engine の staminaAfter[beat] / 実測 = timeline[].lanes[].current_stamina[beat]");
  // 受け入れ経路（on）があればそれを使う。S1 は deck 側で photo-L* を無効化しているため off=on。
  const use = simDocs.find((d) => d.gate === "on") ?? simDocs[0] ?? null;
  if (use === null) {
    say("  sim ダンプなし → 省略");
  } else {
    say(`  使用 sim: photo-gate=${use.gate ?? "file"}`);
    for (const c of ctx) {
      const sim = use.doc.samples?.[c.tag] ?? null;
      if (sim === null) {
        say(`  ${c.tag}: sim ダンプなし → 省略`);
        continue;
      }
      for (const l of LANES) {
        let n = 0;
        let ok = 0;
        const bad = [];
        for (const row of c.meas.timeline) {
          if (typeof row?.beat !== "number") continue;
          const measV = laneRead(row, l)?.current_stamina;
          const simV = sim.staminaAfter?.[`${row.beat}:${l}`];
          if (typeof measV !== "number" || typeof simV !== "number") continue;
          n++;
          if (Math.round(measV) === Math.round(simV)) ok++;
          else if (bad.length < 6) bad.push(`b${row.beat}(sim ${fmt(simV)} / 実測 ${fmt(measV)})`);
        }
        const must = c.tag === "S1" && l === 1;
        const pass = n > 0 && ok === n;
        if (must && !pass) ledgerFail++;
        say(
          `    ${c.tag} L${l}: 一致 ${ok}/${n}（${n === 0 ? "-" : ((100 * ok) / n).toFixed(1)}%）` +
            `${pass ? " 完全一致" : ` 不一致例 ${bad.join(" ")}`}${must ? "  ← 受け入れ必須（S1 L1 = 100%）" : ""}`,
        );
      }
    }
  }
}

// ---------------------------------------------------- 検査3（A14/A4）: 可読セル比
/**
 * 【Phase 16 Action14 / A4】`sim(可読セル) / Σpop` を正式なゲートに昇格。
 *
 * 意味: 検査2 は「pop が読めないセル」だけを見るため、**可読セルの配分がずれている**
 * ケース（sim が可読セルに実測より少なく置いている = S2 L3、多く置いている = S3 L5）を
 * 検出できない。実測 Σpop は K/M 表記の切り捨てで最大 +0.6%（K 単位）しか過小評価しないので、
 * 比が 1 から大きく離れていれば測定誤差では説明できない。
 *
 * 閾値（15 レーンの実測分布から決定。**検査2 の分母・閾値は一切動かしていない**）:
 *   実測分布（S1/S2/S3 × 5 レーン・30 行=15 レーン×2 photo-gate）: min 0.953 / max 1.103
 *   → 比 ≥ 1.20 = FAIL(可読) ／ 1.07〜1.20 = WARN(可読)
 *      比 ≤ 0.80 = FAIL(可読・下) ／ 0.80〜0.93 = WARN(可読・下)
 *   上側 FAIL は検査2 と同様に exit へ効く。下側 FAIL は `--low-gate` の扱いに従う。
 */
const READ_FAIL_HI = 1.2;
const READ_WARN_HI = 1.07;
const READ_WARN_LO = 0.93;
const READ_FAIL_LO = 0.8;
const readWorst = new Map();
for (const r of allRows) {
  if (r.basis !== "merged" || r.readRatio === null) continue;
  const k = `${r.tag} L${r.lane}`;
  const cur = readWorst.get(k);
  if (cur === undefined || Math.abs(r.readRatio - 1) > Math.abs(cur.readRatio - 1)) readWorst.set(k, r);
}
const readAll = [...readWorst.values()].sort((a, b) => Math.abs(b.readRatio - 1) - Math.abs(a.readRatio - 1));
const readHiFails = readAll.filter((r) => r.readRatio >= READ_FAIL_HI);
const readLoFails = readAll.filter((r) => r.readRatio <= READ_FAIL_LO);
const readWarns3 = readAll.filter(
  (r) =>
    !readHiFails.includes(r) &&
    !readLoFails.includes(r) &&
    (r.readRatio >= READ_WARN_HI || r.readRatio <= READ_WARN_LO),
);
say("\n########## 検査3: 可読セル比 = sim(可読セル) / Σpop（A14/A4 で追加） ##########");
say(
  `  閾値: 比 ≥ ${READ_FAIL_HI.toFixed(2)} = FAIL ／ ${READ_WARN_HI.toFixed(2)}〜 = WARN ／ ` +
    `${READ_WARN_LO.toFixed(2)}〜${READ_WARN_HI.toFixed(2)} = OK ／ 〜${READ_WARN_LO.toFixed(2)} = WARN(下) ／ ≤ ${READ_FAIL_LO.toFixed(2)} = FAIL(下)`,
);
for (const r of readAll) {
  const v =
    r.readRatio >= READ_FAIL_HI
      ? "FAIL"
      : r.readRatio <= READ_FAIL_LO
        ? "FAIL(下)"
        : r.readRatio >= READ_WARN_HI
          ? "WARN"
          : r.readRatio <= READ_WARN_LO
            ? "WARN(下)"
            : "OK";
  say(
    `   ${r.tag} L${r.lane}（photo-gate=${r.gate}）: sim(可読) ${fmt(r.simRead ?? null)} / Σpop ${fmt(r.popSumLane ?? null)} = ` +
      `${r.readRatio.toFixed(3)}× [${v}]`,
  );
}
say(`  検査3 集計: FAIL ${readHiFails.length + readLoFails.length} 件（上 ${readHiFails.length} / 下 ${readLoFails.length}） / WARN ${readWarns3.length} 件`);

// ---------------------------------------------------- まとめ
say("\n########## まとめ ##########");
say(`  検査1（実測の閉包）: ${closureFail === 0 ? "OK" : `要確認 ${closureFail} 件`}`);
say(
  `  検査2（隠れセル比・上側）: FAIL ${fails.length} 件 / WARN ${warns.length} 件` +
    (fails.length === 0 ? "" : `（最大 ${Math.max(...fails.map((r) => r.ratioSym)).toFixed(2)}×）`),
);
say(
  `  検査2（隠れセル比・下側 = sim が実測を説明できていない）: FAIL ${lowFails.length} 件 / WARN ${lowWarns.length} 件` +
    (lowFails.length === 0 ? "" : `（最小 ${Math.min(...lowFails.map((r) => r.ratioSym)).toFixed(2)}×）`) +
    `（扱い=${LOW_GATE}）`,
);
if (WITH_LEDGER) say(`  検査4（スタミナ系列・S1 L1 必須）: ${ledgerFail === 0 ? "OK" : "FAIL"}`);
say(
  `  検査3（可読セル比・A14/A4）: FAIL ${readHiFails.length + readLoFails.length} 件（上 ${readHiFails.length} / 下 ${readLoFails.length}） / WARN ${readWarns3.length} 件` +
    (readAll.length === 0 ? "" : `（最悪 ${readAll[0].readRatio.toFixed(3)}× = ${readAll[0].tag} L${readAll[0].lane}）`),
);
const upperFail =
  fails.length > 0 || ledgerFail > 0 || closureFail > 0 || readHiFails.length > 0;
const lowFail =
  (LOW_GATE === "fail" && lowFails.length > 0) || (LOW_GATE === "fail" && readLoFails.length > 0);
const gateFail = upperFail || lowFail;
say(
  `  上側ゲート: ${upperFail ? "FAIL（隠れセル過剰配置または系列不一致あり）" : "PASS"}` +
    (fails.length > 0 ? " — 閾値は緩めない（§8）" : ""),
);
say(
  `  下側ゲート: ${LOW_GATE === "off" ? "未判定（--low-gate=off）" : lowFails.length === 0 ? "PASS" : LOW_GATE === "warn" ? `WARN 止まり（${lowFails.length} 件・exit に効かない）` : `FAIL（${lowFails.length} 件・sim が実測を説明できていないレーン）`}`,
);
say(`  ゲート結果: ${gateFail ? "FAIL" : "PASS"}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");
console.log(`\n[out] ${path.relative(REPO, OUT)}`);
if (gateFail) process.exitCode = 1;

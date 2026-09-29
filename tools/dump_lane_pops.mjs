// レーン別スコアポップの受け入れ検査（read-only・依存パッケージなし）
// 使い方: node tools/dump_lane_pops.mjs [S1,S2,S3,S4]   （既定: S1,S2,S3 / リポジトリ直下から実行）
//
// 目的 1（AGENTS.md の規律の実効検査）: 「レーン別スコアポップ（gained_score_pop）を全ビート×全レーン
//   記録する」が守れているかをサンプル別に数える。5 レーン合計（beat_gained_score）では各レーンの乱数が
//   平均化されるため、基本係数 λ・off-attr 扱い・フォト重複規則の検証はレーン別ポップなしでは不可能
//   （research/23 pack_v2/05）。読める件数が少ないサンプルはその検証能力そのものを失っている。
//
// 目的 2（記録の整合性）: 「レーンポップ合計 / スコアバー増分（beat_gained_score）」を
//   **ポップが読めたレーン数 n で層別化**して出す。n=5 の層が ~1.0 に収まることをもって記録の整合とみなす。
//   n<5 の層が 1.0 を下回るのは欠測レーン分の単純不足なので異常ではない（層を混ぜて語ると
//   「スキル発動ビートは pop が足りない」のような誤った異常 catalog が生まれた）。
//
// 注意: 表示値は +38.6K のような 0.1K 刻み**切り捨て**なので、中値推定は +50/ポップ した値も併記する
import fs from "node:fs";
import path from "node:path";

const NOX = path.join("..", "aipura_nox");
const DIRS = {
  S1: "サンプル1",
  S2: "サンプル2",
  S3: "サンプル3",
  S4: "サンプル4_invalid_capture_20260905",
};
const MEAS_CANDIDATES = ["measured_data_v3.json", "measured_data_v2.json", "measured_data.json"];
const POP_FILE = "lane_pops_backfill.json";

/** "+38.6K" → 38600（表示値＝切り捨て下界）。読めなければ null */
function parseK(text) {
  const m = /^\+([\d.]+)K$/.exec(String(text ?? "").trim());
  return m === null ? null : Math.round(Number(m[1]) * 1000);
}
const intStr = (n) => Math.round(n).toLocaleString("en-US");

/** measured_data_v*.json と lane_pops_backfill.json から "beat:lane" → {value, src} を統合する */
function collectPops(dir) {
  const map = new Map();
  let measFile = null;
  let timeline = [];
  for (const f of MEAS_CANDIDATES) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!Array.isArray(doc.timeline)) continue;
    measFile = f;
    timeline = doc.timeline;
    for (const e of timeline) {
      for (const [lane, L] of Object.entries(e.lanes ?? {})) {
        const g = L?.gained_score_pop;
        const v = parseK(typeof g === "string" ? g : g?.text);
        if (v !== null) map.set(`${e.beat}:${lane}`, { value: v, src: f });
      }
    }
    break; // 新しい方が正。それ以降は読まない
  }
  let summary = null;
  let fromPopFile = 0;
  const p = path.join(dir, POP_FILE);
  if (fs.existsSync(p)) {
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    summary = doc.summary ?? null;
    for (const x of doc.pops ?? []) {
      const v = parseK(x.displayed);
      if (v === null) continue;
      const k = `${x.beat}:${x.lane}`;
      if (map.has(k)) continue;
      map.set(k, { value: v, src: POP_FILE });
      fromPopFile += 1;
    }
  }
  return { map, measFile, timeline, summary, fromPopFile };
}

const tags = (process.argv[2] ?? "S1,S2,S3")
  .split(",")
  .map((s) => s.trim().toUpperCase().replace(/^サンプル/, "S").replace(/^SAMPLE/, "S"))
  .filter((s) => s.length > 0);

for (const tag of tags) {
  const dirName = DIRS[tag];
  if (dirName === undefined) {
    console.log(`${tag}: 不明なサンプルタグ（対応: ${Object.keys(DIRS).join(" / ")}）`);
    continue;
  }
  const dir = path.join(NOX, dirName);
  console.log(`\n=== ${tag}（${dirName}） ===`);
  if (!fs.existsSync(dir)) {
    console.log(`  ディレクトリが見つからない: ${dir}`);
    continue;
  }
  const { map, measFile, timeline, summary, fromPopFile } = collectPops(dir);
  if (measFile === null) {
    console.log("  measured_data_v*.json が見つからない（timeline を読めない）");
    continue;
  }
  const nBeats = timeline.length;
  console.log(
    `  出所: ${measFile}（timeline ${nBeats} ビート）+ ${POP_FILE}` +
      ` ／ 統合後のポップ = ${map.size} セル（backfill 側のみの寄与 ${fromPopFile}）`,
  );

  // --- 目的 1: レーン別の記録被覆率 ---
  const perLane = new Map();
  for (const key of map.keys()) {
    const lane = Number(key.split(":")[1]);
    perLane.set(lane, (perLane.get(lane) ?? 0) + 1);
  }
  for (const lane of [1, 2, 3, 4, 5]) {
    const n = perLane.get(lane) ?? 0;
    console.log(`    L${lane}: ${String(n).padStart(3)} / ${nBeats} ビート（${((n / nBeats) * 100).toFixed(1)}%）`);
  }
  const allFive = timeline.filter((e) =>
    [1, 2, 3, 4, 5].every((l) => map.has(`${e.beat}:${l}`)),
  ).length;
  console.log(
    `    5レーン揃って読めたビート: ${allFive} / ${nBeats}` +
      (allFive < nBeats * 0.2 ? "   ← ★ 検証能力が弱い（レーン別 λ・off-attr 検証が難しい）" : ""),
  );
  if (summary !== null) {
    console.log(
      `    ${POP_FILE} summary: readable=${summary.readable ?? "-"} no_pop=${summary.no_pop ?? "-"} ` +
        `no_frame=${summary.no_frame ?? "-"} blocked=${summary.blocked ?? "-"} unreadable=${summary.unreadable ?? "-"}`,
    );
  }

  // --- 目的 2: popΣ / barΣ を「読めたレーン数 n」で層別化する ---
  const rows = [];
  for (const e of timeline) {
    const gain = e.beat_gained_score;
    if (typeof gain !== "number" || gain <= 0) continue;
    let sum = 0;
    let n = 0;
    for (const l of [1, 2, 3, 4, 5]) {
      const hit = map.get(`${e.beat}:${l}`);
      if (hit === undefined) continue;
      sum += hit.value;
      n += 1;
    }
    if (n === 0) continue;
    rows.push({
      beat: e.beat,
      sum,
      n,
      gain,
      ratio: sum / gain,
      hasAct: Array.isArray(e.skill_activations) ? e.skill_activations.length > 0 : false,
    });
  }
  const fmt = (rs) => {
    if (rs.length === 0) return "n=0";
    const sum = rs.reduce((a, r) => a + r.sum, 0);
    const gain = rs.reduce((a, r) => a + r.gain, 0);
    const cnt = rs.reduce((a, r) => a + r.n, 0);
    const sorted = rs.map((r) => r.ratio).sort((a, b) => a - b);
    return (
      `popΣ/barΣ 表示値 ${(sum / gain).toFixed(4)} / 中値補正 ${((sum + 50 * cnt) / gain).toFixed(4)}` +
      ` / 中央値 ${sorted[Math.floor(sorted.length / 2)].toFixed(3)} / 範囲 ${sorted[0].toFixed(3)}〜${sorted[sorted.length - 1].toFixed(3)}  n=${rs.length}`
    );
  };
  for (const nLane of [5, 4, 3, 2, 1]) {
    const rs = rows.filter((r) => r.n === nLane);
    if (rs.length === 0) continue;
    console.log(`  [${nLane}レーン読めたビート] ${fmt(rs)}`);
    if (nLane === 5) {
      for (const [label, f] of [
        ["    スキル発動なし", (r) => !r.hasAct],
        ["    スキル発動あり", (r) => r.hasAct],
      ]) {
        console.log(`  ${label}: ${fmt(rs.filter(f))}`);
      }
    }
  }
  const five = rows.filter((r) => r.n === 5);
  if (five.length > 0) {
    const bad = [...five].sort((a, b) => Math.abs(1 - b.ratio) - Math.abs(1 - a.ratio)).slice(0, 6);
    console.log("    5レーン層で乖離の大きいビート（上位6）:");
    for (const r of bad) {
      console.log(
        `      b${String(r.beat).padStart(3)} bar=${intStr(r.gain).padStart(9)} popΣ=${intStr(r.sum).padStart(9)} ratio=${r.ratio.toFixed(3)}${r.hasAct ? " [act]" : ""}`,
      );
    }
  }
}
console.log(
  "\n注: popΣ は表示値（0.1K 切り捨て）の合計。中値補正は +50/ポップ。barΣ は measured_data の beat_gained_score（5レーン合計）",
);
console.log("    n<5 の層が 1.0 を下回るのは欠測レーン分の単純不足。判定は n=5 の層で行うこと");


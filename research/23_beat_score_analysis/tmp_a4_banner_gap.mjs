// Phase 16 アクション4: 「スキルバナーがレーンのノートポップを隠す」現象の全数検査（read-only）
//
// 使い方: node research/23_beat_score_analysis/tmp_a4_banner_gap.mjs   （リポジトリ直下から実行）
// 出力: tmp_a4_banner_gap_out.txt（本検査の証拠。再実行で再生成可）
//
// 仮説（phase16_action2d_lane_pops_audit.md §2 の「S3 は発動あり 3 件だけ popΣ/barΣ が 0.83〜0.91」の真因）:
//   スキル発動ビートでバナーが表示されたレーンでは、そのレーンのノートポップが記録に残らない
//   （frames 側で null になるか、バナーの数値がそのレーンの pop 欄に上書きされる）。
//   → バー（beat_gained_score）と pop 合計の差 = 隠れたノートポップ 1 本ぶんに一致するはず。
//
// 検査: 全サンプル・全ビートについて
//   gap = beat_gained_score − Σ(読めたレーンポップの中値)        ※中値 = 表示値 +50（0.1K 切り捨て補正）
// を出し、|gap| が切り捨て誤差の上限（5 ポップで 500）を超えるビートを列挙する。
//   lanes[k].banner_skill != null … そのビートにスキルバナーが表示されたレーン（証拠画像の裏付け）
//   lanes[k].gained_score_pop == null … ポップが読めなかったレーン（= 隠れた候補）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");

const SAMPLES = [
  { tag: "S1", dir: path.join(noxRoot, "サンプル1") }, // pop の text は lane_pops_backfill.json 側のみ
  { tag: "S2", dir: path.join(noxRoot, "サンプル2") }, // measured_data_v3 に pop が入っている（research 側の写しは pop 無し）
  { tag: "S3", dir: path.join(repoRoot, "research/26_data_integrity"), meas: "measured_data_s3_v3.json" },
  { tag: "S4", dir: path.join(noxRoot, "サンプル4_invalid_capture_20260905") },
];
const MEAS_CANDIDATES = ["measured_data_v3.json", "measured_data_v2.json", "measured_data.json"];
const POP_FILE = "lane_pops_backfill.json";

/** "+38.6K" / "+2.3M" → 38600 / 2300000（表示値＝切り捨ての下界）。読めなければ null */
function parseK(text) {
  const s = String(text ?? "").trim();
  const m = /^\+([\d.]+)([KM])$/.exec(s);
  if (m === null) return null;
  const v = Number(m[1]) * (m[2] === "M" ? 1_000_000 : 1_000);
  return Math.round(v);
}
const intStr = (n) => Math.round(n).toLocaleString("en-US");

function loadSample({ tag, dir, meas }) {
  let measFile = meas ?? null;
  let doc = null;
  if (measFile !== null) {
    doc = JSON.parse(fs.readFileSync(path.join(dir, measFile), "utf8"));
  } else {
    for (const f of MEAS_CANDIDATES) {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) continue;
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      if (!Array.isArray(d.timeline)) continue;
      measFile = f;
      doc = d;
      break;
    }
  }
  if (doc === null || !Array.isArray(doc.timeline)) return null;
  // pop の統合（measured_data 側優先 → lane_pops_backfill.json で補完）
  const pops = new Map();
  for (const e of doc.timeline) {
    for (const [lane, L] of Object.entries(e.lanes ?? {})) {
      const g = L?.gained_score_pop;
      const v = parseK(typeof g === "string" ? g : g?.text);
      if (v !== null) pops.set(`${e.beat}:${lane}`, v);
    }
  }
  const popPath = path.join(dir, POP_FILE);
  if (fs.existsSync(popPath)) {
    const bd = JSON.parse(fs.readFileSync(popPath, "utf8"));
    for (const x of bd.pops ?? []) {
      const v = parseK(x.displayed);
      if (v === null) continue;
      const k = `${x.beat}:${x.lane}`;
      if (!pops.has(k)) pops.set(k, v);
    }
  }
  return { tag, measFile, timeline: doc.timeline, pops };
}

console.log("=== スキルバナーとレーンポップ欠落の全数検査（gap = bar − Σpop中値） ===");
for (const cfg of SAMPLES) {
  const s = loadSample(cfg);
  if (s === null) {
    console.log(`\n### ${cfg.tag}: measured_data を読めない（${cfg.dir}）`);
    continue;
  }
  const rows = [];
  for (const e of s.timeline) {
    const bar = typeof e.beat_gained_score === "number" ? e.beat_gained_score : null;
    if (bar === null) continue;
    const lanes = e.lanes ?? {};
    const bannerLanes = [];
    const nullLanes = [];
    let sum = 0;
    let n = 0;
    for (const l of [1, 2, 3, 4, 5]) {
      const L = lanes[String(l)];
      if (L === undefined) continue;
      const raw = L.gained_score_pop;
      const rawText = typeof raw === "string" ? raw : (raw?.text ?? null);
      // 統合済み pop（measured 側 → lane_pops_backfill.json 側の順で補完）を使う
      const v = s.pops.get(`${e.beat}:${l}`) ?? parseK(rawText);
      const shown = rawText ?? (v === null ? "null" : `+${(v / 1000).toFixed(1)}K(bf)`);
      if (v === null) nullLanes.push({ lane: l, shown });
      else {
        sum += v + 50; // 中値補正
        n += 1;
      }
      if (L.banner_skill != null && String(L.banner_skill).length > 0) {
        bannerLanes.push({ lane: l, skill: String(L.banner_skill), rec: shown });
      }
    }
    rows.push({ beat: e.beat, bar, sum, n, gap: bar - sum, bannerLanes, nullLanes });
  }
  const total = rows.reduce((a, r) => a + r.bar, 0);
  const flagged = rows.filter((r) => Math.abs(r.gap) > 600);
  const five = flagged.filter((r) => r.n === 5);
  const positives = flagged.filter((r) => r.gap > 0);
  const negatives = flagged.filter((r) => r.gap < 0);
  const sumPos = positives.reduce((a, r) => a + r.gap, 0);
  const sumNeg = negatives.reduce((a, r) => a + r.gap, 0);
  const bannerBeats = rows.filter((r) => r.bannerLanes.length > 0);
  const nullWith = rows.flatMap((r) =>
    r.nullLanes.filter((x) => r.bannerLanes.some((b) => b.lane === x.lane)),
  );
  const nullWithout = rows.flatMap((r) =>
    r.nullLanes.filter((x) => !r.bannerLanes.some((b) => b.lane === x.lane)),
  );
  console.log(
    `\n### ${s.tag}（${s.measFile} / ${rows.length} ビート / 総スコア ${intStr(total)} / 統合 pop ${s.pops.size} セル）`,
  );
  console.log(
    `  bar−Σpop が ±600 を超えるビート ${flagged.length}（5レーン読めた ${five.length} 件・他 ${flagged.length - five.length} 件）` +
      ` ／ 正 ${positives.length} 件 計 +${intStr(sumPos)}・負 ${negatives.length} 件 計 ${intStr(sumNeg)}`,
  );
  console.log(
    `  バナー付きビート ${bannerBeats.length} ／ 読めなかったレーン: バナーあり ${nullWith.length} セル・バナーなし ${nullWithout.length} セル`,
  );
  // 5 レーン読めたのに乖離するビート（= 真の異常候補）を全件、次にバナー付きの乖離ビートを列挙
  const show = [...five, ...flagged.filter((r) => r.n < 5 && r.bannerLanes.length > 0)];
  for (const r of show) {
    const banner = r.bannerLanes.map((b) => `L${b.lane}「${b.skill}」rec=${b.rec}`).join(" / ");
    const nls = r.nullLanes.map((x) => `L${x.lane}`).join(",");
    console.log(
      `    b${String(r.beat).padStart(3)}${r.n === 5 ? " [n=5]" : ""} bar=${intStr(r.bar).padStart(9)}` +
        ` Σpop中値=${intStr(r.sum).padStart(9)} gap=${(r.gap >= 0 ? "+" : "") + intStr(r.gap)} n=${r.n}` +
        `${nls.length > 0 ? ` null=[${nls}]` : ""}${banner.length > 0 ? ` バナー: ${banner}` : ""}`,
    );
  }
  const rest = flagged.length - show.length;
  if (rest > 0) {
    console.log(`    （他 ${rest} 件は n<5 かつバナーなし = フレーム側の欠測。未読レーンの単純不足）`);
  }
}
console.log(
  "\n注: Σpop中値 は表示値（0.1K 切り捨て）×読めたレーン数 + 50/ポップ。実際の表示値 ≥ 中値 ≥ 表示値−100 なので\n" +
    "    gap>+600 は切り捨て誤差では説明できない（バー側に記録されていない得点がある）。",
);

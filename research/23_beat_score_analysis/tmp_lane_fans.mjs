// レーン別スコアボーナス（fan.png で読んだレーン別来場数）と
// マスタ表 data/stages/audience_advantage.json の表引き値の突合。
// 実行: node research/23_beat_score_analysis/tmp_lane_fans.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const table = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "data/stages/audience_advantage.json"), "utf8"),
);

/** 来場ファン数 -> ボーナス%（(advantagePermil - 1000) / 10） */
function bonusPct(n) {
  let lo = 0,
    hi = table.length - 1,
    found = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (table[m].audience <= n) {
      found = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  const permil = found < 0 ? 1000 : table[found].advantagePermil;
  return (permil - 1000) / 10;
}

// fan.png（research/23_beat_score_analysis/fanband_S*_1320.png を 10倍拡大して直接読取）
//   [レーン別 来場ファン数, 表示スコアボーナス%]
const OBS = {
  S1: [[19, 0.2], [19, 0.2], [18, 0.2], [22, 0.2], [22, 0.2]],
  S2: [[11996, 53.9], [13543, 57.0], [13741, 57.4], [13255, 56.5], [13496, 56.9]],
  S3: [[8515, 37.5], [7748, 37.5], [8535, 37.5], [8518, 37.5], [6684, 37.5]],
  S4: [[7795, 37.5], [8126, 37.5], [8161, 37.5], [7721, 37.5], [8197, 37.5]],
  S5: [[13835, 57.6], [10782, 51.5], [13840, 57.6], [11817, 53.6], [11290, 52.5]],
};

// 会場キャパ（cap/5 が「※最大」の引数）— vendor/Quest.json maxCapacity で確定済み
const CAP = {
  S1: 100,     // qt-area-1-001
  S2: 70000,   // qt-tower-680
  S3: 40000,   // qt-ex-tower-005-045 (STAGE045)
  S4: 40000,   // qt-ex-tower-005-054 (STAGE054)
  S5: 80000,   // qt-tower-686 (STAGE686)
};

let failNaive = 0;
let failRule = 0;
for (const key of Object.keys(OBS)) {
  const rows = OBS[key];
  const sum = rows.reduce((a, r) => a + r[0], 0);
  const avg = Math.round(sum / 5);
  const cap = CAP[key];
  const cap5 = cap / 5;
  const full = sum >= cap; // 満員（来場合計 >= 会場キャパ）
  console.log(
    `\n=== ${key}: 来場合計 ${sum} / cap ${cap} = 充足率 ${((sum / cap) * 100).toFixed(1)}% ${full ? "→ 満員" : "→ 空席あり"} ／ ※最大 +${bonusPct(cap5).toFixed(1)}%（=f(cap/5)）`,
  );
  for (const [fans, shown] of rows) {
    const naive = bonusPct(fans); // 素朴なレーン別表引き
    const rule = full ? bonusPct(cap5) : bonusPct(fans); // 満員一律ルール
    const okNaive = Math.abs(naive - shown) < 0.05;
    const okRule = Math.abs(rule - shown) < 0.05;
    if (!okNaive) failNaive++;
    if (!okRule) failRule++;
    console.log(
      `  ${String(fans).padStart(6)}人 表示+${shown.toFixed(1)}% ｜素朴レーン引き +${naive.toFixed(1)}% ${okNaive ? "✅" : "❌"} ｜満員一律ルール +${rule.toFixed(1)}% ${okRule ? "✅" : "❌"}`,
    );
  }
  const laneSpread =
    Math.max(...rows.map((r) => 1000 + r[1] * 10)) / Math.min(...rows.map((r) => 1000 + r[1] * 10));
  const avgFactor = 1000 + bonusPct(avg) * 10;
  const maxDev = Math.max(...rows.map((r) => Math.abs((1000 + r[1] * 10) / avgFactor - 1)));
  console.log(
    `  → 表示レーン係数 最大/最小 = ${laneSpread.toFixed(4)} ／ 平均代表値 +${bonusPct(avg).toFixed(1)}% からの最大偏差 = ±${(maxDev * 100).toFixed(2)}%`,
  );
}
console.log(
  `\n素朴レーン別表引きの不一致 ${failNaive}/25 ／ 満員一律ルールの不一致 ${failRule}/25`,
);

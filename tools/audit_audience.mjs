/**
 * audience（来場ファン数）入力監査 — 新規サンプル撮影時の受け入れ検査【Phase 16-A2b・2026-09-30】
 *
 * 背景: サンプル1 の deck.json audience = 71000 は観客数ではなく qt-area-1-001 の
 * **目標スコア clear = 71000**（左上スコア表示 18,780,790/71,000 の右辺）の誤読だった。
 * fan はテーブル上限 2000‰ にクラップして全スコアが約 2.27 倍化し、解析を +127% 誤誘導した。
 *
 * 判定規則は tools/analyze_beat_score_models.ts の resolveAudience() と同一:
 *   NG（自動補正される）: 宣言値 == 目標スコア clear / 宣言値 > 会場キャパ cap → cap/5 に置換
 *   注意（宣言値を採用）: 宣言値 > cap/5（ゲーム側の個人来場数上限との矛盾。fan.png を再確認）
 *   OK: それ以外
 * 参考: S3 の fan.png 実測 8,000 は cap 40,000/5 と完全一致（cap/5 が実際の上限である傍証）
 *
 * 実行:
 *   node tools/audit_audience.mjs                       … 既知サンプルを全件
 *   node tools/audit_audience.mjs <deck.json> ...       … 任意 deck を指定（その場合 --stage= は必須）
 *   node tools/audit_audience.mjs <deck.json> --stage=qt-tower-680
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repo = "C:/Users/umaro/Documents/アイプラ";
const nox = "C:/Users/umaro/Documents/aipura_nox";
const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

const table = read(path.join(repo, "data/stages/audience_advantage.json"));
const fan = (a) => {
  let v = 1000;
  for (const r of table) if (r.audience <= a) v = r.advantagePermil;
  return v;
};
const idx = read(path.join(repo, "data/stages_index.json"));
const stageInfo = (id) => {
  if (typeof id !== "string" || id === "") return null;
  const q = idx.quests?.find((x) => x.id === id);
  if (q === undefined) return null;
  return { clear: q.clear, cap: idx.configs?.[q.c]?.cap };
};

/** deck.json に stage id が無いサンプルについて、解析ツール側で確定済みのステージ ID */
const KNOWN = [
  { name: "サンプル1", deck: "サンプル1/deck.json", stage: "qt-area-1-001" },
  { name: "サンプル2", deck: "サンプル2/deck.json", stage: "qt-tower-680" },
  { name: "サンプル3", deck: "サンプル3/deck.json", stage: "qt-ex-tower-005-045" },
  { name: "サンプル4", deck: "サンプル4/deck.json", stage: "qt-ex-tower-005-045" },
];

const args = process.argv.slice(2);
const forcedStage = args.find((a) => a.startsWith("--stage="))?.slice("--stage=".length);
const targets =
  args.filter((a) => !a.startsWith("--")).length > 0
    ? args
        .filter((a) => !a.startsWith("--"))
        .map((p) => ({ name: path.basename(path.dirname(path.resolve(p))) || p, deck: path.resolve(p), stage: forcedStage }))
    : KNOWN.map((k) => ({ ...k, deck: path.join(nox, k.deck) }));

console.log("audience 監査（cap/5 = ゲーム側の個人来場数上限・fan テーブル上限は audience 50,000 で 2000‰）\n");
let ng = 0;
for (const t of targets) {
  if (!existsSync(t.deck)) {
    console.log(`  ${t.name.padEnd(11)} SKIPPED: deck.json 無し → ${t.deck}`);
    continue;
  }
  const cfg = read(t.deck);
  const stage = cfg?.stage?.id ?? cfg?.stage_id ?? cfg?.stageFile ?? t.stage;
  const declared = cfg?.stage?.audience ?? cfg?.audience ?? cfg?.config?.audience;
  const info = stageInfo(stage);
  const head = `  ${t.name.padEnd(11)} stage=${String(stage ?? "不明").padEnd(21)}`;
  if (typeof declared !== "number") {
    console.log(`${head} audience=未宣言 → OK（エンジンが cap/5 から導出）`);
    continue;
  }
  if (info === null || typeof info.cap !== "number") {
    console.log(`${head} audience=${declared} fan=${fan(declared)}‰ → 監査不能（ステージ情報なし。--stage= を指定）`);
    continue;
  }
  const perSeat = Math.floor(info.cap / 5);
  let verdict = "OK";
  if (declared === info.clear) {
    verdict = `NG: 目標スコア clear=${info.clear} と同一（誤読）→ ${perSeat}人に自動補正`;
    ng += 1;
  } else if (declared > info.cap) {
    verdict = `NG: 会場キャパ cap=${info.cap} 超過（物理的矛盾）→ ${perSeat}人に自動補正`;
    ng += 1;
  } else if (declared > perSeat) {
    verdict = `注意: cap/5 上限 ${perSeat}人 を超過（宣言値を採用・fan.png を再確認）`;
  }
  console.log(
    `${head} audience=${String(declared).padStart(7)} fan=${String(fan(declared) + "‰").padStart(7)} ` +
      `cap=${String(info.cap).padStart(6)} cap/5=${String(perSeat).padStart(6)} → ${verdict}`,
  );
}
console.log(`\nNG（自動補正対象）: ${ng} 件 / 対象 ${targets.length} 件`);
console.log(
  "\n規則: deck.json の audience は「個人（レーン平均）来場数」= fan.png のレーン別来場数5件の平均" +
    "\n      （= 見出しの合計来場数 ÷ 5・上限 capacity/5）。合計をそのまま入れると 5 倍過大になる。" +
    "\n      目標スコア（左上表示の右辺 = stage.clear）を audience に入れるのは禁止（サンプル1 で実害）。",
);


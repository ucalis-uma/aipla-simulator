/**
 * 単一HTML UI ビルダー（Phase 4）。
 *
 * - esbuild で ui/app.ts（計算コア src/ を含む）を IIFE バンドル
 * - data/ の JSON と T5 実測プリセット（スコア分析サンプル/verification_data_v2.json）を
 *   <script type="application/json"> として埋め込み
 * - ui/index.template.html との差し込み結果を dist/aipura_simulator.html に出力
 *   （単一ファイル・file:// 直開きで動作）
 *
 * 実行: npm run build:ui
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(path.join(repoRoot, p), "utf-8"));

const uiData = {
  data: {
    cards: read("data/cards.json").cards,
    cardParameters: read("data/card_parameters.json").rows,
    skillsGolden: read("data/skills_golden.json").skills,
    stages: { "qt-daily-003-19": read("data/stages/qt-daily-003-19.json") },
    charts: { "chart-hsm-004-001": read("data/charts/chart-hsm-004-001.json") },
    audienceAdvantage: read("data/stages/audience_advantage.json"),
  },
  sampleDeck: read("スコア分析サンプル/verification_data_v2.json"),
  calibratedMental: { 1: 105, 2: 102, 3: 104, 4: 103, 5: 101 },
  defaultMissedNotes: [1, 2, 3, 4, 5].map((lane) => ({ beat: 1, lane })),
  stageFile: "qt-daily-003-19",
  chartFile: "chart-hsm-004-001",
  builtAt: new Date().toISOString(),
};

const result = await esbuild.build({
  entryPoints: [path.join(repoRoot, "ui/app.ts")],
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  write: false,
  logLevel: "warning",
});
const appJs = result.outputFiles[0].text;
if (appJs.includes("</script")) {
  throw new Error("bundled JS contains </script> — escaping required");
}

const css = readFileSync(path.join(repoRoot, "ui/style.css"), "utf-8");
const template = readFileSync(path.join(repoRoot, "ui/index.template.html"), "utf-8");
const dataJson = JSON.stringify(uiData).replaceAll("<", "\\u003c");

const html = template
  .replace("/*%APP_CSS%*/", () => css)
  .replace("/*%APP_JS%*/", () => appJs)
  .replace("%DATA_JSON%", () => dataJson);

mkdirSync(path.join(repoRoot, "dist"), { recursive: true });
const outPath = path.join(repoRoot, "dist/aipura_simulator.html");
writeFileSync(outPath, html, "utf-8");
console.log(
  `built: ${outPath} (${(html.length / 1024).toFixed(0)} KB, js ${(appJs.length / 1024).toFixed(0)} KB, data ${(dataJson.length / 1024).toFixed(0)} KB)`,
);

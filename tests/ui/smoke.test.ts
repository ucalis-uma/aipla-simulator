/**
 * 単一HTML UI のヘッドレススモークテスト（jsdom）。
 *
 * dist/aipura_simulator.html（npm run build:ui の成果物）を読み込み、
 * バンドル済みアプリ JS を実行して以下を検証する:
 *   1. 編成パネル（5レーン・カード 491 件）が描画される
 *   2. シミュレーション実行ボタンで結果（KPI・レーン別内訳・タイムライン）が描画される
 *   3. 確定値が CLI / テストと同一値（2,501,593,723）になる
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** jsdom は canvas 非対応のため 2D コンテキストをスタブする */
beforeAll(() => {
  const noop = (): void => undefined;
  HTMLCanvasElement.prototype.getContext = ((): unknown => ({
    scale: noop,
    clearRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fillText: noop,
  })) as never;
});

function loadApp(): void {
  const html = readFileSync(path.join(repoRoot, "dist/aipura_simulator.html"), "utf-8");
  document.documentElement.innerHTML = html;
  // 最後の <script>（アプリ本体）を取り出して実行（embedded-data の JSON script は除く）
  const scripts = [...document.querySelectorAll("script")].filter(
    (s) => s.id !== "embedded-data" && !s.type.includes("json"),
  );
  expect(scripts.length).toBe(1);
  new Function(scripts[0]!.textContent ?? "")();
}

describe("単一HTML UI スモーク", () => {
  loadApp();

  it("編成パネルが描画される（5レーン・カード 491 件・スキル/フォト一覧）", () => {
    const cards = document.querySelectorAll(".lane-card");
    expect(cards.length).toBe(5);
    const options = document.querySelectorAll('.lane-card[data-lane="3"] select[data-act="card"] option');
    expect(options.length).toBe(491);
    // T5 プリセットの L3 は fest-03
    const l3card = document.querySelector<HTMLSelectElement>('.lane-card[data-lane="3"] select[data-act="card"]');
    expect(l3card?.value).toBe("card-chs-05-fest-03");
    // スキルとフォトのチェックボックス
    expect(document.querySelectorAll('.lane-card[data-lane="3"] input[data-skill]').length).toBeGreaterThan(3);
    // デッキ値プレビューが計算済み
    const preview = document.querySelector("#deck-preview-3")!.textContent ?? "";
    expect(preview).toContain("626,223");
  });

  it("シミュレーション実行で KPI・レーン別内訳・タイムラインが描画され、確定値が一致する", () => {
    const runs = document.querySelector<HTMLInputElement>("#g-runs")!;
    runs.value = "10";
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "").startsWith("完了")).toBe(true);
    expect((document.querySelector("#results") as HTMLElement).hidden).toBe(false);
    const kpi = document.querySelector("#kpi-root")!.textContent ?? "";
    expect(kpi).toContain("確定値");
    expect(kpi).toContain("2,501,593,723");
    // レーン別内訳 5 行
    expect(document.querySelectorAll("#lane-table tbody tr").length).toBe(5);
    // タイムライン 156 ビート
    expect(document.querySelectorAll("#timeline-table tbody tr").length).toBe(156);
    // バフヒートマップに選択キー行が存在
    expect(document.querySelectorAll("#buff-heatmap tbody tr").length).toBeGreaterThan(3);
  });

  it("ファンファクター表示が来場者数テーブルと一致する（16,000 → 1620‰）", () => {
    expect(document.querySelector("#g-fan")!.textContent).toContain("1,620");
  });
});

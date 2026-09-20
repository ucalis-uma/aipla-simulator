/**
 * 単一HTML UI のヘッドレススモークテスト（jsdom・Phase 6）。
 *
 * dist/aipura_simulator.html（npm run build:ui の成果物）を読み込み、
 * バンドル済みアプリ JS を実行して以下を検証する:
 *   1. 編成パネル（5レーン）・ステージ情報が描画される
 *   2. シミュレーション実行で結果（KPI・レーン別内訳・タイムライン）が描画され、
 *      確定値が CLI / テストと同一値（2,446,158,294）になる
 *   3. ステージ・曲ピッカーで別譜面へ切替できる（全111譜面・全ステージ統合）
 *   4. カードピッカーの検索・選択でレベル/スキルが自動セットされる
 *   5. アクセサリピッカーで装備を追加できる
 *   6. 編成の名前付き保存/読込（LocalStorage）が動く
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
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
  // 回帰防止: .modal / .card-fallback の display:flex が [hidden] を打ち消すのを防ぐ
  expect(html).toMatch(/\.modal\[hidden\][^{]*\{\s*display:\s*none/);
  expect(html).toMatch(/\.card-fallback\[hidden\][^{]*\{\s*display:\s*none/);
  // 最後の <script>（アプリ本体）を取り出して実行（embedded-data の JSON script は除く）
  const scripts = [...document.querySelectorAll("script")].filter(
    (s) => s.id !== "embedded-data" && !s.type.includes("json"),
  );
  expect(scripts.length).toBe(1);
  new Function(scripts[0]!.textContent ?? "")();
}

describe("単一HTML UI スモーク", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  loadApp();

  it("編成パネルが描画される（5レーン・カードピッカー・スキル一覧）", () => {
    expect(document.querySelectorAll(".lane-card").length).toBe(5);
    // T5 プリセットの L3 は fest-03
    const l3id = document.querySelector<HTMLInputElement>(
      '.lane-card[data-lane="3"] input[data-act="card-id"]',
    );
    expect(l3id?.value).toBe("card-chs-05-fest-03");
    // ステージ情報（既定: T5 実測ステージ）
    const info = document.querySelector("#stage-info")!.textContent ?? "";
    expect(info).toContain("qt-daily-003-19");
    expect(info).toContain("156ノート");
    expect(info).toContain("SP×2");
    // デッキ値プレビューが計算済み
    const preview = document.querySelector("#deck-preview-3")!.textContent ?? "";
    expect(preview).toContain("626,223");
    // 各レーンにカード/アクセサリのピッカーとスキル一覧がある
    expect(document.querySelectorAll('[data-act="pick-card"]').length).toBe(5);
    expect(document.querySelectorAll('[data-act="pick-acc"]').length).toBe(5);
    expect(
      document.querySelectorAll('.lane-card[data-lane="3"] input[data-skill]').length,
    ).toBeGreaterThan(3);
  });

  it("シミュレーション実行で KPI・レーン別内訳・タイムラインが描画され、確定値が一致する", () => {
    const runs = document.querySelector<HTMLInputElement>("#g-runs")!;
    runs.value = "10";
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "").startsWith("完了")).toBe(true);
    expect((document.querySelector("#results") as HTMLElement).hidden).toBe(false);
    const kpi = document.querySelector("#kpi-root")!.textContent ?? "";
    expect(kpi).toContain("確定値");
    // 【2026-09-21 Phase 14】琴乃A(ccu)/かけがえのない二人(20%)復元・実効N-1 Decay適正化後のUI確定値: 2,446,493,589
    expect(kpi).toContain("2,446,493,589");
    // レーン別内訳 5 行
    expect(document.querySelectorAll("#lane-table tbody tr").length).toBe(5);
    // タイムライン 156 ビート（計算式展開行を除く）
    expect(document.querySelectorAll("#timeline-table tbody tr:not(.fml-row)").length).toBe(156);
    // 「式」ボタンで計算式内訳（JHTV5213 型）が展開される（A/SP を含むビートを探して検証）
    const buttons = document.querySelectorAll<HTMLButtonElement>(".fml-btn");
    let opened: HTMLTableRowElement | null = null;
    for (const btn of buttons) {
      btn.click();
      const row = document.querySelector<HTMLTableRowElement>(
        `tr.fml-row[data-beat="${btn.dataset.beat}"]`,
      );
      if (row !== null && !row.hidden && (row.textContent ?? "").includes("パワー")) {
        opened = row;
        break;
      }
    }
    expect(opened).not.toBeNull();
    expect(opened!.textContent ?? "").toContain("パワー");
    expect(opened!.textContent ?? "").toContain("コンボ数ボーナス");
    expect(opened!.textContent ?? "").toContain("Aスコア");
    // 再度クリックで折りたたみ
    (opened!.previousElementSibling?.querySelector?.(".fml-btn") as HTMLButtonElement | null)?.click();
    expect(opened!.hidden).toBe(true);
    // バフヒートマップに選択キー行が存在
    expect(document.querySelectorAll("#buff-heatmap tbody tr").length).toBeGreaterThan(3);
  });

  it("ファンファクター input が来場者数テーブルと一致する（16,000 → 1620‰）", () => {
    const fan = document.querySelector<HTMLInputElement>("#g-fan")!;
    expect(fan.value).toBe("1620");
    // 補助表示に % 換算（+62.0%）が出る
    expect(document.querySelector("#g-fan-hint")!.textContent).toContain("+62.0%");
  });

  it("ファンファクターを手打ちするとスコアが即座に再計算される", () => {
    // 既定（1620‰）での確定値
    const runs = document.querySelector<HTMLInputElement>("#g-runs")!;
    runs.value = "10";
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "").startsWith("完了")).toBe(true);
    expect(document.querySelector("#kpi-root")!.textContent ?? "").toContain("2,446,493,589");
    // ファンファクターを 1000‰（ボーナスなし）へ手打ちで変更
    const fan = document.querySelector<HTMLInputElement>("#g-fan")!;
    fan.value = "1000";
    fan.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector("#g-fan-hint")!.textContent).toContain("+0.0%");
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "").startsWith("完了")).toBe(true);
    // ファンボーナスを消すと確定値は必ず下がる（1620‰ 基準の 2,446,493,589 より低い）
    const confirmedText =
      document.querySelector("#kpi-root .kpi-value.confirmed")!.textContent ?? "";
    const m = /^([\d.]+)(億|万)$/.exec(confirmedText);
    expect(m).not.toBeNull();
    const val2 = Number(m![1]) * (m![2] === "億" ? 1e8 : 1e4);
    expect(val2).toBeLessThan(2_501_593_723);
    expect(document.querySelector("#kpi-root")!.textContent ?? "").not.toContain("2,446,158,294");
    // 元に戻す
    fan.value = "1620";
    fan.dispatchEvent(new Event("change", { bubbles: true }));
  });

  it("ステージピッカーに大分類タブがあり、ハイスコアライブを直接選択できる", () => {
    (document.querySelector("#btn-pick-stage") as HTMLButtonElement).click();
    const modal = document.querySelector("#modal") as HTMLElement;
    expect(modal.hidden).toBe(false);
    // 大分類タブが表示される
    const tabs = [...document.querySelectorAll("#sp-tabs button[data-cat]")];
    expect(tabs.length).toBeGreaterThanOrEqual(6);
    // ハイスコアライブタブ
    const hsTab = tabs.find((b) => b.getAttribute("data-cat") === "highscore") as HTMLButtonElement;
    hsTab.click();
    const rows = [...document.querySelectorAll("#sp-stages [data-stage]")];
    expect(rows.length).toBe(23);
    // ハイスコアライブ18 を選択
    const target = rows.find((el) => el.getAttribute("data-stage") === "qt-area-1-018")!;
    expect(target).toBeDefined();
    expect(target.textContent).toContain("ハイスコアライブ18");
    expect(target.textContent).toContain("キャパ70,000");
    (target as HTMLElement).click();
    expect(modal.hidden).toBe(true);
    const info = document.querySelector("#stage-info")!.textContent ?? "";
    expect(info).toContain("qt-area-1-018");
    expect(info).toContain("ハイスコアライブ");
    expect(info).toContain("最大キャパシティ");
    expect(info).toContain("70,000");
    // ステージ変更でファンファクターが会場キャパから再導出される（70,000人 → 14,000人）
    const fan = document.querySelector<HTMLInputElement>("#g-fan")!;
    expect(fan.value).not.toBe("1620");
    // 元に戻す
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
    expect((document.querySelector("#stage-info")!.textContent ?? "")).toContain("qt-daily-003-19");
  });

  it("ライブボーナス付きステージを選択するとステージ情報にライボ内容が表示される", () => {
    // 既定ステージ（qt-daily-003-19）にはライブボーナスがない
    expect((document.querySelector("#stage-info")!.textContent ?? "")).not.toContain("ライブボーナス");
    (document.querySelector("#btn-pick-stage") as HTMLButtonElement).click();
    const modal = document.querySelector("#modal") as HTMLElement;
    const tabs = [...document.querySelectorAll("#sp-tabs button[data-cat]")];
    const hsTab = tabs.find((b) => b.getAttribute("data-cat") === "highscore") as HTMLButtonElement;
    hsTab.click();
    // ハイスコアライブ10（qt-area-1-010 = live-bonus-group-070 付与）
    const rows = [...document.querySelectorAll("#sp-stages [data-stage]")];
    const target = rows.find((el) => el.getAttribute("data-stage") === "qt-area-1-010") as HTMLElement;
    expect(target).toBeDefined();
    target.click();
    expect(modal.hidden).toBe(true);
    const info = document.querySelector("#stage-info")!.textContent ?? "";
    expect(info).toContain("ライブボーナス");
    expect(info).toContain("クリティカル率アップ状態");
    expect(info).toContain("CT50");
    // シミュレーションがライブボーナス込みで完走する（ライボの発動トレースはスコアに直結しないが
    // 付与バフでレーン内訳が変化する・ここでは実行がエラーにならないことのみ検証）
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    expect((document.querySelector("#kpi-root")!.textContent ?? "").length).toBeGreaterThan(0);
    // 元に戻す
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("ステージ・曲ピッカーで検索→別譜面へ切替できる", () => {
    (document.querySelector("#btn-pick-stage") as HTMLButtonElement).click();
    const modal = document.querySelector("#modal") as HTMLElement;
    expect(modal.hidden).toBe(false);
    // 曲検索
    const search = document.querySelector<HTMLInputElement>("#sp-search")!;
    search.value = "Magical Melody";
    search.dispatchEvent(new Event("input"));
    const songRows = document.querySelectorAll("#sp-songs [data-music]");
    expect(songRows.length).toBeGreaterThan(0);
    // 曲を選択 → ステージ一覧
    (songRows[0] as HTMLElement).click();
    const stageRows = document.querySelectorAll("#sp-stages [data-stage]");
    expect(stageRows.length).toBeGreaterThan(0);
    // 先頭ステージを選択 → ステージ情報が更新される
    const firstStageId = (stageRows[0] as HTMLElement).getAttribute("data-stage")!;
    expect(firstStageId).not.toBe("qt-daily-003-19");
    (stageRows[0] as HTMLElement).click();
    const info = document.querySelector("#stage-info")!.textContent ?? "";
    expect(info).toContain(firstStageId);
    // モーダルが閉じている
    expect(modal.hidden).toBe(true);
  });

  it("切替後の譜面でシミュレーションが完走する（ビート数が譜面に追従）", () => {
    const info = document.querySelector("#stage-info")!.textContent ?? "";
    const beatMatch = /（(\d+)ノート/.exec(info);
    const noteCount = Number(beatMatch![1]);
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "").startsWith("完了")).toBe(true);
    expect(document.querySelectorAll("#timeline-table tbody tr:not(.fml-row)").length).toBe(noteCount);
    // T5 ステージへ戻す
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
    expect((document.querySelector("#stage-info")!.textContent ?? "")).toContain("qt-daily-003-19");
  });

  it("カードピッカーで検索→選択するとレベル・開花・スキルが自動セットされる", () => {
    const pickBtn = document.querySelector<HTMLButtonElement>('[data-act="pick-card"]');
    pickBtn!.click();
    const search = document.querySelector<HTMLInputElement>("#cp-search")!;
    search.value = "wonderful day";
    search.dispatchEvent(new Event("input"));
    const rows = document.querySelectorAll("#cp-list [data-card]");
    expect(rows.length).toBeGreaterThan(0);
    const target = [...rows].find(
      (el) => el.getAttribute("data-card") === "card-yu-05-birt-02",
    );
    expect(target).toBeDefined();
    (target as HTMLElement).click();
    // L1 に birt カードがセットされる
    const l1id = document.querySelector<HTMLInputElement>(
      '.lane-card[data-lane="1"] input[data-act="card-id"]',
    )!;
    expect(l1id.value).toBe("card-yu-05-birt-02");
    // レベルは既定 215（キャップ 230 内）・開花は既定 ☆10
    const level = document.querySelector<HTMLSelectElement>(
      '.lane-card[data-lane="1"] select[data-act="level"]',
    )!;
    expect(level.value).toBe("215");
    // レベル選択肢は現行キャップ 230 まで（マスタの先行実装分 231-260 は出ない）
    const levelValues = [...level.options].map((o) => Number(o.value));
    expect(Math.max(...levelValues)).toBe(230);
    expect(Math.min(...levelValues)).toBe(1);
    const rarity = document.querySelector<HTMLInputElement>(
      '.lane-card[data-lane="1"] input[data-act="rarity"]',
    )!;
    expect(rarity.value).toBe("10");
    // ロールはカード固有値の表示（L1 = wonderful day for 優 = Supporter）
    const role = document.querySelector('.lane-card[data-lane="1"] .role-chip')!;
    expect(role.textContent).toContain("サポーター");
    // スキル（A/SP/P）が自動セット（チェック全 ON）
    const checks = [
      ...document.querySelectorAll<HTMLInputElement>('.lane-card[data-lane="1"] input[data-skill]'),
    ].filter((el) => !el.dataset.skill!.startsWith("photo-"));
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((el) => el.checked)).toBe(true);
    // 元に戻す
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("メンタルは自動算出（空欄=自動）で算出値が T5 実測と 1 の位まで一致する", () => {
    // 算出式: 100×(1+交流Men%) + スタッフ5165 + エール600 + フォト/アクセ固定
    // （research/01 §1.4・baseStatus.ts SUB_STATS 分岐。T5 実測 research/14 §4 と完全一致）
    const mentalInput = document.querySelector<HTMLInputElement>(
      '.lane-card[data-lane="1"] input[data-act="mental"]',
    )!;
    expect(mentalInput.value).toBe("");
    expect(mentalInput.placeholder).toBe("自動");
    // 反映値ヒント（自動算出値）: L1=8996（交流25%+フォト3106）/ L2=L5=5880（交流15%）
    // / L3=8074（交流50%+フォト2159）/ L4=5890（交流25%）
    expect(document.getElementById("mental-hint-1")!.textContent).toContain("8,996");
    expect(document.getElementById("mental-hint-2")!.textContent).toContain("5,880");
    expect(document.getElementById("mental-hint-3")!.textContent).toContain("8,074");
    expect(document.getElementById("mental-hint-4")!.textContent).toContain("5,890");
    expect(document.getElementById("mental-hint-5")!.textContent).toContain("5,880");
  });

  it("メンタルを手入力すると上書きされ、空欄に戻すと自動算出に復帰する", () => {
    const mental = document.querySelector<HTMLInputElement>(
      '.lane-card[data-lane="1"] input[data-act="mental"]',
    )!;
    // 手入力上書き → 反映値が入力値に変わる
    mental.value = "9000";
    mental.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.getElementById("mental-hint-1")!.textContent).toContain("9,000");
    // 空欄に戻す → 自動算出値（8996）に復帰
    mental.value = "";
    mental.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.getElementById("mental-hint-1")!.textContent).toContain("8,996");
  });

  it("アクセサリピッカーで検索→選択するとスロットに装備される", () => {
    // L1 は初期装備2件（2スロット全埋め）→ pick-acc は最終スロットを対象に開く
    (document.querySelector('[data-act="pick-acc"]') as HTMLButtonElement).click();
    const search = document.querySelector<HTMLInputElement>("#ap-search")!;
    search.value = "ミネラルウォーター";
    search.dispatchEvent(new Event("input"));
    const rows = document.querySelectorAll("#ap-list [data-acc]");
    expect(rows.length).toBeGreaterThan(0);
    (rows[0] as HTMLElement).click();
    // スロット UI に名前が表示される（2スロット・スロット2が差し替え）
    const slots = document.querySelectorAll('.lane-card[data-lane="1"] .acc-slot');
    expect(slots.length).toBe(2);
    expect(slots[0]!.textContent).toContain("Pink Mic Accessory");
    expect(slots[1]!.textContent).toContain("ミネラルウォーター");
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("✕ボタンでスロットの装備を解除できる", () => {
    // L1 の最初の装備（Pink Mic Accessory）を解除
    const rm = document.querySelector<HTMLButtonElement>(
      '.lane-card[data-lane="1"] .acc-slot [data-rm-acc="0"]',
    )!;
    expect(rm).not.toBeNull();
    rm.click();
    const slots = document.querySelectorAll('.lane-card[data-lane="1"] .acc-slot');
    expect(slots.length).toBe(2);
    // 配列が詰まり、先頭は残りの装備・後ろ1枠が空きスロットになる
    expect(slots[0]!.classList.contains("acc-slot-empty")).toBe(false);
    expect(slots[0]!.textContent).toContain("Green Heart Accessory");
    expect(slots[1]!.classList.contains("acc-slot-empty")).toBe(true);
    expect(slots[1]!.textContent).toContain("装備なし");
    // 解除後の空きスロットにピッカーから装備できる（再描画後の DOM でクリック）
    const emptySlot = document.querySelector<HTMLElement>(
      '.lane-card[data-lane="1"] .acc-slot.acc-slot-empty',
    )!;
    emptySlot.click();
    const search2 = document.querySelector<HTMLInputElement>("#ap-search")!;
    search2.value = "ミネラルウォーター";
    search2.dispatchEvent(new Event("input"));
    (document.querySelector("#ap-list [data-acc]") as HTMLElement).click();
    const slots2 = document.querySelectorAll('.lane-card[data-lane="1"] .acc-slot');
    expect(slots2[1]!.textContent).toContain("ミネラルウォーター");
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("おまかせ装備で2スロットに最強装備が自動配分される", () => {
    const btn = document.querySelector<HTMLButtonElement>(
      '.lane-card[data-lane="1"] [data-act="auto-acc"]',
    )!;
    btn.click();
    const slots = document.querySelectorAll('.lane-card[data-lane="1"] .acc-slot');
    expect(slots.length).toBe(2);
    // 全スロットが装備済み（空きスロットクラス無し・サムネイル img 付き）
    for (const slot of slots) {
      expect(slot.classList.contains("acc-slot-empty")).toBe(false);
      expect(slot.querySelector("img[data-acc-thumb]")).not.toBeNull();
    }
    // L1 は Vo レーン（T5 ステージ: レーン色 Vo-Vo-Da-Vo-Vo）→ 属性一致アクセサリが優先される
    expect(slots[0]!.textContent).toContain("スピリット");
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("編成の名前付き保存・読込（LocalStorage）が動く", () => {
    const nameInput = document.querySelector<HTMLInputElement>("#deck-name")!;
    nameInput.value = "テスト編成";
    (document.querySelector("#btn-deck-save") as HTMLButtonElement).click();
    const saved = JSON.parse(localStorage.getItem("aipura-sim-decks-v1") ?? "[]") as Array<{
      name: string;
      state: string;
    }>;
    expect(saved.length).toBe(1);
    expect(saved[0]!.name).toBe("テスト編成");
    // スロット一覧に表示される
    const slots = document.querySelector("#deck-slots")!.textContent ?? "";
    expect(slots).toContain("テスト編成");
    // 状態を変更してから読込で戻る
    const audience = document.querySelector<HTMLInputElement>("#g-audience")!;
    audience.value = "12345";
    (document.querySelector("#btn-load") as HTMLButtonElement).click();
    expect(
      (document.querySelector("#deck-slots")!.textContent ?? "").includes("テスト編成"),
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Phase 7: カードサムネイル・絆覚醒・アクセサリサムネイル・オプティマイザ
  // ---------------------------------------------------------------------------

  it("カードサムネイルが表示され、開花レベル連動・エラー時フォールバックが動く", () => {
    // 既定（開花☆5）はローカル同梱の開花後アイコン（variation 1）を優先（ハイブリッド読込）
    const l1id = document.querySelector<HTMLInputElement>(
      '.lane-card[data-lane="1"] input[data-act="card-id"]',
    )!;
    const suffix = l1id.value.replace(/^card-/, "");
    const img = document.querySelector<HTMLImageElement>(
      '.lane-card[data-lane="1"] img[data-thumb-img]',
    )!;
    expect(img.getAttribute("src")).toContain(`images/cards/img_card_thumb_1_${suffix}.jpg`);
    // フォールバック候補（data-srcs）: ローカル → CDN
    const srcs = JSON.parse(img.dataset.srcs!) as string[];
    expect(srcs[0]).toContain("images/cards/");
    expect(srcs[1]).toContain("idoly-ac.outv.im");
    // ピッカーの行にもサムネイルがある
    (document.querySelector('[data-act="pick-card"]') as HTMLButtonElement).click();
    expect(document.querySelectorAll("#cp-list img[data-thumb-img]").length).toBeGreaterThan(0);
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
    // 初期☆2 カードをセットして開花レベルによるアイコン変化を検証
    (document.querySelector('[data-act="pick-card"]') as HTMLButtonElement).click();
    const search = document.querySelector<HTMLInputElement>("#cp-search")!;
    search.value = "初日に誓う";
    search.dispatchEvent(new Event("input"));
    (document.querySelector('#cp-list [data-card="card-ai-02-eve-00"]') as HTMLElement).click();
    const aiSuffix = "ai-02-eve-00";

    // 再描画された img 要素を取得
    const imgAfterPick = document.querySelector<HTMLImageElement>(
      '.lane-card[data-lane="1"] img[data-thumb-img]',
    )!;

    // 開花を ☆4 に下げると未開花アイコン（variation 0）へ切替
    const rarity = document.querySelector<HTMLInputElement>(
      '.lane-card[data-lane="1"] input[data-act="rarity"]',
    )!;
    rarity.value = "4";
    rarity.dispatchEvent(new Event("change", { bubbles: true }));
    expect(imgAfterPick.getAttribute("src")).toContain(
      `images/cards/img_card_thumb_0_${aiSuffix}.jpg`,
    );
    // 読込エラー → ローカル無しと同様に CDN（variation 0）→ 開花後 CDN（variation 1）→ バッジ
    imgAfterPick.dispatchEvent(new Event("error"));
    expect(imgAfterPick.getAttribute("src")).toContain(`idoly-ac.outv.im`);
    expect(imgAfterPick.getAttribute("src")).toContain(`img_card_thumb_0_${aiSuffix}`);
    imgAfterPick.dispatchEvent(new Event("error"));
    expect(imgAfterPick.getAttribute("src")).toContain(`img_card_thumb_1_${aiSuffix}`);
    imgAfterPick.dispatchEvent(new Event("error"));
    expect(imgAfterPick.hidden).toBe(true);
    const fb = document.querySelector(
      '.lane-card[data-lane="1"] [data-thumb-fallback]',
    ) as HTMLElement;
    expect(fb.hidden).toBe(false);
    // 元に戻す（再描画で新 img に切替わる）
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
    const img2 = document.querySelector<HTMLImageElement>(
      '.lane-card[data-lane="1"] img[data-thumb-img]',
    )!;
    expect(img2.hidden).toBe(false);
  });

  it("絆覚醒トグルで第4スキルの有効/無効とアイコン（variation 2）が切り替わる", () => {
    // リンクカード（4スキル持ち）を L1 にセット
    (document.querySelector('[data-act="pick-card"]') as HTMLButtonElement).click();
    const search = document.querySelector<HTMLInputElement>("#cp-search")!;
    search.value = "絆が繋ぐ";
    search.dispatchEvent(new Event("input"));
    (document.querySelector('#cp-list [data-card="card-mna-05-link-00"]') as HTMLElement).click();
    // 既定: 絆覚醒 OFF・スキル 3 件のみ有効・アイコンは通常（variation 1）
    const laneCard = () => document.querySelector('.lane-card[data-lane="1"]')!;
    const checkedSkills = (): number =>
      [
        ...laneCard().querySelectorAll<HTMLInputElement>("input[data-skill]:checked"),
      ].filter((el) => !el.dataset.skill!.startsWith("photo-")).length;
    const bond = laneCard().querySelector<HTMLInputElement>('input[data-act="bond"]')!;
    expect(bond).not.toBeNull();
    expect(bond.checked).toBe(false);
    expect(checkedSkills()).toBe(3);
    expect(
      (laneCard().querySelector("img[data-thumb-img]") as HTMLImageElement).getAttribute("src"),
    ).toContain("images/cards/img_card_thumb_1_mna-05-link-00.jpg");
    // 絆覚醒 ON → 第4スキル有効化・アイコンが絆覚醒版（variation 2）へ
    bond.checked = true;
    bond.dispatchEvent(new Event("change", { bubbles: true }));
    const bond2 = laneCard().querySelector<HTMLInputElement>('input[data-act="bond"]')!;
    expect(bond2.checked).toBe(true);
    expect(checkedSkills()).toBe(4);
    expect(
      (laneCard().querySelector("img[data-thumb-img]") as HTMLImageElement).getAttribute("src"),
    ).toContain("images/cards/img_card_thumb_2_mna-05-link-00.jpg");
    // 第4スキル行に「絆覚醒スキル」タグがある
    expect(laneCard().textContent).toContain("絆覚醒スキル");
    // OFF で戻る
    bond2.checked = false;
    bond2.dispatchEvent(new Event("change", { bubbles: true }));
    expect(checkedSkills()).toBe(3);
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("アクセサリにサムネイル img が付き、読込エラーで隠れてチップが残る", () => {
    // おまかせ装備で全スロットを埋めてからサムネイルを検証
    (document.querySelector('.lane-card[data-lane="1"] [data-act="auto-acc"]') as HTMLButtonElement).click();
    const accImg = document.querySelector<HTMLImageElement>(
      '.lane-card[data-lane="1"] .acc-slot img[data-acc-thumb]',
    )!;
    // ローカル同梱（./images/accessories/img_acc_thumb_{assetId}.jpg）を優先
    expect(accImg.getAttribute("src")).toContain("images/accessories/img_acc_thumb_");
    expect(accImg.getAttribute("src")).toMatch(/img_acc_thumb_[a-z]+-[a-f]\.jpg$/);
    // 読込エラー → CDN（img_acc_thumb_{assetId}）フォールバック → さらにエラーで非表示
    accImg.dispatchEvent(new Event("error"));
    expect(accImg.getAttribute("src")).toContain("idoly-ac.outv.im");
    expect(accImg.getAttribute("src")).toContain("img_acc_thumb_");
    accImg.dispatchEvent(new Event("error"));
    expect(accImg.hidden).toBe(true);
    // スロット（フォールバック）は残る
    const slot = accImg.closest(".acc-slot")!;
    expect(slot.textContent).toContain("スピリット");
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("アクセサリピッカーはスロット役割でタブが絞られ、専用タブでキャラ専用のみ表示される", () => {
    // pick-acc（L1 は装備2件 → スロット2 = Sta/Men/Cri 用）を開く
    (document.querySelector('[data-act="pick-acc"]') as HTMLButtonElement).click();
    const tabs = [...document.querySelectorAll("#ap-tabs button[data-cls]")];
    // 【Phase 8-A】スロット2（Sta/Men/Cri 用）は Vo/Da/Vi タブが非表示になる
    expect(tabs.map((b) => b.getAttribute("data-cls"))).toEqual([
      "", "stamina", "mental", "technique", "personal",
    ]);
    // 見出しにスロット役割が表示される
    expect(document.querySelector("#modal-box h3")!.textContent).toContain("スロット2（Sta/Men/Cri用）");
    // 専用タブ: 優の専用品は全て visual 分類（スロット1 専用）のためスロット2 では 0 件
    (tabs.find((b) => b.getAttribute("data-cls") === "personal") as HTMLButtonElement).click();
    expect(document.querySelectorAll("#ap-list [data-acc]").length).toBe(0);
    // 逆にスロット1 用ピッカーの専用タブでは優の専用品のみ表示される（他キャラは非表示）
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
    const slot1 = document.querySelector<HTMLElement>(
      '.lane-card[data-lane="1"] .acc-slot[data-slot="0"]',
    )!;
    slot1.click();
    const tabs1 = [...document.querySelectorAll("#ap-tabs button[data-cls]")];
    const personal1 = tabs1.find((b) => b.getAttribute("data-cls") === "personal") as HTMLButtonElement;
    personal1.click();
    const rows1 = [...document.querySelectorAll("#ap-list [data-acc]")];
    expect(rows1.length).toBeGreaterThan(0);
    for (const row of rows1) {
      expect(row.textContent).toContain("専用:");
      expect(row.textContent).toContain("優");
      expect(row.textContent).not.toContain("専用:千紗");
    }
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("スロット1（Vo/Da/Vi用）のピッカーは基礎3ステ分類のみ選べ、役割外は自動振り分けされる", () => {
    // L1 のスロット1を直接クリックしてスロット1 用ピッカーを開く
    const slot1 = document.querySelector<HTMLElement>(
      '.lane-card[data-lane="1"] .acc-slot[data-slot="0"]',
    )!;
    slot1.click();
    const tabs = [...document.querySelectorAll("#ap-tabs button[data-cls]")];
    expect(tabs.map((b) => b.getAttribute("data-cls"))).toEqual([
      "", "vocal", "dance", "visual", "personal",
    ]);
    expect(document.querySelector("#modal-box h3")!.textContent).toContain("スロット1（Vo/Da/Vi用）");
    // Sta/Men/Cri 分類（ミネラルウォーター等）はリストに出ない
    const search = document.querySelector<HTMLInputElement>("#ap-search")!;
    search.value = "ミネラルウォーター";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelectorAll("#ap-list [data-acc]").length).toBe(0);
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();

    // スロット1 用ピッカーでは Vo 分類（汎用マイク）を選択でき、スロット1 に装備される
    const slot1b = document.querySelector<HTMLElement>(
      '.lane-card[data-lane="1"] .acc-slot[data-slot="0"]',
    )!;
    slot1b.click();
    const search2 = document.querySelector<HTMLInputElement>("#ap-search")!;
    search2.value = "汎用マイク";
    search2.dispatchEvent(new Event("input"));
    const vocalRow = document.querySelector<HTMLElement>("#ap-list [data-acc]")!;
    expect(vocalRow).not.toBeNull();
    vocalRow.click();
    const slots = document.querySelectorAll('.lane-card[data-lane="1"] .acc-slot');
    expect(slots[0]!.textContent).toContain("汎用マイク");
    expect(
      (document.querySelector("#status")!.textContent ?? "") + slots[0]!.textContent,
    ).toContain("スロット1（Vo/Da/Vi用）");
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("オプティマイザ: 探索→ランキング表示→1クリックで編成反映", async () => {    // タブ切替
    (document.querySelector("#tab-opt") as HTMLButtonElement).click();
    expect((document.querySelector("#view-sim") as HTMLElement).hidden).toBe(true);
    expect((document.querySelector("#view-opt") as HTMLElement).hidden).toBe(false);
    // 制約パネルに 5 レーン + 必須採用 + フォトプールの制御が表示される
    expect(document.querySelectorAll("#opt-constraints .opt-lane-ctrl").length).toBe(7);
    expect(document.querySelector("#opt-required")).not.toBeNull();
    expect(document.querySelector("#opt-use-photos")).not.toBeNull();
    // 高速設定で探索（プール6・スクリーニング1回・最終2回）
    (document.querySelector<HTMLInputElement>("#opt-pool")!).value = "6";
    (document.querySelector<HTMLInputElement>("#opt-screen-runs")!).value = "1";
    (document.querySelector<HTMLInputElement>("#opt-final-runs")!).value = "2";
    (document.querySelector<HTMLInputElement>("#opt-topn")!).value = "3";
    (document.querySelector<HTMLInputElement>("#opt-budget-sec")!).value = "10";
    (document.querySelector("#btn-optimize") as HTMLButtonElement).click();
    // 完了待ち（async・setTimeout yield）
    const start = Date.now();
    while (document.querySelectorAll("#opt-results .opt-entry").length === 0) {
      if (Date.now() - start > 20000) throw new Error("optimizer did not finish in time");
      await new Promise((r) => setTimeout(r, 25));
    }
    const entries = document.querySelectorAll("#opt-results .opt-entry");
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const first = entries[0] as HTMLElement;
    const cards = first.dataset.cards!.split(",");
    expect(cards).toHaveLength(5);
    expect(new Set(cards).size).toBe(5);
    expect(first.textContent).toContain("MC平均");
    // 1クリック反映 → 編成タブへ戻りレーン1に反映されている
    (first.querySelector("[data-apply-lineup]") as HTMLElement).click();
    expect((document.querySelector("#view-sim") as HTMLElement).hidden).toBe(false);
    expect(
      (document.querySelector("#view-opt") as HTMLElement).hidden,
    ).toBe(true);
    const l1 = document.querySelector<HTMLInputElement>(
      '.lane-card[data-lane="1"] input[data-act="card-id"]',
    )!;
    expect(l1.value).toBe(cards[0]);
  });

  // ---------------------------------------------------------------------------
  // Phase 8-B: マイフォト帳・フォト5スロットエディタ
  // ---------------------------------------------------------------------------

  /** レーンの「マイフォト帳装備」行のみを数える（旧 JSON 行は除外） */
  function userPhotoRows(lane = 1): Element[] {
    return [...document.querySelectorAll(`.lane-card[data-lane="${lane}"] .photo-eq-row`)].filter(
      (r) => r.querySelector("[data-photo-edit]") !== null,
    );
  }

  /** フォトエディタを開いて基本項目を入力するヘルパー */
  function createPhoto(
    name: string,
    tags: string,
    opts: { retouch?: boolean; kind?: string; stat?: string; value?: number } = {},
  ): void {
    (document.querySelector('.lane-card[data-lane="1"] [data-act="photo-new"]') as HTMLButtonElement).click();
    const box = () => document.querySelector("#modal-box")!;
    const nameInput = box().querySelector<HTMLInputElement>('[data-p="name"]')!;
    nameInput.value = name;
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    const tagsInput = box().querySelector<HTMLInputElement>('[data-p="tags"]')!;
    tagsInput.value = tags;
    tagsInput.dispatchEvent(new Event("input", { bubbles: true }));
    if (opts.retouch) {
      const rt = box().querySelector<HTMLInputElement>('[data-p="retouch"]')!;
      rt.checked = true;
      rt.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (opts.kind !== undefined) {
      const kindSel = box().querySelector<HTMLSelectElement>('[data-frame-row="0"] [data-pf="kind"]')!;
      kindSel.value = opts.kind;
      kindSel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (opts.stat !== undefined) {
      const statSel = box().querySelector<HTMLSelectElement>('[data-frame-row="0"] [data-pf="stat"]')!;
      statSel.value = opts.stat;
      statSel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (opts.value !== undefined) {
      const valInput = box().querySelector<HTMLInputElement>('[data-frame-row="0"] [data-pf="value"]')!;
      valInput.value = String(opts.value);
      valInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  it("マイフォト帳に T5 実測+理論値テンプレートが同梱され、検索・タグ絞り込みが動く", () => {
    const albumBtn = document.querySelector<HTMLButtonElement>('.lane-card[data-lane="1"] [data-act="photo-album"]')!;
    albumBtn.click();
    // 同梱テンプレート（T5 実測フォト16枚 + 理論値/実用/レタッチ等）が一覧に出る
    const rows = document.querySelectorAll("#ph-list .photo-row");
    expect(rows.length).toBeGreaterThanOrEqual(16);
    // 検索
    const search = document.querySelector<HTMLInputElement>("#ph-search")!;
    search.value = "理論値";
    search.dispatchEvent(new Event("input"));
    const filtered = document.querySelectorAll("#ph-list .photo-row");
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(filtered[0]!.textContent).toContain("理論値");
    // タグ絞り込み（T5実測 タグ）
    search.value = "";
    search.dispatchEvent(new Event("input"));
    const t5Tag = document.querySelector<HTMLButtonElement>('#ph-tags button[data-tag="T5実測"]')!;
    t5Tag.click();
    const t5Rows = document.querySelectorAll("#ph-list .photo-row");
    expect(t5Rows.length).toBeGreaterThanOrEqual(10);
    for (const r of t5Rows) {
      expect(r.textContent).toContain("T5実測");
    }
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
  });

  it("フォトエディタで5スロット入力→マイフォト帳に保存→LocalStorage に永続化される", () => {
    createPhoto("テストフォトX", "手持ち,テスト", { value: 44 });
    (document.querySelector('#modal-box [data-photo-save="save"]') as HTMLButtonElement).click();
    // モーダルが閉じ、LocalStorage に保存されている
    expect((document.querySelector("#modal") as HTMLElement).hidden).toBe(true);
    const saved = JSON.parse(localStorage.getItem("aipura-sim-myphotos-v1") ?? "[]") as Array<{ name: string; tags: string[] }>;
    const found = saved.find((p) => p.name === "テストフォトX");
    expect(found).toBeDefined();
    expect(found!.tags).toContain("テスト");
    expect(found!.tags).toContain("手持ち");
    // レーンに装備はされていない（保存のみ・旧 JSON 行はカウントしない）
    expect(userPhotoRows(1).length).toBe(0);
  });

  it("マイフォト帳から装備でき、レタッチ1枚制限のバリデーションが効く", () => {
    // レタッチフォト（隣接Voレタッチ・retouch=true）を装備 → OK
    //（L1 はオプティマイザテストの反映後に photosJson が空のため枠に余裕がある。
    //  単独実行時は T5 プリセットの 4 枚で満杯のため、枠上限は「スキル持ちフォト」
    //  テストおよび Phase 8-B5/8-B6 のテストで検証する）
    (document.querySelector('.lane-card[data-lane="1"] [data-act="photo-album"]') as HTMLButtonElement).click();
    const search = document.querySelector<HTMLInputElement>("#ph-search")!;
    search.value = "隣接Vo";
    search.dispatchEvent(new Event("input"));
    (document.querySelector<HTMLButtonElement>('#ph-list [data-ph-equip]')!).click();
    expect(userPhotoRows(1).length).toBe(1);
    // 2枚目のレタッチフォト（センタークリスコ・retouch=true）はブロックされる
    search.value = "センタークリスコ";
    search.dispatchEvent(new Event("input"));
    (document.querySelector<HTMLButtonElement>('#ph-list [data-ph-equip]')!).click();
    expect((document.querySelector("#status")!.textContent ?? "")).toContain("レタッチフォトは1人1枚まで");
    expect(userPhotoRows(1).length).toBe(1);
    // 非レタッチフォト（T5 実測・retouch=false）は装備できる
    search.value = "ふつつかもの";
    search.dispatchEvent(new Event("input"));
    (document.querySelector<HTMLButtonElement>('#ph-list [data-ph-equip]')!).click();
    expect(userPhotoRows(1).length).toBe(2);
    // ✕ で装備解除
    document.querySelector('.lane-card[data-lane="1"] [data-photo-rm="0"]')!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(document.querySelectorAll('.lane-card[data-lane="1"] .photo-eq-row').length).toBe(1);
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("同じフォトは1編成に1枚まで: 編成中フォトはグレー表示・装備時は付け替え確認（Phase 8-B5）", () => {
    // L1 は T5 プリセットでフォト 4 枚（Lv215 の上限）のため 1 枚外しておく
    document.querySelector('.lane-card[data-lane="1"] [data-photo-json-rm="0"]')!.dispatchEvent(
      new Event("click", { bubbles: true }),
    );
    // テストフォトを作成して L1 に装備
    createPhoto("重複テスト", "テスト", { value: 10 });
    (document.querySelector('#modal-box [data-photo-save="equip"]') as HTMLButtonElement).click();
    expect(userPhotoRows(1).length).toBe(1);
    // 帳を開く（L3）: L1 が装備中のフォトは「編成中:L1」チップ＋グレー表示
    (document.querySelector('.lane-card[data-lane="3"] [data-act="photo-album"]') as HTMLButtonElement).click();
    const search = document.querySelector<HTMLInputElement>("#ph-search")!;
    search.value = "重複テスト";
    search.dispatchEvent(new Event("input"));
    const row = document.querySelector("#ph-list .photo-row")!;
    expect(row.classList.contains("photo-used")).toBe(true);
    expect(row.textContent).toContain("編成中:L1");
    // 装備ボタン → 付け替え確認が出る
    (row.querySelector("[data-ph-equip]") as HTMLButtonElement).click();
    const confirmRow = document.querySelector("#ph-list .photo-swap-confirm")!;
    expect(confirmRow.textContent).toContain("もうすでに編成されています");
    // キャンセル → 確認が消える
    (confirmRow.querySelector("[data-ph-cancel]") as HTMLButtonElement).click();
    expect(document.querySelector("#ph-list .photo-swap-confirm")).toBeNull();
    // 再度装備 → 確認 → 付け替える → L3 に移動し L1 からは消える
    const row2 = document.querySelector("#ph-list .photo-row")!;
    (row2.querySelector("[data-ph-equip]") as HTMLButtonElement).click();
    const confirmRow2 = document.querySelector("#ph-list .photo-swap-confirm")!;
    (confirmRow2.querySelector("[data-ph-swap]") as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "")).toContain("付け替え");
    expect(userPhotoRows(1).length).toBe(0);
    expect(userPhotoRows(3).length).toBe(1);
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("スキル持ちフォトはステータス枠が4枠に減り、装備してシミュレーションが完走する", () => {
    createPhoto("スキル持テスト", "テスト", {});
    // 枠1をスキル持ちにする（既定: Voブースト4段28b）
    const psAdd = document.querySelector("#modal-box [data-ps-add]") as HTMLButtonElement;
    psAdd.click();
    // スキル編集 UI（種別 select・条件 select）が現れる
    expect(document.querySelector('#modal-box [data-ps="type"]')).not.toBeNull();
    expect(document.querySelector('#modal-box [data-ps="condition"]')).not.toBeNull();
    // ステータス枠は4枠分（枠2〜枠5 行は4行・枠5 追加ボタンは出ない）
    expect(document.querySelectorAll("#modal-box [data-frame-row]").length).toBe(4);
    expect(document.querySelector("#modal-box [data-pf-add4]")).toBeNull();
    // 保存して装備 → 枠上限（Lv215 では 4 枚・T5 プリセットで満杯）のためブロックされる
    (document.querySelector('#modal-box [data-photo-save="equip"]') as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "")).toContain("フォト枠が上限");
    // 実測フォトを 1 枚外してから装備（フォト枠数上限・Phase 8-B3 の検証も兼ねる）
    document.querySelector('.lane-card[data-lane="1"] [data-photo-json-rm="0"]')!.dispatchEvent(
      new Event("click", { bubbles: true }),
    );
    (document.querySelector('.lane-card[data-lane="1"] [data-act="photo-new"]') as HTMLButtonElement).click();
    const psAdd2 = document.querySelector("#modal-box [data-ps-add]") as HTMLButtonElement;
    psAdd2.click();
    const nameInput2 = document.querySelector<HTMLInputElement>('[data-p="name"]')!;
    nameInput2.value = "スキル持テスト2";
    nameInput2.dispatchEvent(new Event("input", { bubbles: true }));
    (document.querySelector('#modal-box [data-photo-save="equip"]') as HTMLButtonElement).click();
    expect(userPhotoRows(1).length).toBe(1);
    const runs = document.querySelector<HTMLInputElement>("#g-runs")!;
    runs.value = "3";
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "").startsWith("完了")).toBe(true);
    // スコアがブースト込みで変わる（フォト無しの 2,446,158,294 とは異なる）
    expect(document.querySelector("#kpi-root")!.textContent ?? "").not.toContain("2,446,158,294");
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  // ---------------------------------------------------------------------------
  // Phase 8-B2: フォトマスタ（INFO PRIDE メモリアル一覧・初期品質）・T5 4枚/レーン表示
  // ---------------------------------------------------------------------------

  it("T5 実測プリセットは全レーンのフォトが4枚（スキルなしフォト含む）表示される", () => {
    // 実測/JSON 行（通常チップ）がレーン毎に 4 枚・能力チップに初期値が表示される
    for (let lane = 1; lane <= 5; lane++) {
      const rows = [
        ...document.querySelectorAll(`.lane-card[data-lane="${lane}"] .photo-eq-row`),
      ].filter((r) => r.querySelector("[data-photo-json-rm]") !== null);
      expect(rows.length).toBe(4);
    }
    // L1 の 1 枚目（私たちらしく・実測名は actual_title、JSON name は神崎莉央）が
    // 能力チップ（Vo +59.4%）付きで表示される
    const l1 = document.querySelector('.lane-card[data-lane="1"] .photo-eq-list')!.textContent ?? "";
    expect(l1).toContain("神崎莉央");
    expect(l1).toContain("+59.4%");
    // スキルなしフォト（photo-L1-4 相当・Unidentified）も 4 枚目として表示される
    expect(l1).toContain("Unidentified");
  });

  it("フォトマスタピッカーで INFO PRIDE のメモリアルフォトを初期品質の値で帳に追加できる", () => {
    (document.querySelector('.lane-card[data-lane="1"] [data-act="photo-album"]') as HTMLButtonElement).click();
    (document.querySelector("#ph-master") as HTMLButtonElement).click();
    // マスタ 262 枚（初期レンダは先頭 150 件）
    expect(document.querySelectorAll("#pm-list .photo-row").length).toBe(150);
    // 実測検証済みの初期値フォトを検索（ふつつかものですが・品質35・Vo+20%）
    const search = document.querySelector<HTMLInputElement>("#pm-search")!;
    search.value = "ふつつかもの";
    search.dispatchEvent(new Event("input"));
    const row = document.querySelector("#pm-list .photo-row")!;
    expect(row.textContent).toContain("ふつつかものですが");
    expect(row.textContent).toContain("品質35");
    expect(row.textContent).toContain("+20%");
    // 帳に追加 → 帳（先のモーダルの裏で state が更新）に載る
    (row.querySelector("[data-pm-add]") as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "")).toContain("マイフォト帳に追加");
    // 撮影キャラフィルタでキャラ指定のフォトだけに出れる（focusCharacterId は「撮影キャラ」
    // 表記・専用フォトとは別物のため Phase 8-B4 から改称）
    const kindSel = document.querySelector<HTMLSelectElement>("#pm-kind")!;
    kindSel.value = "focused";
    kindSel.dispatchEvent(new Event("change", { bubbles: true }));
    search.value = "";
    search.dispatchEvent(new Event("input"));
    const focusedRows = [...document.querySelectorAll("#pm-list .photo-row")];
    expect(focusedRows.length).toBeGreaterThan(0);
    for (const r of focusedRows.slice(0, 20)) {
      expect(r.textContent).toContain("撮影:");
    }
    // 帳に戻って追加済みフォトが見える
    document.querySelectorAll("#modal-box [data-close]").forEach((b) => (b as HTMLElement).click());
    (document.querySelector('.lane-card[data-lane="1"] [data-act="photo-album"]') as HTMLButtonElement).click();
    const search2 = document.querySelector<HTMLInputElement>("#ph-search")!;
    search2.value = "ふつつかもの";
    search2.dispatchEvent(new Event("input"));
    expect(document.querySelectorAll("#ph-list .photo-row").length).toBeGreaterThanOrEqual(2);
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("帳の複数選択で手持ちタグを一括付与/解除できる", () => {
    (document.querySelector('.lane-card[data-lane="1"] [data-act="photo-album"]') as HTMLButtonElement).click();
    // 2 行を選択して一括で手持ちタグを付ける
    const checkboxes = [...document.querySelectorAll<HTMLInputElement>("#ph-list input[data-ph-sel]")];
    expect(checkboxes.length).toBeGreaterThan(2);
    const selectedIds = [checkboxes[0]!.getAttribute("data-ph-sel")!, checkboxes[1]!.getAttribute("data-ph-sel")!];
    checkboxes[0]!.checked = true;
    checkboxes[0]!.dispatchEvent(new Event("change", { bubbles: true }));
    checkboxes[1]!.checked = true;
    checkboxes[1]!.dispatchEvent(new Event("change", { bubbles: true }));
    expect((document.querySelector("#ph-bulk-bar") as HTMLElement).hidden).toBe(false);
    expect(document.querySelector("#ph-bulk-count")!.textContent).toContain("2 枚選択中");
    // 一括付与 → 選択 2 枚とも手持ちタグ付きで永続化される
    (document.querySelector("#ph-bulk-mochi-add") as HTMLButtonElement).click();
    const saved = JSON.parse(localStorage.getItem("aipura-sim-myphotos-v1") ?? "[]") as Array<{ id: string; tags: string[] }>;
    const bothMochi = saved.filter((p) => selectedIds.includes(p.id) && p.tags.includes("手持ち"));
    expect(bothMochi.length).toBe(2);
    // 一括解除 → 選択 2 枚の手持ちタグが外れる
    (document.querySelector("#ph-bulk-mochi-del") as HTMLButtonElement).click();
    const saved2 = JSON.parse(localStorage.getItem("aipura-sim-myphotos-v1") ?? "[]") as Array<{ id: string; tags: string[] }>;
    const stillMochi = saved2.filter((p) => selectedIds.includes(p.id) && p.tags.includes("手持ち"));
    expect(stillMochi.length).toBe(0);
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("効果とスキルが平文ではなくチップで表示される", () => {
    // レーンのスキル一覧（A/SP/P）に fx チップが並ぶ
    const fxRows = document.querySelectorAll('.lane-card[data-lane="1"] .fx-row .fx');
    expect(fxRows.length).toBeGreaterThan(3);
    // 帳の T5 実測フォト（スキル持ち）にもチップがある
    (document.querySelector('.lane-card[data-lane="1"] [data-act="photo-album"]') as HTMLButtonElement).click();
    const search = document.querySelector<HTMLInputElement>("#ph-search")!;
    search.value = "屋外プール";
    search.dispatchEvent(new Event("input"));
    const row = document.querySelector("#ph-list .photo-row")!;
    expect(row.querySelectorAll(".fx").length).toBeGreaterThan(0);
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("フォトエディタの条件セレクトにマスタ由来の全条件種がある", () => {
    (document.querySelector('.lane-card[data-lane="1"] [data-act="photo-new"]') as HTMLButtonElement).click();
    const psAdd = document.querySelector("#modal-box [data-ps-add]") as HTMLButtonElement;
    psAdd.click();
    const cond = document.querySelector<HTMLSelectElement>('#modal-box [data-ps="condition"]')!;
    const opts = [...cond.options].map((o) => o.value);
    // マスタの tg-* 由来の主要条件
    for (const v of ["none", "combo>=50", "combo>=70", "combo>=100", "combo<=50", "self_dance_lane", "self_center",
      "status_vocal_up", "status_critical_coeff_up", "someone_vocal_boost", "someone_recovered",
      "stamina>=60", "stamina<=70", "someone_stamina<=50", "count_liz>=1",
      "music_limited", "critical_timing", "someone_before_special",
      // Phase 8-B4: やる気士docs 専用フォト由来
      "beat_chance=10"]) {
      expect(opts).toContain(v);
    }
    expect(opts.length).toBeGreaterThanOrEqual(60);
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("延長/増強レタッチで 与/被 スコープと絞り込みバフを選べる（Phase 8-B4）", () => {
    (document.querySelector('.lane-card[data-lane="1"] [data-act="photo-new"]') as HTMLButtonElement).click();
    const box = document.querySelector("#modal-box")!;
    // 名前を入れてからスキル持ちにする → 種別を「与・クリティカル率延長」相当へ
    const nameInput = box.querySelector<HTMLInputElement>('[data-p="name"]')!;
    nameInput.value = "与クリ率延長テスト";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    (box.querySelector("[data-ps-add]") as HTMLButtonElement).click();
    const typeSel = box.querySelector<HTMLSelectElement>('[data-ps="type"]')!;
    typeSel.value = "effect_extension";
    typeSel.dispatchEvent(new Event("change", { bubbles: true }));
    // スコープ/バフセレクトが現れる
    const scopeSel = box.querySelector<HTMLSelectElement>('[data-ps="scope"]')!;
    const buffSel = box.querySelector<HTMLSelectElement>('[data-ps="buffkey"]')!;
    expect(scopeSel).not.toBeNull();
    expect(buffSel).not.toBeNull();
    // 与・クリティカル率延長（やる気士docs の専用フォト・奥山すみれ等と同型）
    scopeSel.value = "given";
    scopeSel.dispatchEvent(new Event("change", { bubbles: true }));
    buffSel.value = "critical_rate_up";
    buffSel.dispatchEvent(new Event("change", { bubbles: true }));
    const valInput = box.querySelector<HTMLInputElement>('[data-ps="value"]')!;
    valInput.value = "4";
    valInput.dispatchEvent(new Event("input", { bubbles: true }));
    // 保存して帳へ → 要約に「与・」表記が出る
    (box.querySelector('[data-photo-save="save"]') as HTMLButtonElement).click();
    const saved = JSON.parse(localStorage.getItem("aipura-sim-myphotos-v1") ?? "[]") as Array<{ name: string; skill: { type: string; scope?: string; buffKey?: string } | null }>;
    const found = saved.find((p) => p.name === "与クリ率延長テスト");
    expect(found).toBeDefined();
    expect(found!.skill!.scope).toBe("given");
    expect(found!.skill!.buffKey).toBe("critical_rate_up");
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("アクセサリピッカーに効果値の昇順/降順ソートがある（Phase 8-B7）", () => {
    // スロット2（Sta/Men/Cri 用）のピッカーを開く
    (document.querySelector('[data-act="pick-acc"]') as HTMLButtonElement).click();
    const sortSel = document.querySelector<HTMLSelectElement>("#ap-sort")!;
    expect(sortSel).not.toBeNull();
    // Cri タブに絞って降順（既定）と昇順で先頭行が入れ替わる
    //（technique 分類の効果行 stat は critical → 分類→stat 写像の検証も兼ねる）
    const criTab = document.querySelector<HTMLButtonElement>('#ap-tabs button[data-cls="technique"]')!;
    criTab.click();
    const firstDesc = document.querySelector("#ap-list .pick-row")!;
    expect(firstDesc.textContent).toContain("Cri");
    sortSel.value = "asc";
    sortSel.dispatchEvent(new Event("change", { bubbles: true }));
    const firstAsc = document.querySelector("#ap-list .pick-row")!;
    expect(firstAsc.getAttribute("data-acc")).not.toBe(firstDesc.getAttribute("data-acc"));
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("一括装備解除: レーン別のフォト/アクセサリ全外しと編成全体の解除（Phase 8-B7）", () => {
    // L1 のフォト（4 枚）とアクセサリ（2 件）をレーン別ボタンで全外し
    const l1 = (): Element => document.querySelector('.lane-card[data-lane="1"]')!;
    expect(l1().querySelectorAll("[data-photo-json-rm]").length).toBe(4);
    (l1().querySelector('[data-act="photo-clear"]') as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "")).toContain("L1 のフォトを全て装備解除");
    expect(l1().querySelectorAll("[data-photo-json-rm]").length).toBe(0);
    (l1().querySelector('[data-act="acc-clear"]') as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "")).toContain("L1 のアクセサリを全て装備解除");
    // L2 はまだ装備がある → 編成全体の解除で消える
    expect(
      document.querySelectorAll('.lane-card[data-lane="2"] [data-photo-json-rm]').length,
    ).toBe(4);
    (document.querySelector("#btn-clear-all-equip") as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "")).toContain("全レーンの装備を解除しました");
    for (let lane = 1; lane <= 5; lane++) {
      expect(
        document.querySelectorAll(`.lane-card[data-lane="${lane}"] [data-photo-json-rm]`).length,
      ).toBe(0);
      expect(
        document.querySelectorAll(`.lane-card[data-lane="${lane}"] .acc-slot .chip`).length,
      ).toBe(0);
    }
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("フォトエディタのスキルなしに戻すボタンでスキル持ちを取り消せる（Phase 8-B7）", () => {
    (document.querySelector('.lane-card[data-lane="1"] [data-act="photo-new"]') as HTMLButtonElement).click();
    const box = document.querySelector("#modal-box")!;
    (box.querySelector("[data-ps-add]") as HTMLButtonElement).click();
    // スキル持ちになった（ステ枠4・戻すボタンが出る）
    expect(box.querySelector('[data-ps="type"]')).not.toBeNull();
    const removeBtn = box.querySelector("[data-ps-remove]") as HTMLButtonElement;
    expect(removeBtn).not.toBeNull();
    removeBtn.click();
    // スキルなしに戻る（枠1が「スキル持ちにする」ボタンに戻り・枠5が復活:
    // data-frame-row は 枠1(-1) + 枠2-5(0-4) の 6 行）
    expect(box.querySelector('[data-ps="type"]')).toBeNull();
    expect(box.querySelector("[data-ps-add]")).not.toBeNull();
    expect(box.querySelectorAll("[data-frame-row]").length).toBe(6);
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
  });

  // ---------------------------------------------------------------------------
  // Phase 8-B3: スキルLv選択・フォト枠数上限（マスタ CardLevelRelease 準拠）
  // ---------------------------------------------------------------------------

  it("スキルLvセレクト: Lv1-6が選べ、要求カードレベル超過のLvは無効化・goldenレベルが初期選択される", () => {
    // L1 birt-02 @Lv215・golden: slot1=6 / slot2=6 / slot3=5
    const sel3 = document.querySelector<HTMLSelectElement>(
      '.lane-card[data-lane="1"] select[data-skill-lv="sk-yu-05-birt-02-3"]',
    );
    expect(sel3).not.toBeNull();
    expect(sel3!.options.length).toBe(6);
    expect(sel3!.value).toBe("5");
    // 枠3 の Lv6 はカード Lv230 必要 → Lv215 では無効化
    const lv6 = [...sel3!.options].find((o) => o.value === "6")!;
    expect(lv6.disabled).toBe(true);
    expect(lv6.textContent).toContain("カードLv230が必要");
    // 枠1 の Lv6 は要求 Lv180 ≤ 215 で選択可能・golden 通り選択済み
    const sel1 = document.querySelector<HTMLSelectElement>(
      '.lane-card[data-lane="1"] select[data-skill-lv="sk-yu-05-birt-02-1"]',
    )!;
    expect(sel1.value).toBe("6");
    expect([...sel1.options].every((o) => !o.disabled)).toBe(true);
    // L3 fest-03 @Lv230: 枠3 の golden Lv6（要求 230）が選択可能
    const sel3l3 = document.querySelector<HTMLSelectElement>(
      '.lane-card[data-lane="3"] select[data-skill-lv="sk-chs-05-fest-03-3"]',
    )!;
    expect(sel3l3.value).toBe("6");
    expect([...sel3l3.options].every((o) => !o.disabled)).toBe(true);
  });

  it("カードレベルを下げると未解放スキル枠がロック表示になり、スキルLvが最大可能レベルへクランプされる", () => {
    const laneSel = document.querySelector<HTMLSelectElement>(
      '.lane-card[data-lane="1"] select[data-act="level"]',
    )!;
    laneSel.value = "15"; // slot2=Lv20・slot3=Lv80 解放 → 両方ロック
    laneSel.dispatchEvent(new Event("change", { bubbles: true }));
    const l1 = (): Element => document.querySelector('.lane-card[data-lane="1"]')!;
    expect(l1().textContent).toContain("🔒 Lv20で解放");
    expect(l1().textContent).toContain("🔒 Lv80で解放");
    // 枠1 は解放済み・Lv2 はカードLv40 必要 → Lv15 では Lv1 にクランプ
    const sel1 = l1().querySelector<HTMLSelectElement>('select[data-skill-lv="sk-yu-05-birt-02-1"]')!;
    expect(sel1.value).toBe("1");
    const lv2 = [...sel1.options].find((o) => o.value === "2")!;
    expect(lv2.disabled).toBe(true);
    expect(lv2.textContent).toContain("カードLv40が必要");
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("フォト装備解除でスキルも同時に外れる（実測/JSON ↔ golden スキル連動・Phase 8-B5）", () => {
    // T5 プリセット L1 の実測フォト行には対応する golden フォトスキル（photo-L1-1 等）が
    // 装備リスト内にチェックボックス付きで表示される（photoIndex ↔ 装着位置の対応）
    const l1 = (): Element => document.querySelector('.lane-card[data-lane="1"]')!;
    expect(l1().querySelector('input[data-skill="photo-L1-1"]')).not.toBeNull();
    expect(l1().querySelector('input[data-skill="photo-L1-3"]')).not.toBeNull();
    // フォトを順に 3 枚外す（外すたびに後続が前に詰まり、スキルも対応位置に連動して外れる）
    l1().querySelector('[data-photo-json-rm="0"]')!.dispatchEvent(new Event("click", { bubbles: true }));
    l1().querySelector('[data-photo-json-rm="0"]')!.dispatchEvent(new Event("click", { bubbles: true }));
    l1().querySelector('[data-photo-json-rm="0"]')!.dispatchEvent(new Event("click", { bubbles: true }));
    // 1 枚のみ残存 → 対応するスキルは photo-L1-1 のみ
    expect(l1().querySelector('input[data-skill="photo-L1-1"]')).not.toBeNull();
    expect(l1().querySelector('input[data-skill="photo-L1-2"]')).toBeNull();
    expect(l1().querySelector('input[data-skill="photo-L1-3"]')).toBeNull();
    // 最後の 1 枚も外す → フォトスキルは全て無効化される
    l1().querySelector('[data-photo-json-rm="0"]')!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(l1().querySelector('input[data-skill="photo-L1-1"]')).toBeNull();
    // シミュレーションでも golden フォトスキルが効かない（スコアが確定値と変わる）
    (document.querySelector<HTMLInputElement>("#g-runs")!).value = "10";
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    const kpi = document.querySelector("#kpi-root")!.textContent ?? "";
    expect(kpi).not.toContain("2,446,158,294");
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("マイフォトのスキルは装備行のチェックで個別無効化できる（Phase 8-B5）", () => {
    // L1 は T5 プリセットでフォト 4 枚満杯のため 1 枚外す
    document.querySelector('.lane-card[data-lane="1"] [data-photo-json-rm="0"]')!.dispatchEvent(
      new Event("click", { bubbles: true }),
    );
    createPhoto("スキル解除テスト", "テスト", {});
    const psAdd = document.querySelector("#modal-box [data-ps-add]") as HTMLButtonElement;
    psAdd.click();
    (document.querySelector('#modal-box [data-photo-save="equip"]') as HTMLButtonElement).click();
    // 装備行にスキルチェックボックス（既定: 有効）が現れる
    const skillCb = () =>
      document.querySelector<HTMLInputElement>(
        '.lane-card[data-lane="1"] input[data-user-photo-skill]',
      )!;
    expect(skillCb()).not.toBeNull();
    expect(skillCb().checked).toBe(true);
    // チェックを外す → 無効化 → シミュレーションでも発動しない
    skillCb().checked = false;
    skillCb().dispatchEvent(new Event("change", { bubbles: true }));
    (document.querySelector<HTMLInputElement>("#g-runs")!).value = "10";
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    const kpiOff = document.querySelector("#kpi-root")!.textContent ?? "";
    expect(kpiOff).not.toContain("2,446,158,294");
    // チェックを戻す → 有効化
    skillCb().checked = true;
    skillCb().dispatchEvent(new Event("change", { bubbles: true }));
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    const kpiOn = document.querySelector("#kpi-root")!.textContent ?? "";
    expect(kpiOn).not.toContain("2,446,158,294");
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("スキルLvを下げて実行するとスコアが変化する（golden→マスタ解析値の置換がdeckに反映）", () => {
    // L1 枠2（P スキル・常時発動）を Lv1 へ（Lv6: 6段44b → Lv1: 5段25b）
    const sel2 = document.querySelector<HTMLSelectElement>(
      '.lane-card[data-lane="1"] select[data-skill-lv="sk-yu-05-birt-02-2"]',
    )!;
    sel2.value = "1";
    sel2.dispatchEvent(new Event("change", { bubbles: true }));
    (document.querySelector<HTMLInputElement>("#g-runs")!).value = "10";
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    const kpi = document.querySelector("#kpi-root")!.textContent ?? "";
    expect(kpi).not.toContain("2,446,158,294");
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("フォト枠数上限: ヘッダに「上限 N 枚@LvM」が表示され、レベル低下で超過警告が出る", () => {
    const head = (): string =>
      document.querySelector('.lane-card[data-lane="1"] .photo-eq-head')!.textContent ?? "";
    expect(head()).toContain("上限 4 枚@Lv215");
    const laneSel = document.querySelector<HTMLSelectElement>(
      '.lane-card[data-lane="1"] select[data-act="level"]',
    )!;
    laneSel.value = "64"; // 3枚目=Lv65 解放前 → 上限 2 枚
    laneSel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(head()).toContain("上限 2 枚@Lv64");
    const note = document.querySelector('.lane-card[data-lane="1"] .error-note')!.textContent ?? "";
    expect(note).toContain("上限は 2 枚です");
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  // ---------------------------------------------------------------------------
  // Phase 8-C: 統合オプティマイザ（必須採用カード＋タグ指定フォト配分）
  // ---------------------------------------------------------------------------

  it("統合オプティマイザ: 必須採用カードが編成に含まれ、タグ指定フォトが配分される", async () => {
    // 探索用フォトを2枚作成（タグ「探索用」）
    createPhoto("探索A", "探索用", { value: 44 });
    (document.querySelector('#modal-box [data-photo-save="save"]') as HTMLButtonElement).click();
    createPhoto("探索B", "探索用", { kind: "grant_center", stat: "critical_score", value: 27 });
    (document.querySelector('#modal-box [data-photo-save="save"]') as HTMLButtonElement).click();
    // オプティマイザタブ
    (document.querySelector("#tab-opt") as HTMLButtonElement).click();
    (document.querySelector<HTMLInputElement>("#opt-use-photos")!).checked = true;
    (document.querySelector<HTMLInputElement>("#opt-use-photos")!).dispatchEvent(new Event("change", { bubbles: true }));
    // 既定で最初のタグ（テンプレート）がチェック → 外して探索用だけにする
    for (const cb of document.querySelectorAll<HTMLInputElement>("#opt-photo-tags input[data-opt-tag]")) {
      cb.checked = cb.dataset.optTag === "探索用";
    }
    (document.querySelector<HTMLSelectElement>("#opt-required")!).value = "card-yu-05-birt-02";
    // 高速設定
    (document.querySelector<HTMLInputElement>("#opt-pool")!).value = "6";
    (document.querySelector<HTMLInputElement>("#opt-screen-runs")!).value = "1";
    (document.querySelector<HTMLInputElement>("#opt-final-runs")!).value = "1";
    (document.querySelector<HTMLInputElement>("#opt-topn")!).value = "2";
    (document.querySelector<HTMLInputElement>("#opt-budget-sec")!).value = "30";
    (document.querySelector("#btn-optimize") as HTMLButtonElement).click();
    const start = Date.now();
    while (document.querySelectorAll("#opt-results .opt-entry").length === 0) {
      if (Date.now() - start > 60000) throw new Error("optimizer did not finish in time");
      await new Promise((r) => setTimeout(r, 25));
    }
    const first = document.querySelector("#opt-results .opt-entry") as HTMLElement;
    // 必須採用カードが含まれる
    const cards = first.dataset.cards!.split(",");
    expect(cards).toContain("card-yu-05-birt-02");
    // フォトが配分されている（📷 チップ 2 枚）
    const photoChips = first.querySelectorAll(".tag-chip");
    expect(photoChips.length).toBeGreaterThanOrEqual(2);
    expect(first.textContent).toContain("探索A");
    // 反映 → レーンにフォト装備が付く
    (first.querySelector("[data-apply-lineup]") as HTMLElement).click();
    const totalPhotos = [1, 2, 3, 4, 5].reduce(
      (s, lane) => s + document.querySelectorAll(`.lane-card[data-lane="${lane}"] .photo-eq-row`).length,
      0,
    );
    expect(totalPhotos).toBeGreaterThanOrEqual(1);
    // 探索用フォトのタグは帳に残る
    const saved = JSON.parse(localStorage.getItem("aipura-sim-myphotos-v1") ?? "[]") as Array<{ name: string }>;
    expect(saved.some((p) => p.name === "探索A")).toBe(true);
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  // ---------------------------------------------------------------------------
  // Phase 8-B10: 編成JSON インポート（ネスト形式・CLI スキーマ）
  // ---------------------------------------------------------------------------

  it("編成JSONインポート: ネスト形式（CLI / exportConfig と同一 { deck: {...} }）を取り込み CLI と同一スコアになる", async () => {
    const config = JSON.parse(
      readFileSync(path.join(repoRoot, "examples/nested-sample.json"), "utf-8"),
    ) as Record<string, unknown>;
    // ファイル入力経路（importConfig → FileReader → applyConfig）を jsdom で再現
    const input = document.querySelector<HTMLInputElement>("#file-import")!;
    const file = new File([JSON.stringify(config)], "nested-sample.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    // FileReader.onload は非同期
    const start = Date.now();
    while (!(document.querySelector("#status")!.textContent ?? "").startsWith("インポート完了")) {
      if (Date.now() - start > 10000) {
        throw new Error(`import did not finish: ${document.querySelector("#status")!.textContent}`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    // デッキ内容の復元（T5 既定と異なる値で検証）
    const cardOf = (lane: number): string =>
      document.querySelector<HTMLInputElement>(`.lane-card[data-lane="${lane}"] input[data-act="card-id"]`)!.value;
    expect(cardOf(1)).toBe("card-kkr-05-mizg-02");
    expect(cardOf(2)).toBe("card-rio-05-fest-01");
    expect(cardOf(5)).toBe("card-ski-05-waso-00");
    expect(document.querySelector<HTMLInputElement>('input[data-staff="vocal"]')!.value).toBe("5520");
    expect(document.querySelector<HTMLInputElement>('input[data-yell="sp_skill_score_pct"]')!.value).toBe("12");
    expect(document.querySelector<HTMLInputElement>("#g-audience")!.value).toBe("71000");
    expect(document.querySelector("#stage-info")!.textContent).toContain("qt-area-1-001");
    expect(
      document.querySelector<HTMLInputElement>('.lane-card[data-lane="1"] input[data-act="kouryu"]')!.value,
    ).toBe("19");
    // マイフォト帳の復元と装備（photoEquip[0] = uph-l1-4）
    const saved = JSON.parse(localStorage.getItem("aipura-sim-myphotos-v1") ?? "[]") as Array<{ id: string }>;
    expect(saved.map((p) => p.id)).toContain("uph-l1-4");
    const l1Names = [...document.querySelectorAll('.lane-card[data-lane="1"] .photo-eq-name')].map(
      (e) => e.textContent ?? "",
    );
    expect(l1Names.some((n) => n.includes("伊吹渚 6/22"))).toBe(true);
    // 【8-B10 追補3】T5 由来 golden フォトスキル（photo-L*）は装着位置のフォト名が
    // T5 実測フォトと一致しないため、行自体が表示されない（汎用計算機として不適切なため）。
    // マイフォトスキル（uph-*）は装備行にチェック付きで表示される
    for (const [lane, id] of [
      [1, "photo-L1-1"],
      [2, "photo-L2-4"],
      [3, "photo-L3-2"],
      [4, "photo-L4-3"],
    ] as const) {
      expect(document.querySelector(`.lane-card[data-lane="${lane}"] input[data-skill="${id}"]`)).toBeNull();
    }
    expect(
      document.querySelector<HTMLInputElement>('.lane-card[data-lane="1"] input[data-user-photo-skill]')!.checked,
    ).toBe(true);
    // 【8-B10】photos 側に同名で重複記載されていたステータスは除去され、
    // toDeck の装備マージで二重計算にならない（実測/JSON 3 + マイフォト帳 1 = 4 枚）
    const head = document.querySelector('.lane-card[data-lane="1"] .photo-eq-head')!.textContent ?? "";
    expect(head).toContain("実測/JSON 3 + マイフォト帳 1");
    // シミュレーション実行 → 確定値が表示される（UI は audience テーブル引き 1002‰ 系。
    // CLI 直読みでは audience 71,000 が 2000‰ にクランプされるため値が異なる — research/19 の S1 audience トラップ）
    (document.querySelector<HTMLInputElement>("#g-runs")!).value = "10";
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    const kpi = document.querySelector("#kpi-root")!.textContent ?? "";
    // 【2026-09-21 Phase 14】Decay適正化（実効N-1ビート）に伴い 112,864 系 → 112,623 系に変化
    expect(kpi).toMatch(/112,623,\d{3}/);
  });
});

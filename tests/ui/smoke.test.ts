/**
 * 単一HTML UI のヘッドレススモークテスト（jsdom・Phase 6）。
 *
 * dist/aipura_simulator.html（npm run build:ui の成果物）を読み込み、
 * バンドル済みアプリ JS を実行して以下を検証する:
 *   1. 編成パネル（5レーン）・ステージ情報が描画される
 *   2. シミュレーション実行で結果（KPI・レーン別内訳・タイムライン）が描画され、
 *      確定値が CLI / テストと同一値（2,436,373,427）になる
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
    expect(kpi).toContain("2,436,373,427");
    // レーン別内訳 5 行
    expect(document.querySelectorAll("#lane-table tbody tr").length).toBe(5);
    // タイムライン 156 ビート
    expect(document.querySelectorAll("#timeline-table tbody tr").length).toBe(156);
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
    expect(document.querySelector("#kpi-root")!.textContent ?? "").toContain("2,436,373,427");
    // ファンファクターを 1000‰（ボーナスなし）へ手打ちで変更
    const fan = document.querySelector<HTMLInputElement>("#g-fan")!;
    fan.value = "1000";
    fan.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector("#g-fan-hint")!.textContent).toContain("+0.0%");
    (document.querySelector("#btn-run") as HTMLButtonElement).click();
    expect((document.querySelector("#status")!.textContent ?? "").startsWith("完了")).toBe(true);
    // ファンボーナスを消すと確定値は必ず下がる（1620‰ 基準の 2,436,373,427 より低い）
    const confirmedText =
      document.querySelector("#kpi-root .kpi-value.confirmed")!.textContent ?? "";
    const m = /^([\d.]+)(億|万)$/.exec(confirmedText);
    expect(m).not.toBeNull();
    const val2 = Number(m![1]) * (m![2] === "億" ? 1e8 : 1e4);
    expect(val2).toBeLessThan(2_501_593_723);
    expect(document.querySelector("#kpi-root")!.textContent ?? "").not.toContain("2,436,373,427");
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
    expect(document.querySelectorAll("#timeline-table tbody tr").length).toBe(noteCount);
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

  it("アクセサリピッカーに属性タブがあり、専用タブでキャラ専用のみ表示される", () => {
    (document.querySelector('[data-act="pick-acc"]') as HTMLButtonElement).click();
    const tabs = [...document.querySelectorAll("#ap-tabs button[data-cls]")];
    expect(tabs.map((b) => b.getAttribute("data-cls"))).toEqual([
      "", "vocal", "dance", "visual", "stamina", "mental", "technique", "personal",
    ]);
    // 専用タブ: L1 のカードキャラ（鈴村優）の専用品のみ表示（他キャラの専用品は非表示）
    (tabs.find((b) => b.getAttribute("data-cls") === "personal") as HTMLButtonElement).click();
    const rows = [...document.querySelectorAll("#ap-list [data-acc]")];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.textContent).toContain("専用:");
      expect(row.textContent).toContain("優");
      expect(row.textContent).not.toContain("専用:千紗");
    }
    // 属性タブ（vocal）: 全行に Vo チップ
    (tabs.find((b) => b.getAttribute("data-cls") === "vocal") as HTMLButtonElement).click();
    const rows2 = [...document.querySelectorAll("#ap-list .chip.acc-vocal")];
    expect(rows2.length).toBeGreaterThan(0);
    document.querySelector("[data-close]")!.dispatchEvent(new Event("click"));
    (document.querySelector("#btn-preset") as HTMLButtonElement).click();
  });

  it("オプティマイザ: 探索→ランキング表示→1クリックで編成反映", async () => {
    // タブ切替
    (document.querySelector("#tab-opt") as HTMLButtonElement).click();
    expect((document.querySelector("#view-sim") as HTMLElement).hidden).toBe(true);
    expect((document.querySelector("#view-opt") as HTMLElement).hidden).toBe(false);
    // 制約パネルに現在の 5 レーンが表示される
    expect(document.querySelectorAll("#opt-constraints .opt-lane-ctrl").length).toBe(5);
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
});

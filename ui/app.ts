/**
 * 単一HTML シミュレータ UI（Phase 4）。
 *
 * - 計算コアは src/（esbuild でバンドル・依存ゼロ）。データは tools/build_ui.mjs が
 *   ビルド時に JSON として埋め込む（file:// 直開きで動作・fetch 不要）。
 * - 編成（5レーン: カード/Lv/開花/交流/ロール/メンタル/スキル/フォト/装飾）・
 *   スタッフ・エール・来場者数を設定してシミュレーションを実行。
 * - 出力: 確定値（乱数中立）/ Monte Carlo 統計 / レーン別内訳 / スコア推移グラフ /
 *   バフ推移ヒートマップ / ビート別タイムライン表 / 確度タグ。
 */
import {
  buildSimulateInput,
  laneBreakdown,
  availableLevels,
  laneAttributeOf,
  fanBonusPermil,
  simulateTimeline,
  ContinuousRng,
  NeutralRng,
  type DeckJsonV2,
  type SimSourceData,
  type SkillDef,
  type LaneNumber,
  type TimelineResult,
  type BuffKey,
  type LaneBreakdownEntry,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// 埋め込みデータ
// ---------------------------------------------------------------------------

interface UiData {
  data: SimSourceData;
  sampleDeck: DeckJsonV2;
  calibratedMental: Record<string, number>;
  defaultMissedNotes: Array<{ beat: number; lane: number }>;
  stageFile: string;
  chartFile: string;
  builtAt: string;
}

const DATA: UiData = JSON.parse(
  (document.getElementById("embedded-data") as HTMLScriptElement).textContent ?? "{}",
);

const STAGE = DATA.data.stages[DATA.stageFile]!;
const W = STAGE.beatWeightsPermil;
const LANE_ATTRS = STAGE.laneAttributes ?? [2, 2, 1, 2, 2];

// ---------------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------------

interface LaneUiState {
  cardId: string;
  level: number;
  rarity: number;
  kouryu: number;
  role: "Scorer" | "Buffer" | "Supporter";
  mental: number;
  enabledSkillIds: Set<string>;
  enabledPhotoIds: Set<string>;
  photosJson: string;
  accessoriesJson: string;
}

interface AppState {
  audience: number;
  successBasePct: number;
  critRate: number;
  mcRuns: number;
  seed: number;
  missedNotesText: string;
  staff: DeckJsonV2["staff_bonus"];
  yell: DeckJsonV2["yale_bonus"];
  lanes: LaneUiState[];
}

const LANE_LABELS = ["L1 左端", "L2 左", "L3 センター", "L4 右", "L5 右端"];

function defaultLaneState(): AppState {
  const lanes: LaneUiState[] = DATA.sampleDeck.characters.map((ch) => {
    const skills = DATA.data.skillsGolden.filter(
      (s) => s.lane === ch.lane && (s.kind === "A" || s.kind === "SP" || s.kind === "P"),
    );
    const photos = DATA.data.skillsGolden.filter(
      (s) => s.lane === ch.lane && s.kind === "photo" && s.effects.length > 0,
    );
    return {
      cardId: ch.card_id,
      level: ch.level,
      rarity: ch.rarity,
      kouryu: ch.kouryu_level,
      role: ch.role as LaneUiState["role"],
      mental: DATA.calibratedMental[String(ch.lane)] ?? 100,
      enabledSkillIds: new Set(skills.map((s) => s.id)),
      enabledPhotoIds: new Set(photos.map((s) => s.id)),
      photosJson: JSON.stringify(ch.photos, null, 1),
      accessoriesJson: JSON.stringify(ch.accessories, null, 1),
    };
  });
  return {
    audience: 16000,
    successBasePct: 100,
    critRate: 0,
    mcRuns: 300,
    seed: 1,
    missedNotesText: JSON.stringify(DATA.defaultMissedNotes),
    staff: { ...DATA.sampleDeck.staff_bonus },
    yell: { ...DATA.sampleDeck.yale_bonus },
    lanes,
  };
}

let state: AppState = defaultLaneState();

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector(sel);
  if (el === null) throw new Error(`element not found: ${sel}`);
  return el as T;
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("ja-JP");
}

/** ゲーム表示風の短縮（億/万） */
function fmtScore(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(2) + "億";
  if (a >= 1e4) return (n / 1e4).toFixed(1) + "万";
  return fmtInt(n);
}

function cardOf(id: string) {
  return DATA.data.cards.find((c) => c.id === id);
}

function skillConfidence(s: SkillDef): "Confirmed" | "Estimate" | "Unknown" {
  const confs = s.effects.map((e) => e.confidence ?? "");
  if (confs.some((c) => c.includes("Unknown") || c === "")) return "Unknown";
  if (confs.every((c) => c.includes("Confirmed"))) return "Confirmed";
  return "Estimate";
}

const CONF_BADGE: Record<string, string> = {
  Confirmed: "badge-c",
  Estimate: "badge-e",
  Unknown: "badge-u",
};

// ---------------------------------------------------------------------------
// 状態 ↔ 編成データ
// ---------------------------------------------------------------------------

function parseEquipment(
  json: string,
  lane: number,
  what: string,
): DeckJsonV2["characters"][number]["photos"] {
  const parsed: unknown = JSON.parse(json.trim() === "" ? "[]" : json);
  if (!Array.isArray(parsed)) {
    throw new Error(`L${lane} の ${what} は配列である必要があります`);
  }
  return parsed as never;
}

/** 現在の UI 状態 → 編成（verification_data_v2.json と同一スキーマ） */
function toDeck(): DeckJsonV2 {
  const characters = state.lanes.map((l, i) => {
    const lane = (i + 1) as LaneNumber;
    return {
      lane,
      card_id: l.cardId,
      level: l.level,
      rarity: l.rarity,
      role: l.role,
      kouryu_level: l.kouryu,
      stats: {
        base: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
        total_after_non_skill_modifiers: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
      },
      photos: parseEquipment(l.photosJson, lane, "フォト(JSON)"),
      accessories: parseEquipment(l.accessoriesJson, lane, "アクセサリ(JSON)"),
    };
  });
  return { staff_bonus: { ...state.staff }, yale_bonus: { ...state.yell }, characters };
}

function missedNotes(): Array<{ beat: number; lane: number }> {
  if (state.missedNotesText.trim() === "") return [];
  const parsed: unknown = JSON.parse(state.missedNotesText);
  if (!Array.isArray(parsed)) throw new Error("missedNotes は配列である必要があります");
  return parsed as Array<{ beat: number; lane: number }>;
}

function mentalOverride(): Record<string, number> {
  return Object.fromEntries(state.lanes.map((l, i) => [String(i + 1), l.mental]));
}

/** DOM のチェックボックス状態 → 無効化スキルID列 */
function collectDisabled(): string[] {
  const out: string[] = [];
  state.lanes.forEach((l, i) => {
    const lane = (i + 1) as LaneNumber;
    for (const s of DATA.data.skillsGolden) {
      if (s.lane !== lane) continue;
      if (s.kind === "photo") {
        if (!l.enabledPhotoIds.has(s.id)) out.push(s.id);
      } else if (!l.enabledSkillIds.has(s.id)) {
        out.push(s.id);
      }
    }
  });
  return out;
}

/** レーンカードの入力値を state へ収集 */
function collectLaneInputs(i: number): void {
  const card = document.querySelector(`.lane-card[data-lane="${i + 1}"]`);
  if (card === null) return;
  const l = state.lanes[i]!;
  l.cardId = (card.querySelector('[data-act="card"]') as HTMLSelectElement).value;
  l.level = Number((card.querySelector('[data-act="level"]') as HTMLSelectElement).value);
  l.rarity = Number((card.querySelector('[data-act="rarity"]') as HTMLInputElement).value) || 1;
  l.kouryu = Number((card.querySelector('[data-act="kouryu"]') as HTMLInputElement).value) || 1;
  l.mental = Number((card.querySelector('[data-act="mental"]') as HTMLInputElement).value) || 0;
  l.role = (card.querySelector('[data-act="role"]') as HTMLSelectElement)
    .value as LaneUiState["role"];
  l.photosJson = (card.querySelector('[data-act="photos-json"]') as HTMLTextAreaElement).value;
  l.accessoriesJson = (card.querySelector('[data-act="accessories-json"]') as HTMLTextAreaElement)
    .value;
  const checks = [...card.querySelectorAll<HTMLInputElement>("input[data-skill]")];
  l.enabledSkillIds = new Set(
    checks.filter((el) => el.checked && !el.dataset.skill!.startsWith("photo-")).map((el) => el.dataset.skill!),
  );
  l.enabledPhotoIds = new Set(
    checks.filter((el) => el.checked && el.dataset.skill!.startsWith("photo-")).map((el) => el.dataset.skill!),
  );
}

function collectAllLaneInputs(): void {
  state.lanes.forEach((_, i) => collectLaneInputs(i));
}

// ---------------------------------------------------------------------------
// 描画: 設定パネル
// ---------------------------------------------------------------------------

function cardOptions(selected: string): string {
  const byChar = new Map<string, typeof DATA.data.cards>();
  for (const c of DATA.data.cards) {
    const arr = byChar.get(c.characterId);
    if (arr) arr.push(c);
    else byChar.set(c.characterId, [c]);
  }
  let html = "";
  for (const [charId, cards] of [...byChar.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    html += `<optgroup label="${esc(charId)}">`;
    for (const c of cards) {
      const sel = c.id === selected ? " selected" : "";
      html += `<option value="${esc(c.id)}"${sel}>${esc(c.name)}（☆${c.initialRarity}）</option>`;
    }
    html += "</optgroup>";
  }
  return html;
}

function skillRow(s: SkillDef, enabled: boolean): string {
  const badge = CONF_BADGE[skillConfidence(s)] ?? "badge-u";
  const kindLabel = { A: "A", SP: "SP", P: "P", photo: "フォト" }[s.kind];
  const ct = s.ct != null ? `CT${s.ct}` : "CT—";
  const cost = s.staminaCost != null ? `消費${s.staminaCost}` : "消費—";
  return `<label class="skill-row"><input type="checkbox" data-skill="${esc(s.id)}"${enabled ? " checked" : ""}>
    <span class="kind kind-${s.kind}">${kindLabel}</span> ${esc(s.name)}
    <span class="skill-meta">Lv${s.level}・${ct}・${cost}</span>
    <span class="badge ${badge}">${skillConfidence(s)}</span></label>`;
}

function laneCardHtml(i: number): string {
  const l = state.lanes[i]!;
  const lane = (i + 1) as LaneNumber;
  const card = cardOf(l.cardId);
  const skills = DATA.data.skillsGolden.filter(
    (s) => s.lane === lane && (s.kind === "A" || s.kind === "SP" || s.kind === "P"),
  );
  const photos = DATA.data.skillsGolden.filter(
    (s) => s.lane === lane && s.kind === "photo" && s.effects.length > 0,
  );
  const levels = availableLevels(DATA.data, l.cardId);
  const levelOpts = levels
    .map((lv) => `<option value="${lv}"${lv === l.level ? " selected" : ""}>Lv${lv}</option>`)
    .join("");
  const attr = laneAttributeOf(lane, LANE_ATTRS);
  return `<div class="lane-card" data-lane="${i + 1}">
    <h3>${LANE_LABELS[i]} <span class="attr attr-${attr}">${attr === "dance" ? "Da" : attr === "visual" ? "Vi" : "Vo"}</span></h3>
    <div class="field"><label>カード</label><select data-act="card">${cardOptions(l.cardId)}</select></div>
    <div class="card-name">${card ? esc(card.name) : "—"}</div>
    <div class="grid2">
      <div class="field"><label>レベル</label><select data-act="level">${levelOpts}</select></div>
      <div class="field"><label>開花（現在☆）</label><input type="number" data-act="rarity" min="1" max="10" step="1" value="${l.rarity}"></div>
      <div class="field"><label>交流Lv</label><input type="number" data-act="kouryu" min="1" max="60" step="1" value="${l.kouryu}"></div>
      <div class="field"><label>メンタル</label><input type="number" data-act="mental" min="0" max="999" step="1" value="${l.mental}"></div>
    </div>
    <div class="field"><label>ロール</label>
      <select data-act="role">
        <option value="Scorer"${l.role === "Scorer" ? " selected" : ""}>Scorer</option>
        <option value="Buffer"${l.role === "Buffer" ? " selected" : ""}>Buffer</option>
        <option value="Supporter"${l.role === "Supporter" ? " selected" : ""}>Supporter</option>
      </select></div>
    <div class="deck-preview" id="deck-preview-${i + 1}"></div>
    <details><summary>スキル（A/SP/P ${skills.length}）</summary>${skills
      .map((s) => skillRow(s, l.enabledSkillIds.has(s.id)))
      .join("")}</details>
    <details><summary>フォト（${photos.length}）</summary>${photos
      .map((s) => skillRow(s, l.enabledPhotoIds.has(s.id)))
      .join("")}</details>
    <details><summary>フォト効果・アクセサリ（JSON）</summary>
      <div class="field"><label>フォト（ステータス補正）</label>
        <textarea data-act="photos-json" rows="4" spellcheck="false">${esc(l.photosJson)}</textarea></div>
      <div class="field"><label>アクセサリ（ステータス補正）</label>
        <textarea data-act="accessories-json" rows="4" spellcheck="false">${esc(l.accessoriesJson)}</textarea></div>
    </details>
  </div>`;
}

function numberInputs(
  obj: Record<string, number>,
  keys: readonly string[],
  labels: Record<string, string>,
  act: string,
): string {
  return keys
    .map(
      (k) =>
        `<div class="field"><label>${labels[k] ?? k}</label><input type="number" data-${act}="${k}" value="${obj[k] ?? 0}" step="any"></div>`,
    )
    .join("");
}

const STAFF_LABELS = { vocal: "Vo", dance: "Da", visual: "Vi", stamina: "Sta", mental: "Men", critical: "Cri" };
const YELL_LABELS = {
  vocal_pct: "Vo%",
  dance_pct: "Da%",
  visual_pct: "Vi%",
  stamina: "Sta",
  mental: "Men",
  critical: "Cri",
  beat_score_pct: "ビート%",
  a_skill_score_pct: "A%",
  sp_skill_score_pct: "SP%",
  critical_score_pct: "クリスコ%",
};

function renderConfig(): void {
  const root = $("#config-root");
  root.innerHTML = `
  <div class="panels">
    <div class="panel">
      <h2>共通設定</h2>
      <div class="stage-info">ステージ <b>qt-daily-003-19</b>（STAGE19・難易度286）／
        譜面 <b>chart-hsm-004-001</b>（156ノート）／
        ビート重み Vo${W.vocal}‰・Da${W.dance}‰・Vi${W.visual}‰</div>
      <div class="grid3">
        <div class="field"><label>個人来場ファン数</label><input type="number" id="g-audience" value="${state.audience}" step="1" min="0"></div>
        <div class="field"><label>成功率 基礎値%</label><input type="number" id="g-success" value="${state.successBasePct}" step="1" min="0" max="100"></div>
        <div class="field"><label>クリティカル率</label><input type="number" id="g-crit" value="${state.critRate}" step="0.01" min="0" max="1"></div>
        <div class="field"><label>Monte Carlo 回数</label><input type="number" id="g-runs" value="${state.mcRuns}" step="1" min="1" max="20000"></div>
        <div class="field"><label>乱数シード</label><input type="number" id="g-seed" value="${state.seed}" step="1"></div>
        <div class="field"><label>ファンファクター</label><div class="static" id="g-fan"></div></div>
      </div>
      <div class="field"><label>ミスノート（JSON: [{beat,lane}]）</label>
        <textarea id="g-missed" rows="2" spellcheck="false">${esc(state.missedNotesText)}</textarea></div>
      <div class="note">※ クリティカル率の式は未解明（Unknown）のため確率パラメータで指定します（既定 0）。※ メンタルは P スキルの発動順（メンタル降順）に影響します。</div>
    </div>
    <div class="panel">
      <h2>スタッフ育成ボーナス</h2>
      <div class="grid3">${numberInputs(
        state.staff as unknown as Record<string, number>,
        ["vocal", "dance", "visual", "stamina", "mental", "critical"],
        STAFF_LABELS,
        "staff",
      )}</div>
      <h2>ライブエール</h2>
      <div class="grid3">${numberInputs(
        state.yell as unknown as Record<string, number>,
        ["vocal_pct", "dance_pct", "visual_pct", "stamina", "mental", "critical", "beat_score_pct", "a_skill_score_pct", "sp_skill_score_pct", "critical_score_pct"],
        YELL_LABELS,
        "yell",
      )}</div>
    </div>
  </div>
  <h2>編成（アイドル 5 人）</h2>
  <div class="lanes">${state.lanes.map((_, i) => laneCardHtml(i)).join("")}</div>
  <div class="actions">
    <button id="btn-run" class="primary">シミュレーション実行</button>
    <button id="btn-export">編成JSON エクスポート</button>
    <label class="btn-like">編成JSON インポート<input type="file" id="file-import" accept=".json" hidden></label>
    <button id="btn-preset">T5実測プリセットに戻す</button>
    <button id="btn-save">ブラウザに保存</button>
    <button id="btn-load">保存から復元</button>
  </div>
  <div id="status" class="status"></div>`;
  bindConfigEvents();
  updateFanFactor();
  updateDeckPreviews();
}

function readGlobalInputs(): void {
  state.audience = Number(($("#g-audience") as HTMLInputElement).value) || 0;
  state.successBasePct = Number(($("#g-success") as HTMLInputElement).value) || 0;
  state.critRate = Number(($("#g-crit") as HTMLInputElement).value) || 0;
  state.mcRuns = Math.max(1, Math.floor(Number(($("#g-runs") as HTMLInputElement).value) || 1));
  state.seed = Math.floor(Number(($("#g-seed") as HTMLInputElement).value) || 1);
  state.missedNotesText = ($("#g-missed") as HTMLTextAreaElement).value;
}

function updateFanFactor(): void {
  const el = $("#g-fan");
  const table = DATA.data.audienceAdvantage;
  const fan = table
    ? fanBonusPermil(state.audience, table)
    : 1620;
  el.textContent = `${fmtInt(fan)}‰（+${((fan - 1000) / 10).toFixed(1)}%）`;
}

function refreshLevelOptions(i: number): void {
  const card = document.querySelector(`.lane-card[data-lane="${i + 1}"]`);
  if (card === null) return;
  const l = state.lanes[i]!;
  const levels = availableLevels(DATA.data, l.cardId);
  const sel = card.querySelector('[data-act="level"]') as HTMLSelectElement;
  sel.innerHTML = levels
    .map((lv) => `<option value="${lv}"${lv === l.level ? " selected" : ""}>Lv${lv}</option>`)
    .join("");
  if (!levels.includes(l.level) && levels.length > 0) {
    l.level = levels[levels.length - 1]!;
    sel.value = String(l.level);
  }
}

/** デッキ値プレビュー（buildSimulateInput と同一経路で計算） */
function updateDeckPreviews(): void {
  try {
    collectAllLaneInputs();
    const built = buildSimulateInput({
      deck: toDeck(),
      stageFile: DATA.stageFile,
      chartFile: DATA.chartFile,
      data: DATA.data,
      disabledSkillIds: collectDisabled(),
    });
    built.base.lanes.forEach((laneInput) => {
      const preview = $(`#deck-preview-${laneInput.lane}`);
      preview.innerHTML =
        `<span>Vo ${fmtInt(laneInput.deck.vocal)}</span><span>Da ${fmtInt(laneInput.deck.dance)}</span>` +
        `<span>Vi ${fmtInt(laneInput.deck.visual)}</span><span>Sta ${fmtInt(laneInput.deck.stamina)}</span>`;
    });
  } catch {
    // 入力が未完成（JSON 不備等）の間はプレビューを更新しない
  }
}

function renderLaneCard(i: number): void {
  const el = document.querySelector(`.lane-card[data-lane="${i + 1}"]`);
  if (el === null) return;
  el.outerHTML = laneCardHtml(i);
  updateDeckPreviews();
}

function bindConfigEvents(): void {
  document.querySelectorAll<HTMLSelectElement>('[data-act="card"]').forEach((sel, i) => {
    sel.addEventListener("change", () => {
      collectLaneInputs(i);
      refreshLevelOptions(i);
      renderLaneCard(i);
    });
  });
  document.querySelectorAll<HTMLInputElement>('input[data-staff]').forEach((el) => {
    el.addEventListener("change", () => {
      state.staff = {
        ...state.staff,
        [el.dataset.staff!]: Number(el.value) || 0,
      };
      updateDeckPreviews();
    });
  });
  document.querySelectorAll<HTMLInputElement>('input[data-yell]').forEach((el) => {
    el.addEventListener("change", () => {
      state.yell = {
        ...state.yell,
        [el.dataset.yell!]: Number(el.value) || 0,
      };
      updateDeckPreviews();
    });
  });
  document.querySelectorAll<HTMLInputElement>("#g-audience").forEach((el) => {
    el.addEventListener("change", () => {
      state.audience = Number(el.value) || 0;
      updateFanFactor();
    });
  });
  $("#btn-run").addEventListener("click", () => runSimulation());
  $("#btn-export").addEventListener("click", exportConfig);
  $("#file-import").addEventListener("change", importConfig);
  $("#btn-preset").addEventListener("click", () => {
    state = defaultLaneState();
    renderConfig();
    setStatus("T5 実測プリセットを復元しました");
  });
  $("#btn-save").addEventListener("click", () => {
    saveState();
    setStatus("ブラウザに保存しました");
  });
  $("#btn-load").addEventListener("click", () => loadState());
}

function setStatus(msg: string, isError = false): void {
  const el = $("#status");
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

interface RunOutput {
  confirmed: { totalScore: number; lanes: LaneBreakdownEntry[] };
  stats: {
    min: number;
    max: number;
    mean: number;
    median: number;
    p10: number;
    p90: number;
    laneMeans: Array<{ lane: number; mean: number }>;
  };
  result: TimelineResult;
  fanFactorPermil: number;
  warnings: string[];
}

let lastOutput: RunOutput | null = null;

function runSimulation(): void {
  try {
    readGlobalInputs();
    collectAllLaneInputs();
    const built = buildSimulateInput({
      deck: toDeck(),
      stageFile: DATA.stageFile,
      chartFile: DATA.chartFile,
      data: DATA.data,
      audience: state.audience > 0 ? state.audience : undefined,
      successBasePermil: Math.round(state.successBasePct * 10),
      missedNotes: missedNotes(),
      mentalOverride: mentalOverride(),
      disabledSkillIds: collectDisabled(),
    });
    const base = built.base;

    // 確定値ラン（乱数中立・クリティカルなし）
    const confirmedRes = simulateTimeline({
      ...base,
      rng: new NeutralRng(),
      criticalProvider: () => false,
    });
    const confirmed = {
      totalScore: confirmedRes.totalScore,
      lanes: laneBreakdown(confirmedRes.beats),
    };

    // Monte Carlo（シード固定・連続値乱数・crit は確率パラメータ）
    const runs = state.mcRuns;
    const scores: number[] = [];
    const laneSums = new Map<number, number>();
    for (let i = 0; i < runs; i++) {
      const rng = new ContinuousRng(state.seed + i, state.critRate);
      const res = simulateTimeline({ ...base, rng, criticalProvider: () => rng.nextCritical() });
      scores.push(res.totalScore);
      for (const bt of res.beats) {
        for (const e of bt.events) {
          laneSums.set(e.lane, (laneSums.get(e.lane) ?? 0) + e.gainedScore);
        }
      }
    }
    scores.sort((a, b) => a - b);
    const pct = (p: number): number =>
      scores[Math.min(scores.length - 1, Math.max(0, Math.round((scores.length - 1) * p)))]!;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

    lastOutput = {
      confirmed,
      stats: {
        min: scores[0]!,
        max: scores[scores.length - 1]!,
        mean,
        median: pct(0.5),
        p10: pct(0.1),
        p90: pct(0.9),
        laneMeans: [...laneSums.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([lane, sum]) => ({ lane, mean: sum / runs })),
      },
      result: confirmedRes,
      fanFactorPermil: base.fanFactorPermil,
      warnings: built.warnings,
    };
    $("#results").hidden = false;
    renderResults();
    setStatus(
      `完了: 確定値 ${fmtScore(confirmed.totalScore)} ／ MC ${runs}回 mean ${fmtScore(mean)}` +
        (built.warnings.length > 0 ? ` ／ 警告 ${built.warnings.length}件（コンソール参照）` : ""),
    );
    for (const w of built.warnings) {
      console.warn("[warn]", w);
    }
    saveState();
  } catch (e) {
    setStatus(`エラー: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

// ---------------------------------------------------------------------------
// 描画: 結果
// ---------------------------------------------------------------------------

function renderResults(): void {
  const out = lastOutput;
  if (out === null) return;
  const s = out.stats;
  $("#kpi-root").innerHTML = `
    <div class="kpi"><div class="kpi-label">確定値（乱数1000・critなし）</div><div class="kpi-value confirmed">${fmtScore(out.confirmed.totalScore)}</div><div class="kpi-sub">${fmtInt(out.confirmed.totalScore)}</div></div>
    <div class="kpi"><div class="kpi-label">期待値（MC mean）</div><div class="kpi-value">${fmtScore(s.mean)}</div><div class="kpi-sub">${fmtInt(s.mean)}</div></div>
    <div class="kpi"><div class="kpi-label">中央値</div><div class="kpi-value">${fmtScore(s.median)}</div><div class="kpi-sub">${fmtInt(s.median)}</div></div>
    <div class="kpi"><div class="kpi-label">10-90% レンジ</div><div class="kpi-value sm">${fmtScore(s.p10)} 〜 ${fmtScore(s.p90)}</div><div class="kpi-sub">±5% スコア乱数</div></div>
    <div class="kpi"><div class="kpi-label">min / max</div><div class="kpi-value sm">${fmtScore(s.min)} / ${fmtScore(s.max)}</div><div class="kpi-sub">${fmtInt(s.min)} / ${fmtInt(s.max)}</div></div>`;
  renderLaneTable();
  drawScoreGraph();
  renderBuffPanel();
  renderTimelineTable();
}

function renderLaneTable(): void {
  const out = lastOutput!;
  const rows = out.confirmed.lanes
    .map((l) => {
      const ui = state.lanes[l.lane - 1]!;
      const card = cardOf(ui.cardId);
      const mean = out.stats.laneMeans.find((m) => m.lane === l.lane)?.mean ?? 0;
      const share = ((l.total / out.confirmed.totalScore) * 100).toFixed(1);
      return `<tr>
      <td>L${l.lane}</td><td>${card ? esc(card.name) : "—"}</td><td>${esc(ui.role)}</td>
      <td class="num">${fmtInt(l.total)}</td><td class="num">${share}%</td><td class="num">${fmtInt(mean)}</td>
      <td class="num">${fmtInt(l.byKind.beat)}</td><td class="num">${fmtInt(l.byKind.A)}</td>
      <td class="num">${fmtInt(l.byKind.SP)}</td><td class="num">${fmtInt(l.byKind.photo)}</td>
      <td class="num">${fmtInt(l.byKind.P)}</td><td class="num">${l.activations}</td></tr>`;
    })
    .join("");
  $("#lane-table").innerHTML = `<thead><tr>
    <th>レーン</th><th>カード</th><th>ロール</th><th>確定値合計</th><th>構成比</th><th>MC平均</th>
    <th>ビート</th><th>A</th><th>SP</th><th>フォト</th><th>P</th><th>発動数</th>
  </tr></thead><tbody>${rows}</tbody>`;
}

function drawScoreGraph(): void {
  const canvas = $("#score-graph") as HTMLCanvasElement;
  const beats = lastOutput!.result.beats;
  let cum = 0;
  const points: Array<[number, number]> = [[0, 0]];
  for (const bt of beats) {
    cum += bt.events.reduce((s, e) => s + e.gainedScore, 0);
    points.push([bt.beat, cum]);
  }
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = 300;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  const padL = 70;
  const padB = 28;
  const padT = 12;
  const padR = 12;
  const maxB = beats[beats.length - 1]?.beat ?? 1;
  const maxS = points[points.length - 1]![1];
  const x = (b: number): number => padL + ((cssW - padL - padR) * b) / maxB;
  const y = (v: number): number => padT + (cssH - padT - padB) * (1 - v / maxS);
  ctx.strokeStyle = "#ddd";
  ctx.fillStyle = "#666";
  ctx.font = "11px sans-serif";
  for (let g = 0; g <= 5; g++) {
    const v = (maxS * g) / 5;
    ctx.beginPath();
    ctx.moveTo(padL, y(v));
    ctx.lineTo(cssW - padR, y(v));
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(fmtScore(v), padL - 6, y(v) + 4);
  }
  for (let b = 0; b <= maxB; b += 25) {
    ctx.textAlign = "center";
    ctx.fillText(String(b), x(b), cssH - 10);
  }
  ctx.strokeStyle = "#4a6fd4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [b, v] of points) {
    if (b === 0) ctx.moveTo(x(b), y(v));
    else ctx.lineTo(x(b), y(v));
  }
  ctx.stroke();
  ctx.fillStyle = "#4a6fd4";
  ctx.textAlign = "left";
  ctx.fillText(`最終 ${fmtScore(maxS)}`, x(maxB) - 90, y(maxS) + 14);
}

const BUFF_KEYS: BuffKey[] = [
  "vocal_up",
  "vocal_boost",
  "vocal_up_extreme",
  "tension_up",
  "score_up",
  "a_skill_score_up",
  "sp_skill_score_up",
  "combo_score_up",
  "critical_coeff_up",
  "critical_rate_up",
  "stamina_cost_down",
  "skill_success_up",
  "focus",
  "combo_continue",
];

function renderBuffPanel(): void {
  const sel = $("#buff-lane") as HTMLSelectElement;
  if (sel.options.length === 0) {
    sel.innerHTML = LANE_LABELS.map((t, i) => `<option value="${i + 1}">${t}</option>`).join("");
    sel.value = "3";
    const keys = $("#buff-keys") as HTMLElement;
    keys.innerHTML = BUFF_KEYS.map(
      (k) => `<label class="buff-key"><input type="checkbox" data-buffkey="${k}" checked> ${k}</label>`,
    ).join("");
    keys.addEventListener("change", renderBuffHeatmap);
    sel.addEventListener("change", renderBuffHeatmap);
  }
  renderBuffHeatmap();
}

function renderBuffHeatmap(): void {
  const out = lastOutput;
  if (out === null) return;
  const lane = Number(($("#buff-lane") as HTMLSelectElement).value);
  const keys = [...document.querySelectorAll<HTMLInputElement>("input[data-buffkey]")]
    .filter((el) => el.checked)
    .map((el) => el.dataset.buffkey as BuffKey);
  const maxByKey = new Map<BuffKey, number>();
  for (const bt of out.result.beats) {
    const snap = bt.buffSnapshots[lane - 1]!;
    for (const k of keys) {
      maxByKey.set(k, Math.max(maxByKey.get(k) ?? 0, snap[k] ?? 0));
    }
  }
  const head = `<tr><th>key＼beat</th>${out.result.beats.map((bt) => `<th>${bt.beat}</th>`).join("")}</tr>`;
  const body = keys
    .map((k) => {
      const max = Math.max(1, maxByKey.get(k) ?? 1);
      const hue = k.includes("vocal") || k.includes("tension") ? 340 : k.includes("critical") ? 45 : 210;
      const cells = out.result.beats
        .map((bt) => {
          const v = bt.buffSnapshots[lane - 1]![k] ?? 0;
          const alpha = (v / max) * 0.85;
          return `<td class="buff-cell" style="background:hsla(${hue},70%,50%,${alpha.toFixed(3)})" title="b${bt.beat} ${k}=${v}">${v > 0 ? v : ""}</td>`;
        })
        .join("");
      return `<tr><th>${k}</th>${cells}</tr>`;
    })
    .join("");
  $("#buff-heatmap").innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

const TYPE_LABEL: Record<number, string> = { 1: "ビート", 2: "A", 3: "SP" };

function renderTimelineTable(): void {
  const out = lastOutput!;
  let cum = 0;
  const rows = out.result.beats
    .map((bt) => {
      const perLane = new Map<number, { sum: number; crit: boolean }>();
      for (const e of bt.events) {
        const cur = perLane.get(e.lane) ?? { sum: 0, crit: false };
        cur.sum += e.gainedScore;
        cur.crit = cur.crit || e.critFactorPermil > 1000;
        perLane.set(e.lane, cur);
      }
      const gained = bt.events.reduce((s, e) => s + e.gainedScore, 0);
      cum += gained;
      const cells = [1, 2, 3, 4, 5]
        .map((lane) => {
          const v = perLane.get(lane);
          if (v === undefined || v.sum === 0) return `<td class="num dim">—</td>`;
          return `<td class="num${v.crit ? " crit" : ""}">${fmtScore(v.sum)}${v.crit ? "★" : ""}</td>`;
        })
        .join("");
      const acts = bt.activations
        .map((a) => {
          const skill = DATA.data.skillsGolden.find((s) => s.id === a.skillId);
          const name = skill ? skill.name : a.skillId;
          return `<span class="act ${a.success ? "ok" : "ng"}" title="${esc(name)}（${a.kind}・${a.phase}${a.staminaCost != null ? `・消費${a.staminaCost}` : ""}${a.failReason ? `・${a.failReason}` : ""}）">${esc(shortName(name))}${a.success ? "" : "✕"}</span>`;
        })
        .join(" ");
      return `<tr><td>${bt.beat}</td><td><span class="kind kind-${bt.noteType === 1 ? "beat" : bt.noteType === 2 ? "A" : "SP"}">${TYPE_LABEL[bt.noteType]}</span></td>
        ${cells}<td class="num">${fmtScore(gained)}</td><td class="num">${fmtScore(cum)}</td><td class="acts">${acts}</td></tr>`;
    })
    .join("");
  $("#timeline-table").innerHTML = `<thead><tr>
    <th>beat</th><th>種別</th><th>L1</th><th>L2</th><th>L3</th><th>L4</th><th>L5</th><th>獲得</th><th>累積</th><th>発動</th>
  </tr></thead><tbody>${rows}</tbody>`;
}

function shortName(name: string): string {
  return name.length > 8 ? name.slice(0, 8) + "…" : name;
}

// ---------------------------------------------------------------------------
// インポート / エクスポート / 保存
// ---------------------------------------------------------------------------

function exportConfig(): void {
  try {
    readGlobalInputs();
    collectAllLaneInputs();
    const config = {
      deck: toDeck(),
      stage: { file: DATA.stageFile },
      chart: { file: DATA.chartFile },
      audience: state.audience,
      successBasePermil: Math.round(state.successBasePct * 10),
      missedNotes: missedNotes(),
      mentalOverride: mentalOverride(),
      disabledSkillIds: collectDisabled(),
      critRate: state.critRate,
    };
    const blob = new Blob([JSON.stringify(config, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "aipura-sim-config.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("編成JSONをエクスポートしました（npm run simulate -- --input で利用可）");
  } catch (e) {
    setStatus(`エクスポート失敗: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

function importConfig(ev: Event): void {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (file === undefined) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      applyConfig(JSON.parse(String(reader.result)));
      renderConfig();
      setStatus(`インポート完了: ${file.name}`);
    } catch (e) {
      setStatus(`インポート失敗: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  };
  reader.readAsText(file);
}

function applyConfig(cfg: Record<string, unknown> & { characters?: unknown }): void {
  state = defaultLaneState();
  if (cfg.staff_bonus !== undefined) state.staff = cfg.staff_bonus as AppState["staff"];
  if (cfg.yale_bonus !== undefined) state.yell = cfg.yale_bonus as AppState["yell"];
  if (Array.isArray(cfg.characters)) {
    for (const chRaw of cfg.characters) {
      const ch = chRaw as Record<string, unknown> & { lane: number };
      const l = state.lanes[ch.lane - 1];
      if (l === undefined) continue;
      if (ch.card_id !== undefined) l.cardId = String(ch.card_id);
      if (ch.level !== undefined) l.level = Number(ch.level);
      if (ch.rarity !== undefined) l.rarity = Number(ch.rarity);
      if (ch.kouryu_level !== undefined) l.kouryu = Number(ch.kouryu_level);
      if (ch.role !== undefined) l.role = String(ch.role) as LaneUiState["role"];
      if (Array.isArray(ch.photos)) l.photosJson = JSON.stringify(ch.photos, null, 1);
      if (Array.isArray(ch.accessories)) l.accessoriesJson = JSON.stringify(ch.accessories, null, 1);
    }
  }
  if (typeof cfg.audience === "number") state.audience = cfg.audience;
  if (typeof cfg.critRate === "number") state.critRate = cfg.critRate;
  if (typeof cfg.successBasePermil === "number") state.successBasePct = cfg.successBasePermil / 10;
  if (Array.isArray(cfg.missedNotes)) state.missedNotesText = JSON.stringify(cfg.missedNotes);
  if (cfg.mentalOverride !== undefined && typeof cfg.mentalOverride === "object") {
    for (const [k, v] of Object.entries(cfg.mentalOverride as Record<string, unknown>)) {
      const l = state.lanes[Number(k) - 1];
      if (l !== undefined) l.mental = Number(v);
    }
  }
  const disabled = new Set<string>((cfg.disabledSkillIds as string[] | undefined) ?? []);
  state.lanes.forEach((l, i) => {
    const lane = (i + 1) as LaneNumber;
    for (const s of DATA.data.skillsGolden) {
      if (s.lane !== lane) continue;
      if (s.kind === "photo") {
        if (disabled.has(s.id)) l.enabledPhotoIds.delete(s.id);
        else l.enabledPhotoIds.add(s.id);
      } else if (disabled.has(s.id)) {
        l.enabledSkillIds.delete(s.id);
      } else {
        l.enabledSkillIds.add(s.id);
      }
    }
  });
}

const LS_KEY = "aipura-sim-state-v1";

function serializeState(): string {
  collectAllLaneInputs();
  readGlobalInputs();
  return JSON.stringify({
    ...state,
    lanes: state.lanes.map((l) => ({
      ...l,
      enabledSkillIds: [...l.enabledSkillIds],
      enabledPhotoIds: [...l.enabledPhotoIds],
    })),
  });
}

function saveState(): void {
  try {
    localStorage.setItem(LS_KEY, serializeState());
  } catch {
    // localStorage 利用不可の環境では無視
  }
}

function loadState(): void {
  const raw = localStorage.getItem(LS_KEY);
  if (raw === null) {
    setStatus("保存された状態はありません", true);
    return;
  }
  try {
    const parsed = JSON.parse(raw) as AppState;
    state = { ...defaultLaneState(), ...parsed };
    state.lanes = parsed.lanes.map((l) => ({
      ...l,
      enabledSkillIds: new Set(l.enabledSkillIds),
      enabledPhotoIds: new Set(l.enabledPhotoIds),
    }));
    renderConfig();
    setStatus("保存した状態を復元しました");
  } catch (e) {
    setStatus(`復元失敗: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

// ---------------------------------------------------------------------------
// 初期化
// ---------------------------------------------------------------------------

function confidenceHtml(): string {
  return `
  <dl class="conf-list">
    <dt><span class="badge badge-c">Confirmed</span></dt>
    <dd>スコア乱数 ±5% 連続値／at-end 丸め／ビート基本式（総和×8/140）／B1・CB・ファン・クリティカル係数／
    CT 規則（発動時満タン・前半実効 CT−1）／対象解決（スコアラー・vocal 降順・隣接）／
    combo&gt;=N はグローバル成功数／増強=キー毎最長・延長=全インスタンス／バフ超過分の内部保持。
    実測 1 ライブ（STAGE19）で総スコア 1 の位まで検証済み。</dd>
    <dt><span class="badge badge-e">Estimate</span></dt>
    <dd>P/フォトのスコア重み=1000‰／成功率の副効果（テンション −1.5%/段）／
    発動候補の配列順ルール／スコア乱数とクリティカルの抽選順。</dd>
    <dt><span class="badge badge-u">Unknown</span></dt>
    <dd>クリティカル発生率の式（確率パラメータで代替）／個人来場ファン数の算出式
    （ゲーム表示値からテーブル引き）／ミスノート時の再挑戦仕様。</dd>
  </dl>`;
}

function init(): void {
  renderConfig();
  $("#confidence-body").innerHTML = confidenceHtml();
  $("#built-at").textContent = DATA.builtAt;
}

init();

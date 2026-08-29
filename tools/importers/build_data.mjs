#!/usr/bin/env node
/**
 * build_data.mjs — 日本版マスタデータ (MalitsPlus/ipr-master-diff) → 計算機用 data/ 変換パイプライン
 *
 * 使い方:
 *   node tools/importers/build_data.mjs               # 取得 → 検証 → data/ 生成
 *   node tools/importers/build_data.mjs --fetch-only  # vendor/ への取得のみ
 *
 * - 生ファイルは vendor/ にキャッシュ（存在かつサイズ>0なら再取得しない）
 * - data/*.json は UTF-8 (BOMなし) で出力
 * - region 検証 / 譜面整合チェックの失敗は異常終了
 * - audience / staff の実測照合の不一致は警告のみ（ビルドは継続）
 *
 * 出典: research/03_data_sources.md §2.1/§6.3, research/07_master_lookup.md
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FETCH_ONLY = process.argv.includes("--fetch-only");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VENDOR_DIR = path.join(ROOT, "vendor");
const DATA_DIR = path.join(ROOT, "data");
const STAGES_DIR = path.join(DATA_DIR, "stages");
const CHARTS_DIR = path.join(DATA_DIR, "charts");

const RAW_BASE = "https://raw.githubusercontent.com/MalitsPlus/ipr-master-diff/main/";
const TABLES = [
  "Card",
  "CardParameter",
  "CardRarity",
  "CardLevel",
  "StaffLevel",
  "Quest",
  "QuestAudienceAdvantage",
  "ComboAdvantage",
  "Music",
  "MusicChartPattern",
  "Skill",
  "SkillEfficacy",
];
const VERSION_FILE = "!version.txt";

const STAGE_ID = "qt-daily-003-19";
const CHART_ID = "chart-hsm-004-001";

const warnings = [];

// ---------- ユーティリティ ----------

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function isCached(file) {
  return existsSync(file) && statSync(file).size > 0;
}

async function fetchOnce(url) {
  const res = await fetch(url, { headers: { "user-agent": "aipura-score-calc/build_data" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length === 0) throw new Error(`empty response for ${url}`);
  return body;
}

async function download(name, dest) {
  if (isCached(dest)) {
    console.log(`[cache] vendor/${name}`);
    return;
  }
  // まず name をそのまま、ダメなら percent-encoding で再試行（!version.txt 等）
  const urls = [RAW_BASE + name, RAW_BASE + encodeURIComponent(name)];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of urls) {
      try {
        const body = await fetchOnce(url);
        writeFileSync(dest, body);
        console.log(`[dl]    vendor/${name} (${(body.length / 1024).toFixed(1)} KiB)`);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`download failed: ${name} (${lastErr?.message ?? "unknown"})`);
}

function loadVendor(name) {
  return JSON.parse(readFileSync(path.join(VENDOR_DIR, name), "utf-8"));
}

function num(value, ctx) {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new Error(`数値化できない値: ${JSON.stringify(value)} (${ctx})`);
  return n;
}

function requireField(row, field, ctx) {
  if (row == null || row[field] === undefined || row[field] === null) {
    const keys = row ? Object.keys(row).join(",") : "null";
    throw new Error(`フィールド "${field}" がありません (${ctx})。keys: ${keys}`);
  }
  return row[field];
}

function byId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function writeJson(file, obj) {
  writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
  console.log(`[write] ${path.relative(ROOT, file)} (${(statSync(file).size / 1024).toFixed(1)} KiB)`);
}

function hardFail(message) {
  console.error(`[check] FAIL: ${message}`);
  process.exit(1);
}

// ---------- メイン ----------

async function main() {
  ensureDir(VENDOR_DIR);
  for (const table of TABLES) {
    await download(`${table}.json`, path.join(VENDOR_DIR, `${table}.json`));
  }
  await download(VERSION_FILE, path.join(VENDOR_DIR, VERSION_FILE));

  if (FETCH_ONLY) {
    console.log("--fetch-only: 変換をスキップしました");
    return;
  }

  ensureDir(STAGES_DIR);
  ensureDir(CHARTS_DIR);

  const version = readFileSync(path.join(VENDOR_DIR, VERSION_FILE), "utf-8").trim();
  const cardRows = loadVendor("Card.json");
  const cardParamRows = loadVendor("CardParameter.json");
  const staffRows = loadVendor("StaffLevel.json");
  const questRows = loadVendor("Quest.json");
  const audienceRows = loadVendor("QuestAudienceAdvantage.json");
  const comboRows = loadVendor("ComboAdvantage.json");
  const musicRows = loadVendor("Music.json");
  const chartRows = loadVendor("MusicChartPattern.json");

  // --- cards.json ---
  const cards = cardRows
    .map((r) => {
      const ctx = `Card ${r?.id}`;
      return {
        id: requireField(r, "id", ctx),
        name: requireField(r, "name", ctx),
        characterId: requireField(r, "characterId", ctx),
        initialRarity: num(requireField(r, "initialRarity", ctx), ctx),
        cardParameterId: requireField(r, "cardParameterId", ctx),
        ratiosPermil: {
          vocal: num(requireField(r, "vocalRatioPermil", ctx), ctx),
          dance: num(requireField(r, "danceRatioPermil", ctx), ctx),
          visual: num(requireField(r, "visualRatioPermil", ctx), ctx),
          stamina: num(requireField(r, "staminaRatioPermil", ctx), ctx),
        },
        skillIds: [r.skillId1, r.skillId2, r.skillId3, r.skillId4].filter(
          (s) => typeof s === "string" && s.length > 0,
        ),
      };
    })
    .sort((a, b) => byId(a.id, b.id));
  if (cards.length !== 491) {
    warnings.push(`Card.json の行数が ${cards.length}（想定 491。マスタ更新の可能性）`);
  }

  // --- card_parameters.json ---
  const params = cardParamRows
    .map((r) => {
      const ctx = `CardParameter ${r?.id}`;
      return {
        id: requireField(r, "id", ctx),
        level: num(requireField(r, "level", ctx), ctx),
        value: num(requireField(r, "value", ctx), ctx),
        staminaValue: num(requireField(r, "staminaValue", ctx), ctx),
      };
    })
    .sort((a, b) => byId(a.id, b.id) || a.level - b.level);
  const maxParamLevel = params.reduce((max, r) => Math.max(max, r.level), 0);

  // --- staff.json ---
  // StaffLevel.advantage は「そのレベルまでの累積値」（research/07 §4 で実測裏付け済み）。
  // そのためレベル昇順に並べた advantage の列がそのまま累積配列になる。
  const STAFF_TYPES = [
    ["dance", 1],
    ["vocal", 2],
    ["visual", 3],
    ["stamina", 4],
    ["mental", 5],
    ["critical", 6],
  ];
  const staffTypes = {};
  let staffMaxLevel = 0;
  for (const [key, enumValue] of STAFF_TYPES) {
    const rows = staffRows
      .filter((r) => num(r.parameterType) === enumValue)
      .sort((a, b) => num(a.level) - num(b.level));
    if (rows.length === 0) hardFail(`StaffLevel に parameterType=${enumValue} (${key}) の行がありません`);
    const cumulative = rows.map((r) =>
      num(requireField(r, "advantage", `StaffLevel type=${enumValue} Lv=${r.level}`)),
    );
    staffTypes[key] = { enum: enumValue, cumulative };
    staffMaxLevel = Math.max(staffMaxLevel, num(rows[rows.length - 1].level));
  }
  const staff = { maxLevel: staffMaxLevel, types: staffTypes };

  // --- stages/qt-daily-003-19.json ---
  const quest = questRows.find((r) => r.id === STAGE_ID);
  if (!quest) hardFail(`Quest に ${STAGE_ID} が存在しません`);
  const qctx = `Quest ${STAGE_ID}`;
  const stage = {
    id: quest.id,
    name: quest.name,
    areaId: quest.areaId,
    stageId: quest.stageId,
    musicId: quest.musicId,
    difficultyLevel: num(requireField(quest, "difficultyLevel", qctx), qctx),
    order: num(requireField(quest, "order", qctx), qctx),
    clearScore: num(requireField(quest, "clearScore", qctx), qctx),
    staminaRecoveryWeightPermil: num(quest.staminaRecoveryWeightPermil ?? 0, qctx),
    moodType: num(quest.moodType ?? 0, qctx),
    liveSkipType: num(quest.liveSkipType ?? 0, qctx),
    ticketAmount: num(quest.ticketAmount ?? 0, qctx),
    unlockConditionId: quest.unlockConditionId,
    questPressureId: quest.questPressureId,
    laneAttributes: [1, 2, 3, 4, 5].map((n) =>
      num(requireField(quest, `position${n}AttributeType`, qctx), qctx),
    ),
    beatWeightsPermil: {
      vocal: num(requireField(quest, "beatVocalWeightPermil", qctx), qctx),
      dance: num(requireField(quest, "beatDanceWeightPermil", qctx), qctx),
      visual: num(requireField(quest, "beatVisualWeightPermil", qctx), qctx),
    },
    skillWeightsPermil: {
      active: num(requireField(quest, "activeSkillWeightPermil", qctx), qctx),
      special: num(requireField(quest, "specialSkillWeightPermil", qctx), qctx),
      stamina: num(requireField(quest, "skillStaminaWeightPermil", qctx), qctx),
    },
    maxCapacity: num(requireField(quest, "maxCapacity", qctx), qctx),
    mentalThreshold: num(requireField(quest, "mentalThreshold", qctx), qctx),
    audienceAdvantageId: requireField(quest, "questAudienceAdvantageId", qctx),
    musicChartPatternId: requireField(quest, "musicChartPatternId", qctx),
  };

  // --- stages/audience_advantage.json ---
  let advRows = audienceRows.filter((r) => r.id === stage.audienceAdvantageId);
  if (advRows.length === 0) {
    warnings.push(
      `QuestAudienceAdvantage を id="${stage.audienceAdvantageId}" で絞り込めない（0行）のため全行を使用`,
    );
    advRows = audienceRows;
  }
  const audience = advRows
    .map((r) => ({
      audience: num(requireField(r, "audienceAmount", `QuestAudienceAdvantage ${r?.id}`)),
      advantagePermil: num(requireField(r, "advantagePermil", `QuestAudienceAdvantage ${r?.id}`)),
    }))
    .sort((a, b) => a.audience - b.audience);

  // --- stages/combo_advantage.json ---
  const combo = comboRows
    .map((r) => ({
      combo: num(requireField(r, "comboCount", `ComboAdvantage ${r?.id}`)),
      advantagePermil: num(requireField(r, "advantagePermil", `ComboAdvantage ${r?.id}`)),
    }))
    .sort((a, b) => a.combo - b.combo);

  // --- charts/chart-hsm-004-001.json ---
  // `number` はグリッド番号（本譜面は 1..268、空ビート type 0 を含む）。
  // ゲーム内の「ビート」（総ビート156）は type≠0 ノート列の順番なので採番し直す
  // （research/07 §1.3/§1.4: この採番で Aノーツ番号が実測発火ログと 16/16 一致）。
  const chartRowsSorted = chartRows
    .filter((r) => r.id === CHART_ID)
    .sort((a, b) => num(a.number) - num(b.number));
  const notes = [];
  let beatNo = 0;
  for (const r of chartRowsSorted) {
    const ctx = `MusicChartPattern ${CHART_ID} #${r.number}`;
    const type = num(requireField(r, "type", ctx), ctx);
    if (type === 0) continue;
    beatNo += 1;
    notes.push({
      beat: beatNo,
      type,
      position: num(requireField(r, "position", ctx), ctx),
    });
  }
  const chart = { id: CHART_ID, beats: notes.length, notes };

  // --- region 検証（research/03 §6.3 準拠。失敗したら異常終了） ---
  const regionChecks = [
    ["Card.json に日本語名（ひらがな/漢字）カードが存在", () =>
      cardRows.some((r) => /[\u3040-\u309F\u4E00-\u9FFF]/.test(String(r?.name ?? "")))],
    ["Music.json に JP限定コラボ曲 (music-clb-*) が存在", () =>
      musicRows.some((r) => String(r?.id ?? "").startsWith("music-clb-"))],
    ["CardParameter が Lv260 まで存在", () => maxParamLevel >= 260],
    [`Quest に ${STAGE_ID} が存在`, () => Boolean(quest)],
  ];
  for (const [label, ok] of regionChecks) {
    if (!ok()) hardFail(`region 検証: ${label}`);
    console.log(`[region] OK: ${label}`);
  }

  // --- 整合チェック（失敗したら異常終了） ---
  if (stage.musicChartPatternId !== CHART_ID) {
    hardFail(`${STAGE_ID} の musicChartPatternId が ${stage.musicChartPatternId}（期待値 ${CHART_ID}）`);
  }
  const noteCounts = {};
  for (const n of notes) noteCounts[n.type] = (noteCounts[n.type] ?? 0) + 1;
  const expected = { 1: 138, 2: 16, 3: 2 };
  for (const [type, count] of Object.entries(expected)) {
    if ((noteCounts[type] ?? 0) !== count) {
      hardFail(`${CHART_ID} の type${type} ノート数が ${noteCounts[type] ?? 0}（期待値 ${count}）`);
    }
  }
  if (notes.length !== 156 || chart.beats !== 156) {
    hardFail(`${CHART_ID} のノート総数が ${notes.length}（期待値 156 / beats=156）`);
  }
  const spBeats = notes.filter((n) => n.type === 3).map((n) => n.beat);
  if (JSON.stringify(spBeats) !== JSON.stringify([49, 103])) {
    hardFail(`${CHART_ID} の SPノーツbeat が [${spBeats}]（実測発火ログは [49,103]）`);
  }
  console.log(`[chart] OK: ${CHART_ID} beats=${chart.beats} (通常138 / A16 / SP2 @beat49,103)`);

  // --- 実測照合（不一致は警告のみで継続） ---
  const audHit = audience.find((r) => r.audience === 16000 && r.advantagePermil === 1620);
  if (audHit) {
    console.log("[audience] OK: 16000人 → 1620‰ (+62.0%) を確認");
  } else {
    warnings.push("audience 照合: audience=16000 → advantagePermil=1620 の行が見つからない");
  }
  const vocalLv65 = staff.types.vocal.cumulative[64];
  if (vocalLv65 === 29195) {
    console.log("[staff] OK: vocal Lv65 累積 = 29195");
  } else {
    warnings.push(`staff 照合: vocal Lv65 累積 = ${vocalLv65}（実測 29195 と不一致）`);
  }

  // --- data/ 生成 ---
  writeJson(path.join(DATA_DIR, "meta.json"), {
    region: "jp",
    data_version: version,
    source: "MalitsPlus/ipr-master-diff",
    built_at: new Date().toISOString(),
    license_note: "ゲームデータの権利は QualiArts に帰属。ファン用途・出典明記の上で利用",
  });
  writeJson(path.join(DATA_DIR, "cards.json"), { cards });
  writeJson(path.join(DATA_DIR, "card_parameters.json"), { rows: params });
  writeJson(path.join(DATA_DIR, "staff.json"), staff);
  writeJson(path.join(STAGES_DIR, `${STAGE_ID}.json`), stage);
  writeJson(path.join(STAGES_DIR, "audience_advantage.json"), audience);
  writeJson(path.join(STAGES_DIR, "combo_advantage.json"), combo);
  writeJson(path.join(CHARTS_DIR, `${CHART_ID}.json`), chart);
  writeJson(path.join(DATA_DIR, "yell.json"), {
    confidence: "Confirmed (やるキ士シート [S3] 実測。2023時点。最新版との差分要確認)",
    levels: {
      stat_pct: {
        vocal: [10, 15, 20, 30, 40],
        dance: [10, 15, 20, 30, 40],
        visual: [10, 15, 20, 30, 40],
      },
      stat_fix: {
        stamina: [70, 110, 150, 210, 280],
        critical: [100, 150, 200, 300, 400],
        mental: [100, 150, 200, 300, 400],
      },
      score_pct: {
        sp: [15, 25, 35, 50, 65],
        a: [5, 10, 15, 25, 30],
        beat: [20, 25, 30, 40, 50],
        critical_score: [10, 15, 20, 30, 35],
      },
    },
  });

  if (warnings.length > 0) {
    console.error("\n[warn] 警告あり:");
    for (const w of warnings) console.error(`  - ${w}`);
  }
  console.log("\nbuild_data: 完了");
}

main().catch((err) => {
  console.error(`build_data: 失敗 — ${err?.stack ?? err}`);
  process.exit(1);
});

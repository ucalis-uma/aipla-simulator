#!/usr/bin/env node
/**
 * build_data_phase6.mjs — Phase 6: カード・ステージDB統合用の拡張データ生成。
 *
 * vendor/（MalitsPlus/ipr-master-diff）→ data/ へ以下を追加生成する:
 *   - data/charts_all.json     全111譜面（[type, position] 配列・type≠0のみ・beat=添字+1）
 *   - data/stages_index.json   全5916ステージのコンパクト索引（曲/設定/譜面参照）。
 *                              【Phase 8】Area.json 由来の大分類カテゴリ（cat/areas）を付与:
 *                              main（メインライブ）/ highscore（ハイスコアライブ）/ daily（デイリー）/
 *                              tower（VENUSタワー）/ ex（EXタワー）/ exercise（合宿）/ tutorial / other
 *   - data/skills_master.json  全491カードの A/SP/P スキル（SkillEfficacy 解析→SkillDef 互換）
 *   - data/live_bonuses.json   【Phase 9】ステージのライブボーナスPスキル（questId → SkillDef 配列）。
 *                              Quest.liveBonusGroupId → LiveBonusGroup → LiveBonus → LiveAbility
 *                              → Skill.json (sk-live-*) を辿って抽出（research/16 §1 のデータ連携）
 *   - data/accessories.json    全624アクセサリ（補正を structured 形式へ変換）
 *   - data/characters.json     characterId → 名前マップ
 *
 * 使い方: node tools/importers/build_data_phase6.mjs
 * 依存: vendor/{MusicChartPattern,Quest,Music,Card,Skill,SkillEfficacy,Character,Accessory,SkillTarget,Area,LiveBonusGroup,LiveBonus,LiveAbility}.json
 *
 * マスタの SkillEfficacy id は「ef-<効果名>-<grade>[-target-<targetId>][-<duration>|chart_dependence]」
 * の文法。効果名→EffectType 写像は data/skills_golden.json（35スキル・実測較正済み）と
 * 突合検証済み（tools/validate_skills_master.mjs）。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VENDOR = path.join(ROOT, "vendor");
const DATA = path.join(ROOT, "data");

const REQUIRED = [
  "MusicChartPattern",
  "Quest",
  "Music",
  "Card",
  "Skill",
  "SkillEfficacy",
  "Character",
  "Accessory",
  "SkillTarget",
  "Area",
  // 【Phase 9】ライブボーナス（Quest.liveBonusGroupId から辿る一連のテーブル）
  "LiveBonusGroup",
  "LiveBonus",
  "LiveAbility",
  // 【Phase 8-B2】フォトマスタ（メモリアルフォト一覧・初期品質・能力）
  "PhotoAllInOne",
  "PhotoAbility",
  // 【Phase 8-B3】カードレベル解放（スキル枠/フォト枠の解放レベル・CardLevelRelease）
  "CardLevelRelease",
  // 【サンプル3・2026-09-04】キャラ優位（QuestCharacterAdvantage）
  "QuestCharacterAdvantage",
];

// vendor に無いテーブル（Character/Accessory/SkillTarget 等）は取得して補う
function fetchOnce(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": "aipura-score-calc/build_data_phase6" } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

async function ensureVendor() {
  mkdirSync(VENDOR, { recursive: true });
  for (const name of REQUIRED) {
    const dest = path.join(VENDOR, `${name}.json`);
    if (existsSync(dest) && statSync(dest).size > 0) {
      console.log(`[cache] vendor/${name}.json`);
      continue;
    }
    const body = await fetchOnce(
      `https://raw.githubusercontent.com/MalitsPlus/ipr-master-diff/main/${name}.json`,
    );
    writeFileSync(dest, body);
    console.log(`[dl]    vendor/${name}.json (${(body.length / 1024).toFixed(1)} KiB)`);
  }
}

function loadVendor(name) {
  return JSON.parse(readFileSync(path.join(VENDOR, `${name}.json`), "utf-8"));
}

function num(value, ctx) {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new Error(`数値化できない値: ${JSON.stringify(value)} (${ctx})`);
  return n;
}

// ---------------------------------------------------------------------------
// 1. 譜面（全111譜面）
// ---------------------------------------------------------------------------

function buildCharts(chartRows) {
  const byId = new Map();
  for (const r of chartRows) {
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r);
  }
  const charts = {};
  for (const [id, rows] of byId) {
    rows.sort((a, b) => num(a.number, id) - num(b.number, id));
    // type≠0 ノートのみ・beat = 添字+1（research/07 §1.3 の採番。実測 16/16 一致済み）
    charts[id] = rows
      .filter((r) => num(r.type, `${id}#${r.number}`) !== 0)
      .map((r) => [num(r.type, `${id}#${r.number}`), num(r.position, `${id}#${r.number}`)]);
  }
  return charts;
}

// ---------------------------------------------------------------------------
// 2. ステージ索引（全5916クエスト）
// ---------------------------------------------------------------------------

/** Area.type → 大分類カテゴリコード（UI のタブフィルタ・表示用） */
const AREA_TYPE_TO_CAT = {
  1: "main", // メインライブ
  2: "highscore", // ハイスコアライブ
  3: "daily", // デイリーライブ
  4: "tower", // VENUSタワー
  5: "ex", // EXタワー（月スト/サニピ/トリエル/リズノワ/IIIX/記念タワー）
  101: "tutorial", // チュートリアル
  102: "exercise", // 合宿
};

function buildStagesIndex(questRows, musicRows, charts, areaRows) {
  // エリア → { cat, name }（Area.json 由来・大分類は type から決定）
  const areaInfo = new Map(
    areaRows.map((r) => [
      String(r.id),
      {
        cat: AREA_TYPE_TO_CAT[num(r.type ?? 0, `Area.${r.id}`)] ?? "other",
        name: String(r.name ?? r.id ?? ""),
        order: num(r.order ?? 0, `Area.${r.id}.order`),
      },
    ]),
  );
  // 大分類 →（cat, order, name）でソートした一意エリア配列（quests[].ar で参照）
  const areaKeyToIdx = new Map();
  const areas = [];
  for (const a of [...areaInfo.values()].sort((x, y) => {
    const catCmp = x.cat.localeCompare(y.cat);
    if (catCmp !== 0) return catCmp;
    if (x.order !== y.order) return x.order - y.order;
    return x.name.localeCompare(y.name, "ja");
  })) {
    const key = `${a.cat}\u0000${a.name}`;
    if (!areaKeyToIdx.has(key)) {
      areaKeyToIdx.set(key, areas.length);
      areas.push({ c: a.cat, n: a.name });
    }
  }

  const musicIdx = new Map();
  const musics = musicRows
    .map((m) => ({
      id: String(m.id),
      n: String(m.name ?? ""),
      s: String(m.singer ?? ""),
      o: num(m.order ?? 0, "Music.order"),
    }))
    .sort((a, b) => a.o - b.o);
  musics.forEach((m, i) => musicIdx.set(m.id, i));

  const configs = [];
  const configIdx = new Map();
  const configKey = (q) =>
    JSON.stringify([
      [1, 2, 3, 4, 5].map((n) => num(q[`position${n}AttributeType`] ?? 0, q.id)),
      [
        num(q.beatVocalWeightPermil ?? 0, q.id),
        num(q.beatDanceWeightPermil ?? 0, q.id),
        num(q.beatVisualWeightPermil ?? 0, q.id),
      ],
      [
        num(q.activeSkillWeightPermil ?? 0, q.id),
        num(q.specialSkillWeightPermil ?? 0, q.id),
      ],
      // 【サンプル3・2026-09-03】スタミナ消費倍率（Quest.skillStaminaWeightPermil。
      // 標準1000・EXタワー等で3000等。vendor/Quest.json 由来・消費計算に乗る）
      num(q.skillStaminaWeightPermil ?? 1000, q.id),
      // 【サンプル3・2026-09-03】スタミナ回復倍率（Quest.staminaRecoveryWeightPermil。
      // 標準1000・0のステージあり（0は「特徴なし」=1000扱い）。継続回復に乗る）
      num(q.staminaRecoveryWeightPermil ?? 0, q.id),
      num(q.mentalThreshold ?? 0, q.id),
      num(q.maxCapacity ?? 0, q.id),
    ]);
  const getOrAddConfig = (q) => {
    const key = configKey(q);
    if (configIdx.has(key)) return configIdx.get(key);
    const value = JSON.parse(key);
    const idx = configs.length;
    configs.push({
      a: value[0],
      w: value[1],
      aw: value[2],
      st: value[3],
      rw: value[4],
      mt: value[5],
      cap: value[6],
    });
    configIdx.set(key, idx);
    return idx;
  };

  const chartIds = [...new Set(questRows.map((q) => String(q.musicChartPatternId ?? "")))].filter(
    (id) => id !== "",
  );
  const chartIdxMap = new Map(chartIds.map((id, i) => [id, i]));

  const quests = [];
  const unknownCharts = new Set();
  for (const q of questRows) {
    const chartId = String(q.musicChartPatternId ?? "");
    if (!charts[chartId]) {
      unknownCharts.add(chartId);
    }
    const musicId = String(q.musicId ?? "");
    const musicName = musics[musicIdx.get(musicId) ?? -1]?.n ?? "";
    const name = String(q.name ?? "");
    const area = areaInfo.get(String(q.areaId ?? ""));
    quests.push({
      id: String(q.id),
      // 名称が曲名と同一なら空（UI で曲名表示に置換）→ サイズ削減
      n: name === musicName ? "" : name,
      m: musicIdx.get(musicId) ?? -1,
      d: num(q.difficultyLevel ?? 0, q.id),
      c: getOrAddConfig(q),
      ch: chartIdxMap.get(chartId) ?? -1,
      clear: num(q.clearScore ?? 0, q.id),
      // 【Phase 8】大分類（areas[c].c）とエリア名（areas[c].n）参照
      ar: area === undefined ? -1 : (areaKeyToIdx.get(`${area.cat}\u0000${area.name}`) ?? -1),
    });
  }
  // 譜面参照を並べ替えて quests 内の ch と整合させるため chartIds を出力順で固定
  return {
    musics,
    configs,
    charts: chartIds,
    areas,
    quests,
    warnings: unknownCharts.size > 0 ? [...unknownCharts] : [],
  };
}

// ---------------------------------------------------------------------------
// 3. スキルマスタ（全カードの A/SP/P を SkillDef 互換へ変換）
// ---------------------------------------------------------------------------

const EFF_NAME_TO_TYPE = {
  // 段階型バフ（BuffKey 直対応）
  score_up: "score_up",
  beat_score_up: "beat_score_up",
  critical_rate_up: "critical_rate_up",
  active_skill_score_up: "a_skill_score_up",
  skill_score_up: "a_skill_score_up", // type18 同義（Aスキルスコア上昇）
  special_skill_score_up: "sp_skill_score_up",
  passive_skill_score_up: "p_skill_score_up", // 【Phase 9】P スコア上昇（b1 passive +10%/段）
  skill_success_rate_up: "skill_success_up",
  tension_up: "tension_up",
  combo_score_up: "combo_score_up",
  critical_bonus_permil_up: "critical_coeff_up",
  vocal_up: "vocal_up",
  vocal_boost: "vocal_boost",
  vocal_down: "vocal_down", // 【Phase 9】ステータス低下（-5%/段）
  dance_up: "dance_up",
  dance_boost: "dance_boost",
  dance_down: "dance_down",
  visual_up: "visual_up",
  visual_boost: "visual_boost",
  visual_down: "visual_down",
  audience_amount_increase: "focus", // 集目
  audience_amount_reduction: "stealth", // 【Phase 9】ステルス（他4レーンのファンボーナス+副効果）
  stamina_consumption_increase: "stamina_cost_up", // 【Phase 9】消費増加（peing: 最大2倍=50‰×20段）
  stamina_consumption_reduction: "stamina_cost_down",
  combo_continuation: "combo_continue",
  // 即時系
  fix_stamina_recovery: "stamina_recovery",
  stamina_continuous_recovery: "stamina_recovery",
  target_stamina_recovery: "stamina_recovery", // 【Phase 9】対象1人のスタミナ回復（value=固定値）
  stamina_continuous_consumption: "stamina_recovery", // 【Phase 9】継続消費（peing: 15/ビート×段・全例が opponent 対象=battle_only で通常ライブ不発）
  cool_time_reduction: "ct_reduction",
  cool_time_increase: "ct_increase",
  live_ability_cool_time_reduction: "live_bonus_ct_reduction", // 【Phase 9】ライブボーナスの CT 短縮
  strength_effect_count_increase: "effect_extension",
  strength_effect_value_increase: "effect_amplify",
  // 【サンプル4・2026-09-04】強化効果譲渡（全バフを対象へコピー。怜 SP「アイドルの私で踊ります」等）
  strength_effect_assignment_all: "effect_passing",
  stamina_consumption: "stamina_recovery_negative",
  // スコア取得系
  score_get: "score_get",
  score_get_by_score_ratio: "score_get_by_score_ratio",
};

/** 【Peing確定 2026-08-31】超化（add_effect_value_*）が付与する固定段数（+5段階分） */
const EXTREME_GRANT_STAGES = 5;

/** 超化（add_effect_value_*) の基底名 → EffectType（vocal_up のみ独立キー vocal_up_extreme） */
const EXTREME_BASE_NAME_TO_TYPE = {
  vocal_up: "vocal_up_extreme",
  dance_up: "dance_up_extreme",
  visual_up: "visual_up_extreme",
  dance_down: "dance_down",
  score_up: "score_up",
  critical_bonus_permil_up: "critical_coeff_up",
  tension_up: "tension_up",
  active_skill_score_up: "a_skill_score_up",
  special_skill_score_up: "sp_skill_score_up",
  skill_success_rate_up: "skill_success_up",
  audience_amount_increase: "focus",
  audience_amount_reduction: "stealth",
  beat_score_up: "beat_score_up",
  combo_score_up: "combo_score_up",
};

/** 「追加」（上限超過で乗る段数バフ）→ 基底型 + limitRelease【Estimate】 */
const MULTIPLIER_ADD_NAME_TO_TYPE = {
  active_score_multiplier_add: "a_skill_score_up",
  special_score_multiplier_add: "sp_skill_score_up",
  passive_score_multiplier_add: "p_skill_score_up", // 【Phase 9】Pスコア追加
};

/** type36（段階数参照スコア）の status 名 → scaling ref（engine SCALING_REF_KEYS と同期） */
const TYPE36_STATUS_TO_REF = {
  vocal_up: "vocal_up_stages",
  dance_up: "dance_up_stages",
  visual_up: "visual_up_stages",
  vocal_boost: "vocal_boost_stages",
  dance_boost: "dance_boost_stages",
  visual_boost: "visual_boost_stages",
  beat_score_up: "beat_score_up_stages",
  active_skill_score_up: "a_skill_score_up_stages",
  special_skill_score_up: "sp_skill_score_up_stages",
  critical_rate_up: "critical_rate_up_stages",
  critical_bonus_permil_up: "critical_coeff_up_stages",
  tension_up: "tension_up_stages",
  score_up: "score_up_stages",
  combo_score_up: "combo_score_up_stages",
  audience_amount_increase: "focus_stages",
};

/** 条件参照型スコア（more_combo_count 等）→ 常時発動の score_get に近似【Estimate】 */
const CONDITIONAL_SCORE_NAMES = new Set([
  "score_get_by_more_combo_count",
  "score_get_by_less_combo_count",
  "score_get_by_more_stamina",
  "score_get_by_less_stamina",
  "score_get_by_more_stamina_use",
  "score_get_and_stamina_consumption_by_more_stamina_use",
  "score_get_by_skill_success_rate_up",
  "score_get_by_strength_effect_count",
  "score_get_by_more_fan_engage",
  "score_get_by_less_fan_amount",
  "score_get_by_skill_activation_count",
  "score_get_by_character_count",
  "score_get_by_trigger",
]);

/**
 * 条件参照型スコアの type36 既定式（docs: やるキ士スプレッドシート gid=806980235 の倍率から。
 * 上限（強化効果種類数の 9 など）は審査履歴により現行値が未確定のため maxTypes: null で
 * 実装し、要検証タグを付ける。管理・突合表: research/type36_coefficients.md）。
 */
const CONDITIONAL_SCALE_DEFAULTS = {
  score_get_by_less_combo_count: {
    scaling: { ref: "combo_prior", perStagePermil: null, formula: "comboLessQuad", amplitudePermil: 2000, reference: 150, exponent: 2 },
    note: "『コンボ数が少ない程』docs式: 200% × ((150 − 発動前コンボ)/150)²",
  },
  score_get_by_more_combo_count: {
    scaling: { ref: "combo_prior", perStagePermil: null, formula: "comboMoreLinear", perComboPermil: 9.090909 },
    note: "『コンボ数が多い程』docs式: +(10/11)%/コンボ（110コンボ=+100%）",
  },
  score_get_by_strength_effect_count: {
    scaling: { ref: "effect_count", perStagePermil: null, formula: "effectCount", perTypePermil: 140, maxTypes: 9 },
    note: "『強化効果が多い程』docs式: +14%/種類。上限は現行 9 種類（2026-09-01 ユーザー確認。2022-06-20 正午後 9 種類が現行も維持されると判断。上限解放キャラが存在し、vendor の score_get_by_strength_effect_count_limit_increase 変種で挙動が変わる可能性→要検証）",
  },
  score_get_by_more_stamina: {
    scaling: { ref: "stamina_remaining", perStagePermil: null, formula: "staminaRatioQuad", maxPermil: 800, remainingRatio: true },
    note: "『残スタミナが多い程』docs式: 80% × (発動後スタミナ率)²",
  },
  score_get_by_less_stamina: {
    scaling: { ref: "stamina_consumed", perStagePermil: null, formula: "staminaRatioQuad", maxPermil: 800, remainingRatio: false },
    note: "『残スタミナが少ない程』docs式: 80% × (発動後スタミナ消費率)²",
  },
  score_get_by_more_stamina_use: {
    scaling: { ref: "stamina_consumed_total", perStagePermil: null, formula: "staminaConsumedLinear", perStaminaPermil: 0.11 },
    note: "『消費スタミナが多い程』docs式: 0.011%/スタミナ",
  },
  score_get_and_stamina_consumption_by_more_stamina_use: {
    scaling: { ref: "stamina_consumed_total", perStagePermil: null, formula: "staminaConsumedLinear", perStaminaPermil: 0.11 },
    note: "『消費スタミナが多い程（スタミナ消費付き）』docs式: 0.011%/スタミナ",
  },
  score_get_by_skill_activation_count: {
    scaling: { ref: "skill_count", perStagePermil: null, formula: "skillCountLinear", perCountPermil: 97 },
    note: "『発動スキル数が多い程』docs式: +9.7%/回（フォトのスキルを含む）",
  },
};

/**
 * type36（段階数参照・score_get_by_status_effect_type_grade）の 家族別 1 段あたり係数。
 * 【2026-09-01 確定】docs gid=806980235 の値をそのまま採用（簡易検証 3 例 = 星見プロ/成宮すず/
 * 瑠依の予感 がすべて +6%/段 で一致・参照段数は「アップ系のみ（超化非参照）」）。
 * - Vo/Da/Vi UP・Boost: +6.0%/段（20 段 = +120%）
 * - テンションUP: +16.0%/段（10 段 = +160%）
 * - クリティカル率上昇: +6.7%/段（20 段 = +134%）
 * docs に該当のない ref（focus/a/s/sp/score_up/combo_score_up/critical_coeff_up 等)は null
 * （=スケーリングなし・Per-skill 上書きは data/type36_coefficients.json）。
 */
const TYPE36_FAMILY_PER_STAGE_PERMIL = {
  vocal_up_stages: 60,
  dance_up_stages: 60,
  visual_up_stages: 60,
  vocal_boost_stages: 60,
  dance_boost_stages: 60,
  visual_boost_stages: 60,
  tension_up_stages: 160,
  critical_rate_up_stages: 67,
};

/**
 * data/type36_coefficients.json のスキル別上書き（research/type36_coefficients.md の
 * 機械可読版）。familyDefaults より優先される（Peing/T5 フィット値の適用先）。
 * ファイルが無い場合や読み込み失敗時は空（従来動作）。
 */
let type36SkillOverridesCache = null;
function type36SkillOverrides() {
  if (type36SkillOverridesCache !== null) return type36SkillOverridesCache;
  try {
    const t = JSON.parse(readFileSync(path.join(DATA, "type36_coefficients.json"), "utf-8"));
    type36SkillOverridesCache = t.skillOverrides ?? {};
  } catch {
    type36SkillOverridesCache = {};
  }
  return type36SkillOverridesCache;
}
/** トリガー（tg-someone_status-<status>）の status 名 → engine EffectType（someone_<type> 条件） */
const STATUS_TRIGGER_TO_TYPE = {
  vocal_up: "vocal_up",
  vocal_down: "vocal_down",
  dance_up: "dance_up",
  dance_down: "dance_down",
  visual_up: "visual_up",
  visual_down: "visual_down",
  vocal_boost: "vocal_boost",
  dance_boost: "dance_boost",
  visual_boost: "visual_boost",
  beat_score_up: "beat_score_up",
  tension_up: "tension_up",
  score_up: "score_up",
  a_skill_score_up: "a_skill_score_up",
  skill_score_up: "a_skill_score_up",
  special_skill_score_up: "sp_skill_score_up",
  p_skill_score_up: "p_skill_score_up",
  passive_skill_score_up: "p_skill_score_up",
  combo_score_up: "combo_score_up",
  critical_rate_up: "critical_rate_up",
  critical_bonus_permil_up: "critical_coeff_up",
  skill_success_rate_up: "skill_success_up",
  audience_amount_increase: "focus",
  audience_amount_reduction: "stealth",
  stamina_consumption_reduction: "stamina_cost_down",
  stamina_consumption_increase: "stamina_cost_up",
  combo_continuation: "combo_continue",
};

/** ユニット人数条件（tg-more_than_character_count-<unit>-<N>）で engine が解釈できる unit */
const KNOWN_UNIT_GROUPS = new Set([
  "liz",
  "moon",
  "sun",
  "pajm",
  "leader",
  "tri",
  "thrx",
]);

/** limit_break_X → 効果行（golden の符号規約を踏襲: ccu/csu/tension は *_limit 型、
 *  それ以外は基底型+limitRelease。段数は全て「解放量」として stages に入る） */
function limitBreakRow(name, grade) {
  switch (name) {
    case "limit_break_critical_bonus_permil_up":
      return { type: "critical_coeff_limit", stages: grade };
    case "limit_break_combo_score_up":
      return { type: "combo_score_limit", stages: grade };
    case "limit_break_tension_up":
      return { type: "tension_limit", stages: grade };
    case "limit_break_active_skill_score_up":
      return { type: "a_skill_score_up", stages: grade, limitRelease: true };
    case "limit_break_special_skill_score_up":
      return { type: "sp_skill_score_up", stages: grade, limitRelease: true };
    case "limit_break_skill_success_rate_up":
      return { type: "skill_success_up", stages: grade, limitRelease: true };
    case "limit_break_score_up":
      return { type: "score_up", stages: grade, limitRelease: true };
    case "limit_break_audience_amount_increase":
      return { type: "focus", stages: grade, limitRelease: true };
    case "limit_break_vocal_up":
      return { type: "vocal_up", stages: grade, limitRelease: true };
    case "limit_break_vocal_boost":
      return { type: "vocal_boost", stages: grade, limitRelease: true };
    case "limit_break_dance_up":
      return { type: "dance_up", stages: grade, limitRelease: true };
    case "limit_break_dance_boost":
      return { type: "dance_boost", stages: grade, limitRelease: true };
    case "limit_break_visual_up":
      return { type: "visual_up", stages: grade, limitRelease: true };
    case "limit_break_visual_boost":
      return { type: "visual_boost", stages: grade, limitRelease: true };
    default:
      return null;
  }
}

/** SkillTarget.json の id 集合（最長一致で解析する） */
let TARGET_IDS = new Set();

/** SkillTarget.json の id → engine EffectTarget */
function targetOf(skillTargetId, stats) {
  if (skillTargetId == null || skillTargetId === "") return { target: "self" };
  if (TARGET_IDS.size === 0) {
    // SkillTarget.json 未読込フォールバック（通常あり得ない）
    TARGET_IDS = new Set(["target-self", "target-all", "target-center", "target-neighbor"]);
  }
  if (!TARGET_IDS.has(skillTargetId)) {
    stats.unsupportedTargets.add(skillTargetId);
    return null;
  }
  if (skillTargetId === "target-self") return { target: "self" };
  if (skillTargetId === "target-all") return { target: "all" };
  if (skillTargetId === "target-center") return { target: "center" };
  if (skillTargetId === "target-neighbor") return { target: "neighbors" };
  if (skillTargetId === "target-vocal_higher-1") return { target: "vocal_high_1" };
  if (skillTargetId === "target-vocal_higher-2") return { target: "vocal_high_2" };
  if (skillTargetId === "target-vocal_higher-3") return { target: "vocal_high_3" };
  if (skillTargetId === "target-dance_higher-1") return { target: "dance_high_1" };
  if (skillTargetId === "target-dance_higher-2") return { target: "dance_high_2" };
  if (skillTargetId === "target-dance_higher-3") return { target: "dance_high_3" };
  if (skillTargetId === "target-visual_higher-1") return { target: "visual_high_1" };
  if (skillTargetId === "target-visual_higher-2") return { target: "visual_high_2" };
  if (skillTargetId === "target-visual_higher-3") return { target: "visual_high_3" };
  // 【Phase 9】スタミナ基準の対象（回復系の「スタミナが低い1人」等）
  if (skillTargetId === "target-stamina_higher-1") return { target: "stamina_high_1" };
  let m = /^target-stamina_lower-(\d)$/.exec(skillTargetId);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 3) return { target: `stamina_low_${m[1]}` };
  // 【Phase 9】トリガー成立レーン（「X状態の時、X状態の人に…」等・ライブボーナスで使用）
  // target-trigger-2 は「先頭2人」だが engine は成立レーン全員に解決する近似【Estimate】
  if (skillTargetId === "target-trigger" || skillTargetId === "target-trigger-2") {
    return { target: "trigger" };
  }
  // 【Phase 9】status バフ保持レーン（target-status-<type>-<n>）
  m = /^target-status-([a-z_]+)-(\d)$/.exec(skillTargetId);
  if (m) {
    const statusType = STATUS_TRIGGER_TO_TYPE[m[1]];
    const n = Number(m[2]);
    if (statusType !== undefined && n >= 1 && n <= 5) {
      const mapped = { vocal_up: "vocal_up", dance_up: "dance_up", a_skill_score_up: "a_skill_score_up" }[statusType];
      if (mapped !== undefined) return { target: `status_${mapped}_${n}` };
    }
    stats.unsupportedTargets.add(skillTargetId);
    return null;
  }
  // ライブバトル専用（opponent 系）→ battle_only で記録（通常ライブでは除外）
  if (/^target-opponent/.test(skillTargetId)) {
    return { target: "self", condition: "battle_only" };
  }
  m = /^target-character_type-(\d)-(\d)$/.exec(skillTargetId);
  if (m) {
    const type = Number(m[1]);
    const n = Number(m[2]);
    if (type === 1 && (n === 1 || n === 2)) return { target: `score_type_${n}` };
    // 【Phase 9】character_type-1-3/1-5 =「スコアラータイプ3人/全員」・2-5/3-5 =「バッファー/サポーター全員」
    if (type === 1 && (n === 3 || n === 5)) return { target: `score_type_${n}` };
    if ((type === 2 || type === 3) && n >= 1 && n <= 5) {
      return { target: `${type === 2 ? "buffer" : "supporter"}_type_${n}` };
    }
    stats.unsupportedTargets.add(skillTargetId);
    return null;
  }
  m = /^target-(vocal|dance|visual)-(\d)$/.exec(skillTargetId);
  if (m) {
    const n = Number(m[2]);
    if (n >= 1 && n <= 5) return { target: `${m[1]}_type_${n}` };
    stats.unsupportedTargets.add(skillTargetId);
    return null;
  }
  m = /^target-position_attribute_(vocal|dance|visual)-(\d)$/.exec(skillTargetId);
  if (m) {
    // 【サンプル1実測確定 2026-09-01】「<属性>レーンN人」（target-position_attribute_*
    // のバナーテキスト実測: 麻奈も立った大舞台 =「ボーカルレーン3人」→ L1,L3,L4）。
    // 「タイプN人」（target-vocal-N = *_type_N）とは別ファミリーのため *_lane_N に写像。
    const n = Number(m[2]);
    if (n >= 1 && n <= 5) return { target: `${m[1]}_lane_${n}` };
    stats.unsupportedTargets.add(skillTargetId);
    return null;
  }
  stats.unsupportedTargets.add(skillTargetId);
  return null;
}

/**
 * efficacyId を解析して SkillEffect を生成する。
 * 文法: ef-<name>-<params...>[-target-<targetId>][-<duration>|chart_dependence]
 * targetId は SkillTarget.json の id との最長一致で切り出す
 * （target-character_type-1-2 のようにダッシュ区切りを含むため）。
 */
function parseEfficacy(efficacyId, stats) {
  const m = /^ef-([a-z_0-9]+)-(.*)$/.exec(efficacyId);
  if (!m) {
    stats.unsupportedEffects.add(efficacyId);
    return null;
  }
  const name = m[1];
  const tokens = m[2].split("-");
  // target トークンを探し、SkillTarget.json の id と最長一致で切り出す
  // （id はダッシュ区切りを含む: 例 target-character_type-1-2）
  let targetId = "";
  let beforeTokens = tokens;
  let rest = [];
  const ti = tokens.indexOf("target");
  if (ti >= 0) {
    let matched = -1;
    for (let k = tokens.length - ti; k >= 1; k--) {
      const candidate = tokens.slice(ti, ti + k).join("-");
      if (TARGET_IDS.has(candidate)) {
        matched = k;
        break;
      }
    }
    if (matched < 0) {
      stats.unsupportedTargets.add("target-" + tokens.slice(ti + 1).join("-"));
      return null;
    }
    targetId = tokens.slice(ti, ti + matched).join("-");
    beforeTokens = tokens.slice(0, ti);
    rest = tokens.slice(ti + matched);
  }
  // duration は target 後の先頭数値（target の無い efficacy は duration を持たない。
  // 数値は grade / power として params 側で解析する）
  let duration = null;
  const restTokens = [];
  if (targetId) {
    for (const t of rest) {
      if (/^\d+$/.test(t) && duration === null) {
        duration = Number(t);
      } else {
        restTokens.push(t);
      }
    }
  }
  const nums = [];
  const texts = [];
  for (const t of beforeTokens) {
    if (/^\d+$/.test(t)) nums.push(Number(t));
    else texts.push(t);
  }
  // chart_dependence は score 系の後置トークン（楽曲依存。スコア計算には影響しない）
  const chartDep = restTokens.includes("chart_dependence") || texts.includes("chart_dependence");

  const tgt = targetOf(targetId, stats);
  const base = { durationBeats: duration, target: undefined, condition: "none", confidence: undefined };
  if (tgt === null) return null;
  base.target = tgt.target;
  if (tgt.condition) {
    base.condition = tgt.condition;
  }

  if (name === "score_get") {
    return { ...base, type: "score_get", powerPermil: nums[0] ?? 0, chartDep };
  }
  if (name === "score_get_by_score_ratio") {
    return { ...base, type: "score_get_by_score_ratio", powerPermil: nums[0] ?? 0 };
  }
  if (CONDITIONAL_SCORE_NAMES.has(name)) {
    // 条件参照型スコア（コンボ数/スタミナ等で増減）→ score_get + docs 既定とみなす式（要検証）
    const def = CONDITIONAL_SCALE_DEFAULTS[name];
    if (def !== undefined) {
      return {
        ...base,
        type: "score_get",
        powerPermil: nums[0] ?? 0,
        scaling: { ...def.scaling },
        confidence: "Estimate(docs-806980235: " + def.note + ")",
      };
    }
    // 既定式がないもの（core_fan / fan_amount / character_count / trigger 等）は従来どおり近似
    return {
      ...base,
      type: "score_get",
      powerPermil: nums[0] ?? 0,
      confidence: "Unknown(条件参照スコア: " + name + " を常時発動で近似)",
    };
  }
  if (name === "score_get_by_status_effect_type_grade") {
    // params: <status>-<power>。status は「vocal-up」（ハイフン区切り）と
    // 「vocal_up」（アンダースコア）の2形があるため texts を結合して正規化。
    // 後置トークン "chart_dependence" は照合前に取り除く。
    const status = texts.join("_").replace(/_chart_dependence$/, "");
    const power = nums[0] ?? 0;
    const ref = TYPE36_STATUS_TO_REF[status];
    if (ref === undefined) {
      // スケーリング未対応（status 不明）→ 基本スコアのみ・要検証タグ
      return {
        ...base,
        type: "score_get",
        powerPermil: power,
        scaling: null,
        confidence: "Unknown(type36 scaling未対応: status=" + status + ")",
      };
    }
    const famPerStage = TYPE36_FAMILY_PER_STAGE_PERMIL[ref];
    if (famPerStage === undefined) {
      // docs に該当する家族係数がない（focus/a/s/sp/score_up/combo_score_up/ccuff 等）→ 無係数・要検証
      return {
        ...base,
        type: "score_get",
        powerPermil: power,
        scaling: { ref, perStagePermil: null, fitted: false },
        confidence: "Unknown(type36 perStagePermil 未確定: ref=" + ref + ")",
      };
    }
    return {
      ...base,
      type: "score_get",
      powerPermil: power,
      scaling: { ref, perStagePermil: famPerStage, fitted: false },
      confidence:
        "Estimate(docs-806980235: ref=" + ref + " は " + famPerStage + "‰/段（" +
        (famPerStage / 10).toFixed(1) + "%/段）。超化は参照外（2026-09-01 確定）",
    };
  }
  if (name.startsWith("limit_break_")) {
    const row = limitBreakRow(name, nums[0] ?? 0);
    if (row === null) {
      stats.unsupportedEffects.add(efficacyId);
      return null;
    }
    return { ...base, ...row };
  }
  if (name.startsWith("add_effect_value_")) {
    // 【Peing確定 2026-08-31・research/16 §3】超化: スキル表記の段階数（「5段階」「10段階」等）
    // はダミー値で、効果は「元のバフの+5段階分（固定）」。
    //   スコア超化 +125‰（score_up 25‰×5）/ 係数超化 +250‰ / ステータス超化 +250‰
    //   （出典: 質問箱 id=1190010925・id=1189874405。テンション超化=テンション5段相当）
    // capExtend=true で同種バフの上限も+5段階拡張（「通常上限とは独立に加算」）。
    // vocal_up のみ独立キー vocal_up_extreme（golden 実測・1段値50‰、上限30固定）。
    const baseName = name.slice("add_effect_value_".length);
    const extremeType = EXTREME_BASE_NAME_TO_TYPE[baseName];
    if (extremeType === undefined) {
      stats.unsupportedEffects.add(efficacyId);
      return null;
    }
    if (
      extremeType === "vocal_up_extreme" ||
      extremeType === "dance_up_extreme" ||
      extremeType === "visual_up_extreme"
    ) {
      return {
        ...base,
        type: extremeType,
        stages: EXTREME_GRANT_STAGES,
        confidence: "Peing確定(超化: 表記段階数はダミー・一律+5段階分=+250‰)",
      };
    }
    return {
      ...base,
      type: extremeType,
      stages: EXTREME_GRANT_STAGES,
      capExtend: true,
      confidence: "Peing確定(超化: 表記段階数はダミー・一律+5段階分)",
    };
  }
  if (MULTIPLIER_ADD_NAME_TO_TYPE[name] !== undefined) {
    return {
      ...base,
      type: MULTIPLIER_ADD_NAME_TO_TYPE[name],
      stages: nums[0] ?? 0,
      limitRelease: true,
      confidence: "Estimate(追加型: limitRelease 近似)",
    };
  }
  if (name === "passive_skill_cool_time_reset") {
    // P スキルの CT をリセット → 大きめの CT 減算で近似【Estimate】
    return { ...base, type: "ct_reduction", value: 99 };
  }
  if (name === "live_ability_cool_time_reset") {
    // ライブボーナスの CT リセット → 大きめの CT 減算で近似【Estimate】
    return { ...base, type: "live_bonus_ct_reduction", value: 99 };
  }
  const type = EFF_NAME_TO_TYPE[name];
  if (type === undefined) {
    stats.unsupportedEffects.add(efficacyId);
    return null;
  }
  if (type === "stamina_recovery_negative") {
    return { ...base, type: "stamina_recovery", value: -(nums[0] ?? 0) };
  }
  if (type === "stamina_recovery" || type === "ct_reduction" || type === "ct_increase") {
    return { ...base, type, value: nums[0] ?? 0 };
  }
  if (type === "live_bonus_ct_reduction") {
    return { ...base, type, value: nums[0] ?? 0 };
  }
  if (type === "effect_extension" || type === "effect_amplify") {
    return { ...base, type, value: nums[0] ?? 0 };
  }
  if (type === "effect_passing") {
    // 【サンプル4・2026-09-04】譲渡に段数パラメータは無い（全強化効果のコピー）
    return { ...base, type };
  }
  // 段階型バフ
  return { ...base, type, stages: nums[0] ?? 0 };
}

const CATEGORY_TO_KIND = { 1: "SP", 2: "A", 3: "P" };

/**
 * Skill 行を SkillDef 互換へ変換する。
 * @param level 取得するレベル（省略時は最大レベル。ライブボーナスは liveAbilityLevel を指定）
 * @param kindOverride 出力 kind の上書き（ライブボーナスは "live_bonus"）
 */
function parseSkillLevel(skill, stats, level = null, kindOverride = null) {
  const levels = skill.levels ?? [];
  if (levels.length === 0) return null;
  // カードスキルは最大レベルのみ（開花6相当）。golden（実測較正）があるカードはそちらを優先
  const lv =
    level == null
      ? levels[levels.length - 1]
      : (levels.find((l) => num(l.level ?? 0, skill.id) === level) ??
        levels[levels.length - 1]);
  /**
   * triggerId → { condition, note }（condition は engine EffectCondition・未対応は null + note）。
   * 【サンプル2効果行トリガー対応 2026-09-02】skillDetails[].triggerId（効果行単位）も
   * スキル単位と同一の写像で condition 化する。似た者親子のメッセージ等は
   * 「score_get 行は無条件・バフ行のみ tg-position_attribute_visual」の構成のため
   * 効果行単位で読まないと条件が落ちる。
   * 【2026-09-02 ユーザー確定】tg-position_attribute_* は**レーン属性説**で確定
   * （S2 怜 A2 の「発動」は誤認。レーン属性が一致しない行は適用されない）。
   */
  const triggerConditionOf = (triggerId, stats) => {
    if (triggerId === "") return { condition: null, note: null };
    // レーン属性条件
    if (triggerId.startsWith("tg-position_attribute_vocal")) return { condition: "self_vocal_lane", note: null };
    if (triggerId.startsWith("tg-position_attribute_visual")) return { condition: "self_visual_lane", note: null };
    if (triggerId.startsWith("tg-position_attribute_dance")) return { condition: "self_dance_lane", note: null };
    // 配置レーン条件
    if (triggerId === "tg-center") return { condition: "self_center", note: null };
    if (triggerId === "tg-most_left") return { condition: "self_most_left", note: null };
    if (triggerId === "tg-most_right") return { condition: "self_most_right", note: null };
    // 低下効果グループ
    if (triggerId.startsWith("tg-someone_status_group-")) return { condition: "someone_down_group", note: null };
    if (triggerId.startsWith("tg-status_group-")) return { condition: "self_down_group", note: null };
    // 段階数条件（誰かの状態がN段階以上）
    {
      const m = /^tg-someone_status_effect_grade_higher_([a-z_]+)\s*-(\d+)$/.exec(triggerId);
      if (m) {
        const st = STATUS_TRIGGER_TO_TYPE[m[1]] ?? m[1];
        return { condition: `someone_${st}>=${m[2]}`, note: null };
      }
    }
    // スタミナ割合条件
    {
      const m = /^tg-stamina_higher-(\d+)$/.exec(triggerId);
      if (m) return { condition: `stamina>=${m[1]}`, note: null };
    }
    {
      const m = /^tg-stamina_lower-(\d+)$/.exec(triggerId);
      if (m) return { condition: `stamina<=${m[1]}`, note: null };
    }
    {
      const m = /^tg-someone_stamina_lower-(\d+)$/.exec(triggerId);
      if (m) return { condition: `someone_stamina<=${m[1]}`, note: null };
    }
    // コンボ条件
    {
      const m = /^tg-combo_less_equal-(\d+)$/.exec(triggerId);
      if (m) return { condition: `combo<=${m[1]}`, note: null };
    }
    {
      const m = /^tg-combo-(\d+)$/.exec(triggerId);
      if (m) return { condition: `combo>=${m[1]}`, note: null };
    }
    // 編成人数・キャラ条件（ユニットおよび単体キャラ）
    {
      const m = /^tg-more_than_character_count-([a-z_]+)-(\d+)$/.exec(triggerId);
      if (m) return { condition: `count_${m[1]}>=${m[2]}`, note: null };
    }
    // 行動直前・タイミング条件
    if (triggerId === "tg-before_special_skill_by_someone") return { condition: "someone_before_special", note: null };
    if (triggerId === "tg-before_special_skill") return { condition: "self_before_special", note: null };
    if (triggerId === "tg-before_active_skill_by_someone") return { condition: "someone_before_active", note: null };
    if (triggerId === "tg-after_active_skill_by_opponent_someone") return { condition: "battle_only", note: null };
    if (triggerId === "tg-before_critical_by_someone") return { condition: "critical_timing", note: null };
    // 自身の状態
    if (triggerId.startsWith("tg-status-")) {
      const status = triggerId.slice("tg-status-".length);
      const t = STATUS_TRIGGER_TO_TYPE[status];
      if (t !== undefined) {
        return { condition: `status_${t}`, note: null };
      }
      return { condition: null, note: "trigger:" + triggerId };
    }
    // 誰かの状態
    if (triggerId.startsWith("tg-someone_status-")) {
      const status = triggerId.slice("tg-someone_status-".length);
      const t = STATUS_TRIGGER_TO_TYPE[status];
      if (t !== undefined) {
        return { condition: `someone_${t}`, note: null };
      }
      return { condition: null, note: "trigger:" + triggerId };
    }
    // バトル専用
    if (triggerId.startsWith("tg-opponent") || triggerId.startsWith("tg-battle")) {
      return { condition: "battle_only", note: null };
    }
    // 楽曲限定
    if (triggerId.startsWith("tg-music-")) {
      return { condition: "music_limited", note: "music-limited:" + triggerId };
    }
    // 回復・ビート・クリティカル時
    if (triggerId === "tg-someone_recovered") return { condition: "someone_recovered", note: null };
    if (triggerId === "tg-beat") return { condition: "none", note: null };
    if (triggerId === "tg-critical") return { condition: "critical_timing", note: null };

    return { condition: null, note: "trigger:" + triggerId };
  };

  const effects = [];
  let unsupported = 0;
  for (const d of lv.skillDetails ?? []) {
    const eff = parseEfficacy(String(d.efficacyId ?? ""), stats);
    if (eff === null) {
      unsupported += 1;
      continue;
    }
    const out = {
      type: eff.type,
      target: eff.target,
      condition: eff.condition,
      durationBeats: eff.durationBeats ?? null,
    };
    if (eff.stages !== undefined && eff.stages > 0) out.stages = eff.stages;
    if (eff.powerPermil !== undefined) out.powerPermil = eff.powerPermil;
    if (eff.value !== undefined) out.value = eff.value;
    if (eff.limitRelease) out.limitRelease = true;
    if (eff.capExtend) out.capExtend = true;
    if (eff.scaling !== undefined) out.scaling = eff.scaling;
    if (eff.confidence) out.confidence = eff.confidence;
    // 【サンプル2実測確定 2026-09-02】効果行単位の triggerId（skillDetails[].triggerId）。
    // 似た者親子のメッセージ等は「score_get 行は無条件・バフ行のみ tg-position_attribute_visual」
    // の構成で、スキル単位 triggerId には入らない。効果行単位で写像する（skl は下の
    // skillTriggerConditionOf と同一の写像を用いる）。
    const effTrigger = String(d.triggerId ?? "");
    if (effTrigger !== "") {
      const effCond = triggerConditionOf(effTrigger, stats);
      if (effCond.condition !== null) {
        out.condition = effCond.condition;
      } else if (effCond.note !== null) {
        out.confidence = "Unknown(効果行トリガー未対応: " + effTrigger + ")";
      }
    }
    effects.push(out);
  }
  const triggerId = String(lv.triggerId ?? "");
  let condition = "none";
  let conditionalNote = null;
  if (triggerId !== "") {
    const common = triggerConditionOf(triggerId, stats);
    if (common.condition !== null) {
      condition = common.condition;
    }
    if (common.note !== null) {
      conditionalNote = common.note;
    }
  }
  // スキル単位のトリガー条件を effect 行へ伝播する（engine は effect 行の condition で
  // 前半/後半と発動可否を判定するため。opponent 由来の battle_only は優先して保持）
  if (condition !== "none") {
    for (const e of effects) {
      if (e.condition === "none") e.condition = condition;
    }
  }
  // 【type36 係数表のスキル別上書き】data/type36_coefficients.json の skillOverrides を、
  // このスキルの score_get 行（type36 / 条件参照スコア）へ適用する（Peing・T5 フィット値）。
  // golden（実測較正）スキルは「適用先レーンで skills_golden が優先される」ため、ここで入る
  // 値はマスタ経路（非黄金デッキ）向けの基準値として機能する。
  const override = type36SkillOverrides()[String(skill.id)];
  if (override !== undefined) {
    for (const e of effects) {
      if (e.type !== "score_get") continue;
      const conf = String(e.confidence ?? "");
      if (e.scaling == null && !conf.includes("type36") && !conf.includes("条件参照スコア")) continue;
      e.scaling = { ...(e.scaling ?? {}), ...override.scaling };
      if (override.confidenceNote !== undefined) e.confidence = override.confidenceNote;
    }
  }
  return {
    id: String(skill.id),
    name: String(skill.name ?? skill.id),
    kind: kindOverride ?? CATEGORY_TO_KIND[num(skill.categoryType, skill.id)],
    level: num(lv.level ?? levels.length, skill.id),
    lane: null,
    ct: lv.coolTime == null ? null : num(lv.coolTime, skill.id),
    staminaCost: lv.stamina == null ? null : num(lv.stamina, skill.id),
    probabilityPermil: lv.probabilityPermil == null ? 1000 : num(lv.probabilityPermil, skill.id),
    limitPerLive: lv.limitCount ? num(lv.limitCount, skill.id) : null,
    condition,
    conditionalNote,
    effects,
    unsupportedEffects: unsupported,
  };
}

function buildSkillsMaster(cardRows, skillRows, stats) {
  const skillMap = new Map(skillRows.map((s) => [String(s.id), s]));
  const byCard = {};
  for (const c of cardRows) {
    const defs = [];
    for (const sid of [c.skillId1, c.skillId2, c.skillId3, c.skillId4]) {
      if (typeof sid !== "string" || sid === "") continue;
      const s = skillMap.get(sid);
      if (s === undefined) {
        stats.missingSkills.add(sid);
        continue;
      }
      const def = parseSkillLevel(s, stats);
      if (def === null) continue;
      defs.push(def);
    }
    if (defs.length > 0) byCard[String(c.id)] = defs;
  }
  return byCard;
}

/**
 * 【サンプル3・2026-09-04】キャラ優位（QuestCharacterAdvantage → questId 別定義）。
 * Quest.questCharacterAdvantageId で参照される優位をクエストごとに解決する。
 * vendor/QuestCharacterAdvantage.json は ipmaster と同一版（!version.txt 照合済み）。
 * 出力: data/character_advantage.json { byQuest: { questId: { characterIds, advantagePermil } } }
 */
function buildCharacterAdvantage(questRows, advantageRows) {
  const advById = new Map(advantageRows.map((r) => [String(r.id), r]));
  const byQuest = {};
  for (const q of questRows) {
    const advId = String(q.questCharacterAdvantageId ?? "");
    if (advId === "") continue;
    const adv = advById.get(advId);
    if (adv === undefined) continue;
    byQuest[String(q.id)] = {
      characterIds: (adv.characterIds ?? []).map(String),
      advantagePermil: num(adv.advantagePermil ?? 1000, advId),
    };
  }
  return byQuest;
}

// ---------------------------------------------------------------------------
// 3.5 ライブボーナス（Quest.liveBonusGroupId → LiveBonusGroup → LiveBonus
//     → LiveAbility → Skill.json sk-live-*）【Phase 9・research/16 §1】
// ---------------------------------------------------------------------------

/**
 * 全クエストのライブボーナスPスキルを抽出して questId → SkillDef 配列 を返す。
 * - ライブボーナスはステージ全体に掛かるPスキル（消費スタミナ0・CTはライボ毎に管理）。
 * - レベルは LiveBonus.liveAbilityLevel（全行 5）で固定。
 * - 発動条件は Skill の triggerId から復元（無条件=前半発動・条件付き=後半発動）。
 */
function buildLiveBonuses(questRows, lbgRows, lbRows, laRows, skillRows, stats) {
  const skillMap = new Map(skillRows.map((s) => [String(s.id), s]));
  const lbIdsByGroup = new Map(
    lbgRows.map((g) => [String(g.groupId), (g.liveBonusIds ?? []).map(String)]),
  );
  const lbById = new Map(lbRows.map((r) => [String(r.id), r]));
  const laById = new Map(laRows.map((r) => [String(r.id), r]));
  const byQuest = {};
  const cache = new Map(); // LiveBonus.id → SkillDef | null
  for (const q of questRows) {
    const groupId = String(q.liveBonusGroupId ?? "");
    if (groupId === "") continue;
    const defs = [];
    for (const lbId of lbIdsByGroup.get(groupId) ?? []) {
      let def = cache.get(lbId);
      if (def === undefined) {
        def = null;
        const lb = lbById.get(lbId);
        if (lb === undefined) {
          stats.liveBonusMissing.add(lbId);
        } else {
          const la = laById.get(String(lb.liveAbilityId ?? ""));
          const abilityLevel = num(lb.liveAbilityLevel ?? 5, lbId);
          const levels = la?.levels ?? [];
          const lvRow =
            levels.find((l) => num(l.level ?? 0, lbId) === abilityLevel) ??
            levels[levels.length - 1];
          const skillId = lvRow == null ? undefined : String(lvRow.skillId ?? "");
          const skillRow = skillId === "" || skillId === undefined ? undefined : skillMap.get(skillId);
          if (skillRow === undefined) {
            stats.liveBonusMissing.add(String(lb.liveAbilityId ?? lbId));
          } else {
            def = parseSkillLevel(skillRow, stats, abilityLevel, "live_bonus");
            if (def !== null) {
              // 表示名・説明は LiveAbility 側（日本語の完全文）を使う。
              // live-lba-* 行は name に説明文を持つ（description が空）ため name をフォールバック
              def.name = String(la?.name ?? skillRow.name ?? def.name);
              def.description = String(la?.description ?? "") || String(la?.name ?? "");
              def.liveBonusLevel = abilityLevel;
            }
          }
        }
        cache.set(lbId, def);
      }
      if (def !== null) defs.push(def);
    }
    if (defs.length > 0) byQuest[String(q.id)] = defs;
  }
  return byQuest;
}

// ---------------------------------------------------------------------------
// 4. アクセサリ / キャラクター
// ---------------------------------------------------------------------------

const PARAM_TYPE_TO_STAT = {
  1: "dance",
  2: "vocal",
  3: "visual",
  4: "stamina",
  5: "mental",
  6: "critical",
};

function buildAccessories(rows, stats) {
  const out = [];
  for (const a of rows) {
    const structured = [];
    for (const n of [1, 2]) {
      const t = num(a[`param${n}Type`] ?? 0, a.id);
      const stat = PARAM_TYPE_TO_STAT[t];
      if (stat === undefined) continue;
      const value = num(a[`param${n}Value`] ?? 0, a.id);
      const permil = num(a[`param${n}Permil`] ?? 0, a.id);
      if (value !== 0) structured.push({ stat, type: "fixed", value });
      if (permil !== 0) structured.push({ stat, type: "pct", value: permil / 100 });
    }
    if (structured.length === 0) stats.accessoriesNoParam += 1;
    out.push({
      id: String(a.id),
      // 画像アセットID（CDN の img_acc_thumb_{assetId}。分類+ティアの 36 種のみ）
      assetId: String(a.assetId ?? ""),
      name: String(a.name ?? a.id),
      classification: String(a.classification ?? ""),
      rarity: num(a.rarity ?? 0, a.id),
      characterId: String(a.characterId ?? ""),
      structured,
    });
  }
  return out;
}

/**
 * 【Phase 8-B2】フォトマスタ（data/photos_master.json）の生成。
 *
 * PhotoAllInOne.json（262枚のフォト実体・初期品質 level・能力 abilities）×
 * PhotoAbility.json（能力定義・photoAbilityLevels = 品質→値）を合成し、
 * UI のマイフォト帳に取り込める形式（PhotoMasterDef）へ変換する。
 *
 * 値の単位検証（T5 実測との突合）:
 * - ふつつかものですが（phot-clb-mission-2411-4・初期品質35）:
 *   vocal_multiply_distribution effectValue=200 → 実測 Vo+20.0% と一致（effectValue/10 = %）
 * - stamina_multiply_distribution effectValue=40 → 実測 Sta+4.0% と一致
 * → effectValue は初期品質（PhotoAllInOne.level）における値 ×10（permil 相当）。
 * 初期品質以外の品質では PhotoAbility.photoAbilityLevels の品質補間値を UI 側で使用する。
 *
 * 能力の target 接尾辞（-pa-target-neighbor / -pa-target-center）は structured の
 * grant_ キー（隣接/センター付与）へ写像する【Phase 8-B2・Peing id=1187940162 準拠】。
 */
function buildPhotosMaster(photoRows, photoAbilityRows, skillRows, characterRows, stats) {
  const abilityMap = new Map(photoAbilityRows.map((a) => [String(a.id), a]));
  const skillMap = new Map(skillRows.map((s) => [String(s.id), s]));
  const charNames = new Map(characterRows.map((c) => [String(c.id), String(c.name ?? c.id)]));
  /** PhotoAbility.id → { stat, grant }（structured キー）。null はスキル能力・未対応 */
  const abilityToStat = (abilityId, ability) => {
    // passive スキル能力（pab-passive-skill_<skillId>）。Skill.json の ID は
    // 「passive-skill_」接頭辞付き / 数値接尾のゼロパディング差（5-01 ↔ 5-1）があるため
    // 候補を順に試す
    let m = /^pab-passive[-_]skill[-_]([a-z0-9-]+)$/.exec(abilityId);
    if (m) {
      const raw = m[1];
      const stripped = raw.replace(/-(\d+)$/, (_z, d) => `-${Number(d)}`);
      const candidates = [raw, stripped, `passive-skill_${raw}`, `passive-skill_${stripped}`];
      for (const c of candidates) {
        if (skillMap.has(c)) return { skillId: c };
      }
      stats.photosMissingSkill.add(raw);
      return { skillId: null };
    }
    // 能力名の接尾辞から対象を判定（-pa-target-neighbor / -pa-target-center）
    let grant = null;
    if (/-pa-target-neighbor/.test(abilityId)) grant = "neighbors";
    else if (/-pa-target-center/.test(abilityId)) grant = "center";
    // stat 名の切り出し: pab- 以降を最長一致のステムで分類
    //（hyphen/underscore が混在: pab-vocal_multiply_distribution-5 / pab-beat-score-up_multiply-1）
    const rest = abilityId.slice("pab-".length);
    const STEMS = [
      ["active-skill-score-up", "a_score"],
      ["active_skill_score_up", "a_score"],
      ["special-skill-score-up", "sp_score"],
      ["special_skill_score_up", "sp_score"],
      ["passive-skill-score-up", "p_score"],
      ["passive_skill_score_up", "p_score"],
      ["beat-score-up", "beat_score"],
      ["beat_score_up", "beat_score"],
      ["critical-score-up", "critical_score"],
      ["critical_score_up", "critical_score"],
      ["vocal", "vocal"],
      ["dance", "dance"],
      ["visual", "visual"],
      ["stamina", "stamina"],
      ["mental", "mental"],
      ["technique", "critical"],
    ];
    for (const [stem, stat] of STEMS) {
      if (!rest.startsWith(stem)) continue;
      const suffix = rest.slice(stem.length);
      // 続きは _multiply* / _add / -multiply / -add 系のみ stat 能力として扱う
      if (!/^[-_](multiply|add)/.test(suffix)) return null;
      // add = 固定値 / multiply* = 割合（%）
      const isFixed = /^[-_]add/.test(suffix);
      return { stat, grant, isFixed };
    }
    return null;
  };

  const photos = [];
  for (const p of photoRows) {
    const structured = [];
    const skills = [];
    for (const ab of p.abilities ?? []) {
      const abilityId = String(ab.photoAbilityId ?? "");
      const ability = abilityMap.get(abilityId);
      const statInfo = abilityToStat(abilityId, ability);
      if (statInfo && statInfo.skillId !== undefined) {
        if (statInfo.skillId !== null) skills.push(statInfo.skillId);
        continue;
      }
      if (statInfo === null) {
        stats.photosUnsupportedAbility.add(abilityId);
        continue;
      }
      const stat = statInfo.grant !== null
        ? `grant_${statInfo.grant === "neighbors" ? "neighbors" : "center"}_${statInfo.stat}`
        : statInfo.stat;
      // add = 固定値（effectValue そのまま）/ multiply* = 割合（effectValue は初期品質での
      // 値×10・実測検証済み → % 表記に変換）
      structured.push({
        stat,
        type: statInfo.isFixed ? "fixed" : "pct",
        value: statInfo.isFixed ? (ab.effectValue ?? 0) : (ab.effectValue ?? 0) / 10,
      });
    }
    photos.push({
      id: String(p.id),
      name: String(p.name ?? p.id),
      assetId: String(p.assetId ?? ""),
      rarity: p.rarity ?? null,
      placeName: p.placeName ?? "",
      eventName: p.eventName ?? "",
      /** 初期品質（フォト獲得時の品質。graceful: UI の初期値） */
      initialQuality: p.level ?? null,
      /** 撮影キャラ（char-xxx。そのキャラが写っているフォト・専用フォトとは別物） */
      focusCharacterId: p.focusCharacterId ?? "",
      focusCharacterName: p.focusCharacterId ? (charNames.get(String(p.focusCharacterId)) ?? "") : "",
      structured,
      skills,
    });
  }
  return photos;
}

function buildCharacters(rows) {
  const map = {};
  for (const c of rows) {
    map[String(c.id)] = String(c.name ?? c.id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

/**
 * 【Phase 8-B3】カードレベル解放テーブル（data/unlocks.json）の生成。
 *
 * CardLevelRelease.json（全カードが card_level_release_1 を使用）から:
 * - type1 = スキル枠（×1=Lv1, ×2=Lv20, ×3=Lv80）
 * - type7 = フォト枠（×2=Lv1, ×3=Lv65, ×4=Lv105）
 * - type4 = 補正枠（×1=Lv1, ×2=Lv35, ×3=Lv45）【Unknown: アクセサリ枠と推定するが未確定】
 * - type2/type3 = Lv30 で解放（用途未確定・記録のみ）
 *
 * スキルLv要求カードレベル表（スキル枠 i の Lv2-6 に必要なカードレベル）は
 * Skill.json の levels[].requiredCardLevel から集計する。全1482スキルで
 * 枠別に完全一致することを検証済み（2026-08-31・T5 ゴールデンの実スキルレベル
 * L1/L2/L4/L5=215→3枠目Lv5・L3=230→Lv6 とも整合）。
 */
function buildUnlocks(skillRows, cardRows, clrRows) {
  const rows = clrRows.filter((r) => String(r.id) === "card_level_release_1");
  if (rows.length === 0) throw new Error("CardLevelRelease: card_level_release_1 が見つかりません");
  const byLevel = new Map(rows.map((r) => [r.level, r.targets]));
  /**
   * targets.number の解釈は type で異なる（実ゲームの解放仕様と突合済み）:
   * - type1（スキル枠）/ type4（補正枠）: number = 解放する枠の通し番号
   *   （type1 → [1, 20, 80]: スロット1=Lv1・2=Lv20・3=Lv80）
   * - type7（フォト枠）: number = 追加枚数の累積
   *   （type7 → [1, 1, 65, 105]: 初期2枚・3枚目=Lv65・4枚目=Lv105）
   */
  const collect = (type, ordinal) => {
    const out = [];
    for (const [lv, targets] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
      for (const t of targets) {
        if (t.type !== type) continue;
        if (ordinal) out[t.number - 1] = lv;
        else for (let k = 0; k < t.number; k++) out.push(lv);
      }
    }
    for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = 1;
    return out;
  };
  const skillSlotUnlockLevels = collect(1, true);
  const photoSlotUnlockLevels = collect(7, false);
  const accessorySlotUnlockLevels = collect(4, true);
  const otherUnlocks = {};
  for (const t of new Set([...byLevel.values()].flat().map((x) => x.type))) {
    if (t === 1 || t === 4 || t === 7) continue;
    const levels = [];
    for (const [lv, targets] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
      for (const tg of targets) if (tg.type === t) levels.push({ level: lv, number: tg.number });
    }
    otherUnlocks[`type${t}`] = levels;
  }

  // スキルLv要求カードレベル表（枠 1-4 × Lv 1-6）
  const reqTables = [new Map(), new Map(), new Map(), new Map()];
  for (const c of cardRows) {
    const skillIds = [c.skillId1, c.skillId2, c.skillId3, c.skillId4].filter(
      (x) => x != null && x !== "",
    );
    skillIds.forEach((sid, idx) => {
      if (idx > 3) return;
      const sk = skillRows.find((x) => x.id === sid);
      if (sk === undefined) return;
      for (const lv of sk.levels ?? []) {
        const m = reqTables[idx];
        const cur = m.get(lv.level);
        if (cur === undefined) m.set(lv.level, lv.requiredCardLevel);
        else if (cur !== lv.requiredCardLevel) {
          throw new Error(
            `buildUnlocks: スキルLv要求カードレベルが不整合（slot${idx + 1} Lv${lv.level}: ${cur} vs ${lv.requiredCardLevel} @${sid}）`,
          );
        }
      }
    });
  }
  const skillLevelRequirements = {};
  for (let slot = 0; slot < 4; slot++) {
    skillLevelRequirements[String(slot + 1)] = [1, 2, 3, 4, 5, 6].map(
      (lv) => reqTables[slot].get(lv) ?? 0,
    );
  }
  return {
    skillSlotUnlockLevels,
    photoSlotUnlockLevels,
    accessorySlotUnlockLevels,
    otherUnlocks,
    skillLevelRequirements,
  };
}

/**
 * 【Phase 8-B3】レベル別スキル定義（data/skills_levels.json）の生成。
 * 全カードスキル（1482種 × Lv1-6）を parseSkillLevel で解析し、
 * 短キー + 型/対象/条件のテーブル参照でコンパクトに格納する
 * （UI 埋め込み用。フル形式だと ~4MB になるため ~1MB に圧縮）。
 */
function buildSkillsLevels(skillRows, cardRows, stats) {
  const types = [];
  const targets = [];
  const conditions = [];
  const idxOf = (arr, v) => {
    let i = arr.indexOf(v);
    if (i < 0) {
      arr.push(v);
      i = arr.length - 1;
    }
    return i;
  };
  const packEffect = (e) => {
    const row = {
      t: idxOf(types, e.type),
      tg: idxOf(targets, e.target),
      c: idxOf(conditions, e.condition ?? "none"),
    };
    if (e.durationBeats != null) row.d = e.durationBeats;
    if (e.stages !== undefined) row.st = e.stages;
    if (e.powerPermil !== undefined) row.p = e.powerPermil;
    if (e.value !== undefined) row.v = e.value;
    if (e.limitRelease) row.lr = 1;
    if (e.capExtend) row.ce = 1;
    if (e.scaling !== undefined && e.scaling !== null) row.sc = e.scaling;
    else if (e.scaling === null) row.sn = 1;
    if (e.confidence) row.cf = e.confidence;
    return row;
  };
  const cardSkillIds = [
    ...new Set(
      cardRows.flatMap((c) =>
        [c.skillId1, c.skillId2, c.skillId3, c.skillId4].filter(
          (x) => x != null && x !== "",
        ),
      ),
    ),
  ];
  const skillMap = new Map(skillRows.map((x) => [String(x.id), x]));
  const skills = [];
  let parseFail = 0;
  for (const sid of cardSkillIds) {
    const sk = skillMap.get(sid);
    if (sk === undefined) {
      parseFail += 1;
      continue;
    }
    const levels = [];
    for (const lv of sk.levels ?? []) {
      const parsed = parseSkillLevel(sk, stats, lv.level);
      if (parsed === null) {
        parseFail += 1;
        continue;
      }
      const row = {
        req: lv.requiredCardLevel ?? 0,
        ct: parsed.ct,
        cost: parsed.staminaCost,
        eff: parsed.effects.map(packEffect),
      };
      if (parsed.probabilityPermil !== undefined && parsed.probabilityPermil !== 1000) {
        row.pr = parsed.probabilityPermil;
      }
      if (parsed.limitPerLive != null) row.lim = parsed.limitPerLive;
      levels.push(row);
    }
    skills.push({
      id: String(sk.id),
      kind: CATEGORY_TO_KIND[num(sk.categoryType, sk.id)],
      name: String(sk.name ?? sk.id),
      levels,
    });
  }
  return { types, targets, conditions, skills, parseFail };
}

async function main() {
  await ensureVendor();
  const chartRows = loadVendor("MusicChartPattern");
  const questRows = loadVendor("Quest");
  const musicRows = loadVendor("Music");
  const cardRows = loadVendor("Card");
  const skillRows = loadVendor("Skill");
  const characterRows = loadVendor("Character");
  const accessoryRows = loadVendor("Accessory");
  const skillTargetRows = loadVendor("SkillTarget");
  const areaRows = loadVendor("Area");
  const liveBonusGroupRows = loadVendor("LiveBonusGroup");
  const liveBonusRows = loadVendor("LiveBonus");
  const liveAbilityRows = loadVendor("LiveAbility");
  // 【サンプル3・2026-09-04】キャラ優位（QuestCharacterAdvantage）
  const characterAdvantageRows = loadVendor("QuestCharacterAdvantage");
  // 【Phase 8-B2】フォトマスタ
  const photoRows = loadVendor("PhotoAllInOne");
  const photoAbilityRows = loadVendor("PhotoAbility");
  // 【Phase 8-B3】カードレベル解放
  const cardLevelReleaseRows = loadVendor("CardLevelRelease");
  TARGET_IDS = new Set(skillTargetRows.map((r) => String(r.id)));

  const stats = {
    unsupportedEffects: new Set(),
    unsupportedTargets: new Set(),
    missingSkills: new Set(),
    liveBonusMissing: new Set(),
    accessoriesNoParam: 0,
    photosMissingSkill: new Set(),
    photosUnsupportedAbility: new Set(),
  };

  const charts = buildCharts(chartRows);
  const stagesIndex = buildStagesIndex(questRows, musicRows, charts, areaRows);
  const skillsMaster = buildSkillsMaster(cardRows, skillRows, stats);
  const liveBonusesByQuest = buildLiveBonuses(
    questRows,
    liveBonusGroupRows,
    liveBonusRows,
    liveAbilityRows,
    skillRows,
    stats,
  );
  // 【サンプル3・2026-09-04】キャラ優位（STAGE045 の ⅢX メンバー等）
  const characterAdvantageByQuest = buildCharacterAdvantage(questRows, characterAdvantageRows);
  const accessories = buildAccessories(accessoryRows, stats);
  const characters = buildCharacters(characterRows);
  const photosMaster = buildPhotosMaster(photoRows, photoAbilityRows, skillRows, characterRows, stats);
  const unlocks = buildUnlocks(skillRows, cardRows, cardLevelReleaseRows);
  const skillsLevels = buildSkillsLevels(skillRows, cardRows, stats);
  // フォト能力が参照する passive スキル（sk-phot-*）を SkillDef 互換へ解析（kind:"photo"）
  const photoSkillRows = new Map(skillRows.map((sk) => [String(sk.id), sk]));
  const photoSkillsById = {};
  for (const skillId of [...new Set(photosMaster.flatMap((p) => p.skills))]) {
    const sk = photoSkillRows.get(skillId);
    if (sk === undefined) continue;
    const parsed = parseSkillLevel(sk, stats, null, "photo");
    if (parsed !== null) photoSkillsById[skillId] = parsed;
  }

  const writeJson = (file, obj) => {
    writeFileSync(path.join(DATA, file), JSON.stringify(obj) + "\n", "utf8");
    console.log(
      `[write] data/${file} (${(statSync(path.join(DATA, file)).size / 1024).toFixed(1)} KiB)`,
    );
  };

  writeJson("charts_all.json", charts);
  writeJson("stages_index.json", stagesIndex);
  writeJson("skills_master.json", { byCard: skillsMaster });
  writeJson("live_bonuses.json", { byQuest: liveBonusesByQuest });
  writeJson("character_advantage.json", { byQuest: characterAdvantageByQuest });
  console.log(
    `character advantage: ${Object.keys(characterAdvantageByQuest).length} クエストに付与`,
  );
  writeJson("accessories.json", { accessories });
  writeJson("characters.json", { characters });
  writeJson("photos_master.json", { photos: photosMaster, skillsById: photoSkillsById });
  writeJson("unlocks.json", unlocks);
  writeJson("skills_levels.json", skillsLevels);

  console.log(`charts: ${Object.keys(charts).length} 譜面`);
  console.log(
    `stages: ${stagesIndex.quests.length} クエスト / ${stagesIndex.musics.length} 曲 / ${stagesIndex.configs.length} 設定 / エリア ${stagesIndex.areas.length} / 譜面欠落 ${stagesIndex.warnings.length}`,
  );
  const catCount = new Map();
  for (const q of stagesIndex.quests) {
    const cat = stagesIndex.areas[q.ar]?.c ?? "other";
    catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
  }
  console.log(`大分類: ${[...catCount.entries()].sort().map(([c, n]) => `${c}=${n}`).join(" / ")}`);
  console.log(`skills: ${Object.keys(skillsMaster).length} カード分`);
  console.log(
    `live bonuses: ${Object.keys(liveBonusesByQuest).length} クエストに付与（スキル定義 ${[...new Set(Object.values(liveBonusesByQuest).flat().map((d) => d.id))].length} 種）`,
  );
  console.log(`accessories: ${accessories.length} 件（補正なし ${stats.accessoriesNoParam}）`);
  console.log(`characters: ${Object.keys(characters).length} 件`);
  console.log(
    `unlocks: スキル枠解放 [${unlocks.skillSlotUnlockLevels}]・フォト枠解放 [${unlocks.photoSlotUnlockLevels}]・スキルLv要求表 ${Object.keys(unlocks.skillLevelRequirements).length} 枠`,
  );
  console.log(`skills_levels: ${skillsLevels.skills.length} スキル × Lv1-6（型 ${skillsLevels.types.length}/対象 ${skillsLevels.targets.length}/条件 ${skillsLevels.conditions.length}・解析失敗 ${skillsLevels.parseFail}）`);
  console.log(`photos: ${photosMaster.length} 枚（スキル付き ${photosMaster.filter((p) => p.skills.length > 0).length}・撮影キャラ付き ${photosMaster.filter((p) => p.focusCharacterId).length}）・フォトスキル ${Object.keys(photoSkillsById).length} 種`);
  console.log(`未対応効果名: ${stats.unsupportedEffects.size} 種`);
  console.log(`未対応ターゲット: ${stats.unsupportedTargets.size} 種`);
  if (stats.missingSkills.size > 0) {
    console.error(`Skill 行が見つからない ID: ${[...stats.missingSkills].join(", ")}`);
  }
  if (stats.liveBonusMissing.size > 0) {
    console.error(`[warn] ライブボーナスの解決に失敗: ${[...stats.liveBonusMissing].sort().join(", ")}`);
  }
  if (stats.unsupportedEffects.size > 0) {
    console.error(`[info] 未対応効果名一覧: ${[...stats.unsupportedEffects].sort().join(", ")}`);
  }
  if (stats.unsupportedTargets.size > 0) {
    console.error(`[info] 未対応ターゲット一覧: ${[...stats.unsupportedTargets].sort().join(", ")}`);
  }
  if (stats.photosUnsupportedAbility.size > 0) {
    console.error(
      `[info] フォトの未対応能力一覧 (${stats.photosUnsupportedAbility.size} 種): ${[...stats.photosUnsupportedAbility].sort().slice(0, 40).join(", ")}${stats.photosUnsupportedAbility.size > 40 ? " …" : ""}`,
    );
  }
  if (stats.photosMissingSkill.size > 0) {
    console.error(`[warn] フォト能力のスキル定義が見つからない ID: ${[...stats.photosMissingSkill].sort().join(", ")}`);
  }
}

main().catch((err) => {
  console.error(`build_data_phase6: 失敗 — ${err?.stack ?? err}`);
  process.exit(1);
});

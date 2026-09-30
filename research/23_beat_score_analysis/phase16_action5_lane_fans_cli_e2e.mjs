/**
 * Phase 16 Action5: `stage.lane_fans[]`（満員ガード付きレーン別ファン）の
 * **CLI エンドツーエンド検証**（実行: 2026-09-30 ／ 担当: cline）
 *
 * 目的:
 *  1. `npm run simulate`（= npx tsx src/cli/simulate.ts）に入力 JSON 経由で
 *     `stage.lane_fans[]` を渡す経路が実際に動くこと（ビルド警告だけでなく CLI 実走で確認）
 *  2. 満員ガードがステージ cap 基準で正しく効くこと
 *     （S1: 19+19+18+22+22=100 = cap 100 → 満員 / S3: 40,000 = cap → 満員 /
 *       S2: 66,031 < cap 70,000 → 空席＝レーン別表引き）
 *  3. ファン係数が**そのレーンのスコアにだけ**乗ること
 *     （mode 間のレーン別スコア比 ≈ ファン係数比。倍率から逆算した係数を表引き期待値と照合）
 *
 * 注意:
 *  - confirmed ランは crit なし・rand=1000（乱数中立）なので絶対値は実測より低い。
 *    本スクリプトの主眼は **mode 間比較**（絶対値の当否は action4 報告と accuracy 側で見る）。
 *  - S1 の audience は AGENTS.md の確定値 **20 人**（fan.png 来場 19/19/18/22/22 = 平均 20、
 *    cap 100 の個人上限）。サンプル1 deck.json 生の `audience: 71000` は目標スコアの誤入力
 *    （research/23 phase16_action2b）なので使わない。
 *  - aipura_nox 側は読むだけ（上書きしない）。生成するのは scratch/a5_e2e/ 配下のみ。
 *
 * 実行: node research/23_beat_score_analysis/phase16_action5_lane_fans_cli_e2e.mjs
 * 出力: stdout（同じ名の _out.txt に保存）
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(process.cwd());
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const workDir = path.join(repoRoot, "scratch", "a5_e2e");
fs.mkdirSync(workDir, { recursive: true });

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const num = (v) => (typeof v === "number" ? v : Number(v));
const fmt = (v) => (typeof v === "number" ? Math.round(v).toLocaleString("en-US") : String(v));

/** ファン係数テーブル（data/stages/audience_advantage.json・1000 行）。旧経路の逆算と新経路の予測の両方に使う */
const FAN_TABLE = readJson(path.join(repoRoot, "data", "stages", "audience_advantage.json"));
/** 来場数 → ファン係数 permil（src/formula/fan.ts fanBonusPermil と同じ「以下最大の行」規則） */
const fPermil = (x) => {
  let v = 1000;
  for (const r of FAN_TABLE) {
    if (r.audience <= x) v = r.advantagePermil;
    else break;
  }
  return v;
};
/** ファン係数 permil → その係数になる来場数の範囲（表の刻み幅＝逆算の不確度も兼ねる）。advantagePermil は行ごとに一意 */
const attendanceRangeOf = (permil) => {
  const i = FAN_TABLE.findIndex((r) => r.advantagePermil === permil);
  if (i < 0) return null;
  const min = FAN_TABLE[i].audience;
  const max = i + 1 < FAN_TABLE.length ? FAN_TABLE[i + 1].audience - 1 : 50000;
  return { min, max, mid: (min + max) / 2 };
};

/** 実測レーン別スコア（results の key 形式がサンプル間で異なるため吸収する） */
function measuredLanes(m) {
  const r = m?.results ?? {};
  const src = r.scores_by_lane ?? r.lane_scores ?? r.lanes ?? null;
  if (!src) return null;
  const out = {};
  for (let l = 1; l <= 5; l++) {
    const v = src[String(l)] ?? src[`lane${l}`] ?? src[l];
    out[l] = typeof v === "number" ? v : null;
  }
  return out;
}

const SAMPLES = [
  {
    id: "S1",
    stage: "qt-area-1-001",
    chart: "chart-hsm-006-001",
    cap: 100,
    deck: path.join(noxRoot, "サンプル1", "deck.json"),
    example: "examples/nested-sample.json", // missedNotes / mentalOverride の出典（Repo 側コピー）
    audience: 20, // AGENTS.md 確定値（deck.json の 71000 は目標スコアの誤入力）
    laneFans: [19, 19, 18, 22, 22], // fan.png 実測
    expectFactors: [1002, 1002, 1002, 1002, 1002], // 満員 → f(cap/5) = f(20)
    measured: path.join(noxRoot, "サンプル1", "measured_data_v2.json"),
  },
  {
    id: "S2",
    stage: "qt-tower-680",
    chart: "chart-sun-004-001",
    cap: 70000,
    deck: path.join(noxRoot, "サンプル2", "deck.json"),
    example: "examples/sample2.json",
    audience: 13206, // = 66,031 / 5（実測レーン平均・deck.json と一致）
    laneFans: [11996, 13543, 13741, 13255, 13496],
    expectFactors: [1539, 1570, 1574, 1565, 1569], // 空席 → f(レーン来場)
    // 空席会場なので「逆算した legacy 係数を表引きで再現する来場数」を lane_fans に与えると
    // legacy のレーン別スコアを再現できるはず → 線形性と逆算の相互検証（検D）が成立する
    shiftCheck: true,
    measured: path.join(repoRoot, "research", "26_data_integrity", "measured_data_s2_v3.json"),
  },
  {
    id: "S3",
    stage: "qt-ex-tower-005-045",
    chart: "chart-thrx-004-001",
    cap: 40000,
    deck: path.join(noxRoot, "サンプル3", "deck.json"),
    example: "examples/sample3.json",
    s3Fixes: true, // 既存解析と同じ 2 つの【Estimate】調整を再現（下の runMode 参照）
    audience: 8000,
    laneFans: [8515, 7748, 8535, 8518, 6684],
    expectFactors: [1375, 1375, 1375, 1375, 1375], // 満員 → f(8000)
    measured: path.join(repoRoot, "research", "26_data_integrity", "measured_data_s3_v3.json"),
  },
];


function runCli(inputPath, outPath) {
  const cmd = `npx -y tsx src/cli/simulate.ts --input "${inputPath}" --out "${outPath}" --n 1 --crit-rate 0`;
  try {
    execSync(cmd, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    throw new Error(
      `CLI 失敗 (${path.basename(inputPath)}):\n${String(e.stderr ?? "").slice(-3000)}\n${String(e.stdout ?? "").slice(-1000)}`,
    );
  }
  return readJson(outPath);
}

/** CLI を mode（legacy | lanefans | shift）で走らせて confirmed のレーン別スコアを返す */
function runMode(s, mode, fansOverride) {
  // サンプルの deck.json はネスト形式（{ id, name, deck: { characters… }, myPhotos, photoEquip }）
  const raw = readJson(s.deck);
  const deck = raw.deck ?? raw;
  // S3: 既存解析（tmp_a4_s3_beats.ts）と同一の調整を再現
  //  - L4 のスキル2 CT を -5（バナー発動タイミングの実測に合わせる）【Estimate】
  //  - L5 の自撮影フォト uph-lane5-3 を more_stamina 側に切り替え（観測と一致させる）【Estimate】
  if (s.s3Fixes) {
    deck.characters[3].ct_cuts = [{ skill: 2, value: 5 }];
    for (const ph of raw.myPhotos ?? []) {
      if (ph?.id === "uph-lane5-3" && ph.skill !== null) ph.skill.staminaScaling = "more_stamina";
    }
  }
  const aux = s.example ? readJson(path.join(repoRoot, s.example)) : {};
  const cfg = {
    deck,
    stage:
      mode === "legacy"
        ? { file: s.stage }
        : { file: s.stage, lane_fans: fansOverride ?? s.laneFans },
    chart: { file: s.chart },
    audience: s.audience,
    critRate: 0, // confirmed は元々 crit なし。MC を決定的にするため 0
    missedNotes: raw.missedNotes ?? aux.missedNotes,
    mentalOverride: raw.mentalOverride ?? aux.mentalOverride,
    disabledSkillIds: raw.disabledSkillIds ?? aux.disabledSkillIds,
    myPhotos: raw.myPhotos ?? aux.myPhotos,
    photoEquip: raw.photoEquip ?? aux.photoEquip,
  };


  const inputPath = path.join(workDir, `${s.id}_${mode}.json`);
  const outPath = path.join(workDir, `${s.id}_${mode}_out.json`);
  fs.writeFileSync(inputPath, JSON.stringify(cfg, null, 2), "utf8");
  const t0 = Date.now();
  const res = runCli(inputPath, outPath);
  const lanes = {};
  for (const e of res.confirmed.lanes ?? []) lanes[num(e.lane)] = num(e.total);
  return {
    mode,
    ms: Date.now() - t0,
    total: num(res.confirmed.totalScore),
    fanScalar: res.settings?.fanFactorPermil ?? null,
    laneFactors: res.settings?.laneFanFactorPermil ?? null,
    lanes,
  };
}

console.log("=== Phase 16 Action5: stage.lane_fans[] の CLI E2E 検証（confirmed=乱数中立・crit なし） ===");
console.log(`repo=${repoRoot}`);
console.log(`nox =${noxRoot} (exists=${fs.existsSync(noxRoot)})`);
console.log("");

const verdicts = [];
for (const s of SAMPLES) {
  const sum = s.laneFans.reduce((a, b) => a + b, 0);
  const full = sum >= s.cap;
  console.log(
    `--- ${s.id} ${s.stage} / cap ${fmt(s.cap)} / lane_fans 合計 ${fmt(sum)} → ${full ? "満員: 全レーン一律 f(cap/5)" : "空席: f(レーン来場)"}`,
  );
  console.log(`    期待レーン係数 ${JSON.stringify(s.expectFactors)}`);

  let legacy, laneFans;
  try {
    legacy = runMode(s, "legacy");
    laneFans = runMode(s, "lanefans");
  } catch (e) {
    console.log(`    !! ${e.message}`);
    verdicts.push({ id: s.id, ok: false });
    continue;
  }

  console.log(
    `    settings.fanFactorPermil: legacy=${legacy.fanScalar ?? "（スカラー経路なし＝引力度配分）"} / ` +
      `lanefans=${laneFans.fanScalar ?? "（未設定＝レーン別経路）"}`,
  );

  let meas = null;
  try {
    meas = measuredLanes(readJson(s.measured));
  } catch {
    meas = null;
  }
  const measTotal = meas ? Object.values(meas).reduce((a, b) => a + (b ?? 0), 0) : null;
  console.log(
    `    confirmed 合計: legacy ${fmt(legacy.total)} → lanefans ${fmt(laneFans.total)} ` +
      `（${(((laneFans.total - legacy.total) / legacy.total) * 100).toFixed(2)}%）` +
      (measTotal ? ` / 実測（参考・crit 込み） ${fmt(measTotal)}` : ""),
  );
  console.log("    レーン |          legacy |        lanefans |     倍率 | 逆算 legacy 係数 | 適用係数(期待) | 逆算来場数(表)");
  let worst = 0;
  let sumAtt = 0;
  let attTol = 0;
  let inversionOk = true;
  /** レーン別の逆算 legacy 係数と逆引き来場数（検D で lane_fans 入力を組み立てるために保持） */
  const impliedPerLane = [];
  for (let l = 1; l <= 5; l++) {
    const a = legacy.lanes[l] ?? 0;
    const b = laneFans.lanes[l] ?? 0;
    const ratio = a > 0 ? b / a : NaN;
    // lanefans 側に**実際に適用された**係数（CLI が報告）で legacy 側の実適用係数を逆算する
    const applied = (laneFans.laneFactors ?? s.expectFactors)[l - 1];
    const impliedLegacy = applied / ratio;
    const exp = s.expectFactors[l - 1];
    // legacy は引力度配分（集目/ステルス）を使うので、外れていればその差は配分の寄与と読める
    if (Number.isFinite(impliedLegacy) && exp > 0) worst = Math.max(worst, Math.abs(impliedLegacy - exp) / exp);
    const inv = attendanceRangeOf(Math.round(impliedLegacy));
    if (inv) {
      sumAtt += inv.mid;
      attTol += (inv.max - inv.min) / 2 + 0.5;
    } else {
      inversionOk = false;
    }
    impliedPerLane.push({ permil: Math.round(impliedLegacy), attMid: inv?.mid ?? null });
    console.log(
      `      L${l}   | ${fmt(a).padStart(13)} | ${fmt(b).padStart(13)} |  x${ratio.toFixed(4)} | ` +
        `${Math.round(impliedLegacy)}‰ | ${applied} (${exp}) | ` +
        (inv ? `${fmt(inv.min)}-${fmt(inv.max)}` : "（表に該当行なし）"),
    );
  }
  console.log(`    （参考）逆算 legacy 係数が表引き期待値から外れた最大幅: ${(worst * 100).toFixed(2)}%（満員/空席の一律値との差＝集目/ステルスの配分寄与）`);
  console.log(`    （CLI 実行: legacy ${legacy.ms}ms / lanefans ${laneFans.ms}ms・--n 1・--crit-rate 0）`);
  // ---- 検B（本題・直接検査）: CLI が報告する実適用レーン係数が確定規則（満員一律 / 空席レーン別）と一致 ----
  const checkB =
    Array.isArray(laneFans.laneFactors) &&
    laneFans.laneFactors.length === 5 &&
    laneFans.laneFactors.every((v, i) => v === s.expectFactors[i]);
  const legacyCompat = legacy.laneFactors === null;
  console.log(
    `    検B（lane_fans 経路・直接）: 実適用レーン係数 ${JSON.stringify(laneFans.laneFactors)} = 期待 ${JSON.stringify(s.expectFactors)} → ${checkB ? "PASS" : "FAIL"}` +
      ` ／ legacy 側 laneFanFactorPermil=null（従来経路の後方互換）→ ${legacyCompat ? "PASS" : "FAIL"}`,
  );
  // ---- 検A（参考・足場の妥当性）: legacy 係数を作表から逆引きした来場数の合計が audience×5 を保全するか ----
  // 旧経路は「自レーン来場 = round(audience×5×引力度_i / Σ引力度)」→ 表引きなので、5 レーン合計は
  // audience×5 に近いはず。**ただし判定は解像度が許すサンプルのみ**（S1 は cap 100 のため表の刻み 10 人＝
  // 1‰ が来場数 10 人に相当し、スコア比 0.1% の差が来場数 ±10 人の揺れになる＝解像度不足）。
  const expectedAtt = s.audience * 5;
  const tol = attTol + expectedAtt * 0.02;
  const quantShare = attTol / expectedAtt; // 表の刻み由来の不確度の相対サイズ
  const checkAResolvable = inversionOk && quantShare < 0.02;
  const checkA = checkAResolvable && Math.abs(sumAtt - expectedAtt) <= tol;
  console.log(
    `    検A（参考・旧経路＝引力配分の総量和風保全）: Σ逆算来場 ${fmt(sumAtt)} vs audience×5 ${fmt(expectedAtt)}` +
      `（差 ${fmt(sumAtt - expectedAtt)} / 許容 ±${fmt(tol)}・表刻み由来 ±${(quantShare * 100).toFixed(1)}%）→ ` +
      (inversionOk ? (checkAResolvable ? (checkA ? "PASS" : "FAIL") : "（解像度不足のため参考値）") : "（表にない係数があり逆算不能）"),
  );
  // ---- 検C（スコア応答）: mode 間でスコアが動き、レーン別倍率が係数差の範囲内に収まる ----
  const checkC =
    laneFans.total !== legacy.total &&
    [1, 2, 3, 4, 5].every((l) => {
      const a = legacy.lanes[l] ?? 0;
      const b = laneFans.lanes[l] ?? 0;
      return a > 0 && b > 0 && b / a > 0.8 && b / a < 1.25;
    });
  console.log(`    検C（スコア応答）: mode 間で合計が変化し、全レーン倍率が係数差の範囲内（0.8-1.25）→ ${checkC ? "PASS" : "FAIL"}`);
  // ---- 検D（線形性＋逆算の相互検証・空席会場のみ）: 逆算 legacy 係数を“表引きで再現する来場数”を
  // lane_fans に与えて再走させると、legacy のレーン別スコアがそのまま再現されるはず。
  // fan 係数が得点経路へ線形に効くこと＋lane_fans 経路の表引きが意図どおりであることの両方を一度に検証する。
  let checkD = null;
  if (s.shiftCheck) {
    const shiftFans = impliedPerLane.map((x) => (x.attMid === null ? null : Math.round(x.attMid)));
    const shiftSum = shiftFans.reduce((a, b) => a + (b ?? 0), 0);
    if (shiftFans.some((v) => v === null)) {
      console.log(`    検D（線形性＋逆算の相互検証）: 逆算不能なレーンがあるためスキップ`);
    } else if (shiftSum >= s.cap) {
      console.log(`    検D（線形性＋逆算の相互検証）: 逆算来場合計 ${fmt(shiftSum)} >= cap ${fmt(s.cap)} で満員ガードが発動するためスキップ`);
    } else {
      const shift = runMode(s, "shift", shiftFans);
      let maxLane = 0;
      const cells = [];
      for (let l = 1; l <= 5; l++) {
        const a = legacy.lanes[l] ?? 0;
        const b = shift.lanes[l] ?? 0;
        const d = a > 0 ? (b - a) / a : NaN;
        maxLane = Math.max(maxLane, Math.abs(d));
        cells.push(`L${l} ${(d * 100).toFixed(3)}%`);
      }
      checkD = maxLane <= 0.005;
      console.log(
        `    検D（線形性＋逆算の相互検証）: lane_fans=${JSON.stringify(shiftFans)}（適用係数 ${JSON.stringify(shift.laneFactors)} ≒ 逆算 legacy ${JSON.stringify(impliedPerLane.map((x) => x.permil))}）` +
          ` → legacy とのレーン別差 ${cells.join(" / ")}（最大 ${(maxLane * 100).toFixed(3)}%・許容 ±0.5%）→ ${checkD ? "PASS" : "FAIL"}`,
      );
    }
  }
  console.log("");
  verdicts.push({
    id: s.id,
    ok: checkB && checkC && legacyCompat && (checkD === null || checkD),
    full,
    legacy: legacy.total,
    laneFans: laneFans.total,
    maxDev: worst,
    checks: { checkA, checkAResolvable, checkB, checkC, checkD, legacyCompat },
  });
}

console.log("=== 判定サマリ（ゲート=検B/検C/検D/後方互換・検Aは旧経路の参考検査） ===");
for (const v of verdicts)
  console.log(
    `  ${v.id}: ${v.ok ? "PASS" : "FAIL"}  満員=${v.full ?? "-"}  legacy ${fmt(v.legacy)} → lanefans ${fmt(v.laneFans)}` +
      (v.checks
        ? `  [B=${v.checks.checkB ? "○" : "×"} C=${v.checks.checkC ? "○" : "×"}` +
          ` D=${v.checks.checkD === null ? "─" : v.checks.checkD ? "○" : "×"}` +
          ` 互換=${v.checks.legacyCompat ? "○" : "×"}` +
          ` A(参考)=${v.checks.checkAResolvable ? (v.checks.checkA ? "○" : "×") : "解像度不足"}]`
        : "") +
      (typeof v.maxDev === "number" ? `  旧経路の表引き期待値からの最大乖離 ${(v.maxDev * 100).toFixed(2)}%` : ""),
  );
console.log("");
console.log(`総合: ${verdicts.length > 0 && verdicts.every((v) => v.ok) ? "lane_fans の CLI 経由適用を検証（検B/検C/検D・後方互換すべて PASS）" : "一部 FAIL（上の検B/検C/検D を参照）"}`);
console.log("");
console.log("生成物: scratch/a5_e2e/{S1,S2,S3}_{legacy,lanefans}[_out].json（CLI 入力・gitignore 対象）");



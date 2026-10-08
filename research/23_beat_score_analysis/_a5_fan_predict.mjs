/**
 * Phase 16 Action14 / A5: **正しい fan 口径**（A12 の裁定式）をオフラインで適用したときの
 * 受け入れ値（総スコアと実測乖離）を予測する。`src/` は変更しない。
 *
 *   node research/23_beat_score_analysis/_a5_fan_predict.mjs research/23_beat_score_analysis/phase16_action14_a5_lanefans_events.json
 *
 * 前提:
 *   - 入力の `cellEvents` は `tools/audit_hidden_cells_sim.ts ... --events=S1,S2,S3` の出力
 *     （lanefans 口径 = `laneFanFactorPermil` 指定・A4 の満員ガード付き表引き）。
 *   - A12 の裁定式: `fanF' = laneFanF + focusFanBonusPermil(snap.focus) + Σ_{他4レーン} stealthFanBonusPermil(st)`
 *     （割合型 `isRatioScore` はファン不適用のため 1000 のまま）。
 *   - スコアは `multiplySequential([skillPower, b1, combo, fan, stage, rand, crit])` + flat。
 *     trace に flat が無いので `flat = gainedScore − 再構成スコア` として逆算し、
 *     fan だけ差し替えて再加算する（再構成は全イベントで gained と突合して検証する）。
 */
import fs from "node:fs";

const eventsPath = process.argv[2] ?? "research/23_beat_score_analysis/phase16_action14_a5_lanefans_events.json";
const j = JSON.parse(fs.readFileSync(eventsPath, "utf8"));

const MEAS = {
  S1: ["../aipura_nox/サンプル1/measured_data_v2.json", "research/26_data_integrity/measured_data_s1_v3.json"],
  S2: ["../aipura_nox/サンプル2/measured_data_v3.json", "research/26_data_integrity/measured_data_s2_v3.json"],
  S3: ["../aipura_nox/サンプル3/measured_data_v3.json", "research/26_data_integrity/measured_data_s3_v3.json"],
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const measuredTotal = (tag) => {
  for (const p of MEAS[tag] ?? []) {
    try {
      const m = readJson(p);
      const tl = m.timeline ?? [];
      const bgs = tl.reduce((a, e) => a + (Number(e.beat_gained_score) || 0), 0);
      if (bgs > 0) return { total: bgs, file: p };
    } catch {
      /* 次の候補へ */
    }
  }
  return { total: null, file: null };
};

/** floor(×permil/1000) を順に適用（computeEventScore の multiplySequential と同一） */
const seq = (start, factors) => {
  let v = start;
  for (const f of factors) v = Math.floor((v * f) / 1000);
  return v;
};

const STAGE = 1000; // A2 で S2/S3 の stageFactor は 1000 と確認済み（S1 も同値・laneInfo adv も 1000）
let mismatches = 0;
let nEvents = 0;
const rows = [];
for (const [tag, s] of Object.entries(j.samples)) {
  const evs = Object.values(s.cellEvents ?? {}).flat();
  let oldTotal = 0;
  let newTotal = 0;
  let ratioCells = 0;
  const perLane = new Map();
  for (const e of evs) {
    nEvents++;
    const fan = e.fanFactorPermil ?? 1000;
    const factorsBefore = [e.skillPowerPermil ?? 1000, e.b1Permil ?? 1000, e.comboFactorPermil ?? 1000];
    const b = seq(e.basicScore ?? 0, factorsBefore);
    const after = (f) =>
      seq(b, [f, STAGE, e.randPermil ?? 1000, e.critFactorPermil ?? 1000]);
    const oldScore = after(fan);
    const flat = (e.gainedScore ?? 0) - oldScore;
    if (flat !== 0) mismatches++;
    const fanNew = e.isRatioScore ? 1000 : fan + (e.focusBonusPermil ?? 0) + (e.stealthBonusPermil ?? 0);
    if (e.isRatioScore) ratioCells++;
    const newScore = after(fanNew) + flat;
    oldTotal += e.gainedScore ?? 0;
    newTotal += newScore;
    const cur = perLane.get(e.lane) ?? { old: 0, new: 0 };
    cur.old += e.gainedScore ?? 0;
    cur.new += newScore;
    perLane.set(e.lane, cur);
  }
  const meas = measuredTotal(tag);
  rows.push({ tag, n: evs.length, simOld: oldTotal, simNew: newTotal, ratioCells, meas: meas.total, file: meas.file, perLane });
  console.log(
    `=== ${tag}: イベント ${evs.length}（割合型 ${ratioCells}）` +
      `\n  sim 現行（lanefans）= ${oldTotal.toLocaleString()}` +
      `\n  sim 修正口径      = ${newTotal.toLocaleString()}  （Δ ${(newTotal - oldTotal).toLocaleString()} / ${(((newTotal - oldTotal) / oldTotal) * 100).toFixed(3)}%）`,
  );
  if (meas.total !== null) {
    console.log(
      `  実測レーン合計    = ${meas.total.toLocaleString()}（${meas.file}）` +
        `\n  → 現行 乖離 ${(((oldTotal - meas.total) / meas.total) * 100).toFixed(3)}%` +
        ` ／ 修正口径 乖離 ${(((newTotal - meas.total) / meas.total) * 100).toFixed(3)}%` +
        `（改善 ${(((newTotal - oldTotal) / meas.total) * 100).toFixed(3)} ポイント）`,
    );
  }
  for (const [lane, v] of [...perLane.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(
      `    L${lane}: 現行 ${v.old.toLocaleString()} → 修正 ${v.new.toLocaleString()}` +
        `（Δ ${(v.new - v.old).toLocaleString()} / ${(((v.new - v.old) / v.old) * 100).toFixed(3)}%）`,
    );
  }
}
console.log(
  `\n[検証] flat 逆算が 0 でなかったイベント: ${mismatches} / ${nEvents}` +
    `（0 以外は A/SP のフラット加算を持つセル。再構成の突合は下の一致率で見る）`,
);
const check = [];
for (const [tag, s] of Object.entries(j.samples)) {
  const evs = Object.values(s.cellEvents ?? {}).flat();
  const sum = evs.reduce((a, e) => a + (e.gainedScore ?? 0), 0);
  check.push(`${tag}: ΣcellEvents ${sum.toLocaleString()} vs tool totalScore ${Number(s.totalScore).toLocaleString()}（差 ${(Number(s.totalScore) - sum).toLocaleString()}）`);
}
console.log("[検証] Σevents vs totalScore:\n  " + check.join("\n  "));
fs.writeFileSync(
  eventsPath.replace(/\.json$/, "_predict.json"),
  JSON.stringify({ generatedBy: "_a5_fan_predict.mjs", rows: rows.map((r) => ({ ...r, perLane: Object.fromEntries(r.perLane) })), mismatches, nEvents }, null, 2),
  "utf8",
);
console.log(`\n出力: ${eventsPath.replace(/\.json$/, "_predict.json")}`);

/**
 * Phase 16 Action11 タスク2: 「act なしセルの sim/pop 比」を S1/S2/S3 でレーン別に出す読み取り専用分析。
 * 入力: phase16_action11_decouple_out.json（engine 内訳つき）+ 各サンプルの実測（v3 優先）+ lane_pops_backfill.json
 *
 *   node research/23_beat_score_analysis/phase16_action11_lane_ratio.mjs [--detail]
 */
import fs from "node:fs";

const ROOT = "C:/Users/umaro/Documents/アイプラ";
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const DEC = `${ROOT}/research/23_beat_score_analysis/phase16_action11_decouple_out.json`;
const DETAIL = process.argv.includes("--detail");

const MEAS = {
  S1: [`${NOX}/サンプル1/measured_data_v3.json`, `${NOX}/サンプル1/measured_data_v2.json`],
  S2: [`${NOX}/サンプル2/measured_data_v3.json`, `${NOX}/サンプル2/measured_data_v2.json`],
  S3: [`${NOX}/サンプル3/measured_data_v3.json`, `${NOX}/サンプル3/measured_data_v2.json`],
};
const BACKFILL = {
  S1: `${NOX}/サンプル1/lane_pops_backfill.json`,
  S2: `${NOX}/サンプル2/lane_pops_backfill.json`,
  S3: `${NOX}/サンプル3/lane_pops_backfill.json`,
};

function parseK(text) {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(text ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const unit = { "": 1, K: 1000, M: 1e6, G: 1e9 };
  const u = unit[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : Math.round(Number(m[1]) * u);
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

function loadMeas(id) {
  for (const p of MEAS[id]) {
    if (fs.existsSync(p)) return { path: p, data: readJson(p) };
  }
  throw new Error("no measured file for " + id);
}

const dec = readJson(DEC);
const summary = {};
for (const [id, sim] of Object.entries(dec.samples)) {
  const { path: mpath, data: meas } = loadMeas(id);
  const bf = fs.existsSync(BACKFILL[id]) ? readJson(BACKFILL[id]) : { pops: [] };
  const pop = new Map();
  for (const row of meas.timeline ?? []) {
    const lanes = row?.lanes ?? {};
    for (let l = 1; l <= 5; l++) {
      const cell = lanes[`lane${l}`] ?? lanes[l];
      const p = cell?.gained_score_pop;
      const v = typeof p === "object" && p !== null ? parseK(p.text) : parseK(p);
      if (v !== null) pop.set(`${row.beat}:${l}`, v);
    }
  }
  let inline = pop.size;
  for (const x of bf.pops ?? []) {
    if (typeof x?.beat !== "number" || typeof x?.lane !== "number" || x.readable === false) continue;
    const v = parseK(x.displayed);
    if (v !== null && !pop.has(`${x.beat}:${x.lane}`)) pop.set(`${x.beat}:${x.lane}`, v);
  }
  const actCells = new Set();
  for (const a of meas.skill_activations_summary ?? []) actCells.add(`${a.beat}:${a.lane}`);
  // レーン別の stat_value / pop_class / blue_dots（実測）
  const laneMeta = new Map();
  for (const row of meas.timeline ?? []) {
    for (let l = 1; l <= 5; l++) {
      const cell = (row.lanes ?? {})[`lane${l}`] ?? (row.lanes ?? {})[l];
      if (cell === undefined) continue;
      laneMeta.set(`${row.beat}:${l}`, {
        stat: cell.stat_value,
        popClass: cell.pop_class,
        blue: cell.blue_dots,
      });
    }
  }
  console.log(`\n########## ${id}  (measured: ${mpath.split("/").slice(-2).join("/")}) ##########`);
  console.log(`  pop 復元 ${pop.size} セル（内生 ${inline}） / act セル ${actCells.size}`);
  const popClasses = new Map();
  for (const [, v] of laneMeta) popClasses.set(v.popClass, (popClasses.get(v.popClass) ?? 0) + 1);
  console.log(`  pop_class 分布: ${[...popClasses.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);

  const perLane = {};
  for (let l = 1; l <= 5; l++) {
    const rows = [];
    for (const [k, evs] of Object.entries(sim.cells)) {
      const [b, ln] = k.split(":").map(Number);
      if (ln !== l) continue;
      if (actCells.has(k)) continue;
      const p = pop.get(k);
      if (p === undefined || p < 3000) continue;
      // ビート素点のみのセル（スキルノーツ・フォト等が同ビートに無い）に限定
      const beatOnly = evs.length === 1 && evs[0].sourceKind === "beat";
      if (!beatOnly) continue;
      const s = evs[0].gainedScore;
      rows.push({
        b,
        r: s / p,
        ev: evs[0],
        meta: laneMeta.get(k) ?? null,
      });
    }
    const mean = (a) => (a.length === 0 ? NaN : a.reduce((x, y) => x + y, 0) / a.length);
    const rs = rows.map((x) => x.r);
    const white = rows.filter((x) => x.meta?.popClass === "W" && (x.meta?.blue ?? 0) === 0);
    perLane[l] = {
      n: rows.length,
      mean: mean(rs),
      sd: Math.sqrt(mean(rs.map((r) => (r - mean(rs)) ** 2))),
      whiteN: white.length,
      whiteMean: mean(white.map((x) => x.r)),
      rows,
    };
    const lane = sim.lanes.find((x) => x.lane === l);
    console.log(
      `  L${l} attr=${lane?.attribute} n=${rows.length} sim/pop 平均 ${mean(rs).toFixed(4)} (sd ${perLane[l].sd.toFixed(4)}) | W&blue0 n=${white.length} 平均 ${perLane[l].whiteMean.toFixed(4)}`,
    );
  }
  // 素点式の逆算: basicSum^sim を ratio で割ったもの（＝実測が要求する素点の相対値）
  const laneInfo = [];
  for (let l = 1; l <= 5; l++) {
    const lane = sim.lanes.find((x) => x.lane === l);
    const d = lane.deck;
    const w = sim.stage.beatWeightsPermil;
    const simSum = d.vocal * w.vocal + d.dance * w.dance + d.visual * w.visual;
    const r = perLane[l].mean;
    laneInfo.push({ l, attr: lane.attribute, deck: d, simSum, ratio: r, implied: simSum / r });
  }
  const base = laneInfo[0].implied;
  console.log(`  ── 素点式の逆算（L1 基準の相対値・実測が要求する素点） ──`);
  for (const x of laneInfo) {
    console.log(
      `   L${x.l} ${x.attr.padEnd(6)} deck(v=${x.deck.vocal} d=${x.deck.dance} vi=${x.deck.visual}) sim素点=${x.simSum.toLocaleString("en-US")} 比=${x.ratio.toFixed(4)} 要求相対=${(x.implied / base).toFixed(4)}`,
    );
  }
  summary[id] = { laneInfo, perLane, popSize: pop.size, sources: { measured: mpath } };
  if (DETAIL) {
    for (let l = 1; l <= 5; l++) {
      console.log(
        `  [detail] L${l}: ` +
          perLane[l].rows.map((x) => `b${x.b}:${x.r.toFixed(2)}`).join(" "),
      );
    }
  }
}
fs.writeFileSync(
  `${ROOT}/research/23_beat_score_analysis/phase16_action11_lane_ratio_out.json`,
  JSON.stringify(
    Object.fromEntries(
      Object.entries(summary).map(([k, v]) => [
        k,
        {
          laneInfo: v.laneInfo,
          perLane: Object.fromEntries(
            Object.entries(v.perLane).map(([l, x]) => [
              l,
              { n: x.n, mean: x.mean, sd: x.sd, whiteN: x.whiteN, whiteMean: x.whiteMean },
            ]),
          ),
          popSize: v.popSize,
        },
      ]),
    ),
    null,
    1,
  ),
  "utf8",
);
console.log("\n[saved] phase16_action11_lane_ratio_out.json");

/** Phase 16 Action11 タスク2: レーン別の Σsim / Σpop / 実測レーン合計 を突き合わせる読み取り専用チェック。 */
import fs from "node:fs";

const ROOT = "C:/Users/umaro/Documents/アイプラ";
const NOX = "C:/Users/umaro/Documents/aipura_nox";
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const dec = readJson(`${ROOT}/research/23_beat_score_analysis/phase16_action11_decouple_out.json`);

const F = {
  S1: { m: [`${NOX}/サンプル1/measured_data_v3.json`, `${NOX}/サンプル1/measured_data_v2.json`], bf: `${NOX}/サンプル1/lane_pops_backfill.json` },
  S2: { m: [`${NOX}/サンプル2/measured_data_v3.json`, `${NOX}/サンプル2/measured_data_v2.json`], bf: `${NOX}/サンプル2/lane_pops_backfill.json` },
  S3: { m: [`${NOX}/サンプル3/measured_data_v3.json`, `${NOX}/サンプル3/measured_data_v2.json`], bf: `${NOX}/サンプル3/lane_pops_backfill.json` },
};

function parseK(text) {
  const m = /^\+?(\d+(?:\.\d+)?)([KMG]?)$/i.exec(String(text ?? "").replace(/[,\s]/g, ""));
  if (m === null) return null;
  const unit = { "": 1, K: 1000, M: 1e6, G: 1e9 };
  const u = unit[(m[2] ?? "").toUpperCase()];
  return u === undefined ? null : Math.round(Number(m[1]) * u);
}

for (const [id, sim] of Object.entries(dec.samples)) {
  const mp = F[id].m.find((p) => fs.existsSync(p));
  const meas = readJson(mp);
  const bf = fs.existsSync(F[id].bf) ? readJson(F[id].bf) : { pops: [] };
  const pop = new Map();
  for (const x of bf.pops ?? []) {
    if (typeof x?.beat !== "number" || typeof x?.lane !== "number" || x.readable === false) continue;
    const v = parseK(x.displayed);
    if (v !== null) pop.set(`${x.beat}:${x.lane}`, v);
  }
  const laneTotalMeas = meas.results?.scores_by_lane ?? meas.results?.lane_scores ?? meas.lane_scores ?? null;
  console.log(`\n=== ${id} (${mp.split("/").slice(-2).join("/")}) results keys=${Object.keys(meas.results ?? {}).join(",")}`);
  console.log(`    scores_by_lane = ${JSON.stringify(laneTotalMeas)}`);
  const simTot = [1, 2, 3, 4, 5].map((l) =>
    Object.entries(sim.cells).filter(([k]) => k.endsWith(`:${l}`)).reduce((a, [, evs]) => a + evs.reduce((x, e) => x + e.gainedScore, 0), 0),
  );
  console.log(`    sim レーン合計   = ${JSON.stringify(simTot.map((v) => Math.round(v)))}  total=${sim.totalScore}`);
  for (let l = 1; l <= 5; l++) {
    let sp = 0, ss = 0, n = 0;
    for (const [k, v] of pop) {
      const [b, ln] = k.split(":").map(Number);
      if (ln !== l) continue;
      const evs = sim.cells[k];
      if (evs === undefined) continue;
      sp += v; ss += evs.reduce((a, e) => a + e.gainedScore, 0); n++;
    }
    const mt = Array.isArray(laneTotalMeas) ? laneTotalMeas[l - 1] : laneTotalMeas?.[`lane${l}`];
    console.log(
      `    L${l}: n=${String(n).padStart(3)} Σpop=${String(sp).padStart(12)} Σsim(読込セル)=${String(Math.round(ss)).padStart(12)} Σsim/Σpop=${(ss / sp).toFixed(4)}` +
        (mt !== undefined ? `  実測レーン=${mt} Σpop/実測=${(sp / mt).toFixed(4)} sim/実測=${(simTot[l - 1] / mt).toFixed(4)}` : ""),
    );
  }
  // 生の pop 値サンプル
  const samples = (bf.pops ?? []).filter((x) => typeof x?.displayed === "string").slice(0, 6);
  console.log(`    bf 生値例: ${samples.map((x) => `b${x.beat}L${x.lane}=${x.displayed}`).join(" ")}`);
}

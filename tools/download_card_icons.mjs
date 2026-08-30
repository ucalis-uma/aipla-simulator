#!/usr/bin/env node
/**
 * カードアイコン一括ダウンロード（Phase 7.5: 完全オフライン対応）。
 *
 * data/cards.json の全カードを INFO PRIDE CDN（idoly-ac.outv.im）から
 * dist/images/cards/ へ JPEG で保存する:
 *   - img_card_thumb_1_{suffix}.jpg   開花後（全カード対象）
 *   - img_card_thumb_0_{suffix}.jpg   未開花（initialRarity < 5 のカードのみ）
 *   - img_card_thumb_2_{suffix}.jpg   絆覚醒（id に "-link-" を含むカードのみ）
 *
 * CDN は 308 で Cloudinary（f_auto/webp）へリダイレクトされるため、最終 URL の
 * f_auto→f_jpg 書き換えで真の JPEG（image/jpeg）を取得する
 * （実測: https://res.cloudinary.com/dwgvzwmqu/image/upload/f_jpg/ipri/assets/img/card/thumb_1_{suffix}.jpg
 *   が image/jpeg を返す。f_jpg 取得失敗時は f_auto の生バイトを保存 —
 *   ブラウザ/WebView2 は拡張子でなく内容でデコードするため表示可能）。
 *
 * 同時実行 8・リトライ 3 回（指数バックオフ・404 はリトライせず notfound 集計）・
 * 既存ファイルはスキップ（再実行可能）。
 *
 * 実行: npm run download:icons
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "dist", "images", "cards");
const accOutDir = path.join(repoRoot, "dist", "images", "accessories");
const CDN = "https://idoly-ac.outv.im/api/img/";
const CONCURRENCY = 8;
const RETRIES = 3;
const UA = "aipura-score-calc-icon-downloader/1.0 (fan-made offline tool)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 単発 fetch（呼び出し側でリトライ制御） */
function fetchOnce(url) {
  return fetch(url, { redirect: "follow", headers: { "user-agent": UA } });
}

/** リトライ付き fetch（404 は null を返す＝リトライ不要） */
async function fetchWithRetry(url, attempts = RETRIES) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    let res;
    try {
      res = await fetchOnce(url);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(500 * 2 ** i);
      continue;
    }
    if (res.status === 404 || res.status === 400) {
      console.error(`[nf] HTTP ${res.status} url=${url}`);
      return null; // アセット未収録（リトライ不要）
    }
    if (res.ok) return res;
    lastErr = new Error(`HTTP ${res.status} for ${url}`);
    if (i < attempts - 1) await sleep(500 * 2 ** i);
  }
  throw lastErr;
}

/** 1 画像のダウンロード。返値: "ok" | "skip" | "notfound" */
async function downloadOne(job) {
  const file = path.join(job.dir ?? outDir, job.file);
  if (existsSync(file) && statSync(file).size > 0) return "skip";

  // 1) CDN（308 → Cloudinary を追跡して最終 URL を取得）
  const first = await fetchWithRetry(CDN + job.asset);
  if (first === null) return "notfound";
  if (finalUrlCache.size < 8) finalUrlCache.set(job.v, first.url); // パターン確認用（デバッグ出力）

  // 2) f_jpg 書き換えで真の JPEG を取得（失敗時は f_auto の生バイト）
  let buf;
  try {
    const res2 = await fetchWithRetry(first.url.replace("/f_auto/", "/f_jpg/"));
    if (res2 === null) throw new Error("f_jpg 404");
    const type = res2.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) throw new Error(`not image: ${type}`);
    buf = Buffer.from(await res2.arrayBuffer());
  } catch {
    buf = Buffer.from(await first.arrayBuffer());
  }
  if (buf.byteLength < 100) throw new Error(`too small: ${buf.byteLength} bytes`);
  writeFileSync(file, buf);
  return "ok";
}

const finalUrlCache = new Map();

function buildJobs() {
  const cards = JSON.parse(readFileSync(path.join(repoRoot, "data/cards.json"), "utf-8")).cards;
  const jobs = [];
  for (const c of cards) {
    // CDN リクエスト先はマスタの assetId（card-ktn-02-casl-00 → "ktn-02-eve-00" のように
    // id サフィックスと不一致が 4 枚あるため assetId を必須で使用）。
    // job.asset は「img_card_thumb_{v}_」接頭辞を含む完全なアセット名（downloadOne が
    // CDN + job.asset をそのまま要求するため）。保存ファイル名は UI（cardThumbSources）と
    // 同一基準の assetSuffix。
    const assetSuffix = c.assetId || (c.id.startsWith("card-") ? c.id.slice(5) : c.id);
    jobs.push({
      v: 1,
      asset: `img_card_thumb_1_${assetSuffix}`,
      file: `img_card_thumb_1_${assetSuffix}.jpg`,
      cardId: c.id,
      assetSuffix,
    });
    if (c.initialRarity < 5) {
      jobs.push({
        v: 0,
        asset: `img_card_thumb_0_${assetSuffix}`,
        file: `img_card_thumb_0_${assetSuffix}.jpg`,
        cardId: c.id,
        assetSuffix,
      });
    }
    if (c.id.includes("-link-")) {
      jobs.push({
        v: 2,
        asset: `img_card_thumb_2_${assetSuffix}`,
        file: `img_card_thumb_2_${assetSuffix}.jpg`,
        cardId: c.id,
        assetSuffix,
      });
    }
  }
  return jobs;
}

/**
 * アクセサリのジョブ（全 36 種＝6 分類 × ティア a-f）。
 * CDN パターン: img_acc_thumb_{assetId}（実測 200 → ipri/assets/img/acc/thumb_{assetId}.webp）。
 * assetId 一覧は data/accessories.json から導出（=dance/mental/stamina/technique/visual/vocal × a-f）。
 */
function buildAccessoryJobs() {
  const acc = JSON.parse(readFileSync(path.join(repoRoot, "data/accessories.json"), "utf-8")).accessories;
  const assetIds = [...new Set(acc.map((a) => a.assetId).filter((s) => typeof s === "string" && s !== ""))].sort();
  return assetIds.map((assetId) => ({
    dir: accOutDir,
    asset: `img_acc_thumb_${assetId}`,
    file: `img_acc_thumb_${assetId}.jpg`,
    cardId: "",
    assetSuffix: assetId,
  }));
}

async function main() {
  const accJobs = buildAccessoryJobs();
  const jobs = [...buildJobs(), ...accJobs];
  mkdirSync(outDir, { recursive: true });
  mkdirSync(accOutDir, { recursive: true });
  console.log(
    `jobs: ${jobs.length} (cards ${jobs.length - accJobs.length} + accessories ${accJobs.length}) -> dist/images/{cards,accessories}`,
  );

  const counts = { ok: 0, skip: 0, notfound: 0, fail: 0 };
  const failures = [];
  let idx = 0;
  let done = 0;
  const worker = async () => {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      try {
        counts[await downloadOne(job)] += 1;
      } catch (e) {
        counts.fail += 1;
        failures.push(`${job.file}: ${e instanceof Error ? e.message : String(e)}`);
      }
      done += 1;
      if (done % 50 === 0 || done === jobs.length) {
        console.log(`  ${done}/${jobs.length} (ok=${counts.ok} skip=${counts.skip} notfound=${counts.notfound} fail=${counts.fail})`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`done: ok=${counts.ok} skip=${counts.skip} notfound=${counts.notfound} fail=${counts.fail}`);
  for (const f of finalUrlCache.values()) {
    console.log(`resolved pattern example: ${f}`);
  }
  if (failures.length > 0) {
    console.error("failures:");
    for (const f of failures.slice(0, 20)) console.error(`  ${f}`);
    if (failures.length > 20) console.error(`  ... and ${failures.length - 20} more`);
    process.exit(1);
  }
  if (counts.notfound > 0) {
    console.warn(
      `※ notfound ${counts.notfound} 件は CDN に存在しない画像です（UI は属性色バッジへフォールバックします）`,
    );
  }
}

await main();

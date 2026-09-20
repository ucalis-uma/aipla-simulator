import fs from 'fs';
import path from 'path';

const extractedDir = 'c:/Users/umaro/Documents/アイプラ/research/25_buff_audit/extracted_t5';
const v2Path = 'c:/Users/umaro/Documents/アイプラ/スコア分析サンプル/measured_data_v2.json';
const v3Path = 'c:/Users/umaro/Documents/アイプラ/スコア分析サンプル/measured_data_v3.json';

// 1. 全48ファイルの読み込みとビート別マージ
const laneBeats = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} };

const files = fs.readdirSync(extractedDir).filter(f => f.endsWith('.json') && f !== 'manifest.json');
console.log(`Found ${files.length} chunk files in ${extractedDir}`);

for (const f of files) {
  const match = f.match(/lane(\d)_b(\d+)_b(\d+)\.json/);
  if (!match) {
    console.warn(`Skipping unmatched file: ${f}`);
    continue;
  }
  const lane = parseInt(match[1], 10);
  const content = JSON.parse(fs.readFileSync(path.join(extractedDir, f), 'utf-8'));
  
  for (const item of content) {
    const beat = item.beat;
    if (laneBeats[lane][beat] !== undefined) {
      console.warn(`Duplicate beat data: lane ${lane}, beat ${beat} in ${f}`);
    }
    laneBeats[lane][beat] = item.effects;
  }
}

// 2. 欠損チェック (0〜156)
let missingCount = 0;
for (let lane = 1; lane <= 5; lane++) {
  const missing = [];
  for (let b = 0; b <= 156; b++) {
    if (laneBeats[lane][b] === undefined) {
      missing.push(b);
      missingCount++;
    }
  }
  console.log(`Lane ${lane}: ${Object.keys(laneBeats[lane]).length}/157 beats present. Missing: ${missing.length > 0 ? missing.join(',') : 'none'}`);
}

if (missingCount > 0) {
  console.error(`ERROR: ${missingCount} beats are missing across lanes! Aborting.`);
  process.exit(1);
}

// 3. measured_data_v2.json を読み込み、timeline を更新
const v2Data = JSON.parse(fs.readFileSync(v2Path, 'utf-8'));
const v3Data = JSON.parse(JSON.stringify(v2Data)); // deep clone

// メタデータの更新
v3Data.v3_meta = {
  created_at: new Date().toISOString(),
  description: "T5 measured data with full 5-lane buff snapshots re-extracted via multi-modal vision subagents",
  source_images_count: 1060,
  lanes_coverage: "Lane 1-5, Beats 0-156 fully extracted"
};

let updatedLanesCount = 0;
let totalEffectsCount = 0;

for (let b = 0; b <= 156; b++) {
  const timelineItem = v3Data.timeline[b];
  if (!timelineItem) {
    console.error(`ERROR: timeline item for beat ${b} not found in v2Data!`);
    process.exit(1);
  }
  
  for (let lane = 1; lane <= 5; lane++) {
    const effects = laneBeats[lane][b];
    timelineItem.lanes[lane].effects = effects;
    updatedLanesCount++;
    totalEffectsCount += effects.length;
  }
}

console.log(`Updated ${updatedLanesCount} lane-beat records.`);
console.log(`Total effects recorded across all lanes: ${totalEffectsCount}`);

// 4. measured_data_v3.json の書き出し
fs.writeFileSync(v3Path, JSON.stringify(v3Data, null, 2), 'utf-8');
console.log(`Successfully generated ${v3Path} (size: ${(fs.statSync(v3Path).size / 1024 / 1024).toFixed(2)} MB)`);

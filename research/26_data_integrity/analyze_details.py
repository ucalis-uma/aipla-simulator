import json
import os

d1 = json.load(open('research/26_data_integrity/diff_s1_v2.json', 'r', encoding='utf-8'))
print("=== S1 Non-PHASE_LAG Diffs ===")
for r in d1['diffs']:
    if 'PHASE_LAG' not in r['note']:
        print(f"b{r['beat']} L{r['lane']} {r['key']}: meas={r['measured_stage']}, sim={r['sim_stage']}, diff={r['diff']} | {r['note']}")

d3 = json.load(open('research/26_data_integrity/diff_s3_v2.json', 'r', encoding='utf-8'))
print("\n=== S3 Diff Samples (first 30) ===")
for r in d3['diffs'][:30]:
    print(f"b{r['beat']} L{r['lane']} {r['key']}: meas={r['measured_stage']}, sim={r['sim_stage']}, diff={r['diff']} | {r['note']}")

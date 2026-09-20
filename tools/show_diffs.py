import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
with open('research/25_buff_audit/diff_t5_v3.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print(f"Total diffs: {len(data['diffs'])}")
for d in data['diffs']:
    cat = d['note'].split(':')[0]
    if cat in ['BUFF_STAGE_MISMATCH', 'AMPLIFY_OR_OVERLAP_ON_BEAT', 'DECAY_TIMING_LAG']:
        print(f"b{d['beat']:03d} L{d['lane']} {d['key']}: meas={d['measured_stage']} vs sim={d['sim_stage']} (diff={d['diff']:+d}) | {cat} | {d['note']}")

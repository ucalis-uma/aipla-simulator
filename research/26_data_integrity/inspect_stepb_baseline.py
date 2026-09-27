"""ステップB ベースライン: 現行 diff の不一致詳細を一覧化"""
import json
import sys
from collections import Counter

sys.stdout.reconfigure(encoding='utf-8')

TARGETS = ('BUFF_STAGE_MISMATCH', 'DECAY_TIMING_LAG', 'AMPLIFY_OR_OVERLAP_ON_BEAT')

for name, path in [
    ('S1', 'research/26_data_integrity/diff_s1_v2.json'),
    ('S3', 'research/26_data_integrity/diff_s3_v2.json'),
    ('T5', 'research/25_buff_audit/diff_t5_v3.json'),
]:
    d = json.load(open(path, encoding='utf-8'))
    diffs = d['diffs']
    print(f'=== {name}: {len(diffs)} diffs ===')
    cats = Counter(x['note'].split(':')[0] for x in diffs)
    print(dict(cats))
    for x in diffs:
        cat = x['note'].split(':')[0]
        if cat in TARGETS:
            print(f"  b{x['beat']} L{x['lane']} {x['key']} m={x['measured_stage']} s={x['sim_stage']} :: {x['note'][:130]}")
    print()

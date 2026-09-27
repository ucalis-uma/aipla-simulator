# -*- coding: utf-8 -*-
"""S3 b58-b62: 全レーンの v2 生実測効果 + sim スナップショット"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

meas2 = json.load(open('../aipura_nox/サンプル3/measured_data_v2.json', encoding='utf-8'))
tl = {b['beat']: b for b in meas2['timeline']}
sim = json.load(open('research/21_sample3_gap_analysis/sim_trace_full.json', encoding='utf-8'))

for b in range(58, 63):
    print(f'=== b{b} ===')
    for lane in '12345':
        effs = [(e['name'], e.get('stage')) for e in tl.get(b, {}).get('lanes', {}).get(lane, {}).get('effects', [])]
        print(f'  L{lane} v2: {effs}')
    for lane in range(1, 6):
        s = {k: v for k, v in sim['beats'][b - 1]['buffSnapshots'][lane - 1].items() if v}
        print(f'  L{lane} sim: {s}')

# -*- coding: utf-8 -*-
"""S3 L4: v2 生データの b52-b72 効果一覧（パッチ前の原本）"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

meas2 = json.load(open('../aipura_nox/サンプル3/measured_data_v2.json', encoding='utf-8'))
tl = {b['beat']: b for b in meas2['timeline']}
for b in range(52, 72):
    lane = tl.get(b, {}).get('lanes', {}).get('4', {})
    effs = [(e['name'], e.get('stage')) for e in lane.get('effects', [])]
    print(f'b{b}: {effs}')

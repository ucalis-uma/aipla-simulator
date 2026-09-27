# -*- coding: utf-8 -*-
"""ステップB 調査用: S3 怜P3 の発動系列 + L4 skill_success_up 推移"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

sim = json.load(open('research/21_sample3_gap_analysis/sim_trace_full.json', encoding='utf-8'))
meas = json.load(open('research/26_data_integrity/measured_data_s3_v3.json', encoding='utf-8'))
tl = {b['beat']: b for b in meas['timeline']}

print('=== sk-rei-05-fest-01-3 firings ===')
for b in sim['beats']:
    for a in b.get('activations', []):
        if a.get('skillId') == 'sk-rei-05-fest-01-3':
            print(f"b{b['beat']}: {a.get('phase')} ok={a.get('success')} fail={a.get('failReason')}")

print()
print('=== L4 skill_success_up sim vs meas (b1-b75 transitions) ===')
prev_s = prev_m = None
for b in range(1, 76):
    s = sim['beats'][b - 1]['buffSnapshots'][3].get('skill_success_up', 0)
    m_effs = {e['name']: e.get('stage') for e in tl.get(b, {}).get('lanes', {}).get('4', {}).get('effects', [])}
    m = m_effs.get('スキル成功率上昇', 0)
    if s != prev_s or m != prev_m:
        acts = ', '.join(
            f"{a['skillId']}(L{a['lane']},{a.get('phase')})"
            for a in sim['beats'][b - 1].get('activations', []) if a.get('success')
        )
        print(f'b{b}: sim {prev_s}->{s} | meas {prev_m}->{m} | {acts}')
        prev_s, prev_m = s, m

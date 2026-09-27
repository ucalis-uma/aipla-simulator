# -*- coding: utf-8 -*-
"""T5: vocal_boost 付与源スキルの発動系列 + L3 vb/vu 全推移"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

sim = json.load(open('research/25_buff_audit/t5_sim_trace_full.json', encoding='utf-8'))

WATCH = {'sk-ski-05-onep-00-3', 'photo-L2-1', 'sk-ski-05-onep-00-2', 'sk-ski-05-waso-00-3', 'sk-ski-05-waso-00-2'}
print('=== firings of vocal_boost-related skills ===')
for b in sim['beats']:
    for a in b.get('activations', []):
        if a.get('skillId') in WATCH:
            print(f"b{b['beat']}: {a['skillId']} L{a['lane']} {a.get('phase')} ok={a.get('success')} fail={a.get('failReason')}")

print()
print('=== L3 vb/vu transitions (full) ===')
prev = None
for b in sim['beats']:
    n = b['beat']
    snap = b['buffSnapshots'][2]
    key = (snap.get('vocal_boost', 0), snap.get('vocal_up', 0))
    if key != prev:
        acts = ', '.join(
            f"{a['skillId']}(L{a['lane']},{a.get('phase')})"
            for a in b.get('activations', []) if a.get('success')
        )
        print(f"b{n}: L3 (vb,vu) {prev}->{key} | {acts}")
        prev = key

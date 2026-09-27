# -*- coding: utf-8 -*-
"""T5 L3 vocal_boost の構成調査: golden スキル/フォトの vocal_boost/vocal_up 系効果と発動系列"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

golden = json.load(open('data/skills_golden.json', encoding='utf-8'))['skills']
print('=== T5 golden skills with vocal_boost/vocal_up/amplify/extension ===')
for s in golden:
    for e in s.get('effects', []):
        if e['type'] in ('vocal_boost', 'vocal_up', 'effect_amplify', 'effect_extension', 'vocal_up_extreme'):
            print(f"{s['id']} L{s.get('lane')} {s.get('kind')} '{s.get('name')}': "
                  f"{e['type']} tgt={e['target']} cond={e.get('condition')} dur={e.get('durationBeats')} st={e.get('stages')} val={e.get('value')}")

print()
print('=== T5 sim trace: L3 vocal_boost transitions b60-b115 ===')
sim = json.load(open('research/25_buff_audit/t5_sim_trace_full.json', encoding='utf-8'))
prev = None
for b in sim['beats']:
    n = b['beat']
    if n < 60 or n > 115:
        continue
    vb = b['buffSnapshots'][2].get('vocal_boost', 0)
    vu = b['buffSnapshots'][2].get('vocal_up', 0)
    if vb != prev:
        acts = ', '.join(
            f"{a['skillId']}(L{a['lane']},{a.get('phase')})"
            for a in b.get('activations', []) if a.get('success')
        )
        print(f"b{n}: L3 vb {prev}->{vb} (vu={vu}) | acts: {acts}")
        prev = vb

print()
print('=== measured v3 L3 ボーカルブースト transitions b60-b115 ===')
meas = json.load(open('スコア分析サンプル/measured_data_v3.json', encoding='utf-8'))
tl = {b['beat']: b for b in meas['timeline']}
prev = None
for b in range(60, 116):
    effs = {e['name']: e.get('stage') for e in tl.get(b, {}).get('lanes', {}).get('3', {}).get('effects', [])}
    vb = effs.get('ボーカルブースト', 0)
    if vb != prev:
        print(f'b{b}: meas L3 vb {prev}->{vb}')
        prev = vb

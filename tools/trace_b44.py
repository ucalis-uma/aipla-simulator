import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
with open('research/25_buff_audit/t5_sim_trace_full.json', 'r', encoding='utf-8') as f:
    trace = json.load(f)

print("=== Check b44 L3 score_up activations ===")
for b in trace['beats']:
    beat = b['beat']
    for a in b['activations']:
        if a['success']:
            # check if gives score_up to lane 3
            pass
    snap = b['buffSnapshots'][2] # Lane 3
    if 'score_up' in snap:
        if beat in [42, 43, 44, 45, 46]:
            print(f"Beat {beat}: L3 score_up = {snap.get('score_up')}")

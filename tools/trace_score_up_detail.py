import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
with open('research/25_buff_audit/t5_sim_trace_full.json', 'r', encoding='utf-8') as f:
    trace = json.load(f)

# Let's inspect beat 1 to 50
for b in trace['beats']:
    beat = b['beat']
    if beat > 46:
        continue
    # Let's see all activations on this beat
    acts = [f"{a['skillId']}({a['kind']},{a['phase']})" for a in b['activations'] if a['success']]
    l3_snap = b['buffSnapshots'][2]
    su = l3_snap.get('score_up', 0)
    print(f"Beat {beat:02d}: L3 score_up={su} | acts={acts}")

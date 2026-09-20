import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
with open('research/25_buff_audit/t5_sim_trace_full.json', 'r', encoding='utf-8') as f:
    trace = json.load(f)

for b in trace['beats']:
    for a in b['activations']:
        # print all activations up to beat 45
        if b['beat'] <= 45:
            # check skills that give score_up
            sid = a['skillId']
            if any(k in sid for k in ['photo', 'yu', 'ski', 'chs', 'ktn']):
                # let's see which skill gives score_up
                pass
            if 'score_up' in sid or 'photo-L1-1' in sid or 'photo-L1-2' in sid or 'wedd' in sid:
                print(f"Beat {b['beat']} [{a['phase']}]: {a['kind']} {sid}")

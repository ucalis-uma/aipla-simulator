"""S3 b20-b30: Sim trace (activations + L3/L4 buffs) と measured v3 の照合"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

sim = json.load(open('research/21_sample3_gap_analysis/sim_trace_full.json', encoding='utf-8'))
meas = json.load(open('research/26_data_integrity/measured_data_s3_v3.json', encoding='utf-8'))

sim_beats = {b['beat']: b for b in sim['beats']}
meas_tl = {b['beat']: b for b in meas['timeline']}

for b in range(20, 32):
    sb = sim_beats.get(b, {})
    acts = sb.get('activations', [])
    act_str = ', '.join(f"{a.get('skillId')}(L{a.get('lane')})" for a in acts)
    snaps = sb.get('buffSnapshots', [])
    print(f"--- b{b} ---")
    if act_str:
        print(f"  acts: {act_str}")
    for lane in (3, 4):
        s_snap = {k: v for k, v in snaps[lane - 1].items() if v} if snaps else {}
        m_effs = {e['name']: e.get('stage') for e in meas_tl.get(b, {}).get('lanes', {}).get(str(lane), {}).get('effects', [])}
        print(f"  L{lane} sim: {s_snap}")
        print(f"  L{lane} mea: {m_effs}")

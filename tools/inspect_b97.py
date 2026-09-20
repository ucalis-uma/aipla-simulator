import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
with open('スコア分析サンプル/measured_data_v3.json', 'r', encoding='utf-8') as f:
    meas = json.load(f)

with open('research/25_buff_audit/t5_sim_trace_full.json', 'r', encoding='utf-8') as f:
    sim = json.load(f)

meas_map = {b['beat']: b for b in meas['timeline']}
sim_map = {b['beat']: b for b in sim['beats']}

print("=== Beat 95 to 101: Lane 1 stamina_cost_down ===")
for b in range(95, 102):
    m_effs = meas_map.get(b, {}).get('lanes', {}).get('1', {}).get('effects', [])
    m_scd = next((e['stage'] for e in m_effs if '消費スタミナ低下' in e['name']), 0)
    s_scd = sim_map.get(b, {}).get('buffSnapshots', [{}])[0].get('stamina_cost_down', 0)
    print(f"Beat {b:03d}: meas={m_scd} vs sim={s_scd}")

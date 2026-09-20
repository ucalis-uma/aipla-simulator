import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
with open('スコア分析サンプル/measured_data_v3.json', 'r', encoding='utf-8') as f:
    meas = json.load(f)

for item in meas['timeline']:
    if item['beat'] in [30, 31, 32, 33, 38, 39, 40]:
        print(f"Beat {item['beat']}:")
        l2 = item['lanes']['2']['effects']
        for eff in l2:
            print(f"  L2 {eff['name']}: {eff['stage']}段")
        l5 = item['lanes']['5']['effects']
        for eff in l5:
            print(f"  L5 {eff['name']}: {eff['stage']}段")

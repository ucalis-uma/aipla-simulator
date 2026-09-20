import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
with open('スコア分析サンプル/measured_data_v3.json', 'r', encoding='utf-8') as f:
    meas = json.load(f)

for item in meas['timeline']:
    if item['beat'] in [42, 43, 44, 45]:
        print(f"Beat {item['beat']}:")
        l3 = item['lanes']['3']['effects']
        for eff in l3:
            if 'スコア' in eff['name']:
                print(f"  {eff['name']}: {eff['stage']}段")

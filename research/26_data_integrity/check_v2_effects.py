import json, sys
sys.stdout.reconfigure(encoding='utf-8')

meas3 = json.load(open('../aipura_nox/サンプル3/measured_data_v2.json', 'r', encoding='utf-8'))
for b in meas3['timeline']:
    if b['beat'] in [48, 49, 50, 66, 67]:
        effs = b['lanes']['3']['effects']
        names = [e['name'] + str(e.get('stage')) for e in effs]
        print(f"b{b['beat']} L3: {names}")

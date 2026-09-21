"""
research/26_data_integrity/verify_against_sim.py
"""
import os
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
trace_p = os.path.join(REPO_ROOT, "research/21_sample3_gap_analysis/sim_trace_full.json")
trace = json.load(open(trace_p, "r", encoding="utf-8"))

for b in trace["beats"]:
    if b["beat"] == 24:
        print(f"Beat 24 buffSnapshots:")
        print("Lane 3 (index 2):")
        for k, v in b["buffSnapshots"][2].items():
            if v and (isinstance(v, dict) and (v.get("grade", 0) > 0 or v.get("amount", 0) > 0)):
                print(f"  {k}: {v}")
            elif v and not isinstance(v, dict):
                print(f"  {k}: {v}")
        print("Lane 4 (index 3):")
        for k, v in b["buffSnapshots"][3].items():
            if v and (isinstance(v, dict) and (v.get("grade", 0) > 0 or v.get("amount", 0) > 0)):
                print(f"  {k}: {v}")
            elif v and not isinstance(v, dict):
                print(f"  {k}: {v}")
        break

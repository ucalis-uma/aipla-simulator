import json
import os

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

sim3 = json.load(open(os.path.join(REPO_ROOT, "research/21_sample3_gap_analysis/sim_trace_full.json"), "r", encoding="utf-8"))
meas3 = json.load(open(os.path.join(REPO_ROOT, "../aipura_nox/サンプル3/measured_data_v2.json"), "r", encoding="utf-8"))

print("=== S3 L3 Focus & ScoreUp b20-b35 ===")
for b in range(20, 36):
    sb = next((x for x in sim3["beats"] if x["beat"] == b), None)
    mb = next((x for x in meas3["timeline"] if x["beat"] == b), None)
    s_snap = sb["buffSnapshots"][2] if sb else {}
    m_effs = mb["lanes"]["3"]["effects"] if mb and "3" in mb["lanes"] else []
    m_focus = next((e["stage"] for e in m_effs if e["name"] == "集目"), 0)
    m_score = next((e["stage"] for e in m_effs if e["name"] == "スコア上昇"), 0)
    acts = [a["skillId"] for a in sb["activations"]] if sb else []
    print(f"b{b:02d}: Sim(f={s_snap.get('focus', 0)}, s={s_snap.get('score_up', 0)}) | Meas(f={m_focus}, s={m_score}) | acts={acts}")

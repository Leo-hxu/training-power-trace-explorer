"""Print the README "Dataset inventory" section from a public catalog.json.

Usage: python scripts/catalog_inventory.py <catalog.json>
Numbers match the explorer's Dataset card (#/dataset), which computes them from the same catalog.
"""
import json
import sys
from collections import Counter, defaultdict
from statistics import median

sys.stdout.reconfigure(encoding="utf-8")
runs = json.load(open(sys.argv[1], encoding="utf-8"))


def gpus(r):
    return int(r.get("gpu_count") or r.get("num_gpus_observed") or 0)


def dur(r):
    return float(r.get("duration_observed_s") or 0)


FAMILIES = [("gemma", "Gemma"), ("qwen", "Qwen"), ("llama", "Llama"), ("mixtral", "Mistral"), ("mistral", "Mistral"),
            ("deepseek", "DeepSeek"), ("gpt2", "GPT-2"), ("gpt-j", "GPT-J"), ("gpt-neox", "GPT-NeoX"), ("pythia", "Pythia")]


def family(r):
    """Family from the model id (the catalog's model_family field is not filled for every source)."""
    name = (r.get("model") or "").lower()
    return next((f for key, f in FAMILIES if key in name), r.get("model_family") or "Other")


def table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    out += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(out)


total_h = sum(map(dur, runs)) / 3600
gpu_h = sum(dur(r) * gpus(r) for r in runs) / 3600
models = {r["model"] for r in runs}
configs = {(r["workload_type"], r["model"], r["gpu_type"], gpus(r)) for r in runs}
wl = Counter(r["workload_type"] for r in runs)

print("## Dataset inventory\n")
print(f"The public release contains **{len(runs)} GPU power traces** "
      f"({', '.join(f'{n} {w.lower()}' for w, n in sorted(wl.items(), reverse=True))}) "
      f"covering **{len(models)} models** and **{len(configs)} distinct configurations** "
      f"(workload × model × GPU type × GPU count), with **{total_h:.1f} h** of wall-clock telemetry "
      f"and **{gpu_h:.0f} GPU-hours**. The live, filterable version of these tables is the explorer's "
      f"[Dataset card](https://leo-hxu.github.io/training-power-trace-explorer/#/dataset).\n")

print("### Runs by workload and GPU platform\n")
groups = defaultdict(list)
for r in runs:
    groups[(r["workload_type"], r["gpu_type"], gpus(r))].append(r)
print(table(["Workload", "GPU", "GPUs / run", "Runs", "Models", "Hours"],
            [(w, g, n, len(rs), len({r['model'] for r in rs}), f"{sum(map(dur, rs)) / 3600:.1f}")
             for (w, g, n), rs in sorted(groups.items(), key=lambda kv: (kv[0][0] != "Training", kv[0][1], kv[0][2]))]))

print("\n### Model families\n")
fam = defaultdict(list)
for r in runs:
    fam[(r["workload_type"], family(r))].append(r)
print(table(["Workload", "Model family", "Runs", "Models", "GPU types"],
            [(w, f, len(rs), len({r['model'] for r in rs}), ", ".join(sorted({r['gpu_type'] for r in rs})))
             for (w, f), rs in sorted(fam.items(), key=lambda kv: (kv[0][0] != "Training", -len(kv[1])))]))

print("\n### Trace durations and sampling\n")
sub = defaultdict(list)
for r in runs:
    sub[(r["workload_type"], r["source_family"])].append(r)
rows = []
for (w, s), rs in sorted(sub.items(), key=lambda kv: (kv[0][0] != "Training", kv[0][1])):
    d = sorted(dur(r) / 60 for r in rs)
    iv = [float(r["sampling_interval_observed_median_s"]) for r in rs if r.get("sampling_interval_observed_median_s") is not None]
    rows.append((w, s, len(rs), f"{d[0]:.1f}", f"{median(d):.1f}", f"{d[-1]:.1f}", f"{median(iv):.2f}" if iv else "—"))
print(table(["Workload", "Source", "Runs", "Min (min)", "Median (min)", "Max (min)", "Median interval (s)"], rows))

print("\n### Telemetry availability\n")
CH = [("Power", None, "power_w"), ("GPU utilization", "has_utilization_telemetry", "gpu_util_pct"),
      ("SM clock", "has_clock_telemetry", "sm_clock_mhz"), ("Temperature", "has_temperature_telemetry", "temperature_c"),
      ("Memory used", None, "memory_used_mb"), ("Stage labels", "has_stage_labels", "stage")]
rows = []
for label, flag, miss in CH:
    absent = sum(1 for r in runs if miss in (r.get("missing_fields") or []) or (flag and r.get(flag) is False))
    unknown = sum(1 for r in runs if flag and r.get(flag) is None and miss not in (r.get("missing_fields") or []))
    rows.append((label, len(runs) - absent - unknown, absent, unknown))
print(table(["Channel", "Present", "Absent", "Not stated"], rows))
inf = [r for r in runs if r["workload_type"] == "Inference"]
tl = sum(1 for r in inf if r.get("request_timeline_method"))
print(f"\nInference demand: {tl} of {len(inf)} inference runs include a time-binned request series aligned to the power trace; "
      "raw per-request event logs are not released.")

print("\n### Quality tiers\n")
q = Counter((r["quality_status"], r["source_family"]) for r in runs)
print(table(["Tier", "Source", "Runs"], [(t, s, n) for (t, s), n in sorted(q.items())]))
print("\nOnly runs that pass automated integrity checks and release review are published. "
      "Fixed, configuration-grouped train/validation/test splits (v1) are listed per run in the explorer and downloadable as `splits.json`.")

from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def assess_quality(
    trace_path: Path,
    info: dict[str, Any],
    records: list[dict[str, Any]],
    metrics: dict[str, Any],
) -> tuple[str, list[dict[str, str]]]:
    flags: list[dict[str, str]] = []

    def flag(code: str, severity: str, message: str) -> None:
        flags.append({"code": code, "severity": severity, "message": message})

    if not trace_path.exists():
        flag("missing_trace", "error", "Trace file is not present at the cataloged path.")
    if not info.get("meta_path"):
        flag("missing_metadata", "warning", "No metadata or manifest file was found beside the trace.")
    for label, field in (("stdout", "stdout_path"), ("stderr", "stderr_path")):
        path_value = info.get(field)
        if not path_value:
            flag(f"missing_{label}", "info", f"No {label} file was declared for this run.")
        elif not Path(str(path_value)).expanduser().exists():
            flag(f"missing_{label}", "warning", f"Declared {label} file was not found.")
    if not records:
        flag("schema_mismatch", "error", "No valid normalized power samples were parsed.")
        return "Error", flags

    times = [float(row["time_relative_s"]) for row in records]
    if any(right < left for left, right in zip(times, times[1:])):
        flag("non_monotonic_timestamp", "error", "Input rows contain non-monotonic timestamps.")

    median = metrics.get("sampling_interval_observed_median_s")
    p95 = metrics.get("sampling_interval_observed_p95_s")
    if median and p95 and p95 > median * 2.5:
        flag("irregular_sampling", "warning", "Observed p95 sampling interval is more than 2.5× the median.")
    unique_times = sorted(set(times))
    if median and any((b - a) > max(median * 8, 2) for a, b in zip(unique_times, unique_times[1:])):
        flag("large_timestamp_gap", "warning", "At least one large timestamp gap was detected.")

    powers = [float(row["power_w"]) for row in records if row.get("power_w") is not None]
    if any(power == 0 for power in powers):
        flag("zero_power_samples", "warning", "One or more zero-power samples were recorded.")
    if any(power < 0 or power > 2000 for power in powers):
        flag("implausible_power_samples", "error", "Power values outside the 0–2000 W validation range were found.")

    gpu_ids = {str(row.get("gpu_id")) for row in records}
    declared_gpu_count = info.get("gpu_count")
    try:
        if declared_gpu_count not in (None, "Unknown") and int(declared_gpu_count) != len(gpu_ids):
            flag("gpu_count_mismatch", "warning", "Declared GPU count differs from observed GPU IDs.")
    except (TypeError, ValueError):
        flag("gpu_count_mismatch", "warning", "Declared GPU count could not be interpreted.")

    by_time: dict[float, set[str]] = defaultdict(set)
    for row in records:
        by_time[float(row["time_relative_s"])].add(str(row.get("gpu_id")))
    incomplete = sum(1 for ids in by_time.values() if len(ids) < len(gpu_ids))
    if by_time and incomplete / len(by_time) > 0.05:
        flag("missing_gpu_samples", "warning", "More than 5% of timestamps are missing at least one observed GPU.")

    duplicate_counts = Counter((row.get("timestamp"), str(row.get("gpu_id"))) for row in records)
    if any(count > 1 for count in duplicate_counts.values()):
        flag("duplicate_samples", "warning", "Duplicate timestamp/GPU pairs were detected.")
    if str(info.get("precision", "Unknown")) == "Unknown" and str(info.get("compute_dtype", "Unknown")) == "Unknown":
        flag("unknown_precision", "info", "Precision and compute dtype are not confirmed.")
    if str(info.get("gpu_type", "Unknown")) == "Unknown":
        flag("unknown_gpu_type", "info", "GPU type is not confirmed.")

    severities = {item["severity"] for item in flags}
    if "error" in severities:
        return "Error", flags
    if "warning" in severities:
        return "Warning", flags
    return "Good", flags

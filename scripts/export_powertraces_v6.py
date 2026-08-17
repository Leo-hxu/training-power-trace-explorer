#!/usr/bin/env python3
"""Build a reviewed GitHub Pages export from the repaired v6 PowerTraces corpus."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

DEFAULT_ANALYSIS_ROOT = Path("../training_analysis_v6")
CANONICAL_COLUMNS = [
    "run_id", "timestamp", "time_relative_s", "gpu_id", "power_w",
    "sm_clock_mhz", "gpu_util_pct", "memory_util_pct", "memory_used_mb",
    "memory_total_mb", "temperature_c", "stage",
]


def scalar(value: Any, default: Any = "Unknown") -> Any:
    if value is None or (not isinstance(value, (list, dict)) and pd.isna(value)):
        return default
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def number(value: Any, default: float = 0.0) -> float:
    value = scalar(value, default)
    return float(value) if value != "Unknown" else default


def slug(run_id: str) -> str:
    label = re.sub(r"[^A-Za-z0-9._-]+", "-", run_id).strip("-._").lower()
    digest = hashlib.sha256(run_id.encode()).hexdigest()[:10]
    return f"{label[:72]}-{digest}"


def json_ready(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: json_ready(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_ready(item) for item in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if pd.isna(value):
        return None
    return value


def choose_public_runs(runs: pd.DataFrame, samples_dir: Path) -> pd.DataFrame:
    candidates = runs[(runs.source_family == "PowerTraces") & (runs.quality_status == "PASS_MAIN")].copy()
    candidates["trace_key"] = candidates.aggregate_trace_path.str.extract(r"([0-9a-f]{16})")
    candidates["source_bytes"] = candidates.trace_key.map(lambda key: (samples_dir / f"{key}.parquet").stat().st_size)
    candidates["sample_rows"] = candidates.trace_key.map(lambda key: len(pd.read_parquet(samples_dir / f"{key}.parquet", columns=["gpu_id"])))
    candidates["duration_distance_s"] = (candidates["physical_duration_s"] - 1800.0).abs()
    stratified = (candidates.sort_values(["model_family", "gpu_type", "duration_distance_s", "maximum_gap_s", "run_id"])
                  .groupby(["model_family", "gpu_type"], as_index=False).first())
    extra = (candidates[~candidates.run_id.isin(stratified.run_id)]
             .sort_values(["duration_distance_s", "maximum_gap_s", "run_id"])
             .head(1))
    return pd.concat([stratified, extra], ignore_index=True)


def build_samples(frame: pd.DataFrame, public_run_id: str) -> pd.DataFrame:
    timestamps = pd.to_datetime(frame["timestamp_original_persisted"], errors="coerce")
    if timestamps.isna().any():
        raise ValueError("unparseable repaired wall-clock timestamp")
    result = pd.DataFrame({
        "run_id": public_run_id,
        "timestamp": timestamps.dt.strftime("%Y-%m-%dT%H:%M:%S.%f").str.rstrip("0").str.rstrip(".") + "Z",
        "time_relative_s": frame["time_relative_physical_s"].astype(float).round(6),
        "gpu_id": frame["gpu_id"].astype(str),
        "power_w": frame["power_w"].astype(float).round(4),
        "sm_clock_mhz": frame["sm_clock_mhz"],
        "gpu_util_pct": frame["gpu_util_pct"],
        "memory_util_pct": frame["memory_util_pct"],
        "memory_used_mb": None,
        "memory_total_mb": None,
        "temperature_c": frame["temperature_c"],
        "stage": None,
    })
    return result[CANONICAL_COLUMNS].sort_values(["time_relative_s", "gpu_id"], kind="stable")


def ramp_event_frequency(aggregate: pd.DataFrame) -> float:
    times = aggregate["time_s"].to_numpy(dtype=float)
    powers = aggregate["aggregate_power_w"].to_numpy(dtype=float)
    if len(times) < 2 or times[-1] <= times[0]:
        return 0.0
    anchors = times[times >= times[0] + 1.0]
    current = np.interp(anchors, times, powers)
    previous = np.interp(anchors - 1.0, times, powers)
    upward = current - previous
    upward = upward[upward >= 0]
    if len(upward) == 0:
        return 0.0
    threshold = float(np.percentile(upward, 95))
    duration_min = (times[-1] - times[0]) / 60.0
    return float(np.count_nonzero(upward >= threshold) / duration_min)


def public_model_fields(row: pd.Series) -> tuple[str, str, str]:
    """Prefer the audited full repository identifier over a source variant label."""
    model_repo = scalar(row.get("model_repo"))
    source_label = scalar(row.get("model_family"))
    if str(model_repo).strip().lower() not in {"", "unknown"}:
        return str(model_repo), source_label, "reported"
    return "Unknown", source_label, "not_reported"


def build_run(row: pd.Series, public_run_id: str, samples: pd.DataFrame, aggregate: pd.DataFrame) -> dict[str, Any]:
    model, model_source_label, model_metadata_status = public_model_fields(row)
    missing = [name for name, source in {
        "model": model if model_metadata_status == "reported" else "Unknown", "precision": row.get("launcher_mixed_precision"),
        "parallelism": None, "dataset_name": row.get("dataset_name"),
        "memory_used_mb": None, "memory_total_mb": None, "stage": None,
    }.items() if scalar(source) == "Unknown"]
    dp, tp, pp = (scalar(row.get(name)) for name in ("data_parallel_degree", "tensor_parallel_degree", "pipeline_parallel_degree"))
    parallelism = f"DP={dp}, TP={tp}, PP={pp}" if "Unknown" not in (dp, tp, pp) else "Unknown"
    duration_declared = number(row.get("duration_declared_s")) / 60 if scalar(row.get("duration_declared_s")) != "Unknown" else "Unknown"
    quality_flags = [{"code": "missing_optional_fields", "severity": "info", "message": "Optional telemetry or metadata fields are unavailable in the reviewed source."}] if missing else []
    return {
        "run_id": public_run_id, "workload_type": "Training", "source_family": "PowerTraces", "source_directory": "Public v6 reviewed export",
        "trace_path": f"raw/{public_run_id}.csv", "stdout_path": None, "stderr_path": None, "plot_path": None,
        "meta_path": f"metadata/{public_run_id}.json", "model": model,
        "model_source_label": model_source_label, "model_metadata_status": model_metadata_status,
        "model_family": scalar(row.get("model_family")), "method": scalar(row.get("training_method")),
        "gpu_type": scalar(row.get("gpu_type")), "gpu_count": scalar(row.get("gpu_count")),
        "precision": scalar(row.get("launcher_mixed_precision")), "compute_dtype": scalar(row.get("compute_dtype")),
        "quantization_bits": scalar(row.get("quantization_bits")), "parallelism": parallelism,
        "sequence_length": scalar(row.get("sequence_length")), "microbatch_size": scalar(row.get("microbatch_size")),
        "grad_accum_steps": scalar(row.get("grad_accum_steps")), "global_batch_size": scalar(row.get("global_batch_size")),
        "checkpoint_interval": scalar(row.get("checkpoint_interval")), "dataset_name": scalar(row.get("dataset_name")),
        "duration_declared_min": duration_declared, "duration_observed_s": round(number(row.get("physical_duration_s")), 6),
        "sampling_interval_declared_s": scalar(row.get("sampling_interval_declared_s")),
        "sampling_interval_observed_median_s": number(row.get("median_interval_s")),
        "sampling_interval_observed_p95_s": number(row.get("p95_interval_s")),
        "has_stage_labels": bool(row.get("has_stage_labels")), "has_clock_telemetry": bool(row.get("has_clock_telemetry")),
        "has_utilization_telemetry": bool(row.get("has_utilization_telemetry")),
        "has_temperature_telemetry": bool(row.get("has_temperature_telemetry")), "quality_status": scalar(row.get("quality_status")),
        "mean_total_power_w": number(row.get("mean_total_gpu_power_time_weighted_w")),
        "p95_total_power_w": number(row.get("p95_total_gpu_power_w")), "p99_total_power_w": number(row.get("p99_total_gpu_power_w")),
        "max_total_power_w": number(row.get("max_total_gpu_power_w")), "total_energy_wh": number(row.get("observed_window_gpu_energy_wh")),
        "mean_power_per_gpu_w": number(row.get("mean_power_per_gpu_w")), "ramp_up_p95_1s_w_per_s": number(row.get("ramp_up_p95_1s_w_per_s")),
        "ramp_up_p99_1s_w_per_s": number(row.get("ramp_up_p99_1s_w_per_s")), "ramp_down_p99_1s_w_per_s": number(row.get("ramp_down_p99_1s_w_per_s")),
        "ramp_event_frequency_1s": ramp_event_frequency(aggregate), "num_samples": len(samples), "num_gpus_observed": int(samples.gpu_id.nunique()),
        "logging_method": scalar(row.get("logger_type")), "power_aggregation": scalar(row.get("power_scope")),
        "quality_flags": quality_flags, "missing_fields": missing, "timestamp_issues": [],
        "gpu_count_mismatch": int(samples.gpu_id.nunique()) != int(number(row.get("gpu_count_expected"))),
        "duplicate_warning": scalar(row.get("duplicate_group_id")) != "Unknown",
        "run_json_path": f"runs/{public_run_id}.json", "raw_csv_path": f"raw/{public_run_id}.csv",
        "metadata_json_path": f"metadata/{public_run_id}.json",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--analysis-root", type=Path, default=DEFAULT_ANALYSIS_ROOT)
    parser.add_argument("--output", type=Path, default=Path("github-pages/public-data"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = args.analysis_root.resolve()
    samples_dir = root / "repaired_samples/source_family=PowerTraces"
    runs = pd.read_parquet(root / "data/analysis_run_table_v6.parquet")
    power_runs = runs[runs.source_family == "PowerTraces"].copy()
    index = pd.read_parquet(root / "data/aggregate_power_index.parquet")
    power_index = index[index.source_family == "PowerTraces"]
    sample_files = {path.stem: path for path in samples_dir.glob("*.parquet")}
    keys = set(power_index.aggregate_trace_path.str.extract(r"([0-9a-f]{16})")[0])
    problems = []
    if len(power_runs) != 1116 or len(power_index) != 1116 or len(sample_files) != 1116:
        problems.append("expected exactly 1,116 run-table, aggregate-index, and repaired-sample entries")
    if len(keys) != 1116 or keys != set(sample_files):
        problems.append("repaired samples and unique aggregate index keys do not match")
    if power_index.run_id.duplicated().any() or power_runs.run_id.duplicated().any():
        problems.append("duplicate PowerTraces run IDs")
    if problems:
        raise SystemExit("; ".join(problems))
    selected = choose_public_runs(runs, samples_dir)
    if args.dry_run:
        print(json.dumps({"discovered": 1116, "normalized": 1116, "selected": len(selected), "excluded": 1116-len(selected),
                          "selected_strata": selected[["model_family", "gpu_type"]].to_dict("records")}, indent=2))
        return
    output = args.output.resolve()
    if output.exists():
        shutil.rmtree(output)
    for directory in (output / "runs", output / "raw", output / "metadata"):
        directory.mkdir(parents=True, exist_ok=True)
    catalog = []
    selected_ids = set(selected.run_id)
    for _, row in selected.sort_values(["model_family", "gpu_type"]).iterrows():
        key = re.search(r"([0-9a-f]{16})", row.aggregate_trace_path).group(1)
        public_id = slug(row.run_id)
        samples = build_samples(pd.read_parquet(sample_files[key]), public_id)
        aggregate = pd.read_parquet(root / "data/aggregate_power_partitions" / f"{key}.parquet")
        run = build_run(row, public_id, samples, aggregate)
        catalog.append(run)
        samples.to_csv(output / run["raw_csv_path"], index=False, quoting=csv.QUOTE_MINIMAL)
        records = json_ready(samples.where(pd.notna(samples), None).to_dict("records"))
        (output / run["run_json_path"]).write_text(json.dumps({"run": json_ready(run), "samples": records}, separators=(",", ":")))
        (output / run["metadata_json_path"]).write_text(json.dumps(json_ready(run), indent=2) + "\n")
    (output / "catalog.json").write_text(json.dumps(json_ready(catalog), indent=2) + "\n")
    audit = {
        "schema_version": 1, "source_family": "PowerTraces", "discovered_traces": 1116,
        "successfully_normalized": 1116, "published_runs": len(catalog), "excluded_runs": 1116-len(catalog),
        "selection_policy": "One PASS_MAIN run nearest 30 minutes per observed model-family and GPU-type stratum, plus one additional nearest-30-minute run.",
        "exclusions": [
            {"reason": "not_selected_by_publication_policy", "count": int(len(power_runs[power_runs.quality_status == "PASS_MAIN"]) - len(catalog))},
            {"reason": "quality_status_not_PASS_MAIN", "count": int(len(power_runs[power_runs.quality_status != "PASS_MAIN"]))},
        ],
        "safety": {"absolute_source_paths_included": False, "training_logs_included": False, "slurm_files_included": False},
    }
    (output / "publication-audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    print(json.dumps(audit, indent=2))


if __name__ == "__main__":
    main()

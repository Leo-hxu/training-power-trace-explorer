from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from .adapters import ADAPTERS
from .adapters.common import NORMALIZED_FIELDS
from .config import DEMO_PROJECT_ROOT, Settings, get_settings
from .demo_data import create_demo_data
from .metrics import compute_metrics
from .quality import assess_quality
from .stages import enrich_stage_labels


CATALOG_FIELDS = (
    "run_id",
    "source_family",
    "source_directory",
    "trace_path",
    "stdout_path",
    "stderr_path",
    "plot_path",
    "meta_path",
    "model",
    "model_family",
    "method",
    "gpu_type",
    "gpu_count",
    "precision",
    "compute_dtype",
    "quantization_bits",
    "parallelism",
    "sequence_length",
    "microbatch_size",
    "grad_accum_steps",
    "global_batch_size",
    "checkpoint_interval",
    "dataset_name",
    "duration_declared_min",
    "duration_observed_s",
    "sampling_interval_declared_s",
    "sampling_interval_observed_median_s",
    "sampling_interval_observed_p95_s",
    "has_stage_labels",
    "has_clock_telemetry",
    "has_utilization_telemetry",
    "has_temperature_telemetry",
    "quality_status",
    "mean_total_power_w",
    "p95_total_power_w",
    "p99_total_power_w",
    "max_total_power_w",
    "total_energy_wh",
    "mean_power_per_gpu_w",
    "ramp_up_p95_1s_w_per_s",
    "ramp_up_p99_1s_w_per_s",
    "ramp_down_p99_1s_w_per_s",
    "ramp_event_frequency_1s",
    "num_samples",
    "num_gpus_observed",
)

QUERY_TEXT_FIELDS = (
    "run_id",
    "source_family",
    "source_directory",
    "trace_path",
    "model",
    "model_family",
    "method",
    "gpu_type",
    "precision",
    "compute_dtype",
    "parallelism",
    "quality_status",
)


def _discover_csvs(settings: Settings) -> list[Path]:
    discovered: dict[str, Path] = {}
    cache_dir = settings.cache_dir.resolve()
    for directory in settings.source_directories:
        if not directory.exists() or not directory.is_dir():
            continue
        for path in directory.rglob("*.csv"):
            try:
                resolved = path.resolve()
                if cache_dir == resolved or cache_dir in resolved.parents:
                    continue
                discovered[str(resolved)] = resolved
            except OSError:
                continue
    return sorted(discovered.values(), key=str)


def _fingerprint(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        try:
            stat = path.stat()
            digest.update(f"{path}|{stat.st_size}|{stat.st_mtime_ns}\n".encode("utf-8"))
        except OSError:
            digest.update(f"{path}|missing\n".encode("utf-8"))
    return digest.hexdigest()


def _fingerprint_inputs(settings: Settings, csv_paths: list[Path]) -> list[Path]:
    inputs: dict[str, Path] = {str(path): path for path in csv_paths}
    for directory in settings.source_directories:
        if not directory.exists() or not directory.is_dir():
            continue
        for pattern in ("*.json", "*.log"):
            for path in directory.rglob(pattern):
                try:
                    resolved = path.resolve()
                    if settings.cache_dir.resolve() not in resolved.parents:
                        inputs[str(resolved)] = resolved
                except OSError:
                    continue
    return sorted(inputs.values(), key=str)


def _json_safe(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _source_directory(settings: Settings, trace_path: Path) -> str:
    for directory in settings.source_directories:
        try:
            trace_path.relative_to(directory)
            return str(directory)
        except ValueError:
            continue
    return str(trace_path.parent)


def _find_plot(trace_path: Path) -> str | None:
    for suffix in (".png", ".jpg", ".jpeg", ".pdf"):
        candidate = trace_path.with_suffix(suffix)
        if candidate.exists():
            return str(candidate)
    return None


def _normalize_run(
    settings: Settings,
    trace_path: Path,
    info: dict[str, Any],
    records: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    metrics = compute_metrics(records)
    metadata = info.get("metadata", {}) if isinstance(info.get("metadata"), dict) else {}
    run: dict[str, Any] = {
        **{field: info.get(field, "Unknown") for field in CATALOG_FIELDS},
        **metrics,
        "source_directory": _source_directory(settings, trace_path),
        "trace_path": str(trace_path),
        "plot_path": _find_plot(trace_path),
        "global_batch_size": metadata.get("global_batch_size", info.get("global_batch_size", "Unknown")),
        "has_stage_labels": any(row.get("stage") not in (None, "", "Unknown") for row in records),
        "has_clock_telemetry": any(row.get("sm_clock_mhz") is not None for row in records),
        "has_utilization_telemetry": any(
            row.get("gpu_util_pct") is not None or row.get("memory_util_pct") is not None for row in records
        ),
        "has_temperature_telemetry": any(row.get("temperature_c") is not None for row in records),
        "logging_method": info.get("logging_method", "Unknown"),
        "power_aggregation": info.get("power_aggregation", "Unknown"),
        "metadata": metadata,
        "ramp_metrics": metrics.get("ramp_metrics", {}),
    }
    status, flags = assess_quality(trace_path, info, records, metrics)
    run["quality_status"] = status
    run["quality_flags"] = flags
    run["missing_fields"] = sorted(
        field for field in ("model", "method", "gpu_type", "precision") if str(run.get(field, "Unknown")) == "Unknown"
    )
    run["timestamp_issues"] = [
        item["message"] for item in flags if item["code"] in {"non_monotonic_timestamp", "large_timestamp_gap", "irregular_sampling"}
    ]
    run["gpu_count_mismatch"] = any(item["code"] == "gpu_count_mismatch" for item in flags)
    run["duplicate_warning"] = any(item["code"] == "duplicate_samples" for item in flags)
    for field in CATALOG_FIELDS:
        if run.get(field) is None:
            run[field] = None
    return run, flags


def _write_samples(cache_dir: Path, run_id: str, records: list[dict[str, Any]]) -> Path:
    sample_dir = cache_dir / "samples"
    sample_dir.mkdir(parents=True, exist_ok=True)
    output = sample_dir / f"{run_id}.csv.gz"
    fields = (*NORMALIZED_FIELDS, "stage")
    with gzip.open(output, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)
    return output


def _write_csv(path: Path, rows: list[dict[str, Any]], fields: tuple[str, ...]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({field: json.dumps(row[field]) if isinstance(row.get(field), (dict, list)) else row.get(field) for field in fields})


def _write_database(cache_dir: Path, runs: list[dict[str, Any]], flags: list[dict[str, Any]], failures: list[dict[str, str]]) -> None:
    database = cache_dir / "catalog.sqlite3"
    connection = sqlite3.connect(database)
    try:
        connection.execute("DROP TABLE IF EXISTS runs")
        connection.execute("DROP TABLE IF EXISTS quality_flags")
        connection.execute("DROP TABLE IF EXISTS failures")
        text_columns = ", ".join(f'"{field}" TEXT' for field in QUERY_TEXT_FIELDS)
        connection.execute(
            f"CREATE TABLE runs ({text_columns}, sequence_length TEXT, microbatch_size TEXT, grad_accum_steps TEXT, "
            "checkpoint_interval TEXT, gpu_count TEXT, sampling_interval_observed_median_s REAL, "
            "has_stage_labels INTEGER, has_clock_telemetry INTEGER, payload_json TEXT NOT NULL, samples_path TEXT NOT NULL)"
        )
        placeholders = ",".join("?" for _ in range(len(QUERY_TEXT_FIELDS) + 10))
        columns = ",".join([*(f'"{field}"' for field in QUERY_TEXT_FIELDS), "sequence_length", "microbatch_size", "grad_accum_steps", "checkpoint_interval", "gpu_count", "sampling_interval_observed_median_s", "has_stage_labels", "has_clock_telemetry", "payload_json", "samples_path"])
        for run in runs:
            values = [run.get(field) for field in QUERY_TEXT_FIELDS]
            values.extend(
                [
                    run.get("sequence_length"), run.get("microbatch_size"), run.get("grad_accum_steps"),
                    run.get("checkpoint_interval"), run.get("gpu_count"), run.get("sampling_interval_observed_median_s"),
                    int(bool(run.get("has_stage_labels"))), int(bool(run.get("has_clock_telemetry"))),
                    json.dumps(_json_safe(run), allow_nan=False), run["samples_path"],
                ]
            )
            connection.execute(f"INSERT INTO runs ({columns}) VALUES ({placeholders})", values)
        connection.execute("CREATE UNIQUE INDEX idx_runs_run_id ON runs(run_id)")
        connection.execute("CREATE INDEX idx_runs_filters ON runs(source_family, gpu_type, model, method, quality_status)")
        connection.execute(
            "CREATE TABLE quality_flags (run_id TEXT, code TEXT, severity TEXT, message TEXT)"
        )
        connection.executemany(
            "INSERT INTO quality_flags VALUES (?, ?, ?, ?)",
            [(row["run_id"], row["code"], row["severity"], row["message"]) for row in flags],
        )
        connection.execute("CREATE TABLE failures (trace_path TEXT, error TEXT)")
        connection.executemany(
            "INSERT INTO failures VALUES (?, ?)",
            [(row["trace_path"], row["error"]) for row in failures],
        )
        connection.commit()
    finally:
        connection.close()


def _write_report(cache_dir: Path, discovered: int, runs: list[dict[str, Any]], failures: list[dict[str, str]]) -> None:
    gpu_counts = Counter(str(run.get("gpu_type") or "Unknown") for run in runs)
    model_counts = Counter(str(run.get("model") or "Unknown") for run in runs)
    method_counts = Counter(str(run.get("method") or "Unknown") for run in runs)
    intervals = [float(run["sampling_interval_observed_median_s"]) for run in runs if run.get("sampling_interval_observed_median_s") is not None]
    quality_counts = Counter(str(run.get("quality_status") or "Unknown") for run in runs)

    def bullets(counter: Counter[str]) -> str:
        return "\n".join(f"- {name}: {count}" for name, count in counter.most_common()) or "- Not found"

    interval_summary = (
        f"min={min(intervals):.4f}s, median={sorted(intervals)[len(intervals) // 2]:.4f}s, max={max(intervals):.4f}s"
        if intervals
        else "Not found"
    )
    failure_lines = "\n".join(f"- `{row['trace_path']}` — {row['error']}" for row in failures[:50]) or "- None"
    report = f"""# Training Power Trace Catalog Report

Generated from `{get_settings().project_root}`.

## Discovery summary

- Discovered candidate CSV files: {discovered}
- Parsed traces: {len(runs)}
- Failed traces: {len(failures)}
- Observed median sampling interval range: {interval_summary}

## Runs by GPU type

{bullets(gpu_counts)}

## Runs by model

{bullets(model_counts)}

## Runs by method

{bullets(method_counts)}

## Data quality status

{bullets(quality_counts)}

## Parse failures

{failure_lines}
"""
    (cache_dir / "catalog_report.md").write_text(report, encoding="utf-8")


def build_catalog(settings: Settings | None = None, if_needed: bool = False) -> dict[str, Any]:
    settings = settings or get_settings()
    if settings.project_root == DEMO_PROJECT_ROOT:
        create_demo_data(settings.project_root, if_needed=True)
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    paths = _discover_csvs(settings)
    fingerprint = _fingerprint(_fingerprint_inputs(settings, paths))
    state_path = settings.cache_dir / "catalog_state.json"
    database = settings.cache_dir / "catalog.sqlite3"
    if if_needed and database.exists() and state_path.exists():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
            if state.get("fingerprint") == fingerprint:
                return {"status": "unchanged", **state}
        except (OSError, json.JSONDecodeError):
            pass

    runs: list[dict[str, Any]] = []
    used_run_ids: set[str] = set()
    all_flags: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for trace_path in paths:
        try:
            with trace_path.open("r", encoding="utf-8-sig", newline="") as handle:
                fields = [field.strip() for field in (csv.reader(handle).__next__() or [])]
        except Exception as error:
            failures.append({"trace_path": str(trace_path), "error": f"Unable to read CSV header: {error}"})
            continue
        adapter = next((candidate for candidate in ADAPTERS if candidate.can_parse(fields, trace_path)), None)
        if adapter is None:
            lower_name = trace_path.name.lower()
            if "power" in lower_name or "trace" in lower_name:
                failures.append({"trace_path": str(trace_path), "error": "Schema mismatch: no supported power/time column pair was found."})
            continue
        try:
            info, records = adapter.parse(trace_path)
            if not records:
                raise ValueError("No valid samples were parsed from the supported schema.")
            enrich_stage_labels(info, trace_path, records)
            if info["run_id"] in used_run_ids:
                suffix = hashlib.sha1(str(trace_path).encode("utf-8")).hexdigest()[:7]
                info["run_id"] = f"{info['run_id']}_dup_{suffix}"
                for record in records:
                    record["run_id"] = info["run_id"]
            used_run_ids.add(info["run_id"])
            run, flags = _normalize_run(settings, trace_path, info, records)
            samples_path = _write_samples(settings.cache_dir, run["run_id"], records)
            run["samples_path"] = str(samples_path)
            runs.append(run)
            all_flags.extend({"run_id": run["run_id"], **flag} for flag in flags)
        except Exception as error:
            failures.append({"trace_path": str(trace_path), "error": f"{type(error).__name__}: {error}"})

    runs.sort(key=lambda run: str(run["run_id"]))
    _write_database(settings.cache_dir, runs, all_flags, failures)
    _write_csv(settings.cache_dir / "run_catalog.csv", runs, CATALOG_FIELDS)
    metric_fields = tuple(field for field in CATALOG_FIELDS if field.endswith(("_w", "_wh", "_s", "_per_s")) or field.startswith("num_") or "ramp_" in field)
    _write_csv(settings.cache_dir / "run_metrics.csv", runs, ("run_id", *metric_fields))
    _write_csv(settings.cache_dir / "quality_flags.csv", all_flags, ("run_id", "code", "severity", "message"))
    _write_report(settings.cache_dir, len(paths), runs, failures)
    state = {
        "fingerprint": fingerprint,
        "discovered": len(paths),
        "parsed": len(runs),
        "failed": len(failures),
        "cache_dir": str(settings.cache_dir),
    }
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
    return {"status": "rebuilt", **state}


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan and normalize GPU training power traces.")
    parser.add_argument("--if-needed", action="store_true", help="Skip parsing when input paths, sizes, and mtimes are unchanged.")
    args = parser.parse_args()
    result = build_catalog(if_needed=args.if_needed)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)

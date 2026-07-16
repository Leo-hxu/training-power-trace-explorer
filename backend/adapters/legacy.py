from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import (
    clean_number,
    finalize_relative_time,
    find_metadata,
    infer_from_filename,
    normalize_text,
    parse_timestamp,
    read_rows,
    resolve_source_path,
    stable_run_id,
)


class LegacyAdapter:
    family = "Legacy"

    POWER_KEYS = ("power_w", "power", "power.draw [W]", "watts", "gpu_power")
    TIME_KEYS = ("timestamp", "time", "datetime", "elapsed_s", "time_s")
    GPU_KEYS = ("gpu", "gpu_id", "index", "device")

    def can_parse(self, fields: list[str], path: Path) -> bool:
        return any(field in fields for field in self.POWER_KEYS) and any(field in fields for field in self.TIME_KEYS)

    def parse(self, path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        meta_path, metadata = find_metadata(path)
        inferred = infer_from_filename(path)
        confirmed = {**inferred, **metadata}
        run_id = stable_run_id(path, "legacy", confirmed)
        _, rows = read_rows(path)
        records: list[dict[str, Any]] = []
        epochs: list[float] = []
        for index, row in enumerate(rows):
            raw_time = next((row.get(key) for key in self.TIME_KEYS if row.get(key) not in (None, "")), index)
            power = next((clean_number(row.get(key)) for key in self.POWER_KEYS if clean_number(row.get(key)) is not None), None)
            if power is None:
                continue
            timestamp, epoch = parse_timestamp(raw_time, index)
            gpu_id = next((row.get(key) for key in self.GPU_KEYS if row.get(key) not in (None, "")), "0")
            epochs.append(epoch)
            records.append(
                {
                    "run_id": run_id,
                    "timestamp": timestamp,
                    "time_relative_s": 0.0,
                    "gpu_id": normalize_text(gpu_id),
                    "power_w": power,
                    "sm_clock_mhz": clean_number(row.get("sm_clock_mhz") or row.get("clock_mhz")),
                    "gpu_util_pct": clean_number(row.get("gpu_util_pct") or row.get("utilization.gpu [%]")),
                    "memory_util_pct": clean_number(row.get("memory_util_pct") or row.get("utilization.memory [%]")),
                    "memory_used_mb": clean_number(row.get("memory_used_mb")),
                    "memory_total_mb": clean_number(row.get("memory_total_mb")),
                    "temperature_c": clean_number(row.get("temperature_c") or row.get("temp_c")),
                    "stage": normalize_text(row.get("stage")) if row.get("stage") else None,
                    "source_path": str(path),
                }
            )
        finalize_relative_time(records, epochs)
        get = lambda key, default="Unknown": confirmed.get(key, default) if confirmed.get(key) not in (None, "") else default
        info = {
            "run_id": run_id,
            "source_family": self.family,
            "meta_path": str(meta_path) if meta_path else None,
            "metadata": metadata,
            "model": get("model"),
            "model_family": get("model_family"),
            "method": get("method"),
            "gpu_type": get("gpu_type"),
            "gpu_count": get("gpu_count"),
            "sequence_length": get("seq_len", get("sequence_length")),
            "microbatch_size": get("microbatch", get("microbatch_size")),
            "grad_accum_steps": get("grad_accum", get("grad_accum_steps")),
            "checkpoint_interval": get("ckpt_every", get("checkpoint_interval")),
            "dataset_name": get("dataset", get("dataset_name")),
            "sampling_interval_declared_s": get("trace_interval_s"),
            "duration_declared_min": get("run_duration_min"),
            "stdout_path": resolve_source_path(path, get("stdout_path", None)),
            "stderr_path": resolve_source_path(path, get("stderr_path", None)),
            "precision": get("precision"),
            "compute_dtype": get("compute_dtype", get("dtype")),
            "quantization_bits": get("quantization_bits"),
            "parallelism": get("parallelism"),
            "logging_method": get("logging_method", "Legacy CSV"),
            "power_aggregation": get("power_aggregation", "Unknown"),
        }
        return info, records

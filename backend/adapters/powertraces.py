from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import (
    clean_number,
    finalize_relative_time,
    find_metadata,
    first_value,
    normalize_text,
    parse_timestamp,
    read_rows,
    resolve_source_path,
    stable_run_id,
)


class PowerTracesAdapter:
    family = "PowerTraces"

    POWER_FIELDS = ("power.draw [W]", "power.draw", "power_draw_w")

    def can_parse(self, fields: list[str], path: Path) -> bool:
        return "timestamp" in fields and any(field in fields for field in self.POWER_FIELDS)

    def parse(self, path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        meta_path, metadata = find_metadata(path)
        run_id = stable_run_id(path, "powertraces", metadata)
        _, rows = read_rows(path)
        records: list[dict[str, Any]] = []
        epochs: list[float] = []
        for index, row in enumerate(rows):
            timestamp, epoch = parse_timestamp(row.get("timestamp"), index)
            power = next((clean_number(row.get(field)) for field in self.POWER_FIELDS if clean_number(row.get(field)) is not None), None)
            if power is None:
                continue
            epochs.append(epoch)
            records.append(
                {
                    "run_id": run_id,
                    "timestamp": timestamp,
                    "time_relative_s": 0.0,
                    "gpu_id": normalize_text(row.get("index") or row.get("gpu")),
                    "power_w": power,
                    "sm_clock_mhz": clean_number(row.get("clocks.current.sm [MHz]") or row.get("clocks.current.sm")),
                    "gpu_util_pct": clean_number(row.get("utilization.gpu [%]") or row.get("utilization.gpu")),
                    "memory_util_pct": clean_number(row.get("utilization.memory [%]") or row.get("utilization.memory")),
                    "memory_used_mb": clean_number(row.get("memory.used [MiB]")),
                    "memory_total_mb": clean_number(row.get("memory.total [MiB]")),
                    "temperature_c": clean_number(row.get("temperature.gpu") or row.get("temperature.gpu [C]")),
                    "stage": normalize_text(row.get("stage")) if row.get("stage") else None,
                    "source_path": str(path),
                }
            )
        finalize_relative_time(records, epochs)
        info = {
            "run_id": run_id,
            "source_family": self.family,
            "meta_path": str(meta_path) if meta_path else None,
            "metadata": metadata,
            "model": first_value(metadata, "model"),
            "model_family": first_value(metadata, "model_family"),
            "method": first_value(metadata, "method", "training_method"),
            "gpu_type": first_value(metadata, "gpu_type", "accelerator"),
            "gpu_count": first_value(metadata, "gpu_count", "num_gpus"),
            "sequence_length": first_value(metadata, "seq_len", "sequence_length"),
            "microbatch_size": first_value(metadata, "microbatch", "microbatch_size"),
            "grad_accum_steps": first_value(metadata, "grad_accum", "gradient_accumulation_steps"),
            "checkpoint_interval": first_value(metadata, "ckpt_every", "checkpoint_interval"),
            "dataset_name": first_value(metadata, "dataset", "dataset_name"),
            "sampling_interval_declared_s": first_value(metadata, "trace_interval_s", "sampling_interval_s"),
            "duration_declared_min": first_value(metadata, "run_duration_min", "duration_min"),
            "stdout_path": resolve_source_path(path, first_value(metadata, "stdout_path", "log_path", default=None)),
            "stderr_path": resolve_source_path(path, first_value(metadata, "stderr_path", default=None)),
            "precision": first_value(metadata, "precision"),
            "compute_dtype": first_value(metadata, "compute_dtype", "dtype"),
            "quantization_bits": first_value(metadata, "quantization_bits", "bits"),
            "parallelism": first_value(metadata, "parallelism"),
            "logging_method": first_value(metadata, "logging_method", default="nvidia-smi query"),
            "power_aggregation": first_value(metadata, "power_aggregation", default="Raw samples"),
        }
        return info, records

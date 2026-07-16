from __future__ import annotations

import argparse
import csv
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import DEMO_PROJECT_ROOT


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _trace2flex_demo(root: Path) -> None:
    run_dir = root / "trace2flex_pilot_h100_v1" / "trace2flex_h100_v1_C001"
    csv_path = run_dir / "power_trace.csv"
    run_dir.mkdir(parents=True, exist_ok=True)
    _write_json(
        run_dir / "meta.json",
        {
            "run_id": "trace2flex_h100_v1_C001",
            "gpu_type": "H100 SXM",
            "gpu_count": 4,
            "model": "Llama-3-8B",
            "model_family": "Llama 3",
            "method": "FSDP",
            "precision": "BF16",
            "compute_dtype": "bfloat16",
            "seq_len": 4096,
            "microbatch": 2,
            "grad_accum": 8,
            "global_batch_size": 64,
            "ckpt_every": 200,
            "dataset": "C4 sample",
            "trace_interval_s": 0.2,
            "run_duration_min": 0.4,
            "parallelism": "FSDP × 4",
            "power_trace_path": str(csv_path),
            "stdout_path": "train.stdout.log",
            "stderr_path": "train.stderr.log",
            "logging_method": "DCGM + nvidia-smi",
        },
    )
    (run_dir / "train.stdout.log").write_text("Synthetic demo training output.\n", encoding="utf-8")
    (run_dir / "train.stderr.log").write_text("", encoding="utf-8")
    start = datetime(2026, 7, 12, 8, 30, tzinfo=timezone.utc)
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["timestamp", "gpu", "power_w", "util_gpu", "util_mem", "mem_used_mb", "mem_total_mb", "temp_c", "sm_clock_mhz", "stage"])
        for step in range(120):
            time_s = step * 0.2 + (0.018 if step % 19 == 0 else 0)
            stage = "WARMUP" if time_s < 3 else ("FORWARD" if step % 20 < 7 else "BACKWARD" if step % 20 < 16 else "STEP")
            for gpu in range(4):
                base = 92 + min(time_s / 3, 1) * 355
                wave = 42 * math.sin(time_s * 1.45 + gpu * 0.35)
                checkpoint = 85 if 14 < time_s < 15.3 else 0
                power = base + wave - checkpoint + gpu * 4
                writer.writerow([
                    (start + timedelta(seconds=time_s)).isoformat(),
                    gpu,
                    f"{power:.2f}",
                    f"{min(99, 35 + power / 6):.1f}",
                    f"{58 + gpu * 2 + 6 * math.sin(time_s):.1f}",
                    51200 + gpu * 280,
                    81559,
                    f"{57 + power / 28:.1f}",
                    f"{1335 + 120 * math.sin(time_s / 2):.0f}",
                    stage,
                ])


def _powertraces_demo(root: Path) -> None:
    run_dir = root / "PowerTraces" / "l40s_qlora_mistral"
    csv_path = run_dir / "power_samples.csv"
    run_dir.mkdir(parents=True, exist_ok=True)
    _write_json(
        run_dir / "manifest.json",
        {
            "run_id": "powertraces_l40s_qlora_014",
            "gpu_type": "L40S",
            "gpu_count": 2,
            "model": "Mistral-7B",
            "model_family": "Mistral",
            "training_method": "QLoRA",
            "precision": "NF4 / BF16",
            "compute_dtype": "bfloat16",
            "quantization_bits": 4,
            "sequence_length": 2048,
            "microbatch_size": 4,
            "gradient_accumulation_steps": 4,
            "checkpoint_interval": 100,
            "dataset_name": "SlimPajama sample",
            "sampling_interval_s": 0.5,
            "parallelism": "Data parallel × 2",
            "log_path": "train.log",
        },
    )
    (run_dir / "train.log").write_text(
        "time=0s WARMUP begin\n"
        "time=4s FORWARD phase\n"
        "time=13s BACKWARD phase\n"
        "time=21s STEP optimizer\n"
        "time=26s CKPT save\n"
        "time=30s FORWARD phase\n",
        encoding="utf-8",
    )
    start = datetime(2026, 7, 13, 2, 10, tzinfo=timezone.utc)
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["timestamp", "index", "power.draw [W]", "clocks.current.sm [MHz]", "utilization.gpu [%]", "utilization.memory [%]", "temperature.gpu [C]"])
        for step in range(84):
            time_s = step * 0.5
            for gpu in range(2):
                power = 78 + min(time_s / 5, 1) * 205 + 28 * math.sin(time_s * 0.8 + gpu)
                if 26 < time_s < 29:
                    power -= 65
                writer.writerow([
                    (start + timedelta(seconds=time_s)).isoformat(), gpu, f"{power:.2f}",
                    f"{1110 + 210 * math.sin(time_s / 3):.0f}", f"{min(99, 30 + power / 3.2):.1f}",
                    f"{43 + 12 * math.sin(time_s / 4 + gpu):.1f}", f"{48 + power / 22:.1f}",
                ])


def _legacy_demo(root: Path) -> None:
    run_dir = root / "traces"
    csv_path = run_dir / "a100_llama2-7b_lora_seq2048_mb2_ga8.csv"
    run_dir.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["time_s", "device", "watts", "gpu_util_pct", "temperature_c"])
        for step in range(96):
            time_s = step * 0.31 + (0.11 if step % 23 == 0 else 0)
            power = 65 + min(time_s / 4, 1) * 245 + 38 * math.sin(time_s * 1.1)
            writer.writerow([f"{time_s:.3f}", 0, f"{power:.2f}", f"{min(98, power / 3.5):.1f}", f"{46 + power / 24:.1f}"])


def create_demo_data(root: Path = DEMO_PROJECT_ROOT, if_needed: bool = False) -> Path:
    if if_needed and any(root.rglob("*.csv")):
        return root
    _trace2flex_demo(root)
    _powertraces_demo(root)
    _legacy_demo(root)
    return root


def main() -> None:
    parser = argparse.ArgumentParser(description="Create synthetic, clearly labeled demo traces.")
    parser.add_argument("--if-needed", action="store_true")
    args = parser.parse_args()
    root = create_demo_data(if_needed=args.if_needed)
    print(f"Demo traces ready under {root}")


if __name__ == "__main__":
    main()

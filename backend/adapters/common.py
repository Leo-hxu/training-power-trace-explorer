from __future__ import annotations

import csv
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


NORMALIZED_FIELDS = (
    "run_id",
    "timestamp",
    "time_relative_s",
    "gpu_id",
    "power_w",
    "sm_clock_mhz",
    "gpu_util_pct",
    "memory_util_pct",
    "memory_used_mb",
    "memory_total_mb",
    "temperature_c",
    "source_path",
)


def clean_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    match = re.search(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", str(value))
    if not match:
        return None
    try:
        parsed = float(match.group(0))
        return parsed if math.isfinite(parsed) else None
    except ValueError:
        return None


def parse_timestamp(value: Any, row_index: int) -> tuple[str, float]:
    numeric = clean_number(value)
    if numeric is not None and str(value).strip().replace(".", "", 1).isdigit():
        epoch = numeric
        if epoch > 1e17:
            epoch /= 1e9
        elif epoch > 1e14:
            epoch /= 1e6
        elif epoch > 1e11:
            epoch /= 1e3
        if epoch > 1e8:
            text = datetime.fromtimestamp(epoch, timezone.utc).isoformat()
        else:
            text = f"{epoch:.6f}"
        return text, epoch

    text = str(value or "").strip()
    if text:
        normalized = text.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return text, parsed.timestamp()
        except ValueError:
            pass
    return text or f"row-{row_index}", float(row_index)


def load_json(path: Path | None) -> dict[str, Any]:
    if not path or not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def find_metadata(trace_path: Path) -> tuple[Path | None, dict[str, Any]]:
    candidates = (
        trace_path.with_suffix(".json"),
        trace_path.parent / "meta.json",
        trace_path.parent / "metadata.json",
        trace_path.parent / "manifest.json",
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate, load_json(candidate)
    return None, {}


def stable_run_id(trace_path: Path, prefix: str, metadata: dict[str, Any]) -> str:
    explicit = metadata.get("run_id") or metadata.get("id") or metadata.get("name")
    if explicit:
        base = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(explicit)).strip("_")
        if base:
            return base
    stem = re.sub(r"[^a-zA-Z0-9_-]+", "_", trace_path.stem).strip("_") or "trace"
    digest = hashlib.sha1(str(trace_path).encode("utf-8")).hexdigest()[:7]
    return f"{prefix}_{stem}_{digest}"


def first_value(metadata: dict[str, Any], *keys: str, default: Any = "Unknown") -> Any:
    for key in keys:
        value = metadata.get(key)
        if value not in (None, ""):
            return value
    return default


def infer_from_filename(path: Path) -> dict[str, Any]:
    name = path.stem.lower()
    result: dict[str, Any] = {}
    gpu_match = re.search(r"(h200|h100|l40s|a100|a40|v100|rtx[_-]?\d+)", name)
    if gpu_match:
        result["gpu_type"] = gpu_match.group(1).upper().replace("_", "-")
    model_match = re.search(r"(llama(?:2|3)?[_-]?\d+[bB]|mistral[_-]?\d+[bB]|gpt[_-]?\w+|bert[_-]?\w+)", name)
    if model_match:
        result["model"] = model_match.group(1).replace("_", "-")
    seq_match = re.search(r"(?:seq|sl)[_-]?(\d+)", name)
    if seq_match:
        result["seq_len"] = int(seq_match.group(1))
    mb_match = re.search(r"(?:mb|microbatch)[_-]?(\d+)", name)
    if mb_match:
        result["microbatch"] = int(mb_match.group(1))
    ga_match = re.search(r"(?:ga|gradaccum)[_-]?(\d+)", name)
    if ga_match:
        result["grad_accum"] = int(ga_match.group(1))
    for method in ("lora", "qlora", "full", "deepspeed", "fsdp"):
        if method in name:
            result["method"] = method.upper() if method in {"lora", "qlora", "fsdp"} else method.title()
    return result


def read_rows(path: Path) -> tuple[list[str], Iterable[dict[str, str]]]:
    handle = path.open("r", encoding="utf-8-sig", newline="")
    reader = csv.DictReader(handle)
    fields = [field.strip() for field in (reader.fieldnames or [])]

    def iterator() -> Iterable[dict[str, str]]:
        try:
            for row in reader:
                yield {str(k).strip(): v for k, v in row.items() if k is not None}
        finally:
            handle.close()

    return fields, iterator()


def finalize_relative_time(records: list[dict[str, Any]], epochs: list[float]) -> None:
    if not epochs:
        return
    origin = min(epochs)
    for record, epoch in zip(records, epochs, strict=False):
        record["time_relative_s"] = round(epoch - origin, 6)


def normalize_text(value: Any) -> str:
    return str(value).strip() if value not in (None, "") else "Unknown"


def resolve_source_path(trace_path: Path, value: Any) -> str | None:
    if value in (None, "", "Unknown", "Not found"):
        return None
    candidate = Path(str(value)).expanduser()
    if not candidate.is_absolute():
        candidate = trace_path.parent / candidate
    return str(candidate.resolve())

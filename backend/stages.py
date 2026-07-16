from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .adapters.common import parse_timestamp


STAGE_PATTERN = re.compile(r"\b(FORWARD|BACKWARD|STEP|CKPT|CHECKPOINT|WARMUP|EVAL|OPTIMIZER)\b", re.IGNORECASE)
RELATIVE_TIME_PATTERN = re.compile(r"(?:\bt\s*=\s*|\btime\s*[=:]\s*|\belapsed\s*[=:]\s*)?(\d+(?:\.\d+)?)\s*s\b", re.IGNORECASE)
ISO_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?")


def _candidate_logs(info: dict[str, Any], trace_path: Path) -> list[Path]:
    candidates: list[Path] = []
    for field in ("stdout_path", "stderr_path"):
        value = info.get(field)
        if value:
            candidates.append(Path(str(value)))
    candidates.extend(sorted(trace_path.parent.glob("*.log")))
    unique: dict[str, Path] = {}
    for path in candidates:
        if path.exists() and path.is_file():
            unique[str(path.resolve())] = path.resolve()
    return list(unique.values())


def enrich_stage_labels(info: dict[str, Any], trace_path: Path, records: list[dict[str, Any]]) -> int:
    if not records or any(row.get("stage") not in (None, "", "Unknown") for row in records):
        return 0
    first_timestamp = records[0].get("timestamp")
    _, origin_epoch = parse_timestamp(first_timestamp, 0)
    duration = max(float(row["time_relative_s"]) for row in records)
    markers: list[tuple[float, str]] = []
    for log_path in _candidate_logs(info, trace_path):
        try:
            lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            stage_match = STAGE_PATTERN.search(line)
            if not stage_match:
                continue
            stage = stage_match.group(1).upper().replace("CHECKPOINT", "CKPT").replace("OPTIMIZER", "STEP")
            relative_match = RELATIVE_TIME_PATTERN.search(line)
            if relative_match:
                relative_s = float(relative_match.group(1))
            else:
                iso_match = ISO_PATTERN.search(line)
                if not iso_match:
                    continue
                _, epoch = parse_timestamp(iso_match.group(0).replace(" ", "T"), 0)
                relative_s = epoch - origin_epoch
            if 0 <= relative_s <= duration:
                markers.append((relative_s, stage))
    if not markers:
        return 0
    markers = sorted(set(markers))
    marker_index = 0
    current_stage: str | None = None
    for row in sorted(records, key=lambda item: float(item["time_relative_s"])):
        time_s = float(row["time_relative_s"])
        while marker_index < len(markers) and markers[marker_index][0] <= time_s:
            current_stage = markers[marker_index][1]
            marker_index += 1
        if current_stage:
            row["stage"] = current_stage
    return len(markers)


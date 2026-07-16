from __future__ import annotations

import csv
import gzip
import io
import json
import os
import platform
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from .build_catalog import build_catalog
from .config import Settings, get_settings
from .metrics import peak_preserving_downsample, rolling_average, total_power_series


app = FastAPI(
    title="Training Power Trace Explorer API",
    version="1.0.0",
    description="Local-only catalog and normalized sample API for GPU training power traces.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://127.0.0.1:{os.environ.get('TRACE_EXPLORER_WEB_PORT', '3000')}",
        f"http://localhost:{os.environ.get('TRACE_EXPLORER_WEB_PORT', '3000')}",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def settings() -> Settings:
    return get_settings()


def database_path() -> Path:
    return settings().cache_dir / "catalog.sqlite3"


def connect() -> sqlite3.Connection:
    path = database_path()
    if not path.exists():
        build_catalog(if_needed=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    return connection


def decode_run(row: sqlite3.Row) -> dict[str, Any]:
    payload = json.loads(row["payload_json"])
    payload["samples_path"] = row["samples_path"]
    return payload


def get_run_or_404(run_id: str) -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute("SELECT payload_json, samples_path FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' was not found in the local catalog.")
    return decode_run(row)


def parse_optional_number(value: str) -> float | None:
    if value in (None, "", "Unknown"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def read_normalized_samples(run: dict[str, Any]) -> list[dict[str, Any]]:
    path = Path(run["samples_path"])
    if not path.exists():
        raise HTTPException(status_code=410, detail="The normalized sample cache is missing. Rebuild the catalog.")
    records: list[dict[str, Any]] = []
    with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            records.append(
                {
                    **row,
                    "time_relative_s": float(row["time_relative_s"]),
                    "power_w": float(row["power_w"]),
                    "sm_clock_mhz": parse_optional_number(row.get("sm_clock_mhz", "")),
                    "gpu_util_pct": parse_optional_number(row.get("gpu_util_pct", "")),
                    "memory_util_pct": parse_optional_number(row.get("memory_util_pct", "")),
                    "memory_used_mb": parse_optional_number(row.get("memory_used_mb", "")),
                    "memory_total_mb": parse_optional_number(row.get("memory_total_mb", "")),
                    "temperature_c": parse_optional_number(row.get("temperature_c", "")),
                    "stage": row.get("stage") or None,
                }
            )
    return records


def filter_samples(
    records: list[dict[str, Any]],
    start_s: float | None,
    end_s: float | None,
    gpu_id: str | None,
) -> list[dict[str, Any]]:
    return [
        row
        for row in records
        if (start_s is None or row["time_relative_s"] >= start_s)
        and (end_s is None or row["time_relative_s"] <= end_s)
        and (gpu_id is None or str(row["gpu_id"]) == str(gpu_id))
    ]


@app.on_event("startup")
def ensure_catalog() -> None:
    build_catalog(if_needed=True)


@app.get("/api/health")
def health() -> dict[str, Any]:
    state_path = settings().cache_dir / "catalog_state.json"
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    return {"status": "ok", "project_root": str(settings().project_root), **state}


@app.get("/api/runs")
def list_runs(
    source_family: str | None = None,
    gpu_type: str | None = None,
    model: str | None = None,
    model_family: str | None = None,
    method: str | None = None,
    precision: str | None = None,
    compute_dtype: str | None = None,
    sequence_length: str | None = None,
    microbatch_size: str | None = None,
    grad_accum_steps: str | None = None,
    checkpoint_interval: str | None = None,
    parallelism: str | None = None,
    quality_status: str | None = None,
    has_stage_labels: bool | None = None,
    has_clock_telemetry: bool | None = None,
    search: str | None = None,
    limit: int = Query(250, ge=1, le=5000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    filters = {
        "source_family": source_family,
        "gpu_type": gpu_type,
        "model": model,
        "model_family": model_family,
        "method": method,
        "precision": precision,
        "compute_dtype": compute_dtype,
        "sequence_length": sequence_length,
        "microbatch_size": microbatch_size,
        "grad_accum_steps": grad_accum_steps,
        "checkpoint_interval": checkpoint_interval,
        "parallelism": parallelism,
        "quality_status": quality_status,
    }
    clauses: list[str] = []
    params: list[Any] = []
    for field, value in filters.items():
        if value and value != "All":
            clauses.append(f'"{field}" = ?')
            params.append(value)
    if has_stage_labels is not None:
        clauses.append("has_stage_labels = ?")
        params.append(int(has_stage_labels))
    if has_clock_telemetry is not None:
        clauses.append("has_clock_telemetry = ?")
        params.append(int(has_clock_telemetry))
    if search:
        clauses.append("(run_id LIKE ? OR model LIKE ? OR trace_path LIKE ?)")
        needle = f"%{search}%"
        params.extend([needle, needle, needle])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with connect() as connection:
        total = connection.execute(f"SELECT COUNT(*) FROM runs {where}", params).fetchone()[0]
        rows = connection.execute(
            f"SELECT payload_json, samples_path FROM runs {where} ORDER BY run_id LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        catalog_total = connection.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
        failed = connection.execute("SELECT COUNT(*) FROM failures").fetchone()[0]
    return {
        "runs": [decode_run(row) for row in rows],
        "total": total,
        "catalog_total": catalog_total,
        "failed": failed,
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/filters")
def filters() -> dict[str, Any]:
    fields = (
        "source_family", "gpu_type", "model", "model_family", "method", "precision", "compute_dtype",
        "sequence_length", "microbatch_size", "grad_accum_steps", "checkpoint_interval", "parallelism",
        "quality_status",
    )
    result: dict[str, list[str]] = {}
    with connect() as connection:
        for field in fields:
            rows = connection.execute(
                f'SELECT DISTINCT "{field}" FROM runs WHERE "{field}" IS NOT NULL AND "{field}" != ? ORDER BY "{field}"',
                ("Unknown",),
            ).fetchall()
            result[field] = [str(row[0]) for row in rows]
    result["boolean"] = ["Yes", "No"]
    result["sampling_resolution"] = ["≤ 0.25 s", "0.25–1 s", "> 1 s"]
    return result


@app.get("/api/runs/{run_id}")
def run_detail(run_id: str) -> dict[str, Any]:
    return get_run_or_404(run_id)


@app.get("/api/runs/{run_id}/samples")
def samples(
    run_id: str,
    start_s: float | None = None,
    end_s: float | None = None,
    gpu_id: str | None = None,
    downsample: int = Query(1200, ge=0, le=10000),
    smoothing_window_s: float = Query(0, ge=0, le=60),
) -> dict[str, Any]:
    run = get_run_or_404(run_id)
    all_records = read_normalized_samples(run)
    selected = filter_samples(all_records, start_s, end_s, gpu_id)
    if smoothing_window_s > 0:
        selected = rolling_average(selected, smoothing_window_s)
    before_downsample = len(selected)
    totals = total_power_series(selected)
    total_lookup = {round(float(row["time_relative_s"]), 9): row["total_power_w"] for row in totals}
    stages: list[dict[str, Any]] = []
    last_stage = None
    for row in sorted(selected, key=lambda item: float(item["time_relative_s"])):
        stage = row.get("stage")
        if stage and stage != last_stage:
            stages.append({"time_relative_s": row["time_relative_s"], "stage": stage})
            last_stage = stage
    if downsample:
        selected = peak_preserving_downsample(selected, downsample)
    for row in selected:
        row["total_power_w"] = total_lookup.get(round(float(row["time_relative_s"]), 9))
    return {
        "run_id": run_id,
        "samples": selected,
        "stages": stages[:100],
        "total_samples": len(all_records),
        "selected_samples": before_downsample,
        "returned_samples": len(selected),
        "downsampling": "min/max envelope by GPU",
        "smoothing_window_s": smoothing_window_s,
    }


SORTABLE_RAW_FIELDS = {
    "timestamp", "time_relative_s", "gpu_id", "power_w", "gpu_util_pct", "memory_util_pct",
    "memory_used_mb", "sm_clock_mhz", "temperature_c",
}


@app.get("/api/runs/{run_id}/raw")
def raw_samples(
    run_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=10, le=500),
    search: str | None = None,
    sort_by: str = "time_relative_s",
    sort_dir: str = "asc",
    gpu_id: str | None = None,
    start_s: float | None = None,
    end_s: float | None = None,
) -> dict[str, Any]:
    run = get_run_or_404(run_id)
    records = filter_samples(read_normalized_samples(run), start_s, end_s, gpu_id)
    if search:
        needle = search.lower()
        records = [row for row in records if needle in " ".join(str(value).lower() for value in row.values())]
    field = sort_by if sort_by in SORTABLE_RAW_FIELDS else "time_relative_s"
    reverse = sort_dir.lower() == "desc"
    records.sort(key=lambda row: (row.get(field) is None, row.get(field)), reverse=reverse)
    total = len(records)
    start = (page - 1) * page_size
    page_rows = records[start : start + page_size]
    totals = {round(float(row["time_relative_s"]), 9): row["total_power_w"] for row in total_power_series(records)}
    for row in page_rows:
        row["total_power_w"] = totals.get(round(float(row["time_relative_s"]), 9))
    return {
        "rows": page_rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
        "gpu_ids": sorted({str(row["gpu_id"]) for row in records}),
    }


@app.get("/api/runs/{run_id}/download/raw.csv")
def download_raw_csv(
    run_id: str,
    gpu_id: str | None = None,
    start_s: float | None = None,
    end_s: float | None = None,
) -> StreamingResponse:
    run = get_run_or_404(run_id)
    records = filter_samples(read_normalized_samples(run), start_s, end_s, gpu_id)
    totals = {round(float(row["time_relative_s"]), 9): row["total_power_w"] for row in total_power_series(records)}
    output = io.StringIO()
    fields = [
        "timestamp", "time_relative_s", "gpu_id", "power_w", "total_power_w", "gpu_util_pct",
        "memory_util_pct", "memory_used_mb", "memory_total_mb", "sm_clock_mhz", "temperature_c", "source_path",
    ]
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in records:
        writer.writerow({**row, "total_power_w": totals.get(round(float(row["time_relative_s"]), 9))})
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{run_id}_normalized.csv"'},
    )


@app.get("/api/runs/{run_id}/download/metadata.json")
def download_metadata(run_id: str) -> JSONResponse:
    run = get_run_or_404(run_id)
    run.pop("samples_path", None)
    return JSONResponse(
        run,
        headers={"Content-Disposition": f'attachment; filename="{run_id}_metadata.json"'},
    )


@app.post("/api/runs/{run_id}/open-folder")
def open_source_folder(run_id: str) -> dict[str, str]:
    run = get_run_or_404(run_id)
    folder = str(Path(run["trace_path"]).parent)
    if not settings().allow_open_folder:
        raise HTTPException(
            status_code=501,
            detail={"message": "Folder opening is disabled. The source path can be copied instead.", "path": folder},
        )
    command = ["open", folder] if platform.system() == "Darwin" else ["xdg-open", folder]
    try:
        subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as error:
        raise HTTPException(status_code=500, detail={"message": str(error), "path": folder}) from error
    return {"status": "opened", "path": folder}


@app.get("/api/catalog/report")
def catalog_report() -> FileResponse:
    path = settings().cache_dir / "catalog_report.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Catalog report has not been generated.")
    return FileResponse(path, media_type="text/markdown", filename="catalog_report.md")


@app.post("/api/rebuild_catalog")
def rebuild_catalog() -> dict[str, Any]:
    return build_catalog(if_needed=False)

# Training Power Trace Explorer

Training Power Trace Explorer has two complementary modes: a local research dashboard for scanning, filtering, validating, and interactively inspecting private LLM training GPU power traces, plus a hosted community contribution flow for reviewed, consented data sharing. The local catalog preserves source paths, normalizes multiple logger schemas, computes timestamp-aware power metrics, and records every parse failure.

## Public demo

A synthetic-data-only demonstration is published through GitHub Pages:

**[https://leo-hxu.github.io/training-power-trace-explorer/](https://leo-hxu.github.io/training-power-trace-explorer/)**

The public build is generated from `github-pages/` with `npm run build:pages`. It contains deterministic examples only and does not include real traces, logs, cache files, or access to the local FastAPI service. The complete scanner and API remain local by design.

## Community submissions

The hosted application adds a signed-in contribution flow for external researchers:

- Contributors upload one power-trace CSV and optional `meta.json` / `manifest.json`.
- The site checks file size, CSV headers, and usable time and power values before storing the files.
- Every submission is private until an administrator reviews it.
- Publication requires explicit contributor consent; only published submissions are visible and downloadable publicly.

The hosted runtime uses an R2 binding named `UPLOADS` for the source files and a D1 binding named `DB` for submission metadata, ownership, and review status. Set `ADMIN_EMAILS` in the hosted environment to a comma-separated list of reviewer ChatGPT sign-in emails. Do not commit reviewer email addresses, credentials, or uploaded traces to the repository.

## Quick start

On the project host:

```bash
cd /scratch/hx2493/project/llm_example_run/power_trace_explorer
./run_app.sh
```

Then open [http://localhost:3000](http://localhost:3000). The local API reference is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

The startup script creates an isolated Python environment on first use, installs the small backend dependency set, scans the configured directories when inputs changed, and starts the API and web interface together. Press `Ctrl-C` to stop both services.

If the default scratch project does not exist, the app creates and catalogs three clearly labeled synthetic demo runs under `demo_project/`. Demo metadata is never mixed with a real `/scratch/...` project.

## Data location

The default project root is:

```text
/scratch/hx2493/project/llm_example_run
```

The scanner checks the requested `traces`, `logs_train`, `slurm`, `trace2flex_pilot_*`, and `PowerTraces` directories beneath that root. Override or extend the scan without editing code:

```bash
export TRACE_EXPLORER_PROJECT_ROOT=/path/to/llm_example_run
export TRACE_EXPLORER_EXTRA_DIRS=/another/traces:/another/power_logs
./run_app.sh
```

Use `TRACE_EXPLORER_CACHE_DIR` to place the normalized cache somewhere else. Set `TRACE_EXPLORER_ALLOW_OPEN_FOLDER=1` only on a local desktop if the **Open Source Folder** button should launch the system file manager; otherwise the button safely copies the source path.

The default ports are `3000` for the interface and `8000` for the API. If either is already used, select explicit local ports:

```bash
TRACE_EXPLORER_WEB_PORT=3010 TRACE_EXPLORER_API_PORT=8010 ./run_app.sh
```

No trace, log, manifest, metadata, or normalized sample is uploaded. The frontend communicates only with the FastAPI process on `127.0.0.1:8000`.

## Supported input schemas

### trace2flex / legacy

Canonical columns:

```text
timestamp,gpu,power_w,util_gpu,util_mem,mem_used_mb,mem_total_mb,temp_c
```

When present, a sibling `meta.json`, `metadata.json`, or file-matched JSON supplies confirmed training metadata. Legacy filename inference is conservative; unresolved fields remain `Unknown`.

### PowerTraces

Canonical columns:

```text
timestamp,index,power.draw [W],clocks.current.sm [MHz],utilization.gpu [%],utilization.memory [%]
```

The adapter reads a sibling `manifest.json` when available and converts both schemas to:

```text
run_id,timestamp,time_relative_s,gpu_id,power_w,sm_clock_mhz,gpu_util_pct,
memory_util_pct,memory_used_mb,memory_total_mb,temperature_c,source_path
```

## Catalog and cache

Run a scan directly with:

```bash
python -m backend.build_catalog
```

Use `--if-needed` to skip re-parsing when candidate paths, sizes, and modification times are unchanged. The **Import / Scan Data** action in the UI forces a rebuild.

Outputs are written beneath `trace_explorer_cache/`:

```text
catalog.sqlite3
run_catalog.csv
run_metrics.csv
quality_flags.csv
catalog_report.md
samples/<run_id>.csv.gz
```

SQLite holds searchable run metadata. Normalized samples are cached as compressed CSV partitions, so the browser never loads every raw trace at once.

## Metrics and quality

- Total power groups per-GPU samples by their observed timestamp.
- Energy uses trapezoidal integration over actual `dt` values and reports Wh.
- P95, P99, and max operate on the normalized total-power series.
- Ramp metrics interpolate power at `t − δ` for 1 s, 5 s, and 10 s windows; they never assume a fixed row interval.
- Observed median and p95 sampling intervals are derived from timestamps.
- Plot downsampling uses a per-GPU min/max envelope to retain peaks and the high-level trace shape.

Quality checks cover missing files and metadata, schema mismatch, irregular sampling, large gaps, non-monotonic time, missing GPU samples, zero or implausible power, unknown precision/GPU type, declared-versus-observed GPU count, and duplicate timestamp/GPU pairs. Failures are included in `catalog_report.md`; they are not silently ignored.

## API

Key local endpoints:

```text
GET  /api/runs
GET  /api/runs/{run_id}
GET  /api/runs/{run_id}/samples
GET  /api/runs/{run_id}/raw
GET  /api/filters
POST /api/rebuild_catalog
```

The sample endpoint accepts `start_s`, `end_s`, `gpu_id`, `downsample`, and `smoothing_window_s`. The raw endpoint adds pagination, search, sorting, and time/GPU filters.

## Development checks

```bash
npm run build
python -m backend.build_catalog
python -m unittest discover -s backend/tests
```

The web build is self-contained. The Python service and catalog remain local and are not part of a cloud deployment.

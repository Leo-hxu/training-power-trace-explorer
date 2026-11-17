# LLM Power Trace Explorer

LLM Power Trace Explorer has two complementary modes: a local research dashboard for scanning, filtering, validating, and interactively inspecting private LLM training and inference GPU power traces, plus a hosted community contribution flow for reviewed, consented data sharing. The local catalog preserves source paths, normalizes multiple logger schemas, computes timestamp-aware power metrics, and records every parse failure.

## Public dataset

Reviewed GPU training and inference power traces are published through GitHub Pages:

**[https://leo-hxu.github.io/training-power-trace-explorer/](https://leo-hxu.github.io/training-power-trace-explorer/)**

The public build is generated from `github-pages/` with `npm run build:pages`. It contains only intentionally public, research-ready canonical exports and clearly labeled synthetic demonstrations; it does not include training logs, Slurm scripts, cache files, source-system paths, or access to the local FastAPI service. The complete scanner and private-data API remain local by design. Published artifacts are served from the configured public data store; see [the public-data guide](docs/google-drive-public-data.md) and [the contributor schema](docs/DATA_SUBMISSION.md).

## Dataset inventory

The public release contains **302 GPU power traces** (251 training, 51 inference) covering **60 models** and **123 distinct configurations** (workload × model × GPU type × GPU count), with **420.6 h** of wall-clock telemetry and **1639 GPU-hours**. The live, filterable version of these tables is the explorer's [Dataset card](https://leo-hxu.github.io/training-power-trace-explorer/#/dataset).

### Runs by workload and GPU platform

| Workload | GPU | GPUs / run | Runs | Models | Hours |
|---|---|---|---|---|---|
| Training | A100 | 4 | 35 | 16 | 70.0 |
| Training | H100 | 4 | 52 | 24 | 92.3 |
| Training | H200 | 4 | 150 | 57 | 212.8 |
| Training | L40S | 4 | 14 | 10 | 28.0 |
| Inference | A100 | 1 | 16 | 7 | 3.7 |
| Inference | A100 | 2 | 2 | 2 | 0.6 |
| Inference | A100 | 4 | 3 | 3 | 0.7 |
| Inference | H100 (Lambda) | 1 | 8 | 1 | 2.8 |
| Inference | H200 | 1 | 14 | 1 | 4.1 |
| Inference | H200 | 2 | 6 | 1 | 4.9 |
| Inference | H200 | 4 | 2 | 1 | 0.6 |

### Model families

| Workload | Model family | Runs | Models | GPU types |
|---|---|---|---|---|
| Training | Gemma | 122 | 14 | A100, H100, H200, L40S |
| Training | Qwen | 39 | 13 | A100, H200 |
| Training | Mistral | 36 | 12 | A100, H100, H200 |
| Training | Llama | 24 | 8 | H200 |
| Training | GPT-2 | 12 | 4 | H200 |
| Training | DeepSeek | 9 | 3 | H200 |
| Training | GPT-J | 3 | 1 | H200 |
| Training | GPT-NeoX | 3 | 1 | H200 |
| Training | Pythia | 3 | 1 | H200 |
| Inference | Qwen | 34 | 7 | A100, H200 |
| Inference | Llama | 17 | 2 | A100, H100 (Lambda), H200 |

### Trace durations and sampling

| Workload | Source | Runs | Min (min) | Median (min) | Max (min) | Median interval (s) |
|---|---|---|---|---|---|---|
| Training | Reviewed training corpus | 159 | 1.1 | 120.1 | 150.0 | 0.10 |
| Training | Time-limited; downsampled | 92 | 30.0 | 120.0 | 120.4 | 0.10 |
| Inference | Reviewed inference corpus | 51 | 11.8 | 14.4 | 83.4 | 0.10 |

### Telemetry availability

| Channel | Present | Absent | Not stated |
|---|---|---|---|
| Power | 302 | 0 | 0 |
| GPU utilization | 302 | 0 | 0 |
| SM clock | 293 | 9 | 0 |
| Temperature | 60 | 242 | 0 |
| Memory used | 60 | 242 | 0 |
| Stage labels | 0 | 210 | 92 |

Inference demand: 51 of 51 inference runs include a time-binned request series aligned to the power trace; raw per-request event logs are not released.

### Quality tiers

| Tier | Source | Runs |
|---|---|---|
| PASS_LIMITED | Reviewed training corpus | 37 |
| PASS_LIMITED | Time-limited; downsampled | 92 |
| PASS_MAIN | Reviewed inference corpus | 51 |
| PASS_MAIN | Reviewed training corpus | 122 |

Only runs that pass automated integrity checks and release review are published. Fixed, configuration-grouped train/validation/test splits (v1) are listed per run in the explorer and downloadable as `splits.json`.

_Regenerate with `python scripts/catalog_inventory.py <catalog.json>`._

## License

- **Data** — the GPU power traces and associated run metadata (the published catalog, trace bundles, request timelines, and derived CSV downloads) — are released under [Creative Commons Attribution 4.0 International (CC BY 4.0)](LICENSE-DATA). You may share and adapt the data for any purpose, including commercially, provided you give appropriate credit and indicate if changes were made.
- **Code** — the profiling, collection, and analysis code, including this explorer — is released under the [Apache License 2.0](LICENSE). The data-collection scripts are published separately in the [data-collection repository](https://anonymous.4open.science/r/data-collection-0866/README.md) under the same license.

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
cd training-power-trace-explorer
./run_app.sh
```

Then open [http://localhost:3000](http://localhost:3000). The local API reference is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

The startup script creates an isolated Python environment on first use, installs the small backend dependency set, scans the configured directories when inputs changed, and starts the API and web interface together. Press `Ctrl-C` to stop both services.

If the configured private project does not exist, the app creates and catalogs three clearly labeled generated fallback runs under `demo_project/`. Fallback metadata is never mixed with a real private project.

## Data location

The project root is configured locally and is never included in public exports. The scanner checks the requested `traces`, `logs_train`, `slurm`, `trace2flex_pilot_*`, and `PowerTraces` directories beneath that root. Override or extend the scan without editing code:

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

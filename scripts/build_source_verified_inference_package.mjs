import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const CANONICAL_COLUMNS = [
  "run_id", "timestamp", "time_relative_s", "gpu_id", "power_w", "sm_clock_mhz",
  "gpu_util_pct", "memory_util_pct", "memory_used_mb", "memory_total_mb", "temperature_c", "stage",
];
const TIMELINE_COLUMNS = [
  "time_relative_s", "window_s", "requests_arrived", "active_requests",
  "mean_prompt_tokens", "mean_output_tokens", "mean_request_tokens",
];

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function usage() {
  console.log(`Usage:
  node scripts/build_source_verified_inference_package.mjs build \\
    --source <downloaded-run-folder> --output <package-folder>

  node scripts/build_source_verified_inference_package.mjs finalize \\
    --output <package-folder> --raw-file-id <id> --metadata-file-id <id> \\
    --request-file-id <id> [--run-file-id <id>] [--catalog <existing-catalog.json>]
    [--catalog-base64 <existing-catalog-base64>]

The build phase turns the source DCGM CSVs plus vLLM metrics into browser-ready
canonical files. The finalize phase inserts Google Drive file IDs after upload.`);
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
}

function asNumber(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value, digits = 3) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

function percentile(values, fraction) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))];
}

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvText(columns, rows) {
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifySourceFiles(source, manifest, runId) {
  const expectedNames = {
    "dcgm_gpu0.csv": `dcgm_${runId}_gpu0.csv`,
    "dcgm_gpu1.csv": `dcgm_${runId}_gpu1.csv`,
    "instance_facts.json": "instance_facts.json",
    "vllm_metrics.jsonl": "vllm_metrics.jsonl",
    "vllm_server.log": `vllm_server_${runId}.log`,
  };
  const results = [];
  for (const [localName, manifestName] of Object.entries(expectedNames)) {
    const expected = manifest.files?.[manifestName];
    if (!expected) throw new Error(`Source manifest does not contain ${manifestName}.`);
    const path = join(source, localName);
    const [actualSize, actualHash] = await Promise.all([stat(path).then((file) => file.size), sha256(path)]);
    if (actualSize !== expected.size || actualHash !== expected.sha256) {
      throw new Error(`Source integrity check failed for ${localName}.`);
    }
    results.push({ local_name: localName, manifest_name: manifestName, bytes: actualSize, sha256: actualHash });
  }
  return results;
}

async function readDcgmCsv(path) {
  const input = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let columns = null;
  const rows = [];
  for await (const line of input) {
    if (!line) continue;
    if (!columns) {
      columns = line.split(",");
      continue;
    }
    const values = line.split(",");
    const raw = Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
    const epoch = asNumber(raw.ts);
    const power = asNumber(raw.power_w);
    const gpuId = raw.gpu_id;
    if (epoch === null || power === null || gpuId === undefined || gpuId === "") continue;
    const used = asNumber(raw.fb_used_mib);
    const free = asNumber(raw.fb_free_mib);
    const total = used !== null && free !== null ? used + free : null;
    rows.push({
      epoch,
      gpu_id: String(gpuId),
      power_w: power,
      sm_clock_mhz: asNumber(raw.sm_clock_mhz),
      gpu_util_pct: asNumber(raw.gpu_util_pct),
      memory_used_mb: used,
      memory_total_mb: total,
      memory_util_pct: total && total > 0 && used !== null ? (used / total) * 100 : null,
      temperature_c: asNumber(raw.gpu_temp_c),
    });
  }
  if (!rows.length) throw new Error(`No usable DCGM samples in ${basename(path)}.`);
  return rows;
}

function observedIntervals(rows) {
  const byGpu = new Map();
  for (const row of rows) {
    const values = byGpu.get(row.gpu_id) ?? [];
    values.push(row.epoch);
    byGpu.set(row.gpu_id, values);
  }
  const intervals = [];
  for (const values of byGpu.values()) {
    values.sort((left, right) => left - right);
    for (let index = 1; index < values.length; index += 1) {
      const interval = values[index] - values[index - 1];
      if (interval > 0 && interval < 10) intervals.push(interval);
    }
  }
  return intervals;
}

function powerStats(samples, interval, duration) {
  const buckets = new Map();
  for (const sample of samples) {
    const bucket = Math.round(sample.time_relative_s / Math.max(interval, 0.000001));
    const perGpu = buckets.get(bucket) ?? new Map();
    const values = perGpu.get(sample.gpu_id) ?? [];
    values.push(sample.power_w);
    perGpu.set(sample.gpu_id, values);
    buckets.set(bucket, perGpu);
  }
  const series = [...buckets.entries()].sort(([left], [right]) => left - right).map(([bucket, perGpu]) => ({
    time: bucket * interval,
    power: [...perGpu.values()].reduce((sum, values) => sum + values.reduce((inner, value) => inner + value, 0) / values.length, 0),
  }));
  const totals = series.map((point) => point.power);
  const ramps = [];
  let energyWh = 0;
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];
    const elapsed = current.time - previous.time;
    if (elapsed <= 0 || elapsed > 10) continue;
    energyWh += ((previous.power + current.power) / 2) * elapsed / 3_600;
    ramps.push((current.power - previous.power) / elapsed);
  }
  const upward = ramps.filter((value) => value > 0);
  const downward = ramps.filter((value) => value < 0).map(Math.abs);
  return {
    mean_total_power_w: rounded(totals.reduce((sum, value) => sum + value, 0) / Math.max(1, totals.length)),
    p95_total_power_w: rounded(percentile(totals, 0.95)),
    p99_total_power_w: rounded(percentile(totals, 0.99)),
    max_total_power_w: rounded(Math.max(...totals)),
    total_energy_wh: rounded(energyWh),
    ramp_up_p95_1s_w_per_s: rounded(percentile(upward, 0.95)),
    ramp_up_p99_1s_w_per_s: rounded(percentile(upward, 0.99)),
    ramp_down_p99_1s_w_per_s: rounded(percentile(downward, 0.99)),
    ramp_event_frequency_1s: rounded(ramps.filter((value) => Math.abs(value) >= 40).length / Math.max(1, duration), 6),
  };
}

function parseServerConfiguration(text) {
  const configuration = text.match(/Initializing a V1 LLM engine \(v([^)]*)\) with config: ([^\n]+)/)?.[2] ?? "";
  const extract = (pattern) => configuration.match(pattern)?.[1] ?? null;
  const model = extract(/model='([^']+)'/) ?? text.match(/model\s+([^\s]+)/)?.[1] ?? "Not reported";
  const dtype = extract(/dtype=([^,]+)/) ?? "Not reported";
  const tensorParallel = asNumber(extract(/tensor_parallel_size=(\d+)/));
  const kvCache = extract(/kv_cache_dtype=([^,]+)/);
  const quantization = extract(/quantization=([^,]+)/);
  const maxSequence = asNumber(extract(/max_seq_len=(\d+)/));
  const version = text.match(/Initializing a V1 LLM engine \(v([^)]*)\)/)?.[1] ?? null;
  return { model, dtype, tensorParallel, kvCache, quantization, maxSequence, version };
}

async function buildTimeline(metricsPath, traceStart, traceEnd, windowS = 5) {
  const input = createInterface({ input: createReadStream(metricsPath), crlfDelay: Infinity });
  const buckets = new Map();
  let previous = null;
  let firstTime = null;
  let lastTime = null;
  let maxActive = 0;
  let totalArrivals = 0;
  let totalCompleted = 0;

  for await (const line of input) {
    if (!line) continue;
    let metrics;
    try {
      metrics = JSON.parse(line);
    } catch {
      continue;
    }
    const timestamp = asNumber(metrics.ts);
    const active = (asNumber(metrics["vllm:num_requests_running"]) ?? 0) + (asNumber(metrics["vllm:num_requests_waiting"]) ?? 0);
    // Some vLLM exports leave request_success_total at zero while their
    // request-token histograms advance. The prompt-token observation count is
    // the usable completed-request counter for this source; it is paired with
    // the histogram sums so token sizes describe completed requests too.
    const successMetric = asNumber(metrics["vllm:request_success_total"]) ?? 0;
    const completed = asNumber(metrics["vllm:request_prompt_tokens_count"]);
    const success = completed !== null && completed > 0 ? completed : successMetric;
    const prompt = asNumber(metrics["vllm:request_prompt_tokens_sum"])
      ?? asNumber(metrics["vllm:prompt_tokens_total"]) ?? 0;
    const output = asNumber(metrics["vllm:request_generation_tokens_sum"])
      ?? asNumber(metrics["vllm:generation_tokens_total"]) ?? 0;
    if (timestamp === null) continue;

    const deltaSuccess = previous ? Math.max(0, success - previous.success) : 0;
    const deltaPrompt = previous ? Math.max(0, prompt - previous.prompt) : 0;
    const deltaOutput = previous ? Math.max(0, output - previous.output) : 0;
    const estimatedArrivals = previous ? Math.max(0, deltaSuccess + active - previous.active) : 0;
    previous = { active, success, prompt, output };

    if (timestamp < traceStart || timestamp > traceEnd) continue;
    const relative = timestamp - traceStart;
    const bucketTime = Math.floor(relative / windowS) * windowS;
    const bucket = buckets.get(bucketTime) ?? {
      time_relative_s: bucketTime,
      window_s: windowS,
      requests_arrived: 0,
      active_requests: null,
      completed: 0,
      prompt_tokens: 0,
      output_tokens: 0,
    };
    bucket.requests_arrived += estimatedArrivals;
    bucket.active_requests = active;
    bucket.completed += deltaSuccess;
    bucket.prompt_tokens += deltaPrompt;
    bucket.output_tokens += deltaOutput;
    buckets.set(bucketTime, bucket);
    firstTime ??= relative;
    lastTime = relative;
    maxActive = Math.max(maxActive, active);
    totalArrivals += estimatedArrivals;
    totalCompleted += deltaSuccess;
  }

  const rows = [...buckets.values()].sort((left, right) => left.time_relative_s - right.time_relative_s).map((bucket) => {
    const meanPrompt = bucket.completed > 0 ? bucket.prompt_tokens / bucket.completed : null;
    const meanOutput = bucket.completed > 0 ? bucket.output_tokens / bucket.completed : null;
    return {
      time_relative_s: rounded(bucket.time_relative_s),
      window_s: windowS,
      requests_arrived: Math.round(bucket.requests_arrived),
      active_requests: bucket.active_requests === null ? null : Math.round(bucket.active_requests),
      mean_prompt_tokens: rounded(meanPrompt),
      mean_output_tokens: rounded(meanOutput),
      mean_request_tokens: rounded(meanPrompt === null && meanOutput === null ? null : (meanPrompt ?? 0) + (meanOutput ?? 0)),
    };
  });
  if (!rows.length) throw new Error("No vLLM metrics snapshots overlapped the DCGM trace.");
  return {
    rows,
    maxActive,
    totalArrivals,
    totalCompleted,
    observedSeconds: Math.max(0, (lastTime ?? 0) - (firstTime ?? 0)),
  };
}

function modelFamily(model) {
  const value = model.toLowerCase();
  if (value.includes("llama-3.1")) return "Llama-3.1";
  if (value.includes("llama")) return "Llama";
  return "Not reported";
}

async function build() {
  const source = resolve(required(argument("--source"), "--source"));
  const output = resolve(required(argument("--output"), "--output"));
  const manifest = JSON.parse(await readFile(join(source, "checksums.json"), "utf8"));
  const runId = required(manifest.cell_id, "checksums.json cell_id");
  const sourceFiles = await verifySourceFiles(source, manifest, runId);
  const [gpu0, gpu1, instanceFacts, serverLog] = await Promise.all([
    readDcgmCsv(join(source, "dcgm_gpu0.csv")),
    readDcgmCsv(join(source, "dcgm_gpu1.csv")),
    readFile(join(source, "instance_facts.json"), "utf8").then(JSON.parse),
    readFile(join(source, "vllm_server.log"), "utf8"),
  ]);
  const sourceRows = [...gpu0, ...gpu1];
  const traceStart = Math.min(...sourceRows.map((row) => row.epoch));
  const traceEnd = Math.max(...sourceRows.map((row) => row.epoch));
  const duration = traceEnd - traceStart;
  const intervals = observedIntervals(sourceRows);
  const samplingMedian = median(intervals) ?? 0;
  const samplingP95 = percentile(intervals, 0.95) ?? samplingMedian;
  const samples = sourceRows.map((row) => ({
    run_id: runId,
    timestamp: new Date(row.epoch * 1_000).toISOString(),
    time_relative_s: rounded(row.epoch - traceStart, 6),
    gpu_id: row.gpu_id,
    power_w: rounded(row.power_w),
    sm_clock_mhz: rounded(row.sm_clock_mhz),
    gpu_util_pct: rounded(row.gpu_util_pct),
    memory_util_pct: rounded(row.memory_util_pct),
    memory_used_mb: rounded(row.memory_used_mb),
    memory_total_mb: rounded(row.memory_total_mb),
    temperature_c: rounded(row.temperature_c),
    stage: null,
  })).sort((left, right) => left.time_relative_s - right.time_relative_s || Number(left.gpu_id) - Number(right.gpu_id));
  const timeline = await buildTimeline(join(source, "vllm_metrics.jsonl"), traceStart, traceEnd);
  const server = parseServerConfiguration(serverLog);
  const stats = powerStats(samples, samplingMedian || 0.1, duration);
  const reportedGpuType = instanceFacts.gpu_csv?.match(/^(NVIDIA [^,]+)/m)?.[1] ?? "NVIDIA H200";
  // Keep catalog filtering consistent with the established hardware taxonomy
  // while preserving the source-reported vendor name in the metadata record.
  const gpuType = reportedGpuType.replace(/^NVIDIA\s+/i, "");
  const gpuIds = [...new Set(samples.map((sample) => sample.gpu_id))];
  const sourceDirectory = `LLM-Power-Runs-Main / Runs/${manifest.dest}`;
  const arrivalRate = timeline.observedSeconds > 0 ? timeline.totalArrivals / timeline.observedSeconds : null;
  const run = {
    run_id: runId,
    workload_type: "Inference",
    source_family: "LLM-Power-Runs-Main",
    source_directory: sourceDirectory,
    trace_path: `raw/${runId}.csv`,
    stdout_path: null,
    stderr_path: null,
    plot_path: null,
    meta_path: `metadata/${runId}.json`,
    model: server.model,
    model_family: modelFamily(server.model),
    model_source_label: "vLLM server configuration",
    model_metadata_status: "reported",
    method: "vLLM serving",
    inference_engine: server.version ? `vLLM ${server.version}` : "vLLM",
    tensor_parallel_size: server.tensorParallel,
    kv_cache_quantization: server.kvCache ?? "Not reported",
    model_weight_quantization: server.quantization === "None" ? "None" : (server.quantization ?? "Not reported"),
    gpu_frequency_mhz: null,
    in_flight_requests: timeline.maxActive || null,
    concurrency: timeline.maxActive || null,
    arrival_pattern: "BurstGPT peak-arrival (unbounded)",
    arrival_rate_rps: rounded(arrivalRate),
    arrival_rate_label: arrivalRate === null ? "Derived vLLM counters unavailable" : `Derived from vLLM request-token counters · ${rounded(arrivalRate, 2)} req/s`,
    prompt_profile: "Not reported; cumulative vLLM token counters are available",
    gpu_type: gpuType,
    gpu_model_reported: reportedGpuType,
    gpu_count: gpuIds.length,
    precision: server.dtype === "torch.bfloat16" ? "BF16" : server.dtype,
    compute_dtype: server.dtype === "torch.bfloat16" ? "bfloat16" : server.dtype,
    quantization_bits: server.quantization === "None" ? "None" : (server.quantization ?? "Not reported"),
    parallelism: `DP=1, TP=${server.tensorParallel ?? "Not reported"}, PP=1`,
    sequence_length: server.maxSequence ? `Max ${server.maxSequence.toLocaleString()} tokens` : "Not reported",
    microbatch_size: "Not applicable",
    grad_accum_steps: "Not applicable",
    global_batch_size: "Not applicable",
    checkpoint_interval: "Not applicable",
    dataset_name: "BurstGPT",
    duration_declared_min: "Not reported",
    duration_observed_s: rounded(duration),
    sampling_interval_declared_s: "Not reported",
    sampling_interval_observed_median_s: rounded(samplingMedian, 6),
    sampling_interval_observed_p95_s: rounded(samplingP95, 6),
    has_stage_labels: false,
    has_clock_telemetry: samples.some((sample) => sample.sm_clock_mhz !== null),
    has_utilization_telemetry: samples.some((sample) => sample.gpu_util_pct !== null),
    has_temperature_telemetry: samples.some((sample) => sample.temperature_c !== null),
    quality_status: "PASS_MAIN",
    ...stats,
    mean_power_per_gpu_w: rounded((stats.mean_total_power_w ?? 0) / Math.max(1, gpuIds.length)),
    num_samples: samples.length,
    num_gpus_observed: gpuIds.length,
    logging_method: "DCGM per-GPU telemetry with vLLM metrics snapshots",
    power_aggregation: "per_gpu",
    quality_flags: [
      {
        code: "source_checksums_verified",
        severity: "info",
        message: "The selected DCGM, instance-facts, vLLM metrics, and server-log files match the source SHA-256 manifest.",
      },
      {
        code: "arrivals_derived_from_vllm_counters",
        severity: "info",
        message: "Requests-arrived values are derived from changes in vLLM active requests and the vLLM request-token histogram count; raw per-request arrival events were not supplied.",
      },
    ],
    missing_fields: ["Raw per-request arrival events", "Configured GPU frequency"],
    timestamp_issues: [],
    gpu_count_mismatch: false,
    duplicate_warning: false,
    run_json_path: `runs/${runId}.json`,
    raw_csv_path: `raw/${runId}.csv`,
    metadata_json_path: `metadata/${runId}.json`,
    request_timeline_path: `requests/${runId}.csv`,
    source_integrity: {
      manifest_file: "checksums.json",
      verified_files: sourceFiles,
      incomplete_manifest_entries: manifest.incomplete ?? [],
    },
    request_timeline_method: "5-second bins derived from vLLM Prometheus cumulative counters",
    requests_completed: timeline.totalCompleted,
    requests_arrived_derived: timeline.totalArrivals,
  };
  const detailTemplate = { run, samples, inference_timeline: timeline.rows };
  const validation = {
    run_id: runId,
    source_manifest_cell_id: manifest.cell_id,
    source_file_integrity: "passed",
    verified_source_files: sourceFiles,
    canonical_sample_count: samples.length,
    request_timeline_rows: timeline.rows.length,
    observed_gpu_ids: gpuIds,
    observed_duration_s: rounded(duration),
    vllm_request_summary: {
      max_active_requests: timeline.maxActive,
      completed_requests_counter_delta: timeline.totalCompleted,
      derived_arrivals: timeline.totalArrivals,
    },
  };
  for (const directory of ["raw", "metadata", "requests", "runs"]) await mkdir(join(output, directory), { recursive: true });
  await Promise.all([
    writeFile(join(output, "raw", `${runId}.csv`), csvText(CANONICAL_COLUMNS, samples)),
    writeFile(join(output, "metadata", `${runId}.json`), `${JSON.stringify(run, null, 2)}\n`),
    writeFile(join(output, "requests", `${runId}.csv`), csvText(TIMELINE_COLUMNS, timeline.rows)),
    writeFile(join(output, "detail-template.json"), JSON.stringify(detailTemplate)),
    writeFile(join(output, "package-validation.json"), `${JSON.stringify(validation, null, 2)}\n`),
  ]);
  console.log(JSON.stringify({
    status: "built",
    run_id: runId,
    output,
    canonical_samples: samples.length,
    request_timeline_rows: timeline.rows.length,
    source_checksum_verification: "passed",
  }, null, 2));
}

async function finalize() {
  const output = resolve(required(argument("--output"), "--output"));
  const rawFileId = required(argument("--raw-file-id"), "--raw-file-id");
  const metadataFileId = required(argument("--metadata-file-id"), "--metadata-file-id");
  const requestFileId = required(argument("--request-file-id"), "--request-file-id");
  const runFileId = argument("--run-file-id", "");
  const template = JSON.parse(await readFile(join(output, "detail-template.json"), "utf8"));
  const runId = template.run.run_id;
  const publicRun = {
    ...template.run,
    source_directory: "Google Drive public data store / LLM-Power-Runs-Main",
    trace_path: `Google Drive / raw / ${runId}.csv`,
    meta_path: `Google Drive / metadata / ${runId}.json`,
    raw_csv_file_id: rawFileId,
    metadata_json_file_id: metadataFileId,
    request_timeline_file_id: requestFileId,
    run_json_file_id: runFileId,
  };
  const detail = { ...template, run: publicRun };
  await writeFile(join(output, "runs", `${runId}.json`), JSON.stringify(detail));
  const catalogPath = argument("--catalog");
  const catalogBase64 = argument("--catalog-base64");
  if (catalogPath || catalogBase64) {
    if (!runFileId) throw new Error("--run-file-id is required when writing a catalog.");
    const catalog = catalogBase64
      ? JSON.parse(Buffer.from(catalogBase64, "base64").toString("utf8"))
      : JSON.parse(await readFile(resolve(catalogPath), "utf8"));
    const nextCatalog = [publicRun, ...catalog.filter((entry) => entry.run_id !== runId)];
    await writeFile(join(output, "catalog.json"), `${JSON.stringify(nextCatalog, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    status: "finalized",
    run_id: runId,
    run_json: join(output, "runs", `${runId}.json`),
    catalog_written: Boolean(catalogPath || catalogBase64),
  }, null, 2));
}

const command = process.argv[2];
if (command === "build") await build();
else if (command === "finalize") await finalize();
else {
  usage();
  process.exitCode = 1;
}

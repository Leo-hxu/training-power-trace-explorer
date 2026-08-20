import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const dataRoot = resolve(process.argv[2] ?? "github-pages/public-data");
const runId = "synthetic-showcase-h100-inference-burstgpt-v1";
const durationS = 600;
const gpuCount = 4;
const origin = Date.UTC(2026, 7, 18, 13, 30, 0);

const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));
const percentile = (values, p) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
};

function phaseAt(time) {
  if (time < 30) return "engine_initialization";
  if (time < 90) return "model_load_and_kv_warmup";
  if (time < 190) return "usual_traffic_window";
  if (time < 280) return "burstgpt_burst_window";
  if (time < 410) return "peak_mean_arrival_window";
  if (time < 540) return "usual_traffic_window";
  return "request_drain";
}

function telemetry(time, gpu) {
  const stage = phaseAt(time);
  const wave = 11 * Math.sin(time / 8.5 + gpu * 0.8) + 7 * Math.sin(time / 3.1 + gpu * 1.4);
  const gpuOffset = (gpu - 1.5) * 8;
  let power;
  let util;
  let memory;
  let clock;

  if (stage === "engine_initialization") {
    power = 79 + gpuOffset + wave * 0.15;
    util = 6 + time * 0.35 + gpu;
    memory = 4_300 + time * 280 + gpu * 180;
    clock = 315 + time * 16;
  } else if (stage === "model_load_and_kv_warmup") {
    const progress = (time - 30) / 60;
    power = 185 + progress * 160 + gpuOffset + wave * 0.55;
    util = 28 + progress * 45 + wave * 0.3;
    memory = 17_000 + progress * 37_000 + gpu * 250;
    clock = 830 + progress * 580 + wave * 2;
  } else if (stage === "burstgpt_burst_window") {
    power = 525 + gpuOffset + wave * 1.3;
    util = 94 + wave * 0.18;
    memory = 62_000 + gpu * 280 + wave * 13;
    clock = 1_410 + wave * 3;
  } else if (stage === "peak_mean_arrival_window") {
    power = 438 + gpuOffset + wave;
    util = 78 + wave * 0.4;
    memory = 60_400 + gpu * 280 + wave * 12;
    clock = 1_410 + wave * 2;
  } else if (stage === "usual_traffic_window") {
    power = 326 + gpuOffset + wave * 0.85;
    util = 57 + wave * 0.42;
    memory = 55_800 + gpu * 260 + wave * 10;
    clock = 1_410 + wave * 1.5;
  } else {
    const progress = (time - 540) / 60;
    power = 285 - progress * 180 + gpuOffset + wave * 0.4;
    util = 46 - progress * 34 + wave * 0.25;
    memory = 55_000 - progress * 20_000 + gpu * 240;
    clock = 1_410 - progress * 760 + wave;
  }

  const memoryTotal = 81_920;
  const boundedPower = clamp(power, 65, 610);
  return {
    stage,
    power_w: round(boundedPower),
    gpu_util_pct: round(clamp(util, 0, 100), 1),
    memory_used_mb: Math.round(clamp(memory, 0, memoryTotal)),
    memory_total_mb: memoryTotal,
    memory_util_pct: round((clamp(memory, 0, memoryTotal) / memoryTotal) * 100, 1),
    sm_clock_mhz: Math.round(clamp(clock, 300, 1_410)),
    temperature_c: round(clamp(38 + boundedPower * 0.064 + 2.2 * Math.sin(time / 78 + gpu), 38, 78), 1),
  };
}

const samples = [];
const totals = [];
for (let time = 0; time <= durationS; time += 1) {
  const tick = [];
  for (let gpu = 0; gpu < gpuCount; gpu += 1) {
    tick.push({
      run_id: runId,
      timestamp: new Date(origin + time * 1_000 + gpu * 2).toISOString(),
      time_relative_s: round(time + gpu * 0.002, 3),
      gpu_id: String(gpu),
      ...telemetry(time, gpu),
    });
  }
  totals.push(round(tick.reduce((sum, row) => sum + row.power_w, 0)));
  samples.push(...tick);
}

const energyWh = totals.slice(1).reduce((sum, value, index) => sum + ((value + totals[index]) / 2) / 3600, 0);
const ramps = totals.slice(1).map((value, index) => value - totals[index]);
const upward = ramps.filter((value) => value > 0);
const downward = ramps.filter((value) => value < 0).map((value) => Math.abs(value));
const meanTotal = totals.reduce((sum, value) => sum + value, 0) / totals.length;

const run = {
  run_id: runId,
  workload_type: "Inference",
  source_family: "Synthetic showcase",
  source_directory: "Illustrative deterministic inference telemetry; not a measured research run",
  trace_path: `raw/${runId}.csv`,
  stdout_path: null,
  stderr_path: null,
  plot_path: null,
  meta_path: `metadata/${runId}.json`,
  model: "meta-llama/Llama-3.1-8B-Instruct",
  model_family: "llama31-instruct",
  model_source_label: "synthetic inference showcase",
  model_metadata_status: "reported",
  method: "vLLM serving",
  inference_engine: "vLLM (synthetic configuration)",
  tensor_parallel_size: 4,
  kv_cache_quantization: "FP8",
  model_weight_quantization: "FP8",
  gpu_frequency_mhz: 1410,
  in_flight_requests: 48,
  concurrency: 48,
  arrival_pattern: "BurstGPT serving window",
  arrival_rate_rps: 24,
  arrival_rate_label: "Burst window · 24 req/s",
  prompt_profile: "BurstGPT representative request mix",
  gpu_type: "H100 SXM",
  gpu_count: gpuCount,
  precision: "FP8",
  compute_dtype: "fp8",
  quantization_bits: "FP8 weights + FP8 KV cache",
  parallelism: "DP=1, TP=4, PP=1",
  sequence_length: "Request-dependent",
  microbatch_size: "N/A",
  grad_accum_steps: "N/A",
  global_batch_size: "N/A",
  checkpoint_interval: "N/A",
  dataset_name: "Synthetic BurstGPT request window",
  duration_declared_min: 10,
  duration_observed_s: durationS,
  sampling_interval_declared_s: 1,
  sampling_interval_observed_median_s: 1,
  sampling_interval_observed_p95_s: 1,
  has_stage_labels: true,
  has_clock_telemetry: true,
  has_utilization_telemetry: true,
  has_temperature_telemetry: true,
  quality_status: "DEMO_SYNTHETIC",
  mean_total_power_w: round(meanTotal, 3),
  p95_total_power_w: round(percentile(totals, 0.95), 3),
  p99_total_power_w: round(percentile(totals, 0.99), 3),
  max_total_power_w: round(Math.max(...totals), 3),
  total_energy_wh: round(energyWh, 3),
  mean_power_per_gpu_w: round(meanTotal / gpuCount, 3),
  ramp_up_p95_1s_w_per_s: round(percentile(upward, 0.95), 3),
  ramp_up_p99_1s_w_per_s: round(percentile(upward, 0.99), 3),
  ramp_down_p99_1s_w_per_s: round(percentile(downward, 0.99), 3),
  ramp_event_frequency_1s: round(ramps.filter((value) => Math.abs(value) > 40).length / durationS, 4),
  num_samples: samples.length,
  num_gpus_observed: gpuCount,
  logging_method: "deterministic synthetic telemetry generator",
  power_aggregation: "per_gpu",
  quality_flags: [{
    code: "synthetic_inference_demo",
    severity: "info",
    message: "Illustrative deterministic inference telemetry using the serving-parameter taxonomy supplied by Jaskeerat Singh; not a measured inference run.",
  }],
  missing_fields: [],
  timestamp_issues: [],
  gpu_count_mismatch: false,
  duplicate_warning: false,
  run_json_path: `runs/${runId}.json`,
  raw_csv_path: `raw/${runId}.csv`,
  metadata_json_path: `metadata/${runId}.json`,
};

const csvColumns = ["run_id", "timestamp", "time_relative_s", "gpu_id", "power_w", "sm_clock_mhz", "gpu_util_pct", "memory_util_pct", "memory_used_mb", "memory_total_mb", "temperature_c", "stage"];
const csv = [csvColumns.join(","), ...samples.map((sample) => csvColumns.map((column) => sample[column]).join(","))].join("\n") + "\n";
const catalogPath = join(dataRoot, "catalog.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8")).filter((entry) => entry.run_id !== runId);
catalog.unshift(run);
const auditPath = join(dataRoot, "publication-audit.json");
let audit = {};
try {
  audit = JSON.parse(await readFile(auditPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
audit.published_runs = catalog.length;
audit.synthetic_showcase_runs = catalog.filter((entry) => entry.quality_status === "DEMO_SYNTHETIC").length;
audit.synthetic_showcase_policy = "Clearly labeled deterministic training and inference traces are included solely to demonstrate complete interface telemetry; they are not measured research runs.";
audit.inference_parameter_taxonomy = ["TP number", "KV cache quantization", "model weight quantization", "GPU frequency", "in-flight requests or concurrency", "GPU", "model", "arrival rate (BurstGPT only)"];

for (const path of [join(dataRoot, "runs", `${runId}.json`), join(dataRoot, "metadata", `${runId}.json`), join(dataRoot, "raw", `${runId}.csv`)]) await mkdir(dirname(path), { recursive: true });
await Promise.all([
  writeFile(join(dataRoot, "runs", `${runId}.json`), `${JSON.stringify({ run, samples }, null, 2)}\n`),
  writeFile(join(dataRoot, "metadata", `${runId}.json`), `${JSON.stringify(run, null, 2)}\n`),
  writeFile(join(dataRoot, "raw", `${runId}.csv`), csv),
  writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
  writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`),
]);

console.log(`Generated ${samples.length} samples for ${runId}.`);

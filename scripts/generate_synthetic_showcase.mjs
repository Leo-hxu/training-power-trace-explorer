import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const dataRoot = "github-pages/public-data";
const runId = "synthetic-showcase-h100-4gpu-full-telemetry-v1";
const durationS = 900;
const gpuCount = 4;
const origin = Date.UTC(2026, 0, 15, 14, 0, 0);

const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));
const percentile = (values, p) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
};

function phaseAt(time) {
  if (time < 35) return "initialization";
  if (time < 110) return "warmup";
  if (time >= 300 && time < 315) return "data_loader_stall";
  if (time >= 420 && time < 455) return "checkpoint_save";
  if (time >= 660 && time < 705) return "evaluation";
  return "steady_training";
}

function telemetry(time, gpu) {
  const stage = phaseAt(time);
  const wave = 10 * Math.sin(time / 13 + gpu * 0.9) + 6 * Math.sin(time / 4.7 + gpu * 1.7);
  const gpuOffset = (gpu - 1.5) * 7;
  let power;
  let util;
  let memory;
  let clock;

  if (stage === "initialization") {
    power = 82 + gpuOffset + wave * 0.18;
    util = 8 + time * 0.25 + gpu;
    memory = 5_500 + time * 150 + gpu * 220;
    clock = 300 + time * 15;
  } else if (stage === "warmup") {
    const progress = (time - 35) / 75;
    power = 190 + progress * 280 + gpuOffset + wave;
    util = 32 + progress * 58 + wave * 0.5;
    memory = 11_000 + progress * 43_000 + gpu * 260;
    clock = 980 + progress * 940 + wave * 2;
  } else if (stage === "data_loader_stall") {
    power = 205 + gpuOffset + wave * 0.8;
    util = 18 + Math.max(0, wave * 0.3);
    memory = 55_300 + gpu * 280 + wave * 10;
    clock = 1_080 + wave * 3;
  } else if (stage === "checkpoint_save") {
    power = 235 + gpuOffset + wave * 0.65;
    util = 22 + Math.max(0, wave * 0.35);
    memory = 63_500 + gpu * 250 + wave * 10;
    clock = 1_180 + wave * 4;
  } else if (stage === "evaluation") {
    power = 340 + gpuOffset + wave * 0.9;
    util = 57 + wave * 0.4;
    memory = 60_600 + gpu * 240 + wave * 8;
    clock = 1_480 + wave * 5;
  } else {
    const workload = 14 * Math.sin(time / 55) + 7 * Math.sin(time / 11.5 + gpu);
    power = 510 + gpuOffset + workload + wave;
    util = 94 + workload * 0.16 + wave * 0.15;
    memory = 57_500 + ((time % 160) / 160) * 5_800 + gpu * 280 + workload * 12;
    clock = 1_935 + workload * 1.7 + wave * 2.2;
  }

  const temperature = stage === "initialization"
    ? 35 + time * 0.34 + gpu * 0.6
    : clamp(46 + power * 0.056 + 2.4 * Math.sin(time / 82 + gpu), 46, 78);
  const memoryTotal = 81_920;
  return {
    stage,
    power_w: round(clamp(power, 65, 620)),
    gpu_util_pct: round(clamp(util, 0, 100), 1),
    memory_used_mb: Math.round(clamp(memory, 0, memoryTotal)),
    memory_total_mb: memoryTotal,
    memory_util_pct: round((clamp(memory, 0, memoryTotal) / memoryTotal) * 100, 1),
    sm_clock_mhz: Math.round(clamp(clock, 300, 2_100)),
    temperature_c: round(temperature, 1),
  };
}

const samples = [];
const totals = [];
for (let time = 0; time <= durationS; time += 1) {
  const tick = [];
  for (let gpu = 0; gpu < gpuCount; gpu += 1) {
    const relative = round(time + gpu * 0.002, 3);
    const row = {
      run_id: runId,
      timestamp: new Date(origin + time * 1_000 + gpu * 2).toISOString(),
      time_relative_s: relative,
      gpu_id: String(gpu),
      ...telemetry(time, gpu),
    };
    tick.push(row);
  }
  const total = round(tick.reduce((sum, row) => sum + row.power_w, 0));
  tick.forEach((row) => samples.push({ ...row, total_power_w: total }));
  totals.push(total);
}

const energyWh = totals.slice(1).reduce((sum, value, index) => sum + ((value + totals[index]) / 2) / 3600, 0);
const ramps = totals.slice(1).map((value, index) => value - totals[index]);
const upward = ramps.filter((value) => value > 0);
const downward = ramps.filter((value) => value < 0).map((value) => Math.abs(value));
const meanTotal = totals.reduce((sum, value) => sum + value, 0) / totals.length;

const run = {
  run_id: runId,
  source_family: "Synthetic showcase",
  source_directory: "Illustrative deterministic telemetry; not a measured research run",
  trace_path: `raw/${runId}.csv`,
  stdout_path: null,
  stderr_path: null,
  plot_path: null,
  meta_path: `metadata/${runId}.json`,
  model: "Llama-3.1-8B",
  model_family: "llama3",
  method: "full fine-tuning",
  gpu_type: "H100 SXM",
  gpu_count: gpuCount,
  precision: "bf16",
  compute_dtype: "torch.bfloat16",
  quantization_bits: "None",
  parallelism: "DP=1, TP=4, PP=1",
  sequence_length: 4096,
  microbatch_size: 2,
  grad_accum_steps: 8,
  global_batch_size: 16,
  checkpoint_interval: 420,
  dataset_name: "Synthetic instruction mix",
  duration_declared_min: 15,
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
    code: "synthetic_demo",
    severity: "info",
    message: "Illustrative deterministic telemetry created to demonstrate every public visualization field; not a measured training run.",
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
const audit = JSON.parse(await readFile(auditPath, "utf8"));
audit.published_runs = catalog.length;
audit.synthetic_showcase_runs = 1;
audit.synthetic_showcase_policy = "One deterministic, clearly labeled full-telemetry trace is included solely to demonstrate the interface; it is not counted as reviewed research data.";

for (const path of [join(dataRoot, "runs", `${runId}.json`), join(dataRoot, "metadata", `${runId}.json`), join(dataRoot, "raw", `${runId}.csv`)]) await mkdir(dirname(path), { recursive: true });
await Promise.all([
  writeFile(join(dataRoot, "runs", `${runId}.json`), `${JSON.stringify({ run, samples }, null, 2)}\n`),
  writeFile(join(dataRoot, "metadata", `${runId}.json`), `${JSON.stringify(run, null, 2)}\n`),
  writeFile(join(dataRoot, "raw", `${runId}.csv`), csv),
  writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
  writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`),
]);

console.log(`Generated ${samples.length} samples for ${runId}.`);

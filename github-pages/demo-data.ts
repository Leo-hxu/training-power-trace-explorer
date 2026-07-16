import type { Run, Sample } from "../app/lib/types";

type DemoConfig = {
  run: Run;
  gpuCount: number;
  duration: number;
  interval: number;
  basePower: number;
  amplitude: number;
  stageBreaks: [number, string][];
};

function makeRun(partial: Partial<Run> & Pick<Run, "run_id" | "source_family" | "model" | "model_family" | "method" | "gpu_type" | "quality_status">): Run {
  return {
    source_directory: "Synthetic public demo",
    trace_path: `demo://${partial.run_id}/power_trace.csv`,
    stdout_path: `demo://${partial.run_id}/train.log`,
    stderr_path: null,
    plot_path: null,
    meta_path: `demo://${partial.run_id}/meta.json`,
    gpu_count: 1,
    precision: "BF16",
    compute_dtype: "bfloat16",
    quantization_bits: "Unknown",
    parallelism: "Single GPU",
    sequence_length: 2048,
    microbatch_size: 2,
    grad_accum_steps: 8,
    global_batch_size: 16,
    checkpoint_interval: 100,
    dataset_name: "Synthetic research demo",
    duration_declared_min: 1,
    duration_observed_s: 60,
    sampling_interval_declared_s: 0.2,
    sampling_interval_observed_median_s: 0.2,
    sampling_interval_observed_p95_s: 0.21,
    has_stage_labels: true,
    has_clock_telemetry: true,
    has_utilization_telemetry: true,
    has_temperature_telemetry: true,
    mean_total_power_w: 480,
    p95_total_power_w: 650,
    p99_total_power_w: 690,
    max_total_power_w: 710,
    total_energy_wh: 8.1,
    mean_power_per_gpu_w: 240,
    ramp_up_p95_1s_w_per_s: 95,
    ramp_up_p99_1s_w_per_s: 140,
    ramp_down_p99_1s_w_per_s: 132,
    ramp_event_frequency_1s: 4.2,
    num_samples: 600,
    num_gpus_observed: 1,
    logging_method: "Synthetic nvidia-smi compatible logger",
    power_aggregation: "Raw synthetic samples",
    quality_flags: [],
    missing_fields: [],
    timestamp_issues: [],
    gpu_count_mismatch: false,
    duplicate_warning: false,
    ...partial,
  };
}

const configs: DemoConfig[] = [
  {
    run: makeRun({
      run_id: "trace2flex_h100_v1_C001",
      source_family: "trace2flex",
      model: "Llama-3-8B",
      model_family: "Llama 3",
      method: "FSDP",
      gpu_type: "H100 SXM",
      gpu_count: 4,
      parallelism: "FSDP × 4",
      sequence_length: 4096,
      global_batch_size: 64,
      duration_observed_s: 48,
      duration_declared_min: 0.8,
      mean_total_power_w: 1710,
      p95_total_power_w: 1958,
      p99_total_power_w: 1971,
      max_total_power_w: 1985,
      total_energy_wh: 22.6,
      mean_power_per_gpu_w: 427.5,
      ramp_up_p99_1s_w_per_s: 441,
      ramp_down_p99_1s_w_per_s: 508,
      num_samples: 960,
      num_gpus_observed: 4,
      quality_status: "Good",
    }),
    gpuCount: 4,
    duration: 48,
    interval: 0.2,
    basePower: 410,
    amplitude: 48,
    stageBreaks: [[0, "WARMUP"], [5, "FORWARD"], [14, "BACKWARD"], [24, "STEP"], [31, "CKPT"], [35, "FORWARD"]],
  },
  {
    run: makeRun({
      run_id: "powertraces_l40s_qlora_014",
      source_family: "PowerTraces",
      model: "Mistral-7B",
      model_family: "Mistral",
      method: "QLoRA",
      gpu_type: "L40S",
      gpu_count: 2,
      precision: "NF4 / BF16",
      quantization_bits: 4,
      parallelism: "Data parallel × 2",
      microbatch_size: 4,
      grad_accum_steps: 4,
      duration_observed_s: 42,
      sampling_interval_declared_s: 0.5,
      sampling_interval_observed_median_s: 0.5,
      sampling_interval_observed_p95_s: 0.5,
      mean_total_power_w: 536,
      p95_total_power_w: 615,
      p99_total_power_w: 621,
      max_total_power_w: 628,
      total_energy_wh: 6.22,
      mean_power_per_gpu_w: 268,
      num_samples: 168,
      num_gpus_observed: 2,
      quality_status: "Good",
    }),
    gpuCount: 2,
    duration: 42,
    interval: 0.5,
    basePower: 260,
    amplitude: 34,
    stageBreaks: [[0, "WARMUP"], [4, "FORWARD"], [13, "BACKWARD"], [21, "STEP"], [26, "CKPT"], [30, "FORWARD"]],
  },
  {
    run: makeRun({
      run_id: "legacy_a100_llama2_7b_lora",
      source_family: "Legacy",
      model: "Llama-2-7B",
      model_family: "Llama 2",
      method: "LoRA",
      gpu_type: "A100",
      gpu_count: 1,
      precision: "Unknown",
      compute_dtype: "Unknown",
      parallelism: "Unknown",
      duration_observed_s: 30,
      sampling_interval_declared_s: "Unknown",
      sampling_interval_observed_median_s: 0.31,
      sampling_interval_observed_p95_s: 0.34,
      mean_total_power_w: 294,
      p95_total_power_w: 347,
      p99_total_power_w: 350,
      max_total_power_w: 353,
      total_energy_wh: 2.43,
      mean_power_per_gpu_w: 294,
      num_samples: 97,
      num_gpus_observed: 1,
      quality_status: "Warning",
      quality_flags: [{
        code: "missing_metadata",
        severity: "warning",
        message: "No confirmed metadata file is available for this synthetic legacy example.",
      }],
      missing_fields: ["precision"],
    }),
    gpuCount: 1,
    duration: 30,
    interval: 0.31,
    basePower: 285,
    amplitude: 43,
    stageBreaks: [[0, "WARMUP"], [4, "FORWARD"], [12, "BACKWARD"], [22, "STEP"]],
  },
];

function currentStage(time: number, breaks: [number, string][]) {
  return breaks.filter(([at]) => at <= time).at(-1)?.[1] ?? "WARMUP";
}

function generateSamples(config: DemoConfig): Sample[] {
  const rows: Sample[] = [];
  const start = Date.parse("2026-07-12T08:30:00Z");
  for (let time = 0; time <= config.duration + 0.0001; time += config.interval) {
    const rounded = Number(time.toFixed(3));
    const perGpu: Sample[] = [];
    for (let gpu = 0; gpu < config.gpuCount; gpu += 1) {
      const ramp = Math.min(1, rounded / 4);
      const checkpointDrop = currentStage(rounded, config.stageBreaks) === "CKPT" ? 68 : 0;
      const wave = Math.sin(rounded * 0.9 + gpu * 0.58) * config.amplitude;
      const power = Math.max(48, config.basePower * (0.3 + ramp * 0.7) + wave - checkpointDrop + gpu * 3.5);
      perGpu.push({
        timestamp: new Date(start + rounded * 1000).toISOString(),
        time_relative_s: rounded,
        gpu_id: String(gpu),
        power_w: Number(power.toFixed(2)),
        sm_clock_mhz: Math.round(1180 + 160 * Math.sin(rounded / 3 + gpu)),
        gpu_util_pct: Number(Math.min(99, 22 + power / 4.1).toFixed(1)),
        memory_util_pct: Number((54 + 8 * Math.sin(rounded / 4 + gpu)).toFixed(1)),
        memory_used_mb: 48000 + gpu * 320,
        memory_total_mb: config.run.gpu_type.includes("H100") ? 81559 : 46068,
        temperature_c: Number((48 + power / 27).toFixed(1)),
        stage: currentStage(rounded, config.stageBreaks),
      });
    }
    const total = perGpu.reduce((sum, row) => sum + row.power_w, 0);
    perGpu.forEach((row) => { row.total_power_w = Number(total.toFixed(2)); });
    rows.push(...perGpu);
  }
  return rows;
}

export const DEMO_RUNS = configs.map(({ run }) => run);
export const DEMO_SAMPLES: Record<string, Sample[]> = Object.fromEntries(
  configs.map((config) => [config.run.run_id, generateSamples(config)]),
);


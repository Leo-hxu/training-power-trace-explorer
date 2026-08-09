export type QualityFlag = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
};

export type Run = {
  run_id: string;
  source_family: string;
  source_directory: string;
  trace_path: string;
  stdout_path?: string | null;
  stderr_path?: string | null;
  plot_path?: string | null;
  meta_path?: string | null;
  model: string;
  model_family: string;
  method: string;
  gpu_type: string;
  gpu_count: string | number;
  precision: string;
  compute_dtype: string;
  quantization_bits: string | number;
  parallelism: string;
  sequence_length: string | number;
  microbatch_size: string | number;
  grad_accum_steps: string | number;
  global_batch_size: string | number;
  checkpoint_interval: string | number;
  dataset_name: string;
  duration_declared_min: string | number;
  duration_observed_s: number;
  sampling_interval_declared_s: string | number;
  sampling_interval_observed_median_s: number;
  sampling_interval_observed_p95_s: number;
  has_stage_labels: boolean;
  has_clock_telemetry: boolean;
  has_utilization_telemetry: boolean;
  has_temperature_telemetry: boolean;
  quality_status: string;
  mean_total_power_w: number;
  p95_total_power_w: number;
  p99_total_power_w: number;
  max_total_power_w: number;
  total_energy_wh: number;
  mean_power_per_gpu_w: number;
  ramp_up_p95_1s_w_per_s: number;
  ramp_up_p99_1s_w_per_s: number;
  ramp_down_p99_1s_w_per_s: number;
  ramp_event_frequency_1s: number;
  num_samples: number;
  num_gpus_observed: number;
  logging_method?: string;
  power_aggregation?: string;
  quality_flags?: QualityFlag[];
  missing_fields?: string[];
  timestamp_issues?: string[];
  gpu_count_mismatch?: boolean;
  duplicate_warning?: boolean;
  ramp_metrics?: Record<string, Record<string, number | null>>;
};

export type Sample = {
  timestamp: string;
  time_relative_s: number;
  gpu_id: string;
  power_w: number;
  total_power_w?: number;
  sm_clock_mhz?: number | null;
  gpu_util_pct?: number | null;
  memory_util_pct?: number | null;
  memory_used_mb?: number | null;
  memory_total_mb?: number | null;
  temperature_c?: number | null;
  stage?: string | null;
};

export type Filters = Record<string, string[]>;


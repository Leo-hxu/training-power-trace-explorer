import { useMemo, type ReactNode } from "react";
import type { PublicRun } from "./public-data";

const REPOSITORY_URL = "https://github.com/Leo-hxu/training-power-trace-explorer";
const COLLECTION_URL = "https://anonymous.4open.science/r/data-collection-0866/README.md";
export const SPLIT_VERSION = "v1";

/* ---------- Fixed evaluation splits ----------
 * Runs are grouped by configuration (workload, model, GPU type, GPU count) and every run of a group lands in the
 * same split, so no configuration appears in both train and test. A group's split depends only on its own key
 * (FNV-1a hash), so adding new runs never moves existing ones. The OOD split holds out every L40S run.
 */
export type Split = "train" | "val" | "test";
export const OOD_HOLDOUT_GPU = "L40S";

function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function configKey(run: PublicRun) {
  return [run.workload_type, run.model, run.gpu_type, run.gpu_count ?? run.num_gpus_observed ?? ""].join("|");
}

export function iidSplit(run: PublicRun): Split {
  const bucket = fnv1a(`${SPLIT_VERSION}|${configKey(run)}`) % 100;
  return bucket < 70 ? "train" : bucket < 85 ? "val" : "test";
}

export function oodSplit(run: PublicRun): Split {
  if (run.gpu_type === OOD_HOLDOUT_GPU) return "test";
  return iidSplit(run) === "train" ? "train" : "val";
}

export function splitsDocument(catalog: PublicRun[]) {
  return {
    version: SPLIT_VERSION,
    grouping: "workload_type | model | gpu_type | gpu_count",
    iid: "FNV-1a(version|group) % 100: <70 train, <85 val, else test",
    ood_gpu: `${OOD_HOLDOUT_GPU} runs = test; other runs follow iid train, iid val/test = val`,
    runs: catalog.map((run) => ({ run_id: run.run_id, group: configKey(run), iid: iidSplit(run), ood_gpu: oodSplit(run) })),
  };
}

/* ---------- Field dictionary ---------- */
type FieldDoc = [field: string, type: string, unit: string, description: string];

const CATALOG_FIELDS: FieldDoc[] = [
  ["run_id", "string", "", "Stable public identifier; unique across the catalog."],
  ["workload_type", "enum", "", "Training or Inference."],
  ["source_family", "string", "", "Collection the run belongs to; see release composition."],
  ["data_release", "string", "", "Release batch the record was published in."],
  ["quality_status", "enum", "", "Review tier: PASS_MAIN or PASS_LIMITED (see quality tiers)."],
  ["model / model_family", "string", "", "Model name and family as recorded by the experiment."],
  ["method", "string", "", "Training method (e.g. full fine-tune, LoRA) when recorded."],
  ["gpu_type", "string", "", "Accelerator model."],
  ["gpu_count / num_gpus_observed", "integer", "GPUs", "Declared GPU count and GPUs observed in telemetry."],
  ["precision / compute_dtype", "string", "", "Numeric precision of the workload."],
  ["sequence_length, microbatch_size, global_batch_size, grad_accum_steps", "integer", "", "Training configuration, null when not recorded."],
  ["inference_engine, tensor_parallel_size", "string / integer", "", "Serving stack configuration (inference only)."],
  ["kv_cache_quantization, model_weight_quantization", "string", "", "Quantization settings (inference only)."],
  ["arrival_pattern, arrival_rate_rps, concurrency", "string / number", "req/s", "Request load configuration (inference only)."],
  ["duration_observed_s", "number", "s", "Span between first and last telemetry sample."],
  ["num_samples", "integer", "rows", "Telemetry rows across all GPUs."],
  ["sampling_interval_observed_median_s / _p95_s", "number", "s", "Observed per-GPU sampling interval from timestamps."],
  ["mean_total_power_w, p95_total_power_w, p99_total_power_w, max_total_power_w", "number", "W", "Statistics of summed power across GPUs."],
  ["mean_power_per_gpu_w", "number", "W", "Mean power per GPU."],
  ["total_energy_wh", "number", "Wh", "Trapezoidal integral of total power over observed timestamps."],
  ["ramp_up_p95_1s_w_per_s, ramp_up_p99_1s_w_per_s, ramp_down_p99_1s_w_per_s", "number", "W/s", "Power ramp-rate percentiles over 1 s windows."],
  ["has_*_telemetry, has_stage_labels", "boolean | null", "", "Whether the optional channel is present; null = not assessed for this record."],
  ["missing_fields", "string[]", "", "Fields or channels absent for this run."],
  ["request_timeline_method", "string | null", "", "How the inference demand series was produced; null = no series."],
  ["display_bundle_file_id / display_bundle_entry", "string", "", "Drive file holding the run payload and its key inside that file."],
];

const SAMPLE_FIELDS: FieldDoc[] = [
  ["time_relative_s", "number", "s", "Seconds since the run's first sample."],
  ["gpu_id", "string", "", "GPU index within the run."],
  ["power_w", "number", "W", "Board power reading."],
  ["gpu_util_pct, memory_util_pct", "number", "%", "Utilization counters."],
  ["sm_clock_mhz", "number | null", "MHz", "SM clock."],
  ["memory_used_mb, memory_total_mb", "number | null", "MB", "Device memory."],
  ["temperature_c", "number | null", "°C", "GPU temperature."],
  ["stage", "string | null", "", "Workload phase label when the logger recorded one."],
];

/* ---------- helpers ---------- */
function countBy<T>(items: T[], key: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
}

const hours = (seconds: number) => (seconds / 3600).toFixed(seconds < 36000 ? 2 : 1);
const minutes = (seconds: number) => (Number.isFinite(seconds) ? `${(seconds / 60).toFixed(1)} min` : "—");
const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "—");
const gpuCount = (run: PublicRun) => Number(run.gpu_count ?? run.num_gpus_observed ?? 0) || 0;

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return <div className="table-scroll"><table className="trace-table dataset-table"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function Card({ eyebrow, title, children, wide }: { eyebrow: string; title: string; children: ReactNode; wide?: boolean }) {
  return <section className={`data-guide-card${wide ? " dataset-wide" : ""}`}><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{children}</section>;
}

function download(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const TELEMETRY_CHANNELS: [label: string, flag: keyof PublicRun | null, missing: string][] = [
  ["Power (power_w)", null, "power_w"],
  ["Utilization", "has_utilization_telemetry", "gpu_util_pct"],
  ["SM clock", "has_clock_telemetry", "sm_clock_mhz"],
  ["Temperature", "has_temperature_telemetry", "temperature_c"],
  ["Memory used", null, "memory_used_mb"],
  ["Memory total", null, "memory_total_mb"],
  ["Stage labels", "has_stage_labels", "stage"],
  ["Configured GPU frequency", null, "Configured GPU frequency"],
];

export function DatasetCard({ catalog }: { catalog: PublicRun[] }) {
  const s = useMemo(() => {
    const byWorkload = countBy(catalog, (r) => r.workload_type ?? "Unknown");
    const durations = catalog.map((r) => Number(r.duration_observed_s)).filter(Number.isFinite);
    const gpuHours = catalog.reduce((sum, r) => sum + (Number(r.duration_observed_s) || 0) * gpuCount(r), 0) / 3600;
    const configs = new Set(catalog.map(configKey));
    const groups = countBy(catalog, (r) => `${r.workload_type}|${r.gpu_type}|${gpuCount(r) || "?"}`).map(([key, n]) => {
      const [workload, gpu, count] = key.split("|");
      const runs = catalog.filter((r) => r.workload_type === workload && r.gpu_type === gpu && String(gpuCount(r) || "?") === count);
      return { workload, gpu, count, n, models: new Set(runs.map((r) => r.model)).size, hours: runs.reduce((a, r) => a + (Number(r.duration_observed_s) || 0), 0) };
    }).sort((a, b) => a.workload.localeCompare(b.workload) || a.gpu.localeCompare(b.gpu) || Number(a.count) - Number(b.count));
    const durationRows = countBy(catalog, (r) => `${r.workload_type} · ${r.source_family}`).map(([key]) => {
      const d = catalog.filter((r) => `${r.workload_type} · ${r.source_family}` === key).map((r) => Number(r.duration_observed_s)).filter(Number.isFinite).sort((a, b) => a - b);
      const intervals = catalog.filter((r) => `${r.workload_type} · ${r.source_family}` === key).map((r) => Number(r.sampling_interval_observed_median_s)).filter(Number.isFinite).sort((a, b) => a - b);
      return [key, d.length, minutes(d[0]), minutes(quantile(d, 0.5)), minutes(d[d.length - 1]), hours(d.reduce((a, b) => a + b, 0)), intervals.length ? `${quantile(intervals, 0.5).toFixed(2)} s` : "—"];
    });
    const workloads = byWorkload.map(([w]) => w);
    const gpus = countBy(catalog, (r) => r.gpu_type).map(([g]) => g);
    const families = countBy(catalog, (r) => r.model_family || r.model || "Unknown").map(([f]) => f);
    const matrix = families.map((family) => [family, ...workloads.flatMap((w) => gpus.map((g) => catalog.filter((r) => (r.model_family || r.model) === family && r.workload_type === w && r.gpu_type === g).length))]);
    const emptyCells = matrix.reduce((sum, row) => sum + row.slice(1).filter((v) => v === 0).length, 0);
    const telemetry = TELEMETRY_CHANNELS.map(([label, flag, missing]) => {
      let present = 0, absent = 0, unknown = 0;
      for (const r of catalog) {
        const listed = (r.missing_fields ?? []).includes(missing);
        const value = flag ? r[flag] : undefined;
        if (listed || value === false) absent += 1;
        else if (flag && value == null) unknown += 1;
        else present += 1;
      }
      return [label, present, absent, unknown, pct(present, catalog.length)];
    });
    const quality = countBy(catalog, (r) => `${r.quality_status}|${r.source_family}`).map(([key, n]) => [...key.split("|"), n]);
    const inference = catalog.filter((r) => r.workload_type === "Inference");
    const timelines = countBy(inference, (r) => String((r as { request_timeline_method?: string | null }).request_timeline_method ?? "No demand series")).map(([method, n]) => [method, n]);
    const rawEvents = inference.filter((r) => (r.missing_fields ?? []).includes("Raw per-request arrival events")).length;
    const splits = (["iid", "ood"] as const).map((kind) => {
      const fn = kind === "iid" ? iidSplit : oodSplit;
      return (["train", "val", "test"] as Split[]).map((split) => {
        const runs = catalog.filter((r) => fn(r) === split);
        return [kind === "iid" ? "IID (config-grouped)" : `OOD (hold out ${OOD_HOLDOUT_GPU})`, split, runs.length, new Set(runs.map(configKey)).size, runs.filter((r) => r.workload_type === "Training").length, runs.filter((r) => r.workload_type === "Inference").length];
      });
    }).flat();
    return { byWorkload, durations, gpuHours, configs, groups, durationRows, workloads, gpus, matrix, emptyCells, telemetry, quality, inference, timelines, rawEvents, splits, models: new Set(catalog.map((r) => r.model)).size };
  }, [catalog]);
  const total = catalog.length;
  const allHours = s.durations.reduce((a, b) => a + b, 0);

  return <main className="data-guide-main static-about">
    <div className="detail-breadcrumb"><a href="#/">Trace Catalog</a><span>/</span><span>Dataset card</span></div>
    <section className="data-guide-hero">
      <p className="eyebrow">Released resource · computed live from the published catalog</p>
      <h1>Dataset card</h1>
      <p>{total} traces ({s.byWorkload.map(([w, n]) => `${n} ${w.toLowerCase()}`).join(", ")}) covering {s.models} models and {s.configs.size} distinct configurations, {hours(allHours)} h of wall-clock telemetry and {s.gpuHours.toFixed(0)} GPU-hours. Data: CC BY 4.0 · Code: MIT.</p>
      <div className="data-guide-callout"><strong>Fixed splits {SPLIT_VERSION}.</strong><span>Deterministic per configuration; adding runs never reassigns existing ones.</span><button className="button button-secondary" onClick={() => download(`splits-${SPLIT_VERSION}.json`, JSON.stringify(splitsDocument(catalog), null, 2))}>↓ splits.json</button><button className="button button-secondary" onClick={() => download("catalog.json", JSON.stringify(catalog, null, 2))}>↓ catalog.json</button></div>
    </section>
    <div className="data-guide-grid">
      <Card eyebrow="Composition" title="Runs by configuration" wide>
        <Table head={["Workload", "GPU type", "GPUs / run", "Runs", "Models", "Hours"]} rows={s.groups.map((g) => [g.workload, g.gpu, g.count, g.n, g.models, hours(g.hours)])} />
      </Card>
      <Card eyebrow="Durations" title="Trace length and sampling" wide>
        <Table head={["Subset", "Runs", "Min", "Median", "Max", "Total h", "Median interval"]} rows={s.durationRows} />
      </Card>
      <Card eyebrow="Coverage" title="Model family × workload × GPU" wide>
        <p>Run counts per cell; empty cells ({s.emptyCells} of {s.matrix.length * s.workloads.length * s.gpus.length}) are configurations not covered by this release.</p>
        <Table head={["Model family", ...s.workloads.flatMap((w) => s.gpus.map((g) => `${w.slice(0, 5)} · ${g}`))]} rows={s.matrix.map((row) => row.map((v, i) => (i > 0 && v === 0 ? <span className="dataset-gap">·</span> : v)))} />
      </Card>
      <Card eyebrow="Telemetry" title="Channel availability">
        <p>“Unknown” = the record does not state whether the channel exists.</p>
        <Table head={["Channel", "Present", "Absent", "Unknown", "Coverage"]} rows={s.telemetry} />
      </Card>
      <Card eyebrow="Quality" title="Review tiers and exclusions">
        <Table head={["Tier", "Source", "Runs"]} rows={s.quality} />
        <p>Only runs that pass automated checks and release review are published. Checks: missing files or metadata, schema mismatch, non-monotonic time, irregular sampling (p95 interval &gt; 2.5× median), large gaps, missing GPU samples, zero or implausible power, unknown precision or GPU type, declared vs. observed GPU count, duplicate timestamp/GPU pairs. PASS_MAIN runs passed every check; PASS_LIMITED runs are released with documented limitations (e.g. time-limited or downsampled sources) and should be excluded where full-length, full-rate traces are required.</p>
      </Card>
      <Card eyebrow="Inference demand" title="Event-log availability">
        <Table head={["Demand series", "Runs"]} rows={s.timelines} />
        <p>Published inference runs carry a time-binned request series aligned to the power trace (arrivals, prompt/output tokens per window). Raw per-request event logs are not released{s.rawEvents ? `; ${s.rawEvents} run has no per-request events at source and its series is derived from cumulative counters` : ""}.</p>
      </Card>
      <Card eyebrow="Evaluation" title={`Fixed splits ${SPLIT_VERSION}`} wide>
        <Table head={["Protocol", "Split", "Runs", "Configs", "Training", "Inference"]} rows={s.splits} />
        <p>Grouping key: workload · model · GPU type · GPU count — every run of a configuration is in one split. IID: FNV-1a hash of the key → 70 / 15 / 15. OOD: all {OOD_HOLDOUT_GPU} runs form the test set. Assignments are listed per run in <code>splits.json</code> and on each run page.</p>
      </Card>
      <Card eyebrow="Schema" title="Catalog record fields" wide>
        <Table head={["Field", "Type", "Unit", "Description"]} rows={CATALOG_FIELDS.map(([f, t, u, d]) => [<code key={f}>{f}</code>, t, u, d])} />
        <p>Missing values are <code>null</code>, never estimated.</p>
      </Card>
      <Card eyebrow="Schema" title="Telemetry sample fields" wide>
        <Table head={["Field", "Type", "Unit", "Description"]} rows={SAMPLE_FIELDS.map(([f, t, u, d]) => [<code key={f}>{f}</code>, t, u, d])} />
        <p>Each run payload is <code>{"{ run, samples[] }"}</code>; bundles map <code>display_bundle_entry → payload</code>.</p>
      </Card>
      <Card eyebrow="Collection" title="Collect traces yourself">
        <p>The scripts that produced these traces are released at <a href={COLLECTION_URL} target="_blank" rel="noreferrer">data-collection-0866</a>: <code>train/</code> holds the Slurm launch scripts and training harnesses (HPC clusters); <code>inference/</code> holds the serving-campaign pipeline (prompt pools, GPU provisioning, vLLM launch, DCGM telemetry capture, upload) used on rented GPU providers.</p>
      </Card>
      <Card eyebrow="License" title="Terms of use">
        <p>Data (catalog, trace payloads, derived CSVs): <a href={`${REPOSITORY_URL}/blob/main/LICENSE-DATA`}>CC BY 4.0</a>. Code: <a href={`${REPOSITORY_URL}/blob/main/LICENSE`}>MIT</a>.</p>
      </Card>
    </div>
  </main>;
}

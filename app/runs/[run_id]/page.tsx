"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "../../components/AppHeader";
import { PowerChart } from "../../components/PowerChart";
import { EmptyState, FormatValue, LoadingBlock, QualityBadge } from "../../components/Ui";
import { API_BASE, apiFetch, fetchRun, type SamplesResponse } from "../../lib/api";
import type { Run } from "../../lib/types";

function Value({ value, suffix = "", digits = 2 }: { value: unknown; suffix?: string; digits?: number }) {
  return <FormatValue value={value} suffix={suffix} digits={digits} />;
}

function MetadataCard({ title, items }: { title: string; items: { label: string; value: React.ReactNode; wide?: boolean }[] }) {
  return (
    <section className="metadata-card">
      <h3>{title}</h3>
      <dl>
        {items.map((item) => (
          <div key={item.label} className={item.wide ? "wide-value" : ""}>
            <dt>{item.label}</dt><dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function yesNo(value: boolean | undefined) {
  return <span className={value ? "telemetry-yes" : "telemetry-no"}><i />{value ? "Available" : "Not found"}</span>;
}

export default function RunDetailPage() {
  const params = useParams<{ run_id: string }>();
  const runId = decodeURIComponent(params.run_id);
  const [run, setRun] = useState<Run | null>(null);
  const [sampleData, setSampleData] = useState<SamplesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [plotLoading, setPlotLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [smoothing, setSmoothing] = useState("0");
  const [downsample, setDownsample] = useState("1200");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchRun(runId)
      .then(setRun)
      .catch(() => setError("This run could not be loaded. It may have moved since the last catalog scan."))
      .finally(() => setLoading(false));
  }, [runId]);

  const loadSamples = useCallback(async () => {
    setPlotLoading(true);
    try {
      const data = await apiFetch<SamplesResponse>(
        `/api/runs/${encodeURIComponent(runId)}/samples?downsample=${downsample}&smoothing_window_s=${smoothing}`,
      );
      setSampleData(data);
    } catch {
      setError("The trace was cataloged, but its normalized sample cache could not be read. Rebuild the catalog to repair it.");
    } finally {
      setPlotLoading(false);
    }
  }, [runId, downsample, smoothing]);

  useEffect(() => { void loadSamples(); }, [loadSamples]);

  const badges = useMemo(() => run ? [run.gpu_type, run.model, run.method, `Seq ${run.sequence_length}`, run.source_family] : [], [run]);

  async function openFolder() {
    if (!run) return;
    try {
      await apiFetch(`/api/runs/${encodeURIComponent(run.run_id)}/open-folder`, { method: "POST" });
      setToast("Source folder opened.");
    } catch {
      await navigator.clipboard.writeText(run.source_directory);
      setToast("Folder opening is disabled; source path copied instead.");
    }
    window.setTimeout(() => setToast(null), 2600);
  }

  if (loading) {
    return <div className="app-frame"><AppHeader /><main className="standalone-state"><LoadingBlock label="Loading run metadata…" /></main></div>;
  }
  if (error && !run) {
    return <div className="app-frame"><AppHeader /><main className="standalone-state"><EmptyState title="Run unavailable">{error}</EmptyState><Link className="button button-primary" href="/">Back to Trace List</Link></main></div>;
  }
  if (!run) return null;

  return (
    <div className="app-frame detail-frame">
      <AppHeader />
      <main className="detail-main">
        <div className="detail-breadcrumb"><Link href="/">Trace Catalog</Link><span>/</span><span>{run.run_id}</span></div>
        <section className="run-heading">
          <div>
            <p className="eyebrow">Trace detail</p>
            <h1>Run: {run.run_id}</h1>
            <div className="run-badges">
              {badges.map((badge) => <span key={badge}>{badge}</span>)}
              <QualityBadge status={run.quality_status} />
            </div>
          </div>
          <div className="heading-actions">
            <Link className="button button-secondary" href={`/runs/${encodeURIComponent(run.run_id)}/data`}>▤ View Raw Data</Link>
            <a className="button button-primary" href={`${API_BASE}/api/runs/${encodeURIComponent(run.run_id)}/download/raw.csv`}>↓ Download CSV</a>
          </div>
        </section>

        {error ? <div className="inline-alert"><strong>Sample warning</strong><span>{error}</span></div> : null}

        <div className="detail-grid">
          <section className="plot-card">
            <div className="panel-heading plot-heading">
              <div>
                <p className="eyebrow">Normalized power telemetry</p>
                <h2>GPU power over time</h2>
                <p>{sampleData ? `${sampleData.returned_samples.toLocaleString()} plotted points from ${sampleData.total_samples.toLocaleString()} normalized samples` : "Preparing samples…"}</p>
              </div>
              <div className="plot-controls">
                <label><span>Smoothing</span><select value={smoothing} onChange={(event) => setSmoothing(event.target.value)}>
                  <option value="0">Raw</option><option value="1">Rolling 1 s</option><option value="5">Rolling 5 s</option><option value="10">Rolling 10 s</option>
                </select></label>
                <label><span>Resolution</span><select value={downsample} onChange={(event) => setDownsample(event.target.value)}>
                  <option value="600">Fast · 600/GPU</option><option value="1200">Balanced · 1,200/GPU</option><option value="2400">Fine · 2,400/GPU</option><option value="0">Raw resolution</option>
                </select></label>
              </div>
            </div>
            <PowerChart samples={sampleData?.samples ?? []} stages={sampleData?.stages ?? []} loading={plotLoading} />
            <div className="plot-footnote">
              <span><i className="peak-key" /> Min/max envelope preserves peaks during downsampling.</span>
              <span>Double-click the plot to reset zoom.</span>
            </div>
          </section>

          <aside className="metadata-panel">
            <div className="metadata-title"><div><p className="eyebrow">Run record</p><h2>Metadata</h2></div><span>{run.num_samples.toLocaleString()} samples</span></div>
            <MetadataCard title="Run Identity" items={[
              { label: "Run ID", value: run.run_id, wide: true },
              { label: "Source family", value: run.source_family },
              { label: "Trace path", value: <code>{run.trace_path}</code>, wide: true },
              { label: "Metadata path", value: run.meta_path ? <code>{run.meta_path}</code> : "Not found", wide: true },
              { label: "Log path", value: run.stdout_path ? <code>{run.stdout_path}</code> : "Not found", wide: true },
            ]} />
            <MetadataCard title="Model and Training" items={[
              { label: "Model", value: run.model }, { label: "Model family", value: run.model_family },
              { label: "Method", value: run.method }, { label: "Precision / dtype", value: `${run.precision} / ${run.compute_dtype}` },
              { label: "Quantization", value: <Value value={run.quantization_bits} suffix=" bit" /> },
              { label: "Sequence length", value: <Value value={run.sequence_length} digits={0} /> },
              { label: "Microbatch", value: run.microbatch_size }, { label: "Grad accumulation", value: run.grad_accum_steps },
              { label: "Global batch", value: run.global_batch_size }, { label: "Checkpoint interval", value: run.checkpoint_interval },
              { label: "Dataset", value: run.dataset_name, wide: true },
            ]} />
            <MetadataCard title="Hardware" items={[
              { label: "GPU type", value: run.gpu_type }, { label: "GPU count", value: run.gpu_count },
              { label: "Clock telemetry", value: yesNo(run.has_clock_telemetry) },
              { label: "Utilization telemetry", value: yesNo(run.has_utilization_telemetry) },
              { label: "Temperature telemetry", value: yesNo(run.has_temperature_telemetry) },
              { label: "Parallelism", value: run.parallelism },
            ]} />
            <MetadataCard title="Logging" items={[
              { label: "Logging method", value: run.logging_method || "Unknown" },
              { label: "Declared interval", value: <Value value={run.sampling_interval_declared_s} suffix=" s" digits={3} /> },
              { label: "Observed median", value: <Value value={run.sampling_interval_observed_median_s} suffix=" s" digits={3} /> },
              { label: "Observed p95", value: <Value value={run.sampling_interval_observed_p95_s} suffix=" s" digits={3} /> },
              { label: "Duration", value: <Value value={run.duration_observed_s} suffix=" s" /> },
              { label: "Power samples", value: run.power_aggregation || "Unknown" },
            ]} />
            <MetadataCard title="Power Metrics" items={[
              { label: "Mean total power", value: <Value value={run.mean_total_power_w} suffix=" W" /> },
              { label: "P95 total power", value: <Value value={run.p95_total_power_w} suffix=" W" /> },
              { label: "P99 total power", value: <Value value={run.p99_total_power_w} suffix=" W" /> },
              { label: "Max total power", value: <Value value={run.max_total_power_w} suffix=" W" /> },
              { label: "Total energy", value: <Value value={run.total_energy_wh} suffix=" Wh" digits={3} /> },
              { label: "R99 upward ramp", value: <Value value={run.ramp_up_p99_1s_w_per_s} suffix=" W/s" /> },
              { label: "Ramp event frequency", value: <Value value={run.ramp_event_frequency_1s} suffix=" /min" /> },
            ]} />
            <section className="metadata-card quality-card">
              <h3>Data Quality</h3>
              <div className="quality-summary"><QualityBadge status={run.quality_status} /><span>{run.quality_flags?.length ?? 0} recorded checks</span></div>
              <ul>
                {(run.quality_flags ?? []).map((flag) => <li key={flag.code} className={`flag-${flag.severity}`}><i />{flag.message}</li>)}
                {!run.quality_flags?.length ? <li className="flag-info"><i />No data quality flags were recorded.</li> : null}
              </ul>
            </section>
            <div className="metadata-actions">
              <Link className="button button-primary" href={`/runs/${encodeURIComponent(run.run_id)}/data`}>▤ View Raw Data</Link>
              <a className="button button-secondary" href={`${API_BASE}/api/runs/${encodeURIComponent(run.run_id)}/download/metadata.json`}>↓ Metadata JSON</a>
              <button className="button button-secondary" type="button" onClick={openFolder}>↗ Open Source Folder</button>
              <Link className="button button-ghost" href="/">← Back to Trace List</Link>
            </div>
          </aside>
        </div>
      </main>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}


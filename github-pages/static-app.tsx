import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PowerChart } from "../app/components/PowerChart";
import { FormatValue, QualityBadge } from "../app/components/Ui";
import type { Run, Sample } from "../app/lib/types";
import { DEMO_RUNS, DEMO_SAMPLES } from "./demo-data";

const REPOSITORY_URL = "https://github.com/Leo-hxu/training-power-trace-explorer";

function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/, "") || "/");
  useEffect(() => {
    const update = () => setRoute(window.location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

function Header() {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a href="#/" className="brand-link" aria-label="Training Power Trace Explorer home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span><strong>Training Power Trace Explorer</strong><small>LLM Systems Research</small></span>
        </a>
        <nav className="header-actions">
          <span className="static-demo-badge"><i /> Public synthetic demo</span>
          <a className="button button-ghost" href="#/about">ⓘ About</a>
          <a className="button button-secondary" href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub ↗</a>
        </nav>
      </div>
    </header>
  );
}

function DemoNotice() {
  return (
    <div className="demo-notice">
      <span>Public demo</span>
      <p>This deployment uses synthetic traces only. The local FastAPI edition scans private files without uploading them.</p>
    </div>
  );
}

function fmtSeconds(value: number) {
  return value >= 60 ? `${(value / 60).toFixed(1)} min` : `${value.toFixed(1)} s`;
}

function Home() {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("All");
  const [gpu, setGpu] = useState("All");
  const [model, setModel] = useState("All");
  const [method, setMethod] = useState("All");
  const [quality, setQuality] = useState("All");
  const runs = useMemo(() => DEMO_RUNS.filter((run) => {
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || [run.run_id, run.model, run.gpu_type, run.method, run.source_family].some((value) => String(value).toLowerCase().includes(needle));
    return matchesSearch
      && (source === "All" || run.source_family === source)
      && (gpu === "All" || run.gpu_type === gpu)
      && (model === "All" || run.model === model)
      && (method === "All" || run.method === method)
      && (quality === "All" || run.quality_status === quality);
  }), [search, source, gpu, model, method, quality]);

  function options(field: keyof Run) {
    return Array.from(new Set(DEMO_RUNS.map((run) => String(run[field])))).sort();
  }
  function clear() { setSearch(""); setSource("All"); setGpu("All"); setModel("All"); setMethod("All"); setQuality("All"); }

  return (
    <div className="dashboard-layout static-dashboard">
      <aside className="filter-sidebar static-sidebar">
        <div className="sidebar-heading"><div><p className="eyebrow">Demo controls</p><h2>Filter traces</h2></div><span className="count-pill">{runs.length}</span></div>
        <label className="search-field"><span className="sr-only">Search traces</span><i>⌕</i><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Run ID, model, GPU…" /></label>
        <div className="filter-stack">
          {[
            ["Source family", source, setSource, options("source_family")],
            ["GPU type", gpu, setGpu, options("gpu_type")],
            ["Model", model, setModel, options("model")],
            ["Training method", method, setMethod, options("method")],
            ["Quality status", quality, setQuality, options("quality_status")],
          ].map(([label, value, setter, values]) => (
            <label className="filter-field" key={String(label)}><span>{String(label)}</span><select value={String(value)} onChange={(event) => (setter as (value: string) => void)(event.target.value)}><option>All</option>{(values as string[]).map((option) => <option key={option}>{option}</option>)}</select></label>
          ))}
        </div>
        <button className="clear-filters" type="button" onClick={clear}>Clear all filters</button>
        <div className="sidebar-footnote"><span className="privacy-dot" />No real training trace is included in this public deployment.</div>
      </aside>
      <main className="catalog-main">
        <DemoNotice />
        <section className="page-intro">
          <div><p className="eyebrow">Power telemetry catalog</p><h1>Training Power Trace Explorer</h1><p>Interactive visualization and metadata browser for LLM training GPU power traces.</p></div>
          <a className="text-link" href="#/about">Metric definitions →</a>
        </section>
        <section className="catalog-stats">
          <div><span>Demo traces</span><strong>{DEMO_RUNS.length}</strong><small>synthetic normalized runs</small></div>
          <div><span>Current matches</span><strong>{runs.length}</strong><small>after active filters</small></div>
          <div><span>GPU families</span><strong>{options("gpu_type").length}</strong><small>H100 · L40S · A100</small></div>
          <div><span>Schemas</span><strong>3</strong><small>trace2flex · PowerTraces · Legacy</small></div>
        </section>
        <section className="catalog-card">
          <div className="table-toolbar"><div><h2>Trace catalog</h2><p>{runs.length} synthetic traces shown</p></div><div className="legend-inline"><QualityBadge status="Good" /><QualityBadge status="Warning" /></div></div>
          <div className="table-scroll">
            <table className="trace-table">
              <thead><tr><th>Run ID</th><th>Source</th><th>Model</th><th>Method</th><th>GPU</th><th>GPU Count</th><th>Seq Len</th><th>Microbatch</th><th>Grad Accum</th><th>Duration</th><th>Median Δt</th><th>Mean Power</th><th>P99 Power</th><th>R99 Up 1s</th><th>Energy</th><th>Quality</th><th /></tr></thead>
              <tbody>{runs.map((run) => <tr key={run.run_id} onClick={() => { window.location.hash = `/runs/${run.run_id}`; }} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") window.location.hash = `/runs/${run.run_id}`; }}>
                <td><strong className="run-id">{run.run_id}</strong><small>synthetic_power_trace.csv</small></td>
                <td><span className="source-chip">{run.source_family}</span></td><td>{run.model}</td><td>{run.method}</td><td>{run.gpu_type}</td><td>{run.gpu_count}</td><td>{run.sequence_length}</td><td>{run.microbatch_size}</td><td>{run.grad_accum_steps}</td><td>{fmtSeconds(run.duration_observed_s)}</td><td><FormatValue value={run.sampling_interval_observed_median_s} suffix=" s" digits={3} /></td><td><FormatValue value={run.mean_total_power_w} suffix=" W" /></td><td><FormatValue value={run.p99_total_power_w} suffix=" W" /></td><td><FormatValue value={run.ramp_up_p99_1s_w_per_s} suffix=" W/s" /></td><td><FormatValue value={run.total_energy_wh} suffix=" Wh" digits={2} /></td><td><QualityBadge status={run.quality_status} /></td><td><span className="row-arrow">→</span></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="table-footer"><span>All values on this public page are synthetic.</span><span>Open a run to zoom, pan, and inspect telemetry.</span></div>
        </section>
      </main>
    </div>
  );
}

function smoothSamples(samples: Sample[], windowS: number) {
  if (!windowS) return samples;
  const byGpu = new Map<string, Sample[]>();
  samples.forEach((sample) => byGpu.set(sample.gpu_id, [...(byGpu.get(sample.gpu_id) ?? []), sample]));
  const result: Sample[] = [];
  byGpu.forEach((rows) => rows.forEach((row, index) => {
    const window = rows.slice(0, index + 1).filter((candidate) => candidate.time_relative_s >= row.time_relative_s - windowS);
    result.push({ ...row, power_w: window.reduce((sum, candidate) => sum + candidate.power_w, 0) / window.length });
  }));
  const totals = new Map<number, number>();
  result.forEach((row) => totals.set(row.time_relative_s, (totals.get(row.time_relative_s) ?? 0) + row.power_w));
  return result.map((row) => ({ ...row, total_power_w: totals.get(row.time_relative_s) }));
}

function MetadataCard({ title, items }: { title: string; items: [string, ReactNode][] }) {
  return <section className="metadata-card"><h3>{title}</h3><dl>{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

function Detail({ runId }: { runId: string }) {
  const run = DEMO_RUNS.find((item) => item.run_id === runId);
  const [smoothing, setSmoothing] = useState(0);
  if (!run) return <NotFound />;
  const raw = DEMO_SAMPLES[runId] ?? [];
  const samples = smoothSamples(raw, smoothing);
  const stages: { time_relative_s: number; stage: string }[] = [];
  let lastStage = "";
  raw.forEach((sample) => { if (sample.stage && sample.stage !== lastStage) { stages.push({ time_relative_s: sample.time_relative_s, stage: sample.stage }); lastStage = sample.stage; } });
  const downloadCsv = () => {
    const headers = ["timestamp", "time_relative_s", "gpu_id", "power_w", "total_power_w", "gpu_util_pct", "memory_util_pct", "sm_clock_mhz", "temperature_c"];
    const csv = [headers.join(","), ...raw.map((row) => headers.map((key) => String(row[key as keyof Sample] ?? "")).join(","))].join("\n");
    downloadText(`${run.run_id}_synthetic.csv`, csv, "text/csv");
  };
  return <main className="detail-main static-detail">
    <DemoNotice />
    <div className="detail-breadcrumb"><a href="#/">Trace Catalog</a><span>/</span><span>{run.run_id}</span></div>
    <section className="run-heading"><div><p className="eyebrow">Synthetic trace detail</p><h1>Run: {run.run_id}</h1><div className="run-badges">{[run.gpu_type, run.model, run.method, `Seq ${run.sequence_length}`, run.source_family].map((badge) => <span key={badge}>{badge}</span>)}<QualityBadge status={run.quality_status} /></div></div><div className="heading-actions"><a className="button button-secondary" href={`#/runs/${run.run_id}/data`}>▤ View Raw Data</a><button className="button button-primary" onClick={downloadCsv}>↓ Download CSV</button></div></section>
    <div className="detail-grid">
      <section className="plot-card static-plot-card">
        <div className="panel-heading plot-heading"><div><p className="eyebrow">Synthetic normalized telemetry</p><h2>GPU power over time</h2><p>{samples.length.toLocaleString()} plotted samples · scroll to zoom, drag to pan</p></div><div className="plot-controls"><label><span>Smoothing</span><select value={smoothing} onChange={(event) => setSmoothing(Number(event.target.value))}><option value="0">Raw</option><option value="1">Rolling 1 s</option><option value="5">Rolling 5 s</option><option value="10">Rolling 10 s</option></select></label></div></div>
        <PowerChart samples={samples} stages={stages} />
        <div className="plot-footnote"><span>Public demo data only.</span><span>Double-click to reset zoom.</span></div>
      </section>
      <aside className="metadata-panel">
        <div className="metadata-title"><div><p className="eyebrow">Run record</p><h2>Metadata</h2></div><span>{raw.length} samples</span></div>
        <MetadataCard title="Run Identity" items={[["Run ID", run.run_id], ["Source family", run.source_family], ["Trace path", <code key="trace">{run.trace_path}</code>], ["Data status", "Synthetic public demo"]]} />
        <MetadataCard title="Model and Training" items={[["Model", run.model], ["Method", run.method], ["Precision / dtype", `${run.precision} / ${run.compute_dtype}`], ["Sequence length", run.sequence_length], ["Microbatch", run.microbatch_size], ["Grad accumulation", run.grad_accum_steps], ["Dataset", run.dataset_name]]} />
        <MetadataCard title="Hardware and Logging" items={[["GPU type", run.gpu_type], ["GPU count", run.gpu_count], ["Parallelism", run.parallelism], ["Median interval", `${run.sampling_interval_observed_median_s} s`], ["Clock telemetry", "Available"], ["Utilization telemetry", "Available"]]} />
        <MetadataCard title="Power Metrics" items={[["Mean total power", `${run.mean_total_power_w} W`], ["P99 total power", `${run.p99_total_power_w} W`], ["Max total power", `${run.max_total_power_w} W`], ["Total energy", `${run.total_energy_wh} Wh`], ["R99 upward ramp", `${run.ramp_up_p99_1s_w_per_s} W/s`]]} />
        <div className="metadata-actions"><a className="button button-primary" href={`#/runs/${run.run_id}/data`}>▤ View Raw Data</a><button className="button button-secondary" onClick={() => downloadText(`${run.run_id}_metadata.json`, JSON.stringify(run, null, 2), "application/json")}>↓ Metadata JSON</button><a className="button button-ghost" href="#/">← Back to Trace List</a></div>
      </aside>
    </div>
  </main>;
}

function RawData({ runId }: { runId: string }) {
  const run = DEMO_RUNS.find((item) => item.run_id === runId);
  const [gpu, setGpu] = useState("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  if (!run) return <NotFound />;
  const all = DEMO_SAMPLES[runId] ?? [];
  const filtered = all.filter((row) => (gpu === "All" || row.gpu_id === gpu) && (!search || Object.values(row).join(" ").toLowerCase().includes(search.toLowerCase())));
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const columns: [keyof Sample, string, string][] = [["timestamp", "Time", ""], ["time_relative_s", "Relative Time", "s"], ["gpu_id", "GPU ID", ""], ["power_w", "Power", "W"], ["total_power_w", "Total Power", "W"], ["gpu_util_pct", "GPU Util", "%"], ["memory_util_pct", "Memory Util", "%"], ["memory_used_mb", "Memory Used", "MB"], ["sm_clock_mhz", "SM Clock", "MHz"], ["temperature_c", "Temperature", "°C"]];
  return <main className="raw-main static-raw"><DemoNotice /><div className="detail-breadcrumb"><a href="#/">Trace Catalog</a><span>/</span><a href={`#/runs/${runId}`}>{runId}</a><span>/</span><span>Raw Data</span></div><section className="raw-heading"><div><p className="eyebrow">Synthetic normalized samples</p><h1>Raw Trace Data</h1><p>{run.model} · {run.gpu_type} · public demo</p></div><div className="heading-actions"><a className="button button-secondary" href={`#/runs/${runId}`}>← Back to Trace</a></div></section>
    <section className="raw-controls"><label className="search-field raw-search"><span className="sr-only">Search</span><i>⌕</i><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search any displayed value…" /></label><label><span>GPU</span><select value={gpu} onChange={(event) => { setGpu(event.target.value); setPage(1); }}><option>All</option>{Array.from(new Set(all.map((row) => row.gpu_id))).map((id) => <option key={id} value={id}>GPU {id}</option>)}</select></label></section>
    <section className="raw-table-card"><div className="table-toolbar"><div><h2>Samples</h2><p>{filtered.length.toLocaleString()} matching rows · page {page} of {pages}</p></div></div><div className="table-scroll raw-scroll"><table className="trace-table raw-table"><thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.timestamp}-${row.gpu_id}-${index}`}>{columns.map(([key,,unit]) => <td key={key} className={key === "timestamp" ? "timestamp-cell" : "numeric-cell"}>{String(row[key] ?? "Not found")}{unit && row[key] != null ? ` ${unit}` : ""}</td>)}</tr>)}</tbody></table></div><div className="pagination"><button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>‹ Previous</button><span>Page <strong>{page}</strong> of <strong>{pages}</strong></span><button onClick={() => setPage(Math.min(pages, page + 1))} disabled={page === pages}>Next ›</button></div></section>
  </main>;
}

function About() {
  return <main className="about-main static-about"><DemoNotice /><div className="detail-breadcrumb"><a href="#/">Trace Catalog</a><span>/</span><span>About</span></div><section className="about-hero"><p className="eyebrow">Public demonstration</p><h1>About the trace explorer</h1><p>This GitHub Pages edition demonstrates the interface with deterministic synthetic data. The local edition adds FastAPI, automatic directory scanning, SQLite metadata, normalized sample caches, raw downloads, and transparent parse-failure reporting.</p><div className="privacy-callout"><span className="privacy-dot" /><div><strong>No private trace data</strong><p>The repository and public site contain generated examples only.</p></div></div></section><div className="about-grid"><section className="about-card"><p className="eyebrow">Metric definition</p><h2>Mean power</h2><div className="formula">mean(P<sub>total</sub>(t))</div><p>Mean of total observed GPU power over normalized timestamps.</p></section><section className="about-card"><p className="eyebrow">Metric definition</p><h2>Total energy</h2><div className="formula">∑ P<sub>total</sub>(t) × Δt / 3600</div><p>Timestamp-aware trapezoidal integration in watt-hours.</p></section><section className="about-card"><p className="eyebrow">Metric definition</p><h2>High-percentile power</h2><div className="formula">P95, P99 of P<sub>total</sub>(t)</div><p>High quantiles of the normalized total-power series.</p></section><section className="about-card"><p className="eyebrow">Metric definition</p><h2>Ramp rate</h2><div className="formula">R<sub>δ</sub>(t) = [P(t) − P(t − δ)] / δ</div><p>Computed from actual time rather than fixed row offsets.</p></section></div><div className="about-actions"><a className="button button-primary" href="#/">← Return to Trace Catalog</a><a className="button button-secondary" href={REPOSITORY_URL} target="_blank" rel="noreferrer">View source on GitHub ↗</a></div></main>;
}

function NotFound() { return <main className="standalone-state"><div className="empty-state"><div className="empty-icon">⌁</div><h2>Demo route not found</h2><p>Return to the synthetic trace catalog.</p></div><a className="button button-primary" href="#/">Back to catalog</a></main>; }

export function StaticDemoApp() {
  const route = useHashRoute();
  let page: ReactNode;
  if (route === "/" || route === "") page = <Home />;
  else if (route === "/about") page = <About />;
  else {
    const dataMatch = route.match(/^\/runs\/([^/]+)\/data$/);
    const runMatch = route.match(/^\/runs\/([^/]+)$/);
    if (dataMatch) page = <RawData runId={decodeURIComponent(dataMatch[1])} />;
    else if (runMatch) page = <Detail runId={decodeURIComponent(runMatch[1])} />;
    else page = <NotFound />;
  }
  return <div className="app-frame static-app"><Header />{page}<footer className="static-footer">Training Power Trace Explorer · Public synthetic-data demo · <a href={REPOSITORY_URL}>Source on GitHub</a></footer></div>;
}


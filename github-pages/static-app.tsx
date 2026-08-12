import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PowerChart } from "../app/components/PowerChart";
import { EmptyState, FormatValue, LoadingBlock, QualityBadge } from "../app/components/Ui";
import { withComputedTotalPower } from "../app/lib/power-series";
import type { Run, Sample } from "../app/lib/types";
import { loadCatalog, loadRun, publicArtifactUrl, type PublicRun, type PublicRunDetail } from "./public-data";

const REPOSITORY_URL = "https://github.com/Leo-hxu/training-power-trace-explorer";

function isSynthetic(run: Pick<Run, "source_family" | "quality_status">) {
  return run.source_family === "Synthetic showcase" || run.quality_status === "DEMO_SYNTHETIC";
}

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
        <a href="#/" className="brand-link" aria-label="LLM Power Trace Explorer home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span><strong>LLM Power Trace Explorer</strong><small>Training &amp; Inference Research</small></span>
        </a>
        <nav className="header-actions">
          <span className="static-demo-badge"><i /> Public reference &amp; demo data</span>
          <a className="button button-ghost" href="#/about">ⓘ About</a>
          <a className="button button-secondary" href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub ↗</a>
        </nav>
      </div>
    </header>
  );
}

function PublicDataNotice() {
  return (
    <div className="demo-notice">
      <span>Public reference data</span>
      <p>Reviewed public traces are research-ready; the separately labeled synthetic showcase demonstrates complete telemetry. Private HPC files remain outside this deployment.</p>
    </div>
  );
}

function fmtSeconds(value: number) {
  return value >= 60 ? `${(value / 60).toFixed(1)} min` : `${value.toFixed(1)} s`;
}

function modelLabel(run: Pick<Run, "model" | "model_metadata_status">) {
  return run.model_metadata_status === "not_reported" ? "Unknown" : run.model;
}

function workloadLabel(run: Pick<Run, "workload_type">) {
  return run.workload_type === "Inference" ? "Inference" : "Training";
}

const workloadTypes = ["Training", "Inference"];

function Home({ catalog }: { catalog: PublicRun[] }) {
  const [search, setSearch] = useState("");
  const [workload, setWorkload] = useState("All");
  const [gpu, setGpu] = useState("All");
  const [model, setModel] = useState("All");
  const [method, setMethod] = useState("All");
  const [quality, setQuality] = useState("All");
  const runs = useMemo(() => catalog.filter((run) => {
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || [run.run_id, workloadLabel(run), modelLabel(run), run.model_source_label, run.gpu_type, run.method, run.source_family].some((value) => String(value ?? "").toLowerCase().includes(needle));
    return matchesSearch
      && (workload === "All" || workloadLabel(run) === workload)
      && (gpu === "All" || run.gpu_type === gpu)
      && (model === "All" || modelLabel(run) === model)
      && (method === "All" || run.method === method)
      && (quality === "All" || run.quality_status === quality);
  }), [catalog, search, workload, gpu, model, method, quality]);

  function options(field: keyof Run) {
    return Array.from(new Set(catalog.map((run) => String(run[field])))).sort();
  }
  function clear() { setSearch(""); setWorkload("All"); setGpu("All"); setModel("All"); setMethod("All"); setQuality("All"); }
  const publishedWorkloads = Array.from(new Set(catalog.map(workloadLabel))).sort();

  return (
    <div className="dashboard-layout static-dashboard">
      <aside className="filter-sidebar static-sidebar">
        <div className="sidebar-heading"><div><p className="eyebrow">Catalog controls</p><h2>Filter traces</h2></div><span className="count-pill">{runs.length}</span></div>
        <label className="search-field"><span className="sr-only">Search traces</span><i>⌕</i><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Run ID, model, GPU…" /></label>
        <div className="filter-stack">
          {[
            ["Workload type", workload, setWorkload, workloadTypes],
            ["GPU type", gpu, setGpu, options("gpu_type")],
            ["Model", model, setModel, Array.from(new Set(catalog.map(modelLabel))).sort()],
            ["Execution method", method, setMethod, options("method")],
            ["Quality status", quality, setQuality, options("quality_status")],
          ].map(([label, value, setter, values]) => (
            <label className="filter-field" key={String(label)}><span>{String(label)}</span><select value={String(value)} onChange={(event) => (setter as (value: string) => void)(event.target.value)}><option>All</option>{(values as string[]).map((option) => <option key={option}>{option}</option>)}</select></label>
          ))}
        </div>
        <button className="clear-filters" type="button" onClick={clear}>Clear all filters</button>
        <div className="sidebar-footnote"><span className="privacy-dot" />Reviewed public traces and one clearly labeled synthetic showcase are included.</div>
      </aside>
      <main className="catalog-main">
        <PublicDataNotice />
        <section className="page-intro">
          <div><p className="eyebrow">Power telemetry catalog</p><h1>LLM Power Trace Explorer</h1><p>Interactive visualization and metadata browser for LLM training and inference GPU power traces.</p></div>
          <a className="text-link" href="#/about">Metric definitions →</a>
        </section>
        <section className="catalog-stats">
          <div><span>Published traces</span><strong>{catalog.length}</strong><small>public reference runs</small></div>
          <div><span>Current matches</span><strong>{runs.length}</strong><small>after active filters</small></div>
          <div><span>GPU families</span><strong>{options("gpu_type").length}</strong><small>{options("gpu_type").join(" · ")}</small></div>
          <div><span>Workload types</span><strong>{publishedWorkloads.length}</strong><small>{publishedWorkloads.join(" · ")}</small></div>
        </section>
        <section className="catalog-card">
          <div className="table-toolbar"><div><h2>Trace catalog</h2><p>{runs.length} public traces shown</p></div><div className="legend-inline"><QualityBadge status="PASS_MAIN" /></div></div>
          <div className="table-scroll">
            <table className="trace-table">
              <thead><tr><th>Run ID</th><th>Workload</th><th>Source</th><th>Model</th><th>Method</th><th>GPU</th><th>GPU Count</th><th>Seq Len</th><th>Microbatch</th><th>Grad Accum</th><th>Duration</th><th>Median Δt</th><th>Mean Power</th><th>P99 Power</th><th>R99 Up 1s</th><th>Energy</th><th>Quality</th><th /></tr></thead>
              <tbody>{runs.map((run) => <tr key={run.run_id} onClick={() => { window.location.hash = `/runs/${run.run_id}`; }} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") window.location.hash = `/runs/${run.run_id}`; }}>
                <td><strong className="run-id">{run.run_id}</strong><small>canonical_power_trace.csv</small></td>
                <td>{workloadLabel(run)}</td><td><span className="source-chip">{run.source_family}</span></td><td>{modelLabel(run)}</td><td>{run.method}</td><td>{run.gpu_type}</td><td>{run.gpu_count}</td><td>{run.sequence_length}</td><td>{run.microbatch_size}</td><td>{run.grad_accum_steps}</td><td>{fmtSeconds(run.duration_observed_s)}</td><td><FormatValue value={run.sampling_interval_observed_median_s} suffix=" s" digits={3} /></td><td><FormatValue value={run.mean_total_power_w} suffix=" W" /></td><td><FormatValue value={run.p99_total_power_w} suffix=" W" /></td><td><FormatValue value={run.ramp_up_p99_1s_w_per_s} suffix=" W/s" /></td><td><FormatValue value={run.total_energy_wh} suffix=" Wh" digits={2} /></td><td><QualityBadge status={run.quality_status} /></td><td><span className="row-arrow">→</span></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="table-footer"><span>Every trace is reviewed public data or explicitly labeled synthetic.</span><span>Open a run to zoom, pan, and inspect telemetry.</span></div>
        </section>
      </main>
    </div>
  );
}

function smoothSamples(samples: Sample[], windowS: number) {
  if (!windowS) return samples;
  const byGpu = new Map<string, Sample[]>();
  samples.forEach((sample) => {
    const rows = byGpu.get(sample.gpu_id);
    if (rows) rows.push(sample);
    else byGpu.set(sample.gpu_id, [sample]);
  });
  const result: Sample[] = [];
  byGpu.forEach((rows) => {
    const ordered = [...rows].sort((left, right) => left.time_relative_s - right.time_relative_s);
    let start = 0;
    let sum = 0;
    ordered.forEach((row, index) => {
      sum += row.power_w;
      while (ordered[start].time_relative_s < row.time_relative_s - windowS) {
        sum -= ordered[start].power_w;
        start += 1;
      }
      result.push({ ...row, power_w: sum / (index - start + 1) });
    });
  });
  return withComputedTotalPower(result);
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

function Detail({ detail }: { detail: PublicRunDetail }) {
  const { run } = detail;
  const synthetic = isSynthetic(run);
  const modelItems: [string, ReactNode][] = [
    ["Model", modelLabel(run)],
    ["Method", run.method],
    ["Precision / dtype", `${run.precision} / ${run.compute_dtype}`],
    ["Sequence length", run.sequence_length],
    ["Microbatch", run.microbatch_size],
    ["Grad accumulation", run.grad_accum_steps],
    ["Dataset", run.dataset_name],
  ];
  const [smoothing, setSmoothing] = useState(0);
  const raw = useMemo(() => withComputedTotalPower(detail.samples), [detail.samples]);
  const samples = useMemo(() => smoothSamples(raw, smoothing), [raw, smoothing]);
  const stages: { time_relative_s: number; stage: string }[] = [];
  let lastStage = "";
  raw.forEach((sample) => { if (sample.stage && sample.stage !== lastStage) { stages.push({ time_relative_s: sample.time_relative_s, stage: sample.stage }); lastStage = sample.stage; } });
  return <main className="detail-main static-detail">
    <PublicDataNotice />
    <div className="detail-breadcrumb"><a href="#/">Trace Catalog</a><span>/</span><span>{run.run_id}</span></div>
    <section className="run-heading"><div><p className="eyebrow">{synthetic ? "Synthetic showcase trace" : "Public trace detail"}</p><h1>Run: {run.run_id}</h1><div className="run-badges">{[workloadLabel(run), run.gpu_type, modelLabel(run), run.method, `Seq ${run.sequence_length}`, run.source_family].map((badge) => <span key={badge}>{badge}</span>)}<QualityBadge status={run.quality_status} /></div></div><div className="heading-actions"><a className="button button-secondary" href={`#/runs/${run.run_id}/data`}>▤ View Raw Data</a><a className="button button-primary" href={publicArtifactUrl(run.raw_csv_file_id)} download>↓ Download CSV</a></div></section>
    <div className="detail-grid">
      <section className="plot-card static-plot-card">
        <div className="panel-heading plot-heading"><div><p className="eyebrow">Canonical normalized telemetry</p><h2>GPU power over time</h2><p>{samples.length.toLocaleString()} plotted samples · scroll to zoom, drag to pan</p></div><div className="plot-controls"><label><span>Smoothing</span><select value={smoothing} onChange={(event) => setSmoothing(Number(event.target.value))}><option value="0">Raw</option><option value="1">Rolling 1 s</option><option value="5">Rolling 5 s</option><option value="10">Rolling 10 s</option></select></label></div></div>
        <PowerChart samples={samples} stages={stages} />
        <div className="plot-footnote"><span>{synthetic ? "Synthetic illustrative telemetry." : "Reviewed public data."}</span><span>Double-click to reset zoom.</span></div>
      </section>
      <aside className="metadata-panel">
        <div className="metadata-title"><div><p className="eyebrow">Run record</p><h2>Metadata</h2></div><span>{raw.length} samples</span></div>
        <MetadataCard title="Run Identity" items={[["Run ID", run.run_id], ["Workload type", workloadLabel(run)], ["Source family", run.source_family], ["Trace path", <code key="trace">{run.trace_path}</code>], ["Data status", synthetic ? "Illustrative synthetic telemetry (not measured)" : "Reviewed public export"]]} />
        <MetadataCard title="Model and Execution" items={modelItems} />
        <MetadataCard title="Hardware and Logging" items={[["GPU type", run.gpu_type], ["GPU count", run.gpu_count], ["Parallelism", run.parallelism], ["Median interval", `${run.sampling_interval_observed_median_s} s`], ["Clock telemetry", run.has_clock_telemetry ? "Available" : "Not found"], ["Utilization telemetry", run.has_utilization_telemetry ? "Available" : "Not found"], ["Memory telemetry", raw.some((sample) => sample.memory_used_mb != null) ? "Available" : "Not found"], ["Temperature telemetry", run.has_temperature_telemetry ? "Available" : "Not found"], ["Stage labels", run.has_stage_labels ? "Available" : "Not found"]]} />
        <MetadataCard title="Power Metrics" items={[["Mean total power", `${run.mean_total_power_w} W`], ["P99 total power", `${run.p99_total_power_w} W`], ["Max total power", `${run.max_total_power_w} W`], ["Total energy", `${run.total_energy_wh} Wh`], ["R99 upward ramp", `${run.ramp_up_p99_1s_w_per_s} W/s`]]} />
        <div className="metadata-actions"><a className="button button-primary" href={`#/runs/${run.run_id}/data`}>▤ View Raw Data</a><button className="button button-secondary" onClick={() => downloadText(`${run.run_id}_metadata.json`, JSON.stringify(run, null, 2), "application/json")}>↓ Metadata JSON</button><a className="button button-ghost" href="#/">← Back to Trace List</a></div>
      </aside>
    </div>
  </main>;
}

function RawData({ detail }: { detail: PublicRunDetail }) {
  const { run } = detail;
  const synthetic = isSynthetic(run);
  const all = useMemo(() => withComputedTotalPower(detail.samples), [detail.samples]);
  const runId = run.run_id;
  const [gpu, setGpu] = useState("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = all.filter((row) => (gpu === "All" || row.gpu_id === gpu) && (!search || Object.values(row).join(" ").toLowerCase().includes(search.toLowerCase())));
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const columns: [keyof Sample, string, string][] = [["timestamp", "Time", ""], ["time_relative_s", "Relative Time", "s"], ["gpu_id", "GPU ID", ""], ["power_w", "Power", "W"], ["total_power_w", "Total Power", "W"], ["gpu_util_pct", "GPU Util", "%"], ["memory_util_pct", "Memory Util", "%"], ["memory_used_mb", "Memory Used", "MB"], ["sm_clock_mhz", "SM Clock", "MHz"], ["temperature_c", "Temperature", "°C"]];
  return <main className="raw-main static-raw"><PublicDataNotice /><div className="detail-breadcrumb"><a href="#/">Trace Catalog</a><span>/</span><a href={`#/runs/${runId}`}>{runId}</a><span>/</span><span>Raw Data</span></div><section className="raw-heading"><div><p className="eyebrow">Canonical normalized samples</p><h1>Raw Trace Data</h1><p>{workloadLabel(run)} · {modelLabel(run)} · {run.gpu_type} · {synthetic ? "synthetic illustrative data" : "reviewed public data"}</p></div><div className="heading-actions"><a className="button button-secondary" href={`#/runs/${runId}`}>← Back to Trace</a></div></section>
    <section className="raw-controls"><label className="search-field raw-search"><span className="sr-only">Search</span><i>⌕</i><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search any displayed value…" /></label><label><span>GPU</span><select value={gpu} onChange={(event) => { setGpu(event.target.value); setPage(1); }}><option>All</option>{Array.from(new Set(all.map((row) => row.gpu_id))).map((id) => <option key={id} value={id}>GPU {id}</option>)}</select></label></section>
    <section className="raw-table-card"><div className="table-toolbar"><div><h2>Samples</h2><p>{filtered.length.toLocaleString()} matching rows · page {page} of {pages}</p></div></div><div className="table-scroll raw-scroll"><table className="trace-table raw-table"><thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.timestamp}-${row.gpu_id}-${index}`}>{columns.map(([key,,unit]) => <td key={key} className={key === "timestamp" ? "timestamp-cell" : "numeric-cell"}>{String(row[key] ?? "Not found")}{unit && row[key] != null ? ` ${unit}` : ""}</td>)}</tr>)}</tbody></table></div><div className="pagination"><button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>‹ Previous</button><span>Page <strong>{page}</strong> of <strong>{pages}</strong></span><button onClick={() => setPage(Math.min(pages, page + 1))} disabled={page === pages}>Next ›</button></div></section>
  </main>;
}

function About() {
  return <main className="about-main static-about"><PublicDataNotice /><div className="detail-breadcrumb"><a href="#/">Trace Catalog</a><span>/</span><span>About</span></div><section className="about-hero"><p className="eyebrow">Public research dataset</p><h1>About the trace explorer</h1><p>This GitHub Pages edition presents reviewed, canonical GPU power traces selected for intentional public release, plus one clearly labeled synthetic full-telemetry showcase. The local FastAPI edition remains available for private-data workflows and is unchanged.</p><div className="privacy-callout"><span className="privacy-dot" /><div><strong>Public by design</strong><p>Displayed data is sanitized and either research-ready or explicitly synthetic; private HPC inputs are not included.</p></div></div></section><div className="about-grid"><section className="about-card"><p className="eyebrow">Metric definition</p><h2>Mean power</h2><div className="formula">mean(P<sub>total</sub>(t))</div><p>Mean of total observed GPU power over normalized timestamps.</p></section><section className="about-card"><p className="eyebrow">Metric definition</p><h2>Total energy</h2><div className="formula">∑ P<sub>total</sub>(t) × Δt / 3600</div><p>Timestamp-aware trapezoidal integration in watt-hours.</p></section><section className="about-card"><p className="eyebrow">Metric definition</p><h2>High-percentile power</h2><div className="formula">P95, P99 of P<sub>total</sub>(t)</div><p>High quantiles of the normalized total-power series.</p></section><section className="about-card"><p className="eyebrow">Metric definition</p><h2>Ramp rate</h2><div className="formula">R<sub>δ</sub>(t) = [P(t) − P(t − δ)] / δ</div><p>Computed from actual time rather than fixed row offsets.</p></section></div><div className="about-actions"><a className="button button-primary" href="#/">← Return to Trace Catalog</a><a className="button button-secondary" href={REPOSITORY_URL} target="_blank" rel="noreferrer">View source on GitHub ↗</a></div></main>;
}

function NotFound() { return <main className="standalone-state"><EmptyState title="Route not found">Return to the public trace catalog.</EmptyState><a className="button button-primary" href="#/">Back to catalog</a></main>; }

function RunRoute({ catalog, runId, rawData }: { catalog: PublicRun[]; runId: string; rawData: boolean }) {
  const catalogRun = catalog.find((run) => run.run_id === runId);
  const [detail, setDetail] = useState<PublicRunDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!catalogRun) return;
    const controller = new AbortController();
    setDetail(null);
    setError("");
    loadRun(catalogRun, controller.signal).then(setDetail).catch((reason) => {
      if (reason.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Unable to load run");
    });
    return () => controller.abort();
  }, [catalogRun]);
  if (!catalogRun) return <NotFound />;
  if (error) return <main className="standalone-state"><EmptyState title="Run data unavailable">{error}</EmptyState></main>;
  if (!detail) return <main className="standalone-state"><LoadingBlock label="Loading public trace…" /></main>;
  return rawData ? <RawData detail={detail} /> : <Detail detail={detail} />;
}

export function StaticDemoApp() {
  const route = useHashRoute();
  const [catalog, setCatalog] = useState<PublicRun[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal).then(setCatalog).catch((reason) => {
      if (reason.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Unable to load catalog");
    });
    return () => controller.abort();
  }, []);
  let page: ReactNode;
  if (error) page = <main className="standalone-state"><EmptyState title="Catalog unavailable">{error}</EmptyState></main>;
  else if (!catalog) page = <main className="standalone-state"><LoadingBlock label="Loading public catalog…" /></main>;
  else if (route === "/" || route === "") page = <Home catalog={catalog} />;
  else if (route === "/about") page = <About />;
  else {
    const dataMatch = route.match(/^\/runs\/([^/]+)\/data$/);
    const runMatch = route.match(/^\/runs\/([^/]+)$/);
    if (dataMatch) page = <RunRoute catalog={catalog} runId={decodeURIComponent(dataMatch[1])} rawData />;
    else if (runMatch) page = <RunRoute catalog={catalog} runId={decodeURIComponent(runMatch[1])} rawData={false} />;
    else page = <NotFound />;
  }
  return <div className="app-frame static-app"><Header />{page}<footer className="static-footer">LLM Power Trace Explorer · Public reference &amp; demo data · <a href={REPOSITORY_URL}>Source on GitHub</a></footer></div>;
}

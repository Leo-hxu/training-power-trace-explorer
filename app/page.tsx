"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "./components/AppHeader";
import { EmptyState, FormatValue, LoadingBlock, QualityBadge } from "./components/Ui";
import { API_BASE, apiFetch, fetchFilters, type RunsResponse } from "./lib/api";
import type { Filters, Run } from "./lib/types";

type FilterState = Record<string, string>;

const FILTERS: { key: string; label: string; optionsKey?: string }[] = [
  { key: "source_family", label: "Source family" },
  { key: "gpu_type", label: "GPU type" },
  { key: "model", label: "Model" },
  { key: "model_family", label: "Model family" },
  { key: "method", label: "Training method" },
  { key: "precision", label: "Precision / dtype" },
  { key: "sequence_length", label: "Sequence length" },
  { key: "microbatch_size", label: "Microbatch size" },
  { key: "grad_accum_steps", label: "Gradient accumulation" },
  { key: "checkpoint_interval", label: "Checkpoint interval" },
  { key: "parallelism", label: "Parallelism" },
  { key: "sampling_resolution", label: "Sampling resolution" },
  { key: "quality_status", label: "Quality status" },
  { key: "has_stage_labels", label: "Has stage labels", optionsKey: "boolean" },
  { key: "has_clock_telemetry", label: "Has clock telemetry", optionsKey: "boolean" },
];

function formatSeconds(value: number | null | undefined) {
  if (value === null || value === undefined) return "Unknown";
  if (value >= 60) return `${(value / 60).toFixed(1)} min`;
  return `${value.toFixed(value < 1 ? 3 : 1)} s`;
}

function buildQuery(filters: FilterState, search: string) {
  const params = new URLSearchParams({ limit: "5000" });
  for (const [key, value] of Object.entries(filters)) {
    if (!value || value === "All") continue;
    if (key === "sampling_resolution") continue;
    if (key.startsWith("has_")) params.set(key, value === "Yes" ? "true" : "false");
    else params.set(key, value);
  }
  if (search.trim()) params.set("search", search.trim());
  return params;
}

function applySamplingFilter(runs: Run[], value: string) {
  if (!value || value === "All") return runs;
  return runs.filter((run) => {
    const interval = run.sampling_interval_observed_median_s;
    if (value === "≤ 0.25 s") return interval <= 0.25;
    if (value === "0.25–1 s") return interval > 0.25 && interval <= 1;
    if (value === "> 1 s") return interval > 1;
    return true;
  });
}

function FilterSelect({
  filter,
  values,
  value,
  onChange,
}: {
  filter: (typeof FILTERS)[number];
  values: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-field">
      <span>{filter.label}</span>
      <select value={value || "All"} onChange={(event) => onChange(event.target.value)}>
        <option value="All">All</option>
        {values.map((option) => <option value={option} key={option}>{option}</option>)}
      </select>
    </label>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [availableFilters, setAvailableFilters] = useState<Filters>({});
  const [filters, setFilters] = useState<FilterState>({});
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [response, setResponse] = useState<RunsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 240);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    fetchFilters().then(setAvailableFilters).catch(() => setAvailableFilters({}));
  }, []);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = buildQuery(filters, debouncedSearch);
      const data = await apiFetch<RunsResponse>(`/api/runs?${query}`);
      setResponse(data);
    } catch {
      setError("The local trace API is not responding. Start the app with ./run_app.sh and try again.");
    } finally {
      setLoading(false);
    }
  }, [filters, debouncedSearch]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  const runs = useMemo(
    () => applySamplingFilter(response?.runs ?? [], filters.sampling_resolution),
    [response, filters.sampling_resolution],
  );
  const activeCount = Object.values(filters).filter((value) => value && value !== "All").length + (search ? 1 : 0);
  const qualityGood = runs.filter((run) => run.quality_status === "Good").length;
  const telemetry = runs.filter((run) => run.has_clock_telemetry && run.has_utilization_telemetry).length;

  function updateFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setFilters({});
    setSearch("");
  }

  return (
    <div className="app-frame">
      <AppHeader onToggleFilters={() => setFiltersOpen((open) => !open)} filtersOpen={filtersOpen} />
      <div className="dashboard-layout">
        <aside className={`filter-sidebar ${filtersOpen ? "is-open" : ""}`}>
          <div className="sidebar-heading">
            <div>
              <p className="eyebrow">Catalog controls</p>
              <h2>Filter traces</h2>
            </div>
            {activeCount ? <span className="count-pill">{activeCount}</span> : null}
          </div>
          <label className="search-field">
            <span className="sr-only">Search traces</span>
            <i aria-hidden="true">⌕</i>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Run ID, model, filename, path…"
            />
          </label>
          <div className="filter-stack">
            {FILTERS.map((filter) => (
              <FilterSelect
                key={filter.key}
                filter={filter}
                value={filters[filter.key] || "All"}
                values={availableFilters[filter.optionsKey || filter.key] || []}
                onChange={(value) => updateFilter(filter.key, value)}
              />
            ))}
          </div>
          <button className="clear-filters" type="button" onClick={clearFilters} disabled={!activeCount}>
            Clear all filters
          </button>
          <div className="sidebar-footnote">
            <span className="privacy-dot" />
            Data stays on this machine. Nothing is uploaded.
          </div>
        </aside>

        <main className="catalog-main">
          <section className="page-intro">
            <div>
              <p className="eyebrow">Power telemetry catalog</p>
              <h1>Training Power Trace Explorer</h1>
              <p>Interactive visualization and metadata browser for LLM training GPU power traces.</p>
            </div>
            <a className="text-link" href={`${API_BASE}/api/catalog/report`} target="_blank" rel="noreferrer">
              Catalog report <span aria-hidden="true">↗</span>
            </a>
          </section>

          <section className="catalog-stats" aria-label="Catalog summary">
            <div><span>Indexed traces</span><strong>{response?.catalog_total ?? "—"}</strong><small>normalized runs</small></div>
            <div><span>Current matches</span><strong>{runs.length}</strong><small>{activeCount ? `${activeCount} active filters` : "entire catalog"}</small></div>
            <div><span>Good quality</span><strong>{qualityGood}</strong><small>{runs.length ? `${Math.round((qualityGood / runs.length) * 100)}% of matches` : "no matches"}</small></div>
            <div><span>Rich telemetry</span><strong>{telemetry}</strong><small>clock + utilization</small></div>
          </section>

          <section className="catalog-card">
            <div className="table-toolbar">
              <div>
                <h2>Trace catalog</h2>
                <p>{loading ? "Updating…" : `${runs.length.toLocaleString()} of ${(response?.catalog_total ?? 0).toLocaleString()} traces shown`}</p>
              </div>
              <div className="legend-inline"><QualityBadge status="Good" /><QualityBadge status="Warning" /><QualityBadge status="Error" /></div>
            </div>
            {loading ? <LoadingBlock /> : error ? (
              <EmptyState title="Catalog unavailable">{error}</EmptyState>
            ) : runs.length === 0 ? (
              <EmptyState title="No traces match">Try clearing one or more filters, or scan the configured directories again.</EmptyState>
            ) : (
              <div className="table-scroll">
                <table className="trace-table">
                  <thead>
                    <tr>
                      <th>Run ID</th><th>Source</th><th>Model</th><th>Method</th><th>GPU</th><th>GPU Count</th>
                      <th>Seq Len</th><th>Microbatch</th><th>Grad Accum</th><th>Duration</th><th>Median Δt</th>
                      <th>Mean Power</th><th>P99 Power</th><th>R99 Up 1s</th><th>Energy</th><th>Quality</th><th aria-label="Open" />
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr
                        key={run.run_id}
                        tabIndex={0}
                        onClick={() => router.push(`/runs/${encodeURIComponent(run.run_id)}`)}
                        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") router.push(`/runs/${encodeURIComponent(run.run_id)}`); }}
                      >
                        <td><strong className="run-id">{run.run_id}</strong><small>{run.trace_path.split("/").pop()}</small></td>
                        <td><span className="source-chip">{run.source_family}</span></td>
                        <td>{run.model}</td><td>{run.method}</td><td>{run.gpu_type}</td><td>{run.gpu_count}</td>
                        <td>{run.sequence_length}</td><td>{run.microbatch_size}</td><td>{run.grad_accum_steps}</td>
                        <td>{formatSeconds(run.duration_observed_s)}</td>
                        <td><FormatValue value={run.sampling_interval_observed_median_s} suffix=" s" digits={3} /></td>
                        <td><FormatValue value={run.mean_total_power_w} suffix=" W" /></td>
                        <td><FormatValue value={run.p99_total_power_w} suffix=" W" /></td>
                        <td><FormatValue value={run.ramp_up_p99_1s_w_per_s} suffix=" W/s" /></td>
                        <td><FormatValue value={run.total_energy_wh} suffix=" Wh" digits={2} /></td>
                        <td><QualityBadge status={run.quality_status} /></td>
                        <td><span className="row-arrow" aria-hidden="true">→</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="table-footer">
              <span>Server-filtered catalog; raw samples load only when you open a run.</span>
              <span>Peak-preserving plot downsampling enabled by default.</span>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

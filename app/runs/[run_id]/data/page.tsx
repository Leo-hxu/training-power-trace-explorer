"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "../../../components/AppHeader";
import { EmptyState, LoadingBlock } from "../../../components/Ui";
import { API_BASE, apiFetch, fetchRun } from "../../../lib/api";
import type { Run, Sample } from "../../../lib/types";

type RawResponse = {
  rows: Sample[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  gpu_ids: string[];
};

const COLUMNS: { key: keyof Sample; label: string; unit?: string; digits?: number }[] = [
  { key: "timestamp", label: "Time" },
  { key: "time_relative_s", label: "Relative Time", unit: "s", digits: 3 },
  { key: "gpu_id", label: "GPU ID" },
  { key: "power_w", label: "Power", unit: "W", digits: 2 },
  { key: "total_power_w", label: "Total Power", unit: "W", digits: 2 },
  { key: "gpu_util_pct", label: "GPU Util", unit: "%", digits: 1 },
  { key: "memory_util_pct", label: "Memory Util", unit: "%", digits: 1 },
  { key: "memory_used_mb", label: "Memory Used", unit: "MB", digits: 0 },
  { key: "sm_clock_mhz", label: "SM Clock", unit: "MHz", digits: 0 },
  { key: "temperature_c", label: "Temperature", unit: "°C", digits: 1 },
];

function display(value: unknown, unit = "", digits = 2) {
  if (value === null || value === undefined || value === "") return <span className="not-found">Not found</span>;
  if (typeof value === "number") return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })}${unit ? ` ${unit}` : ""}`;
  return String(value);
}

export default function RawDataPage() {
  const params = useParams<{ run_id: string }>();
  const runId = decodeURIComponent(params.run_id);
  const [run, setRun] = useState<Run | null>(null);
  const [data, setData] = useState<RawResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [gpuId, setGpuId] = useState("");
  const [startS, setStartS] = useState("");
  const [endS, setEndS] = useState("");
  const [sortBy, setSortBy] = useState("time_relative_s");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [gpuOptions, setGpuOptions] = useState<string[]>([]);

  useEffect(() => {
    fetchRun(runId).then(setRun).catch(() => setError("Run metadata could not be loaded."));
  }, [runId]);

  useEffect(() => {
    const handle = window.setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 220);
    return () => window.clearTimeout(handle);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page), page_size: String(pageSize), sort_by: sortBy, sort_dir: sortDir,
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (gpuId) params.set("gpu_id", gpuId);
    if (startS) params.set("start_s", startS);
    if (endS) params.set("end_s", endS);
    return params;
  }, [page, pageSize, sortBy, sortDir, debouncedSearch, gpuId, startS, endS]);

  const loadRows = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await apiFetch<RawResponse>(`/api/runs/${encodeURIComponent(runId)}/raw?${query}`);
      setData(response);
      if (!gpuId) setGpuOptions((current) => Array.from(new Set([...current, ...response.gpu_ids])).sort());
    } catch {
      setError("Normalized raw data could not be loaded. Rebuild the catalog and try again.");
    } finally { setLoading(false); }
  }, [runId, query, gpuId]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  function sort(key: string) {
    if (sortBy === key) setSortDir((direction) => direction === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir("asc"); }
    setPage(1);
  }

  function clearRange() { setGpuId(""); setStartS(""); setEndS(""); setSearch(""); setPage(1); }

  const downloadQuery = new URLSearchParams();
  if (gpuId) downloadQuery.set("gpu_id", gpuId);
  if (startS) downloadQuery.set("start_s", startS);
  if (endS) downloadQuery.set("end_s", endS);

  return (
    <div className="app-frame">
      <AppHeader />
      <main className="raw-main">
        <div className="detail-breadcrumb"><Link href="/">Trace Catalog</Link><span>/</span><Link href={`/runs/${encodeURIComponent(runId)}`}>{runId}</Link><span>/</span><span>Raw Data</span></div>
        <section className="raw-heading">
          <div><p className="eyebrow">Normalized samples</p><h1>Raw Trace Data</h1><p>{run ? `${run.model} · ${run.gpu_type} · ${run.source_family}` : runId}</p></div>
          <div className="heading-actions">
            <Link className="button button-secondary" href={`/runs/${encodeURIComponent(runId)}`}>← Back to Trace</Link>
            <a className="button button-primary" href={`${API_BASE}/api/runs/${encodeURIComponent(runId)}/download/raw.csv?${downloadQuery}`}>↓ Download Filtered CSV</a>
          </div>
        </section>

        <section className="raw-controls">
          <label className="search-field raw-search"><span className="sr-only">Search raw data</span><i aria-hidden="true">⌕</i><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search any displayed value…" /></label>
          <label><span>GPU</span><select value={gpuId} onChange={(event) => { setGpuId(event.target.value); setPage(1); }}><option value="">All GPUs</option>{gpuOptions.map((gpu) => <option key={gpu} value={gpu}>GPU {gpu}</option>)}</select></label>
          <label><span>Start (s)</span><input type="number" min="0" step="0.1" value={startS} onChange={(event) => { setStartS(event.target.value); setPage(1); }} placeholder="0.0" /></label>
          <label><span>End (s)</span><input type="number" min="0" step="0.1" value={endS} onChange={(event) => { setEndS(event.target.value); setPage(1); }} placeholder="Full trace" /></label>
          <button className="button button-ghost" type="button" onClick={clearRange}>Clear</button>
        </section>

        <section className="raw-table-card">
          <div className="table-toolbar">
            <div><h2>Samples</h2><p>{data ? `${data.total.toLocaleString()} matching rows · page ${data.page} of ${data.pages}` : "Loading rows…"}</p></div>
            <label className="rows-per-page"><span>Rows</span><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option>25</option><option>50</option><option>100</option><option>250</option></select></label>
          </div>
          {loading ? <LoadingBlock label="Loading normalized samples…" /> : error ? <EmptyState title="Raw data unavailable">{error}</EmptyState> : !data?.rows.length ? <EmptyState title="No samples match">Adjust the GPU, time range, or search controls.</EmptyState> : (
            <div className="table-scroll raw-scroll">
              <table className="trace-table raw-table">
                <thead><tr>{COLUMNS.map((column) => <th key={column.key} aria-sort={sortBy === column.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}><button type="button" onClick={() => sort(column.key)}>{column.label}<span>{sortBy === column.key ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span></button></th>)}</tr></thead>
                <tbody>{data.rows.map((row, index) => <tr key={`${row.timestamp}-${row.gpu_id}-${index}`}>{COLUMNS.map((column) => <td key={column.key} className={column.key === "timestamp" ? "timestamp-cell" : "numeric-cell"}>{display(row[column.key], column.unit, column.digits)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          <div className="pagination">
            <button type="button" onClick={() => setPage(1)} disabled={page <= 1}>« First</button>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>‹ Previous</button>
            <span>Page <strong>{data?.page ?? page}</strong> of <strong>{data?.pages ?? 1}</strong></span>
            <button type="button" onClick={() => setPage((value) => Math.min(data?.pages ?? value, value + 1))} disabled={page >= (data?.pages ?? 1)}>Next ›</button>
            <button type="button" onClick={() => setPage(data?.pages ?? 1)} disabled={page >= (data?.pages ?? 1)}>Last »</button>
          </div>
        </section>
      </main>
    </div>
  );
}


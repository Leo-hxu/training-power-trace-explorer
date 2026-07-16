import type { Filters, Run, Sample } from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_TRACE_API_URL || "http://127.0.0.1:8000";

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store", ...init });
  if (!response.ok) {
    let details: unknown = null;
    try {
      details = await response.json();
    } catch {
      details = await response.text();
    }
    const message =
      typeof details === "object" && details && "detail" in details
        ? JSON.stringify((details as { detail: unknown }).detail)
        : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, details);
  }
  return response.json() as Promise<T>;
}

export type RunsResponse = {
  runs: Run[];
  total: number;
  catalog_total: number;
  failed: number;
  limit: number;
  offset: number;
};

export type SamplesResponse = {
  run_id: string;
  samples: Sample[];
  stages: { time_relative_s: number; stage: string }[];
  total_samples: number;
  selected_samples: number;
  returned_samples: number;
  downsampling: string;
  smoothing_window_s: number;
};

export function fetchFilters() {
  return apiFetch<Filters>("/api/filters");
}

export function fetchRun(runId: string) {
  return apiFetch<Run>(`/api/runs/${encodeURIComponent(runId)}`);
}

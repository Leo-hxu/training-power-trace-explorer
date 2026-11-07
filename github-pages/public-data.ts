import type { Run, Sample } from "../app/lib/types";

export type PublicRun = Run & {
  /** Per-run payload (legacy layout). Bundled catalogs use display_bundle_file_id instead. */
  run_json_file_id?: string;
  /** Shared Drive file holding several runs as {entry: PublicRunDetail}. */
  display_bundle_file_id?: string;
  display_bundle_entry?: string;
  /** Optional downloadable artifacts. Compact public records embed this data in run_json_file_id. */
  raw_csv_file_id?: string | null;
  metadata_json_file_id?: string | null;
  /** Optional Google Drive CSV containing the time-binned inference demand series. */
  request_timeline_file_id?: string | null;
};

export type InferenceRequestTimelinePoint = {
  time_relative_s: number | string;
  window_s?: number | string | null;
  requests_arrived?: number | string | null;
  active_requests?: number | string | null;
  mean_prompt_tokens?: number | string | null;
  mean_output_tokens?: number | string | null;
  mean_request_tokens?: number | string | null;
};

export type PublicRunDetail = {
  run: PublicRun;
  samples: Sample[];
  /** Optional request-demand series aligned to the power trace's relative time. */
  inference_timeline?: InferenceRequestTimelinePoint[];
};

type DriveConfiguration = {
  apiKey: string;
  catalogFileId: string;
};

function driveConfiguration(): DriveConfiguration {
  const apiKey = import.meta.env.VITE_GOOGLE_DRIVE_API_KEY?.trim();
  const catalogFileId = import.meta.env.VITE_GOOGLE_DRIVE_CATALOG_FILE_ID?.trim();
  if (!apiKey || !catalogFileId) {
    throw new Error("This deployment is missing its Google Drive public-data configuration.");
  }
  return { apiKey, catalogFileId };
}

function googleDriveContentUrl(fileId: string) {
  const { apiKey } = driveConfiguration();
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("alt", "media");
  url.searchParams.set("key", apiKey);
  return url.toString();
}

async function loadJson<T>(fileId: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(googleDriveContentUrl(fileId), { signal });
  if (!response.ok) throw new Error(`Google Drive data request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export const loadCatalog = (signal?: AbortSignal) =>
  loadJson<PublicRun[]>(driveConfiguration().catalogFileId, signal);

const bundleCache = new Map<string, Promise<Record<string, PublicRunDetail>>>();

function loadBundle(fileId: string) {
  let bundle = bundleCache.get(fileId);
  if (!bundle) {
    // Not tied to one caller's AbortSignal: other runs in the same bundle reuse it.
    bundle = loadJson<Record<string, PublicRunDetail>>(fileId);
    bundle.catch(() => bundleCache.delete(fileId));
    bundleCache.set(fileId, bundle);
  }
  return bundle;
}

export async function loadRun(run: PublicRun, signal?: AbortSignal): Promise<PublicRunDetail> {
  if (run.display_bundle_file_id) {
    const bundle = await loadBundle(run.display_bundle_file_id);
    signal?.throwIfAborted();
    const entry = bundle[run.display_bundle_entry ?? run.run_id];
    if (!entry) throw new Error(`Run ${run.run_id} is missing from its data bundle`);
    return { ...entry, run: { ...entry.run, ...run } };
  }
  if (!run.run_json_file_id) throw new Error(`Run ${run.run_id} has no published data file`);
  return loadJson<PublicRunDetail>(run.run_json_file_id, signal);
}

export const publicArtifactUrl = (fileId: string) => googleDriveContentUrl(fileId);

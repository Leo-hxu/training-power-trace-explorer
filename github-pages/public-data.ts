import type { Run, Sample } from "../app/lib/types";

export type PublicRun = Run & {
  run_json_path: string;
  raw_csv_path: string;
  metadata_json_path: string;
};

export type PublicRunDetail = { run: PublicRun; samples: Sample[] };

const publicDataUrl = (path: string) =>
  `${import.meta.env.BASE_URL}public-data/${path.replace(/^\/+/, "")}`;

async function loadJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(publicDataUrl(path), { signal });
  if (!response.ok) throw new Error(`Public data request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export const loadCatalog = (signal?: AbortSignal) =>
  loadJson<PublicRun[]>("catalog.json", signal);

export const loadRun = (run: PublicRun, signal?: AbortSignal) =>
  loadJson<PublicRunDetail>(run.run_json_path, signal);

export const publicArtifactUrl = (path: string) => publicDataUrl(path);

import type { Run, Sample } from "../app/lib/types";

export type PublicRun = Run & {
  run_json_file_id: string;
  raw_csv_file_id: string;
  metadata_json_file_id: string;
};

export type PublicRunDetail = { run: PublicRun; samples: Sample[] };

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

export const loadRun = (run: PublicRun, signal?: AbortSignal) =>
  loadJson<PublicRunDetail>(run.run_json_file_id, signal);

export const publicArtifactUrl = (fileId: string) => googleDriveContentUrl(fileId);

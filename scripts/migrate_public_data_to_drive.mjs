import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const accessToken = process.env.GOOGLE_DRIVE_ACCESS_TOKEN?.trim();
const parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim();
const sourceRoot = process.env.PUBLIC_TRACE_SOURCE_DIR?.trim() || "github-pages/public-data";
const dryRun = process.argv.includes("--dry-run");

if (!dryRun && (!accessToken || !parentFolderId)) {
  throw new Error("Set GOOGLE_DRIVE_ACCESS_TOKEN and GOOGLE_DRIVE_PARENT_FOLDER_ID before running this migration.");
}

const driveApi = "https://www.googleapis.com/drive/v3";
const uploadApi = "https://www.googleapis.com/upload/drive/v3";

async function driveRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Drive request failed (${response.status}): ${detail}`);
  }
  return response.json();
}

async function createFolder(name, parent) {
  const result = await driveRequest(`${driveApi}/files?fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
  });
  return result.id;
}

async function uploadFile({ name, mimeType, content, parent }) {
  const boundary = `drive_upload_${crypto.randomUUID()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name, mimeType, parents: [parent] }),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const result = await driveRequest(`${uploadApi}/files?uploadType=multipart&fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return result.id;
}

async function makePublic(fileId) {
  await driveRequest(`${driveApi}/files/${fileId}/permissions?supportsAllDrives=true&sendNotificationEmail=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "anyone", role: "reader" }),
  });
}

async function uploadPublicFile(options) {
  const fileId = await uploadFile(options);
  await makePublic(fileId);
  return fileId;
}

const catalog = JSON.parse(await readFile(join(sourceRoot, "catalog.json"), "utf8"));
if (dryRun) {
  let samples = 0;
  for (const sourceRun of catalog) {
    const detail = JSON.parse(await readFile(join(sourceRoot, sourceRun.run_json_path), "utf8"));
    await Promise.all([
      readFile(join(sourceRoot, sourceRun.metadata_json_path)),
      readFile(join(sourceRoot, sourceRun.raw_csv_path)),
    ]);
    samples += detail.samples.length;
  }
  console.log(`Dry run passed: ${catalog.length} trace records and ${samples.toLocaleString()} samples are ready for Google Drive.`);
  process.exit(0);
}
const folders = {
  runs: await createFolder("runs", parentFolderId),
  metadata: await createFolder("metadata", parentFolderId),
  raw: await createFolder("raw", parentFolderId),
};
await Promise.all(Object.values(folders).map(makePublic));

const driveCatalog = [];
for (const sourceRun of catalog) {
  const runId = sourceRun.run_id;
  const sourceDetail = JSON.parse(await readFile(join(sourceRoot, sourceRun.run_json_path), "utf8"));
  const sourceMetadata = JSON.parse(await readFile(join(sourceRoot, sourceRun.metadata_json_path), "utf8"));
  const sourceCsv = await readFile(join(sourceRoot, sourceRun.raw_csv_path), "utf8");

  const rawCsvFileId = await uploadPublicFile({
    name: basename(sourceRun.raw_csv_path), mimeType: "text/csv", content: sourceCsv, parent: folders.raw,
  });
  const metadataJsonFileId = await uploadPublicFile({
    name: basename(sourceRun.metadata_json_path), mimeType: "application/json", content: JSON.stringify({
      ...sourceMetadata,
      storage: { provider: "google-drive", raw_csv_file_id: rawCsvFileId },
    }, null, 2), parent: folders.metadata,
  });

  const publicRun = {
    ...sourceRun,
    source_directory: "Google Drive public data store",
    trace_path: `Google Drive / raw / ${basename(sourceRun.raw_csv_path)}`,
    meta_path: `Google Drive / metadata / ${basename(sourceRun.metadata_json_path)}`,
    raw_csv_file_id: rawCsvFileId,
    metadata_json_file_id: metadataJsonFileId,
  };
  const runJsonFileId = await uploadPublicFile({
    name: basename(sourceRun.run_json_path), mimeType: "application/json", content: JSON.stringify({
      run: publicRun,
      samples: sourceDetail.samples,
    }), parent: folders.runs,
  });
  driveCatalog.push({ ...publicRun, run_json_file_id: runJsonFileId });
  console.log(`Uploaded ${runId}`);
}

const catalogFileId = await uploadPublicFile({
  name: "catalog.json",
  mimeType: "application/json",
  content: JSON.stringify(driveCatalog, null, 2),
  parent: parentFolderId,
});

console.log("\nMigration complete. Set these GitHub Actions repository variables:");
console.log(`GOOGLE_DRIVE_CATALOG_FILE_ID=${catalogFileId}`);
console.log("GOOGLE_DRIVE_API_KEY=<your browser-restricted Google Cloud API key>");

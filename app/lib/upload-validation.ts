const TIME_FIELDS = ["timestamp", "time", "datetime", "elapsed_s", "time_s"];
const POWER_FIELDS = ["power_w", "power", "power.draw [w]", "power.draw", "power_draw_w", "watts", "gpu_power"];
const GPU_FIELDS = ["gpu", "gpu_id", "index", "device"];

export const MAX_TRACE_BYTES = 25 * 1024 * 1024;
export const MAX_METADATA_BYTES = 256 * 1024;

export type TraceSummary = {
  headers: string[];
  rowCount: number;
  gpuIds: string[];
  timeColumn: string;
  powerColumn: string;
  gpuColumn: string | null;
  warning: string | null;
};

export type TraceValidation =
  | { ok: true; summary: TraceSummary }
  | { ok: false; error: string };

export type MetadataValidation =
  | { ok: true; metadata: Record<string, unknown> }
  | { ok: false; error: string };

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

function firstNonBlankLine(content: string): { line: string; nextOffset: number } | null {
  const lines = content.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    offset += line.length + 1;
    if (line.trim()) return { line, nextOffset: offset };
  }
  return null;
}

function valueAt(row: string[], headerIndex: number | undefined): string | null {
  if (headerIndex === undefined) return null;
  const value = row[headerIndex]?.trim();
  return value || null;
}

export function validateTraceCsv(filename: string, content: string): TraceValidation {
  if (!filename.toLowerCase().endsWith(".csv")) {
    return { ok: false, error: "The power trace must be a .csv file." };
  }

  const first = firstNonBlankLine(content);
  if (!first) return { ok: false, error: "The CSV file is empty." };

  const headers = parseCsvLine(first.line).map((value) => value.replace(/^\uFEFF/, "").trim());
  const normalizedHeaders = headers.map((value) => value.toLowerCase());
  if (!headers.length || headers.some((value) => !value)) {
    return { ok: false, error: "The CSV header row contains an empty column name." };
  }
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    return { ok: false, error: "The CSV header row contains duplicate column names." };
  }

  const timeIndex = normalizedHeaders.findIndex((header) => TIME_FIELDS.includes(header));
  const powerIndex = normalizedHeaders.findIndex((header) => POWER_FIELDS.includes(header));
  const gpuIndex = normalizedHeaders.findIndex((header) => GPU_FIELDS.includes(header));
  if (timeIndex < 0 || powerIndex < 0) {
    return {
      ok: false,
      error: "Include a time column (timestamp, time, or elapsed_s) and a power column (power_w, watts, or power.draw [W]).",
    };
  }

  const remainingLines = content.slice(first.nextOffset).split(/\r?\n/);
  let rowCount = 0;
  const gpuIds = new Set<string>();
  for (const line of remainingLines) {
    if (!line.trim()) continue;
    const row = parseCsvLine(line);
    const time = valueAt(row, timeIndex);
    const power = valueAt(row, powerIndex);
    const numericPower = power?.replace(/[^0-9+\-.eE]/g, "") ?? "";
    if (!time || !power || !numericPower || !Number.isFinite(Number(numericPower))) {
      return { ok: false, error: `Row ${rowCount + 2} is missing a usable time or power value.` };
    }
    const gpu = valueAt(row, gpuIndex);
    if (gpu) gpuIds.add(gpu);
    rowCount += 1;
  }
  if (!rowCount) return { ok: false, error: "The CSV has a header but no power samples." };

  return {
    ok: true,
    summary: {
      headers,
      rowCount,
      gpuIds: [...gpuIds].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
      timeColumn: headers[timeIndex],
      powerColumn: headers[powerIndex],
      gpuColumn: gpuIndex >= 0 ? headers[gpuIndex] : null,
      warning: gpuIndex < 0 ? "No GPU identifier column was found; this trace will be treated as one GPU." : null,
    },
  };
}

export function validateMetadataJson(filename: string, content: string): MetadataValidation {
  if (!filename.toLowerCase().endsWith(".json")) {
    return { ok: false, error: "Metadata must be a .json file." };
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return { ok: false, error: "Metadata must be a JSON object, not a list or scalar value." };
    }
    return { ok: true, metadata: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Metadata is not valid JSON." };
  }
}

export function metadataText(metadata: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return null;
}

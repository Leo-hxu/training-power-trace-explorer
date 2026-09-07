import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUTPUT_COLUMNS = [
  "time_relative_s",
  "window_s",
  "requests_arrived",
  "active_requests",
  "mean_prompt_tokens",
  "mean_output_tokens",
  "mean_request_tokens",
];

const fieldAliases = {
  arrival: ["time_relative_s", "arrival_time", "arrival_timestamp", "timestamp"],
  completion: ["completion_time", "completed_time", "completion_timestamp", "finish_time"],
  active: ["active_requests", "in_flight_requests", "concurrency"],
  prompt: ["prompt_tokens", "input_tokens"],
  output: ["output_tokens", "generated_tokens", "completion_tokens"],
};

function usage() {
  console.log("Usage: node scripts/normalize_inference_request_timeline.mjs --input <events.csv> --output <timeline.csv> [--window-s 5]");
}

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [headers = [], ...values] = rows;
  return values.map((cells) => Object.fromEntries(headers.map((header, index) => [header.trim(), (cells[index] ?? "").trim()])));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstValue(row, aliases) {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== "") return row[alias];
  }
  return null;
}

function parseTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = numberOrNull(value);
  if (numeric !== null) return { seconds: numeric, absolute: false };
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? { seconds: milliseconds / 1000, absolute: true } : null;
}

function average(values) {
  const valid = values.filter((value) => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function rounded(value) {
  return value === null ? null : Number(value.toFixed(3));
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

const input = argument("--input");
const output = argument("--output");
const windowS = numberOrNull(argument("--window-s", "5"));
if (!input || !output || windowS === null || windowS <= 0) {
  usage();
  process.exit(1);
}

const sourceRows = parseCsv(readFileSync(resolve(input), "utf8"));
const rawEvents = sourceRows.map((row) => ({
  arrival: parseTime(firstValue(row, fieldAliases.arrival)),
  completion: parseTime(firstValue(row, fieldAliases.completion)),
  activeRequests: numberOrNull(firstValue(row, fieldAliases.active)),
  promptTokens: numberOrNull(firstValue(row, fieldAliases.prompt)),
  outputTokens: numberOrNull(firstValue(row, fieldAliases.output)),
})).filter((event) => event.arrival !== null);

if (!rawEvents.length) {
  throw new Error("No usable arrival time was found. Provide time_relative_s, arrival_time, arrival_timestamp, or timestamp.");
}

const absoluteOrigin = Math.min(...rawEvents.filter((event) => event.arrival?.absolute).map((event) => event.arrival?.seconds ?? Infinity));
const normalizeTime = (time) => time === null ? null : time.absolute ? time.seconds - absoluteOrigin : time.seconds;
const events = rawEvents.map((event) => ({
  ...event,
  time: normalizeTime(event.arrival),
  completionTime: normalizeTime(event.completion),
}));
const start = Math.floor(Math.min(...events.map((event) => event.time)) / windowS) * windowS;
const end = Math.floor(Math.max(...events.map((event) => event.time)) / windowS) * windowS;
const hasCompletion = events.some((event) => event.completionTime !== null);
const rows = [];

for (let time = start; time <= end + windowS / 1000; time += windowS) {
  const eventsInWindow = events.filter((event) => event.time >= time && event.time < time + windowS);
  const directActive = average(eventsInWindow.map((event) => event.activeRequests));
  const activeRequests = directActive ?? (hasCompletion ? events.filter((event) => event.time <= time && (event.completionTime ?? time) > time).length : null);
  const meanPromptTokens = average(eventsInWindow.map((event) => event.promptTokens));
  const meanOutputTokens = average(eventsInWindow.map((event) => event.outputTokens));
  rows.push({
    time_relative_s: rounded(time),
    window_s: windowS,
    requests_arrived: eventsInWindow.length,
    active_requests: rounded(activeRequests),
    mean_prompt_tokens: rounded(meanPromptTokens),
    mean_output_tokens: rounded(meanOutputTokens),
    mean_request_tokens: rounded(meanPromptTokens === null && meanOutputTokens === null ? null : (meanPromptTokens ?? 0) + (meanOutputTokens ?? 0)),
  });
}

mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(resolve(output), `${OUTPUT_COLUMNS.join(",")}\n${rows.map((row) => OUTPUT_COLUMNS.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`);
console.log(`Normalized ${events.length.toLocaleString()} request events into ${rows.length.toLocaleString()} ${windowS}s timeline rows: ${resolve(output)}`);

import type { ChatGPTUser } from "../chatgpt-auth";
import type { SubmissionStatus, SubmissionSummary } from "./submission-types";
import { getRuntimeEnv } from "./runtime-env";

type SubmissionRow = {
  id: string;
  submitter_email: string;
  submitter_name: string | null;
  trace_filename: string;
  metadata_filename: string | null;
  trace_storage_key: string;
  metadata_storage_key: string | null;
  trace_bytes: number;
  metadata_bytes: number;
  status: SubmissionStatus;
  public_consent: number;
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  run_id: string | null;
  model: string | null;
  model_family: string | null;
  method: string | null;
  gpu_type: string | null;
  gpu_count: string | null;
  row_count: number;
  gpu_ids_json: string;
  headers_json: string;
  created_at: string;
};

export type StoredSubmission = SubmissionRow;

async function configuredAdminEmails(): Promise<Set<string>> {
  const env = await getRuntimeEnv();
  const configured = String(env.ADMIN_EMAILS || process.env.ADMIN_EMAILS || "");
  return new Set(
    configured
      .split(",")
      .map((value: string) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function isAdmin(user: ChatGPTUser | null): Promise<boolean> {
  const admins = await configuredAdminEmails();
  return Boolean(user && admins.has(user.email.toLowerCase()));
}

export async function adminConfigured(): Promise<boolean> {
  return (await configuredAdminEmails()).size > 0;
}

function parseStringList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function toSummary(row: SubmissionRow, options: { includeReview?: boolean; isOwner?: boolean } = {}): SubmissionSummary {
  return {
    id: row.id,
    status: row.status,
    traceFilename: row.trace_filename,
    metadataFilename: row.metadata_filename,
    traceBytes: Number(row.trace_bytes),
    rowCount: Number(row.row_count),
    gpuIds: parseStringList(row.gpu_ids_json),
    headers: parseStringList(row.headers_json),
    runId: row.run_id,
    model: row.model,
    modelFamily: row.model_family,
    method: row.method,
    gpuType: row.gpu_type,
    gpuCount: row.gpu_count,
    publicConsent: Boolean(row.public_consent),
    createdAt: row.created_at,
    ...(options.includeReview ? { reviewNote: row.review_note, reviewedAt: row.reviewed_at } : {}),
    ...(options.isOwner ? { isOwner: true } : {}),
  };
}

export async function listVisibleSubmissions(user: ChatGPTUser | null): Promise<{ rows: SubmissionRow[]; admin: boolean }> {
  const env = await getRuntimeEnv();
  const admin = await isAdmin(user);
  if (admin) {
    const result = await env.DB.prepare("SELECT * FROM trace_submissions ORDER BY created_at DESC").all();
    return { rows: (result.results ?? []) as SubmissionRow[], admin };
  }
  if (user) {
    const result = await env.DB.prepare(
      "SELECT * FROM trace_submissions WHERE status = ? OR submitter_email = ? ORDER BY created_at DESC",
    ).bind("published", user.email).all();
    return { rows: (result.results ?? []) as SubmissionRow[], admin };
  }
  const result = await env.DB.prepare(
    "SELECT * FROM trace_submissions WHERE status = ? ORDER BY created_at DESC",
  ).bind("published").all();
  return { rows: (result.results ?? []) as SubmissionRow[], admin };
}

export async function getSubmission(id: string): Promise<SubmissionRow | null> {
  const env = await getRuntimeEnv();
  return (await env.DB.prepare("SELECT * FROM trace_submissions WHERE id = ?").bind(id).first()) as SubmissionRow | null;
}

export async function canReadRawSubmission(row: SubmissionRow, user: ChatGPTUser | null): Promise<boolean> {
  return row.status === "published" || await isAdmin(user) || Boolean(user && row.submitter_email === user.email);
}

export async function uploadEnvironmentReady(): Promise<boolean> {
  const env = await getRuntimeEnv();
  return Boolean(env.DB && env.UPLOADS);
}

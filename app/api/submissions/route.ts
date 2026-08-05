import { getChatGPTUser } from "../../chatgpt-auth";
import { listVisibleSubmissions, toSummary, uploadEnvironmentReady } from "../../lib/submissions";
import { getRuntimeEnv } from "../../lib/runtime-env";
import { MAX_METADATA_BYTES, MAX_TRACE_BYTES, metadataText, validateMetadataJson, validateTraceCsv } from "../../lib/upload-validation";

export const dynamic = "force-dynamic";

function problem(error: string, status = 400) {
  return Response.json({ error }, { status });
}

function optionalFile(form: FormData, field: string): File | null {
  const value = form.get(field);
  return value && typeof value !== "string" ? value : null;
}

export async function GET() {
  try {
    const user = await getChatGPTUser();
    const { rows, admin } = await listVisibleSubmissions(user);
    return Response.json({
      submissions: rows.map((row) => toSummary(row, {
        includeReview: admin || row.submitter_email === user?.email,
        isOwner: row.submitter_email === user?.email,
      })),
      viewer: { signedIn: Boolean(user), isAdmin: admin },
    });
  } catch {
    return problem("The community submission catalog is temporarily unavailable.", 503);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return problem("Sign in with ChatGPT before submitting a trace.", 401);
  if (!await uploadEnvironmentReady()) return problem("Uploads are not configured for this deployment yet.", 503);

  try {
    const env = await getRuntimeEnv();
    const form = await request.formData();
    const trace = optionalFile(form, "trace");
    const metadataFile = optionalFile(form, "metadata");
    const publicConsent = form.get("publicConsent") === "true";
    if (!trace) return problem("Choose a CSV power-trace file to continue.");
    if (!publicConsent) return problem("Confirm that you are authorized to submit this data and permit publication after review.");
    if (trace.size > MAX_TRACE_BYTES) return problem("The trace is larger than the 25 MB submission limit.");
    if (metadataFile && metadataFile.size > MAX_METADATA_BYTES) return problem("Metadata must be smaller than 256 KB.");

    const traceText = await trace.text();
    const traceCheck = validateTraceCsv(trace.name, traceText);
    if (!traceCheck.ok) return problem(traceCheck.error);

    let metadata: Record<string, unknown> | null = null;
    let metadataTextValue: string | null = null;
    if (metadataFile) {
      metadataTextValue = await metadataFile.text();
      const metadataCheck = validateMetadataJson(metadataFile.name, metadataTextValue);
      if (!metadataCheck.ok) return problem(metadataCheck.error);
      metadata = metadataCheck.metadata;
    }

    const id = `sub_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const traceKey = `submissions/${id}/power-trace.csv`;
    const metadataKey = metadataFile ? `submissions/${id}/metadata.json` : null;

    await env.UPLOADS.put(traceKey, traceText, {
      httpMetadata: { contentType: "text/csv; charset=utf-8" },
      customMetadata: { submissionId: id, submitter: user.email },
    });
    if (metadataKey && metadataTextValue) {
      await env.UPLOADS.put(metadataKey, metadataTextValue, {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: { submissionId: id, submitter: user.email },
      });
    }

    try {
      await env.DB.prepare(
        `INSERT INTO trace_submissions (
          id, submitter_email, submitter_name, trace_filename, metadata_filename,
          trace_storage_key, metadata_storage_key, trace_bytes, metadata_bytes,
          status, public_consent, run_id, model, model_family, method, gpu_type,
          gpu_count, row_count, gpu_ids_json, headers_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        user.email,
        user.fullName,
        trace.name,
        metadataFile?.name ?? null,
        traceKey,
        metadataKey,
        trace.size,
        metadataFile?.size ?? 0,
        "pending",
        1,
        metadataText(metadata, "run_id", "id", "name"),
        metadataText(metadata, "model"),
        metadataText(metadata, "model_family"),
        metadataText(metadata, "method", "training_method"),
        metadataText(metadata, "gpu_type", "accelerator"),
        metadataText(metadata, "gpu_count", "num_gpus"),
        traceCheck.summary.rowCount,
        JSON.stringify(traceCheck.summary.gpuIds),
        JSON.stringify(traceCheck.summary.headers),
        now,
      ).run();
    } catch (error) {
      await env.UPLOADS.delete(traceKey);
      if (metadataKey) await env.UPLOADS.delete(metadataKey);
      throw error;
    }

    return Response.json({
      submission: {
        id,
        status: "pending",
        rowCount: traceCheck.summary.rowCount,
        gpuIds: traceCheck.summary.gpuIds,
        warning: traceCheck.summary.warning,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("submission upload failed", error);
    return problem("The trace could not be saved. Please try again or contact the site owner.", 500);
  }
}

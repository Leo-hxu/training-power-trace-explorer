import { getChatGPTUser } from "../../../../chatgpt-auth";
import { canReadRawSubmission, getSubmission } from "../../../../lib/submissions";
import { getRuntimeEnv } from "../../../../lib/runtime-env";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ submissionId: string }> };

function safeFilename(value: string): string {
  return value.replace(/[\\/\r\n"]/g, "_");
}

export async function GET(request: Request, context: RouteContext) {
  const { submissionId } = await context.params;
  const submission = await getSubmission(submissionId);
  if (!submission) return Response.json({ error: "Submission not found." }, { status: 404 });

  const user = await getChatGPTUser();
  if (!await canReadRawSubmission(submission, user)) {
    return Response.json({ error: "Sign in as the contributor to download this private submission." }, { status: 403 });
  }

  const kind = new URL(request.url).searchParams.get("kind") === "metadata" ? "metadata" : "trace";
  const storageKey = kind === "metadata" ? submission.metadata_storage_key : submission.trace_storage_key;
  const filename = kind === "metadata" ? submission.metadata_filename : submission.trace_filename;
  if (!storageKey || !filename) return Response.json({ error: "That file was not included with this submission." }, { status: 404 });

  const env = await getRuntimeEnv();
  const object = await env.UPLOADS.get(storageKey);
  if (!object) return Response.json({ error: "The uploaded file is unavailable." }, { status: 404 });
  const contentType = kind === "metadata" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8";
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || contentType,
      "content-disposition": `attachment; filename="${safeFilename(filename)}"`,
      "x-content-type-options": "nosniff",
    },
  });
}

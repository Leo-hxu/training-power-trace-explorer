import { getChatGPTUser } from "../../../../chatgpt-auth";
import { adminConfigured, getSubmission, isAdmin } from "../../../../lib/submissions";
import { getRuntimeEnv } from "../../../../lib/runtime-env";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ submissionId: string }> };

function problem(error: string, status = 400) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return problem("Sign in before reviewing submissions.", 401);
  if (!await adminConfigured()) return problem("Review access has not been configured yet.", 503);
  if (!await isAdmin(user)) return problem("You do not have permission to review submissions.", 403);

  const { submissionId } = await context.params;
  const submission = await getSubmission(submissionId);
  if (!submission) return problem("Submission not found.", 404);
  if (submission.status !== "pending") return problem("Only pending submissions can be reviewed.", 409);

  try {
    const env = await getRuntimeEnv();
    const payload = await request.json() as { action?: unknown; reviewNote?: unknown };
    const action = payload.action === "publish" || payload.action === "reject" ? payload.action : null;
    const reviewNote = typeof payload.reviewNote === "string" ? payload.reviewNote.trim().slice(0, 1000) : "";
    if (!action) return problem("Choose whether to publish or reject this submission.");
    if (action === "publish" && !submission.public_consent) {
      return problem("This contributor did not consent to public release.", 409);
    }

    const status = action === "publish" ? "published" : "rejected";
    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE trace_submissions SET status = ?, review_note = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?",
    ).bind(status, reviewNote || null, now, user.email, submissionId).run();

    return Response.json({ submission: { id: submissionId, status, reviewNote: reviewNote || null, reviewedAt: now } });
  } catch {
    return problem("The review could not be saved. Please try again.", 500);
  }
}

"use client";

import { useEffect, useState } from "react";
import type { SubmissionListResponse, SubmissionSummary } from "../lib/submission-types";

type QueueState =
  | { state: "loading" }
  | { state: "ready"; response: SubmissionListResponse }
  | { state: "error"; message: string };

export function ReviewQueue() {
  const [queue, setQueue] = useState<QueueState>({ state: "loading" });
  const [reviewing, setReviewing] = useState<string | null>(null);

  async function load() {
    setQueue({ state: "loading" });
    try {
      const response = await fetch("/api/submissions", { cache: "no-store" });
      const payload = await response.json() as SubmissionListResponse;
      if (!response.ok || !payload.viewer.isAdmin) throw new Error("You do not have review access for this site.");
      setQueue({ state: "ready", response: payload });
    } catch (error) {
      setQueue({ state: "error", message: error instanceof Error ? error.message : "The review queue is unavailable." });
    }
  }

  useEffect(() => { void load(); }, []);

  async function review(submission: SubmissionSummary, action: "publish" | "reject") {
    const defaultNote = action === "publish" ? "Published after format review." : "Not published.";
    const reviewNote = window.prompt("Optional reviewer note", defaultNote);
    if (reviewNote === null) return;
    setReviewing(submission.id);
    try {
      const response = await fetch(`/api/submissions/${encodeURIComponent(submission.id)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reviewNote }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The review could not be saved.");
      await load();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "The review could not be saved.");
    } finally {
      setReviewing(null);
    }
  }

  if (queue.state === "loading") return <div className="review-empty">Loading review queue…</div>;
  if (queue.state === "error") return <div className="review-empty"><strong>Review access unavailable.</strong><span>{queue.message}</span></div>;
  const pending = queue.response.submissions.filter((submission) => submission.status === "pending");
  if (!pending.length) return <div className="review-empty"><strong>No pending submissions.</strong><span>New trace contributions will appear here for review.</span></div>;

  return (
    <div className="review-list">
      {pending.map((submission) => (
        <article className="review-card" key={submission.id}>
          <div className="review-card-title">
            <div><span className="status-chip pending">Pending</span><h2>{submission.runId || submission.traceFilename}</h2></div>
            <time dateTime={submission.createdAt}>{new Date(submission.createdAt).toLocaleString()}</time>
          </div>
          <dl>
            <div><dt>Model</dt><dd>{submission.model || "Not specified"}</dd></div>
            <div><dt>GPU</dt><dd>{submission.gpuType || "Not specified"}{submission.gpuCount ? ` × ${submission.gpuCount}` : ""}</dd></div>
            <div><dt>Samples</dt><dd>{submission.rowCount.toLocaleString()}</dd></div>
            <div><dt>Public consent</dt><dd>{submission.publicConsent ? "Confirmed" : "Missing"}</dd></div>
          </dl>
          <div className="review-actions">
            <a className="button button-secondary" href={`/api/submissions/${encodeURIComponent(submission.id)}/download`}>Inspect CSV</a>
            {submission.metadataFilename ? <a className="button button-secondary" href={`/api/submissions/${encodeURIComponent(submission.id)}/download?kind=metadata`}>Inspect metadata</a> : null}
            <button className="button button-primary" type="button" disabled={reviewing === submission.id} onClick={() => void review(submission, "publish")}>Publish</button>
            <button className="button button-danger" type="button" disabled={reviewing === submission.id} onClick={() => void review(submission, "reject")}>Reject</button>
          </div>
        </article>
      ))}
    </div>
  );
}

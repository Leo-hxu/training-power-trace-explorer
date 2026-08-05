"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SubmissionListResponse, SubmissionSummary } from "../lib/submission-types";
import { AppHeader } from "./AppHeader";

type CatalogState =
  | { state: "loading" }
  | { state: "ready"; response: SubmissionListResponse }
  | { state: "error" };

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function titleFor(submission: SubmissionSummary) {
  return submission.runId || submission.model || submission.traceFilename;
}

export function CommunityCatalog() {
  const [catalog, setCatalog] = useState<CatalogState>({ state: "loading" });

  useEffect(() => {
    fetch("/api/submissions", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return response.json() as Promise<SubmissionListResponse>;
      })
      .then((response) => setCatalog({ state: "ready", response }))
      .catch(() => setCatalog({ state: "error" }));
  }, []);

  const response = catalog.state === "ready" ? catalog.response : null;
  const published = response?.submissions.filter((submission) => submission.status === "published") ?? [];

  return (
    <div className="app-frame community-frame">
      <AppHeader />
      <main className="community-main">
        <section className="community-hero">
          <p className="eyebrow">Open community trace registry</p>
          <h1>Share training power traces responsibly.</h1>
          <p>Contribute a GPU power trace, keep it private while it is reviewed, and help build a more comparable record of LLM training behavior.</p>
          <div className="community-hero-actions">
            <Link className="button button-primary" href="/contribute">Contribute a trace</Link>
            <Link className="button button-secondary" href="/about">View data format</Link>
          </div>
        </section>

        <section className="community-principles" aria-label="Contribution principles">
          <div><span>01</span><strong>Structured</strong><p>CSV validation checks timestamps, power samples, and logger headers before storage.</p></div>
          <div><span>02</span><strong>Private first</strong><p>Only the contributor and reviewer can access a new submission before approval.</p></div>
          <div><span>03</span><strong>Consent-based</strong><p>No trace is published unless its contributor explicitly permits public release.</p></div>
        </section>

        <section className="community-catalog-card">
          <div className="community-catalog-heading">
            <div>
              <p className="eyebrow">Published submissions</p>
              <h2>Community trace catalog</h2>
            </div>
            <span>{published.length} public {published.length === 1 ? "trace" : "traces"}</span>
          </div>
          {catalog.state === "loading" ? <div className="community-empty">Loading published traces…</div> : null}
          {catalog.state === "error" ? <div className="community-empty">The catalog is unavailable right now. You can still return later or contact the site owner.</div> : null}
          {catalog.state === "ready" && published.length === 0 ? (
            <div className="community-empty">
              <strong>No public traces yet.</strong>
              <span>The first approved contribution will appear here with its core metadata and a CSV download.</span>
            </div>
          ) : null}
          {published.length ? (
            <div className="submission-list">
              {published.map((submission) => (
                <article className="submission-card" key={submission.id}>
                  <div className="submission-card-heading">
                    <div><span className="status-chip published">Published</span><h3>{titleFor(submission)}</h3></div>
                    <a className="button button-secondary" href={`/api/submissions/${encodeURIComponent(submission.id)}/download`}>Download CSV</a>
                  </div>
                  <dl>
                    <div><dt>Model</dt><dd>{submission.model || "Not specified"}</dd></div>
                    <div><dt>GPU</dt><dd>{submission.gpuType || "Not specified"}{submission.gpuCount ? ` × ${submission.gpuCount}` : ""}</dd></div>
                    <div><dt>Method</dt><dd>{submission.method || "Not specified"}</dd></div>
                    <div><dt>Samples</dt><dd>{submission.rowCount.toLocaleString()} rows · {formatBytes(submission.traceBytes)}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

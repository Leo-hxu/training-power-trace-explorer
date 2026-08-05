"use client";

import { FormEvent, useRef, useState } from "react";

type SubmitState =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "success"; id: string; rowCount: number; warning: string | null }
  | { state: "error"; message: string };

export function UploadForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({ state: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const trace = form.elements.namedItem("trace") as HTMLInputElement | null;
    if (!trace?.files?.[0]) {
      setSubmitState({ state: "error", message: "Choose a power-trace CSV file first." });
      return;
    }
    setSubmitState({ state: "submitting" });
    try {
      const response = await fetch("/api/submissions", { method: "POST", body: new FormData(form) });
      const payload = await response.json() as { error?: string; submission?: { id: string; rowCount: number; warning?: string | null } };
      if (!response.ok || !payload.submission) throw new Error(payload.error || "The upload could not be completed.");
      formRef.current?.reset();
      setSubmitState({
        state: "success",
        id: payload.submission.id,
        rowCount: payload.submission.rowCount,
        warning: payload.submission.warning ?? null,
      });
    } catch (error) {
      setSubmitState({ state: "error", message: error instanceof Error ? error.message : "The upload could not be completed." });
    }
  }

  return (
    <form ref={formRef} className="submission-form" onSubmit={submit}>
      <label className="file-field">
        <span>Power trace CSV <b>Required</b></span>
        <input name="trace" type="file" accept=".csv,text/csv" required />
        <small>Maximum 25 MB. Include a time column and a power column; GPU ID is strongly recommended.</small>
      </label>

      <label className="file-field">
        <span>Metadata JSON <em>Optional</em></span>
        <input name="metadata" type="file" accept=".json,application/json" />
        <small>Use <code>meta.json</code> or <code>manifest.json</code> for model, GPU, method, and training settings.</small>
      </label>

      <label className="consent-field">
        <input name="publicConsent" type="checkbox" value="true" required />
        <span>I confirm that I am authorized to submit these files and agree that the CSV and metadata may be made public only after administrator review.</span>
      </label>

      <div className="submission-form-actions">
        <button className="button button-primary" type="submit" disabled={submitState.state === "submitting"}>
          {submitState.state === "submitting" ? "Validating and submitting…" : "Submit for review"}
        </button>
        <span>Private until reviewed</span>
      </div>

      {submitState.state === "success" ? (
        <div className="form-notice success" role="status">
          <strong>Submission received.</strong> {submitState.rowCount.toLocaleString()} samples are awaiting review. Reference: <code>{submitState.id}</code>
          {submitState.warning ? <span>{submitState.warning}</span> : null}
        </div>
      ) : null}
      {submitState.state === "error" ? <div className="form-notice error" role="alert">{submitState.message}</div> : null}
    </form>
  );
}

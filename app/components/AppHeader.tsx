"use client";

import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "../lib/api";

type Props = {
  onToggleFilters?: () => void;
  filtersOpen?: boolean;
};

export function AppHeader({ onToggleFilters, filtersOpen }: Props) {
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const localCatalogMode = Boolean(process.env.NEXT_PUBLIC_TRACE_API_URL);

  async function rebuild() {
    setScanState("scanning");
    try {
      await apiFetch("/api/rebuild_catalog", { method: "POST" });
      setScanState("done");
      window.setTimeout(() => window.location.reload(), 500);
    } catch {
      setScanState("error");
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand-cluster">
          {onToggleFilters ? (
            <button
              className="icon-button mobile-filter-button"
              type="button"
              aria-label={filtersOpen ? "Close filters" : "Open filters"}
              onClick={onToggleFilters}
            >
              <span aria-hidden="true">☰</span>
            </button>
          ) : null}
          <Link href="/" className="brand-link" aria-label="Training Power Trace Explorer home">
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
            <span>
              <strong>Training Power Trace Explorer</strong>
              <small>LLM Systems Research</small>
            </span>
          </Link>
        </div>
        <nav className="header-actions" aria-label="Primary navigation">
          {localCatalogMode ? (
            <button className="button button-secondary" type="button" onClick={rebuild} disabled={scanState === "scanning"}>
              <span className={scanState === "scanning" ? "spin" : ""} aria-hidden="true">↻</span>
              {scanState === "scanning" ? "Scanning…" : scanState === "error" ? "Scan failed" : "Import / Scan Data"}
            </button>
          ) : <Link className="button button-primary" href="/contribute">Contribute data</Link>}
          {!localCatalogMode ? <Link className="button button-secondary" href="/review">Review</Link> : null}
          <Link className="button button-ghost" href="/about">
            <span aria-hidden="true">ⓘ</span> {localCatalogMode ? "About Dataset" : "Data format"}
          </Link>
        </nav>
      </div>
    </header>
  );
}

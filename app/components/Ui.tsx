import type { ReactNode } from "react";

export function QualityBadge({ status }: { status: string }) {
  return <span className={`quality-badge quality-${status.toLowerCase()}`}><i />{status}</span>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-icon" aria-hidden="true">⌁</div>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

export function LoadingBlock({ label = "Loading trace catalog…" }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="loading-spinner" />
      <span>{label}</span>
    </div>
  );
}

export function FormatValue({ value, suffix = "", digits = 1 }: { value: unknown; suffix?: string; digits?: number }) {
  if (value === null || value === undefined || value === "" || value === "Unknown") return <>Unknown</>;
  if (typeof value === "number") return <>{value.toLocaleString(undefined, { maximumFractionDigits: digits })}{suffix}</>;
  return <>{String(value)}{suffix}</>;
}


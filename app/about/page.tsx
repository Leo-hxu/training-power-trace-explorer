import Link from "next/link";
import { AppHeader } from "../components/AppHeader";
import { API_BASE } from "../lib/api";

const localCatalogMode = Boolean(process.env.NEXT_PUBLIC_TRACE_API_URL);

export default function AboutPage() {
  return (
    <div className="app-frame">
      <AppHeader />
      <main className="about-main">
        <div className="detail-breadcrumb"><Link href="/">Trace Catalog</Link><span>/</span><span>About</span></div>
        <section className="about-hero">
          <p className="eyebrow">Methodology and provenance</p>
          <h1>About the trace explorer</h1>
          <p>{localCatalogMode ? "Training Power Trace Explorer is a local research instrument for comparing GPU power behavior across LLM training configurations. It catalogs files in place, records every parse failure, and keeps uncertain metadata explicit." : "Training Power Trace Explorer accepts community-contributed GPU power traces. Every cloud submission is validated, private by default, and only published after contributor consent and administrator review."}</p>
          <div className="privacy-callout"><span className="privacy-dot" /><div><strong>{localCatalogMode ? "Local by design" : "Contributor-controlled publication"}</strong><p>{localCatalogMode ? "No trace, log, manifest, or metadata file is uploaded to a cloud service." : "CSV and metadata remain private until a reviewer publishes a contributor-authorized submission."}</p></div></div>
        </section>

        <div className="about-grid">
          <section className="about-card span-two">
            <p className="eyebrow">Input adapters</p><h2>Supported logger schemas</h2>
            <div className="schema-grid">
              <div><span className="schema-label">Schema A</span><h3>trace2flex / legacy</h3><code>timestamp, gpu, power_w, util_gpu, util_mem, mem_used_mb, mem_total_mb, temp_c</code><p>Metadata is read from a sibling <code>meta.json</code> when present. Filename inference is conservative and never replaces confirmed values.</p></div>
              <div><span className="schema-label">Schema B</span><h3>PowerTraces</h3><code>timestamp, index, power.draw [W], clocks.current.sm [MHz], utilization.gpu [%], utilization.memory [%]</code><p>Manifest and log references are retained when found; missing fields remain <strong>Unknown</strong> or <strong>Not found</strong>.</p></div>
            </div>
          </section>

          <section className="about-card">
            <p className="eyebrow">Metric definition</p><h2>Mean power</h2>
            <div className="formula">mean(P<sub>total</sub>(t))</div>
            <p>Arithmetic mean of total observed GPU power at each normalized timestamp. Per-GPU samples are grouped by their actual timestamp.</p>
          </section>
          <section className="about-card">
            <p className="eyebrow">Metric definition</p><h2>Total energy</h2>
            <div className="formula">∑ P<sub>total</sub>(t) × Δt / 3600</div>
            <p>Trapezoidal integration in watt-hours. Every interval comes from adjacent observed timestamps; the nominal logger interval is not assumed.</p>
          </section>
          <section className="about-card">
            <p className="eyebrow">Metric definition</p><h2>High-percentile power</h2>
            <div className="formula">P95, P99 of P<sub>total</sub>(t)</div>
            <p>Quantiles of the total-power series, useful for comparing sustained peaks without treating one isolated maximum as representative.</p>
          </section>
          <section className="about-card">
            <p className="eyebrow">Metric definition</p><h2>Ramp rate</h2>
            <div className="formula">R<sub>δ</sub>(t) = [P(t) − P(t − δ)] / δ</div>
            <p>Computed at 1, 5, and 10 seconds by interpolating against real time. It does not use fixed row lags, so irregular sampling remains visible.</p>
          </section>

          <section className="about-card span-two">
            <p className="eyebrow">Quality policy</p><h2>Transparent failures, not silent omission</h2>
            <div className="quality-policy-grid">
              <ul><li>Missing trace or metadata paths</li><li>Missing stdout or stderr</li><li>Schema mismatch</li><li>Non-monotonic timestamps</li></ul>
              <ul><li>Irregular sampling or large gaps</li><li>Missing GPU samples</li><li>Zero or implausible power</li><li>GPU count mismatch and duplicates</li></ul>
            </div>
            <p>All parse failures are included in <code>trace_explorer_cache/catalog_report.md</code>. Unknown precision, GPU type, model, or training settings are not fabricated.</p>
          </section>
        </div>
        <div className="about-actions"><Link className="button button-primary" href="/">← Return to Trace Catalog</Link>{localCatalogMode ? <a className="button button-secondary" href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">Open local API docs ↗</a> : <Link className="button button-secondary" href="/contribute">Contribute a trace</Link>}</div>
      </main>
    </div>
  );
}

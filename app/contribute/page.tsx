import Link from "next/link";
import { requireChatGPTUser } from "../chatgpt-auth";
import { AppHeader } from "../components/AppHeader";
import { UploadForm } from "../components/UploadForm";

export const dynamic = "force-dynamic";

export default async function ContributePage() {
  const user = await requireChatGPTUser("/contribute");

  return (
    <div className="app-frame contribution-frame">
      <AppHeader />
      <main className="contribution-main">
        <div className="detail-breadcrumb"><Link href="/">Community catalog</Link><span>/</span><span>Contribute a trace</span></div>
        <section className="contribution-hero">
          <div>
            <p className="eyebrow">Signed in as {user.email}</p>
            <h1>Contribute a power trace</h1>
            <p>New submissions stay private while they are checked. You will be able to download your own files, and they will only appear in the public catalog after approval.</p>
          </div>
          <span className="contribution-status">Review required before publication</span>
        </section>

        <div className="contribution-grid">
          <section className="contribution-panel">
            <div className="panel-heading"><p className="eyebrow">1 · Select files</p><h2>Trace submission</h2></div>
            <UploadForm />
          </section>
          <aside className="contribution-guide">
            <section>
              <p className="eyebrow">Required CSV fields</p>
              <code>timestamp,gpu,power_w</code>
              <p>Alternative logger names such as <code>index</code>, <code>watts</code>, and <code>power.draw [W]</code> are also accepted.</p>
            </section>
            <section>
              <p className="eyebrow">Recommended metadata</p>
              <code>{`{ "model": "…", "gpu_type": "…", "gpu_count": 4 }`}</code>
              <p>Include model, GPU type, precision, method, sequence length, and batch settings when available.</p>
            </section>
            <section>
              <p className="eyebrow">Before you submit</p>
              <ul><li>Remove secrets, API keys, and credentials.</li><li>Do not include private paths or sensitive dataset identifiers.</li><li>Make sure you are allowed to share the underlying measurements.</li></ul>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

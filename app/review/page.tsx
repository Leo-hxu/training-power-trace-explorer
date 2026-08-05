import Link from "next/link";
import { requireChatGPTUser } from "../chatgpt-auth";
import { AppHeader } from "../components/AppHeader";
import { ReviewQueue } from "../components/ReviewQueue";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  await requireChatGPTUser("/review");
  return (
    <div className="app-frame contribution-frame">
      <AppHeader />
      <main className="contribution-main review-main">
        <div className="detail-breadcrumb"><Link href="/">Community catalog</Link><span>/</span><span>Review submissions</span></div>
        <section className="contribution-hero">
          <div><p className="eyebrow">Administrator workspace</p><h1>Review incoming traces</h1><p>Check the CSV and metadata, then publish approved submissions or reject those that should remain private.</p></div>
        </section>
        <ReviewQueue />
      </main>
    </div>
  );
}

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the community contribution catalog", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Training Power Trace Explorer/i);
  assert.match(html, /Share training power traces responsibly/i);
  assert.match(html, /Contribute a trace/i);
  assert.match(html, /Community trace catalog/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("server-renders the data format and publication policy", async () => {
  const response = await render("/about");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Supported logger schemas/i);
  assert.match(html, /Ramp rate/i);
  assert.match(html, /Contributor-controlled publication/i);
});

test("finished source includes the local explorer and cloud submission safeguards", async () => {
  const [backend, page, chart, uploadValidation, submissionRoute, reviewRoute, hostingConfig, packageJson] = await Promise.all([
    readFile(new URL("../backend/main.py", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PowerChart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/upload-validation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/submissions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/submissions/[submissionId]/review/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(backend, /\/api\/runs\/\{run_id\}\/samples/);
  assert.match(backend, /\/api\/rebuild_catalog/);
  assert.match(page, /Median Δt/);
  assert.match(page, /CommunityCatalog/);
  assert.match(chart, /Scroll to zoom/);
  assert.match(uploadValidation, /MAX_TRACE_BYTES/);
  assert.match(uploadValidation, /validateMetadataJson/);
  assert.match(submissionRoute, /publicConsent/);
  assert.match(reviewRoute, /Only pending submissions can be reviewed/);
  assert.match(hostingConfig, /"d1": "DB"/);
  assert.match(hostingConfig, /"r2": "UPLOADS"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.deepEqual(await readdir(new URL("../app/_sites-preview", import.meta.url)), []);
});

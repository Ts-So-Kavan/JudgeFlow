import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the JudgeFlow setup experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>JudgeFlow — Debate judging copilot<\/title>/i);
  assert.match(html, /Hear the debate/);
  assert.match(html, /Start a new ballot/);
  assert.match(html, /Public Forum/);
  assert.match(html, /Lincoln-Douglas/);
  assert.match(html, /Judge decides/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("removes disposable starter assets and keeps API credentials server-only", async () => {
  const [page, layout, client, tokenRoute, analysisRoute, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/JudgeWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/realtime-token/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /JudgeWorkspace/);
  assert.match(layout, /transcript-backed workspace/);
  assert.match(client, /\/api\/realtime-token/);
  assert.match(client, /webkitSpeechRecognition/);
  assert.match(client, /processLocally/);
  assert.match(client, /Chrome speech first · OpenAI fallback/);
  assert.match(client, /scrollHeight/);
  assert.match(client, /auto-following/);
  assert.doesNotMatch(client, /process\.env\.OPENAI_API_KEY/);
  assert.match(tokenRoute, /process\.env\.OPENAI_API_KEY/);
  assert.match(tokenRoute, /gpt-live-transcribe/);
  assert.match(client, /ADVISORY JUDGE REVIEW/);
  assert.match(client, /Use this as my selection/);
  assert.match(analysisRoute, /suggestedWinner/);
  assert.match(analysisRoute, /human judge makes the final decision/i);
  assert.match(packageJson, /"name": "judgeflow"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview", templateRoot)));
});

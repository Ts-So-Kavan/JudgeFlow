import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Tabroom companion is narrowly scoped and never submits ballots", async () => {
  const [manifestText, worker, bridge, autofill, client] = await Promise.all([
    readFile(new URL("extension/manifest.json", root), "utf8"),
    readFile(new URL("extension/service-worker.js", root), "utf8"),
    readFile(new URL("extension/judgeflow-bridge.js", root), "utf8"),
    readFile(new URL("extension/tabroom-autofill.js", root), "utf8"),
    readFile(new URL("app/JudgeWorkspace.tsx", root), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://www.tabroom.com/*"]);
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes("http://localhost/*")));
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes("https://www.tabroom.com/*")));
  assert.match(worker, /chrome\.storage\.session/);
  assert.match(bridge, /JUDGEFLOW_TABROOM_QUEUE/);
  assert.match(client, /Send to Tabroom/);
  assert.match(client, /JUDGEFLOW_TABROOM_QUEUE/);
  assert.match(autofill, /Autofill visible fields/);
  assert.match(autofill, /assigned by page order because speaker names could not be matched/);
  assert.match(autofill, /assignments\.length === 0 && candidates\.length === payload\.points\.length/);
  assert.match(client, /current === "checking" \? "missing"/);
  assert.doesNotMatch(autofill, /\.submit\s*\(|requestSubmit\s*\(/);
  assert.doesNotMatch(worker, /\.submit\s*\(|requestSubmit\s*\(/);
});

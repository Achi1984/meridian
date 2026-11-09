import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfile = await readFile(new URL("../Dockerfile.spot-paper-paired", import.meta.url), "utf8");

test("paired image contains only the host runtime graph and stays inert by default", () => {
  const copySources = [...dockerfile.matchAll(/^COPY --chown=node:node ([^ ]+)/gm)]
    .map(match => match[1]);
  assert.deepEqual(copySources, [
    "scripts/spot-paper-paired/",
    "scripts/spot-paper-pilot/core.mjs",
    "scripts/spot-paper-pilot/journal.mjs",
    "scripts/spot-paper-pilot/provider.mjs",
    "scripts/spot-paper-pilot/package-host-evidence.mjs",
    "scripts/spot-paper-paired-report/",
    "scripts/spot-paper-research/comparison.mjs",
    "scripts/spot-paper-research/entry-confirmation.mjs",
    "scripts/spot-paper-research/five-minute-trend.mjs"
  ]);
  assert.match(dockerfile, /^FROM node:20-alpine$/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^ENTRYPOINT \["node", "scripts\/spot-paper-paired\/host\.mjs"\]$/m);
  assert.match(dockerfile, /^CMD \["disabled"\]$/m);
  assert.match(dockerfile, /mkdir -p \/evidence-root \/tmp\/spot-paper-paired-package/);
  assert.match(dockerfile, /chown node:node \/evidence-root \/tmp\/spot-paper-paired-package/);
  assert.doesNotMatch(dockerfile, /^COPY \. /m);
});

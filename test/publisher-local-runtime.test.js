// Offline checks only; the explicit Docker/PG16 integration is a separate gate.
import '../docs/autonomy/event-adapter/review-binding/test/publication-local-tls-fixture.test.mjs';
import '../docs/autonomy/event-adapter/review-binding/test/publication-runtime-postgres-integration.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('isolated workflow retains manual exact-head ten-minute read-only boundary',()=>{
 const source=readFileSync(new URL('../.github/workflows/publisher-postgres-test.yml',import.meta.url),'utf8');
 assert.match(source,/'on':\n  workflow_dispatch:/);
 assert.doesNotMatch(source,/\b(?:pull_request|push|schedule|workflow_run|secrets)\s*:/);
 assert.match(source,/permissions:\n  contents: read\n/);
 assert.match(source,/timeout-minutes: 10\n/);
 assert.match(source,/\[\[ "\$APPROVED_SHA" == "\$GITHUB_SHA" \]\]/);
 assert.match(source,/persist-credentials: false/);
 assert.doesNotMatch(source,/continue-on-error|\|\| true|secrets\./);
 const digest='sha256:75adc2a65806c96bc0e59030230bfe3f1c1b0d6d8f8181a8913e2b8b53bdc166';
 assert.ok(source.includes('docker --host unix:///var/run/docker.sock pull postgres@'+digest));
 assert.ok(source.includes('run: node docs/autonomy/event-adapter/review-binding/scripts/publication-postgres-integration.mjs\n'));
 assert.ok(source.includes('run: node docs/autonomy/event-adapter/review-binding/scripts/publication-runtime-postgres-integration.mjs --local-pg16-tls\n'));
});

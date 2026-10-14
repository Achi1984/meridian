import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = readFileSync(new URL('../docs/autonomy/event-adapter/review-binding/fixtures/meridian-database-readiness.yml', import.meta.url), 'utf8');
const lines = fixture.split('\n');

test('readiness workflow remains an inactive manual proposal', () => {
  assert.match(fixture, /# INACTIVE proposal/);
  assert.match(new URL('../docs/autonomy/event-adapter/review-binding/fixtures/meridian-database-readiness.yml', import.meta.url).pathname, /\/fixtures\/meridian-database-readiness.yml$/);
  assert.match(fixture, /'on':\n  workflow_dispatch:\npermissions:/);
  assert.doesNotMatch(fixture, /pull_request|push:|schedule:|workflow_call|workflow_run/);
});

test('one owner invocation on main is gated before the protected job', () => {
  for (const gate of ["github.repository == 'Achi1984/meridian'", "github.event.repository.owner.type == 'User'", "github.repository_owner == 'Achi1984'", "github.actor == 'Achi1984'", "github.triggering_actor == 'Achi1984'", "github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/main'", 'github.run_number == 1', 'github.run_attempt == 1']) assert.ok(fixture.includes(gate), gate);
  assert.match(fixture, /timeout-minutes: 5\n    environment: meridian-publisher-test/);
  assert.match(fixture, /permissions:\n  contents: read\njobs:/);
  assert.doesNotMatch(fixture, /id-token|contents: write|issues: write|pull-requests: write|continue-on-error|retry|upload-artifact/);
});

test('runtime and dependencies use reviewed pins without install-time secrets', () => {
  assert.match(fixture, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(fixture, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(fixture, /persist-credentials: false/);
  assert.match(fixture, /ref: 817e18d06c453bbd6a01fa44abe1de778dc94cc9/);
  assert.match(fixture, /runs-on: ubuntu-24.04/);
  assert.match(fixture, /node-version: '22.23.3'/);
  assert.match(fixture, /process.version !== 'v22.23.3'/);
  const install = fixture.split('      - name: Verify')[1].split('      - name: Run')[0];
  assert.match(install, /55a78f3b27fd823008b77dde8d77219bd0fbef2d/);
  assert.match(install, /version !== '8.23.0'/);
  assert.match(install, /npm ci --ignore-scripts --no-audit --no-fund >\/dev\/null 2>&1/);
  assert.doesNotMatch(install, /secrets\.|env:|npm install/);
});

test('only the one check step receives the exact six scoped role secrets', () => {
  const secretLines = lines.filter(line => line.includes('${{ secrets.'));
  assert.equal(secretLines.length, 6);
  for (const role of ['RESERVATION', 'SENDER', 'READER']) for (const field of ['USER', 'PASSWORD']) {
    const key = `MERIDIAN_PUBLISHER_TEST_${role}_${field}`;
    assert.ok(secretLines.includes(`          ${key}: \${{ secrets.${key} }}`));
  }
  assert.match(fixture, /MERIDIAN_PUBLISHER_TEST_DATABASE: publisher_ledger/);
  assert.doesNotMatch(fixture, /DATABASE_URL|PGHOST|PGPASSWORD|ACTIONS_ID_TOKEN|PUBLISHER_TOKEN|printenv|set -x/);
  assert.equal((fixture.match(/--check-test-db/g) || []).length, 1);
  assert.match(fixture, /--check-test-db 2>\/dev\/null\n          check_exit=\$\?/);
  assert.match(fixture, /exit "\$check_exit"/);
  assert.doesNotMatch(fixture, /GITHUB_OUTPUT|GITHUB_ENV|artifacts?:/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const fixture = readFileSync(new URL('../docs/autonomy/event-adapter/review-binding/fixtures/meridian-database-readiness.yml', import.meta.url), 'utf8');
const lines = fixture.split('\n');

// Deliberately restricted YAML subset: mappings, step sequences and literal/folded
// blocks only. Unknown syntax, duplicate keys and unexpected indentation fail.
// This validates structural placement, not arbitrary GitHub expression semantics.
function parseWorkflow(source) {
  const rows = source.split('\n');
  let cursor = 0;
  const skip = () => { while (cursor < rows.length && (!rows[cursor].trim() || rows[cursor].trimStart().startsWith('#'))) cursor++; };
  const indent = () => rows[cursor].match(/^ */)[0].length;
  function entry(target, text, depth) {
    const match = /^(?:'([a-zA-Z0-9_-]+)'|([a-zA-Z0-9_-]+)): *(.*)$/.exec(text);
    assert.ok(match, `Unsupported mapping: ${text}`);
    const key = match[1] || match[2], value = match[3];
    assert.ok(!Object.hasOwn(target, key), `Duplicate key: ${key}`);
    if (value === '|' || value === '>-') {
      const block = [];
      while (cursor < rows.length && (!rows[cursor].trim() || indent() > depth)) {
        if (rows[cursor].trim()) assert.ok(rows[cursor].startsWith(' '.repeat(depth + 2)));
        block.push(rows[cursor++].slice(depth + 2));
      }
      target[key] = value === '|' ? block.join('\n').trimEnd() : block.join(' ').trim();
    } else if (!value) {
      skip();
      target[key] = cursor < rows.length && indent() > depth ? node(depth + 2) : null;
    } else {
      assert.doesNotMatch(value, /^[&*!>|{\[]|\t| #/);
      target[key] = /^'[^']*'$/.test(value) ? value.slice(1, -1) : value;
    }
  }
  function mapping(depth, target = Object.create(null)) {
    skip();
    while (cursor < rows.length && indent() >= depth) {
      assert.equal(indent(), depth, 'Unexpected mapping indentation');
      const text = rows[cursor++].slice(depth);
      entry(target, text, depth);
      skip();
    }
    return target;
  }
  function node(depth) {
    assert.equal(indent(), depth);
    if (!rows[cursor].slice(depth).startsWith('- ')) return mapping(depth);
    const result = [];
    while (cursor < rows.length && indent() >= depth) {
      assert.equal(indent(), depth);
      assert.ok(rows[cursor].slice(depth).startsWith('- '));
      const item = Object.create(null);
      entry(item, rows[cursor++].slice(depth + 2), depth + 2);
      mapping(depth + 2, item);
      result.push(item);
      skip();
    }
    return result;
  }
  assert.doesNotMatch(source, /\t|\r/);
  skip();
  const result = node(0);
  assert.equal(cursor, rows.length);
  return result;
}

function validateWorkflow(source) {
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), expected.slice().sort());
  const doc = parseWorkflow(source);
  keys(doc, ['name', 'on', 'permissions', 'jobs']);
  keys(doc.on, ['workflow_dispatch']);
  assert.equal(doc.on.workflow_dispatch, null);
  keys(doc.permissions, ['contents']);
  assert.equal(doc.permissions.contents, 'read');
  keys(doc.jobs, ['database-readiness']);
  const job = doc.jobs['database-readiness'];
  keys(job, ['if', 'runs-on', 'timeout-minutes', 'environment', 'steps']);
  const gates = ["github.repository == 'Achi1984/meridian'", "github.event.repository.owner.type == 'User'", "github.repository_owner == 'Achi1984'", "github.actor == 'Achi1984'", "github.triggering_actor == 'Achi1984'", "github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/main'", 'github.run_number == 1', 'github.run_attempt == 1'];
  assert.equal(job.if, gates.join(' && '));
  assert.equal(job.environment, 'meridian-publisher-test');
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.equal(job['timeout-minutes'], '5');
  assert.equal(job.steps.length, 4);
  const [checkout, setup, install, check] = job.steps;
  keys(checkout, ['uses', 'with']); keys(checkout.with, ['ref', 'persist-credentials']);
  assert.equal(checkout.uses, 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262');
  assert.equal(checkout.with.ref, '817e18d06c453bbd6a01fa44abe1de778dc94cc9');
  assert.equal(checkout.with['persist-credentials'], 'false');
  keys(setup, ['uses', 'with']); keys(setup.with, ['node-version']);
  assert.equal(setup.uses, 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020');
  assert.equal(setup.with['node-version'], '22.23.3');
  keys(install, ['name', 'shell', 'run']);
  keys(check, ['name', 'shell', 'env', 'run']);
  assert.equal(install.shell, 'bash'); assert.equal(check.shell, 'bash');
  // Reviewed literal install block, excluding its trailing YAML newline.
  // Any added shell command must receive an explicit source review and new pin.
  assert.equal(createHash('sha256').update(install.run).digest('hex'),
    '340f15f617365354be9d78f6c6c11f4778f11318e88ee0c57edd825458074978');
  const expected = { MERIDIAN_PUBLISHER_TEST_DATABASE: 'publisher_ledger' };
  for (const role of ['RESERVATION', 'SENDER', 'READER']) for (const field of ['USER', 'PASSWORD']) {
    const key = `MERIDIAN_PUBLISHER_TEST_${role}_${field}`;
    expected[key] = `\${{ secrets.${key} }}`;
  }
  assert.deepEqual({ ...check.env }, expected);
  // Expressions are permitted only in that exact final environment mapping.
  function noExpressions(value) {
    if (typeof value === 'string') assert.doesNotMatch(value, /\$\{\{|secrets\s*[.\[]/);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) noExpressions(child);
  }
  const withoutSecrets = structuredClone(doc);
  delete withoutSecrets.jobs['database-readiness'].steps[3].env;
  noExpressions(withoutSecrets);
  assert.equal(check.run, [
    'set +e',
    'node docs/autonomy/event-adapter/review-binding/scripts/publication-database-readiness-cli.mjs --check-test-db 2>/dev/null',
    'check_exit=$?',
    'printf \'Readiness CLI exit code: %s\\n\' "$check_exit"',
    'exit "$check_exit"',
  ].join('\n'));
  return doc;
}

test('parsed workflow binds all guards and secrets to their permitted structural locations', () => {
  validateWorkflow(fixture);
});

test('moving guards into comments or a step cannot authorize an unguarded job', () => {
  const guard = /    if: >-\n(?:      github[^\n]+\n)+/.exec(fixture)[0];
  for (const replacement of [
    guard.split('\n').filter(Boolean).map(line => `# ${line}`).join('\n') + '\n',
    '    if: true\n' + guard.split('\n').filter(Boolean).map(line => `# ${line}`).join('\n') + '\n',
    '    if: true\n',
  ]) assert.throws(() => validateWorkflow(fixture.replace(guard, replacement)));
  const moved = fixture.replace(guard, '').replace('        shell: bash', guard.trimEnd().split('\n').map(line => `    ${line}`).join('\n') + '\n        shell: bash');
  assert.throws(() => validateWorkflow(moved));
});

test('moving role secrets to installation or top-level environment is rejected', () => {
  const environment = /        env:\n(?:          MERIDIAN[^\n]+\n)+/.exec(fixture)[0];
  const removed = fixture.replace(environment, '');
  assert.throws(() => validateWorkflow(removed.replace('        shell: bash', environment + '        shell: bash')));
  assert.throws(() => validateWorkflow(environment.split('\n').filter(Boolean).map(line => line.slice(8)).join('\n') + '\n' + removed));
  assert.throws(() => validateWorkflow(fixture.replace('        shell: bash', '        env:\n          EXTRA: ${{ secrets.MERIDIAN_PUBLISHER_TEST_READER_PASSWORD }}\n        shell: bash')));
});

test('extra triggers, duplicate guards, jobs, steps and unknown YAML features fail closed', () => {
  const mutations = [
    fixture.replace('  workflow_dispatch:', '  push:\n  workflow_dispatch:'),
    fixture.replace('    if: >-', '    if: true\n    if: >-'),
    fixture + '\n  unguarded:\n    runs-on: ubuntu-24.04\n',
    fixture + '\n      - run: echo unexpected\n',
    fixture.replace('    environment: meridian-publisher-test', '    environment: meridian-publisher-test\n    continue-on-error: true'),
    fixture.replace('permissions:\n', 'permissions: &privileges\n'),
    fixture.replace('      github.run_attempt == 1', '      github.run_attempt == 1 || true'),
    fixture.replace('          fi\n', '          fi\n          printf hacked > docs/autonomy/event-adapter/review-binding/scripts/publication-database-readiness-cli.mjs\n'),
    fixture.replace('          fi\n', '          fi\n          exec >/dev/null 2>&1\n'),
  ];
  for (const mutated of mutations) assert.throws(() => validateWorkflow(mutated));
});

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

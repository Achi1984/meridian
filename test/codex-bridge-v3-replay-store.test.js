import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  createReplayStore,
  openReplayStore,
  ReplayStoreError,
} from '../scripts/codex-bridge-v3-replay-store.mjs';

const scope = () => ({
  repository: 'Achi1984/meridian',
  headSha: '8a8a43fc8df4e440294bf7ef5747510b6c6a44d0',
  baseSha: '256cb443b9b65debfe0fa4ba1540bf760a5ef698',
});
const identity = () => ({
  repository: scope().repository,
  requestId: 'REQ-REPLAY-001',
  opId: 'OP-REPLAY-001',
  headSha: scope().headSha,
  baseSha: scope().baseSha,
});
const token = state => ({ revision: state.revision, head: state.head });
const fail = (fn, code) => assert.throws(fn, error => error instanceof ReplayStoreError && error.code === code);
const moduleURL = new URL('../scripts/codex-bridge-v3-replay-store.mjs', import.meta.url).href;

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'meridian-v3-replay-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'store');
  const replay = createReplayStore(root, scope());
  return { parent, root, replay };
}

function child(t, script, args, ipc = false) {
  const processChild = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], {
    stdio: ['ignore', 'ignore', 'pipe', ...(ipc ? ['ipc'] : [])],
  });
  let stderr = '';
  processChild.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });
  t.after(() => {
    if (processChild.exitCode === null) processChild.kill();
  });
  const exited = new Promise((resolve, reject) => {
    processChild.once('error', reject);
    processChild.once('exit', code => resolve({ code, stderr }));
  });
  return { processChild, exited };
}

test('explicit create-if-absent and strict store-scope matching', t => {
  const { root, parent } = fixture(t);
  fail(() => createReplayStore(root, scope()), 'STORE_ALREADY_EXISTS');
  fail(() => openReplayStore(join(parent, 'missing'), scope()), 'STORE_MISSING');
  fail(() => openReplayStore(root, { ...scope(), baseSha: '398674e6b24c65f319462995890377d1760f8c46' }), 'STORE_SCOPE_MISMATCH');
});

test('durable reservation survives restart and remains offline-only', t => {
  const { root, replay } = fixture(t);
  const first = replay.reserve(identity(), token(replay.snapshot()));
  const reopened = openReplayStore(root, scope()).snapshot();
  assert.equal(reopened.revision, 1);
  assert.equal(reopened.records[0].status, 'RESERVED_OFFLINE');
  assert.equal(reopened.records[0].identity.requestId, identity().requestId);
  for (const key of ['authenticated', 'authorized', 'mayMerge', 'mayDispatch', 'mayActivate']) {
    assert.equal(reopened[key], false);
    assert.equal(first[key], false);
  }
});

test('duplicate identical request is deterministic and inert', t => {
  const { replay } = fixture(t);
  const first = replay.reserve(identity(), token(replay.snapshot()));
  const next = replay.reserve(identity(), token(first));
  assert.equal(next.revision, first.revision);
  assert.equal(next.head, first.head);
});

test('conflicting requestId and opId reuse fail closed', t => {
  const { replay } = fixture(t);
  const first = replay.reserve(identity(), token(replay.snapshot()));
  fail(() => replay.reserve({ ...identity(), opId: 'OP-REPLAY-002' }, token(first)), 'DUPLICATE_SCOPE_CONFLICT');
  fail(() => replay.reserve({ ...identity(), requestId: 'REQ-REPLAY-002' }, token(first)), 'OP_ID_REUSED');
});

test('unknown outcome stays blocked pending reconciliation', t => {
  const { replay } = fixture(t);
  const first = replay.reserve(identity(), token(replay.snapshot()));
  const second = replay.markUnknown(identity(), token(first));
  assert.equal(second.records[0].status, 'UNKNOWN_OUTCOME');
  fail(() => replay.reserve(identity(), token(second)), 'UNKNOWN_OUTCOME_BLOCKED');
});

test('failed validation does not consume identity', t => {
  const { replay } = fixture(t);
  fail(() => replay.reserve({ ...identity(), requestId: '' }, token(replay.snapshot())), 'IDENTITY_INVALID');
  const ok = replay.reserve(identity(), token(replay.snapshot()));
  assert.equal(ok.revision, 1);
});

test('CAS conflict fails closed and does not consume new revision', t => {
  const { replay } = fixture(t);
  const stale = token(replay.snapshot());
  replay.reserve(identity(), stale);
  fail(() => replay.reserve({ ...identity(), requestId: 'REQ-REPLAY-002', opId: 'OP-REPLAY-002' }, stale), 'CAS_CONFLICT_RECONCILE_REQUIRED');
});

test('simultaneous competing reservations across child processes are atomic', { timeout: 10000 }, async t => {
  const { root, replay } = fixture(t);
  const expected = token(replay.snapshot());
  const script = 'import {openReplayStore} from ' + JSON.stringify(moduleURL) + ';'
    + "process.send('ready');process.on('message',()=>{try{const s=openReplayStore(process.argv[1],JSON.parse(process.argv[2])).reserve(JSON.parse(process.argv[3]),JSON.parse(process.argv[4]));"
    + "process.send({ok:true,revision:s.revision});}catch(e){process.send({ok:false,code:e.code});}process.disconnect();});";
  const children = Array.from({ length: 2 }, (_, i) => child(t, script, [
    root,
    JSON.stringify(scope()),
    JSON.stringify({ ...identity(), requestId: `REQ-REPLAY-00${i + 1}`, opId: `OP-REPLAY-00${i + 1}` }),
    JSON.stringify(expected),
  ], true));

  await Promise.all(children.map(({ processChild, exited }) => Promise.race([
    new Promise((resolve, reject) => processChild.once('message', message => (message === 'ready' ? resolve() : reject(new Error('bad child message'))))),
    exited.then(({ stderr }) => {
      throw new Error('child exited before ready ' + stderr);
    }),
  ])));

  const responses = children.map(({ processChild, exited }) => Promise.race([
    new Promise(resolve => processChild.once('message', resolve)),
    exited.then(({ stderr }) => {
      throw new Error('child exited without response ' + stderr);
    }),
  ]));

  children.forEach(({ processChild }) => processChild.send('go'));
  const outcomes = await Promise.all(responses);
  assert.equal(outcomes.filter(x => x.ok).length, 1);
  assert.ok(['STORE_LOCKED_RECONCILE_REQUIRED', 'CAS_CONFLICT_RECONCILE_REQUIRED', 'STORE_UNCERTAIN_RECONCILE_REQUIRED'].includes(outcomes.find(x => !x.ok).code));
  const final = openReplayStore(root, scope()).snapshot();
  assert.equal(final.revision, 1);
});

test('actual process death after successful reserve persists replay and blocks duplicate intent', { timeout: 10000 }, async t => {
  const { root, replay } = fixture(t);
  const expected = token(replay.snapshot());
  const script = 'import {openReplayStore} from ' + JSON.stringify(moduleURL) + ';'
    + 'openReplayStore(process.argv[1],JSON.parse(process.argv[2])).reserve(JSON.parse(process.argv[3]),JSON.parse(process.argv[4]));process.exit(42);';
  const result = await child(t, script, [root, JSON.stringify(scope()), JSON.stringify(identity()), JSON.stringify(expected)]).exited;
  assert.equal(result.code, 42, result.stderr);
  const restarted = openReplayStore(root, scope());
  const state = restarted.snapshot();
  assert.equal(state.records[0].status, 'RESERVED_OFFLINE');
  const duplicate = restarted.reserve(identity(), token(state));
  assert.equal(duplicate.revision, 1);
});

test('deterministic failpoint after pending write leaves lock and pending evidence', t => {
  const { root, replay } = fixture(t);
  const expected = token(replay.snapshot());
  fail(() => replay.reserve(identity(), expected, { failpoint: 'AFTER_PENDING_WRITE' }), 'FAILPOINT_TRIGGERED');
  assert.equal(existsSync(join(root, 'writer.lock')), true);
  assert.equal(existsSync(join(root, 'replay-store.pending')), true);
  fail(() => openReplayStore(root, scope()), 'STORE_LOCKED_RECONCILE_REQUIRED');
});

test('deterministic failpoint after rename keeps uncertainty blocked without silent rollback', t => {
  const { root, replay } = fixture(t);
  const expected = token(replay.snapshot());
  fail(() => replay.reserve(identity(), expected, { failpoint: 'AFTER_RENAME' }), 'FAILPOINT_TRIGGERED');
  assert.equal(existsSync(join(root, 'writer.lock')), true);
  assert.equal(existsSync(join(root, 'replay-store.pending')), false);
  const disk = JSON.parse(readFileSync(join(root, 'replay-store.json'), 'utf8'));
  assert.equal(disk.revision, 1);
  fail(() => openReplayStore(root, scope()), 'STORE_LOCKED_RECONCILE_REQUIRED');
});

test('corrupt or truncated state fails closed', t => {
  const { root } = fixture(t);
  writeFileSync(join(root, 'replay-store.json'), '{"schema":1');
  fail(() => openReplayStore(root, scope()), 'STORE_CORRUPT');
});

test('existing pending file without lock is treated as uncertain and blocked', t => {
  const { root } = fixture(t);
  writeFileSync(join(root, 'replay-store.pending'), '{"uncertain":true}\n', { mode: 0o600 });
  fail(() => openReplayStore(root, scope()), 'STORE_UNCERTAIN_RECONCILE_REQUIRED');
});

test('stale lock never expires and no takeover is attempted', t => {
  const { root } = fixture(t);
  writeFileSync(join(root, 'writer.lock'), 'stale\n', { mode: 0o600 });
  fail(() => openReplayStore(root, scope()), 'STORE_LOCKED_RECONCILE_REQUIRED');
});

test('symlink hazards are rejected', t => {
  const { root, parent } = fixture(t);
  const alias = join(parent, 'alias');
  symlinkSync(root, alias);
  fail(() => openReplayStore(alias, scope()), 'STORE_ROOT_UNSAFE');

  const storePath = join(root, 'replay-store.json');
  const original = readFileSync(storePath);
  unlinkSync(storePath);
  writeFileSync(join(parent, 'target.json'), original, { mode: 0o600 });
  symlinkSync(join(parent, 'target.json'), storePath);
  assert.throws(() => openReplayStore(root, scope()), error => error.code === 'ELOOP');
});

test('retained handle rejects substituted root symlink before mutation effects', t => {
  const { root, parent, replay } = fixture(t);
  const other = join(parent, 'other');
  createReplayStore(other, scope());
  const expected = token(replay.snapshot());
  const original = join(parent, 'original');
  renameSync(root, original);
  symlinkSync(other, root);

  fail(() => replay.reserve(identity(), expected), 'STORE_ROOT_UNSAFE');
  assert.equal(openReplayStore(other, scope()).snapshot().revision, 0);
  assert.equal(openReplayStore(original, scope()).snapshot().revision, 0);
  assert.equal(existsSync(join(other, 'writer.lock')), false);
  assert.equal(existsSync(join(other, 'replay-store.pending')), false);
  assert.equal(existsSync(join(original, 'writer.lock')), false);
  assert.equal(existsSync(join(original, 'replay-store.pending')), false);
});

test('unsafe permissions fail closed', t => {
  const { root } = fixture(t);
  chmodSync(root, 0o755);
  fail(() => openReplayStore(root, scope()), 'STORE_ROOT_UNSAFE');
});

test('retained handle rejects unsafe root permissions before mutation effects', t => {
  const { root, replay } = fixture(t);
  const reserved = replay.reserve(identity(), token(replay.snapshot()));
  chmodSync(root, 0o755);
  fail(() => replay.markUnknown(identity(), token(reserved)), 'STORE_ROOT_UNSAFE');
  assert.equal(existsSync(join(root, 'writer.lock')), false);
  assert.equal(existsSync(join(root, 'replay-store.pending')), false);
  chmodSync(root, 0o700);
  const state = openReplayStore(root, scope()).snapshot();
  assert.equal(state.revision, 1);
  assert.equal(state.records[0].status, 'RESERVED_OFFLINE');
});

test('store API rejects proxy/getter identities before reservation', t => {
  const { replay } = fixture(t);
  let calls = 0;
  const proxied = new Proxy(identity(), {
    ownKeys() {
      calls++;
      throw new Error('trap');
    },
  });
  fail(() => replay.reserve(proxied, token(replay.snapshot())), 'IDENTITY_INVALID');
  assert.equal(calls, 0);

  const withGetter = identity();
  Object.defineProperty(withGetter, 'opId', { enumerable: true, get() { throw new Error('getter'); } });
  fail(() => replay.reserve(withGetter, token(replay.snapshot())), 'ACCESSOR_OR_HIDDEN_FIELD');
  const ok = replay.reserve(identity(), token(replay.snapshot()));
  assert.equal(ok.revision, 1);
});

test('manual lock recovery can reveal durable reservation without deleting evidence', t => {
  const { root, replay } = fixture(t);
  const expected = token(replay.snapshot());
  fail(() => replay.reserve(identity(), expected, { failpoint: 'AFTER_RENAME' }), 'FAILPOINT_TRIGGERED');
  fail(() => openReplayStore(root, scope()), 'STORE_LOCKED_RECONCILE_REQUIRED');
  unlinkSync(join(root, 'writer.lock'));
  const reopened = openReplayStore(root, scope()).snapshot();
  assert.equal(reopened.revision, 1);
  assert.equal(reopened.records[0].status, 'RESERVED_OFFLINE');
});

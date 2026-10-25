import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  buildD2Candidate
} from '../scripts/research/b1-7/prepare-d2-candidate.mjs';
import {
  HISTORICAL_RUN_PROFILE, deriveHistoricalProfile, historicalProfileSha256,
  verifyHistoricalSourcePins
} from '../scripts/research/b1-7/historical-profile.mjs';
import {inspectHistoricalAdmission} from '../scripts/research/b1-7/historical-admission.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/research/b1-7/prepare-d2-candidate.mjs');
const OUTPUT = join(ROOT, 'docs/research/d2-candidate/admission-candidate.json');
const METADATA_FILES = {
  d1Verification: 'docs/research/d1-20261019/verification.json',
  d1Readme: 'docs/research/d1-20261019/README.md',
  d1VerifierArchive: 'docs/research/d1-20261019/executed-verifier.mjs.txt',
  inactiveProfileJson: 'scripts/research-supervisor/historical_run_profile.json',
  pathBridgeManifest: 'scripts/research-supervisor/b1_bridge_manifest.json',
  protocolJson: 'research/protocols/b1-7-20261018/protocol.json',
  candidateBuilder: 'scripts/research/b1-7/prepare-d2-candidate.mjs'
};
const SOURCE_FILES = {
  engine: 'scripts/research/b1-7/engine.mjs',
  validator: 'scripts/research/b1-7/validate.mjs',
  loader: 'scripts/research/b1-7/captured-input.mjs',
  protocol: 'research/protocols/b1-7-20261018/protocol.json',
  bridge: 'scripts/research-supervisor/b1_bridge_manifest.json',
  admission: 'scripts/research/b1-7/historical-admission.mjs',
  profile: 'scripts/research/b1-7/historical-profile.mjs',
  adapter: 'scripts/research-supervisor/historical_adapter.mjs',
  adapterRuntime: 'scripts/research-supervisor/b1_adapter.mjs',
  supervisor: 'scripts/research-supervisor/supervisor.py',
  journal: 'scripts/research-supervisor/journal.py'
};
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

async function fixture() {
  const metadataBytes = Object.fromEntries(await Promise.all(
    Object.entries(METADATA_FILES).map(async ([name, relative]) => [
      name, await readFile(join(ROOT, relative))
    ])
  ));
  return {
    verification: JSON.parse(metadataBytes.d1Verification.toString('utf8')),
    protocol: JSON.parse(metadataBytes.protocolJson.toString('utf8')),
    profile: HISTORICAL_RUN_PROFILE,
    sourceByteHashes: {...HISTORICAL_RUN_PROFILE.sourceSha256},
    metadataFileHashes: Object.fromEntries(Object.entries(metadataBytes)
      .map(([name, bytes]) => [name, hash(bytes)]))
  };
}

function build(input) {
  return buildD2Candidate(input);
}

function assertArtifactMatches(actualBytes, expectedBytes) {
  assert.deepEqual(actualBytes, expectedBytes);
}

function auditPreload(logPath, allowedReads, allowedWrite, tamperVerification = false) {
  return `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    import net from 'node:net';
    import tls from 'node:tls';
    import http from 'node:http';
    import https from 'node:https';
    import dns from 'node:dns';
    import {createRequire} from 'node:module';
    const require = createRequire(import.meta.url);
    const Module = require('node:module');
    const events = [];
    const allowedReads = new Set(${JSON.stringify(allowedReads)});
    const allowedWrite = ${JSON.stringify(allowedWrite)};
    const originalRead = fs.readFileSync.bind(fs);
    const originalWrite = fs.writeFileSync.bind(fs);
    const toPath = value => value instanceof URL ? new URL(value).pathname : String(value);
    fs.readFileSync = (file, ...args) => {
      const target = toPath(file);
      events.push(['read', target]);
      if (!allowedReads.has(target) || /\\\\.(?:csv|sqlite|db)$/i.test(target)) {
        throw new Error('DISALLOWED_READ:' + target);
      }
      if (${JSON.stringify(tamperVerification)} &&
          target === ${JSON.stringify(join(ROOT, METADATA_FILES.d1Verification))}) {
        const changed = JSON.parse(originalRead(file, ...args).toString('utf8'));
        changed.manifestDraft.selectedSeriesSha256.XBTUSD = 'f'.repeat(64);
        changed.files[0].selectedSeriesSha256 = 'f'.repeat(64);
        return Buffer.from(JSON.stringify(changed));
      }
      return originalRead(file, ...args);
    };
    fs.writeFileSync = (file, ...args) => {
      const target = toPath(file);
      events.push(['write', target]);
      if (target !== allowedWrite) throw new Error('DISALLOWED_WRITE:' + target);
      return originalWrite(file, ...args);
    };
    syncBuiltinESMExports();
    const deny = name => () => { throw new Error('DISALLOWED_NETWORK_OR_DB:' + name); };
    net.Socket.prototype.connect = deny('net.connect');
    tls.connect = deny('tls.connect');
    http.request = deny('http.request');
    https.request = deny('https.request');
    dns.lookup = deny('dns.lookup');
    const originalLoad = Module._load;
    Module._load = function(request, ...args) {
      if (/^(?:pg|sqlite3|better-sqlite3|node:sqlite)$/.test(request)) {
        throw new Error('DISALLOWED_DATABASE:' + request);
      }
      return originalLoad.call(this, request, ...args);
    };
    process.on('exit', () => originalWrite(
      ${JSON.stringify(logPath)}, JSON.stringify(events), {encoding: 'utf8'}
    ));
  `;
}

async function makeIsolatedCliTree(root) {
  for (const relative of [...Object.values(METADATA_FILES), ...Object.values(SOURCE_FILES)]) {
    const target = join(root, relative);
    await mkdir(join(target, '..'), {recursive: true});
    await copyFile(join(ROOT, relative), target);
  }
  await mkdir(join(root, 'docs/research/d2-candidate'), {recursive: true});
  return {
    script: join(root, 'scripts/research/b1-7/prepare-d2-candidate.mjs'),
    output: join(root, 'docs/research/d2-candidate/admission-candidate.json'),
    allowedReads: [
      ...Object.values(METADATA_FILES),
      ...Object.values(SOURCE_FILES)
    ].map(relative => resolve(root, relative))
  };
}

test('candidate validates D1 assets, status, hashes, and exact source/file pins', async () => {
  const input = await fixture();
  assert.equal(build(input).input.inputManifestSha256,
    '37fecaa0d003c9ec862fb57b3b312c0289c1dd370607ade99bac584d357f81a9');

  const missing = clone(input);
  missing.verification.files.pop();
  assert.throws(() => build(missing), /D1_MANIFEST_SHAPE_INVALID/);
  const missingAsset = clone(input);
  delete missingAsset.verification.manifestDraft.selectedSeriesSha256.SUIUSD;
  assert.throws(() => build(missingAsset), /D1_MANIFEST_SHAPE_INVALID/);
  const extraAsset = clone(input);
  extraAsset.verification.manifestDraft.files.OTHERUSD = 'a'.repeat(64);
  assert.throws(() => build(extraAsset), /D1_MANIFEST_SHAPE_INVALID/);
  const malformedHash = clone(input);
  malformedHash.verification.files[0].selectedSeriesSha256 = 'not-a-sha256';
  assert.throws(() => build(malformedHash), /D1_SOURCE_FILE_PIN_MISMATCH/);
  const sourceFileMismatch = clone(input);
  sourceFileMismatch.verification.files[0].actualSha256 = '0'.repeat(64);
  assert.throws(() => build(sourceFileMismatch), /D1_SOURCE_FILE_PIN_MISMATCH/);
  const invalidStatus = clone(input);
  invalidStatus.verification.status = 'ADMITTED';
  assert.throws(() => build(invalidStatus), /D1_VERIFICATION_STATUS_INVALID/);
  const invalidSourcePins = clone(input);
  invalidSourcePins.sourceByteHashes.engine = '0'.repeat(64);
  assert.throws(() => build(invalidSourcePins), /HISTORICAL_SOURCE_HASH_MISMATCH/);

  const damagedProfile = {
    ...input.profile,
    sourceSha256: {...input.profile.sourceSha256, engine: '0'.repeat(64)}
  };
  assert.equal(verifyHistoricalSourcePins(damagedProfile).ok, false);
});

test('selected-series metadata binds all 44 ordered identities and profile digests', async () => {
  const input = await fixture();
  const before = build(input);
  const changed = clone(input);
  changed.verification.files[0].selectedSeriesSha256 = 'f'.repeat(64);
  changed.verification.manifestDraft.selectedSeriesSha256.XBTUSD = 'f'.repeat(64);
  changed.metadataFileHashes.d1Verification = hash(JSON.stringify(changed.verification));
  const after = build(changed);

  assert.notEqual(after.input.inputSha256, before.input.inputSha256);
  assert.notEqual(after.paths.descriptorsAndIds[0].pathId,
    before.paths.descriptorsAndIds[0].pathId);
  assert.notEqual(after.paths.manifestSha256, before.paths.manifestSha256);
  assert.equal(before.paths.descriptorsAndIds.length, 44);
  assert.equal(before.paths.orderedComputationPaths.length, 44);
  assert.deepEqual(before.paths.orderedComputationPaths.map(path => path.ordinal),
    Array.from({length: 44}, (_, index) => index + 1));
  assert.equal(new Set(before.paths.descriptorsAndIds.map(path => path.pathId)).size, 44);
  assert.equal(before.profileDigests.inactiveNotFrozenProfileSha256,
    '87658ad27346ddfec01aac081a30facdf7d3f4920b8cddb7b12bef5341a1cddd');
  assert.equal(before.profileDigests.proposedFrozenCandidateSha256,
    historicalProfileSha256({
      ...deriveHistoricalProfile(clone(input.verification.manifestDraft)),
      status: 'FROZEN_FOR_D2',
      approvalReceipt: null
    }));
  assert.notEqual(before.profileDigests.proposedFrozenCandidateSha256,
    before.profileDigests.populatedUnfrozenCandidateSha256);
  assert.equal(before.approvalReceipt, null);
  assert.equal(before.decision, 'DEFER');
  assert.equal(before.executionAuthorized, false);
  assert.ok(Object.values(before.authority).every(flag => flag === false));
  assert.equal(before.runtimeUse, 'OUTSIDE_RUNTIME_ADMISSION_AND_DISCOVERY_PATHS');
  assert.deepEqual(inspectHistoricalAdmission({
    receipt: null,
    manifest: before.input.manifestDraft,
    profile: {
      ...deriveHistoricalProfile(clone(before.input.manifestDraft)),
      status: 'FROZEN_FOR_D2'
    }
  }), {
    ok: false, status: 'BLOCKED', error: {code: 'D2_APPROVAL_REQUIRED'}
  });
});

test('generation is deterministic and leaves caller metadata mutable and unchanged', async () => {
  const input = await fixture();
  const before = clone(input.verification);
  const first = build(input);
  const second = build(input);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(input.verification, before);
  assert.equal(Object.isFrozen(input.verification.manifestDraft), false);
  assert.equal(Object.isFrozen(input.verification.manifestDraft.files), false);
  assert.equal(HISTORICAL_RUN_PROFILE.status, 'NOT_FROZEN');
  assert.equal(HISTORICAL_RUN_PROFILE.inputManifest, null);
  assert.equal(HISTORICAL_RUN_PROFILE.approvalReceipt, null);
});

test('module import performs no generation or writes', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'd2-candidate-import-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  const audit = join(temp, 'audit.json');
  const preload = join(temp, 'preload.mjs');
  const allowedReads = [
    ...Object.values(METADATA_FILES),
    ...Object.values(SOURCE_FILES),
    'scripts/research/b1-7/prepare-d2-candidate.mjs'
  ].map(relative => resolve(ROOT, relative));
  const beforeBytes = await readFile(OUTPUT);
  const beforeStat = await stat(OUTPUT, {bigint: true});
  await writeFile(preload, auditPreload(audit, allowedReads, OUTPUT));
  const result = spawnSync(process.execPath, [
    '--import', preload, '--input-type=module', '-e',
    `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)})`
  ], {cwd: ROOT, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const events = JSON.parse(await readFile(audit, 'utf8'));
  assert.equal(events.some(([kind]) => kind === 'write'), false);
  assert.deepEqual(await readFile(OUTPUT), beforeBytes);
  assert.equal((await stat(OUTPUT, {bigint: true})).mtimeNs, beforeStat.mtimeNs);
});

test('explicit CLI reads only allowlisted metadata/source bytes and writes only its fixed artifact', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'd2-candidate-cli-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  const isolated = await makeIsolatedCliTree(join(temp, 'repository'));
  const audit = join(temp, 'audit.json');
  const preload = join(temp, 'preload.mjs');
  const expected = `${JSON.stringify(build(await fixture()), null, 2)}\n`;
  const committedBytes = await readFile(OUTPUT);
  const expectedBytes = Buffer.from(expected);
  assertArtifactMatches(committedBytes, expectedBytes);
  assert.equal(committedBytes.toString('utf8'), expected,
    'tracked artifact must match deterministic expected bytes before CLI execution');
  const staleBytes = Buffer.from(committedBytes);
  staleBytes[0] ^= 1;
  assert.notDeepEqual(staleBytes, committedBytes, 'stale artifact bytes must fail the expectation');
  assert.throws(() => assertArtifactMatches(staleBytes, expectedBytes));

  await writeFile(preload, auditPreload(audit, isolated.allowedReads, isolated.output));
  const result = spawnSync(process.execPath, ['--import', preload, isolated.script], {
    cwd: join(temp, 'repository'), encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const events = JSON.parse(await readFile(audit, 'utf8'));
  const reads = events.filter(([kind]) => kind === 'read').map(([, target]) => target);
  const writes = events.filter(([kind]) => kind === 'write').map(([, target]) => target);
  assert.ok(reads.length > 0);
  assert.ok(reads.every(target => isolated.allowedReads.includes(target)), reads.join('\n'));
  assert.deepEqual(writes, [isolated.output]);
  assert.equal(result.stdout.trim(), `WROTE docs/research/d2-candidate/admission-candidate.json sha256=${hash(expected)}`);
  const firstBytes = await readFile(isolated.output);
  assert.equal(firstBytes.toString('utf8'), expected);

  const secondAudit = join(temp, 'second-audit.json');
  const secondPreload = join(temp, 'second-preload.mjs');
  await writeFile(secondPreload, auditPreload(secondAudit, isolated.allowedReads, isolated.output));
  const secondResult = spawnSync(process.execPath, ['--import', secondPreload, isolated.script], {
    cwd: join(temp, 'repository'), encoding: 'utf8'
  });
  assert.equal(secondResult.status, 0, secondResult.stderr);
  const secondEvents = JSON.parse(await readFile(secondAudit, 'utf8'));
  assert.deepEqual(secondEvents.filter(([kind]) => kind === 'write').map(([, target]) => target), [isolated.output]);
  assert.deepEqual(await readFile(isolated.output), firstBytes);

  for (const relative of [
    'scripts/research/b1-7/prepare-d2-candidate.mjs',
    'scripts/research/b1-7/historical-profile.mjs',
    'scripts/research/b1-7/engine.mjs',
    'scripts/research/b1-7/validate.mjs'
  ]) {
    const source = await readFile(join(ROOT, relative), 'utf8');
    assert.doesNotMatch(source, /node:(?:http|https|net|tls|dns|sqlite)|\b(?:pg|sqlite3|better-sqlite3)\b/);
  }
});

test('repository CLI rejects coherently retampered D1 metadata before any artifact write', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'd2-candidate-tamper-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  const audit = join(temp, 'audit.json');
  const preload = join(temp, 'preload.mjs');
  const allowedReads = [
    ...Object.values(METADATA_FILES),
    ...Object.values(SOURCE_FILES)
  ].map(relative => resolve(ROOT, relative));
  const originalArtifact = await readFile(OUTPUT);
  await writeFile(preload, auditPreload(audit, allowedReads, OUTPUT, true));
  const result = spawnSync(process.execPath, ['--import', preload, SCRIPT], {
    cwd: ROOT, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /D1_VERIFICATION_FILE_PIN_MISMATCH/);
  const events = JSON.parse(await readFile(audit, 'utf8'));
  assert.equal(events.some(([kind, target]) => kind === 'write' && target === OUTPUT), false);
  assert.deepEqual(await readFile(OUTPUT), originalArtifact);
});

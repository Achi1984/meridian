import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {
  D2_VERIFIER_BOUNDS, verifyD2Candidate
} from '../scripts/research/b1-7/verify-d2-candidate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ARTIFACT = new URL('../docs/research/d2-candidate/admission-candidate.json', import.meta.url);
const VERIFIER_SOURCE = new URL('../scripts/research/b1-7/verify-d2-candidate.mjs', import.meta.url);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const canonicalJson = value => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(',')}]`
    : `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;

async function acceptedBytes() {
  return readFile(ARTIFACT);
}

function assertRejected(bytes, code) {
  const report = verifyD2Candidate(bytes);
  assert.equal(report.ok, false);
  assert.equal(report.status, 'INVALID');
  assert.equal(report.executionAuthorized, false);
  assert.ok(report.findings.length <= D2_VERIFIER_BOUNDS.findings);
  if (code) assert.equal(report.findings[0].code, code);
  return report;
}

function recomputeCandidateIdentity(candidate) {
  const manifest = candidate.input.manifestDraft;
  candidate.input.inputManifestSha256 = sha256(canonicalJson(manifest));
  const inputIdentity = {
    datasetKind: 'FROZEN_RESEARCH_INPUT',
    sourceCommit: manifest.sourceCommit,
    sourceProvenance: {normalizedFileSha256: manifest.files},
    canonicalSeriesSha256: manifest.selectedSeriesSha256
  };
  candidate.input.inputSha256 = sha256(canonicalJson(inputIdentity));
  const paths = candidate.paths.descriptorsAndIds.map(path => {
    const identity = {
      protocolId: candidate.protocol.id,
      protocolSha256: candidate.protocol.sha256,
      implementationId: candidate.implementation.id,
      implementationSha256: candidate.implementation.sha256,
      inputSha256: candidate.input.inputSha256,
      canonicalSeriesSha256: manifest.selectedSeriesSha256,
      variantId: path.variantId,
      scenarioId: path.scenarioId,
      segmentId: path.segmentId
    };
    path.pathId = sha256(canonicalJson(identity));
    return {
      kind: path.kind,
      variantId: path.variantId,
      scenarioId: path.scenarioId,
      segmentId: path.segmentId,
      pathId: path.pathId
    };
  });
  candidate.paths.manifestSha256 = sha256(canonicalJson(paths));
  candidate.paths.orderedComputationPaths = candidate.paths.computationOrder.map(
    (pathIndex, index) => ({ordinal: index + 1, ...paths[pathIndex]})
  );
  candidate.paths.computationOrderSha256 =
    sha256(canonicalJson(candidate.paths.orderedComputationPaths));
}

test('accepted #925 artifact validates as proposal-only without authorizing execution', async () => {
  const bytes = await acceptedBytes();
  const report = verifyD2Candidate(bytes);
  assert.deepEqual(report, {
    ok: true,
    status: 'PROPOSAL_ONLY',
    candidateSha256: '42c93768ec04a1dcffedb9b6255407798eb08cd85eac6d6971f1dedfb13981d7',
    executionAuthorized: false,
    findings: []
  });
});

test('generated mutation matrix rejects identity, order, authority, frozen-policy, and path tampering', async () => {
  const bytes = await acceptedBytes();
  const original = JSON.parse(bytes.toString('utf8'));
  const cases = [
    ['identity mismatch', candidate => { candidate.input.manifestDraft.sourceCommit = '0'.repeat(40); },
      'INPUT_SOURCE_MISMATCH'],
    ['order mismatch', candidate => { candidate.paths.computationOrder.reverse(); },
      'PATH_ORDER_MISMATCH'],
    ['execution escalation', candidate => { candidate.executionAuthorized = true; },
      'SCHEMA_VALUE_MISMATCH'],
    ['paper authority escalation', candidate => { candidate.authority.paperAuthorized = true; },
      'AUTHORITY_ESCALATION'],
    ['budget escalation', candidate => { candidate.limits.paths = 45; }, 'LIMITS_ESCALATION'],
    ['frozen cost change', candidate => { candidate.costs.perSideBasisPoints[0] = 14; },
      'COSTS_PIN_MISMATCH'],
    ['frozen screen change', candidate => {
      candidate.screenReference.screen.primary[0] = 'tampered';
    }, 'SCREEN_PIN_MISMATCH'],
    ['missing path', candidate => { candidate.paths.descriptorsAndIds.pop(); },
      'PATH_COUNT_MISMATCH'],
    ['duplicate path', candidate => {
      candidate.paths.descriptorsAndIds[1] = clone(candidate.paths.descriptorsAndIds[0]);
    }, 'PATH_IDENTITY_MISMATCH']
  ];
  for (const [name, mutate, code] of cases) {
    const candidate = clone(original);
    mutate(candidate);
    assertRejected(Buffer.from(JSON.stringify(candidate)), code);
  }
});

test('coordinately recomputed identities cannot bless changed accepted input', async () => {
  const candidate = JSON.parse((await acceptedBytes()).toString('utf8'));
  candidate.input.manifestDraft.selectedSeriesSha256.XBTUSD = 'f'.repeat(64);
  recomputeCandidateIdentity(candidate);
  const inputIdentity = {
    datasetKind: 'FROZEN_RESEARCH_INPUT',
    sourceCommit: candidate.input.manifestDraft.sourceCommit,
    sourceProvenance: {
      normalizedFileSha256: candidate.input.manifestDraft.files
    },
    canonicalSeriesSha256: candidate.input.manifestDraft.selectedSeriesSha256
  };
  assert.equal(candidate.input.inputManifestSha256,
    sha256(canonicalJson(candidate.input.manifestDraft)));
  assert.equal(candidate.input.inputSha256, sha256(canonicalJson(inputIdentity)));
  assert.equal(candidate.paths.manifestSha256,
    sha256(canonicalJson(candidate.paths.descriptorsAndIds.map((path) => ({
      kind: path.kind,
      variantId: path.variantId,
      scenarioId: path.scenarioId,
      segmentId: path.segmentId,
      pathId: path.pathId
    })))));
  assertRejected(Buffer.from(JSON.stringify(candidate)), 'INPUT_SERIES_PIN_MISMATCH');
});

test('strict parser rejects duplicate keys, malformed JSON, invalid UTF-8, and unknown fields', async () => {
  const bytes = await acceptedBytes();
  const text = bytes.toString('utf8');
  const duplicate = text.replace(
    '"schema": "MERIDIAN_D2_ADMISSION_CANDIDATE_R1",',
    '"schema": "MERIDIAN_D2_ADMISSION_CANDIDATE_R1",\n  "schema": "MERIDIAN_D2_ADMISSION_CANDIDATE_R1",'
  );
  assertRejected(Buffer.from(duplicate), 'DUPLICATE_KEY');
  assertRejected(Buffer.from('{'), 'MALFORMED_JSON');
  assertRejected(Buffer.from([0xc3, 0x28]), 'INVALID_UTF8');
  const unknown = JSON.parse(text);
  unknown.extra = true;
  assertRejected(Buffer.from(JSON.stringify(unknown)), 'UNKNOWN_FIELD');
  const missing = JSON.parse(text);
  delete missing.approvalReceipt;
  assertRejected(Buffer.from(JSON.stringify(missing)), 'MISSING_FIELD');
});

test('documented byte, depth, container, and total-value limits are enforced at the boundary', async () => {
  const bytes = await acceptedBytes();
  assert.ok(bytes.byteLength < D2_VERIFIER_BOUNDS.inputBytes);
  const exactlyBounded = Buffer.concat([
    bytes, Buffer.alloc(D2_VERIFIER_BOUNDS.inputBytes - bytes.byteLength, 0x20)
  ]);
  assert.equal(verifyD2Candidate(exactlyBounded).status, 'PROPOSAL_ONLY');
  assertRejected(Buffer.concat([exactlyBounded, Buffer.from(' ')]), 'INPUT_SIZE_LIMIT_EXCEEDED');
  const spoofedLength = new Uint8Array(D2_VERIFIER_BOUNDS.inputBytes + 1);
  Object.defineProperty(spoofedLength, 'byteLength', {value: 1});
  assertRejected(spoofedLength, 'INPUT_SIZE_LIMIT_EXCEEDED');

  const candidate = JSON.parse(bytes.toString('utf8'));
  const candidateDepth = (value) => value === null || typeof value !== 'object'
    ? 0
    : 1 + Math.max(0, ...Object.values(value).map(candidateDepth));
  const wrappers = D2_VERIFIER_BOUNDS.jsonDepth - candidateDepth(candidate);
  const nested = `${'['.repeat(wrappers)}${bytes.toString('utf8')}${']'.repeat(wrappers)}`;
  assert.notEqual(assertRejected(Buffer.from(nested)).findings[0].code,
    'DEPTH_LIMIT_EXCEEDED');
  const tooDeep = `${'['.repeat(wrappers + 1)}${bytes.toString('utf8')}${']'.repeat(wrappers + 1)}`;
  assertRejected(Buffer.from(tooDeep), 'DEPTH_LIMIT_EXCEEDED');

  const maxItems = `[${Array(D2_VERIFIER_BOUNDS.containerItems).fill('null').join(',')}]`;
  assert.notEqual(assertRejected(Buffer.from(maxItems)).findings[0].code,
    'CONTAINER_LIMIT_EXCEEDED');
  const tooManyItems =
    `[${Array(D2_VERIFIER_BOUNDS.containerItems + 1).fill('null').join(',')}]`;
  assertRejected(Buffer.from(tooManyItems), 'CONTAINER_LIMIT_EXCEEDED');

  const fullInnerArray = `[${Array(D2_VERIFIER_BOUNDS.containerItems).fill('null').join(',')}]`;
  const maxValues = `[${Array(D2_VERIFIER_BOUNDS.containerItems - 1)
    .fill(fullInnerArray).join(',')}]`;
  assert.equal(assertRejected(Buffer.from(maxValues)).findings[0].code,
    'OBJECT_REQUIRED');
  const tooManyValues = `[${Array(D2_VERIFIER_BOUNDS.containerItems - 1)
    .fill(fullInnerArray).join(',')},null]`;
  assertRejected(Buffer.from(tooManyValues), 'VALUE_LIMIT_EXCEEDED');
});

test('verification is pure, leaves bytes unchanged, and returns repeatable bounded reports', async () => {
  const bytes = await acceptedBytes();
  const before = Buffer.from(bytes);
  const first = verifyD2Candidate(bytes);
  const second = verifyD2Candidate(bytes);
  assert.deepEqual(first, second);
  assert.deepEqual(bytes, before);
  assert.equal(verifyD2Candidate('not bytes').findings[0].code, 'INPUT_NOT_BYTES');

  const source = readFileSync(VERIFIER_SOURCE, 'utf8');
  const imports = [...source.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)]
    .map(([, specifier]) => specifier);
  assert.deepEqual(imports, ['node:crypto']);
  assert.doesNotMatch(source, /\bimport\s*\(/);

  const script = `
    import fs from 'node:fs';
    import fsp from 'node:fs/promises';
    import net from 'node:net';
    import tls from 'node:tls';
    import http from 'node:http';
    import https from 'node:https';
    import dns from 'node:dns';
    import {syncBuiltinESMExports, createRequire} from 'node:module';
    const {verifyD2Candidate} = await import(${JSON.stringify(
      new URL('../scripts/research/b1-7/verify-d2-candidate.mjs', import.meta.url).href
    )});
    const deny = () => { throw new Error('FORBIDDEN_SIDE_EFFECT'); };
    for (const name of ['readFileSync', 'writeFileSync', 'appendFileSync', 'mkdirSync',
      'unlinkSync', 'renameSync', 'openSync']) fs[name] = deny;
    for (const name of ['readFile', 'writeFile', 'appendFile', 'mkdir', 'unlink', 'rename',
      'open']) fsp[name] = deny;
    net.Socket.prototype.connect = deny;
    tls.connect = deny;
    http.request = deny;
    https.request = deny;
    dns.lookup = deny;
    syncBuiltinESMExports();
    const require = createRequire(import.meta.url);
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(request, ...args) {
      if (/^(?:pg|sqlite3|better-sqlite3|node:sqlite)$/.test(request)) deny();
      return originalLoad.call(this, request, ...args);
    };
    const report = verifyD2Candidate(Buffer.from('{}'));
    if (report.executionAuthorized !== false) throw new Error('AUTHORITY_ESCALATION');
    console.log(report.status);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'INVALID');
});

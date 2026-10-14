import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  parseReceiptManifest,
  readLocalFileWithoutSymlinks,
  verifyReceiptManifest
} from '../scripts/strategy-evidence-receipts.mjs';

const bytes = value => Buffer.from(value);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function manifestFor(archive = bytes('zip-bytes'), payload = bytes('payload')) {
  return {
    schemaVersion: 'MERIDIAN_STRATEGY_RECEIPT_MANIFEST_V1',
    maxTotalBytes: 1024,
    artifacts: [{
      artifactId: 123,
      runId: 456,
      runCommitSha: 'a'.repeat(40),
      name: 'synthetic-result',
      kind: 'development-result',
      zip: {
        path: 'archives/result.zip',
        sha256: sha256(archive),
        sizeBytes: archive.length,
        maxBytes: 100
      },
      members: [{
        name: 'nested/result.json',
        path: 'members/result.json',
        sha256: sha256(payload),
        sizeBytes: payload.length,
        maxBytes: 100
      }]
    }]
  };
}

const textOf = manifest => JSON.stringify(manifest);
const validInputs = (archive = bytes('zip-bytes'), payload = bytes('payload')) => [
  {path: 'archives/result.zip', data: archive},
  {path: 'members/result.json', data: payload}
];

test('verifies exact supplied archive and payload bytes without claiming ZIP-member parsing', () => {
  const result = verifyReceiptManifest(textOf(manifestFor()), validInputs());
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.verified, true);
  assert.equal(result.zipMemberVerification, 'NOT_PERFORMED');
  assert.deepEqual(result.files.map(file => file.status), ['VERIFIED', 'VERIFIED']);
});

test('digest or size mismatch fails closed', () => {
  const result = verifyReceiptManifest(textOf(manifestFor()), validInputs(bytes('changed'), bytes('payload')));
  assert.equal(result.status, 'MISMATCH');
  assert.equal(result.verified, false);
  assert.equal(result.files[0].status, 'MISMATCH');
  assert.match(result.files[0].observedSha256, /^[a-f0-9]{64}$/);
});

test('missing expected inputs are unavailable and never verified', () => {
  const result = verifyReceiptManifest(textOf(manifestFor()), [
    {path: 'archives/result.zip', data: bytes('zip-bytes')}
  ]);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.verified, false);
  assert.equal(result.files[1].status, 'UNAVAILABLE');
  assert.equal(result.files[1].observedSha256, null);
});

test('extra and duplicate supplied inputs fail closed', () => {
  for (const inputs of [
    [...validInputs(), {path: 'unexpected.bin', data: bytes('extra')}],
    [...validInputs(), {path: 'archives/result.zip', data: bytes('zip-bytes')}]
  ]) {
    const result = verifyReceiptManifest(textOf(manifestFor()), inputs);
    assert.equal(result.status, 'MISMATCH');
    assert.equal(result.verified, false);
  }
});

test('malformed, ambiguous, duplicate-entry, and unknown-field manifests are rejected', () => {
  const duplicateKey = '{"schemaVersion":"MERIDIAN_STRATEGY_RECEIPT_MANIFEST_V1","schemaVersion":"MERIDIAN_STRATEGY_RECEIPT_MANIFEST_V1","maxTotalBytes":1,"artifacts":[]}';
  const manifest = manifestFor();
  const duplicateMember = structuredClone(manifest);
  duplicateMember.artifacts[0].members.push({...duplicateMember.artifacts[0].members[0]});
  const unknownField = structuredClone(manifest);
  unknownField.extra = false;
  for (const input of ['{', duplicateKey, textOf(duplicateMember), textOf(unknownField)]) {
    const result = verifyReceiptManifest(input, validInputs());
    assert.equal(result.status, 'INVALID_MANIFEST');
    assert.equal(result.verified, false);
  }
});

test('unsafe archive and supplied paths are rejected', () => {
  for (const unsafePath of ['../result.json', '/absolute.json', 'a\\\\b.json', 'a//b.json']) {
    const manifest = manifestFor();
    manifest.artifacts[0].members[0].name = unsafePath;
    const result = verifyReceiptManifest(textOf(manifest), validInputs());
    assert.equal(result.status, 'INVALID_MANIFEST', unsafePath);
    assert.equal(result.verified, false);
  }
});

test('declared and observed size limits fail closed', () => {
  const tooLarge = manifestFor();
  tooLarge.artifacts[0].members[0].maxBytes = 9 * 1024 * 1024;
  const invalidManifest = verifyReceiptManifest(textOf(tooLarge), validInputs());
  assert.equal(invalidManifest.status, 'INVALID_MANIFEST');
  assert.equal(invalidManifest.verified, false);

  const manifest = manifestFor();
  manifest.artifacts[0].members[0].maxBytes = 6;
  manifest.artifacts[0].members[0].sizeBytes = 6;
  const result = verifyReceiptManifest(textOf(manifest), [
    {path: 'archives/result.zip', data: bytes('zip-bytes')},
    {path: 'members/result.json', data: bytes('payload-too-large')}
  ]);
  assert.equal(result.status, 'MISMATCH');
  assert.equal(result.verified, false);
  assert.equal(result.files[1].status, 'MISMATCH');
});

test('manifest archive-member names and expected input paths cannot be duplicated', () => {
  const manifest = manifestFor();
  manifest.artifacts[0].members[0].path = manifest.artifacts[0].zip.path;
  const result = verifyReceiptManifest(textOf(manifest), validInputs());
  assert.equal(result.status, 'INVALID_MANIFEST');
  assert.equal(result.verified, false);
});

test('filesystem symlinks are rejected for supplied inputs', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-receipt-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const actual = path.join(directory, 'actual.bin');
  const link = path.join(directory, 'link.bin');
  fs.writeFileSync(actual, 'bytes');
  fs.symlinkSync(actual, link);
  assert.throws(() => readLocalFileWithoutSymlinks(link, 100), error => error.code === 'ELOOP');

  const parentLink = path.join(directory, 'parent-link');
  fs.symlinkSync(directory, parentLink);
  assert.throws(() => readLocalFileWithoutSymlinks(path.join(parentLink, 'actual.bin'), 100), error => error.code === 'ELOOP');
  const rejected = verifyReceiptManifest(textOf(manifestFor()), [
    {path: 'archives/result.zip', data: null, error: 'ELOOP'},
    {path: 'members/result.json', data: bytes('payload')}
  ]);
  assert.equal(rejected.status, 'MISMATCH');
  assert.equal(rejected.verified, false);
});

test('duplicate artifact identities are invalid', () => {
  const manifest = manifestFor();
  manifest.artifacts.push(structuredClone(manifest.artifacts[0]));
  const result = verifyReceiptManifest(textOf(manifest), validInputs());
  assert.equal(result.status, 'INVALID_MANIFEST');
  assert.equal(result.verified, false);
});

test('malformed byte inputs never receive verified status', () => {
  const result = verifyReceiptManifest(textOf(manifestFor()), [
    {path: 'archives/result.zip', data: 'not bytes'},
    {path: 'members/result.json', data: bytes('payload')}
  ]);
  assert.equal(result.status, 'MISMATCH');
  assert.equal(result.verified, false);
});

test('manifest parser rejects unknown receipt schemas', () => {
  const manifest = manifestFor();
  manifest.schemaVersion = 'OTHER';
  assert.throws(() => parseReceiptManifest(textOf(manifest)));
});

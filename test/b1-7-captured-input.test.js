import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  CAPTURED_INPUT_PROFILE, MAX_NORMALIZED_FILE_BYTES, NORMALIZED_PATHS,
  loadCapturedInputs, loadSyntheticFixtureProfile
} from '../scripts/research/b1-7/captured-input.mjs';
import {inspectHistoricalAdmission, HISTORICAL_ADMISSION_RECEIPT,
  HISTORICAL_INPUT_MANIFEST} from '../scripts/research/b1-7/historical-admission.mjs';
import {deriveHistoricalProfile, HISTORICAL_RUN_PROFILE,
  historicalProfileSha256, verifyHistoricalSourcePins} from '../scripts/research/b1-7/historical-profile.mjs';
import {ASSETS, INPUT} from '../scripts/research/b1-7/validate.mjs';
import {canonicalJson, createExecution, sha256} from '../scripts/research/b1-7/engine.mjs';
import {createSyntheticSeries} from './fixtures/b1-7/synthetic-series.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

async function createFixtureTree(t, series = createSyntheticSeries()) {
  const root = await mkdtemp(join(tmpdir(), 'meridian-b1-csv-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const files = {};
  for (const asset of ASSETS) {
    const relativePath = NORMALIZED_PATHS[asset];
    const filePath = join(root, relativePath);
    await mkdir(join(filePath, '..'), {recursive: true});
    const csv = [
      'timestamp_utc,open,high,low,close,volume,trades',
      ...series[asset].map(row =>
        [row.timestamp, row.open, row.high, row.low, row.close, row.volume, row.trades].join(','))
    ].join('\n') + '\n';
    await writeFile(filePath, csv);
    files[asset] = filePath;
  }
  return {root, files, series};
}

test('generated normalized CSV parses exact bytes into frozen synthetic-only series', async t => {
  const {root, files, series} = await createFixtureTree(t);
  const loaded = await loadSyntheticFixtureProfile(root);
  assert.deepEqual(Object.keys(NORMALIZED_PATHS), ASSETS);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.profile, CAPTURED_INPUT_PROFILE);
  assert.equal(loaded.source.kind, 'SYNTHETIC_FIXTURE');
  assert.equal(loaded.inputManifest.sourceCommit, null);
  assert.deepEqual(loaded.seriesByAsset.XBTUSD, series.XBTUSD);
  assert.equal(loaded.seriesByAsset.XBTUSD.length, INPUT.rowCount);
  assert.equal(Object.isFrozen(loaded.seriesByAsset), true);
  assert.equal(Object.isFrozen(loaded.seriesByAsset.XBTUSD), true);
  assert.equal(Object.isFrozen(loaded.seriesByAsset.XBTUSD[0]), true);
  for (const asset of ASSETS) {
    const bytes = await readFile(files[asset]);
    assert.equal(loaded.inputManifest.wholeFileSha256[asset], hash(bytes));
    assert.equal(/^[a-f0-9]{64}$/.test(loaded.inputManifest.selectedSeriesSha256[asset]), true);
  }
  assert.notEqual(
    loaded.inputManifest.wholeFileSha256.XBTUSD,
    loaded.inputManifest.selectedSeriesSha256.XBTUSD
  );
  assert.equal(loaded.inputManifest.canonicalSelectedSeriesSha256.length, 64);
});

test('synthetic byte edits alter identities but cannot supply production authorization', async t => {
  const {root, files} = await createFixtureTree(t);
  const before = await loadSyntheticFixtureProfile(root);
  const original = await readFile(files.XBTUSD, 'utf8');
  const changed = original.replace(',1000,10\n', ',1001,10\n');
  assert.notEqual(changed, original);
  await writeFile(files.XBTUSD, changed);
  const after = await loadSyntheticFixtureProfile(root);
  assert.equal(after.ok, true);
  assert.notEqual(before.inputManifest.wholeFileSha256.XBTUSD, after.inputManifest.wholeFileSha256.XBTUSD);
  assert.notEqual(before.inputManifest.selectedSeriesSha256.XBTUSD, after.inputManifest.selectedSeriesSha256.XBTUSD);
  const production = await loadCapturedInputs({
    profile: 'FROZEN_PRODUCTION_INPUT',
    sourceCommit: INPUT.sourceCommit,
    fileHashes: before.inputManifest.wholeFileSha256,
    selectedSeriesHashes: before.inputManifest.selectedSeriesSha256,
    admission: true
  });
  assert.equal(production.status, 'BLOCKED');
  assert.equal(production.error.code, 'SELECTED_INPUT_MANIFEST_MISSING');
});

test('historical admission remains inert and rejects stale or malformed approval candidates', async t => {
  assert.equal(HISTORICAL_INPUT_MANIFEST, null);
  assert.equal(HISTORICAL_ADMISSION_RECEIPT, null);
  assert.equal(HISTORICAL_RUN_PROFILE.status, 'NOT_FROZEN');
  assert.equal(HISTORICAL_RUN_PROFILE.inputManifestSha256, null);
  assert.equal(HISTORICAL_RUN_PROFILE.trialKey, 'trial-historical-d2-r1');
  assert.equal(HISTORICAL_RUN_PROFILE.pathIds, null);
  assert.equal(HISTORICAL_RUN_PROFILE.computationPathIds, null);
  assert.deepEqual(inspectHistoricalAdmission({
    manifest: null, receipt: null, profile: HISTORICAL_RUN_PROFILE
  }), {
    ok: false, status: 'BLOCKED', error: {code: 'INPUT_MANIFEST_NOT_FROZEN'}
  });
  assert.equal((await loadCapturedInputs()).error.code, 'SELECTED_INPUT_MANIFEST_MISSING');
  const adapter = spawnSync('node', [
    join(projectRoot, 'scripts/research-supervisor/historical_adapter.mjs')
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 10000,
    env: {PATH: process.env.PATH, LANG: 'C.UTF-8', B1_RESULT_FD: '3'}
  });
  assert.equal(adapter.status, 1);
  assert.match(adapter.stderr, /SELECTED_INPUT_MANIFEST_MISSING/);

  const {root: fixtureRoot} = await createFixtureTree(t);
  const generated = await loadSyntheticFixtureProfile(fixtureRoot);
  const manifestCandidate = {
    sourceCommit: INPUT.sourceCommit,
    files: {...INPUT.normalizedHashes},
    selectedSeriesSha256: {...generated.inputManifest.selectedSeriesSha256}
  };
  const manifestSha256 = sha256(canonicalJson(manifestCandidate));
  const derivedProfile = deriveHistoricalProfile(manifestCandidate);
  const testProfile = {
    ...derivedProfile,
    status: 'FROZEN_FOR_D2',
    inputManifest: manifestCandidate,
    inputManifestSha256: manifestSha256,
    sourceSha256: Object.fromEntries(Object.keys(HISTORICAL_RUN_PROFILE.sourceFiles)
      .map(name => [name, 'a'.repeat(64)]))
  };
  testProfile.sourceIdentitySha256 = sha256(canonicalJson(testProfile.sourceSha256));
  testProfile.runProfileSha256 = historicalProfileSha256(testProfile);
  const unapprovedReceiptCandidate = {
    schema: 'NOT_AN_APPROVAL',
    decision: 'PENDING',
    owner: 'TEST_ONLY',
    approvedAt: null,
    sourceCommit: testProfile.sourceCommit,
    sourceIdentitySha256: testProfile.sourceIdentitySha256,
    protocolSha256: testProfile.protocolSha256,
    implementationSha256: testProfile.implementationSha256,
    inputManifestSha256: manifestSha256,
    runProfileSha256: testProfile.runProfileSha256,
    manifestSha256: testProfile.manifestSha256,
    computationOrderSha256: testProfile.computationOrderSha256,
    trialKey: testProfile.trialKey,
    pathIds: [...testProfile.pathIds]
  };
  assert.equal(inspectHistoricalAdmission({
    manifest: manifestCandidate, receipt: null, profile: testProfile
  }).error.code, 'D2_APPROVAL_REQUIRED');
  assert.equal(inspectHistoricalAdmission({
    manifest: manifestCandidate, receipt: unapprovedReceiptCandidate, profile: testProfile
  }).error.code, 'D2_APPROVAL_INVALID');
  let approvalGetterCalls = 0;
  const accessorReceipt = Object.defineProperty({...unapprovedReceiptCandidate}, 'protocolSha256', {
    enumerable: true,
    get() {
      approvalGetterCalls++;
      return testProfile.protocolSha256;
    }
  });

  assert.equal(inspectHistoricalAdmission({
    manifest: manifestCandidate, receipt: accessorReceipt, profile: testProfile
  }).error.code, 'D2_APPROVAL_INVALID');
  assert.equal(approvalGetterCalls, 0);
  const accessorPathIds = [...unapprovedReceiptCandidate.pathIds];
  Object.defineProperty(accessorPathIds, '0', {
    enumerable: true,
    get() {
      approvalGetterCalls++;
      return testProfile.pathIds[0];
    }
  });
  assert.equal(inspectHistoricalAdmission({
    manifest: manifestCandidate,
    receipt: {...unapprovedReceiptCandidate, pathIds: accessorPathIds},
    profile: testProfile
  }).error.code, 'D2_APPROVAL_INVALID');
  assert.equal(approvalGetterCalls, 0);

  for (const [field, value, expected] of [
    ['sourceCommit', '0'.repeat(40), 'D2_SOURCE_MISMATCH'],
    ['protocolSha256', '0'.repeat(64), 'D2_PROTOCOL_MISMATCH'],
    ['implementationSha256', '0'.repeat(64), 'D2_IMPLEMENTATION_MISMATCH'],
    ['sourceIdentitySha256', '0'.repeat(64), 'D2_SOURCE_MISMATCH'],
    ['inputManifestSha256', '0'.repeat(64), 'D2_MANIFEST_MISMATCH'],
    ['runProfileSha256', '0'.repeat(64), 'D2_PROFILE_MISMATCH'],
    ['manifestSha256', '0'.repeat(64), 'D2_PATHS_MISMATCH'],
    ['computationOrderSha256', '0'.repeat(64), 'D2_PATHS_MISMATCH']
  ]) {
    const result = inspectHistoricalAdmission({
      manifest: manifestCandidate,
      receipt: {...unapprovedReceiptCandidate, [field]: value},
      profile: testProfile
    });
    assert.equal(result.error.code, expected, field);
  }
  const changedPaths = [...unapprovedReceiptCandidate.pathIds];
  [changedPaths[0], changedPaths[1]] = [changedPaths[1], changedPaths[0]];
  assert.equal(inspectHistoricalAdmission({
    manifest: manifestCandidate,
    receipt: {...unapprovedReceiptCandidate, pathIds: changedPaths},
    profile: testProfile
  }).error.code, 'D2_PATHS_MISMATCH');
  const wrongSourceManifest = {...manifestCandidate, sourceCommit: '0'.repeat(40)};
  const wrongSourceManifestSha256 = sha256(canonicalJson(wrongSourceManifest));
  const wrongSourceProfile = {
    ...testProfile,
    inputManifest: wrongSourceManifest,
    inputManifestSha256: wrongSourceManifestSha256
  };
  wrongSourceProfile.runProfileSha256 = historicalProfileSha256(wrongSourceProfile);
  assert.equal(inspectHistoricalAdmission({
    manifest: wrongSourceManifest,
    receipt: {
      ...unapprovedReceiptCandidate,
      sourceCommit: wrongSourceProfile.sourceCommit,
      inputManifestSha256: wrongSourceManifestSha256,
      runProfileSha256: wrongSourceProfile.runProfileSha256
    },
    profile: wrongSourceProfile
  }).error.code, 'D2_SOURCE_MISMATCH');
});

test('historical identities derive from input metadata and stale pins fail before market-file I/O', async t => {
  const {series} = await createFixtureTree(t);
  const manifest = {
    sourceCommit: HISTORICAL_RUN_PROFILE.sourceCommit,
    files: {...HISTORICAL_RUN_PROFILE.expectedWholeFileSha256},
    selectedSeriesSha256: Object.fromEntries(ASSETS.map(asset =>
      [asset, sha256(canonicalJson(series[asset]))]))
  };
  const historical = deriveHistoricalProfile(manifest);
  const session = createExecution({
    seriesByAsset: series,
    source: {
      kind: 'FROZEN_RESEARCH_INPUT',
      commit: manifest.sourceCommit,
      files: manifest.files
    },
    implementationSha256: historical.implementationSha256
  });
  assert.equal(historical.inputSha256, sha256(canonicalJson({
    datasetKind: 'FROZEN_RESEARCH_INPUT',
    sourceCommit: manifest.sourceCommit,
    sourceProvenance: {normalizedFileSha256: manifest.files},
    canonicalSeriesSha256: manifest.selectedSeriesSha256
  })));
  assert.deepEqual(historical.pathIds, session.manifest.map(path => path.pathId));
  assert.equal(historical.manifestSha256, sha256(canonicalJson(session.manifest)));
  assert.equal(historical.computationOrderSha256, sha256(canonicalJson(session.computationOrder)));
  assert.notDeepEqual(historical.pathIds, JSON.parse(
    await readFile(join(projectRoot, 'scripts/research-supervisor/b1_bridge_manifest.json'), 'utf8')
  ).pathIds);
  const alteredSourcePins = {
    ...HISTORICAL_RUN_PROFILE,
    sourceSha256: {...HISTORICAL_RUN_PROFILE.sourceSha256, loader: '0'.repeat(64)}
  };
  assert.ok(Object.values(alteredSourcePins.sourceFiles).every(relative => !relative.endsWith('.csv')));
  assert.equal(verifyHistoricalSourcePins(alteredSourcePins).error.code,
    'HISTORICAL_SOURCE_PIN_MISMATCH');
});

test('strict generated CSV loader rejects changed schema, encoding, timestamps, and missing assets', async t => {
  const cases = [
    ['schema', contents => contents.replace('timestamp_utc,open,high', 'time,open,high'), 'CSV_SCHEMA_INVALID'],
    ['encoding', () => Buffer.from([0xff, 0xfe, 0xfd]), 'INVALID_UTF8'],
    ['duplicate timestamp', contents => contents.replace(
      '2024-02-20T00:00:00Z', '2024-02-19T00:00:00Z'), 'CSV_DUPLICATE_TIMESTAMP'],
    ['wrong selected window', contents => contents.replace(
      '2024-02-19T00:00:00Z', '2024-02-20T00:00:00Z'), 'CSV_SELECTED_CALENDAR_INVALID'],
    ['missing selected day', contents => contents.replace(
      /2024-03-01T00:00:00Z[^\n]*\n/, ''), 'CSV_SELECTED_CALENDAR_INVALID']
  ];
  for (const [name, alter, expectedCode] of cases) {
    const {root, files} = await createFixtureTree(t);
    const contents = await readFile(files.XBTUSD);
    await writeFile(files.XBTUSD, alter(contents.toString('utf8')));
    const loaded = await loadSyntheticFixtureProfile(root);
    assert.equal(loaded.ok, false, name);
    assert.equal(loaded.error.code, expectedCode, name);
  }
  const missing = await createFixtureTree(t);
  await rm(missing.files.SUIUSD);
  const missingResult = await loadSyntheticFixtureProfile(missing.root);
  assert.equal(missingResult.ok, false);
});

test('fixed normalized-path allowlist rejects symlinks and oversized files', async t => {
  const linked = await createFixtureTree(t);
  const outside = join(linked.root, 'outside.csv');
  await writeFile(outside, await readFile(linked.files.XBTUSD));
  await rm(linked.files.XBTUSD);
  await symlink(outside, linked.files.XBTUSD);
  const symlinkResult = await loadSyntheticFixtureProfile(linked.root);
  assert.equal(symlinkResult.ok, false);
  assert.equal(symlinkResult.error.code, 'SYMLINK_REJECTED');

  const oversized = await createFixtureTree(t);
  await writeFile(oversized.files.XBTUSD, Buffer.alloc(MAX_NORMALIZED_FILE_BYTES + 1, 0x20));
  const oversizedResult = await loadSyntheticFixtureProfile(oversized.root);
  assert.equal(oversizedResult.ok, false);
  assert.equal(oversizedResult.error.code, 'FILE_SIZE_INVALID');
});

function fixturePins(loaded) {
  return {
    profile: CAPTURED_INPUT_PROFILE,
    wholeFileSha256: {...loaded.inputManifest.wholeFileSha256},
    selectedSeriesSha256: {...loaded.inputManifest.selectedSeriesSha256}
  };
}

test('generated expected-byte pins reject drift before parsing and selected-hash mismatch after parsing', async t => {
  const {root, files} = await createFixtureTree(t);
  const baseline = await loadSyntheticFixtureProfile(root);
  const pins = fixturePins(baseline);
  assert.equal((await loadSyntheticFixtureProfile(root, pins)).ok, true);
  const selectedMismatch = fixturePins(baseline);
  selectedMismatch.selectedSeriesSha256.XBTUSD = '0'.repeat(64);
  assert.equal((await loadSyntheticFixtureProfile(root, selectedMismatch)).error.code,
    'SELECTED_SERIES_HASH_MISMATCH');
  // Invalid encoding proves whole-byte verification precedes the parser.
  await writeFile(files.XBTUSD, Buffer.from([0xff, 0xfe, 0xfd]));
  const drift = await loadSyntheticFixtureProfile(root, pins);
  assert.equal(drift.error.code, 'WHOLE_FILE_HASH_MISMATCH');
  const production = await loadCapturedInputs(pins);
  assert.equal(production.error.code, 'SELECTED_INPUT_MANIFEST_MISSING');
});

test('synthetic pins are snapshotted before I/O and loaded rows cannot follow later file changes', async t => {
  const {root, files} = await createFixtureTree(t);
  const baseline = await loadSyntheticFixtureProfile(root);
  const pins = fixturePins(baseline);
  const pending = loadSyntheticFixtureProfile(root, pins);
  pins.wholeFileSha256.XBTUSD = '0'.repeat(64);
  pins.selectedSeriesSha256.XBTUSD = '0'.repeat(64);
  const loaded = await pending;
  assert.equal(loaded.ok, true);
  const close = loaded.seriesByAsset.XBTUSD[0].close;
  await writeFile(files.XBTUSD, 'changed after verified buffer was parsed');
  assert.equal(loaded.seriesByAsset.XBTUSD[0].close, close);
  assert.throws(() => { loaded.seriesByAsset.XBTUSD[0].close = 0; }, TypeError);
  assert.equal(loaded.inputManifest.wholeFileSha256.XBTUSD, baseline.inputManifest.wholeFileSha256.XBTUSD);
});

test('synthetic manifest accessors are rejected without evaluating getters', async t => {
  const {root} = await createFixtureTree(t);
  let getterCalls = 0;
  const wholeFileSha256 = Object.defineProperty({}, 'XBTUSD', {
    enumerable: true,
    get() {
      getterCalls++;
      return '0'.repeat(64);
    }
  });
  const pins = {
    profile: CAPTURED_INPUT_PROFILE,
    wholeFileSha256,
    selectedSeriesSha256: {}
  };
  const loaded = await loadSyntheticFixtureProfile(root, pins);
  assert.equal(loaded.error.code, 'SYNTHETIC_MANIFEST_INVALID');
  assert.equal(getterCalls, 0);

  const accessorProfile = Object.defineProperty({}, 'profile', {
    enumerable: true,
    get() {
      getterCalls++;
      return CAPTURED_INPUT_PROFILE;
    }
  });
  assert.equal((await loadSyntheticFixtureProfile(root, accessorProfile)).error.code,
    'SYNTHETIC_MANIFEST_INVALID');
  assert.equal(getterCalls, 0);
});

test('root symlinks and symlinked ancestor paths are rejected', async t => {
  const {root} = await createFixtureTree(t);
  assert.equal((await loadSyntheticFixtureProfile(`${root}/`)).ok, true);
  const rootSegment = root.split('/').at(-1);
  assert.equal((await loadSyntheticFixtureProfile(`${root}/../${rootSegment}`)).error.code,
    'ROOT_PATH_ALIAS_REJECTED');
  const parent = await mkdtemp(join(tmpdir(), 'meridian-b1-alias-'));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const alias = join(parent, 'alias');
  await symlink(root, alias);
  assert.equal((await loadSyntheticFixtureProfile(alias)).error.code, 'SYMLINK_REJECTED');
  const ancestorAlias = join(parent, 'ancestor');
  await symlink(join(root, '..'), ancestorAlias);
  const throughAncestor = join(ancestorAlias, root.split('/').at(-1));
  assert.equal((await loadSyntheticFixtureProfile(throughAncestor)).error.code, 'ROOT_PATH_ALIAS_REJECTED');
});

test('authoritative normalized header, BOM and out-of-order rows are checked using generated bytes', async t => {
  for (const [label, alter, expected] of [
    ['obsolete header', text => text.replace('timestamp_utc,', 'timestamp,'), 'CSV_SCHEMA_INVALID'],
    ['UTF8 BOM', text => '\ufeff' + text, 'CSV_SCHEMA_INVALID'],
    ['out of order', text => {
      const lines = text.split('\n');
      [lines[2], lines[3]] = [lines[3], lines[2]];
      return lines.join('\n');
    }, 'CSV_SELECTED_CALENDAR_INVALID']
  ]) {
    const {root, files} = await createFixtureTree(t);
    await writeFile(files.XBTUSD, alter(await readFile(files.XBTUSD, 'utf8')));
    const result = await loadSyntheticFixtureProfile(root);
    assert.equal(result.ok, false, label);
    assert.equal(result.error.code, expected, label);
  }
  const invalidManifest = {profile: 'FROZEN_PRODUCTION_INPUT', wholeFileSha256: {}, selectedSeriesSha256: {}};
  const result = await loadSyntheticFixtureProfile('/does-not-exist', invalidManifest);
  assert.equal(result.error.code, 'SYNTHETIC_MANIFEST_INVALID');
});

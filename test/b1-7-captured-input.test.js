import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  CAPTURED_INPUT_PROFILE, MAX_NORMALIZED_FILE_BYTES, NORMALIZED_PATHS,
  loadCapturedInputs, loadSyntheticFixtureProfile
} from '../scripts/research/b1-7/captured-input.mjs';
import {ASSETS, INPUT} from '../scripts/research/b1-7/validate.mjs';
import {createSyntheticSeries} from './fixtures/b1-7/synthetic-series.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

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

test('root symlinks and symlinked ancestor paths are rejected', async t => {
  const {root} = await createFixtureTree(t);
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

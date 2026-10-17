// Stored-evidence consistency only. This never runs Python or a Freqtrade loader.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportArenaFreqtrade, FREQTRADE_FORMAT_REF } from '../scripts/export-arena-freqtrade.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex64 = /^[0-9a-f]{64}$/;
const boundaries = ['strategyExecuted', 'performanceParityEstablished', 'liveAuthorized', 'autoPromotion'];
const root = await mkdtemp(join(tmpdir(), 'meridian-feather-report-'));
after(() => rm(root, { recursive: true, force: true }));
const out = join(root, 'json');
// Reconstruct the manifest through the existing offline exporter, not a copied fixture.
const manifest = await exportArenaFreqtrade({ sourceDir: join(ROOT, 'research/results/strategy-arena-20261016'), outDir: out });
const [manifestBytes, verifier, jsonVerifier, lock, reportBytes, jsonReportBytes] = await Promise.all([
  readFile(join(out, 'manifest.json')),
  readFile(join(ROOT, 'scripts/verify-freqtrade-feather.py')),
  readFile(join(ROOT, 'scripts/verify-freqtrade-loader.py')),
  readFile(join(ROOT, 'scripts/freqtrade-loader-cp312-linux.lock')),
  readFile(join(ROOT, 'docs/strategy-lab/FREQTRADE_FEATHER_RESULT_20261017.json')),
  readFile(join(ROOT, 'docs/strategy-lab/FREQTRADE_LOADER_RESULT_20261017.json')),
]);
const evidence = { report: JSON.parse(reportBytes), jsonReport: JSON.parse(jsonReportBytes), manifest, manifestBytes, verifier, jsonVerifier, lock };

function validateStoredEvidence({ report: r, jsonReport: prior, manifest: m, manifestBytes: mb, verifier: v, jsonVerifier: jv, lock: l }) {
  assert.equal(r.schemaVersion, 'MERIDIAN_FREQTRADE_FEATHER_DIAGNOSTIC_V1', 'REPORT_SCHEMA');
  assert.equal(r.featherVerifierSha256, hash(v), 'FEATHER_VERIFIER_HASH');
  assert.equal(r.jsonVerifierSha256, hash(jv), 'JSON_VERIFIER_HASH');
  assert.equal(r.dependencyLockSha256, hash(l), 'LOCK_HASH');
  assert.equal(r.freqtradeCommit, FREQTRADE_FORMAT_REF, 'UPSTREAM_COMMIT');
  assert.equal(m.formatReferenceCommit, FREQTRADE_FORMAT_REF, 'EXPORTER_COMMIT');
  assert.equal(r.sourceManifestSha256, hash(mb), 'SOURCE_MANIFEST_HASH');
  assert.equal(r.arenaInputSha256, m.arenaInputSha256, 'ARENA_INPUT_HASH');
  assert.equal(r.warmupBars, m.warmupBars, 'WARMUP');
  assert.equal(r.firstExecutionTime, m.firstExecutionTime, 'FIRST_EXECUTION_TIME');
  assert.equal(r.python, '3.12.14', 'REPORTED_PYTHON_VERSION');
  assert.equal(r.status, 'EXACT_FEATHER_INPUT_PARITY_ONLY', 'REPORTED_STATUS');
  assert.equal(r.format, 'feather', 'FORMAT');
  assert.equal(r.inputDecoder, 'CPYTHON_STDLIB_JSON', 'DECODER');
  assert.equal(r.tolerance, 0, 'ZERO_TOLERANCE');
  for (const key of boundaries) assert.equal(r[key], false, 'BOUNDARY_' + key);
  assert.equal(r.jsonLoaderResultSuperseded, false, 'JSON_RESULT_NOT_SUPERSEDED');

  const pairs = m.files.map(f => f.pair);
  assert.equal(pairs.length, 8, 'EXACT_UNIVERSE');
  assert.equal(new Set(pairs).size, 8, 'EXACT_UNIVERSE');
  assert.ok(Array.isArray(r.files), 'FILES_ARRAY');
  assert.deepEqual(r.files.map(f => f.pair), pairs, 'FILE_UNIVERSE');
  assert.deepEqual(Object.keys(r.results).sort(), [...pairs].sort(), 'RESULT_UNIVERSE');
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i], input = m.files[i], file = r.files[i], result = r.results[pair];
    assert.equal(file.filename, input.filename.replace(/\.json$/, '.feather'), 'FEATHER_FILENAME');
    // Only syntax/association can be checked: Feather binaries are not in this checkout.
    assert.ok(typeof file.sha256 === 'string' && hex64.test(file.sha256), 'OUTPUT_HASH_SYNTAX_ONLY');
    assert.equal(file.rows, input.rows, 'FILE_ROWS');
    assert.equal(result.publicEqualsRaw, true, 'PUBLIC_EQUALS_RAW');
    for (const stage of ['raw', 'public']) {
      const item = result[stage];
      assert.equal(item.rows, input.rows, 'LOADER_ROWS');
      assert.equal(item.numericMismatchCount, 0, 'NUMERIC_MISMATCH');
      assert.equal(item.binary64MismatchCount, 0, 'BINARY64_MISMATCH');
      assert.equal(item.maxAbsoluteDifference, 0, 'MAX_DIFFERENCE');
      assert.deepEqual(item.examples, [], 'UNEXPECTED_EXAMPLES');
      assert.deepEqual(result[stage + 'Path'], { arrowDatasetCalls: 1, featherFallbackCalls: 0 }, 'REPORTED_ARROW_PATH');
    }
  }
  // Preserve the independently recorded JSON failure; Feather success does not replace it.
  assert.equal(prior.schemaVersion, 'MERIDIAN_FREQTRADE_LOADER_DIAGNOSTIC_V1', 'PRIOR_SCHEMA');
  assert.equal(prior.status, 'LOADER_NUMERIC_PARITY_FAILED', 'PRIOR_JSON_FAILURE');
  assert.equal(prior.freqtradeCommit, r.freqtradeCommit, 'PRIOR_COMMIT');
  assert.equal(prior.python, r.python, 'PRIOR_PYTHON');
  assert.equal(prior.dependencyLockSha256, r.dependencyLockSha256, 'PRIOR_LOCK');
  assert.equal(prior.manifestSha256, r.sourceManifestSha256, 'PRIOR_MANIFEST');
  assert.equal(prior.arenaInputSha256, r.arenaInputSha256, 'PRIOR_INPUT');
  assert.equal(prior.tolerance, 0, 'PRIOR_TOLERANCE');
  for (const key of boundaries) assert.equal(prior[key], false, 'PRIOR_BOUNDARY_' + key);
  assert.deepEqual(Object.keys(prior.results).sort(), [...pairs].sort(), 'PRIOR_UNIVERSE');
  let rawMismatches = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (const stage of ['raw', 'public']) {
      const item = prior.results[pairs[i]][stage];
      assert.equal(item.rows, m.files[i].rows, 'PRIOR_ROWS');
      assert.ok(Number.isSafeInteger(item.numericMismatchCount) && item.numericMismatchCount >= 0 && item.numericMismatchCount <= item.rows * 5, 'PRIOR_MISMATCH_COUNT');
      assert.ok(Number.isFinite(item.maxAbsoluteDifference) && item.maxAbsoluteDifference >= 0, 'PRIOR_MAX_DIFFERENCE');
      assert.ok(Array.isArray(item.examples), 'PRIOR_EXAMPLES');
      assert.equal(item.numericMismatchCount > 0, item.maxAbsoluteDifference > 0, 'PRIOR_FAILURE_CONSISTENCY');
      assert.equal(item.numericMismatchCount > 0, item.examples.length > 0, 'PRIOR_FAILURE_CONSISTENCY');
      assert.ok(item.examples.length <= item.numericMismatchCount, 'PRIOR_EXAMPLE_COUNT');
      if (stage === 'raw') rawMismatches += item.numericMismatchCount;
    }
  }
  assert.ok(rawMismatches > 0, 'PRIOR_JSON_FAILURE_EVIDENCE');
}

function rejected(mutate, code) {
  const changed = structuredClone(evidence);
  mutate(changed);
  assert.throws(() => validateStoredEvidence(changed), new RegExp(code));
}

test('stored Feather evidence is internally consistent with current inputs and verifier sources', () => {
  validateStoredEvidence(evidence);
});

test('changed verifier, helper or dependency bytes invalidate stored evidence', () => {
  for (const [field, code] of [['verifier', 'FEATHER_VERIFIER_HASH'], ['jsonVerifier', 'JSON_VERIFIER_HASH'], ['lock', 'LOCK_HASH']]) {
    rejected(x => { x[field] = Buffer.concat([Buffer.from(x[field]), Buffer.from('\n# changed\n')]); }, code);
  }
});

test('different input lineage, warmup, runtime or upstream identity is rejected', () => {
  rejected(x => { x.manifestBytes = Buffer.from('{}'); }, 'SOURCE_MANIFEST_HASH');
  for (const [field, value, code] of [['arenaInputSha256', '0'.repeat(64), 'ARENA_INPUT_HASH'], ['warmupBars', 199, 'WARMUP'], ['firstExecutionTime', 0, 'FIRST_EXECUTION_TIME'], ['freqtradeCommit', '0'.repeat(40), 'UPSTREAM_COMMIT'], ['python', '3.14.2', 'REPORTED_PYTHON_VERSION']]) {
    rejected(x => { x.report[field] = value; }, code);
  }
});

test('missing duplicate extra pairs and row disagreements are rejected', () => {
  rejected(x => { x.report.files.pop(); }, 'FILE_UNIVERSE');
  rejected(x => { x.report.files[1] = x.report.files[0]; }, 'FILE_UNIVERSE');
  rejected(x => { x.report.files.push({ ...x.report.files[0], pair: 'DOGE/USD' }); }, 'FILE_UNIVERSE');
  rejected(x => { delete x.report.results['BTC/USD']; }, 'RESULT_UNIVERSE');
  rejected(x => { x.report.results['DOGE/USD'] = x.report.results['BTC/USD']; }, 'RESULT_UNIVERSE');
  rejected(x => { x.report.files[0].rows--; }, 'FILE_ROWS');
  rejected(x => { x.report.results['BTC/USD'].raw.rows--; }, 'LOADER_ROWS');
  rejected(x => { x.report.files[0].filename = '../AVAX_USD-1d.feather'; }, 'FEATHER_FILENAME');
  rejected(x => { x.report.files[0].sha256 = 'not-a-hash'; }, 'OUTPUT_HASH_SYNTAX_ONLY');
});

test('a success label cannot hide a numeric mismatch, repair or fallback', () => {
  for (const stage of ['raw', 'public']) {
    for (const [field, value, code] of [['numericMismatchCount', 1, 'NUMERIC_MISMATCH'], ['binary64MismatchCount', 1, 'BINARY64_MISMATCH'], ['maxAbsoluteDifference', 1e-15, 'MAX_DIFFERENCE'], ['examples', [{ row: 1 }], 'UNEXPECTED_EXAMPLES']]) {
      rejected(x => { x.report.results['BTC/USD'][stage][field] = value; }, code);
    }
    rejected(x => { x.report.results['BTC/USD'][stage + 'Path'].featherFallbackCalls = 1; }, 'REPORTED_ARROW_PATH');
    rejected(x => { x.report.results['BTC/USD'][stage + 'Path'].arrowDatasetCalls = 0; }, 'REPORTED_ARROW_PATH');
  }
  rejected(x => { x.report.results['BTC/USD'].publicEqualsRaw = false; }, 'PUBLIC_EQUALS_RAW');
});

test('evidence cannot silently add strategy/live scope, tolerance or supersede JSON failure', () => {
  for (const key of boundaries) {
    rejected(x => { x.report[key] = true; }, 'BOUNDARY_' + key);
    rejected(x => { x.jsonReport[key] = true; }, 'PRIOR_BOUNDARY_' + key);
  }
  rejected(x => { x.report.tolerance = 1e-12; }, 'ZERO_TOLERANCE');
  rejected(x => { x.report.jsonLoaderResultSuperseded = true; }, 'JSON_RESULT_NOT_SUPERSEDED');
  rejected(x => { x.jsonReport.status = 'LOADER_INPUT_PARITY_ONLY'; }, 'PRIOR_JSON_FAILURE');
  rejected(x => { for (const v of Object.values(x.jsonReport.results)) for (const s of ['raw', 'public']) Object.assign(v[s], { numericMismatchCount: 0, maxAbsoluteDifference: 0, examples: [] }); }, 'PRIOR_JSON_FAILURE_EVIDENCE');
});

import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {isAbsolute, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPrivatePaperReportPoolOptions, attachPrivateReportPoolErrorHandler,
  createPrivateReportStore} from '../../private-report-store.mjs';
import {
  projectSpotPaperPairedDashboard,
  SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA
} from './contract.mjs';
import {isValidSpotPaperPairedExpectedIdentity} from './evaluate.mjs';
import {
  canonicalSpotPaperPairedReportJson,
  SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
  SPOT_PAPER_PAIRED_REPORT_MAX_BYTES,
  spotPaperPairedReportDigest
} from './envelope.mjs';

const MAX_IDENTITY_BYTES = 16 * 1024;
const MAX_DASHBOARD_BYTES = SPOT_PAPER_PAIRED_REPORT_MAX_BYTES;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export async function readBoundedJsonFile(path, maxBytes) {
  let file;
  try {
    if (typeof path !== 'string' || !isAbsolute(path)) fail('INPUT_PATH_INVALID');
    if (!Number.isInteger(constants.O_NOFOLLOW) ||
        !Number.isInteger(constants.O_NONBLOCK)) fail('SAFE_FILE_FLAGS_UNAVAILABLE');
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW |
        constants.O_NONBLOCK);
    } catch (error) {
      fail(error?.code === 'ELOOP' ? 'INPUT_SYMLINK_REJECTED' : 'INPUT_OPEN_FAILED');
    }
    const stat = await file.stat({bigint: true});
    if (!stat.isFile() || stat.size > maxBytes) fail('INPUT_TOO_LARGE_OR_NOT_FILE');
    const buffer = Buffer.alloc(maxBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await file.read(
        buffer, bytesRead, buffer.length - bytesRead, bytesRead
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    const after = await file.stat({bigint: true});
    if (bytesRead > maxBytes || BigInt(bytesRead) !== stat.size ||
        after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size ||
        after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) {
      fail('INPUT_TOO_LARGE_OR_CHANGED');
    }
    let text;
    try {
      text = new TextDecoder('utf-8', {fatal: true})
        .decode(buffer.subarray(0, bytesRead));
    } catch {
      fail('INPUT_INVALID_UTF8');
    }
    try {
      return JSON.parse(text);
    } catch {
      fail('INPUT_INVALID_JSON');
    }
  } finally {
    await file?.close().catch(() => {});
  }
}

function publicIdentity(identity) {
  return {
    runId: identity.runId,
    pair: identity.pair,
    sourceSha256: identity.sourceSha256,
    configSha256: identity.configSha256,
    researchSourceSha256: identity.researchSourceSha256,
    ...(identity.modelPairId ? {modelPairId: identity.modelPairId} : {}),
    models: identity.models.map(({role, modelId}) => ({role, modelId}))
  };
}

export function prepareSpotPaperPairedReport(expectedIdentity, dashboard) {
  if (!isValidSpotPaperPairedExpectedIdentity(expectedIdentity)) {
    fail('EXPECTED_IDENTITY_INVALID');
  }
  const report = projectSpotPaperPairedDashboard(dashboard);
  if (!report || report.schemaVersion !== SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA ||
      report.evidenceStatus === 'CORRUPT_UNKNOWN') {
    fail('PAIRED_DASHBOARD_INVALID');
  }
  if (canonicalSpotPaperPairedReportJson(report.identity) !==
      canonicalSpotPaperPairedReportJson(publicIdentity(expectedIdentity))) {
    fail('PAIRED_IDENTITY_MISMATCH');
  }
  const envelope = {
    schema: SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
    runId: expectedIdentity.runId,
    report
  };
  const digest = spotPaperPairedReportDigest(envelope);
  return Object.freeze({
    runId: expectedIdentity.runId,
    configHash: expectedIdentity.configSha256,
    digest,
    envelope
  });
}

export async function ingestSpotPaperPairedReport({
  expectedIdentity,
  dashboard,
  write = false,
  getStore
}) {
  const prepared = prepareSpotPaperPairedReport(expectedIdentity, dashboard);
  if (!write) return {status: 'DRY_RUN', runId: prepared.runId, digest: prepared.digest};
  if (typeof getStore !== 'function') fail('DATABASE_STORE_UNAVAILABLE');

  let store;
  try {
    store = await getStore();
    if (!store || typeof store.insertImmutable !== 'function') {
      fail('DATABASE_STORE_UNAVAILABLE');
    }
    const result = await store.insertImmutable(prepared);
    if (result === 'INSERTED' || result === 'IDENTICAL') {
      return {status: result, runId: prepared.runId, digest: prepared.digest};
    }
    if (result === 'CONFLICT') {
      return {status: 'CONFLICT', runId: prepared.runId, digest: prepared.digest};
    }
    fail('DATABASE_STORE_RESULT_INVALID');
  } catch (error) {
    if (error?.code === 'PAPER_REPORT_OUTCOME_UNKNOWN') {
      return {status: 'OUTCOME_UNKNOWN', runId: prepared.runId, digest: prepared.digest};
    }
    if (error?.code === 'DATABASE_STORE_UNAVAILABLE') throw error;
    fail('DATABASE_WRITE_FAILED');
  }
}

function createStoreFactory(env) {
  let pool = null;
  return {
    async getStore() {
      if (!env.DATABASE_URL) fail('DATABASE_URL_REQUIRED');
      const {default: pg} = await import('pg');
      pool = attachPrivateReportPoolErrorHandler(new pg.Pool(
        createPrivatePaperReportPoolOptions(env.DATABASE_URL)
      ));
      return createPrivateReportStore(pool, {
        tableName: 'meridian_spot_paper_paired_reports'
      });
    },
    async close() {
      await pool?.end().catch(() => {});
    }
  };
}

function usage(stderr) {
  stderr.write(
    'Usage: node scripts/spot-paper-paired-report/ingest.mjs ' +
    '<expected-identity.json> <paired-dashboard.json> [--write]\n'
  );
}

export async function main(argv = process.argv.slice(2), {
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  getStore
} = {}) {
  const write = argv[2] === '--write';
  if (argv.length < 2 || argv.length > 3 || argv.length === 3 && !write) {
    usage(stderr);
    return 2;
  }
  const storeFactory = getStore ? null : createStoreFactory(env);
  try {
    const expectedIdentity = await readBoundedJsonFile(argv[0], MAX_IDENTITY_BYTES);
    const dashboard = await readBoundedJsonFile(argv[1], MAX_DASHBOARD_BYTES);
    const result = await ingestSpotPaperPairedReport({
      expectedIdentity,
      dashboard,
      write,
      getStore: getStore ?? storeFactory.getStore
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'CONFLICT') return 3;
    if (result.status === 'OUTCOME_UNKNOWN') return 4;
    return 0;
  } catch (error) {
    const code = /^[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'INGEST_FAILED';
    stderr.write(`${code}\n`);
    return 1;
  } finally {
    await storeFactory?.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}

import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, open, realpath} from 'node:fs/promises';
import {TextDecoder} from 'node:util';
import {resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJson, sha256} from './engine.mjs';
import {ASSETS, INPUT, validateSeries} from './validate.mjs';

export const CAPTURED_INPUT_PROFILE = 'SYNTHETIC_ONLY_GENERATED_FIXTURE';
export const MAX_NORMALIZED_FILE_BYTES = 512 * 1024;
export const NORMALIZED_PATHS = Object.freeze({
  XBTUSD: 'research/acquisitions/kraken-usd-daily-20261018/normalized/XBTUSD_1440_utc_normalized.csv',
  ETHUSD: 'research/acquisitions/kraken-usd-daily-20261018/normalized/ETHUSD_1440_utc_normalized.csv',
  SOLUSD: 'research/acquisitions/kraken-usd-daily-20261018/normalized/SOLUSD_1440_utc_normalized.csv',
  XRPUSD: 'research/acquisitions/kraken-usd-daily-20261018/normalized/XRPUSD_1440_utc_normalized.csv',
  LINKUSD: 'research/acquisitions/kraken-usd-daily-20261018/normalized/LINKUSD_1440_utc_normalized.csv',
  AVAXUSD: 'research/acquisitions/kraken-usd-daily-20261018/normalized/AVAXUSD_1440_utc_normalized.csv',
  SUIUSD: 'research/acquisitions/kraken-usd-daily-20261018/normalized/SUIUSD_1440_utc_normalized.csv'
});

const HEADER = 'timestamp_utc,open,high,low,close,volume,trades';
const LAST_TIMESTAMP = '2026-09-30T00:00:00Z';
const PRODUCTION_SELECTED_INPUT_MANIFEST = null;
const PRODUCTION_ADMISSION = null;
const PRODUCTION_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DAY_MS = 86400000;
const DECIMAL = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function inputError(code, file = null) {
  const error = new Error(code);
  error.code = code;
  error.file = file;
  return error;
}

function fail(code, file = null) {
  throw inputError(code, file);
}

function productionManifestCheck() {
  const manifest = PRODUCTION_SELECTED_INPUT_MANIFEST;
  if (!manifest) return {ok: false, status: 'BLOCKED', error: {code: 'SELECTED_INPUT_MANIFEST_MISSING'}};
  if (!PRODUCTION_ADMISSION || PRODUCTION_ADMISSION.admitted !== true) {
    return {ok: false, status: 'BLOCKED', error: {code: 'EXPLICIT_ADMISSION_REQUIRED'}};
  }
  if (manifest.sourceCommit !== INPUT.sourceCommit ||
    ASSETS.some(asset => manifest.files?.[asset] !== INPUT.normalizedHashes[asset]) ||
    ASSETS.some(asset => !/^[a-f0-9]{64}$/.test(manifest.selectedSeriesSha256?.[asset] ?? ''))) {
    return {ok: false, status: 'BLOCKED', error: {code: 'PRODUCTION_MANIFEST_INVALID'}};
  }
  const manifestSha256 = sha256(canonicalJson(manifest));
  if (PRODUCTION_ADMISSION.inputManifestSha256 !== manifestSha256) {
    return {ok: false, status: 'BLOCKED', error: {code: 'PRODUCTION_ADMISSION_MISMATCH'}};
  }
  return {ok: true, manifest, manifestSha256};
}

function normalizedRoot(rootDir) {
  if (typeof rootDir !== 'string' || rootDir.length === 0) fail('FIXTURE_ROOT_INVALID');
  return resolve(rootDir);
}

function snapshotDataObject(value, keys) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
      return null;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key))) return null;
    const snapshot = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export async function loadCapturedInputs() {
  const admission = productionManifestCheck();
  if (!admission.ok) return admission;
  return loadSeriesFromRoot(PRODUCTION_ROOT, {
    profile: 'FROZEN_PRODUCTION_INPUT',
    manifest: admission.manifest
  });
}

export async function loadSyntheticFixtureProfile(rootDir, expectedManifest = null) {
  if (typeof rootDir !== 'string' || rootDir.length === 0) fail('FIXTURE_ROOT_INVALID');
  let manifest = null;
  if (expectedManifest !== null) {
    const pins = snapshotDataObject(expectedManifest, [
      'profile', 'wholeFileSha256', 'selectedSeriesSha256'
    ]);
    const wholeFileSha256 = pins && snapshotDataObject(pins.wholeFileSha256, ASSETS);
    const selectedSeriesSha256 = pins && snapshotDataObject(pins.selectedSeriesSha256, ASSETS);
    const hashMap = value => value &&
      ASSETS.every(asset => typeof value[asset] === 'string' && /^[a-f0-9]{64}$/.test(value[asset]));
    if (!pins || pins.profile !== CAPTURED_INPUT_PROFILE ||
        !hashMap(wholeFileSha256) || !hashMap(selectedSeriesSha256)) {
      return {ok: false, status: 'REJECTED', error: {code: 'SYNTHETIC_MANIFEST_INVALID', file: null}};
    }
    // Snapshot caller pins before the first await; this profile never enables production admission.
    manifest = {
      files: wholeFileSha256,
      selectedSeriesSha256
    };
  }
  return loadSeriesFromRoot(rootDir, {profile: CAPTURED_INPUT_PROFILE, manifest});
}

async function checkPathComponents(root, relativePath) {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('ROOT_NOT_DIRECTORY');
  let current = root;
  const components = relativePath.split('/');
  for (let index = 0; index < components.length; index++) {
    current = resolve(current, components[index]);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) fail('SYMLINK_REJECTED', relativePath);
    if (index < components.length - 1 && !stat.isDirectory()) {
      fail('PATH_COMPONENT_NOT_DIRECTORY', relativePath);
    }
  }
  return current;
}

async function readVerifiedBuffer(root, relativePath) {
  const absolutePath = await checkPathComponents(root, relativePath);
  const resolvedPath = await realpath(absolutePath);
  const expectedPath = resolve(root, relativePath);
  if (resolvedPath !== expectedPath ||
    !(resolvedPath === root || resolvedPath.startsWith(`${root}${sep}`))) {
    fail('PATH_ESCAPE_REJECTED', relativePath);
  }
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink()) fail('NOT_REGULAR_FILE', relativePath);
  if (before.size <= 0 || before.size > MAX_NORMALIZED_FILE_BYTES) {
    fail('FILE_SIZE_INVALID', relativePath);
  }
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
      opened.size !== before.size || opened.size > MAX_NORMALIZED_FILE_BYTES) {
      fail('FILE_CHANGED_DURING_OPEN', relativePath);
    }
    if (await realpath(`/proc/self/fd/${handle.fd}`) !== absolutePath) {
      fail('PATH_CHANGED_DURING_OPEN', relativePath);
    }
    const buffer = Buffer.alloc(opened.size);
    const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat();
    if (bytesRead !== buffer.length || after.size !== opened.size ||
      after.dev !== opened.dev || after.ino !== opened.ino) {
      fail('FILE_CHANGED_DURING_READ', relativePath);
    }
    if (await realpath(`/proc/self/fd/${handle.fd}`) !== absolutePath) {
      fail('PATH_CHANGED_DURING_READ', relativePath);
    }
    const fileSha256 = createHash('sha256').update(buffer).digest('hex');
    return {buffer, fileSha256};
  } finally {
    await handle.close();
  }
}

function parseCsv(buffer, relativePath) {
  let text;
  try {
    text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(buffer);
  } catch {
    fail('INVALID_UTF8', relativePath);
  }
  if (text.includes('\0')) fail('CSV_NUL_BYTE', relativePath);
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length < 2) fail('CSV_ROWS_MISSING', relativePath);
  const normalizeLineEnd = line => {
    if (line.endsWith('\r')) return line.slice(0, -1);
    if (line.includes('\r')) fail('CSV_LINE_ENDING_INVALID', relativePath);
    return line;
  };
  if (normalizeLineEnd(lines[0]) !== HEADER) fail('CSV_SCHEMA_INVALID', relativePath);
  const selectedRows = [];
  let priorTimestamp = null;
  let selectedIndex = 0;
  for (const rawLine of lines.slice(1)) {
    const line = normalizeLineEnd(rawLine);
    if (line.length === 0) fail('CSV_BLANK_ROW', relativePath);
    const fields = line.split(',');
    if (fields.length !== 7) fail('CSV_FIELD_COUNT_INVALID', relativePath);
    const [timestamp, ...rawValues] = fields;
    if (!/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(timestamp)) {
      fail('CSV_TIMESTAMP_INVALID', relativePath);
    }
    const parsedTime = Date.parse(timestamp);
    if (!Number.isFinite(parsedTime) || new Date(parsedTime).toISOString().replace('.000Z', 'Z') !== timestamp) {
      fail('CSV_TIMESTAMP_INVALID', relativePath);
    }
    if (priorTimestamp !== null && parsedTime <= priorTimestamp) {
      fail(parsedTime === priorTimestamp ? 'CSV_DUPLICATE_TIMESTAMP' : 'CSV_ORDER_INVALID', relativePath);
    }
    priorTimestamp = parsedTime;
    const values = rawValues.map(value => {
      if (!DECIMAL.test(value)) fail('CSV_NUMBER_INVALID', relativePath);
      const number = Number(value);
      if (!Number.isFinite(number)) fail('CSV_NUMBER_INVALID', relativePath);
      return number;
    });
    if (timestamp >= INPUT.firstTimestamp && timestamp <= LAST_TIMESTAMP) {
      const expected = new Date(Date.parse(INPUT.firstTimestamp) + selectedIndex * DAY_MS)
        .toISOString().replace('.000Z', 'Z');
      if (timestamp !== expected) fail('CSV_SELECTED_CALENDAR_INVALID', relativePath);
      selectedRows.push({
        timestamp,
        open: values[0],
        high: values[1],
        low: values[2],
        close: values[3],
        volume: values[4],
        trades: values[5]
      });
      selectedIndex++;
    }
  }
  if (selectedIndex !== INPUT.rowCount ||
    selectedRows.at(-1)?.timestamp !== LAST_TIMESTAMP) {
    fail('CSV_SELECTED_ROW_COUNT_INVALID', relativePath);
  }
  return selectedRows;
}

async function loadSeriesFromRoot(root, {profile, manifest}) {
  try {
    root = normalizedRoot(root);
    const rootStat = await lstat(root);
    if (rootStat.isSymbolicLink()) fail('SYMLINK_REJECTED');
    if (!rootStat.isDirectory()) fail('ROOT_NOT_DIRECTORY');
    const canonicalRoot = await realpath(root);
    if (canonicalRoot !== root) fail('ROOT_PATH_ALIAS_REJECTED');
    const seriesByAsset = {};
    const fileHashes = {};
    const selectedSeriesHashes = {};
    for (const asset of ASSETS) {
      const relativePath = NORMALIZED_PATHS[asset];
      const {buffer, fileSha256} = await readVerifiedBuffer(canonicalRoot, relativePath);
      if (manifest && fileSha256 !== manifest.files[asset]) {
        fail('WHOLE_FILE_HASH_MISMATCH', relativePath);
      }
      const rows = parseCsv(buffer, relativePath);
      const selectedSeriesSha256 = sha256(canonicalJson(rows));
      if (manifest && selectedSeriesSha256 !== manifest.selectedSeriesSha256[asset]) {
        fail('SELECTED_SERIES_HASH_MISMATCH', relativePath);
      }
      seriesByAsset[asset] = rows;
      fileHashes[asset] = fileSha256;
      selectedSeriesHashes[asset] = selectedSeriesSha256;
    }
    const validation = validateSeries(seriesByAsset);
    if (!validation.ok) fail('SYNCHRONIZED_OHLC_INVALID');
    const frozenSeries = deepFreeze(seriesByAsset);
    const selectedInputManifest = {
      profile,
      sourceCommit: profile === 'FROZEN_PRODUCTION_INPUT' ? INPUT.sourceCommit : null,
      wholeFileSha256: fileHashes,
      selectedSeriesSha256: selectedSeriesHashes,
      canonicalSelectedSeriesSha256: sha256(canonicalJson(frozenSeries))
    };
    return {
      ok: true,
      status: 'LOADED',
      profile,
      seriesByAsset: frozenSeries,
      inputManifest: deepFreeze(selectedInputManifest),
      source: profile === CAPTURED_INPUT_PROFILE
        ? Object.freeze({kind: 'SYNTHETIC_FIXTURE'})
        : Object.freeze({
          kind: 'FROZEN_RESEARCH_INPUT',
          commit: INPUT.sourceCommit,
          files: Object.freeze({...fileHashes})
        })
    };
  } catch (error) {
    return {
      ok: false,
      status: 'REJECTED',
      error: {code: error.code ?? 'CAPTURED_INPUT_LOAD_FAILED', file: error.file ?? null}
    };
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

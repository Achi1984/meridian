#!/usr/bin/env node
// Offline data interchange only: no replay, strategy, network or order execution.
import { createHash } from 'node:crypto';
import { open, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ARENA_RULESET, ARENA_SYMBOLS } from '../research/strategy-paper-arena.js';

const DAY = 86400000, MAX_FILE = 262144;
export const FREQTRADE_FORMAT_REF = '1f394eaebc2f46a83d26971388628707802f8602';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const must = (ok, code) => { if (!ok) throw Error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
};
async function readBounded(path) {
  const handle = await open(path, 'r');
  try {
    must((await handle.stat()).isFile(), 'REGULAR_FILE_REQUIRED');
    const buffer = Buffer.alloc(MAX_FILE + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    must(size <= MAX_FILE, 'SOURCE_FILE_TOO_LARGE');
    const bytes = buffer.subarray(0, size);
    return { bytes, json: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } finally { await handle.close(); }
}
function rawJSON(raw, path) {
  must(raw?.httpStatus === 200 && typeof raw.body === 'string' && hash(raw.body) === raw.sha256, 'RAW_HASH_OR_STATUS_MISMATCH');
  const url = new URL(raw.url);
  must(url.origin === 'https://api.kraken.com' && url.pathname === path && !url.username && !url.password && !url.hash, 'WRONG_SOURCE_URL');
  const json = JSON.parse(raw.body);
  must(Array.isArray(json.error) && json.error.length === 0 && json.result && typeof json.result === 'object', 'KRAKEN_ERROR');
  return { json, url };
}
function number(text) {
  must(typeof text === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text), 'INVALID_RAW_DECIMAL');
  const n = Number(text);
  must(Number.isFinite(n), 'NONFINITE_RAW_NUMBER');
  return n;
}

export async function prepareFreqtradeExport(sourceDir) {
  const source = await readBounded(join(sourceDir, 'manifest.json')), m = source.json;
  must(m.schemaVersion === 'MERIDIAN_ARENA_CHUNKED_INPUT_V1' && m.ruleset === ARENA_RULESET, 'UNSUPPORTED_ARENA_FORMAT');
  must(Array.isArray(m.chunks) && m.chunks.length === 8, 'EXACT_UNIVERSE_REQUIRED');
  const input = structuredClone(m.inputTemplate), collection = input?.collection;
  must(input?.quoteCurrency === 'USD' && input.sourceKind === 'MARKET_DIAGNOSTIC' && collection?.provider === 'KRAKEN_SPOT_PUBLIC_OHLC' && collection.fxConversion === false, 'KRAKEN_USD_ONLY');
  must(Number.isSafeInteger(input.asOf) && input.asOf >= DAY && collection.eventTimeCutoff === Math.floor(input.asOf / DAY) * DAY - 1, 'INVALID_AS_OF_OR_CUTOFF');
  const metadata = rawJSON(collection.instrumentMetadata, '/0/public/AssetPairs').json.result;
  input.data = {}; collection.rawResponses = {};
  const files = {}, entries = [], seen = new Set();
  let calendar;
  for (const entry of m.chunks) {
    const s = entry.symbol;
    must(ARENA_SYMBOLS.includes(s) && !seen.has(s) && entry.path === s + '.json', 'INVALID_CHUNK_PATH_OR_SYMBOL');
    seen.add(s);
    const chunk = await readBounded(join(sourceDir, entry.path));
    must(hash(chunk.bytes) === entry.sha256 && chunk.json.symbol === s, 'CHUNK_HASH_OR_SYMBOL_MISMATCH');
    const { rows, rawResponse: raw } = chunk.json, instrument = collection.instruments?.[s];
    const base = s === 'BTC' ? 'XBT' : s, actual = metadata[instrument?.resultKey];
    must(actual && instrument.altname === base + 'USD' && instrument.wsname === base + '/USD' && ['USD', 'ZUSD'].includes(instrument.quote) && [base, 'X' + base].includes(instrument.base) && instrument.status === 'online', 'WRONG_INSTRUMENT');
    for (const field of ['altname', 'wsname', 'base', 'quote', 'status']) must(actual[field] === instrument[field], 'METADATA_MISMATCH');
    const { json, url } = rawJSON(raw, '/0/public/OHLC');
    must(url.searchParams.getAll('pair').length === 1 && url.searchParams.get('pair') === instrument.altname && url.searchParams.getAll('interval').length === 1 && url.searchParams.get('interval') === '1440', 'WRONG_OHLC_REQUEST');
    must(same(Object.keys(json.result).filter(k => k !== 'last'), [instrument.resultKey]), 'WRONG_RESULT_KEY');
    const sourceRows = json.result[instrument.resultKey];
    must(Array.isArray(sourceRows) && sourceRows.length >= 202 && sourceRows.length <= 720, 'INVALID_SOURCE_LENGTH');
    const byTime = new Map();
    let previous;
    for (const row of sourceRows) {
      must(Array.isArray(row) && row.length === 8 && Number.isSafeInteger(row[0]), 'INVALID_RAW_ROW');
      const at = row[0] * 1000;
      must(Number.isSafeInteger(at) && at >= 0 && at % DAY === 0 && (previous === undefined || at === previous + DAY) && at <= collection.eventTimeCutoff + 1, 'INVALID_RAW_CALENDAR');
      previous = at;
      const [o, h, l, c] = row.slice(1, 5).map(number), volume = number(row[6]);
      must(l > 0 && h >= l && o >= l && o <= h && c >= l && c <= h, 'INVALID_RAW_OHLC');
      byTime.set(at, [at, o, h, l, c, volume]);
    }
    must(Array.isArray(rows) && rows.length >= 202 && rows.length <= 720, 'INVALID_RETAINED_LENGTH');
    const converted = rows.map((r, i) => {
      must(r && Number.isSafeInteger(r.openTime) && r.openTime >= 0 && r.openTime % DAY === 0 && r.closeTime === r.openTime + DAY - 1 && r.closeTime <= collection.eventTimeCutoff && (!i || r.openTime === rows[i - 1].openTime + DAY), 'INVALID_RETAINED_CALENDAR');
      must(['open', 'high', 'low', 'close'].every(k => typeof r[k] === 'number' && Number.isFinite(r[k])), 'INVALID_RETAINED_OHLC');
      const rawRow = byTime.get(r.openTime);
      must(rawRow && same(rawRow.slice(0, 5), [r.openTime, r.open, r.high, r.low, r.close]), 'RAW_RETAINED_OHLC_MISMATCH');
      return rawRow;
    });
    must(rows.at(-1).closeTime === collection.eventTimeCutoff, 'STALE_RETAINED_HISTORY');
    const dates = converted.map(r => r[0]);
    if (calendar) must(same(calendar, dates), 'UNALIGNED_UNIVERSE');
    else calendar = dates;
    input.data[s] = rows; collection.rawResponses[s] = raw;
    const filename = s + '_USD-1d.json', content = JSON.stringify(converted) + '\n';
    files[filename] = content;
    entries.push({ pair: s + '/USD', filename, rows: rows.length, sha256: hash(content), sourceChunkSha256: entry.sha256, rawResponseSha256: raw.sha256 });
  }
  const inputSha256 = hash(canonical(input) + '\n');
  must(inputSha256 === m.receipt?.inputSha256, 'ARENA_INPUT_HASH_MISMATCH');
  entries.sort((a, b) => a.pair.localeCompare(b.pair));
  const manifest = {
    schemaVersion: 'MERIDIAN_FREQTRADE_DATA_BRIDGE_V1',
    sourceManifestSha256: hash(source.bytes), arenaInputSha256: inputSha256,
    ruleset: ARENA_RULESET, formatReferenceCommit: FREQTRADE_FORMAT_REF,
    format: 'JSON_VALUES_TIMESTAMP_MS_OHLCV', columns: ['date', 'open', 'high', 'low', 'close', 'volume'],
    venue: 'kraken', market: 'spot', quoteCurrency: 'USD', timeframe: '1d',
    volumeSource: 'RETAINED_KRAKEN_OHLC_BASE_VOLUME_INDEX_6',
    warmupBars: 200, firstOpenTime: calendar[0], firstExecutionTime: calendar[200], lastCloseTime: calendar.at(-1) + DAY - 1,
    files: entries, evidence: 'RETAINED_SOURCE_INTEGRITY_ONLY_NOT_AUTHENTICATED',
    comparisonExecuted: false, performanceParityEstablished: false,
    liveAuthorized: false, autoPromotion: false,
    limitations: ['Hashes check consistency, not source authenticity or historical availability.', 'No Freqtrade process, signal comparison or portfolio comparison has run.', 'Volume was not part of the arena strategy inputs; zero volume is preserved, never fabricated.', 'Current universe and retrospective sample do not establish a fresh holdout.']
  };
  return { files, manifest };
}

export async function exportArenaFreqtrade({ sourceDir, outDir }) {
  must(typeof sourceDir === 'string' && typeof outDir === 'string', 'SOURCE_AND_OUTPUT_REQUIRED');
  const prepared = await prepareFreqtradeExport(sourceDir);
  // Refuse any existing directory. Manifest is the last-write completion marker.
  await mkdir(outDir);
  for (const [name, content] of Object.entries(prepared.files)) await writeFile(join(outDir, name), content, { flag: 'wx' });
  await writeFile(join(outDir, 'manifest.json'), canonical(prepared.manifest) + '\n', { flag: 'wx' });
  return prepared.manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--out') {
    process.stderr.write('Usage: node scripts/export-arena-freqtrade.mjs --source SNAPSHOT_DIR --out NEW_DIR\n'); process.exitCode = 1;
  } else exportArenaFreqtrade({ sourceDir: resolve(args[1]), outDir: resolve(args[3]) }).then(m => {
    process.stdout.write(JSON.stringify({ status: 'DATA_EXPORTED_ONLY', files: m.files.length, rowsPerAsset: m.files[0].rows, arenaInputSha256: m.arenaInputSha256, comparisonExecuted: false }) + '\n');
  }).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}

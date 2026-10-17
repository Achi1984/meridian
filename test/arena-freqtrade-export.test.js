import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARENA_RULESET, ARENA_SYMBOLS } from '../research/strategy-paper-arena.js';
import { prepareFreqtradeExport, exportArenaFreqtrade } from '../scripts/export-arena-freqtrade.mjs';
const DAY = 86400000;
const hash = s => createHash('sha256').update(s).digest('hex');
const canonical = x => x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
async function fixture(t, mutate = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'meridian-freqtrade-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = join(root, 'source'); await mkdir(sourceDir);
  const metadata = {}, instruments = {}, chunks = {};
  for (const s of ARENA_SYMBOLS) {
    const base = s === 'BTC' ? 'XBT' : s, key = base + 'USD';
    metadata[key] = { altname: key, wsname: base + '/USD', base, quote: 'USD', status: 'online' };
    instruments[s] = { ...metadata[key], resultKey: key };
    const rawRows = Array.from({ length: 203 }, (_, i) => [DAY * (i + 1) / 1000, '100', '110', '90', '105', '101', i === 0 ? '0' : '12.345', 5]);
    const rows = rawRows.slice(0, -1).map(r => ({ openTime: r[0] * 1000, closeTime: r[0] * 1000 + DAY - 1, open: 100, high: 110, low: 90, close: 105 }));
    chunks[s] = { symbol: s, rows, rawResponse: { url: 'https://api.kraken.com/0/public/OHLC?pair=' + key + '&interval=1440', httpStatus: 200, body: JSON.stringify({ error: [], result: { [key]: rawRows, last: 203 * DAY / 1000 } }) } };
  }
  const inputTemplate = { asOf: DAY * 203 + 100, quoteCurrency: 'USD', sourceKind: 'MARKET_DIAGNOSTIC', collection: { provider: 'KRAKEN_SPOT_PUBLIC_OHLC', fxConversion: false, eventTimeCutoff: DAY * 203 - 1, instruments, instrumentMetadata: { url: 'https://api.kraken.com/0/public/AssetPairs', httpStatus: 200, body: JSON.stringify({ error: [], result: metadata }) } } };
  mutate({ chunks, inputTemplate });
  const m = { schemaVersion: 'MERIDIAN_ARENA_CHUNKED_INPUT_V1', ruleset: ARENA_RULESET, inputTemplate, chunks: [], receipt: {} };
  const input = structuredClone(inputTemplate); input.data = {}; input.collection.rawResponses = {};
  inputTemplate.collection.instrumentMetadata.sha256 = hash(inputTemplate.collection.instrumentMetadata.body);
  input.collection.instrumentMetadata.sha256 = inputTemplate.collection.instrumentMetadata.sha256;
  for (const s of ARENA_SYMBOLS) {
    chunks[s].rawResponse.sha256 = hash(chunks[s].rawResponse.body);
    const content = JSON.stringify(chunks[s]) + '\n';
    await writeFile(join(sourceDir, s + '.json'), content);
    m.chunks.push({ symbol: s, path: s + '.json', sha256: hash(content) });
    input.data[s] = chunks[s].rows; input.collection.rawResponses[s] = chunks[s].rawResponse;
  }
  m.receipt.inputSha256 = hash(canonical(input) + '\n');
  await writeFile(join(sourceDir, 'manifest.json'), JSON.stringify(m));
  return { sourceDir, outDir: join(root, 'out'), m };
}
function changeRaw(chunks, fn) {
  const raw = JSON.parse(chunks.BTC.rawResponse.body); fn(raw.result.XBTUSD, raw);
  chunks.BTC.rawResponse.body = JSON.stringify(raw);
}
test('six-column millisecond export preserves real zero/positive volume and excludes current candle', async t => {
  const args = await fixture(t), m = await exportArenaFreqtrade(args);
  const rows = JSON.parse(await readFile(join(args.outDir, 'BTC_USD-1d.json')));
  assert.equal(rows.length, 202); assert.deepEqual(rows[0], [DAY, 100, 110, 90, 105, 0]);
  assert.equal(rows[1][5], 12.345); assert.equal(rows.at(-1)[0], DAY * 202);
  assert.equal(m.firstExecutionTime, DAY * 201);
  assert.equal(m.comparisonExecuted, false); assert.equal(m.performanceParityEstablished, false);
  assert.equal(m.liveAuthorized, false); assert.equal(m.autoPromotion, false);
  assert.equal((await readdir(args.outDir)).length, 9);
  for (const f of m.files) assert.equal(hash(await readFile(join(args.outDir, f.filename))), f.sha256);
});
test('export is byte reproducible and refuses existing output without modifying it', async t => {
  const args = await fixture(t);
  await exportArenaFreqtrade(args);
  const before = await readFile(join(args.outDir, 'manifest.json'));
  await assert.rejects(exportArenaFreqtrade(args), /EEXIST/);
  assert.deepEqual(await readFile(join(args.outDir, 'manifest.json')), before);
  const second = args.outDir + '-second'; await exportArenaFreqtrade({ ...args, outDir: second });
  assert.deepEqual(await readFile(join(second, 'manifest.json')), before);
});
test('rejects altered chunk and receipt hashes before creating output', async t => {
  const args = await fixture(t);
  await writeFile(join(args.sourceDir, 'BTC.json'), '{}');
  await assert.rejects(exportArenaFreqtrade(args), /CHUNK_HASH/);
  await assert.rejects(readdir(args.outDir), /ENOENT/);
  const next = await fixture(t); next.m.receipt.inputSha256 = '0'.repeat(64);
  await writeFile(join(next.sourceDir, 'manifest.json'), JSON.stringify(next.m));
  await assert.rejects(exportArenaFreqtrade(next), /ARENA_INPUT_HASH/);
});
test('chunk traversal and duplicate symbols fail even when listed in the manifest', async t => {
  for (const change of [m => { m.chunks[0].path = '../BTC.json'; }, m => { m.chunks[1] = { ...m.chunks[0] }; }]) {
    const args = await fixture(t); change(args.m);
    await writeFile(join(args.sourceDir, 'manifest.json'), JSON.stringify(args.m));
    await assert.rejects(prepareFreqtradeExport(args.sourceDir), /INVALID_CHUNK_PATH_OR_SYMBOL/);
  }
});
test('semantic corruption is rejected even when every supplied hash is recomputed', async t => {
  const cases = [
    [({ chunks }) => { chunks.BTC.rows[0].close = 104; }, /RAW_RETAINED_OHLC/],
    [({ chunks }) => changeRaw(chunks, r => { r[0][6] = '-1'; }), /RAW_DECIMAL/],
    [({ chunks }) => changeRaw(chunks, r => { r[0][6] = ''; }), /RAW_DECIMAL/],
    [({ chunks }) => changeRaw(chunks, r => { r[0][6] = null; }), /RAW_DECIMAL/],
    [({ chunks }) => changeRaw(chunks, r => { r[0][6] = '1e999'; }), /RAW_DECIMAL/],
    [({ chunks }) => changeRaw(chunks, r => { r[0][3] = '120'; }), /RAW_OHLC/],
    [({ chunks }) => changeRaw(chunks, r => { r[1][0] = r[0][0]; }), /RAW_CALENDAR/],
    [({ chunks }) => changeRaw(chunks, r => r.reverse()), /RAW_CALENDAR/],
    [({ chunks }) => changeRaw(chunks, r => { r.at(-1)[0] += DAY / 1000; }), /RAW_CALENDAR/],
    [({ chunks }) => { chunks.BTC.rows[0].openTime /= 1000; }, /RETAINED_CALENDAR/],
    [({ chunks }) => { chunks.BTC.rows[0].closeTime++; }, /RETAINED_CALENDAR/],
    [({ inputTemplate }) => { inputTemplate.quoteCurrency = 'USDT'; }, /KRAKEN_USD_ONLY/],
    [({ inputTemplate }) => { inputTemplate.collection.fxConversion = true; }, /KRAKEN_USD_ONLY/],
    [({ inputTemplate }) => { inputTemplate.collection.instruments.BTC.base = 'ETH'; }, /WRONG_INSTRUMENT/],
    [({ chunks }) => { chunks.BTC.rawResponse.url = 'https://evil.test/0/public/OHLC'; }, /WRONG_SOURCE_URL/],
    [({ chunks }) => { chunks.BTC.rawResponse.url += '&pair=ETHUSD'; }, /WRONG_OHLC_REQUEST/],
    [({ chunks }) => changeRaw(chunks, (r, j) => { j.error = ['EGeneral']; }), /KRAKEN_ERROR/]
  ];
  for (const [mutate, error] of cases) {
    const args = await fixture(t, mutate);
    await assert.rejects(exportArenaFreqtrade(args), error);
    await assert.rejects(readdir(args.outDir), /ENOENT/);
  }
});
test('rejects oversized and invalid UTF-8 source files', async t => {
  const args = await fixture(t);
  await writeFile(join(args.sourceDir, 'manifest.json'), ' '.repeat(262145));
  await assert.rejects(prepareFreqtradeExport(args.sourceDir), /SOURCE_FILE_TOO_LARGE/);
  await writeFile(join(args.sourceDir, 'manifest.json'), Buffer.from([0xff]));
  await assert.rejects(prepareFreqtradeExport(args.sourceDir));
});
test('stored Kraken snapshot converts 3200 candles without running a strategy or using network', async () => {
  const dir = fileURLToPath(new URL('../research/results/strategy-arena-20261016/', import.meta.url));
  const { files, manifest } = await prepareFreqtradeExport(dir);
  assert.equal(manifest.arenaInputSha256, 'decf35415605bda739d08e9ac489951c21f5428d6b5f6362bd6e77abf265c473');
  assert.equal(manifest.files.reduce((n, f) => n + f.rows, 0), 3200);
  const source = JSON.parse(await readFile(join(dir, 'BTC.json')));
  const raw = JSON.parse(source.rawResponse.body).result.XXBTZUSD;
  const exported = JSON.parse(files['BTC_USD-1d.json']);
  assert.equal(exported[0][5], Number(raw.find(r => r[0] * 1000 === exported[0][0])[6]));
  assert.equal(manifest.comparisonExecuted, false);
});

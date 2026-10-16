// Read-only dataset handoff audit. Does not import/evaluate any strategy.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root = new URL('./core-history-20241013/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const DAY = 86400000;
const assets = [];
assert.deepEqual(manifest.assets.map(a => a.symbol), ['BTC', 'ETH']);
assert.equal(manifest.executionAuthorized, false);
assert.equal(manifest.historicalAvailabilityVerified, false);
for (const expected of manifest.assets) {
  assert.equal(expected.file, `${expected.symbol}.json`);
  const bytes = readFileSync(new URL(expected.file, root));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, expected.sha256, 'source hash mismatch');
  const data = JSON.parse(bytes);
  assert.equal(data.symbol, expected.symbol);
  assert.equal(data.availabilityMeaning, 'CURRENT_ARCHIVE_RECEIPT_NOT_HISTORICAL_PUBLICATION');
  assert(Number.isSafeInteger(data.availableAtMs) && data.availableAtMs >= 0);
  assert.equal(data.rows.length, 652);
  assert.equal(data.rows.length, expected.rows);
  assert.equal(data.rows[0][0], Date.parse('2023-01-01T00:00:00Z'));
  assert.equal(data.rows.at(-1)[1], Date.parse('2024-10-14T00:00:00Z'));
  for (let i = 0; i < data.rows.length; i++) {
    const row = data.rows[i];
    assert.equal(row.length, 7);
    const [openMs, closeMs, o, h, l, c, volume] = row;
    assert(Number.isSafeInteger(openMs) && openMs >= 0 && openMs % DAY === 0);
    assert(Number.isSafeInteger(closeMs) && closeMs - openMs === DAY);
    if (i) assert.equal(openMs, data.rows[i-1][1]);
    assert([o,h,l,c].every(x => typeof x === 'number' && Number.isFinite(x) && x > 0));
    assert(h >= Math.max(o,l,c) && l <= Math.min(o,h,c));
    assert(typeof volume === 'number' && Number.isFinite(volume) && volume >= 0);
    assert(data.availableAtMs >= closeMs);
  }
  const ends = data.rows.slice(200).map(row => row[1]);
  assets.push({symbol: data.symbol, sha256, rows: data.rows.length,
    overlapping201BarWindows: ends.length,
    windowsUnreceivedAtHistoricalClose: ends.filter(t => data.availableAtMs > t).length,
    windowsStaleAtArchiveReceipt: ends.filter(t => data.availableAtMs - t >= DAY).length,
    firstWindowExclusiveCloseMs: ends[0], lastWindowExclusiveCloseMs: ends.at(-1),
    archiveReceiptMs: data.availableAtMs});
}
console.log(JSON.stringify({schema: 'CORE_HANDOFF_AUDIT_V1', dataShapePass: true,
  historicalReplayReady: false, strategyEvaluated: false, executionAuthorized: false,
  availabilityMode: 'ACTUAL_ARCHIVE_RECEIPT', assets,
  limitations: ['Overlapping windows are not independent samples.',
    'No strategy call, signal count, trades or PnL.',
    'An archive receipt does not establish historical publication or revision timing.',
    'BTC/ETH engineering references do not establish historical Top20 eligibility.']}, null, 2));

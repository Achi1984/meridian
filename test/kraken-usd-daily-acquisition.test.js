import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  crc32,
  expectedNormalizedRows,
  parseRawCsv,
  readChunks,
  verifyAcquisition,
  verifyPair
} from '../scripts/verify-kraken-usd-daily-acquisition.mjs';

const root = new URL('../research/acquisitions/kraken-usd-daily-20261018/', import.meta.url);
const receipt = JSON.parse(fs.readFileSync(new URL('acquisition-receipt.json', root), 'utf8'));
const pinnedHashes = {
  full: {
    XBTUSD: '27fd91e9528d421c606ff7cd37bf3b8a4eed3b39631beb09ac8aec36a9b69266',
    ETHUSD: '63f81fbd846bf54f7a55e4ac98e8da42bd419ebbf70227fbf15272add46cec63',
    SOLUSD: '6f4f69714095aa26c673b2d7002ee56ef7efe76d07fc5f946d1906ce41cb825e',
    XRPUSD: '479cd9e37cd8de2eb4a3ad3de8ed1a224c6d8139dc5ac6cea1a02f061ff48c26',
    HBARUSD: 'a1e1165f0a64f02d4f64efec211edce659e166b88c361af9c14939ebee6cf2ba',
    LINKUSD: 'eade8ae89b763e953b5a3275e82eb036d241e2501b5b1f808d85654228d01f70',
    AVAXUSD: 'b9027724c29a7362befe1526fd8a0954c9133aa35555c065b392e02233334a94',
    SUIUSD: '59511daffc2a7eff2ea43c4d8482140082fe85ebe22aeb47f15b0e5048f43700'
  },
  q3: {
    XBTUSD: '5f90718045dc8531408bc88974908080b9a26bbc23eec5f506b3069911e6fc07',
    ETHUSD: '8c9e6de30dedf532ce806486e12f531fa81721ed8a383006234ec3662262a009',
    SOLUSD: 'b57d1dd5bcb55e3c9e0cdb26cf4f8031912296e769fd3df5064169d3bc8aa5aa',
    XRPUSD: 'ae60fc541880174c78e05dbddb04459b84fd3428b289f31f5c89526906beb0c4',
    HBARUSD: 'c7f70c7195d0ed0fe1fab2b3b0d19d1ad8a52223702ba45671fa55e67249bf8f',
    LINKUSD: '80c335a10f5fa5633374e2c663de0f3073b6e0851a6ac3dae742dce749027f8c',
    AVAXUSD: '2ed173e2d2c7e4a280c8f522d156c7246e018c8e35c9e2e6e617ed9128c05329',
    SUIUSD: 'a830f0f62e5b8877fb072b3e4619c2a7cc1c421aa6505cd6245dbfd408ac3275'
  },
  normalized: {
    XBTUSD: 'f2e94a03fbe61f37295b2249d5c3a4d324d13fcfb5d5b41f2ed4d7dfe2183bb9',
    ETHUSD: 'fbb7915af33d3c32db1cf368a171ed633090406c39da38aae90ac0d3876754bb',
    SOLUSD: 'caff8ea08d3548b2d8c704cc17a940754a70e23f60e44716324c464929bc18ca',
    XRPUSD: 'bd006dfcbf052fb516e2d5e5a97d0570cf093e577c3c83752f2f3b7310fc52a7',
    HBARUSD: '4f30287edf98f90a2a185fe38acaa0e5a2819c340b4a33c014fc1aa62a914447',
    LINKUSD: '82682634f645ab5ca1dac4065cc0d490d343ea24b61463bcc2b6406894785518',
    AVAXUSD: 'a4350bf73b44a45770bb173541133e4a04e847a07d74231ad6b5bbd7d6d06887',
    SUIUSD: '0b35eb5598a336d8d4485b15adc2a4b4a716c967ff700eff3802386c31beda79'
  },
  xbtChunks: [
    '920953a7b5442e94c60a8b46a4c9cd9b467a2b00752f99f818a10c1f8dc0549c',
    'b3f66148467e42f8fb94d5229978420ae0f588f0b94df3378873b28bce41bb29'
  ]
};

const rawLine = (timestamp, open = 10, high = 12, low = 9, close = 11, volume = 3, trades = 4) =>
  `${timestamp},${open},${high},${low},${close},${volume},${trades}`;
const normalized = lines => Buffer.from(
  `timestamp_utc,open,high,low,close,volume,trades\n${lines.map(line => {
    const [timestamp, ...fields] = line.split(',');
    return `${new Date(Number(timestamp) * 1000).toISOString().replace('.000Z', 'Z')},${fields.join(',')}`;
  }).join('\n')}\n`
);
const csv = (...lines) => Buffer.from(`${lines.join('\n')}\n`);

function fixture(fullLines, q3Lines, normalizedLines = [...new Set([...fullLines, ...q3Lines])]) {
  return {
    full: csv(...fullLines),
    q3: csv(...q3Lines),
    normalized: normalized(normalizedLines)
  };
}

test('pinned committed acquisition bytes pass complete offline verification', () => {
  const result = verifyAcquisition();
  assert.equal(result.schema, 'MERIDIAN_KRAKEN_USD_DAILY_OFFLINE_VERIFICATION_V1');
  assert.equal(result.status, 'CONTENT_VERIFIED_OFFLINE');
  assert.equal(result.checks.safeContainedRegularFiles, 25);
  assert.equal(result.checks.rawMembersAndChunks, 16);
  assert.equal(result.checks.normalizedSeries, 8);
  assert.equal(result.checks.exactOverlappingRows, 736);
  assert.equal(result.checks.independentlyReproducedNormalizedRows, 15372);
  assert.equal(result.commonCoverage.commonCloses, 448);
  assert.equal(result.commonCoverage.targetMet, false);
  assert.equal(result.pairs.HBARUSD.firstSelectedUtc, '2025-07-10T00:00:00Z');
  assert.equal(result.pairs.HBARUSD.lastSelectedUtc, '2026-09-30T00:00:00Z');
  assert.equal(result.pairs.XBTUSD.sourceGaps.missingDays, 12);
  assert.equal(result.pairs.ETHUSD.sourceGaps.missingDays, 6);
  assert.equal(result.pairs.XRPUSD.sourceGaps.missingDays, 1);
  assert.ok(Object.values(result.pairs).every(pair => pair.gaps.missingDays === 0));
  assert.equal(result.budget.requestsAttempted, 27);
  assert.equal(result.budget.httpResponses, 24);
  assert.equal(result.budget.bodyBytes, 3747305);
  assert.equal(result.receiptAssertionsOnly.sourceAuthenticity, 'NOT_ESTABLISHED');
  assert.equal(result.receiptAssertionsOnly.archiveUrlAndHTTPResponses, 'RECEIPT_ONLY_NOT_INDEPENDENTLY_AUTHENTICATED');

  for (const pair of receipt.pairs) {
    for (const archive of ['full', 'q3']) {
      assert.equal(receipt.capture.rawMembers[archive][`${pair}_1440.csv`].wholeMemberSHA256, pinnedHashes[archive][pair]);
    }
    assert.equal(receipt.capture.coverage[pair].normalizedChunks[0].sha256, pinnedHashes.normalized[pair]);
  }
  assert.deepEqual(
    receipt.capture.rawMembers.full['XBTUSD_1440.csv'].chunks.map(chunk => chunk.sha256),
    pinnedHashes.xbtChunks
  );
});

test('altered chunk bytes fail their pinned digest and reconstructed member hash', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kraken-offline-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const data = Buffer.from('one,two\n');
  fs.writeFileSync(path.join(directory, 'member.csv'), data);
  const entry = {
    wholeMemberBytes: data.length,
    wholeMemberSHA256: crypto.createHash('sha256').update(data).digest('hex'),
    zipCRC32: crc32(data),
    chunks: [{
      file: 'member.csv',
      bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex')
    }]
  };
  fs.writeFileSync(path.join(directory, 'member.csv'), Buffer.from('xne,two\n'));
  assert.throws(() => readChunks(directory, entry, 'fixture'), /chunk length\/hash mismatch/);
});

test('raw parsing rejects duplicate and out-of-order timestamps', () => {
  const first = 1735689600;
  for (const lines of [
    [rawLine(first), rawLine(first)],
    [rawLine(first + 86400), rawLine(first)]
  ]) {
    assert.throws(() => parseRawCsv(csv(...lines), 'fixture'), /duplicate or out-of-order/);
  }
});

test('raw parsing rejects invalid OHLC bounds and non-finite values', () => {
  const first = 1735689600;
  assert.throws(() => parseRawCsv(csv(rawLine(first, 10, 8, 9, 11)), 'fixture'), /invalid OHLC bounds/);
  assert.throws(() => parseRawCsv(csv(rawLine(first, 'NaN')), 'fixture'), /invalid numeric field/);
});

test('overlapping Full and Q3 rows must agree byte-for-byte', () => {
  const first = 1735689600;
  const full = [rawLine(first), rawLine(first + 86400)];
  const q3 = [rawLine(first + 86400, 10, 13, 9, 11), rawLine(first + 172800)];
  const data = fixture(full, q3);
  assert.throws(() => verifyPair('TESTUSD', data.full, data.q3, [data.normalized]), /conflicting Full\/Q3 overlap/);
});

test('normalized rows must be independently reproducible from source rows', () => {
  const first = 1735689600;
  const full = [rawLine(first), rawLine(first + 86400)];
  const q3 = [rawLine(first + 86400), rawLine(first + 172800)];
  const correct = fixture(full, q3);
  const wrong = normalized([full[0], q3[0], rawLine(first + 172800, 10, 14, 9, 11)]);
  assert.throws(() => verifyPair('TESTUSD', correct.full, correct.q3, [wrong]), /normalized rows differ/);
  assert.equal(expectedNormalizedRows(
    parseRawCsv(correct.full, 'fixture/full'),
    '2025-01-02T23:59:59Z',
    1
  ).length, 1);
});

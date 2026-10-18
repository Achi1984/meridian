import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PAIRS = ['XBTUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'HBARUSD', 'LINKUSD', 'AVAXUSD', 'SUIUSD'];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../research/acquisitions/kraken-usd-daily-20261018');
const RECEIPT_PATH = path.join(ROOT, 'acquisition-receipt.json');
const OUTPUT_PATH = path.join(ROOT, 'offline-verification.json');
const FILE_CAP = 262144;
const DAY_SECONDS = 86400;
const EXPECTED_CUTOFF = '2026-09-30T23:59:59Z';
const EXPECTED_FORMAT = 'timestamp_utc,open,high,low,close,volume,trades';
const NUMBER_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

function safeFile(root, relativePath, maxBytes = FILE_CAP) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) ||
      relativePath.includes('\\') || relativePath.split('/').some(part => !part || part === '.' || part === '..')) {
    fail(`unsafe artifact path: ${relativePath}`);
  }
  const absolute = path.resolve(root, relativePath);
  const rel = path.relative(root, absolute);
  if (!rel || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) fail(`artifact path escaped root: ${relativePath}`);
  let cursor = root;
  for (const component of rel.split(path.sep)) {
    cursor = path.join(cursor, component);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) fail(`symlink artifact path: ${relativePath}`);
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.size > maxBytes) fail(`artifact is not a bounded regular file: ${relativePath}`);
  return fs.readFileSync(absolute);
}

function isoFromEpoch(seconds) {
  return new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');
}

function parseRawCsv(bytes, label) {
  const text = bytes.toString('ascii');
  if (Buffer.from(text, 'ascii').compare(bytes) !== 0) fail(`${label}: non-ASCII CSV`);
  if (!text.endsWith('\n') || text.includes('\r')) fail(`${label}: expected LF-terminated rows`);
  const lines = text.slice(0, -1).split('\n');
  if (lines.some(line => !line)) fail(`${label}: blank CSV row`);
  const rows = [];
  let previous = -Infinity;
  for (let index = 0; index < lines.length; index += 1) {
    const fields = lines[index].split(',');
    if (fields.length !== 7) fail(`${label} row ${index + 1}: expected seven fields`);
    if (!/^(0|[1-9]\d*)$/.test(fields[0])) fail(`${label} row ${index + 1}: invalid timestamp`);
    const timestamp = Number(fields[0]);
    if (!Number.isSafeInteger(timestamp) || timestamp > 8640000000000 || timestamp % DAY_SECONDS !== 0) {
      fail(`${label} row ${index + 1}: timestamp is not a valid UTC day boundary`);
    }
    if (timestamp <= previous) fail(`${label} row ${index + 1}: duplicate or out-of-order timestamp`);
    previous = timestamp;
    if (fields.slice(1, 6).some(field => !NUMBER_PATTERN.test(field))) fail(`${label} row ${index + 1}: invalid numeric field`);
    const numeric = fields.slice(1, 6).map(Number);
    if (!numeric.every(Number.isFinite)) fail(`${label} row ${index + 1}: non-finite numeric field`);
    const [open, high, low, close, volume] = numeric;
    if (![open, high, low, close].every(value => value > 0)) fail(`${label} row ${index + 1}: non-positive OHLC`);
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) fail(`${label} row ${index + 1}: invalid OHLC bounds`);
    if (volume < 0) fail(`${label} row ${index + 1}: negative volume`);
    if (!/^(0|[1-9]\d*)$/.test(fields[6]) || !Number.isSafeInteger(Number(fields[6]))) {
      fail(`${label} row ${index + 1}: invalid integer trade count`);
    }
    rows.push({timestamp, line: lines[index], fields});
  }
  return rows;
}

function mergeRows(fullRows, q3Rows, label = 'pair') {
  const fullByTime = new Map(fullRows.map(row => [row.timestamp, row]));
  const q3ByTime = new Map(q3Rows.map(row => [row.timestamp, row]));
  let overlapRows = 0;
  for (const [timestamp, full] of fullByTime) {
    const q3 = q3ByTime.get(timestamp);
    if (q3) {
      overlapRows += 1;
      if (full.line !== q3.line) fail(`${label}: conflicting Full/Q3 overlap at ${timestamp}`);
    }
  }
  const merged = [];
  let fullIndex = 0;
  let q3Index = 0;
  while (fullIndex < fullRows.length || q3Index < q3Rows.length) {
    const full = fullRows[fullIndex];
    const q3 = q3Rows[q3Index];
    if (!q3 || (full && full.timestamp < q3.timestamp)) {
      merged.push(full);
      fullIndex += 1;
    } else if (!full || q3.timestamp < full.timestamp) {
      merged.push(q3);
      q3Index += 1;
    } else {
      merged.push(full);
      fullIndex += 1;
      q3Index += 1;
    }
  }
  for (let index = 1; index < merged.length; index += 1) {
    if (merged[index].timestamp <= merged[index - 1].timestamp) fail(`${label}: merged source is not strictly ordered`);
  }
  return {rows: merged, overlapRows};
}

function expectedNormalizedRows(rows, cutoff = EXPECTED_CUTOFF, maximum = 2500) {
  const cutoffMs = Date.parse(cutoff);
  if (!Number.isFinite(cutoffMs)) fail('invalid cutoff');
  const cutoffSeconds = Math.floor(cutoffMs / 1000);
  return rows.filter(row => row.timestamp <= cutoffSeconds).slice(-maximum).map(row => {
    const fields = row.fields;
    return `${isoFromEpoch(row.timestamp)},${fields.slice(1).join(',')}`;
  });
}

function parseNormalized(chunks, label) {
  const rows = [];
  let previous = -Infinity;
  for (const [chunkIndex, bytes] of chunks.entries()) {
    const text = bytes.toString('ascii');
    if (!text.endsWith('\n') || text.includes('\r')) fail(`${label}: malformed normalized line endings`);
    const lines = text.slice(0, -1).split('\n');
    if (lines.shift() !== EXPECTED_FORMAT) fail(`${label}: normalized header mismatch`);
    for (const [lineIndex, line] of lines.entries()) {
      const fields = line.split(',');
      if (fields.length !== 7) fail(`${label} chunk ${chunkIndex + 1} row ${lineIndex + 1}: expected seven fields`);
      const date = new Date(fields[0]);
      if (!Number.isFinite(date.getTime()) || date.toISOString().replace('.000Z', 'Z') !== fields[0]) {
        fail(`${label}: normalized timestamp is not canonical UTC`);
      }
      const timestamp = date.getTime() / 1000;
      if (timestamp % DAY_SECONDS !== 0 || timestamp <= previous) fail(`${label}: normalized rows are duplicate or out of order`);
      previous = timestamp;
      if (fields.slice(1, 6).some(field => !NUMBER_PATTERN.test(field))) fail(`${label}: invalid numeric field`);
      const [open, high, low, close, volume] = fields.slice(1, 6).map(Number);
      const trades = fields[6];
      if (![open, high, low, close, volume].every(Number.isFinite) || [open, high, low, close].some(value => value <= 0) ||
          high < Math.max(open, close, low) || low > Math.min(open, close, high) || volume < 0 ||
          !/^(0|[1-9]\d*)$/.test(trades) || !Number.isSafeInteger(Number(trades))) {
        fail(`${label}: invalid normalized values`);
      }
      rows.push(line);
    }
  }
  return rows;
}

function calculateGaps(timestamps) {
  const ranges = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const missingDays = (timestamps[index] - timestamps[index - 1]) / DAY_SECONDS - 1;
    if (missingDays > 0) {
      ranges.push({
        from: isoFromEpoch(timestamps[index - 1] + DAY_SECONDS).slice(0, 10),
        through: isoFromEpoch(timestamps[index] - DAY_SECONDS).slice(0, 10),
        missingDays
      });
    }
  }
  return {
    missingDays: ranges.reduce((sum, range) => sum + range.missingDays, 0),
    gapIntervals: ranges.length,
    largestGapDays: Math.max(0, ...ranges.map(range => range.missingDays)),
    ranges
  };
}

function readChunks(root, entry, label, fileResults = []) {
  if (!Array.isArray(entry.chunks) || !entry.chunks.length) fail(`${label}: missing chunks`);
  const chunks = [];
  for (const chunk of entry.chunks) {
    const bytes = safeFile(root, chunk.file);
    if (bytes.length !== chunk.bytes || sha256(bytes) !== chunk.sha256) fail(`${label}: chunk length/hash mismatch: ${chunk.file}`);
    fileResults.push({path: chunk.file, bytes: bytes.length, sha256: sha256(bytes)});
    chunks.push(bytes);
  }
  const joined = Buffer.concat(chunks);
  if (joined.length !== entry.wholeMemberBytes || sha256(joined) !== entry.wholeMemberSHA256) {
    fail(`${label}: reconstructed member length/hash mismatch`);
  }
  if (crc32(joined) !== entry.zipCRC32.toLowerCase()) fail(`${label}: ZIP CRC mismatch`);
  return joined;
}

function verifyPair(pair, fullBytes, q3Bytes, normalizedChunks, options = {}) {
  const cutoff = options.cutoff ?? EXPECTED_CUTOFF;
  const maximum = options.maximum ?? 2500;
  const fullRows = parseRawCsv(fullBytes, `${pair}/full`);
  const q3Rows = parseRawCsv(q3Bytes, `${pair}/q3`);
  const merged = mergeRows(fullRows, q3Rows, pair);
  const expected = expectedNormalizedRows(merged.rows, cutoff, maximum);
  const actual = parseNormalized(normalizedChunks, pair);
  if (actual.length > maximum) fail(`${pair}: normalized maximum exceeded`);
  if (actual.length !== expected.length || actual.some((line, index) => line !== expected[index])) {
    fail(`${pair}: normalized rows differ from independently derived source rows`);
  }
  const selectedTimestamps = merged.rows
    .filter(row => row.timestamp <= Math.floor(Date.parse(cutoff) / 1000))
    .slice(-maximum)
    .map(row => row.timestamp);
  return {
    fullRows: fullRows.length,
    q3Rows: q3Rows.length,
    overlapRows: merged.overlapRows,
    normalizedRows: actual.length,
    firstQ3Utc: isoFromEpoch(q3Rows[0].timestamp),
    lastQ3Utc: isoFromEpoch(q3Rows.at(-1).timestamp),
    firstObservedUtc: isoFromEpoch(merged.rows[0].timestamp),
    lastObservedUtc: isoFromEpoch(merged.rows.at(-1).timestamp),
    startUtc: actual.length ? actual[0].slice(0, 20) + 'Z' : null,
    endUtc: actual.length ? actual.at(-1).slice(0, 20) + 'Z' : null,
    gaps: calculateGaps(selectedTimestamps),
    sourceGaps: calculateGaps(merged.rows.map(row => row.timestamp)),
    commonTimestamps: selectedTimestamps
  };
}

function requireEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label}: receipt does not match independently observed value`);
}

function verifyBudget(receipt) {
  const budget = receipt.budget;
  const prior = receipt.priorProbes;
  const headCount = receipt.archives.full.parts.length + 1;
  const tailCount = 2;
  const memberRanges = receipt.rangeRequests;
  const requestsAttempted = prior.reduce((sum, probe) => sum + probe.attempts, 0) + headCount + tailCount + memberRanges.length;
  const responses = prior.reduce((sum, probe) => sum + probe.httpResponses, 0) +
    receipt.archives.full.parts.filter(part => part.headStatus !== undefined).length +
    (receipt.archives['2026Q3'].headStatus !== undefined ? 1 : 0) +
    (receipt.archives.full.tailRange.status !== undefined ? 1 : 0) +
    (receipt.archives['2026Q3'].tailRangeStatus !== undefined ? 1 : 0) +
    memberRanges.filter(range => range.status !== undefined).length;
  const bytes = prior.reduce((sum, probe) => sum + probe.bodyBytes, 0) +
    receipt.archives.full.tailRange.bytes + receipt.archives['2026Q3'].tailRangeBytes +
    memberRanges.reduce((sum, range) => sum + range.bodyBytes, 0);
  if (receipt.archives.full.parts.some(part => part.headStatus !== 200 || part.acceptRanges !== 'bytes') ||
      receipt.archives['2026Q3'].headStatus !== 200 ||
      receipt.archives.full.tailRange.status !== 206 || receipt.archives['2026Q3'].tailRangeStatus !== 206) {
    fail('archive metadata/range status receipt is incomplete');
  }
  for (const [range, length] of [
    [receipt.archives.full.tailRange.range, receipt.archives.full.tailRange.bytes],
    [receipt.archives['2026Q3'].tailRange, receipt.archives['2026Q3'].tailRangeBytes]
  ]) {
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    if (!match || Number(match[2]) - Number(match[1]) + 1 !== length ||
        Number(match[3]) !== (range === receipt.archives.full.tailRange.range
          ? receipt.archives.full.parts.find(part => part.part === receipt.archives.full.tailRange.part).contentLength
          : receipt.archives['2026Q3'].contentLength)) {
      fail(`archive directory range byte accounting is inconsistent: ${range}`);
    }
  }
  if (requestsAttempted !== budget.requestsAttempted || responses !== budget.httpResponses || bytes !== budget.bodyBytes) {
    fail('budget counters do not reconcile to stored request metadata');
  }
  if (requestsAttempted > budget.maxRequests || bytes > budget.maxBodyBytes) fail('request or byte limit exceeded');
  const elapsedSeconds = (Date.parse(receipt.completedAt) - Date.parse(budget.conservativeFirstProbeAt)) / 1000;
  const deadlineSeconds = (Date.parse(budget.deadlineNoLaterThan) - Date.parse(budget.conservativeFirstProbeAt)) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > budget.maxWallSeconds ||
      elapsedSeconds > deadlineSeconds || budget.actualDeadlineMet !== true ||
      Math.abs(elapsedSeconds - budget.conservativeElapsedSeconds) > 0.001) {
    fail('conservative wall-time bound or original deadline check failed');
  }
  if (memberRanges.length !== PAIRS.length * 2) fail('member range response count is incomplete');
  const expectedMembers = new Set(PAIRS.flatMap(pair => [`full:${pair}_1440.csv`, `q3:${pair}_1440.csv`]));
  if (new Set(memberRanges.map(range => `${range.archive}:${range.member}`)).size !== expectedMembers.size ||
      memberRanges.some(range => !expectedMembers.has(`${range.archive}:${range.member}`))) {
    fail('selected member request list does not match the eight-pair scope');
  }
  for (const range of memberRanges) {
    const requested = /^bytes=(\d+)-(\d+)$/.exec(range.rangeRequested);
    const received = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range.rangeReceived ?? '');
    if (!requested || !received || requested[1] !== received[1] || requested[2] !== received[2] ||
        range.status !== 206 || range.curlExit !== 0 || range.curlElapsedSeconds !== null ||
        range.bodyBytes !== Number(requested[2]) - Number(requested[1]) + 1) {
      fail(`member range response evidence is inconsistent: ${range.member}`);
    }
    const archive = range.archive === 'q3' ? receipt.archives['2026Q3'] :
      receipt.archives.full.parts.find(part => range.url === part.url);
    if (!archive || (range.archive === 'q3' && range.url !== receipt.archives['2026Q3'].url) ||
        range.etag !== archive.etag || range.lastModified !== archive.lastModified ||
        Number(received[3]) !== archive.contentLength ||
        !range.url.startsWith('https://assets.kraken.com/marketing/institutions/')) {
      fail(`member range source identity receipt mismatch: ${range.member}`);
    }
  }
  return {
    requestsAttempted,
    httpResponses: responses,
    bodyBytes: bytes,
    elapsedSeconds,
    deadlineSeconds,
    memberRangeRequests: memberRanges.length
  };
}

function verifyAcquisition({root = ROOT, receipt = JSON.parse(fs.readFileSync(path.join(root, 'acquisition-receipt.json'), 'utf8'))} = {}) {
  if (receipt.status !== 'CAPTURED_VALIDATED_COVERAGE_LIMITED' ||
      receipt.cutoffInclusive !== EXPECTED_CUTOFF || receipt.maxBarsPerAsset !== 2500 || receipt.intervalMinutes !== 1440 ||
      JSON.stringify(receipt.pairs) !== JSON.stringify(PAIRS)) fail('unexpected acquisition scope/status');
  const rootPath = fs.realpathSync(root);
  const fileResults = [];
  const pairResults = {};
  const actualNormalizedFiles = [];
  const normalizedFileRows = new Map();
  for (const pair of PAIRS) {
    const raw = {};
    for (const archive of ['full', 'q3']) {
      const memberName = `${pair}_1440.csv`;
      const member = receipt.capture.rawMembers[archive === 'q3' ? 'q3' : 'full'][memberName];
      if (!member) fail(`${archive}/${memberName}: receipt member missing`);
      raw[archive] = readChunks(rootPath, member, `${archive}/${memberName}`, fileResults);
      if (receipt.capture.rawSha256[pair]?.[archive === 'q3' ? 'q3' : 'full'] !== member.wholeMemberSHA256) {
        fail(`${archive}/${memberName}: raw hash pointer mismatch`);
      }
    }
    const coverage = receipt.capture.coverage[pair];
    if (!coverage || !Array.isArray(coverage.normalizedChunks) || !coverage.normalizedChunks.length) {
      fail(`${pair}: normalized receipt entries missing`);
    }
    const normalizedChunks = coverage.normalizedChunks.map(chunk => {
      const bytes = safeFile(rootPath, chunk.file);
      if (bytes.length !== chunk.bytes || bytes.length > FILE_CAP || sha256(bytes) !== chunk.sha256) {
        fail(`${pair}: normalized file length/hash mismatch: ${chunk.file}`);
      }
      fileResults.push({path: chunk.file, bytes: bytes.length, sha256: sha256(bytes)});
      actualNormalizedFiles.push(chunk.file);
      normalizedFileRows.set(chunk.file, bytes.toString('ascii').split('\n').length - 2);
      return bytes;
    });
    const result = verifyPair(pair, raw.full, raw.q3, normalizedChunks, {
      cutoff: receipt.cutoffInclusive,
      maximum: receipt.maxBarsPerAsset
    });
    if (result.fullRows !== receipt.capture.sourceCoverage[pair].full.rows ||
        raw.full.length !== receipt.capture.sourceCoverage[pair].full.bytes ||
        result.q3Rows !== receipt.capture.sourceCoverage[pair].q3.rows ||
        raw.q3.length !== receipt.capture.sourceCoverage[pair].q3.bytes ||
        result.overlapRows !== receipt.capture.sourceCoverage[pair].overlapRows ||
        result.normalizedRows !== coverage.normalizedRows ||
        Date.parse(result.firstObservedUtc) !== Date.parse(receipt.capture.sourceCoverage[pair].full.first) ||
        Date.parse(result.lastObservedUtc) !== Date.parse(receipt.capture.sourceCoverage[pair].full.last) ||
        Date.parse(result.firstQ3Utc) !== Date.parse(receipt.capture.sourceCoverage[pair].q3.first) ||
        Date.parse(result.lastQ3Utc) !== Date.parse(receipt.capture.sourceCoverage[pair].q3.last)) {
      fail(`${pair}: independently observed content does not match coverage receipt`);
    }
    const selectedRows = expectedNormalizedRows(
      mergeRows(parseRawCsv(raw.full, `${pair}/full`), parseRawCsv(raw.q3, `${pair}/q3`), pair).rows,
      receipt.cutoffInclusive,
      receipt.maxBarsPerAsset
    );
    const firstSelectedDate = selectedRows[0]?.slice(0, 10) ?? null;
    const lastSelectedDate = selectedRows.at(-1)?.slice(0, 10) ?? null;
    if (coverage.startUtc?.slice(0, 10) !== firstSelectedDate ||
        coverage.endUtc?.slice(0, 10) !== lastSelectedDate) fail(`${pair}: normalized coverage dates mismatch`);
    requireEqual(result.gaps, coverage.gaps, `${pair} gaps`);
    requireEqual(result.gaps, receipt.capture.gaps[pair], `${pair} capture gaps`);
    result.startUtc = coverage.startUtc;
    result.endUtc = coverage.endUtc;
    result.firstSelectedUtc = selectedRows.length ? `${selectedRows[0].slice(0, 20)}Z` : null;
    result.lastSelectedUtc = selectedRows.length ? `${selectedRows.at(-1).slice(0, 20)}Z` : null;
    delete result.commonTimestamps;
    pairResults[pair] = result;
  }
  const common = PAIRS.map(pair => {
    const rows = parseNormalized(
      receipt.capture.coverage[pair].normalizedChunks.map(chunk => safeFile(rootPath, chunk.file)),
      `${pair}/common`
    );
    return new Set(rows.map(row => Date.parse(row.split(',')[0]) / 1000));
  });
  const commonTimestamps = [...common[0]].filter(timestamp => common.slice(1).every(set => set.has(timestamp))).sort((a, b) => a - b);
  const commonReport = {
    commonCloses: commonTimestamps.length,
    startUtc: commonTimestamps.length ? isoFromEpoch(commonTimestamps[0]) : null,
    endUtc: commonTimestamps.length ? isoFromEpoch(commonTimestamps.at(-1)) : null,
    gaps: calculateGaps(commonTimestamps),
    targetForLaterResearch: 955,
    targetMet: commonTimestamps.length >= 955
  };
  requireEqual(commonReport, receipt.capture.commonCoverage, 'common coverage');
  const normalizedRows = Object.values(pairResults).reduce((sum, result) => sum + result.normalizedRows, 0);
  const reportedNormalizedFiles = receipt.capture.normalizedFiles.map(entry => ({
    path: entry.file,
    bytes: entry.bytes,
    sha256: entry.sha256,
    rows: entry.rows
  }));
  const observedNormalizedFiles = actualNormalizedFiles.map(file => {
    const entry = fileResults.find(result => result.path === file);
    return {path: file, bytes: entry.bytes, sha256: entry.sha256, rows: normalizedFileRows.get(file)};
  });
  if (receipt.capture.rawTotalBytes !== Object.values(receipt.capture.rawMembers)
    .reduce((sum, archive) => sum + Object.values(archive).reduce((assetSum, member) => assetSum + member.wholeMemberBytes, 0), 0) ||
      receipt.capture.normalizedTotalRows !== normalizedRows ||
      JSON.stringify(observedNormalizedFiles) !== JSON.stringify(reportedNormalizedFiles)) {
    fail('capture totals or normalized file list do not reconcile');
  }
  const budget = verifyBudget(receipt);
  const receiptAssertionsOnly = {
    archiveUrlAndHTTPResponses: 'RECEIPT_ONLY_NOT_INDEPENDENTLY_AUTHENTICATED',
    sourceETagLastModifiedAndIdentityConsistency: 'RECEIPT_ONLY_NOT_INDEPENDENTLY_AUTHENTICATED',
    originalNetworkRequestAndBodyCounters: 'RECONCILED_FROM_RECEIPT_METADATA_NOT_NETWORK_REPLAY',
    sourceAuthenticity: 'NOT_ESTABLISHED',
    fullArchiveSha256: 'NOT_VERIFIED',
    officialChecksumManifest: 'NOT_FETCHED'
  };
  const rawMembers = Object.fromEntries(PAIRS.map(pair => [pair, Object.fromEntries(['full', 'q3'].map(archive => {
    const member = receipt.capture.rawMembers[archive][`${pair}_1440.csv`];
    return [archive, {
      bytes: member.wholeMemberBytes,
      sha256: member.wholeMemberSHA256,
      crc32: member.zipCRC32
    }];
  }))]));
  return {
    schema: 'MERIDIAN_KRAKEN_USD_DAILY_OFFLINE_VERIFICATION_V1',
    status: 'CONTENT_VERIFIED_OFFLINE',
    acquisitionStatus: receipt.status,
    verifiedFiles: fileResults,
    checks: {
      safeContainedRegularFiles: fileResults.length,
      rawMembersAndChunks: PAIRS.length * 2,
      normalizedSeries: PAIRS.length,
      sourceRowsParsed: Object.values(pairResults).reduce((sum, result) => sum + result.fullRows + result.q3Rows, 0),
      exactOverlappingRows: Object.values(pairResults).reduce((sum, result) => sum + result.overlapRows, 0),
      independentlyReproducedNormalizedRows: normalizedRows,
      budget: 'RECONCILED_WITHIN_ORIGINAL_LIMITS'
    },
    rawMembers,
    pairs: pairResults,
    commonCoverage: commonReport,
    budget,
    receiptAssertionsOnly,
    limitations: [
      '448 common daily closes are below the desired 955; HBARUSD observed history begins 2025-07-10.',
      'Full archive members extend through 2026-09-30 although supplied archive-page summary stated 2026-06-30; matching 92-row overlap per pair is content-verified, but the summary discrepancy remains unresolved.',
      'Hashes and ZIP CRCs validate captured bytes/corruption only; no historical source authenticity or full archive checksum is established.',
      'Network status, source identity headers, and request history are receipt assertions only; the offline verifier does not authenticate or replay network events.',
      'No strategy, indicators, returns, evaluator, backtest, or PnL was run.'
    ]
  };
}

function cli() {
  try {
    const report = verifyAcquisition();
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    fs.writeFileSync(OUTPUT_PATH, serialized);
    process.stdout.write(serialized);
  } catch (error) {
    process.stderr.write(`Kraken acquisition verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();

export {
  calculateGaps,
  crc32,
  expectedNormalizedRows,
  mergeRows,
  parseNormalized,
  parseRawCsv,
  readChunks,
  safeFile,
  sha256,
  verifyAcquisition,
  verifyPair
};

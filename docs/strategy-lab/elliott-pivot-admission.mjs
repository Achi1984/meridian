// Trusted JSON data only; no accessors/proxies. Single pivot, not a wave or entry engine.
import {validateClosedBars, pivotConfirmationTime, admitObservationTime} from './elliott-correction-helpers.mjs';

const VERSION = 'ELLIOTT_SINGLE_PIVOT_ADMISSION_DRAFT_V1';
const FLAGS = Object.freeze({
  researchOnly: true, executionAuthorized: false, empiricalRunAuthorized: false,
  historicalAvailabilityVerified: false, revisionHistoryVerified: false,
  receiptAuthenticated: false, dataSourceAuthenticated: false,
  tradingSignal: false, entryFillEstablished: false
});
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, keys) => record(x) && Reflect.ownKeys(x).length === keys.length &&
  keys.every(k => Object.hasOwn(x, k));
const dense = (x, length) => Array.isArray(x) && x.length === length &&
  Reflect.ownKeys(x).length === length + 1 &&
  Array.from({length}, (_, i) => Object.hasOwn(x, i)).every(Boolean);
const fail = error => ({valid: false, error, ...FLAGS});
const BAR_KEYS = ['openTimeMs', 'closeTimeMs', 'open', 'high', 'low', 'close', 'volume'];

export function bindSinglePivotAdmission(input) {
  if (!exact(input, ['schemaVersion', 'assetId', 'timeframe', 'decisionMs',
    'leftBars', 'rightBars', 'bars', 'admission']) || input.schemaVersion !== VERSION ||
    typeof input.assetId !== 'string' || !/^[A-Za-z0-9_.-]{1,40}$/.test(input.assetId) ||
    input.assetId.includes('\n') || !record(input.admission)) return fail('INPUT_SCHEMA');

  const a = input.admission;
  const actual = a.mode === 'ACTUAL_RECEIPT';
  if (!actual && a.mode !== 'ASSUMED_PUBLICATION') return fail('UNSUPPORTED_MODE');
  const admissionKeys = actual ? ['mode', 'receipts'] :
    ['mode', 'assumptionId', 'publicationDelayMs', 'archiveReceipts'];
  if (!exact(a, admissionKeys)) return fail('INPUT_SCHEMA');

  const {leftBars, rightBars, bars, timeframe, decisionMs} = input;
  if (![leftBars, rightBars].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 32) ||
    !dense(bars, leftBars + 1 + rightBars)) return fail('PIVOT_WINDOW');

  // Keep the shared validator's scalar/sequence precedence, including symbol-key rejection.
  if (!['4H', '1D'].includes(timeframe) || !Number.isSafeInteger(decisionMs) || decisionMs < 0)
    return fail('TIME_CONTRACT');
  for (let i = 0; i < bars.length; i++) {
    if (!exact(bars[i], BAR_KEYS)) return fail('BAR_SCHEMA');
    const checked = validateClosedBars({schemaVersion: 'ELLIOTT_CLOSED_BARS_V1',
      timeframe, asOfMs: decisionMs, bars: [bars[i]]});
    if (!checked.valid && checked.error !== 'OHLCV') return fail(checked.error);
    if (i && bars[i].openTimeMs !== bars[i - 1].closeTimeMs) return fail('BAR_SEQUENCE');
    if (!checked.valid) return fail(checked.error);
  }
  const timing = pivotConfirmationTime({schemaVersion: 'ELLIOTT_PIVOT_TIME_V1',
    timeframe, asOfMs: decisionMs, bars, pivotIndex: leftBars, leftBars, rightBars});
  if (!timing.valid) return fail(timing.error);

  const metadata = actual ? a.receipts : a.archiveReceipts;
  const receiptKeys = actual ? ['barIndex', 'openTimeMs', 'receivedAtMs'] :
    ['barIndex', 'openTimeMs', 'archiveRetrievedAtMs'];
  if (!dense(metadata, bars.length)) return fail('RECEIPT_BINDING');
  // Validate every binding before inspecting any receipt scalar or price pattern.
  for (let i = 0; i < metadata.length; i++) {
    if (!exact(metadata[i], receiptKeys) || metadata[i].barIndex !== i ||
      metadata[i].openTimeMs !== bars[i].openTimeMs) return fail('RECEIPT_BINDING');
  }
  let admittedAtMs = 0;
  const assumedPublications = [];
  for (let i = 0; i < bars.length; i++) {
    const common = {schemaVersion: 'ELLIOTT_OBSERVATION_ADMISSION_V1', mode: a.mode,
      geometricConfirmationAtMs: bars[i].closeTimeMs, decisionAtMs: decisionMs};
    const admitted = admitObservationTime(actual ?
      {...common, receivedAtMs: metadata[i].receivedAtMs} :
      {...common, assumptionId: a.assumptionId, publicationDelayMs: a.publicationDelayMs,
        archiveRetrievedAtMs: metadata[i].archiveRetrievedAtMs});
    if (!admitted.valid) return fail(admitted.error);
    const available = actual ? admitted.receivedAtMs : admitted.assumedPublicationAtMs;
    admittedAtMs = Math.max(admittedAtMs, available);
    if (!actual) assumedPublications.push({barIndex: i, openTimeMs: bars[i].openTimeMs,
      assumedPublicationAtMs: available});
  }

  // No price verdict until the entire window has passed admission.
  const candidate = bars[leftBars];
  const left = bars.slice(0, leftBars), right = bars.slice(leftBars + 1);
  const high = left.every(b => candidate.high > b.high) && right.every(b => candidate.high >= b.high);
  const low = left.every(b => candidate.low < b.low) && right.every(b => candidate.low <= b.low);
  if (high && low) return fail('AMBIGUOUS_PIVOT');
  if (!high && !low) return fail('NOT_A_PIVOT');

  const duration = timeframe === '4H' ? 14400000 : 86400000;
  const earliestHypotheticalEntryOpenMs = (Math.floor(decisionMs / duration) + 1) * duration;
  if (!Number.isSafeInteger(earliestHypotheticalEntryOpenMs) ||
    earliestHypotheticalEntryOpenMs <= decisionMs) return fail('TIME_OVERFLOW');
  const copiedMetadata = metadata.map(x => ({...x}));
  const copiedAdmission = actual ? {mode: a.mode, receipts: copiedMetadata} :
    {mode: a.mode, assumptionId: a.assumptionId, publicationDelayMs: a.publicationDelayMs,
      archiveReceipts: copiedMetadata, assumedPublications};
  return {
    valid: true, schemaVersion: VERSION, assetId: input.assetId, timeframe, mode: a.mode,
    pivot: {kind: high ? 'HIGH' : 'LOW', price: high ? candidate.high : candidate.low,
      barIndex: leftBars, openTimeMs: candidate.openTimeMs, closeTimeMs: candidate.closeTimeMs},
    geometricConfirmationAtMs: timing.geometricConfirmationAtMs, admittedAtMs, decisionMs,
    earliestHypotheticalEntryOpenMs,
    evidence: {assetId: input.assetId, timeframe, leftBars, rightBars,
      bars: bars.map(b => ({...b})), admission: copiedAdmission},
    ...FLAGS
  };
}

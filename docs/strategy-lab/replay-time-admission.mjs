// Pure timing metadata for hypothetical historical engineering replay.
// Never rewrites observed receipts, evaluates signals or authorizes execution.
const DAY = 86400000;
const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, names) => isRecord(x) && Object.keys(x).length === names.length && names.every(k => Object.hasOwn(x,k));
const time = x => Number.isSafeInteger(x) && x >= 0;
const flags = {historicalAvailabilityVerified:false, strategyExecutionAuthorized:false,
  executionAuthorized:false, researchOnly:true};
const reject = error => ({valid:false,error,...flags});

export function planReplayTimeAdmission(input) {
  if (!exact(input,['mode','assumptionId','publicationDelayMs','decisionAtMs','archiveRetrievedAtMs','candleCloseTimesMs'])) return reject('INPUT_SCHEMA');
  // Evidence must be authenticated outside this prototype. A caller's label is not proof.
  if (input.mode !== 'ASSUMED_PUBLICATION_V1') return reject('UNSUPPORTED_MODE');
  const {assumptionId,publicationDelayMs,decisionAtMs,archiveRetrievedAtMs,candleCloseTimesMs} = input;
  if (typeof assumptionId !== 'string' || assumptionId.length < 1 || assumptionId.length > 80 ||
      /[^A-Za-z0-9_.-]/u.test(assumptionId)) return reject('ASSUMPTION_ID');
  if (!time(publicationDelayMs) || !time(decisionAtMs) || !time(archiveRetrievedAtMs)) return reject('TIME');
  if (!Array.isArray(candleCloseTimesMs) || candleCloseTimesMs.length !== 201) return reject('WINDOW');
  const assumedPublicationTimesMs=[];
  for (let i=0;i<candleCloseTimesMs.length;i++) {
    const close=candleCloseTimesMs[i];
    if (!time(close) || close < DAY || close % DAY !== 0 ||
        (i>0 && close-candleCloseTimesMs[i-1] !== DAY)) return reject('DAILY_SEQUENCE');
    if (archiveRetrievedAtMs < close) return reject('ARCHIVE_PRECEDES_CLOSE');
    const assumed=close+publicationDelayMs;
    if (!time(assumed)) return reject('TIME_OVERFLOW');
    assumedPublicationTimesMs.push(assumed);
  }
  const lastClose=candleCloseTimesMs.at(-1);
  const lastAssumed=assumedPublicationTimesMs.at(-1);
  if (decisionAtMs < lastAssumed) return reject('NOT_YET_ASSUMED_PUBLISHED');
  if (decisionAtMs-lastClose >= DAY) return reject('STALE_WINDOW');
  return {valid:true,mode:input.mode,assumptionId,publicationDelayMs,decisionAtMs,
    archiveRetrievedAtMs,assumedPublicationTimesMs,
    timingEligibleUnderAssumption:true,
    revisionHistoryVerified:false,
    ...flags};
}

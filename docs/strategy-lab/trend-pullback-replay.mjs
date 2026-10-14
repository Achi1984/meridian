// Explicit assumed-history P1 signal adapter, with no actual-receipt rewriting.
import {evaluateTrendPullbackCore} from './trend-pullback-core.mjs';
import {planReplayTimeAdmission} from './replay-time-admission.mjs';
const keys = (x,names) => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(x)) &&
  Object.keys(x).length === names.length && names.every(k=>Object.hasOwn(x,k));
const flags = {historicalAvailabilityVerified:false,revisionHistoryVerified:false,
  executionAuthorized:false,researchOnly:true};
const reject = error => ({valid:false,error,action:'NONE',...flags});
export function evaluateTrendPullbackReplay(input) {
  if (!keys(input,['schemaVersion','mode','assumptionId','publicationDelayMs','decisionAtMs',
    'archiveRetrievedAtMs','bars','position'])) return reject('INPUT_SCHEMA');
  if (input.schemaVersion !== 'MERIDIAN_P1_ASSUMED_HISTORY_V1') return reject('SCHEMA_VERSION');
  if (input.mode !== 'ASSUMED_PUBLICATION_V1') return reject('UNSUPPORTED_MODE');
  const {bars,position,decisionAtMs}=input;
  // Raw bars have no availableAtMs field. Core performs no receipt admission.
  const signal=evaluateTrendPullbackCore({bars,position,decisionAtMs});
  if (!signal.valid) return reject(signal.error);
  const admission=planReplayTimeAdmission({mode:input.mode,assumptionId:input.assumptionId,
    publicationDelayMs:input.publicationDelayMs,decisionAtMs,
    archiveRetrievedAtMs:input.archiveRetrievedAtMs,candleCloseTimesMs:bars.map(b=>b.closeTimeMs)});
  if (!admission.valid) return reject(admission.error);
  // Keep observed receipt and explicitly assumed publication metadata separate.
  // No live-compatible bars or signalAvailableAtMs are manufactured.
  return {valid:true,signal,timing:admission,...flags};
}

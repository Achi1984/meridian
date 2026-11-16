import {
  canonicalJson, exactKeys, MAX_PROGRESS_BYTES, PROGRESS_SCHEMA,
  validIdentity, validateProgress
} from './scripts/spot-paper-paired-progress/contract.mjs';

export const PROGRESS_SCHEMA_V2 = 'SPOT_PAPER_PAIRED_PROGRESS_V2';
const HASH = /^[a-f0-9]{64}$/;
const time = value => Number.isSafeInteger(value) && value >= 0;
const V2_KEYS = [
  'schemaVersion', 'identity', 'journalSequence', 'journalSha256',
  'classification', 'runStartedAt', 'lastSuccessfulPollAt', 'completedCycles',
  'observedAt', 'valuationAt', 'exportedAt', 'latestEventAt', 'terminal',
  'currency', 'monetaryUnit', 'assumptions', 'arms'
];

function validV2Metadata(value, expectedIdentity) {
  return exactKeys(value, V2_KEYS) &&
    validIdentity(expectedIdentity) &&
    validIdentity(value.identity) &&
    canonicalJson(value.identity) === canonicalJson(expectedIdentity) &&
    value.schemaVersion === PROGRESS_SCHEMA_V2 &&
    Number.isSafeInteger(value.journalSequence) && value.journalSequence >= 1 &&
    HASH.test(value.journalSha256) &&
    time(value.runStartedAt) && time(value.exportedAt) &&
    value.exportedAt >= value.runStartedAt &&
    time(value.latestEventAt) && value.latestEventAt >= value.runStartedAt &&
    value.latestEventAt <= value.exportedAt &&
    value.currency === 'EUR' && value.monetaryUnit === 'CENTS' &&
    exactKeys(value.terminal, ['status', 'at']) &&
    ['UNKNOWN', 'TERMINAL_RECORDED', 'INTERRUPTED_RECORDED']
      .includes(value.terminal.status) &&
    (value.terminal.status === 'UNKNOWN' ? value.terminal.at === null :
      time(value.terminal.at) && value.terminal.at >= value.runStartedAt &&
        value.terminal.at === value.latestEventAt) &&
    exactKeys(value.assumptions, ['feeBpsPerSide', 'slippageBpsPerSide',
      'ratesVerified', 'feeBasis', 'netEquityIncludesCosts']) &&
    value.assumptions.feeBpsPerSide === 20 &&
    value.assumptions.slippageBpsPerSide === 10 &&
    value.assumptions.ratesVerified === false &&
    value.assumptions.feeBasis === 'EEA_SPOT_ONLY_TAKER_ASSUMPTION' &&
    value.assumptions.netEquityIncludesCosts === true;
}

function validNoObservation(value) {
  return value.classification === 'NO_OBSERVATION' &&
    value.observedAt === null && value.valuationAt === null &&
    value.lastSuccessfulPollAt === null && value.completedCycles === 0 &&
    value.arms === null;
}

export function validatePairedProgress(value, expectedIdentity, {allowV2 = true} = {}) {
  try {
    if (value?.schemaVersion !== PROGRESS_SCHEMA_V2) {
      return validateProgress(value, expectedIdentity);
    }
    if (!allowV2 || !validV2Metadata(value, expectedIdentity)) return null;
    if (validNoObservation(value)) {
      if (value.journalSequence < 1) return null;
    } else {
      if (value.classification !== 'OBSERVED_CHECKPOINT' ||
          value.journalSequence < 2 ||
          !time(value.lastSuccessfulPollAt) ||
          value.runStartedAt > value.lastSuccessfulPollAt ||
          !time(value.observedAt) ||
          value.lastSuccessfulPollAt > value.observedAt ||
          !Number.isSafeInteger(value.completedCycles) ||
          value.completedCycles < 1 || value.completedCycles > 480) return null;
      const observedV1 = {...value, schemaVersion: PROGRESS_SCHEMA};
      delete observedV1.runStartedAt;
      delete observedV1.lastSuccessfulPollAt;
      delete observedV1.completedCycles;
      if (!validateProgress(observedV1, expectedIdentity)) return null;
    }
    const result = JSON.parse(canonicalJson(value));
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength >
        MAX_PROGRESS_BYTES) return null;
    return result;
  } catch {
    return null;
  }
}

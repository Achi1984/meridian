import {
  PROGRESS_SCHEMA_V2, validateProgress
} from './scripts/spot-paper-paired-progress/contract.mjs';

export function validateStoredPairedProgress(value, expectedIdentity) {
  const progress = validateProgress(value, expectedIdentity);
  if (!progress) return null;
  if (progress.schemaVersion === PROGRESS_SCHEMA_V2 &&
      progress.journalSequence === 1 &&
      progress.classification !== 'NO_OBSERVATION') return null;
  return progress;
}

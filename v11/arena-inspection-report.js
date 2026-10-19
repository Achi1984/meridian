// Metadata-only adapter. Never imports an engine, reads data, fetches or grants authority.
export const MAX_INSPECTION_REPORT_BYTES = 16384;
const KEYS = ['schema','profile','evidenceClass','trialId','state','unresolved','requiresExplicitReconciliation',
  'attempts','fence','fenceInterpretation','integrity','timestamps','identities','pathsStarted','pathsCompleted',
  'reasonCode','executionAuthorized','promotionAuthorized','profitabilityInferred','recoveryPerformed'];
const HASH_KEYS = ['protocolSha256','sourceSha256','dataSha256','manifestSha256','resultSha256','summarySha256'];
const STATES = ['queued','unknown','completed','rejected','failed','timed_out','partial'];
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const stamp = value => value === null || typeof value === 'string' && value.length <= 64 &&
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value.slice(0,10)).toISOString().slice(0,10) === value.slice(0,10);
const invalid = () => ({status:'INVALID',message:'Prüfbericht abgelehnt · Format, Identität oder Status widersprüchlich.'});

export function parseArenaInspectionReport(text) {
  if (text === null || text === undefined) return {status:'UNKNOWN',message:'Kein Prüfbericht importiert.'};
  if (typeof text !== 'string' || text.length > MAX_INSPECTION_REPORT_BYTES || new TextEncoder().encode(text).length > MAX_INSPECTION_REPORT_BYTES) return invalid();
  let value;
  try { value = JSON.parse(text); } catch { return invalid(); }
  if (!exact(value,KEYS) || value.schema !== 'MERIDIAN_B1_INSPECTION_REPORT_V1' ||
      value.profile !== 'MERIDIAN-B1-7-GENERATED-FIXTURE-BRIDGE-R1' || value.evidenceClass !== 'SYNTHETIC_ONLY' ||
      !hash(value.trialId) || !STATES.includes(value.state) || typeof value.unresolved !== 'boolean' ||
      value.requiresExplicitReconciliation !== value.unresolved || value.unresolved && value.state !== 'unknown' ||
      value.fenceInterpretation !== (value.unresolved ? 'UNRESOLVED_FENCE_RETAINED' : 'NO_UNRESOLVED_FENCE_FOR_THIS_TRIAL') ||
      value.integrity !== 'STORED_JOURNAL_VALIDATED_NOT_SOURCE_AUTHENTICITY' ||
      !['executionAuthorized','promotionAuthorized','profitabilityInferred','recoveryPerformed'].every(key=>value[key] === false) ||
      !exact(value.identities,HASH_KEYS) || !HASH_KEYS.every(key=>hash(value.identities[key]) ||
        ['resultSha256','summarySha256'].includes(key) && value.identities[key] === null) ||
      (value.identities.resultSha256 === null) !== (value.identities.summarySha256 === null) ||
      !exact(value.timestamps,['createdAt','startedAt','finishedAt']) || !Object.values(value.timestamps).every(stamp) ||
      value.timestamps.createdAt === null || !integer(value.attempts) || value.attempts > 1 || !integer(value.fence) ||
      !integer(value.pathsStarted) || value.pathsStarted > 44 || !integer(value.pathsCompleted) || value.pathsCompleted > value.pathsStarted ||
      value.pathsStarted - value.pathsCompleted > 1 ||
      !(value.reasonCode === null || typeof value.reasonCode === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value.reasonCode))) return invalid();
  const notAttempted = ['queued','rejected'].includes(value.state);
  if (value.attempts !== (notAttempted ? 0 : 1) || (notAttempted ? value.fence !== 0 : value.fence === 0) ||
      notAttempted && (value.pathsStarted !== 0 || value.identities.resultSha256 !== null || value.timestamps.startedAt !== null) ||
      value.unresolved && (value.timestamps.finishedAt !== null || value.identities.resultSha256 !== null) ||
      value.state === 'unknown' && !value.unresolved && value.timestamps.finishedAt === null ||
      value.state === 'queued' && value.timestamps.finishedAt !== null ||
      value.pathsStarted > 0 && value.timestamps.startedAt === null ||
      ['completed','rejected','failed','timed_out','partial'].includes(value.state) && value.timestamps.finishedAt === null ||
      value.state === 'completed' && (value.pathsCompleted !== 44 || value.identities.resultSha256 === null ||
        value.timestamps.startedAt === null || value.timestamps.finishedAt === null)) return invalid();
  const {createdAt,startedAt,finishedAt} = value.timestamps;
  if (startedAt !== null && Date.parse(startedAt) < Date.parse(createdAt) ||
      finishedAt !== null && Date.parse(finishedAt) < Date.parse(startedAt ?? createdAt)) return invalid();
  return {status:'PRESENT_UNVERIFIED',message:'Synthetischer Prüfbericht · Angaben des importierten Belegs, keine Echtheitsbestätigung.',report:value};
}

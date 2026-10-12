/**
 * Pure offline consistency classification. Caller-supplied claims and pins are
 * NEVER authenticated; GREEN grants no merge, dispatch or activation authority.
 * Identical snapshots are idempotent, with no replay store consumed. This is
 * not durable replay protection. V2 journal reservations and V3 evidence's
 * opId|requestId|headSha one-shot keys remain separate, unchanged contracts.
 * Hostile changes to JavaScript built-ins are outside this trust model.
 */
import { types } from 'node:util';

export class ReviewCoordinationError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'ReviewCoordinationError'; }
}
const must = (ok, code) => { if (!ok) throw new ReviewCoordinationError(code); };
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const id = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(x);
const scopeKeys = ['requestId', 'opId', 'headSha', 'baseSha', 'repository'];
const verdicts = ['GREEN_LIGHT', 'NEEDS_MORE_EVIDENCE', 'REVISION_REQUIRED', 'CHANGES_REQUIRED', 'STALE_HEAD'];

// Reject proxies before traps can run, then inspect own data descriptors.
function record(value, keys) {
  must(value !== null && typeof value === 'object' && !types.isProxy(value)
    && Object.getPrototypeOf(value) === Object.prototype, 'INVALID_OBJECT');
  const names = Reflect.ownKeys(value);
  must(names.length === keys.length && names.every(k => keys.includes(k)), 'INVALID_SCHEMA');
  const copy = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    must(d && Object.hasOwn(d, 'value') && d.enumerable, 'ACCESSOR_OR_HIDDEN_FIELD');
    copy[key] = d.value;
  }
  return Object.freeze(copy);
}
function collection(value, keys) {
  must(value !== null && typeof value === 'object' && !types.isProxy(value)
    && Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, 'INVALID_COLLECTION');
  const length = Object.getOwnPropertyDescriptor(value, 'length').value;
  must(length <= 256, 'COLLECTION_LIMIT');
  const names = Reflect.ownKeys(value);
  must(names.length === length + 1 && names.every(k => k === 'length'
    || (typeof k === 'string' && /^(0|[1-9][0-9]*)$/.test(k) && Number(k) < length)), 'INVALID_COLLECTION');
  const rows = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    must(d && Object.hasOwn(d, 'value') && d.enumerable, 'ACCESSOR_OR_HIDDEN_FIELD');
    rows.push(record(d.value, keys));
  }
  return Object.freeze(rows);
}
function validateScope(s) {
  must(id(s.requestId) && id(s.opId) && s.repository === 'Achi1984/meridian', 'INVALID_SCOPE');
  must(sha(s.headSha) && sha(s.baseSha) && s.headSha !== s.baseSha, 'INVALID_SHA');
}
const scopeKey = s => scopeKeys.map(k => s[k]).join('|'); // IDs exclude '|'.
const decision = (status, reason) => Object.freeze({status, reason,
  mayRequest: false, mayMerge: false, mayActivate: false,
  authenticated: false, provenanceVerified: false, authorized: false});

/** Both arguments are untrusted snapshots; expected pins scope, not provenance. */
export function classifyReview(input, expected) {
  const pinned = record(expected, scopeKeys);
  const snapshot = record(input, [...scopeKeys, 'responses', 'inFlight']);
  validateScope(pinned); validateScope(snapshot);
  must(scopeKeys.every(k => snapshot[k] === pinned[k]), 'SCOPE_MISMATCH');
  const responses = collection(snapshot.responses, [...scopeKeys, 'reviewCommentId', 'reviewAuthor', 'verdict']);
  const inFlight = collection(snapshot.inFlight, scopeKeys);
  const requests = new Map(), operations = new Map(), reviews = new Map();
  // Validate every row, even unrelated rows, before any GREEN or WAITING result.
  for (const row of [pinned, ...responses, ...inFlight]) {
    validateScope(row);
    const key = scopeKey(row);
    must(!requests.has(row.requestId) || requests.get(row.requestId) === key, 'REQUEST_SCOPE_CONFLICT');
    must(!operations.has(row.opId) || operations.get(row.opId) === key, 'OP_SCOPE_CONFLICT');
    requests.set(row.requestId, key); operations.set(row.opId, key);
    must(row.headSha !== pinned.headSha || row.baseSha === pinned.baseSha, 'HEAD_BASE_CONFLICT');
  }
  for (const row of responses) {
    must(Number.isSafeInteger(row.reviewCommentId) && row.reviewCommentId > 0
      && row.reviewAuthor === 'CLAUDE', 'INVALID_REVIEW_CLAIM');
    must(verdicts.includes(row.verdict), 'UNKNOWN_VERDICT');
    const key = scopeKey(row) + '|' + row.reviewAuthor + '|' + row.verdict;
    must(!reviews.has(row.reviewCommentId) || reviews.get(row.reviewCommentId) === key, 'REVIEW_ID_CONFLICT');
    reviews.set(row.reviewCommentId, key);
  }
  const rows = [...responses, ...inFlight];
  // New Request-IDs cannot bypass per-head dedupe or inherit another review.
  if (rows.some(r => r.headSha === pinned.headSha && r.requestId !== pinned.requestId))
    return decision('BLOCKED', 'HEAD_ALREADY_SCOPED');
  const scoped = responses.filter(r => r.requestId === pinned.requestId);
  if (scoped.some(r => r.verdict !== 'GREEN_LIGHT')) return decision('BLOCKED', 'STRICTEST_VERDICT');
  if (scoped.length) return decision('REVIEWED', 'GREEN_UNVERIFIED');
  if (inFlight.some(r => r.requestId === pinned.requestId)) return decision('WAITING', 'ALREADY_REQUESTED');
  return decision('UNREQUESTED', 'OFFLINE_ONLY');
}

const ciKeys = ['runId', 'runAttempt', 'workflowId', 'headSha', 'status', 'conclusion'];
const ciIdentityKeys = ciKeys.slice(0, 4);
const ciStatuses = ['queued', 'in_progress', 'completed'];
const ciConclusions = ['success', 'failure', 'cancelled', 'timed_out', 'neutral', 'skipped', 'action_required', 'stale', 'startup_failure'];
const positiveInteger = x => Number.isSafeInteger(x) && x > 0;
function freezeSchema(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSchema(child);
    Object.freeze(value);
  }
  return value;
}
const integerSchema = {type:'integer', minimum:1, maximum:Number.MAX_SAFE_INTEGER};
const shaSchema = {type:'string', minLength:40, maxLength:40, pattern:'^[a-f0-9]{40}$'};
const idSchema = {type:'string', minLength:3, maxLength:128, pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'};

/** Shape constraints only. Expected identity comparisons remain validator duties. */
export const STRUCTURED_REVIEW_CLAIM_SCHEMA = freezeSchema({
  $schema:'https://json-schema.org/draft/2020-12/schema',
  type:'object', additionalProperties:false,
  required:['schemaVersion', ...scopeKeys, 'prNumber', 'verdict', 'ci'],
  properties:{schemaVersion:{type:'integer', const:1}, repository:{const:'Achi1984/meridian'},
    prNumber:integerSchema, requestId:idSchema, opId:idSchema, headSha:shaSchema, baseSha:shaSchema,
    verdict:{type:'string', enum:[...verdicts]},
    ci:{type:'object', additionalProperties:false, required:[...ciKeys],
      properties:{runId:integerSchema, runAttempt:integerSchema, workflowId:integerSchema,
        headSha:shaSchema, status:{type:'string', enum:[...ciStatuses]},
        conclusion:{enum:[null, ...ciConclusions]}},
      allOf:[{if:{properties:{status:{const:'completed'}}},
        then:{properties:{conclusion:{enum:[...ciConclusions]}}},
        else:{properties:{conclusion:{const:null}}}}]}},
  allOf:[{if:{properties:{verdict:{const:'GREEN_LIGHT'}}},
    then:{properties:{ci:{properties:{status:{const:'completed'}, conclusion:{const:'success'}}}}}}],
});

/**
 * Validate an already-decoded claim against independently supplied scope and CI
 * identity pins. Transport size/duplicate JSON keys must be checked upstream.
 * No author/provenance supplied by a model is accepted. CI fields are claims,
 * not authenticated CI evidence. No IO, durable replay state or authority.
 */
export function validateStructuredReviewClaim(input, expected) {
  const pinned = record(expected, [...scopeKeys, 'prNumber', 'ci']);
  const claim = record(input, ['schemaVersion', ...scopeKeys, 'prNumber', 'verdict', 'ci']);
  validateScope(pinned); validateScope(claim);
  must(claim.schemaVersion === 1, 'UNKNOWN_SCHEMA_VERSION');
  must(positiveInteger(pinned.prNumber) && positiveInteger(claim.prNumber), 'INVALID_PR_NUMBER');
  must([...scopeKeys, 'prNumber'].every(k => claim[k] === pinned[k]), 'SCOPE_MISMATCH');
  must(verdicts.includes(claim.verdict), 'UNKNOWN_VERDICT');
  const pinnedCI = record(pinned.ci, ciIdentityKeys), ci = record(claim.ci, ciKeys);
  for (const value of [pinnedCI, ci]) {
    must(['runId', 'runAttempt', 'workflowId'].every(k => positiveInteger(value[k]))
      && sha(value.headSha), 'INVALID_CI_IDENTITY');
  }
  must(pinnedCI.headSha === pinned.headSha && ci.headSha === claim.headSha
    && ciIdentityKeys.every(k => ci[k] === pinnedCI[k]), 'CI_IDENTITY_MISMATCH');
  must(ciStatuses.includes(ci.status) && (ci.conclusion === null || ciConclusions.includes(ci.conclusion)), 'INVALID_CI_STATE');
  must(ci.status === 'completed' ? ci.conclusion !== null : ci.conclusion === null, 'INCONSISTENT_CI_STATE');
  must(claim.verdict !== 'GREEN_LIGHT' || (ci.status === 'completed' && ci.conclusion === 'success'), 'GREEN_CI_CONFLICT');
  return Object.freeze({...decision(claim.verdict === 'GREEN_LIGHT' ? 'REVIEWED' : 'BLOCKED',
    claim.verdict === 'GREEN_LIGHT' ? 'GREEN_UNVERIFIED' : 'NON_GREEN_CLAIM'),
    schemaVersion:1, verdict:claim.verdict});
}

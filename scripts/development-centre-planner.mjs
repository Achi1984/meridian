/** Offline planning only: supplied identities and evidence are never authenticated. */
import { types } from 'node:util';
import { classifyReview } from './codex-bridge-v3-review-coordinator.mjs';
export class PlanningError extends Error {
  constructor(code) { super(code); this.name = 'PlanningError'; this.code = code; }
}
const need = (ok, code) => { if (!ok) throw new PlanningError(code); };
const id = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(v);
const sha = v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
// Clone bounded data without invoking accessors, proxy traps or serialization hooks.
function clone(v, depth = 0, seen = new Set(), budget = {left: 20000}) {
  need(--budget.left >= 0, 'INPUT_LIMIT');
  need(depth <= 12, 'INPUT_LIMIT');
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'string') { need(v.length <= 1024, 'INPUT_LIMIT'); return v; }
  if (typeof v === 'number') { need(Number.isSafeInteger(v) && v >= 0, 'INVALID_NUMBER'); return v; }
  need(v && typeof v === 'object' && !types.isProxy(v) && !seen.has(v), 'INVALID_OBJECT');
  const array = Array.isArray(v);
  need(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype), 'INVALID_OBJECT');
  const keys = Reflect.ownKeys(v);
  need(keys.length <= 129, 'INPUT_LIMIT');
  seen.add(v);
  const result = array ? [] : {};
  if (array) need(v.length <= 128 && keys.length === v.length + 1, 'INVALID_ARRAY');
  for (const key of keys) {
    if (array && key === 'length') continue;
    need(typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key), 'INVALID_KEY');
    if (array) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < v.length, 'INVALID_ARRAY');
    const d = Object.getOwnPropertyDescriptor(v, key);
    need(d.enumerable && Object.hasOwn(d, 'value'), 'INVALID_DESCRIPTOR');
    result[key] = clone(d.value, depth + 1, seen, budget);
  }
  seen.delete(v); return result;
}
function shape(v, keys) {
  need(v && !Array.isArray(v) && typeof v === 'object' && Object.keys(v).length === keys.length
    && keys.every(k => Object.hasOwn(v, k)), 'INVALID_SCHEMA');
}
const canonical = v => JSON.stringify(v, function (k, x) {
  return x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x;
});
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const scopeFields = ['requestId', 'opId', 'headSha', 'baseSha', 'repository'];
const scope = w => Object.fromEntries(scopeFields.map(k => [k, w[k]]));
const pathValid = p => typeof p === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p)
  && p.split('/').every(x => x !== '.' && x !== '..');
const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');

/** Returns proposals, not leases, authenticated evidence, dispatches or merge permission. */
export function planWork(input) {
  const s = clone(input);
  shape(s, ['requiredJobs', 'work']);
  need(Array.isArray(s.requiredJobs) && s.requiredJobs.length > 0 && s.requiredJobs.every(id)
    && new Set(s.requiredJobs).size === s.requiredJobs.length && Array.isArray(s.work), 'INVALID_COLLECTION');
  const deliveries = new Map(), works = new Map(), requests = new Map(), operations = new Map(), heads = new Map(), reviewIds = new Map(), ciRuns = new Map();
  for (const w of s.work) {
    shape(w, ['deliveryId', 'workId', ...scopeFields, 'paths', 'owner', 'execution', 'ci', 'responses', 'inFlight']);
    need([w.deliveryId, w.workId, w.requestId, w.opId].every(id)
      && w.repository === 'Achi1984/meridian' && sha(w.headSha) && sha(w.baseSha)
      && w.headSha !== w.baseSha, 'INVALID_SCOPE');
    need(Array.isArray(w.paths) && w.paths.length > 0 && w.paths.every(pathValid)
      && new Set(w.paths).size === w.paths.length, 'INVALID_PATHS');
    need(['NONE', 'CHATGPT', 'CODEX', 'COPILOT'].includes(w.owner)
      && ['PLANNED', 'RUNNING', 'UNKNOWN'].includes(w.execution), 'INVALID_EXECUTION');
    need(w.execution !== 'RUNNING' || w.owner !== 'NONE', 'OWNER_REQUIRED');
    const review = classifyReview({...scope(w), responses: w.responses, inFlight: w.inFlight}, scope(w));
    for (const row of w.responses) {
      const binding = canonical(row);
      need(!reviewIds.has(row.reviewCommentId) || reviewIds.get(row.reviewCommentId) === binding, 'REVIEW_ID_CONFLICT');
      reviewIds.set(row.reviewCommentId, binding);
    }
    if (w.ci !== null) {
      shape(w.ci, ['headSha', 'baseSha', 'runId', 'jobs']);
      need(sha(w.ci.headSha) && sha(w.ci.baseSha) && Number.isSafeInteger(w.ci.runId)
        && w.ci.runId > 0 && Array.isArray(w.ci.jobs), 'INVALID_CI');
      const ciBinding = canonical(w.ci);
      need(!ciRuns.has(w.ci.runId) || ciRuns.get(w.ci.runId) === ciBinding, 'CI_RUN_CONFLICT');
      ciRuns.set(w.ci.runId, ciBinding);
      const names = new Set();
      for (const j of w.ci.jobs) {
        shape(j, ['name', 'conclusion', 'total', 'passed', 'failed']);
        need(id(j.name) && !names.has(j.name) && ['SUCCESS', 'PENDING', 'FAILURE'].includes(j.conclusion)
          && [j.total, j.passed, j.failed].every(n => Number.isSafeInteger(n) && n >= 0)
          && j.passed + j.failed === j.total, 'INVALID_CI');
        names.add(j.name);
      }
    }
    const {deliveryId, ...packet} = w, signature = canonical(packet);
    need(!deliveries.has(deliveryId) || deliveries.get(deliveryId) === signature, 'DELIVERY_CONFLICT');
    need(!works.has(w.workId) || works.get(w.workId).signature === signature, 'WORK_CONFLICT');
    for (const [map, key] of [[requests, w.requestId], [operations, w.opId]]) {
      need(!map.has(key) || map.get(key) === signature, 'REQUEST_SCOPE_CONFLICT'); map.set(key, signature);
    }
    need(!heads.has(w.headSha) || heads.get(w.headSha) === signature, 'HEAD_ALREADY_SCOPED');
    heads.set(w.headSha, signature);
    deliveries.set(deliveryId, signature); works.set(w.workId, {w, review, signature});
  }
  const packets = [...works.values()];
  const results = packets.map(({w, review}) => {
    let status, reason;
    if (w.execution === 'UNKNOWN') { status = 'BLOCKED'; reason = 'RECONCILE_UNKNOWN_OUTCOME'; }
    else if (packets.some(({w: other}) => other.workId !== w.workId
      && w.paths.some(a => other.paths.some(b => overlaps(a, b))))) {
      status = 'BLOCKED'; reason = 'OVERLAPPING_SCOPE';
    } else if (review.status === 'BLOCKED') { status = 'BLOCKED'; reason = review.reason; }
    else if (w.execution === 'RUNNING') { status = 'WAITING_AGENT'; reason = 'OWNER_IN_FLIGHT'; }
    else if (w.ci === null) { status = 'WAITING_CI'; reason = 'CI_MISSING'; }
    else if (w.ci.headSha !== w.headSha || w.ci.baseSha !== w.baseSha) { status = 'BLOCKED'; reason = 'STALE_CI'; }
    else if (w.ci.jobs.some(j => j.conclusion === 'FAILURE' || j.failed > 0)) { status = 'BLOCKED'; reason = 'CI_FAILED'; }
    else if (s.requiredJobs.some(name => !w.ci.jobs.some(j => j.name === name && j.conclusion === 'SUCCESS'
      && j.total > 0 && j.passed === j.total))) { status = 'WAITING_CI'; reason = 'CI_INCOMPLETE'; }
    else if (review.status !== 'REVIEWED') { status = 'WAITING_REVIEW'; reason = review.reason; }
    else { status = 'READY_FOR_OWNER_DECISION'; reason = 'OFFLINE_CONSISTENT_ONLY'; }
    return {workId: w.workId, ...scope(w), owner: w.owner, status, reason,
      authenticated: false, provenanceVerified: false, dispatchAllowed: false, mergeAllowed: false, authorized: false};
  });
  const order = ['BLOCKED', 'READY_FOR_OWNER_DECISION', 'WAITING_REVIEW', 'WAITING_CI', 'WAITING_AGENT'];
  results.sort((a,b) => order.indexOf(a.status) - order.indexOf(b.status) || (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0));
  return freeze(results);
}

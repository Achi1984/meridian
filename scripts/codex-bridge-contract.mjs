/**
 * MERIDIAN Codex Bridge V2 — offline-only contract guard.
 * No network I/O, secrets, billing, GitHub mutation, agent invocation or scheduler.
 * Provisional implementation for #627; integration is NOT authorized by this file.
 */
import { createHash } from 'node:crypto';

export const PROTOCOL = 'MERIDIAN-CODEX-BRIDGE-V2';
export const STATES = Object.freeze([
  'PLANNED', 'OWNER_AUTHORIZED', 'ASSIGNED', 'ACKED', 'DRAFT_PR',
  'CI_VERIFIED', 'CLAUDE_EXACT_HEAD_REVIEWED', 'AWAITING_MERGE_DECISION', 'STOPPED',
]);
const SHA = /^[0-9a-f]{40}$/;
const REF = /^(?!.*\.\.)(?!.*\/\/)(?!\/)(?!.*\/$)[A-Za-z0-9][A-Za-z0-9._\/-]{0,160}$/;
const ID = /^[A-Z0-9][A-Z0-9_-]{5,127}$/;
const NEXT = Object.freeze({
  PLANNED: 'OWNER_AUTHORIZED', OWNER_AUTHORIZED: 'ASSIGNED', ASSIGNED: 'ACKED',
  ACKED: 'DRAFT_PR', DRAFT_PR: 'CI_VERIFIED',
  CI_VERIFIED: 'CLAUDE_EXACT_HEAD_REVIEWED',
  CLAUDE_EXACT_HEAD_REVIEWED: 'AWAITING_MERGE_DECISION',
});

export class BridgeGuardError extends Error {
  constructor(code) { super(code); this.name = 'BridgeGuardError'; this.code = code; }
}
const must = (condition, code) => { if (!condition) throw new BridgeGuardError(code); };
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = x => typeof x === 'string' && x.length > 0;
const sha = x => str(x) && SHA.test(x);
const canonical = x => {
  if (Array.isArray(x)) return x.map(canonical);
  if (obj(x)) return Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])]));
  return x;
};
const digest = x => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const clone = x => structuredClone(x);

/** Enforces a precise read-only plan. No real-world authorization occurs here. */
export function validateRequest(request) {
  must(obj(request), 'REQUEST_MALFORMED');
  must(request.protocol === PROTOCOL, 'PROTOCOL_MISMATCH');
  must(ID.test(request.requestId || '') && ID.test(request.opId || ''), 'REQUEST_ID_INVALID');
  must(sha(request.expectedMain) && sha(request.expectedBase) && sha(request.expectedHead), 'REQUEST_SHA_INVALID');
  must(request.expectedMain === request.expectedBase, 'UNEXPECTED_BASE');
  must(REF.test(request.targetBranch || '') && request.targetBranch !== 'main', 'BRANCH_NOT_ISOLATED');
  must(str(request.model) && request.model.length <= 96, 'MODEL_UNSPECIFIED');
  must(Array.isArray(request.allowedPaths) && request.allowedPaths.length > 0, 'PATH_SCOPE_MISSING');
  must(request.allowedPaths.every(p => str(p) && !p.startsWith('/') && !p.includes('..') && !p.includes('\\') && !p.startsWith('.github/') && p.length <= 240), 'PATH_SCOPE_INVALID');
  must(new Set(request.allowedPaths).size === request.allowedPaths.length, 'PATH_DUPLICATE');
  must(request.researchStage === 'SOURCE_AUDIT', 'RESEARCH_STAGE_FORBIDDEN');
  must(Array.isArray(request.allowedActions) && request.allowedActions.join(',') === 'offline_code,draft_pr', 'ACTIONS_FORBIDDEN');
  must(request.costGuard?.overageAllowed === false && request.costGuard?.additionalSpendAllowed === false, 'COST_GUARD_MISSING');
  must(Array.isArray(request.forbidden) && ['merge','workflow','trading'].every(x => request.forbidden.includes(x)), 'FORBIDDEN_ACTION_GAP');
  return Object.freeze({ ...clone(request), fingerprint: digest(request) });
}

/** One immutable request ID is one scope. Replays are safe only if truly identical. */
export function reconcileRequest(prior, incoming) {
  const a = validateRequest(prior), b = validateRequest(incoming);
  if (a.requestId !== b.requestId) return { status: 'NEW_REQUEST', fingerprint: b.fingerprint };
  must(a.fingerprint === b.fingerprint && a.expectedHead === b.expectedHead, 'DUPLICATE_SCOPE_CONFLICT');
  return { status: 'IDENTICAL_REPLAY_NO_ACTION', fingerprint: b.fingerprint };
}

/**
 * observed is a VERIFIED external GitHub identity/transport observation.
 * An agent's self-asserted ACK cannot authenticate itself. Integrator must
 * supply independently fetched metadata from an authenticated transport.
 */
export function validateAck(request, ack, observed) {
  const r = validateRequest(request);
  must(obj(ack) && obj(observed), 'ACK_MALFORMED');
  must(observed.authenticatedBy === 'github-api' && observed.trustedSource === true,
    'ACK_IDENTITY_UNVERIFIED');
  must(str(observed.actor) && str(observed.url) && observed.actor === ack.agentActor,
    'ACK_ACTOR_CONFLICT');
  must(observed.requestId === r.requestId && observed.opId === r.opId, 'ACK_PROVENANCE_MISMATCH');
  must(ack.protocol === PROTOCOL && ack.requestId === r.requestId && ack.opId === r.opId,
    'ACK_REQUEST_MISMATCH');
  must(ack.expectedHead === r.expectedHead && ack.expectedBase === r.expectedBase,
    'ACK_SHA_MISMATCH');
  must(ack.model === r.model && observed.model === r.model, 'ACK_MODEL_MISMATCH');
  must(ack.result === 'ACCEPTED' && ack.mutations === 0, 'ACK_SIDE_EFFECTS');
  must(sha(observed.liveMain) && observed.liveMain === r.expectedMain, 'MAIN_MOVED');
  return { requestId: r.requestId, validated: true, evidenceUrl: observed.url };
}

/** Verifies a Draft PR against immutable request boundaries. */
export function validateDraftPr(request, pr, observed) {
  const r = validateRequest(request);
  must(obj(pr) && obj(observed) && observed.authenticatedBy === 'github-api' && observed.trustedSource === true, 'PR_UNVERIFIED');
  must(pr.draft === true && pr.state === 'open' && pr.merged === false, 'PR_NOT_DRAFT');
  must(pr.baseSha === r.expectedBase && observed.liveMain === r.expectedMain, 'PR_BASE_CHANGED');
  must(pr.headRef === r.targetBranch && sha(pr.headSha), 'PR_WRONG_HEAD');
  must(sha(observed.headSha) && observed.headSha === pr.headSha, 'PR_HEAD_MISMATCH');
  must(Array.isArray(pr.changedFiles) && pr.changedFiles.every(p => r.allowedPaths.includes(p)), 'PR_SCOPE_DRIFT');
  must(pr.changedFiles.length > 0, 'PR_EMPTY_DIFF');
  return { requestId: r.requestId, headSha: pr.headSha, changedFiles: [...pr.changedFiles] };
}

/** Pure state transition. No events here dispatch jobs or mutate GitHub. */
export function advance(ledger, event) {
  must(obj(ledger) && STATES.includes(ledger.state), 'STATE_INVALID');
  must(obj(event) && STATES.includes(event.next), 'EVENT_INVALID');
  const r = validateRequest(ledger.request);
  must(ledger.state !== 'STOPPED', 'TRANSITION_FORBIDDEN');
  if (event.next === 'STOPPED') {
    must(str(event.reason), 'STOP_REASON_MISSING');
    return { ...clone(ledger), state: 'STOPPED', stoppedReason: event.reason };
  }
  must(ledger.state !== 'STOPPED' && NEXT[ledger.state] === event.next, 'TRANSITION_FORBIDDEN');
  must(event.requestId === r.requestId && event.expectedHead === r.expectedHead, 'EVENT_SCOPE_MISMATCH');
  const evidence = obj(event.evidence) ? event.evidence : {};
  switch (event.next) {
    case 'OWNER_AUTHORIZED':
      must(evidence.owner === 'Achi1984' && str(evidence.approvalId) && evidence.approvedHead === r.expectedHead && evidence.approvedModel === r.model, 'OWNER_APPROVAL_MISSING');
      must(evidence.overageDisabledVerified === true && evidence.includedCreditsVerified === true && evidence.additionalSpendAllowed === false, 'COST_NOT_VERIFIED');
      break;
    case 'ASSIGNED':
      must(str(evidence.assignmentId) && evidence.model === r.model && evidence.ownerApproved === true, 'ASSIGNMENT_NOT_PROVEN');
      break;
    case 'ACKED':
      must(evidence.ackValidated === true && str(evidence.evidenceUrl), 'ACK_NOT_VERIFIED');
      break;
    case 'DRAFT_PR':
      must(sha(evidence.headSha) && str(evidence.prUrl) && evidence.scopeValidated === true, 'PR_NOT_VERIFIED');
      break;
    case 'CI_VERIFIED':
      must(evidence.ciSuccess === true && sha(evidence.headSha) && evidence.headSha === ledger.headSha && str(evidence.runUrl), 'CI_EXACT_HEAD_MISSING');
      break;
    case 'CLAUDE_EXACT_HEAD_REVIEWED':
      must(evidence.verdict === 'GREEN_LIGHT' && sha(evidence.headSha) && evidence.headSha === ledger.headSha && str(evidence.reviewUrl) && evidence.independentExecutionProven === true, 'REVIEW_INSUFFICIENT');
      break;
    case 'AWAITING_MERGE_DECISION':
      must(evidence.ownerMergeApprovalRequired === true, 'MERGE_GATE_MISSING');
      break;
  }
  return { ...clone(ledger), state: event.next, ...(event.next === 'DRAFT_PR' ? { headSha: evidence.headSha } : {}) };
}

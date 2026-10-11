// Pure synthetic lease/quota guards: never acquires real locks or spends funds.
export function assessClaim(task, proposal) {
  if (!task || !proposal || !Number.isSafeInteger(proposal.now) || proposal.now < 0) throw Error('INVALID_CLAIM');
  if (task.state !== 'QUEUED') return Object.freeze({allow:false,reason:'NOT_QUEUED'});
  if (!proposal.writer || typeof proposal.writer !== 'string') return Object.freeze({allow:false,reason:'MISSING_WRITER'});
  if (task.lease && (!Number.isSafeInteger(task.lease.expiresAt) || !task.lease.owner)) return Object.freeze({allow:false,reason:'INVALID_LEASE'});
  if (task.lease?.owner && task.lease.owner !== proposal.writer) return Object.freeze({allow:false,reason:'RECONCILE_LEASE_FIRST'});
  if (task.lease) return Object.freeze({allow:false,reason:'RECONCILE_LEASE_FIRST'});
  const budget=task.budget;
  if (!budget || !Number.isSafeInteger(budget.limit) || !Number.isSafeInteger(budget.used) || budget.limit < 0 || budget.used < 0 || budget.used >= budget.limit)
    return Object.freeze({allow:false,reason:'BUDGET_EXHAUSTED'});
  if (proposal.expectedRevision !== task.revision || proposal.expectedHead !== task.head || proposal.expectedBase !== task.base)
    return Object.freeze({allow:false,reason:'STALE_CAS'});
  return Object.freeze({allow:true,reason:'ELIGIBLE_SYNTHETIC_ONLY'});
}
export function verifyReviewSnapshot(snapshot, expected) {
  if (!snapshot || !expected || snapshot.source !== 'synthetic-unverified' || snapshot.author !== 'claude[bot]' ||
      !Number.isSafeInteger(snapshot.commentId) || snapshot.commentId <= 0 ||
      snapshot.head !== expected.head || snapshot.base !== expected.base ||
      snapshot.liveHead !== expected.head || snapshot.verdict !== 'GREEN_LIGHT')
    return Object.freeze({valid:false,reason:'UNVERIFIED_REVIEW'});
  if (!snapshot.ci || snapshot.ci.head !== expected.head || snapshot.ci.base !== expected.base ||
      snapshot.ci.conclusion !== 'success' || !Number.isSafeInteger(snapshot.ci.testCount) || snapshot.ci.testCount <= 0)
    return Object.freeze({valid:false,reason:'UNVERIFIED_CI'});
  return Object.freeze({valid:true,reason:'SYNTHETIC_EVIDENCE_ONLY'});
}

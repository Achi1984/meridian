// In-memory, deterministic Phase-1 laboratory only. No disk, GitHub, network or dispatch.
export function createOfflineStore(initial = []) {
  const tasks = new Map();
  for (const item of initial) {
    if (!item || typeof item.taskId !== 'string' || !item.taskId.trim() || tasks.has(item.taskId)) throw Error('INVALID_TASK_ID');
    tasks.set(item.taskId, structuredClone(item));
  }
  const audit = [];
  function snapshot(taskId) {
    const task = tasks.get(taskId);
    return task ? structuredClone(task) : null;
  }
  function claim({taskId, writer, revision, head, base, now, ttl, opId}) {
    const t = tasks.get(taskId);
    if (!t) return {ok:false,reason:'UNKNOWN_TASK'};
    if (!writer || !opId || !Number.isSafeInteger(now) || !Number.isSafeInteger(ttl) || ttl <= 0) return {ok:false,reason:'INVALID_CLAIM'};
    if (t.applied?.includes(opId)) return {ok:false,reason:'OP_ID_SEEN'};
    if (t.revision !== revision || t.head !== head || t.base !== base) return {ok:false,reason:'STALE_CAS'};
    if (t.state !== 'QUEUED') return {ok:false,reason:'NOT_QUEUED'};
    if (t.lease) return {ok:false,reason:'LEASE_RECONCILIATION_REQUIRED'};
    if (!t.budget || !Number.isSafeInteger(t.budget.limit) || !Number.isSafeInteger(t.budget.used) ||
        t.budget.used < 0 || t.budget.used >= t.budget.limit) return {ok:false,reason:'BUDGET_EXHAUSTED'};
    const next = {...t,state:'CLAIMED',writer,revision:t.revision+1,
      budget:{...t.budget,used:t.budget.used+1},lease:{owner:writer,expiresAt:now+ttl,fence:t.revision+1},
      applied:[...(t.applied??[]),opId]};
    tasks.set(taskId,next);
    audit.push(Object.freeze({taskId,opId,revision:next.revision,action:'CLAIMED'}));
    return {ok:true,task:structuredClone(next)};
  }
  function inspectExpired(taskId,now) {
    const t=tasks.get(taskId);
    if (!t || !Number.isSafeInteger(now)) return {action:'BLOCK',reason:'INVALID_INSPECTION'};
    if (!t.lease || t.lease.expiresAt>now) return {action:'NO_ACTION'};
    return {action:'RECONCILE_REQUIRED',fence:t.lease.fence};
  }
  return Object.freeze({snapshot,claim,inspectExpired,audit:()=>structuredClone(audit)});
}

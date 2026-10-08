// In-memory, deterministic Phase-1 laboratory only. No disk, GitHub, network or dispatch.
export function createOfflineStore(initial = []) {
  const tasks = new Map();
  for (const item of initial) {
    if (!item || typeof item.taskId !== 'string' || !item.taskId.trim() || tasks.has(item.taskId)) throw Error('INVALID_TASK_ID');
    if (!['QUEUED','CLAIMED'].includes(item.state) || !Number.isSafeInteger(item.revision) || item.revision < 0 ||
        typeof item.head !== 'string' || !item.head || typeof item.base !== 'string' || !item.base ||
        !item.budget || !Number.isSafeInteger(item.budget.limit) || item.budget.limit < 1 ||
        !Number.isSafeInteger(item.budget.used) || item.budget.used < 0 || item.budget.used > item.budget.limit ||
        (item.applied !== undefined && (!Array.isArray(item.applied) || item.applied.some(x=>typeof x !== 'string' || !x) || new Set(item.applied).size !== item.applied.length)) ||
        (item.state === 'QUEUED' && (item.lease != null || item.writer != null)) ||
        (item.state === 'CLAIMED' && (!item.lease || typeof item.writer !== 'string' || !item.writer ||
          item.lease.owner !== item.writer || item.lease.fence !== item.revision ||
          !Number.isSafeInteger(item.lease.expiresAt) || item.budget.used < 1))) throw Error('INVALID_RESTORED_TASK');
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
    if (!Number.isSafeInteger(now+ttl)) return {ok:false,reason:'INVALID_CLAIM'};
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

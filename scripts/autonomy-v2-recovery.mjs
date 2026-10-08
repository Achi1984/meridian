// Offline deterministic recovery planning only. Never mutates remote state.
export function reconcileSnapshot(local, remote, intent) {
  if (!local || !remote || !intent || !Number.isSafeInteger(local.revision) || !Number.isSafeInteger(remote.revision))
    return Object.freeze({action:'BLOCK',reason:'INVALID_SNAPSHOT'});
  if (local.taskId !== remote.taskId || local.base !== remote.base)
    return Object.freeze({action:'BLOCK',reason:'IDENTITY_OR_BASE_CHANGED'});
  if (!Array.isArray(remote.opIds) || remote.opIds.some(x=>typeof x!=='string'))
    return Object.freeze({action:'BLOCK',reason:'UNTRUSTED_REMOTE_JOURNAL'});
  if (typeof intent.opId !== 'string' || !intent.opId)
    return Object.freeze({action:'BLOCK',reason:'INVALID_OP_ID'});
  if (remote.opIds.includes(intent.opId))
    return Object.freeze({action:'ALREADY_APPLIED',reason:'REMOTE_OP_ID_PRESENT'});
  if (remote.revision !== local.revision || remote.head !== local.head)
    return Object.freeze({action:'BLOCK',reason:'REMOTE_ADVANCED'});
  if (remote.writer && remote.writer !== intent.writer)
    return Object.freeze({action:'BLOCK',reason:'WRITER_CONFLICT'});
  if (intent.expectedBase !== remote.base || intent.expectedHead !== remote.head || intent.expectedRevision !== remote.revision)
    return Object.freeze({action:'BLOCK',reason:'STALE_INTENT'});
  return Object.freeze({action:'RETRY_ELIGIBLE',reason:'NO_REMOTE_MUTATION_SEEN'});
}
export function summarizeSimulation(journal) {
  if (!Array.isArray(journal)) throw Error('INVALID_JOURNAL');
  return Object.freeze({
    events:journal.length,
    accepted:journal.filter(x=>x && Number.isSafeInteger(x.revision)).length,
    rejected:journal.filter(x=>x && typeof x.rejected==='string').length,
    duplicateRejects:journal.filter(x=>x && /DUPLICATE_OP_ID/.test(x.rejected??'')).length
  });
}

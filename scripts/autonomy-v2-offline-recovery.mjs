// Phase 1B laboratory only. Pure decision logic; never dispatches or mutates tasks.
import {isOfflineDataRecord as record} from './autonomy-v2-offline-data.mjs';
export function planOfflineRecovery(task, context = {}) {
  const block = reason => Object.freeze({action:'BLOCK',reason});
  if (!record(task) || !Object.hasOwn(task,'revision') || !Object.hasOwn(task,'state') ||
      !record(context) || !Object.hasOwn(context,'now') || !Object.hasOwn(context,'expectedRevision'))
    return block('INVALID_INPUT');
  const {now,expectedRevision}=context;
  const expectedFence=Object.hasOwn(context,'expectedFence')?context.expectedFence:undefined;
  if (!Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    return block('INVALID_INPUT');
  if (!Number.isSafeInteger(task.revision) || task.revision !== expectedRevision)
    return block('STALE_REVISION');
  if (task.state === 'QUEUED') {
    if (task.lease != null || task.writer != null) return block('INCONSISTENT_QUEUE');
    return Object.freeze({action:'NO_ACTION'});
  }
  if (!['CLAIMED','RECOVERY_PENDING'].includes(task.state) || !record(task.lease) || typeof task.writer !== 'string' ||
      !task.writer.trim() ||
      task.lease.owner !== task.writer || !Number.isSafeInteger(task.lease.fence) ||
      task.lease.fence < 1 || !Number.isSafeInteger(task.lease.expiresAt) ||
      task.lease.expiresAt < 1) return block('INVALID_LEASE');
  if (expectedFence !== task.lease.fence) return block('STALE_FENCE');
  if (task.state === 'RECOVERY_PENDING') return Object.freeze({action:'NO_ACTION'});
  if (now < task.lease.expiresAt) return Object.freeze({action:'WAIT',until:task.lease.expiresAt});
  return Object.freeze({action:'HUMAN_RECONCILIATION_REQUIRED',taskId:task.taskId,
    revision:task.revision,fence:task.lease.fence});
}

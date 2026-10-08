// Pure offline coordinator: all input evidence is synthetic and untrusted.
import { transition, STATES } from './autonomy-v2-state.mjs';
import { assessClaim, verifyReviewSnapshot } from './autonomy-v2-guards.mjs';
import { reconcileSnapshot } from './autonomy-v2-recovery.mjs';

export function planClaim(task, event) {
  const eligibility = assessClaim(task, {
    now:event?.now, writer:event?.writer, expectedRevision:event?.expectedRevision,
    expectedHead:event?.expectedHead, expectedBase:event?.expectedBase
  });
  if (!eligibility.allow) return Object.freeze({ok:false,reason:eligibility.reason});
  try {
    return Object.freeze({ok:true,next:transition(task,{...event,to:STATES.CLAIMED})});
  } catch(error) {
    return Object.freeze({ok:false,reason:String(error.message)});
  }
}
export function planReview(task, event, verifiedSnapshot) {
  const checked = verifyReviewSnapshot(verifiedSnapshot,{head:task?.head,base:task?.base});
  if (!checked.valid) return Object.freeze({ok:false,reason:checked.reason});
  if (verifiedSnapshot.commentId !== event?.review?.commentId ||
      event?.review?.reviewer !== 'CLAUDE' ||
      event?.review?.verdict !== 'GREEN_LIGHT')
    return Object.freeze({ok:false,reason:'EVIDENCE_MISMATCH'});
  try {
    return Object.freeze({ok:true,next:transition(task,{...event,to:STATES.REVIEW_GREEN})});
  } catch(error) {
    return Object.freeze({ok:false,reason:String(error.message)});
  }
}
export function planResume(local,remote,intent) {
  return reconcileSnapshot(local,remote,intent);
}

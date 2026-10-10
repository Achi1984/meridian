/**
 * Offline-only review coordinator: pure decision logic, no GitHub or agent dispatch.
 * Caller must supply immutable authenticated evidence via a future trusted adapter.
 * This function does not authenticate input or authorize any mutation.
 */
export class ReviewCoordinationError extends Error {
  constructor(code){super(code);this.code=code;this.name='ReviewCoordinationError';}
}
const must=(v,code)=>{if(!v)throw new ReviewCoordinationError(code);};
const sha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const id=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(s);
export function classifyReview({requestId,headSha,responses=[],inFlight=[]}={}){
  must(id(requestId)&&sha(headSha),'INVALID_SCOPE');
  must(Array.isArray(responses)&&Array.isArray(inFlight),'INVALID_COLLECTION');
  const scoped=responses.filter(x=>x&&x.requestId===requestId);
  must(scoped.every(x=>sha(x.headSha)&&typeof x.verdict==='string'),'MALFORMED_RESPONSE');
  must(!scoped.some(x=>x.headSha!==headSha),'REQUEST_HEAD_CONFLICT');
  const verdicts=scoped.map(x=>x.verdict);
  must(verdicts.every(v=>['GREEN_LIGHT','NEEDS_MORE_EVIDENCE','REVISION_REQUIRED','CHANGES_REQUIRED','STALE_HEAD'].includes(v)),'UNKNOWN_VERDICT');
  if(verdicts.some(v=>v!=='GREEN_LIGHT'))return Object.freeze({status:'BLOCKED',reason:'STRICTEST_VERDICT',mayRequest:false,mayMerge:false});
  if(verdicts.length)return Object.freeze({status:'REVIEWED',reason:'GREEN_UNVERIFIED',mayRequest:false,mayMerge:false});
  const active=inFlight.filter(x=>x&&x.requestId===requestId);
  must(!active.some(x=>x.headSha!==headSha),'INFLIGHT_HEAD_CONFLICT');
  if(active.length)return Object.freeze({status:'WAITING',reason:'ALREADY_REQUESTED',mayRequest:false,mayMerge:false});
  return Object.freeze({status:'UNREQUESTED',reason:'OFFLINE_ONLY',mayRequest:false,mayMerge:false});
}

// Offline consistency check only. Claimed provenance is NEVER authenticated.
export class EvidenceError extends Error {
  constructor(code) { super(code); this.name='EvidenceError'; this.code=code; }
}
const fail=code=>{throw new EvidenceError(code);};
function plain(value,keys) {
  if(value===null||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('INVALID_OBJECT');
  const names=Reflect.ownKeys(value);
  if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)))fail('UNKNOWN_FIELDS');
  const copy={};
  for(const k of keys){
    const d=Object.getOwnPropertyDescriptor(value,k);
    if(!d||!Object.hasOwn(d,'value'))fail('ACCESSOR_REJECTED');
    copy[k]=d.value;
  }
  return Object.freeze(copy);
}
const expectedKeys=['requestId','opId','headSha','baseSha','repository'];
const evidenceKeys=[...expectedKeys,'ciRunId','ciWorkflow','ciHeadSha','ciStatus','ciConclusion','reviewCommentId','reviewAuthor','reviewHead','reviewVerdict'];
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(x);
const sha=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
export function validateEvidence(evidence,expected,seen) {
  const pinned=plain(expected,expectedKeys), claim=plain(evidence,evidenceKeys);
  if(!validId(pinned.requestId)||!validId(pinned.opId)||pinned.repository!=='Achi1984/meridian')fail('EXPECTED_SCOPE_INVALID');
  if(!sha(pinned.headSha)||!sha(pinned.baseSha)||pinned.headSha===pinned.baseSha)fail('INVALID_SHA');
  for(const k of expectedKeys)if(claim[k]!==pinned[k])fail('SCOPE_MISMATCH');
  if(!positive(claim.ciRunId)||claim.ciWorkflow!=='MERIDIAN Release Safety'||claim.ciHeadSha!==pinned.headSha)fail('CI_PROVENANCE_CLAIM_INVALID');
  if(claim.ciStatus!=='completed'||claim.ciConclusion!=='success')fail('CI_NOT_GREEN');
  if(!positive(claim.reviewCommentId)||claim.reviewAuthor!=='CLAUDE'||claim.reviewHead!==pinned.headSha)fail('REVIEW_PROVENANCE_CLAIM_INVALID');
  if(claim.reviewVerdict!=='GREEN_LIGHT')fail('REVIEW_NOT_GREEN');
  if(!(seen instanceof Set))fail('REPLAY_STORE_REQUIRED');
  const key=pinned.opId+'|'+pinned.requestId+'|'+pinned.headSha;
  if(seen.has(key))fail('REPLAY_DETECTED');
  // Local one-shot reservation only; not durable, authenticated or cross-process.
  seen.add(key);
  return Object.freeze({offlineConsistent:true,provenanceVerified:false,authenticated:false,authorized:false,mergeAllowed:false,dispatchAllowed:false});
}
export function requireAuthenticatedTransport(){fail('AUTHENTICATED_TRANSPORT_UNAVAILABLE');}

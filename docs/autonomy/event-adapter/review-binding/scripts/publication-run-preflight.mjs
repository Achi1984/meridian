// Preparation only: no pool, reservation, credential acquisition or sender capability.
import {prepareAdmission} from './publication-service.mjs';
import {createGithubEvidenceReader} from './publication-github-reader.mjs';
const keys='actorId,event,ref,repository,runAttempt,runId,sha';
function need(ok){if(!ok)throw Error('PREFLIGHT_REJECTED');}
export async function preflightPublication(request,trustedConfig,hostContext,{fetchFn=globalThis.fetch,clock=()=>Math.floor(Date.now()/1000)}={}){
 try{
  need(request&&Object.keys(request).sort().join()==='body,token');
  const input={body:request.body,token:request.token};
  const config=JSON.parse(JSON.stringify(trustedConfig));
  const context=JSON.parse(JSON.stringify(hostContext));
  need(context&&Object.keys(context).sort().join()===keys);
  const pins=JSON.parse(config.pinsRaw),scope=JSON.parse(config.scopeRaw);
  need(context.repository==='Achi1984/meridian'&&context.actorId===319562141
   &&config.ownerId===319562141&&context.event==='workflow_dispatch'
   &&context.ref==='refs/heads/main'&&context.runAttempt===1
   &&context.runId===pins.runId&&context.sha===pins.controlSha);
  // Reader URLs and identity checks are derived from the same pinned plan.
  // No caller-provided evidence object/reader and no arbitrary URL are accepted.
  const readEvidence=createGithubEvidenceReader({repositoryId:pins.repositoryId,ownerId:config.ownerId,
   approvalCommentId:pins.ownerApprovalCommentId,prNumber:scope.prNumber,
   ciRunId:scope.ci.runId,publisherRunId:pins.runId},{fetchFn});
  const result=await prepareAdmission(input,config,{readEvidence,fetchFn,clock});
  need(result.kind==='UNAUTHENTICATED_ADMISSION_CANDIDATE');
  return {kind:'PREFLIGHT_VALIDATED_NO_SEND',binding:result.ledgerBinding,
   authenticated:false,authorized:false,productionDurability:false,sendAllowed:false};
 }catch{return {kind:'PREFLIGHT_REJECTED',authenticated:false,authorized:false,
  productionDurability:false,sendAllowed:false};}
}
// A valid preflight is not a reservation receipt or permission to publish.
// Context/config/fetch are trusted host inputs, not an authenticated HTTP boundary.

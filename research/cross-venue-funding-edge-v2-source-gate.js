const RULESET='CROSS-VENUE-FUNDING-EDGE-V2';
const EVAL_SCHEMA='CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-EVALUATION-1';
const FINAL_OUTCOMES=new Set([
  'VALID_WITH_INTEGRITY_EPISODES',
  'VALID_CLEAN',
  'CROSS_VENUE_V2_SOURCE_FAIL'
]);
const HEX40=/^[a-f0-9]{40}$/;
const HEX64=/^[a-f0-9]{64}$/;

function invalid(reason){
  throw new Error('CROSS_VENUE_V2_SOURCE_GATE_INVALID_STATE:'+reason);
}
function isObj(x){return !!x&&typeof x==='object'&&!Array.isArray(x)}
function int(x){return Number.isInteger(x)&&x>0}
function str(x){return typeof x==='string'&&x.length>0}

function validateCanonicalRun(run,label,{agent=false}={}){
  if(!isObj(run))invalid(label+'_CANONICAL_RUN_MISSING');
  if(!int(run.runId))invalid(label+'_RUN_ID');
  if(agent){
    if(!str(run.receiptDigest)||!HEX64.test(run.receiptDigest))invalid(label+'_RECEIPT_DIGEST');
    return;
  }
  if(!int(run.runAttempt))invalid(label+'_RUN_ATTEMPT');
  if(!str(run.commitSha)||!HEX40.test(run.commitSha))invalid(label+'_COMMIT_SHA');
  if(!int(run.artifactId))invalid(label+'_ARTIFACT_ID');
  if(!str(run.receiptDigest)||!HEX64.test(run.receiptDigest))invalid(label+'_RECEIPT_DIGEST');
  if(!str(run.artifactZipSha256)||!HEX64.test(run.artifactZipSha256))invalid(label+'_ZIP_SHA256');
  if(!str(run.sourcePackageSha256)||!HEX64.test(run.sourcePackageSha256))invalid(label+'_PACKAGE_SHA256');
}

function assertSame(a,b,field,label){
  if(a?.[field]!==b?.[field])invalid(label+'_'+field.toUpperCase()+'_MISMATCH');
}

function validateFinalEvaluation({evaluation,resumeV2,agentCheckpoint}){
  if(!isObj(evaluation))invalid('EVALUATION_INVALID');
  if(evaluation.schema!==EVAL_SCHEMA)invalid('EVALUATION_SCHEMA');
  if(evaluation.ruleset!==RULESET)invalid('EVALUATION_RULESET');
  if(evaluation.stage!=='SOURCE_AUDIT')invalid('EVALUATION_STAGE');
  if(evaluation.sourceAuditFinal!==true)invalid('EVALUATION_NOT_FINAL');
  if(evaluation.strategyPnlCalculated!==false)invalid('EVALUATION_PNL_FLAG');
  if(!FINAL_OUTCOMES.has(evaluation.sourceAuditOutcome))invalid('EVALUATION_OUTCOME');

  const i=evaluation.interpretation;
  if(!isObj(i))invalid('EVALUATION_INTERPRETATION');
  if(i.discoveryAuthorized!==false)invalid('DISCOVERY_AUTHORIZED');
  if(i.strategyPnlAuthorized!==false)invalid('STRATEGY_PNL_AUTHORIZED');
  if(i.laterStageTransitionAuthorized!==false)invalid('LATER_STAGE_AUTHORIZED');

  if(!isObj(resumeV2))invalid('RESUME_V2_MISSING');
  if(resumeV2.sourceAuditEvaluated!==true)invalid('RESUME_NOT_EVALUATED');
  if(resumeV2.sourceAuditOutcome!==evaluation.sourceAuditOutcome)invalid('RESUME_OUTCOME_MISMATCH');

  validateCanonicalRun(evaluation.canonicalSourceRun,'EVALUATION');
  validateCanonicalRun(resumeV2.canonicalSourceRun,'RESUME');
  validateCanonicalRun(agentCheckpoint?.canonicalSourceRun,'AGENT',{agent:true});

  for(const field of ['runId','runAttempt','commitSha','artifactId','receiptDigest','artifactZipSha256','sourcePackageSha256'])
    assertSame(evaluation.canonicalSourceRun,resumeV2.canonicalSourceRun,field,'EVAL_RESUME');
  assertSame(evaluation.canonicalSourceRun,agentCheckpoint.canonicalSourceRun,'runId','EVAL_AGENT');
  assertSame(evaluation.canonicalSourceRun,agentCheckpoint.canonicalSourceRun,'receiptDigest','EVAL_AGENT');
}

function continuityClaimsFinal(resumeV2,agentCheckpoint){
  return resumeV2?.sourceAuditEvaluated===true ||
    isObj(resumeV2?.canonicalSourceRun) ||
    isObj(agentCheckpoint?.canonicalSourceRun);
}

export function v2SourceCollectionGate({stageLock,evaluation,resumeV2,agentCheckpoint}={}){
  if(!isObj(stageLock))invalid('STAGE_LOCK_MISSING');
  if(stageLock.ruleset!==RULESET)invalid('STAGE_LOCK_RULESET');
  if(typeof stageLock.sourceAudit!=='boolean')invalid('STAGE_LOCK_SOURCE_AUDIT_TYPE');
  if(!isObj(resumeV2))invalid('RESUME_V2_MISSING');
  if(!isObj(agentCheckpoint))invalid('AGENT_CHECKPOINT_MISSING');

  const hasEvaluation=evaluation!==null&&evaluation!==undefined;
  if(hasEvaluation){
    validateFinalEvaluation({evaluation,resumeV2,agentCheckpoint});
    return stageLock.sourceAudit===false?'SOURCE_LOCKED_SKIP':'SOURCE_FINAL_SKIP';
  }

  if(continuityClaimsFinal(resumeV2,agentCheckpoint))
    invalid('EVALUATION_MISSING_BUT_CONTINUITY_FINAL');

  if(stageLock.sourceAudit===false)return 'SOURCE_LOCKED_SKIP';

  if(resumeV2?.sourceAuditEvaluated===true)invalid('RESUME_NOT_PRE_EVALUATION');
  return 'COLLECT_CANONICAL_SOURCE';
}

export const V2_SOURCE_GATE_STATES=Object.freeze([
  'COLLECT_CANONICAL_SOURCE',
  'SOURCE_FINAL_SKIP',
  'SOURCE_LOCKED_SKIP'
]);

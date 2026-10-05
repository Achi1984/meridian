import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const resume=JSON.parse(read('MERIDIAN_RESUME.json'));
const state=JSON.parse(read('MERIDIAN_AGENT_STATE.json'));
const handoff=read('docs/MERIDIAN_CHAT_HANDOFF.md');
const agentWorkflow=read('MERIDIAN_AGENT_WORKFLOW.md');
const decisions=read('MERIDIAN_DECISIONS.md');
const failures=[];
const check=(ok,message)=>{if(!ok)failures.push(message);};

check(resume?.project==='MERIDIAN','resume project must be MERIDIAN');
check(resume?.branch==='main','resume branch must be main');
check(/^\d+\.\d+-r\d+$/.test(String(resume?.build||'')),'resume build format invalid');
check(/^[a-f0-9]{40}$/.test(String(resume?.sourceOfTruth?.verifiedSha||'')),'resume verifiedSha invalid');
check(handoff.includes(`Build: **${resume.build}**`),'handoff build differs from resume');
check(handoff.includes(`Verified main checkpoint: **${resume.sourceOfTruth.verifiedSha}**`),'handoff verified checkpoint differs from resume');
check(state?.lastCheckpoint?.build===resume.build,'agent-state checkpoint build differs from resume');
check(state?.lastCheckpoint?.canonicalMainSha===resume?.sourceOfTruth?.verifiedSha,'agent-state checkpoint main differs from resume verified main');
const activeLane=resume?.researchDirection?.activeLane||null;
check(activeLane==='CROSS_VENUE_FUNDING_EDGE_V2','active research lane must be Cross-Venue Funding Edge V2');
check(String(resume?.researchDirection?.selected||'').startsWith('CROSS_VENUE_FUNDING_EDGE_V2'),'researchDirection.selected must match active Cross-Venue V2 lane');
check(String(resume?.phase||'').includes('CROSS_VENUE_FUNDING_EDGE'),'resume phase must match active Cross-Venue lane');
check(String(resume?.nextAction||'').includes('CROSS-VENUE-FUNDING-EDGE-V2'),'resume nextAction must match active Cross-Venue V2 lane');
check(state?.researchCheckpoint?.successorRuleset==='CROSS-VENUE-FUNDING-EDGE-V2','agent-state research checkpoint must match active V2 ruleset');
check(state?.researchCheckpoint?.successorStage==='SOURCE_AUDIT','active V2 stage must be SOURCE_AUDIT after reviewed authorization');
check(state?.researchCheckpoint?.sourceAuditAuthorized===true,'active V2 source audit must be authorized');
check(state?.researchCheckpoint?.strategyPnlObserved===false,'V2 strategy PnL must remain unobserved during source audit');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.stage==='SOURCE_AUDIT','resume V2 stage must be SOURCE_AUDIT');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.sourceAuditAuthorized===true,'resume must authorize V2 source audit');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.strategyPnlAuthorized===false,'resume must keep V2 strategy PnL locked');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.sourceAuditEvaluated===true,'resume must persist evaluated V2 source audit');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.sourceAuditOutcome==='VALID_WITH_INTEGRITY_EPISODES','resume must persist canonical V2 source state');
const canonicalV2Source=resume?.canonicalResearch?.crossVenueFundingEdgeV2?.canonicalSourceRun||{};
check(canonicalV2Source.runId===37290831222,'canonical V2 source runId mismatch');
check(canonicalV2Source.runAttempt===1,'canonical V2 source runAttempt mismatch');
check(canonicalV2Source.commitSha==='63f93aa41b6e054b229309b6fd6fbc2447a92181','canonical V2 source commit mismatch');
check(canonicalV2Source.artifactId===11336541442,'canonical V2 source artifact mismatch');
check(canonicalV2Source.receiptDigest==='822a42728e8f9c1da61059eb31d10fea9771adac34042dfede6fa9f3e63845d5','canonical V2 source receipt digest mismatch');
check(state?.researchCheckpoint?.sourceAuditEvaluated===true,'agent state must persist evaluated V2 source audit');
check(state?.researchCheckpoint?.sourceAuditOutcome==='VALID_WITH_INTEGRITY_EPISODES','agent state V2 source outcome mismatch');
check(state?.researchCheckpoint?.canonicalSourceRun?.runId===canonicalV2Source.runId,'agent/resume V2 canonical source run mismatch');
check(state?.researchCheckpoint?.canonicalSourceRun?.receiptDigest===canonicalV2Source.receiptDigest,'agent/resume V2 receipt digest mismatch');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.runnerImplementationCandidate===false,'V2 runner implementation candidate must be closed after reviewed merge');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.runnerImplementationStatus==='FROZEN_REVIEWED_NO_PNL','V2 runner implementation must be frozen/reviewed after merge');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.runnerImplementationMergeSha==='f188fe5af0eba4e486f6ec9193f0a8b7f6a3f530','V2 runner implementation merge SHA mismatch');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.runnerImplementationReview==='CV2-RUNNER-IMPL-R2_GREEN_LIGHT','V2 runner implementation review checkpoint mismatch');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.nextRequiredGate==='USER_AND_CROSS_MODEL_AUTHORIZATION_BEFORE_CANONICAL_V2_EXECUTION_OR_DISCOVERY','V2 next gate must require explicit user and cross-model authorization before canonical execution or Discovery');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.runnerStrategyPnlCalculated===false,'V2 runner candidate must not calculate strategy PnL');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.discoveryAuthorized===false,'V2 Discovery must remain locked during runner implementation review');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.validationAuthorized===false,'V2 Validation must remain locked during runner implementation review');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.holdoutAuthorized===false,'V2 Holdout must remain locked during runner implementation review');
check(state?.researchCheckpoint?.runnerImplementationCandidate===false,'agent state must close V2 runner implementation candidate after merge');
check(state?.researchCheckpoint?.runnerImplementationStatus==='FROZEN_REVIEWED_NO_PNL','agent state V2 runner status mismatch');
check(state?.researchCheckpoint?.runnerImplementationMergeSha==='f188fe5af0eba4e486f6ec9193f0a8b7f6a3f530','agent state V2 runner merge SHA mismatch');
check(state?.researchCheckpoint?.next==='USER_AND_CROSS_MODEL_AUTHORIZATION_BEFORE_CANONICAL_V2_EXECUTION_OR_DISCOVERY','agent state V2 next gate mismatch');
check(state?.researchCheckpoint?.strategyPnlObserved===false,'agent state must keep V2 strategy PnL unobserved');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.sourceCollectionSeal?.mergeSha==='9d0cddfc005af41b8795f6353530075367ddaec6','V2 source seal merge checkpoint mismatch');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.eventBuilder?.mergeSha==='ac962ec561c9e31715641986afd9f722ef9c5b38','V2 event builder merge checkpoint mismatch');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.structuralRunnerAdapter?.mergeSha==='3360fb555b56a1abf72924ece6554ecbcfdd72a3','V2 structural runner adapter merge checkpoint mismatch');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.strategyDriver?.mergeSha==='886544fe9220ce96204f7007b2488a1a97126b02','V2 strategy driver merge checkpoint mismatch');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.strategyDriver?.strategyPnlCalculated===false,'V2 strategy driver checkpoint must remain no-PnL');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.canonicalExecutionAuthorized===false,'V2 canonical execution must remain locked');
check(state?.researchCheckpoint?.strategyDriver?.mergeSha==='886544fe9220ce96204f7007b2488a1a97126b02','agent state V2 strategy driver merge checkpoint mismatch');
check(state?.researchCheckpoint?.canonicalExecutionAuthorized===false,'agent state V2 canonical execution must remain locked');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.diagnosticSourceConfirmation?.runId===37299638135,'V2 diagnostic source confirmation run mismatch');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.diagnosticSourceConfirmation?.receiptDigest===canonicalV2Source.receiptDigest,'V2 diagnostic receipt must match canonical receipt');
check(resume?.canonicalResearch?.crossVenueFundingEdgeV2?.diagnosticSourceConfirmation?.canonicalReplacement===false,'V2 diagnostic source run must never replace canonical evidence');
check(state?.researchCheckpoint?.diagnosticSourceConfirmation?.receiptDigest===canonicalV2Source.receiptDigest,'agent state V2 diagnostic receipt mismatch');
check(resume?.researchDirection?.qhImbalanceV1Status==='PAUSED_FROZEN_CANONICAL_PREREGISTERED_NO_PNL','Quarter-Hour lane must be explicitly paused while Cross-Venue V2 is active');
check(agentWorkflow.includes('MERIDIAN_LEAD_LEASE.json.crossModelReviewRequiredFor'),'agent workflow must define cross-model review-required categories');
check(agentWorkflow.includes('MERIDIAN_LEAD_LEASE.json.subAgent'),'agent workflow must bind cross-model review authority to lease.subAgent');
check(agentWorkflow.includes('An internal GPT-6 review never substitutes'),'agent workflow must forbid internal review substitution');
check(decisions.includes('D-076 — Cross-model review precedence over Lead-internal reviewer targets'),'decision log must record cross-model review precedence');
check(decisions.includes('MERIDIAN_LEAD_LEASE.json.crossModelReviewRequiredFor'),'decision log must reference cross-model review-required categories');
check(decisions.includes('MERIDIAN_LEAD_LEASE.json.subAgent'),'decision log must bind review authority to lease.subAgent');

const gate=resume?.researchDirection?.qhImbalanceV1CurrentGate||null;
if(gate){
  check(/^V\d+(?:\.\d+)?$/.test(String(gate.dataVersion||'')),'current research gate dataVersion invalid');
  check(['PASS','FAIL','ACTIVE','CANARY_PASS'].includes(String(gate.status||'')),'current research gate status invalid');
  check(typeof gate.decision==='string'&&gate.decision.length>0,'current research gate decision missing');
  check(gate.executionImpact===false,'data-quality gate must remain executionImpact=false');
  check(gate.paperAuthorized===false,'data-quality gate must not authorize Paper');
  check(gate.liveAuthorized===false,'data-quality gate must not authorize live execution');
  check(gate.directionalSignalCalculated===false,'data-quality gate must not calculate directional signals');
  check(gate.forwardReturnsCalculated===false,'data-quality gate must not calculate forward returns');
  check(gate.positionsCalculated===false,'data-quality gate must not calculate positions');
  check(gate.strategyPnlCalculated===false,'data-quality gate must not calculate strategy PnL');
  check(handoff.includes(`Research gate: **${gate.dataVersion} ${gate.status}**`),'handoff current research gate differs from resume');
  check(handoff.includes(`Full-run decision: **${gate.decision}**`),'handoff research decision differs from resume');

  const full=gate.fullRun||null;
  if(full){
    check(Number(full.runId)>0,'full-run id missing');
    check(Number(full.artifactId)>0,'aggregate artifact id missing');
    check(/^sha256:[a-f0-9]{64}$/.test(String(full.digest||'')),'aggregate artifact digest invalid');
    check(Number(full.expectedShards)>0,'expectedShards must be positive');
    check(Number(full.observedShards)>=0,'observedShards invalid');
    check(Array.isArray(full.gateReasons),'full-run gateReasons must be an array');
  }

  if(gate.status==='PASS'){
    check(full!=null,'PASS requires full-run evidence');
    check(Number(full?.observedShards)===Number(full?.expectedShards),'PASS requires observedShards == expectedShards');
    check((full?.gateReasons||[]).length===0,'PASS requires zero hard gate reasons');
    check(/PASS/.test(String(gate.decision)),'PASS gate decision must contain PASS');
    if(gate.strategyPreregistrationRequired===true){
      check(/STRATEGY.*PREREGISTRATION/i.test(String(resume?.researchDirection?.nextStage||'')),'PASS requiring preregistration must point nextStage to strategy preregistration');
      check(!/full\s*run|source-feasibility/i.test(String(resume?.nextAction||'')),'PASS state must not ask to repeat data full run/source feasibility');
    }
  }

  if(gate.status==='FAIL'){
    check(!/STRATEGY.*PREREGISTRATION/i.test(String(resume?.researchDirection?.nextStage||'')),'FAIL data gate must not advance to strategy preregistration');
  }
}

if(failures.length){
  console.error('MERIDIAN continuity audit failed');
  for(const failure of failures)console.error(`- ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({
  ok:true,
  build:resume.build,
  phase:resume.phase,
  verifiedSha:resume.sourceOfTruth.verifiedSha,
  currentResearchGate:gate?{dataVersion:gate.dataVersion,status:gate.status,decision:gate.decision}:null,
  nextStage:resume.researchDirection?.nextStage||null
},null,2));

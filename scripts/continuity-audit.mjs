import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const resume=JSON.parse(read('MERIDIAN_RESUME.json'));
const state=JSON.parse(read('MERIDIAN_AGENT_STATE.json'));
const handoff=read('docs/MERIDIAN_CHAT_HANDOFF.md');
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
check(state?.researchCheckpoint?.successorStage==='PREREGISTERED','active V2 must remain PREREGISTERED before implementation/source-contract review');
check(resume?.researchDirection?.qhImbalanceV1Status==='PAUSED_FROZEN_CANONICAL_PREREGISTERED_NO_PNL','Quarter-Hour lane must be explicitly paused while Cross-Venue V2 is active');

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

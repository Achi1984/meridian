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

const v11Workflow=path.join(root,'.github/workflows/qh-individual-trades-data-v1-1.yml');
if(fs.existsSync(v11Workflow)){
  check(!/source-feasibility audit/i.test(String(resume?.nextAction||'')),'resume nextAction is stale: V1.1 exists but still requests source feasibility');
  check(!/SOURCE_V0_1/.test(String(resume?.researchDirection?.nextStage||'')),'resume nextStage is stale: V1.1 exists but points to source V0.1');
  check(/V1_1|V1\.1/.test(String(resume?.phase||'')),'resume phase must identify Data V1.1 after V1.1 workflow merge');
  check(resume?.researchDirection?.qhImbalanceV1DataV11CanaryWorkflowRun>0,'V1.1 canary workflow evidence missing');
  check(resume?.researchDirection?.qhImbalanceV1DataV11FullRunAuthorized===true,'V1.1 full-run authorization missing after canary pass');
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
  nextStage:resume.researchDirection?.nextStage||null
},null,2));

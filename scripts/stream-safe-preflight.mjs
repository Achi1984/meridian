import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const shortSha=v=>String(v||'').slice(0,12)||null;
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));

export function compactWorkflowRuns(runs=[]){
  return (Array.isArray(runs)?runs:[])
    .filter(x=>x&&x.name)
    .slice(0,12)
    .map(x=>({name:String(x.name),status:String(x.status||''),conclusion:x.conclusion==null?null:String(x.conclusion)}));
}

export function compactCheckpoint(input={}){
  const mainSha=shortSha(input.mainSha),headSha=shortSha(input.headSha),prNumber=Number.isInteger(Number(input.prNumber))?Number(input.prNumber):null;
  return {
    protocol:'STREAM-SAFE-V3',
    resumeToken:[mainSha,input.branch||'main',headSha,prNumber==null?'no-pr':'pr-'+prNumber].filter(Boolean).join(':'),
    streamBudget:{toolBatches:2,sameStatusPolls:1,maxPayloadBytes:8192,maxTurnSeconds:120},
    mainSha,
    terminalBuild:input.terminalBuild||null,
    branch:input.branch||null,
    headSha,
    prNumber,
    prState:input.prState||null,
    aheadBy:Number.isFinite(Number(input.aheadBy))?Number(input.aheadBy):null,
    behindBy:Number.isFinite(Number(input.behindBy))?Number(input.behindBy):null,
    gates:compactWorkflowRuns(input.gates)
  };
}

function localGit(args,fallback=null){
  try{return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()||fallback}
  catch{return fallback}
}
async function gh(path){
  const token=String(process.env.GITHUB_TOKEN||'').trim();
  const repo=String(process.env.GITHUB_REPOSITORY||'').trim();
  must(token,'GITHUB_TOKEN missing');
  must(repo,'GITHUB_REPOSITORY missing');
  const r=await fetch((process.env.GITHUB_API_URL||'https://api.github.com')+'/repos/'+repo+path,{
    headers:{accept:'application/vnd.github+json',authorization:'Bearer '+token,'x-github-api-version':'2022-11-28'}
  });
  if(!r.ok)throw new Error('GitHub API '+r.status+' '+path+': '+(await r.text()).slice(0,300));
  return r.json();
}
async function versionAt(ref){
  const x=await gh('/contents/version.json?ref='+encodeURIComponent(ref));
  return JSON.parse(Buffer.from(String(x.content||'').replace(/\n/g,''),'base64').toString('utf8'));
}
async function githubCheckpoint(){
  const branch=String(process.env.GITHUB_HEAD_REF||process.env.GITHUB_REF_NAME||localGit(['branch','--show-current'],'')).trim()||null;
  const [mainCommit,mainVersion,pulls]=await Promise.all([
    gh('/commits/main'),
    versionAt('main'),
    gh('/pulls?state=open&base=main&per_page=100')
  ]);
  const pr=branch?(pulls||[]).find(x=>x?.head?.ref===branch):null;
  const headSha=pr?.head?.sha||localGit(['rev-parse','HEAD'],null);
  let aheadBy=null,behindBy=null;
  if(branch&&branch!=='main'){
    try{
      const cmp=await gh('/compare/main...'+encodeURIComponent(branch));
      aheadBy=cmp?.ahead_by;
      behindBy=cmp?.behind_by;
    }catch{}
  }
  let gates=[];
  if(headSha){
    try{
      const runs=await gh('/actions/runs?head_sha='+encodeURIComponent(headSha)+'&per_page=20');
      gates=runs?.workflow_runs||[];
    }catch{}
  }
  return compactCheckpoint({
    mainSha:mainCommit?.sha,
    terminalBuild:mainVersion?.terminalBuild,
    branch,
    headSha,
    prNumber:pr?.number,
    prState:pr?.state,
    aheadBy,
    behindBy,
    gates
  });
}
function localCheckpoint(){
  const v=readJson('version.json');
  return compactCheckpoint({
    mainSha:null,
    terminalBuild:v?.terminalBuild,
    branch:localGit(['branch','--show-current'],null),
    headSha:localGit(['rev-parse','HEAD'],null),
    gates:[]
  });
}

const direct=process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\','/'));
if(direct){
  const out=process.env.GITHUB_TOKEN&&process.env.GITHUB_REPOSITORY?await githubCheckpoint():localCheckpoint();
  const line=JSON.stringify(out);
  if(Buffer.byteLength(line,'utf8')>4096)throw new Error('stream-safe checkpoint exceeded 4096 bytes');
  console.log(line);
}

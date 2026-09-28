import fs from 'node:fs';

const must=(ok,msg)=>{if(!ok)throw new Error(msg)};

export function terminalRevision(build){
  const m=/^10\.0-r(\d+)$/.exec(String(build||'').trim());
  return m?Number(m[1]):null;
}
export function releaseBranchRevision(branch){
  const m=/(?:^|\/)v10-r(\d+)(?:-|$)/.exec(String(branch||'').trim());
  return m?Number(m[1]):null;
}
export function assessReleasePr({mainBuild,candidateBuild,branch,currentPrNumber,openPrs=[]}){
  const mainRev=terminalRevision(mainBuild),candidateRev=terminalRevision(candidateBuild),branchRev=releaseBranchRevision(branch);
  if(mainRev==null||candidateRev==null)return{ok:false,release:false,reason:'invalid terminalBuild identity'};
  if(candidateRev===mainRev){
    if(branchRev!=null)return{ok:false,release:true,reason:`stale release branch ${branch} claims r${branchRev} while main is already r${mainRev}`};
    return{ok:true,release:false,reason:'non-terminal infrastructure/content PR'};
  }
  if(branchRev==null)return{ok:false,release:true,reason:`terminalBuild changed from r${mainRev} to r${candidateRev} outside a v10-rNN release branch`};
  if(branchRev!==candidateRev)return{ok:false,release:true,reason:`branch claims r${branchRev} but version.json claims r${candidateRev}`};
  if(candidateRev!==mainRev+1)return{ok:false,release:true,reason:`release must be exactly main+1: main r${mainRev}, candidate r${candidateRev}`};
  const contenders=openPrs
    .filter(pr=>Number(pr?.number)!==Number(currentPrNumber)&&String(pr?.state||'open')==='open')
    .filter(pr=>releaseBranchRevision(pr?.head?.ref)===candidateRev)
    .sort((a,b)=>Number(a.number)-Number(b.number));
  if(contenders.length){
    const owner=contenders[0];
    if(Number(owner.number)<Number(currentPrNumber)){
      return{ok:false,release:true,reason:`release r${candidateRev} lease is already owned by older open PR #${owner.number} (${owner.head?.ref||'unknown'})`};
    }
  }
  return{ok:true,release:true,reason:`release r${candidateRev} owns the current lease`};
}
export function staleReleasePrNumbers(mainBuild,openPrs=[]){
  const mainRev=terminalRevision(mainBuild);
  if(mainRev==null)return[];
  return openPrs
    .filter(pr=>String(pr?.state||'open')==='open')
    .map(pr=>({pr,rev:releaseBranchRevision(pr?.head?.ref)}))
    .filter(x=>x.rev!=null&&x.rev<=mainRev)
    .map(x=>Number(x.pr.number))
    .filter(Number.isInteger);
}

function readJson(path){return JSON.parse(fs.readFileSync(path,'utf8'))}
async function api(path,options={}){
  const token=process.env.GITHUB_TOKEN;
  const repo=process.env.GITHUB_REPOSITORY;
  must(token,'GITHUB_TOKEN missing');
  must(repo,'GITHUB_REPOSITORY missing');
  const url=(process.env.GITHUB_API_URL||'https://api.github.com')+'/repos/'+repo+path;
  const r=await fetch(url,{...options,headers:{accept:'application/vnd.github+json',authorization:'Bearer '+token,'x-github-api-version':'2022-11-28',...(options.headers||{})}});
  if(!r.ok)throw new Error(`GitHub API ${r.status} ${path}: ${(await r.text()).slice(0,500)}`);
  if(r.status===204)return null;
  return r.json();
}
async function versionAt(ref){
  const x=await api('/contents/version.json?ref='+encodeURIComponent(ref));
  return JSON.parse(Buffer.from(String(x.content||'').replace(/\n/g,''),'base64').toString('utf8'));
}
async function openMainPrs(){
  return api('/pulls?state=open&base=main&per_page=100');
}
async function guard(){
  const event=readJson(process.env.GITHUB_EVENT_PATH);
  must(event?.pull_request,'pull_request event required');
  const pr=event.pull_request;
  const local=readJson('version.json');
  const main=await versionAt(pr.base.ref||'main');
  const open=await openMainPrs();
  const result=assessReleasePr({
    mainBuild:main.terminalBuild,
    candidateBuild:local.terminalBuild,
    branch:pr.head.ref,
    currentPrNumber:pr.number,
    openPrs:open
  });
  console.log('release-coordinator guard',JSON.stringify({pr:pr.number,branch:pr.head.ref,main:main.terminalBuild,candidate:local.terminalBuild,...result}));
  must(result.ok,result.reason);
}
async function sweep(){
  const main=readJson('version.json');
  const open=await openMainPrs();
  const stale=new Set(staleReleasePrNumbers(main.terminalBuild,open));
  for(const pr of open){
    if(!stale.has(Number(pr.number)))continue;
    console.log('closing stale release PR',pr.number,pr.head?.ref,'main',main.terminalBuild);
    await api('/pulls/'+pr.number,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({state:'closed'})});
  }
  console.log('release-coordinator sweep complete',JSON.stringify({main:main.terminalBuild,closed:[...stale]}));
}

const mode=process.argv[2];
if(mode==='--guard')await guard();
else if(mode==='--sweep')await sweep();
else if(mode&&!['--test'].includes(mode))throw new Error('usage: node scripts/release-coordinator.mjs --guard|--sweep');

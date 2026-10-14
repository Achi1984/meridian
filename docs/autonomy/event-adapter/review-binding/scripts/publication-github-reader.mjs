// Inactive fixed-origin GET-only evidence adapter. No token acquisition or writes.
const ROOT='https://api.github.com/repos/Achi1984/meridian';
function need(ok){if(!ok)throw new Error('GITHUB_EVIDENCE_REJECTED');}
function positive(n){return Number.isSafeInteger(n)&&n>0;}
function sha(s){return typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);}
function bounded(s,n){return typeof s==='string'&&Buffer.byteLength(s)<=n;}
function checked(config){
 need(config&&Object.keys(config).sort().join()==='approvalCommentId,ciRunId,ownerId,prNumber,publisherRunId,repositoryId');
 need(Object.values(config).every(positive));return {...config};
}
function endpoints(c){return [ROOT,`${ROOT}/issues/comments/${c.approvalCommentId}`,
 `${ROOT}/pulls/${c.prNumber}`,`${ROOT}/actions/runs/${c.ciRunId}`,`${ROOT}/actions/runs/${c.publisherRunId}`];}
export function normalizeGithubEvidence(config,records){
 const c=checked(config);need(Array.isArray(records)&&records.length===5);
 const [repo,approval,pr,ci,publisher]=records;
 need(repo?.id===c.repositoryId&&repo.full_name==='Achi1984/meridian'&&repo.owner?.id===c.ownerId&&repo.owner.login==='Achi1984');
 need(approval?.id===c.approvalCommentId&&approval.issue_url===ROOT+'/issues/571'
  &&approval.url===`${ROOT}/issues/comments/${c.approvalCommentId}`
  &&approval.user?.id===c.ownerId&&approval.user.type==='User'
  &&approval.author_association==='OWNER'&&approval.performed_via_github_app===null
  &&bounded(approval.body,8192)&&bounded(approval.updated_at,64));
 // App-authored proposals under the owner's account are never direct owner approval.
 need(pr?.number===c.prNumber&&pr.url===`${ROOT}/pulls/${c.prNumber}`
  &&pr.base?.repo?.id===c.repositoryId&&pr.head?.repo?.id===c.repositoryId
  &&sha(pr.head.sha)&&sha(pr.base.sha)&&['open','closed'].includes(pr.state));
 function run(raw,id){
  need(raw?.id===id&&raw.url===`${ROOT}/actions/runs/${id}`&&raw.repository?.id===c.repositoryId
   &&raw.head_repository?.id===c.repositoryId&&positive(raw.run_attempt)&&positive(raw.workflow_id)
   &&sha(raw.head_sha)&&bounded(raw.head_branch,255)&&raw.head_branch.length>0
   &&bounded(raw.path,255)&&raw.path.startsWith('.github/workflows/')
   &&bounded(raw.event,64)&&bounded(raw.status,64));
  need(raw.conclusion===null||bounded(raw.conclusion,64));
  return {repositoryId:c.repositoryId,id,runAttempt:raw.run_attempt,workflowId:raw.workflow_id,
   headSha:raw.head_sha,ref:'refs/heads/'+raw.head_branch,workflowPath:raw.path,event:raw.event,
   status:raw.status,conclusion:raw.conclusion};
 }
 const ciRun=run(ci,c.ciRunId),pubRun=run(publisher,c.publisherRunId);
 // Detailed exact pin/status checks remain in the actual admission service.
 return {approval:{id:approval.id,actorId:approval.user.id,repositoryId:c.repositoryId,
   issueNumber:571,body:approval.body,updatedAt:approval.updated_at},
  pr:{repositoryId:c.repositoryId,number:pr.number,headSha:pr.head.sha,baseSha:pr.base.sha,state:pr.state},
  ci:{repositoryId:ciRun.repositoryId,id:ciRun.id,runAttempt:ciRun.runAttempt,
   workflowId:ciRun.workflowId,headSha:ciRun.headSha,status:ciRun.status,conclusion:ciRun.conclusion},
  run:Object.fromEntries(Object.entries(pubRun).filter(([key])=>key!=='conclusion'))};
}
async function readOne(url,fetchFn,signal){
 const response=await fetchFn(url,{method:'GET',redirect:'error',signal,cache:'no-store',
  headers:{accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
 const valid=!signal.aborted&&response?.status===200&&response.url===url&&!response.redirected&&response.body;
 if(!valid){try{response?.body?.cancel().catch(()=>{});}catch{}need(false);}
 const reader=response.body.getReader();let total=0;const parts=[];
 const cancel=()=>{try{reader.cancel().catch(()=>{});}catch{}};
 signal.addEventListener('abort',cancel,{once:true});
 try{
  while(true){const chunk=await reader.read();need(!signal.aborted);if(chunk.done)break;
   total+=chunk.value.length;need(total<=131072);parts.push(chunk.value);}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
 }finally{signal.removeEventListener('abort',cancel);cancel();try{reader.releaseLock();}catch{}}
}
export function createGithubEvidenceReader(config,{fetchFn=globalThis.fetch}={}){
 const c=checked(config),urls=endpoints(c);
 // Public API TLS supplies source authenticity. No credentials, alternate base URL
 // or caller-selected endpoints are supported by this version.
 return async function readEvidence(parentSignal){
  need(!parentSignal?.aborted);
  const abort=new AbortController();let timer,onAbort;
  const deadline=new Promise((_,reject)=>{
   onAbort=()=>{abort.abort();reject(new Error('GITHUB_EVIDENCE_REJECTED'));};
   timer=setTimeout(onAbort,4500);
   parentSignal?.addEventListener('abort',onAbort,{once:true});
  });
  try{
   need(!abort.signal.aborted);
   const work=Promise.all(urls.map(url=>readOne(url,fetchFn,abort.signal)));
   return normalizeGithubEvidence(c,await Promise.race([work,deadline]));
  }catch{throw new Error('GITHUB_EVIDENCE_REJECTED');}
  finally{clearTimeout(timer);parentSignal?.removeEventListener('abort',onAbort);abort.abort();}
 };
}

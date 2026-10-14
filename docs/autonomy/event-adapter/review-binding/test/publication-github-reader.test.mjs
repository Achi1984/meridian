import test from 'node:test';
import assert from 'node:assert/strict';
import {createGithubEvidenceReader,normalizeGithubEvidence} from '../scripts/publication-github-reader.mjs';
const root='https://api.github.com/repos/Achi1984/meridian';
function fixture(){
 const c={repositoryId:1342084551,ownerId:319562141,approvalCommentId:11,prNumber:770,ciRunId:22,publisherRunId:33};
 const run=(id)=>({id,url:`${root}/actions/runs/${id}`,repository:{id:c.repositoryId},head_repository:{id:c.repositoryId},
 run_attempt:1,workflow_id:44,head_sha:'a'.repeat(40),head_branch:'main',path:'.github/workflows/meridian-negative-publisher.yml',
 event:'workflow_dispatch',status:'in_progress',conclusion:null});
 const records=[{id:c.repositoryId,full_name:'Achi1984/meridian',owner:{id:c.ownerId,login:'Achi1984'}},
 {id:11,url:root+'/issues/comments/11',issue_url:root+'/issues/571',user:{id:c.ownerId,type:'User'},author_association:'OWNER',
 performed_via_github_app:null,body:'Approval fixture',updated_at:'2026-10-14T05:00:00Z'},
 {number:770,url:root+'/pulls/770',base:{repo:{id:c.repositoryId},sha:'b'.repeat(40)},head:{repo:{id:c.repositoryId},sha:'a'.repeat(40)},state:'open'},
 {...run(22),status:'completed',conclusion:'success'},run(33)];
 return {c,records};
}
function fetcher(records,change=x=>x){let n=0;const calls=[];return {calls,fn:async(url,options)=>{
 calls.push({url,options});const data=records[n++];return change({status:200,url,redirected:false,body:new Response(JSON.stringify(data)).body});}};}
test('fixed five GETs normalize into exact service shape without credentials',async()=>{
 const {c,records}=fixture(),f=fetcher(records);const result=await createGithubEvidenceReader(c,{fetchFn:f.fn})();
 assert.deepEqual(Object.keys(result).sort(),['approval','ci','pr','run']);assert.equal(result.run.id,33);
 assert.equal(result.ci.conclusion,'success');assert.equal(f.calls.length,5);
 for(const call of f.calls){assert.ok(call.url.startsWith(root));assert.equal(call.options.method,'GET');
 assert.equal(call.options.redirect,'error');assert.equal(call.options.headers.authorization,undefined);}
});
test('app-authored proposal cannot become direct owner approval',()=>{
 const {c,records}=fixture();records[1].performed_via_github_app={id:1144995};
 assert.throws(()=>normalizeGithubEvidence(c,records),/REJECTED/);
 delete records[1].performed_via_github_app;assert.throws(()=>normalizeGithubEvidence(c,records),/REJECTED/);
});
test('wrong actor repository mailbox fork or run identity rejected',()=>{
 for(const edit of [r=>r[0].id++,r=>r[0].owner.id++,r=>r[1].user.id++,r=>r[1].user.type='Bot',
 r=>r[1].issue_url=root+'/issues/572',r=>r[2].head.repo.id++,r=>r[3].id++,
 r=>r[4].head_repository.id++,r=>r[4].run_attempt=true]){
 const {c,records}=fixture();edit(records);assert.throws(()=>normalizeGithubEvidence(c,records),/REJECTED/);}
});
test('invalid config cannot select endpoints or cause a fetch',()=>{
 const {c}=fixture();for(const config of [{...c,baseUrl:'https://evil.invalid'},{...c,prNumber:'../secrets'},{...c,ownerId:true}])
 assert.throws(()=>createGithubEvidenceReader(config),/REJECTED/);
});
test('redirect wrong origin API failure malformed and oversized responses reject without retry',async()=>{
 for(const change of [r=>({...r,status:403}),r=>({...r,redirected:true}),r=>({...r,url:'https://evil.invalid'}),
 r=>({...r,body:new Response('not-json').body}),r=>({...r,body:new Response('x'.repeat(131073)).body})]){
 const {c,records}=fixture(),f=fetcher(records,change);await assert.rejects(createGithubEvidenceReader(c,{fetchFn:f.fn})(),/REJECTED/);
 assert.equal(f.calls.length,5);}
});
test('caller mutation cannot repin pending readers',async()=>{
 const {c,records}=fixture(),f=fetcher(records),read=createGithubEvidenceReader(c,{fetchFn:f.fn});c.prNumber=771;
 assert.equal((await read()).pr.number,770);
});
test('hanging transport has bounded rejection',async()=>{
 const {c}=fixture();const start=Date.now();await assert.rejects(createGithubEvidenceReader(c,{fetchFn:()=>new Promise(()=>{})})(),/REJECTED/);
 assert.ok(Date.now()-start<6500);
});
test('already aborted caller causes no request',async()=>{
 const {c,records}=fixture(),f=fetcher(records),abort=new AbortController();abort.abort();
 await assert.rejects(createGithubEvidenceReader(c,{fetchFn:f.fn})(abort.signal),/REJECTED/);assert.equal(f.calls.length,0);
});

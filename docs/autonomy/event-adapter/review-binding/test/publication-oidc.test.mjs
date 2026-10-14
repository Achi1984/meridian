import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyPublicationToken} from '../scripts/publication-oidc.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',use:'sig',alg:'RS256'};
const now=1800000000;
const pins=()=>({repositoryId:'1342084551',ownerId:'319562141',runId:'1234',controlSha:'a'.repeat(40),
 subject:'repo:Achi1984/meridian:ref:refs/heads/main'});
const claims=()=>({iss:'https://token.actions.githubusercontent.com',aud:'meridian-negative-publisher',
 sub:pins().subject,repository:'Achi1984/meridian',repository_id:pins().repositoryId,
 repository_owner:'Achi1984',repository_owner_id:pins().ownerId,ref:'refs/heads/main',ref_type:'branch',
 workflow_ref:'Achi1984/meridian/.github/workflows/meridian-negative-publisher.yml@refs/heads/main',
 workflow_sha:pins().controlSha,sha:pins().controlSha,run_id:pins().runId,run_attempt:'1',
 event_name:'workflow_dispatch',runner_environment:'github-hosted',jti:'test-jti',iat:now-10,nbf:now-10,exp:now+290});
function token(c=claims(),h={alg:'RS256',typ:'JWT',kid:'test-key'},key=privateKey){
 const head=Buffer.from(JSON.stringify(h)).toString('base64url'),body=Buffer.from(JSON.stringify(c)).toString('base64url');
 const raw=head+'.'+body;return raw+'.'+sign('RSA-SHA256',Buffer.from(raw),key).toString('base64url');
}
function fetcher(data={keys:[jwk]}){const calls=[];return {calls,fn:async(url,options)=>{
 calls.push({url,options});return {status:200,url,redirected:false,body:new Response(JSON.stringify(data)).body};}};}
async function check(t=token(),p=pins(),f=fetcher()){
 return verifyPublicationToken(t,p,{fetchFn:f.fn,clock:()=>now});
}
test('signed exact token validates with fixed JWKS and no operation authority',async()=>{
 const f=fetcher(),r=await check(token(),pins(),f);assert.equal(r.tokenVerified,true);
 assert.equal(r.authenticated,false);assert.equal(r.dispatchAllowed,false);assert.equal(r.durable,false);
 assert.equal(f.calls[0].url,'https://token.actions.githubusercontent.com/.well-known/jwks');
 assert.equal(f.calls[0].options.redirect,'error');assert.equal(f.calls.length,1);
});
test('wrong audience, source, repository, run, attempt, subject or event fail before key fetch',async()=>{
 for(const [key,value] of [['aud','meridian-asset-watch'],['aud',['meridian-negative-publisher']],
 ['iss','https://evil.invalid'],['repository_id','7'],['repository_owner_id','8'],
 ['repository','other/repo'],['workflow_ref','other'],['workflow_sha','b'.repeat(40)],
 ['sha','b'.repeat(40)],['run_id','9'],['run_attempt','2'],['run_attempt',1],
 ['sub','repo:other:ref:refs/heads/main'],['event_name','pull_request'],['ref','refs/heads/other'],
 ['runner_environment','self-hosted'],['job_workflow_ref','other'],['environment','production']]){
 const f=fetcher();assert.equal((await check(token({...claims(),[key]:value}),pins(),f)).tokenVerified,false,key);
 assert.equal(f.calls.length,0,key);}
});
test('expiry, stale/future issuance, invalid types and time order rejected',async()=>{
 for(const edit of [{exp:now},{iat:now-301,nbf:now-301},{iat:now+31,nbf:now+31},
 {iat:true},{nbf:now-311},{exp:now+601},{jti:''}])assert.equal((await check(token({...claims(),...edit}))).tokenVerified,false);
});
test('algorithm/key URL confusion or unknown header rejected',async()=>{
 for(const edit of [{alg:'none'},{alg:'HS256'},{jku:'https://evil.invalid'},{crit:['x']},{typ:'other'}]){
 const f=fetcher();assert.equal((await check(token(claims(),{alg:'RS256',typ:'JWT',kid:'test-key',...edit}),pins(),f)).tokenVerified,false);
 assert.equal(f.calls.length,0);}
});
test('tampered payload and signature cannot authenticate',async()=>{
 const parts=token().split('.');const c=claims();c.jti='tampered';parts[1]=Buffer.from(JSON.stringify(c)).toString('base64url');
 assert.equal((await check(parts.join('.'))).tokenVerified,false);
 const other=generateKeyPairSync('rsa',{modulusLength:2048});assert.equal((await check(token(claims(),undefined,other.privateKey))).tokenVerified,false);
});
test('unknown duplicated wrong-use and private keys rejected',async()=>{
 for(const keys of [[],[{...jwk,kid:'other'}],[jwk,jwk],[{...jwk,use:'enc'}],[{...jwk,d:'secret'}],
 [{...jwk,key_ops:['sign']}],[{...jwk,alg:'HS256'}]])assert.equal((await check(token(),pins(),fetcher({keys}))).tokenVerified,false);
});
test('bad pin config and malformed/bounded tokens rejected',async()=>{
 for(const p of [{...pins(),runId:1234},{...pins(),ownerId:'0'},{...pins(),controlSha:'main'},
 {...pins(),subject:'anything'},{...pins(),authorized:true}])assert.equal((await check(token(),p)).tokenVerified,false);
 for(const t of ['',token()+'=', 'a.b.c','x'.repeat(16385)])assert.equal((await check(t)).tokenVerified,false);
});
test('network failure and oversized JWKS fail closed without retry',async()=>{
 let calls=0;const f={fn:async()=>{calls++;throw new Error('sensitive');}};
 assert.equal((await check(token(),pins(),f)).tokenVerified,false);assert.equal(calls,1);
 assert.equal((await check(token(),pins(),fetcher({padding:'x'.repeat(66000),keys:[jwk]}))).tokenVerified,false);
});
test('redirect or wrong origin response rejected',async()=>{
 for(const edit of [{redirected:true},{url:'https://evil.invalid'},{status:302}]){
 const f={fn:async()=>({status:200,url:'https://token.actions.githubusercontent.com/.well-known/jwks',
 redirected:false,body:new Response(JSON.stringify({keys:[jwk]})).body,...edit})};
 assert.equal((await check(token(),pins(),f)).tokenVerified,false);}
});
test('immutable subject must be explicitly pinned, never automatically substituted',async()=>{
 const p=pins();p.subject=`repo:Achi1984@${p.ownerId}/meridian@${p.repositoryId}:ref:refs/heads/main`;
 const c={...claims(),sub:p.subject};assert.equal((await check(token(c),p)).tokenVerified,true);
 assert.equal((await check(token(c),pins())).tokenVerified,false);
});
test('bounded not-before backdating is accepted without relaxing expiry',async()=>{
 assert.equal((await check(token({...claims(),nbf:now-310}))).tokenVerified,true);
 assert.equal((await check(token({...claims(),nbf:now-310,exp:now}))).tokenVerified,false);
});
test('expiry while awaiting keys is rejected after signature verification',async()=>{
 let current=now;const f=fetcher();
 const r=await verifyPublicationToken(token({...claims(),exp:now+1}),pins(),{
 clock:()=>current,fetchFn:async(...args)=>{current=now+2;return f.fn(...args);}});
 assert.equal(r.tokenVerified,false);
});
test('stalled read and uncooperative fetch are both bounded by deadline',async()=>{
 const url='https://token.actions.githubusercontent.com/.well-known/jwks';
 const stalled={fn:async()=>({status:200,url,redirected:false,body:{getReader:()=>({
 read:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{}),releaseLock(){}})}})};
 const late={fn:()=>new Promise(()=>{})};
 const started=Date.now();const results=await Promise.all([check(token(),pins(),stalled),check(token(),pins(),late)]);
 assert.ok(Date.now()-started<7000);for(const r of results)assert.equal(r.tokenVerified,false);
});
test('stalled cleanup cannot delay completed key retrieval',async()=>{
 const bytes=Buffer.from(JSON.stringify({keys:[jwk]}));let read=false;
 const f={fn:async(url)=>({status:200,url,redirected:false,body:{getReader:()=>({
 read:async()=>read?{done:true}:(read=true,{done:false,value:bytes}),
 cancel:()=>new Promise(()=>{}),releaseLock(){}})}})};
 assert.equal((await check(token(),pins(),f)).tokenVerified,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {verifyGithubActionsOidc,resetGithubOidcJwksCache} from '../github-actions-oidc.js';

function b64(x){return Buffer.from(JSON.stringify(x)).toString('base64url')}
function makeToken({privateKey,kid='k1',payload={}}){
  const header={alg:'RS256',typ:'JWT',kid};
  const p={
    iss:'https://token.actions.githubusercontent.com',
    aud:'meridian-asset-watch',
    sub:'repo:Achi1984/meridian:ref:refs/heads/main',
    repository:'Achi1984/meridian',
    repository_id:'1342084551',
    ref:'refs/heads/main',
    workflow_ref:'Achi1984/meridian/.github/workflows/asset-watch-mirror.yml@refs/heads/main',
    event_name:'schedule',
    runner_environment:'github-hosted',
    run_id:'99',
    run_number:'7',
    nbf:1700000000,
    iat:1700000000,
    exp:1700000600,
    ...payload
  };
  const input=b64(header)+'.'+b64(p);
  const sig=crypto.sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
  return input+'.'+sig;
}
function fixture(){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk=publicKey.export({format:'jwk'});
  jwk.kid='k1';jwk.use='sig';jwk.alg='RS256';
  const fetchFn=async()=>({ok:true,json:async()=>({keys:[jwk]})});
  return {privateKey,fetchFn};
}

test('accepts only the exact Meridian main-branch mirror workflow',async()=>{
  resetGithubOidcJwksCache();
  const {privateKey,fetchFn}=fixture();
  const token=makeToken({privateKey});
  const r=await verifyGithubActionsOidc(token,{fetchFn,nowMs:1700000100*1000});
  assert.equal(r.ok,true);
  assert.equal(r.claims.repository,'Achi1984/meridian');
  assert.equal(r.claims.eventName,'schedule');
});

test('rejects another repo, branch, workflow or self-hosted runner',async()=>{
  for(const payload of [
    {repository:'evil/repo'},
    {ref:'refs/heads/dev'},
    {workflow_ref:'Achi1984/meridian/.github/workflows/other.yml@refs/heads/main'},
    {runner_environment:'self-hosted'}
  ]){
    resetGithubOidcJwksCache();
    const {privateKey,fetchFn}=fixture();
    const token=makeToken({privateKey,payload});
    const r=await verifyGithubActionsOidc(token,{fetchFn,nowMs:1700000100*1000});
    assert.equal(r.ok,false);
  }
});

test('rejects stale or tampered tokens',async()=>{
  resetGithubOidcJwksCache();
  const {privateKey,fetchFn}=fixture();
  const stale=makeToken({privateKey,payload:{iat:1699990000,nbf:1699990000,exp:1700001000}});
  assert.equal((await verifyGithubActionsOidc(stale,{fetchFn,nowMs:1700000100*1000})).ok,false);
  const good=makeToken({privateKey});
  const parts=good.split('.');
  const tampered=parts[0]+'.'+b64({...JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')),run_id:'changed'})+'.'+parts[2];
  assert.equal((await verifyGithubActionsOidc(tampered,{fetchFn,nowMs:1700000100*1000})).ok,false);
});


test('accepts immutable subject variants because repository_id/ref/workflow_ref are the trust anchors',async()=>{
  resetGithubOidcJwksCache();
  const {privateKey,fetchFn}=fixture();
  const token=makeToken({privateKey,payload:{sub:'repository_id:1342084551:ref:refs/heads/main'}});
  const r=await verifyGithubActionsOidc(token,{fetchFn,nowMs:1700000100*1000});
  assert.equal(r.ok,true);
});

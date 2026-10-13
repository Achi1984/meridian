import test from 'node:test';
import assert from 'node:assert/strict';
import {createBotReadAccess} from '../v11/bot-read-access.js';

test('construction is inert and exposes only the narrow access functions',()=>{
  let calls=0;const access=createBotReadAccess({lock:()=>calls++});
  assert.equal(calls,0);assert.equal(access.getToken(),null);
  assert.deepEqual(Object.keys(access),['provide','clear','getToken']);
  assert.equal(Object.isFrozen(access),true);
});
test('explicit provide trims memory credential and locks before replacement',()=>{
  const seen=[];let access;
  access=createBotReadAccess({lock:(...args)=>seen.push({token:access.getToken(),args})});
  assert.equal(access.provide('  first-token  '),true);assert.equal(access.getToken(),'first-token');
  assert.equal(access.provide('second-token'),true);assert.equal(access.getToken(),'second-token');
  assert.deepEqual(seen,[{token:null,args:[]},{token:null,args:[]}]);
});
test('clear revokes memory credential synchronously and locks every time',()=>{
  let calls=0;const access=createBotReadAccess({lock:()=>calls++});
  access.provide('token');assert.equal(access.clear(),true);assert.equal(access.getToken(),null);
  assert.equal(access.clear(),true);assert.equal(calls,3);
});
test('invalid inputs clear previous credentials and invoke lock without coercion',()=>{
  const bad=[undefined,null,{},[],false,42,'','  ','a\nb','a\rb','x'.repeat(4097),
    {toString(){throw Error('must not coerce');}}];
  for(const value of bad){
    let calls=0;const access=createBotReadAccess({lock:()=>calls++});access.provide('prior-token');
    assert.equal(access.provide(value),false);assert.equal(access.getToken(),null);assert.equal(calls,2);
  }
  const access=createBotReadAccess({lock:()=>{}});
  assert.equal(access.provide('x'.repeat(4096)),true);
});
test('lock failure cannot install new credentials and never exposes exception text',()=>{
  let fail=false;const access=createBotReadAccess({lock:()=>{if(fail)throw Error('sensitive-backend-error');}});
  access.provide('old-token');fail=true;
  assert.equal(access.provide('new-token'),false);assert.equal(access.getToken(),null);
  assert.equal(access.clear(),false);assert.equal(access.getToken(),null);
  assert.equal(JSON.stringify(access),'{}');
});
test('missing lock fails with a fixed message without invoking arbitrary values',()=>{
  assert.throws(()=>createBotReadAccess(),{message:'Access unavailable'});
  assert.throws(()=>createBotReadAccess({lock:'private-token'}),{message:'Access unavailable'});
});
test('reentrant clear during replacement prevents the outer token from returning',()=>{
  let access,reenter=false;
  access=createBotReadAccess({lock:()=>{if(reenter){reenter=false;access.clear();}}});
  access.provide('old-token');reenter=true;
  assert.equal(access.provide('late-token'),false);assert.equal(access.getToken(),null);
});
test('reentrant replacement during lock is refused and cannot survive logout',()=>{
  let access,reenter=false;
  access=createBotReadAccess({lock:()=>{if(reenter){reenter=false;assert.equal(access.provide('newer-token'),false);}}});
  reenter=true;assert.equal(access.provide('older-token'),false);assert.equal(access.getToken(),null);
  access.provide('prior-token');reenter=true;access.clear();assert.equal(access.getToken(),null);
});

test('scoped share URL is accepted only in memory; malformed URL clears previous access',()=>{
 const access=createBotReadAccess({lock:()=>{}});
 const link='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/asset-watch?share='+'a'.repeat(43);
 assert.equal(access.provide(link),true);assert.equal(access.getToken(),link);
 assert.equal(access.provide(link+'&other=1'),false);assert.equal(access.getToken(),null);
 assert.equal(access.provide('YWJjL2RlZg+/='),true);assert.equal(access.provide('password?#'),true);access.clear();assert.equal(access.getToken(),null);
});

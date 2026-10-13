// Execute the real helper with isolated VM doubles: no child, browser or network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('./helpers/v11-cdp.mjs',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'')
 .replace('export async function withMobileChrome','async function withMobileChrome');

async function startup(values,{exitCode=null}={}){
 const calls={reads:0,exists:0,sleeps:[],fetches:[],kills:[],removed:[]};
 const sandbox={
  spawn:()=>({pid:123,exitCode}),mkdtempSync:()=>'/synthetic/profile',
  tmpdir:()=>'/synthetic',join:(...parts)=>parts.join('/'),
  existsSync:()=>{calls.exists++;return values[Math.min(calls.reads,values.length-1)]!==undefined;},
  readFileSync:()=>values[Math.min(calls.reads++,values.length-1)],
  rmSync:(...args)=>calls.removed.push(args),
  process:{kill:(...args)=>calls.kills.push(args)},
  setTimeout:callback=>{throw Error('Unexpected timer');},clearTimeout:()=>{},
  AbortSignal:{timeout:()=>({})},
  fetch:async url=>{calls.fetches.push(url);return {json:async()=>[]};},
 };
 // Substitute only the sleep dependency so exhaustion can be tested without time.
 const runnable=source.replace('const sleep=ms=>new Promise(r=>setTimeout(r,ms));',
  'const sleep=async ms=>recordSleep(ms);');
 sandbox.recordSleep=ms=>calls.sleeps.push(ms);
 const run=runInNewContext(runnable+'\nwithMobileChrome;',sandbox);
 let error;
 try{await run('synthetic-chrome',320,'about:blank',()=>{});}catch(e){error=e;}
 assert.deepEqual(calls.kills,[[-123,'SIGKILL']]);
 assert.equal(calls.removed.length,1);
 assert.equal(calls.removed[0][0],'/synthetic/profile');
 assert.equal(calls.sleeps.at(-1),100); // existing cleanup delay
 return {calls,error};
}

test('startup waits through empty, partial and invalid port writes before fetching',async()=>{
 const {calls,error}=await startup(['','32','0\n','65536\n','-1\n','1.5\n',' 32123\n','1e3\n','32123\n/devtools/browser/synthetic']);
 assert.match(error.message,/No Chrome page target/);
 assert.equal(calls.reads,9);
 assert.deepEqual(calls.sleeps,[...Array(8).fill(50),100]);
 assert.deepEqual(calls.fetches,['http://127.0.0.1:32123/json/list']);
});

test('valid inclusive port boundaries are accepted immediately',async()=>{
 for(const port of [1,65535]){
  const {calls,error}=await startup([port+'\n']);
  assert.match(error.message,/No Chrome page target/);
  assert.equal(calls.reads,1);
  assert.deepEqual(calls.sleeps,[100]);
  assert.deepEqual(calls.fetches,['http://127.0.0.1:'+port+'/json/list']);
 }
});

test('incomplete and invalid files exhaust the original 200 polls without fetch',async()=>{
 for(const value of ['', '32123', '0\n', '65536\n',undefined]){
  const {calls,error}=await startup([value]);
  assert.match(error.message,/Chrome DevTools startup timeout/);
  assert.equal(calls.exists,200);
  assert.equal(calls.reads,value===undefined?0:200);
  assert.deepEqual(calls.sleeps,[...Array(200).fill(50),100]);
  assert.deepEqual(calls.fetches,[]);
 }
});

test('early child exit still fails immediately and cleans up',async()=>{
 const {calls,error}=await startup(['32123\n'],{exitCode:7});
 assert.match(error.message,/Chrome exited 7/);
 assert.equal(calls.exists,0);
 assert.deepEqual(calls.fetches,[]);
 assert.deepEqual(calls.sleeps,[100]);
});

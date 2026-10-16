import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJSON,sha256,runArenaBundle,collectBinanceDaily } from '../scripts/run-strategy-paper-arena.mjs';
async function fixture(t,input){
  const root=await mkdtemp(join(tmpdir(),'meridian-arena-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const inputPath=join(root,'fixture.json');await writeFile(inputPath,typeof input==='string'?input:JSON.stringify(input));
  return {inputPath,outDir:join(root,'sealed')};
}
test('canonical snapshot is stable across property insertion order and its exact bytes are hashed',async t=>{
  assert.equal(canonicalJSON({b:2,a:{z:3,x:1}}),canonicalJSON({a:{x:1,z:3},b:2}));
  const args=await fixture(t,{sourceKind:'SYNTHETIC',asOf:1,data:{}});
  const {receipt}=await runArenaBundle({...args,replay:()=>({ruleset:'TEST_ONLY'})});
  const bytes=await readFile(join(args.outDir,'input.json'));
  assert.equal(receipt.inputSha256,sha256(bytes));
  assert.equal(receipt.rawInputSha256,sha256(await readFile(args.inputPath)));
  assert.equal(receipt.engineSha256,sha256(await readFile(new URL('../research/strategy-paper-arena.js',import.meta.url))));
  assert.equal(receipt.protocolSha256,sha256(await readFile(new URL('../docs/strategy-lab/PAPER_ARENA_PROTOCOL_20261016.md',import.meta.url))));
});
test('existing output is refused without modifying any evidence',async t=>{
  const args=await fixture(t,{sourceKind:'SYNTHETIC'});
  await runArenaBundle({...args,replay:()=>({})});
  const before=await readFile(join(args.outDir,'receipt.json'));
  await assert.rejects(runArenaBundle({...args,replay:()=>({changed:true})}),/EEXIST/);
  assert.deepEqual(await readFile(join(args.outDir,'receipt.json')),before);
});
test('malformed input leaves raw evidence and fails before replay',async t=>{
  const args=await fixture(t,'{broken');let calls=0;
  await assert.rejects(runArenaBundle({...args,replay:()=>{calls++;}}));
  assert.equal(calls,0);assert.equal(await readFile(join(args.outDir,'input.raw.json'),'utf8'),'{broken');
  assert.equal(JSON.parse(await readFile(join(args.outDir,'error.json'),'utf8')).sealedBeforeEvaluation,false);
});
test('invalid market history and engine failure retain sealed receipt before evaluation',async t=>{
  const args=await fixture(t,{data:{},asOf:1,sourceKind:'MARKET_DIAGNOSTIC'});
  await assert.rejects(runArenaBundle(args),/EIGHT_SYMBOL/);
  const receipt=JSON.parse(await readFile(join(args.outDir,'receipt.json'),'utf8'));
  assert.equal(receipt.provenance,'UNVERIFIED_INPUT');assert.equal(receipt.liveAuthorized,false);
  assert.equal(JSON.parse(await readFile(join(args.outDir,'error.json'),'utf8')).sealedBeforeEvaluation,true);
  assert.ok(!(await readdir(args.outDir)).includes('result.json'));
  const next={...args,outDir:join(args.outDir,'second')};
  await assert.rejects(runArenaBundle({...next,replay:async()=>{
    assert.ok(await readFile(join(next.outDir,'receipt.json')));throw Error('ENGINE_FAILURE');
  }}),/ENGINE_FAILURE/);
  assert.ok(await readFile(join(next.outDir,'receipt.json')));
});
test('offline mode never invokes fetch and caller provenance claims cannot authenticate input',async t=>{
  const args=await fixture(t,{sourceKind:'MARKET_DIAGNOSTIC',collection:{provider:'BINANCE_SPOT_PUBLIC_KLINES'},asOf:1,data:{}});
  const {receipt}=await runArenaBundle({...args,fetchImpl:()=>{throw Error('NETWORK_MUST_NOT_RUN');},replay:()=>({})});
  assert.equal(receipt.provenance,'UNVERIFIED_INPUT');
});
const DAY=86400000, ASOF=DAY*600+1234;
function responseFor(url,mutate=x=>x){
  const rows=Array.from({length:400},(_,i)=>[DAY*(200+i),'100','102','98','101','1',DAY*(201+i)-1]);
  return new Response(JSON.stringify(mutate(rows,url)),{status:200});
}
test('explicit collector uses exactly eight spot daily requests and retains raw bytes',async()=>{
  const urls=[];
  const input=await collectBinanceDaily({asOf:ASOF,fetchImpl:async url=>{urls.push(url);return responseFor(url);}});
  assert.equal(urls.length,8);assert.equal(input.collection.requestCount,8);
  assert.deepEqual(urls.map(u=>new URL(u).searchParams.get('symbol')),['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','HBARUSDT','LINKUSDT','AVAXUSDT','SUIUSDT']);
  for(const u of urls){assert.equal(new URL(u).pathname,'/api/v3/klines');assert.equal(new URL(u).searchParams.get('endTime'),String(DAY*600-1));}
  for(const r of Object.values(input.collection.rawResponses))assert.equal(r.sha256,sha256(Buffer.from(r.body)));
});
test('collector rejects partial, stale, unordered, misaligned, HTTP errors and oversize without repairs',async()=>{
  for(const mutate of [rows=>rows.slice(1),rows=>rows.map(r=>[r[0]-DAY,...r.slice(1,6),r[6]-DAY]),rows=>[rows[1],rows[0],...rows.slice(2)],(rows,url)=>url.includes('ETHUSDT')?rows.map(r=>[r[0]-DAY,...r.slice(1,6),r[6]-DAY]):rows]){
    await assert.rejects(collectBinanceDaily({asOf:ASOF,fetchImpl:async url=>responseFor(url,mutate)}));
  }
  let calls=0;await assert.rejects(collectBinanceDaily({asOf:ASOF,fetchImpl:async()=>{calls++;return new Response('{}',{status:429});}}),/HTTP/);assert.equal(calls,1);
  await assert.rejects(collectBinanceDaily({asOf:ASOF,fetchImpl:async()=>new Response(' '.repeat(1048577),{status:200})}),/TOO_LARGE/);
});

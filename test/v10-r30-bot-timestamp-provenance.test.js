import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function timeRuntime({updatedAt=null,trusted=false}={}){
  const a=v9.indexOf('function botFeedTimeState()'),b=v9.indexOf('function marketIntelFresh',a);
  assert.ok(a>=0&&b>a,'bot timestamp helper source missing');
  const src=v9.slice(a,b);
  const state={botFeedUpdatedAt:updatedAt,botFeedTimestampTrusted:trusted,bots:[],liveRows:0,matchAmbiguous:0};
  const liveMatched=()=>false;
  const factory=new Function('state','liveMatched',src+';return {time:botFeedTimeState(),age:botFeedAgeMs(),label:botFeedAgeLabel(),fresh:botFeedFresh()};');
  return factory(state,liveMatched);
}

test('r30 trusted bot timestamps retain the existing freshness semantics',()=>{
  const recent=timeRuntime({updatedAt:Date.now()-60_000,trusted:true});
  assert.equal(recent.time.trusted,true);
  assert.equal(recent.time.future,false);
  assert.equal(recent.fresh,true);
  assert.match(recent.label,/MIN|<1 MIN/);

  const stale=timeRuntime({updatedAt:Date.now()-16*60_000,trusted:true});
  assert.equal(stale.fresh,false);
  assert.match(stale.label,/MIN/);
});

test('r30 untrusted timestamps never masquerade as a young bot snapshot',()=>{
  const untrusted=timeRuntime({updatedAt:Date.now()-30_000,trusted:false});
  assert.equal(untrusted.fresh,false);
  assert.equal(untrusted.label,'NO TRUSTED TIMESTAMP');
});

test('r30 future timestamps reuse the existing five-minute tolerance and become explicit beyond it',()=>{
  const tolerated=timeRuntime({updatedAt:Date.now()+4*60_000,trusted:true});
  assert.equal(tolerated.time.future,false);
  assert.equal(tolerated.fresh,true);
  assert.equal(tolerated.label,'<1 MIN');

  const future=timeRuntime({updatedAt:Date.now()+6*60_000,trusted:true});
  assert.equal(future.time.future,true);
  assert.equal(future.fresh,false);
  assert.equal(future.label,'FUTURE TIMESTAMP');
});

test('r30 Data Truth, stale-action explanation and v10 Data Guard share the timestamp label',()=>{
  assert.match(v9,/function botFeedAgeLabel\(\)/);
  assert.match(v9,/updatedAt>Date\.now\(\)\+5\*60\*1000/);
  assert.match(v9,/t\.ageMs<=15\*60\*1000/);
  assert.match(v9,/age=botFeedAgeLabel\(\)/);
  assert.match(v9,/Bot-Snapshot '\+botFeedAgeLabel\(\)/);
  assert.match(v9,/helpers:\{[^}]*botFeedTimeState,botFeedFresh,botFeedCoverage,botFeedAgeMs,botFeedAgeLabel/s);
  const block=v10.slice(v10.indexOf('function syncHealth(){'),v10.indexOf('function marketReadiness'));
  assert.match(block,/age=h\.botFeedAgeLabel\?\.\(\)/);
});

test('r30 release identity remains canonical and execution-neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r30');
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function runCoverage({referenceCount=25,matched=3,liveRows=3,ambiguous=0,fresh=true}={}){
  const a=v9.indexOf('function botFeedCoverage()'),b=v9.indexOf('function ageText',a);
  assert.ok(a>=0&&b>a,'botFeedCoverage source missing');
  const src=v9.slice(a,b);
  const state={
    bots:Array.from({length:referenceCount},(_,i)=>({_liveMatched:i<matched})),
    liveRows,
    matchAmbiguous:ambiguous
  };
  const liveMatched=b=>!!b?._liveMatched;
  const factory=new Function('state','liveMatched','botFeedFresh',src+';return botFeedCoverage();');
  return factory(state,liveMatched,()=>fresh);
}

test('r28 coverage is based on supported live rows, not historical reference catalog size',()=>{
  const c=runCoverage({referenceCount:25,matched:3,liveRows:3,fresh:true});
  assert.equal(c.supported,3);
  assert.equal(c.matched,3);
  assert.equal(c.unmatched,0);
  assert.equal(c.coverageComplete,true);
});

test('r28 unmatched or ambiguous live rows fail coverage closed',()=>{
  const unmatched=runCoverage({referenceCount:25,matched:3,liveRows:4,fresh:true});
  assert.equal(unmatched.unmatched,1);
  assert.equal(unmatched.coverageComplete,false);
  const ambiguous=runCoverage({referenceCount:25,matched:3,liveRows:3,ambiguous:1,fresh:true});
  assert.equal(ambiguous.coverageComplete,false);
  const stale=runCoverage({referenceCount:25,matched:3,liveRows:3,fresh:false});
  assert.equal(stale.coverageComplete,false);
});

test('r28 legacy Data Truth and header reuse shared coverage while atomic publish preserves equivalent source semantics',()=>{
  assert.match(v9,/function botFeedCoverage\(\)/);
  assert.match(v9,/coverageComplete=fresh&&supported>0&&unmatched===0&&ambiguous===0/);
  assert.match(v9,/source=supported>0&&matched===supported&&candidateUnmatched\.length===0&&candidateAmbiguous===0\?'FRESH':matched\?'MIXED':'REFERENCE'/);
  const truth=v9.slice(v9.indexOf('function dataTruthCard(){'),v9.indexOf('function portfolioPionexAgeText'));
  assert.match(truth,/const coverage=botFeedCoverage\(\)/);
  assert.match(truth,/BOT MATCH<\/span><b>\$\{matched\}\/\$\{coverage\.supported\}/);
  assert.match(truth,/UNMATCHED<\/span><b>\$\{coverage\.unmatched\}/);
  assert.match(truth,/coverage\.coverageComplete\?'FRESH'/);
  assert.match(truth,/function renderHeaderTruth\(\).*coverage=botFeedCoverage\(\)/s);
  assert.match(v9,/helpers:\{[^}]*botFeedCoverage/s);
});

test('r28 v10 Data Guard consumes the same shared coverage helper',()=>{
  const block=v10.slice(v10.indexOf('function syncHealth(){'),v10.indexOf('function marketReadiness'));
  assert.match(block,/shared=h\.botFeedCoverage\?\.\(\)/);
  assert.match(block,/supported=Number\(shared\?\.supported/);
  assert.match(block,/matched=Number\(shared\?\.matched/);
  assert.match(block,/coverageComplete=shared\?!!shared\.coverageComplete/);
  assert.doesNotMatch(block,/matched===s?\.bots/);
});

test('r28 release identity remains canonical and execution-neutral',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=28);
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  assert.ok(v9.includes("live-price-core-r18.js?v="+release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

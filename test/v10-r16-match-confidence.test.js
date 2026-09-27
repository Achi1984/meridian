import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function matcherRuntime(fallback){
  const a=v9.indexOf('function pick('),b=v9.indexOf('function ema(',a);
  assert.ok(a>=0&&b>a,'matcher source block missing');
  const source=v9.slice(a,b);
  const state={unmatchedLive:[],matchAmbiguous:0};
  const num=v=>{if(v==null||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null};
  const factory=new Function('FALLBACK','state','num',source+';return {normalizeLive,botMatchEvidence,mergeReference};');
  return{...factory(fallback,state,num),state};
}

test('r16 maps Pionex positionOpenPrice into live break-even',()=>{
  const rt=matcherRuntime([]);
  const row=rt.normalizeLive({symbol:'BTC',side:'LONG',leverage:5,positionOpenPrice:84250});
  assert.equal(row.be,84250);
});

test('r16 accepts a structurally unique bot match and carries match evidence',()=>{
  const refs=[
    {id:'A',symbol:'BTC',side:'LONG',leverage:5,lower:55000,upper:95000,be:84200,liq:57000},
    {id:'B',symbol:'BTC',side:'LONG',leverage:5,lower:55000,upper:95000,be:86500,liq:57500}
  ];
  const rt=matcherRuntime(refs);
  const live=[rt.normalizeLive({id:'live-a',symbol:'BTC',side:'LONG',leverage:5,lower:55000,upper:95000,positionOpenPrice:84210,liquidationPrice:57010,totalProfitPct:2.5})];
  const out=rt.mergeReference(live);
  const matched=out.filter(x=>x._liveMatched);
  assert.equal(matched.length,1);
  assert.equal(matched[0].id,'live-a');
  assert.equal(matched[0].be,84210);
  assert.ok(Number.isFinite(matched[0]._matchScore));
  assert.match(matched[0]._matchEvidence,/lower|upper|be|liq/);
  assert.equal(rt.state.matchAmbiguous,0);
});

test('r16 blocks ambiguous duplicate candidates instead of guessing',()=>{
  const refs=[
    {id:'A',symbol:'BTC',side:'LONG',leverage:5,lower:55000,upper:95000,be:84200,liq:57000},
    {id:'B',symbol:'BTC',side:'LONG',leverage:5,lower:55000,upper:95000,be:86500,liq:57000}
  ];
  const rt=matcherRuntime(refs);
  const live=[rt.normalizeLive({id:'live-amb',symbol:'BTC',side:'LONG',leverage:5,lower:55000,upper:95000,liquidationPrice:57000,totalProfitPct:1})];
  const out=rt.mergeReference(live);
  assert.equal(out.filter(x=>x._liveMatched).length,0);
  assert.equal(rt.state.unmatchedLive.length,1);
  assert.equal(rt.state.unmatchedLive[0].reason,'AMBIGUOUS_MATCH');
  assert.equal(rt.state.matchAmbiguous,1);
});

test('r16 rejects leverage-only matches with no structural evidence',()=>{
  const refs=[{id:'A',symbol:'ETH',side:'LONG',leverage:5,lower:1500,upper:3500,be:2700,liq:1700}];
  const rt=matcherRuntime(refs);
  const live=[rt.normalizeLive({id:'weak',symbol:'ETH',side:'LONG',leverage:5,totalProfitPct:1})];
  const out=rt.mergeReference(live);
  assert.equal(out.filter(x=>x._liveMatched).length,0);
  assert.equal(rt.state.unmatchedLive[0].reason,'NO_CONFIDENT_MATCH');
});

test('r16 exposes ambiguous rows in the Data Guard',()=>{
  assert.match(v10,/ambiguous/);
  assert.match(v10,/AMBIGUOUS MATCH/);
  assert.match(v10,/mehrere nahezu gleich gute Referenztreffer/);
  assert.match(v10,/g\.ambiguous\+' ambiguous<\\/small>/);
});

test('r16 release identity is canonical',()=>{
  assert.equal(release.terminalBuild,'10.0-r16');
  assert.match(shell,/10\.0-r16/);
  assert.match(v10,/const BUILD='10\.0-r16'/);
});

test('r16 adapter remains syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v9html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function runtime(refs=[]){
  const a=v9.indexOf('function pick('),b=v9.indexOf('function ema(',a);
  assert.ok(a>=0&&b>a);
  const source=v9.slice(a,b),state={unmatchedLive:[],matchAmbiguous:0,matchDiagnostics:null};
  const num=v=>{if(v==null||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null};
  return{state,...new Function('FALLBACK','state','num',source+';return {normalizeLive,mergeReference};')(refs,state,num)};
}

test('r55 reports exact conservative match stages without changing acceptance',()=>{
  const refs=[
    {id:'A',symbol:'BTC',side:'LONG',leverage:5,lower:55000,upper:95000,be:85000,liq:57000},
    {id:'B',symbol:'ETH',side:'SHORT',leverage:4,lower:1500,upper:3500,be:2700,liq:3400}
  ];
  const rt=runtime(refs);
  const live=[
    rt.normalizeLive({id:'x',symbol:'BTC',side:'LONG',leverage:5,lower:55000,upper:95000,positionOpenPrice:85010,liquidationPrice:57010}),
    rt.normalizeLive({id:'y',symbol:'ETH',side:'LONG',leverage:4,lower:1500,upper:3500,positionOpenPrice:2700,liquidationPrice:3400})
  ];
  const out=rt.mergeReference(live);
  assert.equal(out.filter(x=>x._liveMatched).length,1);
  assert.deepEqual(
    {rows:rt.state.matchDiagnostics.rows,asset:rt.state.matchDiagnostics.assetPass,side:rt.state.matchDiagnostics.sidePass,lev:rt.state.matchDiagnostics.leveragePass,strong:rt.state.matchDiagnostics.strongCandidate,accepted:rt.state.matchDiagnostics.acceptedRows},
    {rows:2,asset:2,side:1,lev:1,strong:1,accepted:1}
  );
  assert.equal(rt.state.matchDiagnostics.fields.lower,2);
  assert.deepEqual(rt.state.matchDiagnostics.liveSideCounts,{LONG:2});
  assert.deepEqual(rt.state.matchDiagnostics.referenceSideCounts,{LONG:1,SHORT:1});
});

test('r55 UI exposes only aggregate match diagnostics',()=>{
  const block=v10.slice(v10.indexOf('function matchStageDiagnosticsCard'),v10.indexOf('function unmatchedDiagnostics'));
  for(const token of ['MATCH STAGES','ASSET ','SIDE ','LEVERAGE ','STRUCTURE ','STRONG ','ACCEPTED ','SIDE DISTRIBUTION','LIVE MATCH FIELDS'])assert.ok(block.includes(token),token);
  assert.doesNotMatch(block,/botOrderId|x\?\.id|investmentAmount|pnlUsd|liquidationPrice/);
});

test('r55 leaves matcher thresholds and decision guards unchanged',()=>{
  assert.match(v9,/const MATCH_MAX_SCORE=4,MATCH_MIN_GAP=\.05/);
  const evidence=v9.slice(v9.indexOf('function botMatchEvidence'),v9.indexOf('function matchStageDiagnostics'));
  assert.match(evidence,/structural\.length>=1/);
  assert.match(evidence,/structural\.length>=2/);
  const next=v10.slice(v10.indexOf('function nextAction(){'),v10.indexOf('function syncHealth(){'));
  assert.match(next,/if\(!g\.coverageComplete\)/);
  assert.equal(release.terminalExecutionImpact,false);
});

test('r55 release identity is canonical',()=>{
  assert.equal(release.terminalBuild,'10.0-r55');
  assert.match(root,/10\.0-r55-production/);
  assert.match(root,/\.\/v10\/\?build=r55/);
  assert.match(v10,/const BUILD='10\.0-r55'/);
  assert.match(v9,/qs\.set\('build','r55'\)/);
  assert.match(v9html,/p\.set\('build','r55'\)/);
});

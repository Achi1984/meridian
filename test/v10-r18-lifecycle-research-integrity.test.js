import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runTsmomClassic,TSMOM_ENGINE_REVISION} from '../research/documented-edge-v1.js';
import {isPreEntryDoubleAdvantage,SK_RESEARCH_V2_ENGINE_REVISION} from '../research/sk-research-v2.js';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

const DAY=86400000;
function series(days,drift=.001,skip=()=>false){
  let p=100;const rows=[];
  for(let i=0;i<days;i++){
    const open=p,pct=drift+Math.sin(i/19)*.0002;p=Math.max(.01,p*(1+pct));
    if(skip(i))continue;
    rows.push({openTime:Date.UTC(2020,0,1)+i*DAY,closeTime:Date.UTC(2020,0,1)+(i+1)*DAY-1,open,high:Math.max(open,p)*1.001,low:Math.min(open,p)*.999,close:p,volume:1000+i});
  }
  return rows;
}

test('r18 market universe follows current tracked sources and includes unmatched live symbols',()=>{
  assert.match(v9,/function trackedMarketSymbols\(\)/);
  for(const token of ['state.referenceBots','state.bots','state.okxDcaBots','state.unmatchedLive'])assert.ok(v9.includes(token),token);
  assert.match(v9,/for\(const symbol of trackedMarketSymbols\(\)\)/);

  const a=v10.indexOf('function marketUniverse()'),b=v10.indexOf('function marketSignal',a),block=v10.slice(a,b);
  assert.match(block,/referenceBots/);
  assert.match(block,/okxDcaBots/);
  assert.match(block,/unmatchedLive/);
  assert.doesNotMatch(block,/Object\.keys\(s\?\.assetIntel/);
});

test('r18 market refresh is single-flight, sequential at startup and prunes ghost intel',()=>{
  assert.match(v9,/let intelSyncPromise=null/);
  assert.match(v9,/if\(intelSyncPromise\)return intelSyncPromise/);
  assert.match(v9,/const allowed=new Set\(universe\)/);
  assert.match(v9,/state\.assetIntel=Object\.fromEntries\(Object\.entries\(out\)\.filter/);
  assert.match(v9,/sync\(\)\.then\(\(\)=>syncIntel\(\)\)\.then\(\(\)=>go\(current\)\)/);
});

test('r18 UI separates market stale versus missing and bot READY PARTIAL SAFETY REF states',()=>{
  assert.match(v10,/staleAssets:Math\.max\(0,knownAssets-freshAssets\)/);
  assert.match(v10,/missingAssets:Math\.max\(0,totalAssets-knownAssets\)/);
  assert.match(v10,/function botReadiness\(g\)/);
  for(const token of ["label:'READY'","label:'PARTIAL'","label:'SAFETY'","label:'REF'"])assert.ok(v10.includes(token),token);
  assert.match(v10,/function marketReadiness\(m\)/);
  assert.match(v10,/stale ·/);
  assert.match(v10,/missing/);
});

test('r18 TSMOM uses audited weighted turnover accounting',()=>{
  assert.equal(TSMOM_ENGINE_REVISION,'WEIGHTED-TURNOVER-R2');
  const src=fs.readFileSync(new URL('../research/documented-edge-v1.js',import.meta.url),'utf8');
  assert.ok(src.indexOf('if(candidates.length<cfg.minActiveAssets)continue;')<src.indexOf('prevRawPos.clear()'));
  assert.match(src,/const weightKeys=new Set\(\[\.\.\.prevWeights\.keys\(\),\.\.\.currentWeights\.keys\(\)\]\)/);
  assert.match(src,/exitOnly:true/);
  assert.match(src,/turnover\*cfg\.costBps\/10000/);

  const data={
    BTC:series(900,.0010),
    ETH:series(900,.0008),
    SOL:series(900,.0012),
    XRP:series(900,-.0006,i=>i>650&&i%2===0)
  };
  const r=runTsmomClassic(data);
  assert.equal(r.engineRevision,'WEIGHTED-TURNOVER-R2');
  assert.ok(r.periods.length>0);
  assert.ok(r.periods.every(p=>Math.abs(p.costReturn-p.turnover*r.config.costBps/10000)<1e-12||p===r.periods.at(-1)));
});

test('r18 SK Double Advantage cannot use same-bar OHLC as pre-entry evidence',()=>{
  assert.equal(SK_RESEARCH_V2_ENGINE_REVISION,'PREENTRY-CLOSED-BAR-R2');
  const earlier={doubleAdvantage:true,doubleAdvantageBeforeEntry:true,doubleAdvantageAt:900,openedAt:1000,realizedPnl:1};
  const same={doubleAdvantage:true,doubleAdvantageBeforeEntry:true,doubleAdvantageAt:1000,openedAt:1000,realizedPnl:1};
  assert.equal(isPreEntryDoubleAdvantage(earlier),true);
  assert.equal(isPreEntryDoubleAdvantage(same),false);
  const sk=fs.readFileSync(new URL('../research/sk-paperbot-v1.js',import.meta.url),'utf8');
  assert.match(sk,/seq\.doubleAdvantage\.detectedAt<p\.openedAt/);
});

test('r18 Asset Watch timestamp is rendered from canonical snapshot metadata',()=>{
  assert.match(v10,/const stampMs=Date\.parse/);
  assert.match(v10,/toLocaleString\('de-DE'/);
  assert.doesNotMatch(v10,/27\.09\.2026 · ca\. 19:47–19:52/);
});

test('r18 release identity is canonical and adapter parses',()=>{
  assert.equal(release.terminalBuild,'10.0-r18');
  assert.ok(shell.includes(release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  for(const modulePath of ['./fib-core.js','../research/sk-paperbot-v1.js','../research/sk-research-v2.js','../research/documented-edge-v1.js','../research/tsmom-holdout-v1.js'])assert.ok(v10.includes(modulePath+'?v='+release.terminalBuild),modulePath);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

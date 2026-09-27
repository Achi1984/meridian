import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runTsmomClassic,TSMOM_ENGINE_REVISION} from '../research/documented-edge-v1.js';
import {isPreEntryDoubleAdvantage,SK_RESEARCH_V2_ENGINE_REVISION} from '../research/sk-research-v2.js';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
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

test('r17 tracked market universe includes reference live OKX and unmatched symbols',()=>{
  assert.match(v9,/function trackedMarketSymbols\(\)/);
  assert.match(v9,/state\.referenceBots/);
  assert.match(v9,/state\.okxDcaBots/);
  assert.match(v9,/state\.unmatchedLive/);
  assert.match(v9,/for\(const symbol of trackedMarketSymbols\(\)\)/);
});

test('r17 market sync prunes ghost intel and prevents overlapping refreshes',()=>{
  assert.match(v9,/let intelSyncPromise=null/);
  assert.match(v9,/if\(intelSyncPromise\)return intelSyncPromise/);
  assert.match(v9,/const allowed=new Set\(universe\)/);
  assert.match(v9,/state\.assetIntel=Object\.fromEntries\(Object\.entries\(out\)\.filter/);
  assert.match(v9,/sync\(\)\.then\(\(\)=>syncIntel\(\)\)/);
});

test('r17 v10 expected universe no longer grows from stale assetIntel keys',()=>{
  const a=v10.indexOf('function marketUniverse()'),b=v10.indexOf('function marketSignal',a),block=v10.slice(a,b);
  assert.match(block,/referenceBots/);
  assert.match(block,/okxDcaBots/);
  assert.match(block,/unmatchedLive/);
  assert.doesNotMatch(block,/Object\.keys\(s\?\.assetIntel/);
});

test('r17 header and command distinguish READY PARTIAL SAFETY REF states',()=>{
  assert.match(v10,/function botReadiness\(g\)/);
  for(const token of ["label:'READY'","label:'PARTIAL'","label:'SAFETY'","label:'REF'"])assert.ok(v10.includes(token),token);
  assert.match(v10,/function marketReadiness\(m\)/);
  assert.match(v10,/staleAssets/);
  assert.match(v10,/missingAssets/);
  assert.match(v10,/● BOT /);
  assert.match(v10,/● MKT /);
});

test('r17 TSMOM uses weighted turnover accounting and does not mutate state on under-breadth periods',()=>{
  assert.equal(TSMOM_ENGINE_REVISION,'WEIGHTED-TURNOVER-R2');
  const fn=v9; // keep source checks separate from engine execution below
  const source=fs.readFileSync(new URL('../research/documented-edge-v1.js',import.meta.url),'utf8');
  assert.ok(source.indexOf('if(candidates.length<cfg.minActiveAssets)continue;')<source.indexOf('prevRawPos.clear()'));
  assert.match(source,/const weightKeys=new Set\(\[\.\.\.prevWeights\.keys\(\),\.\.\.currentWeights\.keys\(\)\]\)/);
  assert.match(source,/exitOnly:true/);
  assert.match(source,/turnover\*cfg\.costBps\/10000/);

  const data={
    BTC:series(900,.0010),
    ETH:series(900,.0008),
    SOL:series(900,.0012),
    XRP:series(900,-.0006,i=>i>650&&i%2===0)
  };
  const r=runTsmomClassic(data);
  assert.equal(r.engineRevision,'WEIGHTED-TURNOVER-R2');
  assert.ok(r.periods.length>0);
  assert.ok(r.periods.every(p=>Math.abs(p.costReturn-p.turnover*r.config.costBps/10000)<1e-12));
});

test('r17 SK Double Advantage requires a strictly earlier bar, never same-bar OHLC',()=>{
  assert.equal(SK_RESEARCH_V2_ENGINE_REVISION,'PREENTRY-CLOSED-BAR-R2');
  const earlier={doubleAdvantage:true,doubleAdvantageBeforeEntry:true,doubleAdvantageAt:900,openedAt:1000,realizedPnl:1};
  const same={doubleAdvantage:true,doubleAdvantageBeforeEntry:false,doubleAdvantageAt:1000,openedAt:1000,realizedPnl:1};
  assert.equal(isPreEntryDoubleAdvantage(earlier),true);
  assert.equal(isPreEntryDoubleAdvantage(same),false);
});

test('r17 release identity is canonical and browser adapter remains syntactically valid',()=>{
  assert.equal(release.terminalBuild,'10.0-r17');
  assert.ok(v10.includes("const BUILD='10.0-r17'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

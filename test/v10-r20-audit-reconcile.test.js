import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runTsmomClassic,TSMOM_ENGINE_REVISION} from '../research/documented-edge-v1.js';
import {isPreEntryDoubleAdvantage,SK_RESEARCH_V2_ENGINE_REVISION} from '../research/sk-research-v2.js';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const smoke=fs.readFileSync(new URL('../scripts/runtime-smoke.mjs',import.meta.url),'utf8');
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

test('r20 market universe follows current tracked sources and prunes ghost intel',()=>{
  assert.match(v9,/function trackedMarketSymbols\(\)/);
  for(const token of ['state.referenceBots','state.bots','state.okxDcaBots','state.unmatchedLive'])assert.ok(v9.includes(token),token);
  assert.match(v9,/for\(const symbol of trackedMarketSymbols\(\)\)/);
  assert.match(v9,/const allowed=new Set\(universe\)/);
  assert.match(v9,/state\.assetIntel=Object\.fromEntries\(Object\.entries\(out\)\.filter/);

  const a=v10.indexOf('function marketUniverse()'),b=v10.indexOf('function marketSignal',a),block=v10.slice(a,b);
  assert.match(block,/referenceBots/);
  assert.match(block,/okxDcaBots/);
  assert.match(block,/unmatchedLive/);
  assert.doesNotMatch(block,/Object\.keys\(s\?\.assetIntel/);
});

test('r20 refresh is sequential and preserves r18 single-flight runtime hardening',()=>{
  assert.match(v9,/let syncBusy=false/);
  assert.match(v9,/let syncIntelBusy=false/);
  assert.match(v9,/async function refreshNow\(\)/);
  assert.match(v9,/await sync\(\)/);
  assert.match(v9,/const changed=await syncIntel\(\)/);
  const legacyStartup=/go\('command'\);void refreshNow\(\)/.test(v9);
  const qaAwareStartup=/go\('command'\);[\s\S]*if\(LOCAL_VISUAL_QA\)[\s\S]*else\{[\s\S]*void refreshNow\(\)/.test(v9);
  assert.ok(legacyStartup||qaAwareStartup,'production startup must still invoke refreshNow outside localhost-only visual QA');
  assert.match(v9,/fetchTimed/);
});

test('r20 readiness distinguishes market stale missing and bot READY PARTIAL SAFETY REF',()=>{
  assert.match(v10,/staleSymbols=rows\.filter\(x=>!!x\.intel&&!intelFresh\(x\.intel\)\)\.map\(x=>x\.symbol\)/);
  assert.match(v10,/missingSymbols=rows\.filter\(x=>!x\.intel\)\.map\(x=>x\.symbol\)/);
  assert.match(v10,/staleAssets=staleSymbols\.length/);
  assert.match(v10,/missingAssets=missingSymbols\.length/);
  assert.match(v10,/function marketReadiness\(m\)/);
  assert.match(v10,/function botReadiness\(g\)/);
  for(const token of ["label:'READY'","label:'PARTIAL'","label:'SAFETY'","label:'REF'"])assert.ok(v10.includes(token),token);
  assert.match(v10,/stale ·/);
  assert.match(v10,/missing/);
});

test('r20 TSMOM uses audited weighted turnover accounting',()=>{
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

test('r20 SK Double Advantage excludes same-bar OHLC evidence',()=>{
  assert.equal(SK_RESEARCH_V2_ENGINE_REVISION,'PREENTRY-CLOSED-BAR-R2');
  const earlier={doubleAdvantage:true,doubleAdvantageBeforeEntry:true,doubleAdvantageAt:900,openedAt:1000,realizedPnl:1};
  const same={doubleAdvantage:true,doubleAdvantageBeforeEntry:true,doubleAdvantageAt:1000,openedAt:1000,realizedPnl:1};
  assert.equal(isPreEntryDoubleAdvantage(earlier),true);
  assert.equal(isPreEntryDoubleAdvantage(same),false);
  const sk=fs.readFileSync(new URL('../research/sk-paperbot-v1.js',import.meta.url),'utf8');
  assert.match(sk,/seq\.doubleAdvantage\.detectedAt<p\.openedAt/);
});

test('r20 keeps r19 env-only private read auth fail-closed',()=>{
  assert.match(gateway,/MERIDIAN_READ_TOKEN_SHA256/);
  assert.match(gateway,/privateReadAuthSource:READ_AUTH_SOURCE/);
  assert.doesNotMatch(gateway,/LEGACY_FALLBACK/);
  assert.match(smoke,/privateReadConfigured!==true/);
  assert.match(smoke,/privateReadAuthSource\|\|'UNKNOWN'/);
  assert.match(smoke,/!=='ENV'/);
});

test('r20 keeps corrected DOM collection selector and audited LAB labels',()=>{
  assert.match(v10,/\.\.\.\$\$\('\.card',view\)\.filter/);
  assert.doesNotMatch(v10,/\.\.\.\$\('\.card',view\)\.filter/);
  assert.match(v10,/WEIGHTED-TURNOVER-R2|engineRevision/);
  assert.match(v10,/Same-Bar-OHLC zählt nicht/);
  assert.match(v10,/frühere TSMOM\/SK-Ergebnisse müssen neu gerechnet werden/);
});

test('r20+ release identity remains canonical and adapter parses',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=20);
  assert.ok(shell.includes(release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  for(const modulePath of ['./fib-core.js','../research/sk-paperbot-v1.js','../research/sk-research-v2.js','../research/documented-edge-v1.js','../research/tsmom-holdout-v1.js'])assert.ok(v10.includes(modulePath+'?v='+release.terminalBuild),modulePath);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

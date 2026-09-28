import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function integrityRuntime({bots=[],unmatched=[],fresh=true,symbol=null}={}){
  const a=v9.indexOf('function exposureIntegrity('),b=v9.indexOf('function botPnlUsd',a);
  assert.ok(a>=0&&b>a,'exposureIntegrity source missing');
  const src=v9.slice(a,b);
  const state={bots,unmatchedLive:unmatched};
  const liveMatched=x=>!!x?._liveMatched;
  const liveInvestUsdAvailable=x=>!!x?._usd;
  const factory=new Function('state','botFeedFresh','liveMatched','liveInvestUsdAvailable','symbol',
    src+';return exposureIntegrity(symbol);');
  return factory(state,()=>fresh,liveMatched,liveInvestUsdAvailable,symbol);
}

test('r33 exposure completeness fails closed on unmatched or missing-capital live rows',()=>{
  const bots=[
    {symbol:'BTC',_liveMatched:true,_usd:true},
    {symbol:'BTC',_liveMatched:true,_usd:true}
  ];
  assert.deepEqual(integrityRuntime({bots}),{fresh:true,matched:2,unmatched:0,missingCapital:0,unknown:0,complete:true});
  assert.deepEqual(integrityRuntime({bots,unmatched:[{symbol:'BTC'}]}),{fresh:true,matched:2,unmatched:1,missingCapital:0,unknown:1,complete:false});
  const missing=[bots[0],{symbol:'BTC',_liveMatched:true,_usd:false}];
  assert.deepEqual(integrityRuntime({bots:missing}),{fresh:true,matched:2,unmatched:0,missingCapital:1,unknown:1,complete:false});
  assert.equal(integrityRuntime({bots,fresh:false}).complete,false);
});

test('r33 asset exposure scope ignores unmatched rows from other assets but global exposure does not',()=>{
  const bots=[{symbol:'BTC',_liveMatched:true,_usd:true}];
  const unmatched=[{symbol:'ETH'}];
  assert.equal(integrityRuntime({bots,unmatched,symbol:'BTC'}).complete,true);
  assert.equal(integrityRuntime({bots,unmatched}).complete,false);
});

test('r33 pair hedge percentage requires complete same-asset exposure and keeps the 15 percent rule unchanged',()=>{
  const pair=v9.slice(v9.indexOf('function assetPairRisk'),v9.indexOf('function riskCockpitV2'));
  assert.ok(pair.includes('integrity=exposureIntegrity(symbol)'));
  assert.ok(pair.includes('unknownExposure=integrity.unknown'));
  assert.ok(pair.includes('hedgePct=longUsd>0&&integrity.complete?shortUsd/longUsd*100:null'));
  assert.ok(pair.includes('exposureComplete:integrity.complete'));
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  assert.ok(plan.includes("hedgeLow=side==='LONG'&&pair.longUsd>0&&pair.hedgePct!=null&&pair.hedgePct<15"));
  assert.ok(plan.includes("code:'HEDGE'"));
});

test('r33 global exposure and active v10 UI consume the shared integrity helper',()=>{
  const exposure=v9.slice(v9.indexOf('function exposureModel'),v9.indexOf('function portfolioRegime'));
  assert.ok(exposure.includes('integrity=exposureIntegrity()'));
  assert.ok(exposure.includes('unknownBots=integrity.unknown'));
  assert.ok(exposure.includes('coverage=longUsd>0&&integrity.complete?shortUsd/longUsd*100:null'));
  assert.ok(exposure.includes('complete:integrity.complete'));
  assert.match(v9,/helpers:\{[^}]*exposureIntegrity/s);

  const pair=v10.slice(v10.indexOf('function pairCard'),v10.indexOf('function criticalPair'));
  assert.ok(pair.includes('h.exposureIntegrity?.(symbol)'));
  const live=v10.slice(v10.indexOf('function liveOverview'),v10.indexOf('function snapshotBotLine'));
  assert.ok(live.includes('h.exposureIntegrity?.()'));
  assert.ok(live.includes("exposureComplete?'COMPLETE':'PARTIAL'"));
});

test('r33 release identity remains canonical and execution-neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r33');
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

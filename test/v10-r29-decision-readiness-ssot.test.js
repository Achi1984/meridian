import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function readinessRuntime({matched=true,botFresh=true,riskValue=12,pnl=true,marketFresh=true}={}){
  const a=v9.indexOf('function safetyReadyBot('),b=v9.indexOf('function botPnlUsd',a);
  assert.ok(a>=0&&b>a,'readiness helper source missing');
  const src=v9.slice(a,b);
  const state={assetIntel:{BTC:{updatedAt:Date.now()}}};
  const bot={symbol:'BTC'};
  const liveMatched=()=>matched;
  const botFeedFresh=()=>botFresh;
  const risk=()=>riskValue;
  const livePnlAvailable=()=>pnl;
  const marketIntelFresh=()=>marketFresh;
  const factory=new Function('state','liveMatched','botFeedFresh','risk','livePnlAvailable','marketIntelFresh','bot',
    src+';return {safety:safetyReadyBot(bot),decision:decisionReadyBot(bot),actionable:actionableBot(bot)};');
  return factory(state,liveMatched,botFeedFresh,risk,livePnlAvailable,marketIntelFresh,bot);
}

test('r29 decision readiness requires safety, PnL and fresh market data',()=>{
  assert.deepEqual(readinessRuntime(),{safety:true,decision:true,actionable:true});
  assert.deepEqual(readinessRuntime({riskValue:null}),{safety:false,decision:false,actionable:false});
  assert.deepEqual(readinessRuntime({pnl:false}),{safety:true,decision:false,actionable:false});
  assert.deepEqual(readinessRuntime({marketFresh:false}),{safety:true,decision:false,actionable:false});
  assert.deepEqual(readinessRuntime({botFresh:false}),{safety:false,decision:false,actionable:false});
  assert.deepEqual(readinessRuntime({matched:false}),{safety:false,decision:false,actionable:false});
});

test('r29 Data Truth ACTIONABLE uses the shared decision-ready helper',()=>{
  assert.match(v9,/function safetyReadyBot\(b\)/);
  assert.match(v9,/function decisionReadyBot\(b\)/);
  assert.match(v9,/function actionableBot\(b\)\{return decisionReadyBot\(b\)\}/);
  const truth=v9.slice(v9.indexOf('function dataTruthCard(){'),v9.indexOf('function portfolioPionexAgeText'));
  assert.match(truth,/ACTIONABLE<\/span><b>\$\{state\.bots\.filter\(decisionReadyBot\)\.length\}/);
  assert.match(truth,/ACTIONABLE = DECISION READY/);
  assert.match(truth,/Bot-Match \+ Liq \+ Snapshot-PnL \+ frische Asset-Marktdaten/);
  assert.match(v9,/helpers:\{[^}]*safetyReadyBot,decisionReadyBot/s);
});

test('r29 v10 syncHealth consumes the shared safety and decision helpers',()=>{
  const block=v10.slice(v10.indexOf('function syncHealth(){'),v10.indexOf('function marketReadiness'));
  assert.match(block,/h\.safetyReadyBot\?h\.safetyReadyBot\(b\)/);
  assert.match(block,/h\.decisionReadyBot\?h\.decisionReadyBot\(b\)/);
  assert.match(block,/actionable=decisionReady/);
  assert.match(block,/decisionReady=decisionRows\.length/);
});

test('r29 release identity remains canonical and execution-neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r29');
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

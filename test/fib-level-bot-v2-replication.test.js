import test from 'node:test';
import assert from 'node:assert/strict';
import {FIB_LEVEL_BOT_V1} from '../fib-level-bot-v1.js';
import {FIB_LEVEL_BOT_V2,evaluateFibV2Replication} from '../fib-level-bot-v2-replication.js';

test('V2 locks 4h, seven assets and disjoint periods',()=>{
  assert.equal(FIB_LEVEL_BOT_V2.timeframe,'4h');
  assert.equal(FIB_LEVEL_BOT_V2.symbols.length,7);
  assert.ok(Date.parse(FIB_LEVEL_BOT_V2.replicationStart)<Date.parse(FIB_LEVEL_BOT_V2.discoveryStart));
  assert.ok(Date.parse(FIB_LEVEL_BOT_V2.discoveryStart)<Date.parse(FIB_LEVEL_BOT_V2.holdoutStart));
});

test('V2 leaves every V1 trading parameter frozen',()=>{
  assert.deepEqual(FIB_LEVEL_BOT_V1.ratios,[.382,.5,.618,.786]);
  assert.equal(FIB_LEVEL_BOT_V1.pivotBars,3);
  assert.equal(FIB_LEVEL_BOT_V1.minLegAtr,1.5);
  assert.equal(FIB_LEVEL_BOT_V1.costRate,.001);
});

test('passing historical gates never permits promotion',()=>{
  const good={closedBaskets:60,profitFactor:1.2,expectancy:.1};
  const primary={summary:{...good,closedBaskets:500},walkForward:[1,2,3].map(()=>({summary:good})),bySide:{LONG:good,SHORT:good},bySymbol:Object.fromEntries(FIB_LEVEL_BOT_V2.symbols.map(s=>[s,good])),byUniverseGroup:{CORE:good,EXPANSION:good},positiveNetRConcentrationPct:Object.fromEntries(FIB_LEVEL_BOT_V2.symbols.map(s=>[s,100/7]))};
  const x=evaluateFibV2Replication(primary,{summary:good});
  assert.equal(x.historicalReplicated,true);
  assert.equal(x.promotionPermitted,false);
  assert.equal(x.executionImpact,false);
});

test('one negative chronological fold fails replication',()=>{
  const good={closedBaskets:60,profitFactor:1.2,expectancy:.1};
  const bad={closedBaskets:60,profitFactor:.9,expectancy:-.1};
  const primary={summary:{...good,closedBaskets:500},walkForward:[{summary:good},{summary:bad},{summary:good}],bySide:{LONG:good,SHORT:good},bySymbol:Object.fromEntries(FIB_LEVEL_BOT_V2.symbols.map(s=>[s,good])),byUniverseGroup:{CORE:good,EXPANSION:good},positiveNetRConcentrationPct:Object.fromEntries(FIB_LEVEL_BOT_V2.symbols.map(s=>[s,100/7]))};
  assert.equal(evaluateFibV2Replication(primary,{summary:good}).historicalReplicated,false);
});

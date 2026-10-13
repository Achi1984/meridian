import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateTradePlan} from '../docs/strategy-lab/evaluate-trade-plan.mjs';

const zeroCosts = () => ({fee:0,spread:0,slippage:0,fundingBorrow:0});
function plan(overrides = {}) {
  return {
    schemaVersion:'MERIDIAN_LINEAR_TRADE_PLAN_V1',
    instrument:'LINEAR_PERPETUAL', direction:'LONG', quantity:2,
    entryPrice:100, stopPrice:90, exits:[{price:130,portionBps:10000}],
    targetCosts:zeroCosts(), stopCosts:zeroCosts(), ...overrides
  };
}
function rejected(input) {
  const result = evaluateTradePlan(input);
  assert.equal(result.valid, false);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
  assert.equal(result.qualifiesPlannedCRV, false);
  assert.equal(result.executionAuthorized, false);
  return result;
}
function checked(input) {
  const result = evaluateTradePlan(input);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
  assert.equal(result.executionAuthorized, false);
  return result;
}

test('LONG exact 3:1 is inclusive; SHORT and unlevered spot use directional cash flows', () => {
  for (const input of [
    plan(),
    plan({direction:'SHORT',stopPrice:110,exits:[{price:70,portionBps:10000}]}),
    plan({instrument:'LINEAR_SPOT'})
  ]) {
    const r = checked(input);
    assert.equal(r.grossReward, 60);
    assert.equal(r.netReward, 60);
    assert.equal(r.grossStopLoss, 20);
    assert.equal(r.netRisk, 20);
    assert.equal(r.plannedNetRewardRisk, 3);
    assert.equal(r.qualifiesPlannedCRV, true);
  }
});

test('a representable value immediately below 3:1 does not qualify', () => {
  const r = checked(plan({exits:[{price:129.99999999999997,portionBps:10000}]}));
  assert.ok(r.plannedNetRewardRisk < 3);
  assert.equal(r.qualifiesPlannedCRV, false);
});

test('tiny positive scenario costs cannot vanish into a rounded displayed ratio', () => {
  for (const scenario of ['targetCosts','stopCosts']) {
    const r = checked(plan({quantity:1,[scenario]:{fee:1e-16,spread:0,slippage:0,fundingBorrow:0}}));
    assert.equal(r.plannedNetRewardRisk, 3);
    assert.equal(r.qualifiesPlannedCRV, false);
  }
});

test('scientific-notation prices retain exact inclusive 3:1 boundaries', () => {
  for (const [entryPrice,stopPrice,targetPrice] of [[1e-7,9e-8,1.3e-7],[1e22,9e21,1.3e22]]) {
    const r = checked(plan({quantity:1,entryPrice,stopPrice,exits:[{price:targetPrice,portionBps:10000}]}));
    assert.equal(r.qualifiesPlannedCRV, true);
    assert.ok(Math.abs(r.plannedNetRewardRisk-3)<1e-12);
  }
});

test('gross 3:1 fails after realistic nonzero round-trip costs', () => {
  const r = checked(plan({targetCosts:{fee:1,spread:.25,slippage:.5,fundingBorrow:.25},stopCosts:{fee:1,spread:.25,slippage:.5,fundingBorrow:.25}}));
  // Two units: gross profit60 and stop loss20; total scenario costs2 each.
  assert.equal(r.targetCostTotal, 2);
  assert.equal(r.stopCostTotal, 2);
  assert.equal(r.netReward, 58);
  assert.equal(r.netRisk, 22);
  assert.equal(r.plannedNetRewardRisk, 29/11);
  assert.equal(r.qualifiesPlannedCRV, false);
});

test('all four independently supplied quote-currency costs affect their scenario once', () => {
  const r = checked(plan({quantity:1,exits:[{price:142,portionBps:10000}],targetCosts:{fee:2,spread:1,slippage:.5,fundingBorrow:.5},stopCosts:{fee:1,spread:.25,slippage:.5,fundingBorrow:.25}}));
  assert.equal(r.targetCostTotal, 4);
  assert.equal(r.stopCostTotal, 2);
  assert.equal(r.netReward, 38);
  assert.equal(r.netRisk, 12);
  assert.equal(r.plannedNetRewardRisk, 19/6);
  assert.equal(r.qualifiesPlannedCRV, true);
});

test('weighted partial exits qualify on their combined cash flow, not final target', () => {
  const r = checked(plan({exits:[{price:120,portionBps:5000},{price:150,portionBps:5000}]}));
  assert.equal(r.netReward, 70);
  assert.equal(r.plannedNetRewardRisk, 3.5);
  assert.equal(r.qualifiesPlannedCRV, true);
});

test('a distant final target cannot hide a poor weighted partial-exit plan', () => {
  const r = checked(plan({exits:[{price:110,portionBps:8000},{price:150,portionBps:2000}]}));
  // 1.6 units earn10 each, .4 units earn50 each:36, versus initial risk20.
  assert.equal(r.netReward, 36);
  assert.equal(r.plannedNetRewardRisk, 1.8);
  assert.equal(r.qualifiesPlannedCRV, false);
  const short = checked(plan({direction:'SHORT',stopPrice:110,exits:[{price:90,portionBps:8000},{price:50,portionBps:2000}]}));
  assert.equal(short.netReward, 36);
  assert.equal(short.qualifiesPlannedCRV, false);
});

test('costly partial exits at exactly net 3:1 pass, just below fail without tolerance', () => {
  // Two units split evenly:20+50 gross; minus4 costs =>66; risk20+2 =>22.
  const base = plan({exits:[{price:120,portionBps:5000},{price:150,portionBps:5000}],targetCosts:{fee:4,spread:0,slippage:0,fundingBorrow:0},stopCosts:{fee:2,spread:0,slippage:0,fundingBorrow:0}});
  const exact = checked(base);
  assert.equal(exact.netReward, 66);
  assert.equal(exact.netRisk, 22);
  assert.equal(exact.plannedNetRewardRisk, 3);
  assert.equal(exact.qualifiesPlannedCRV, true);
  const below = checked({...base,exits:[{price:120,portionBps:5000},{price:149.99999999999994,portionBps:5000}]});
  assert.ok(below.netReward < 66);
  assert.equal(below.qualifiesPlannedCRV, false);
});

test('losing partial exits reduce aggregate reward instead of disappearing', () => {
  // One unit exits for a5 loss; one for a65 gain. Aggregate60 versus risk20.
  const r = checked(plan({exits:[{price:95,portionBps:5000},{price:165,portionBps:5000}]}));
  assert.equal(r.netReward, 60);
  assert.equal(r.qualifiesPlannedCRV, true);
  const loss = checked(plan({exits:[{price:95,portionBps:10000}]}));
  assert.equal(loss.netReward, -10);
  assert.equal(loss.qualifiesPlannedCRV, false);
});

test('missing residual exit, over-allocation and noninteger basis points are invalid', () => {
  for (const exits of [[],[{price:130,portionBps:5000}],[{price:130,portionBps:10001}],[{price:130,portionBps:4999.5},{price:150,portionBps:5000.5}],[{price:130,portionBps:0},{price:150,portionBps:10000}],[{price:130,portionBps:-1},{price:150,portionBps:10001}]]) rejected(plan({exits}));
  rejected(plan({exits:Array.from({length:11},(_,i)=>({price:130+i,portionBps:i===10?1000:900}))}));
});

test('stop must be strictly on the adverse side for both directions', () => {
  for (const stopPrice of [100,101]) rejected(plan({stopPrice}));
  for (const stopPrice of [100,99]) rejected(plan({direction:'SHORT',stopPrice,exits:[{price:70,portionBps:10000}]}));
});

test('unsupported inverse, multi-leg and spot short plans cannot qualify', () => {
  rejected(plan({instrument:'INVERSE_PERPETUAL'}));
  rejected(plan({instrument:'MULTI_LEG'}));
  rejected(plan({instrument:'LINEAR_SPOT',direction:'SHORT',stopPrice:110,exits:[{price:70,portionBps:10000}]}));
  rejected(plan({legs:[{symbol:'BTCUSDT'},{symbol:'ETHUSDT'}]}));
});

test('schema and nested unknown keys reject rather than silently discarding terms', () => {
  for (const input of [null,undefined,[],42,'plan',{},plan({schemaVersion:'v0'}),plan({leverage:10}),plan({executionAuthorized:true}),plan({targetCosts:{...zeroCosts(),rebate:1}}),plan({exits:[{price:130,portionBps:10000,runner:true}]})]) rejected(input);
});

test('missing, nonfinite, negative and coerced numeric inputs are invalid', () => {
  for (const key of ['quantity','entryPrice','stopPrice']) {
    for (const value of [undefined,null,NaN,Infinity,-Infinity,-1,0,'100']) rejected(plan({[key]:value}));
  }
  for (const key of ['fee','spread','slippage','fundingBorrow']) {
    for (const value of [undefined,null,NaN,Infinity,-1,'0']) {
      rejected(plan({targetCosts:{...zeroCosts(),[key]:value}}));
      rejected(plan({stopCosts:{...zeroCosts(),[key]:value}}));
    }
  }
  for (const value of [NaN,Infinity,null,'130',0,-1]) rejected(plan({exits:[{price:value,portionBps:10000}]}));
});

test('nonfinite cash flows, cost sums and threshold multiplication fail closed', () => {
  rejected(plan({quantity:1e308}));
  rejected(plan({targetCosts:{fee:1e308,spread:1e308,slippage:0,fundingBorrow:0}}));
  rejected(plan({stopCosts:{fee:1e308,spread:0,slippage:0,fundingBorrow:0}}));
  rejected(plan({quantity:Number.MIN_VALUE,entryPrice:1,stopPrice:1-Number.EPSILON,exits:[{price:2,portionBps:10000}]}));
});

test('inputs are never modified and qualifying plans never grant execution authority', () => {
  const input = plan();
  const before = structuredClone(input);
  Object.freeze(input.targetCosts); Object.freeze(input.stopCosts);
  input.exits.forEach(Object.freeze); Object.freeze(input.exits); Object.freeze(input);
  const r = checked(input);
  assert.deepEqual(input, before);
  assert.equal(r.qualifiesPlannedCRV, true);
  assert.equal(r.executionAuthorized, false);
  const bad = plan({executionAuthorized:true});
  const badBefore = structuredClone(bad);
  rejected(bad);
  assert.deepEqual(bad, badBefore);
});

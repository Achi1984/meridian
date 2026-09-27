import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SK_RESEARCH_V2_GATE,isPreEntryDoubleAdvantage,skEntryDepthCohorts,
  compareSkCoreVsDouble,aggregateSkResearchV2,evaluateSkResearchV2
} from '../research/sk-research-v2.js';

const t=(pnl,{da=false,daAt=null,open=1000,side='LONG',depth=.5}={})=>({
  realizedPnl:pnl,doubleAdvantage:da,doubleAdvantageBeforeEntry:da&&daAt!=null&&daAt<open,
  doubleAdvantageAt:daAt,openedAt:open,side,entryRatios:[depth],fees:1
});

test('V2 Double Advantage cohort forbids post-entry lookahead',()=>{
  assert.equal(isPreEntryDoubleAdvantage(t(10,{da:true,daAt:900,open:1000})),true);
  assert.equal(isPreEntryDoubleAdvantage(t(10,{da:true,daAt:1000,open:1000})),false);
  assert.equal(isPreEntryDoubleAdvantage(t(10,{da:true,daAt:1100,open:1000})),false);
  assert.equal(isPreEntryDoubleAdvantage(t(10,{da:false,daAt:null,open:1000})),false);
});

test('V2 entry-depth cohorts separate deepest filled SK level',()=>{
  const rows=[t(10,{depth:.5}),t(-5,{depth:.559}),t(7,{depth:.618}),t(8,{depth:.667}),t(3,{depth:.667})];
  const c=skEntryDepthCohorts(rows);
  assert.equal(c['0.500'].trades,1);
  assert.equal(c['0.559'].trades,1);
  assert.equal(c['0.618'].trades,1);
  assert.equal(c['0.667'].trades,2);
});

test('V2 A/B comparison leaves Core untouched and filters only pre-entry DA',()=>{
  const replay={trades:[
    t(-10,{da:false,open:1000}),
    t(20,{da:true,daAt:900,open:1100}),
    t(-4,{da:true,daAt:1400,open:1300}),
    t(12,{da:true,daAt:1500,open:1500})
  ]};
  const c=compareSkCoreVsDouble(replay);
  assert.equal(c.core.trades,4);
  assert.equal(c.double.trades,1);
  assert.equal(c.nonDouble.trades,3);
  assert.ok(c.double.pnl>0);
});

test('V2 batch aggregates assets and keeps research-only semantics',()=>{
  const mk=(symbol,offset)=>({
    symbol,bars:2000,first:1,last:2,replay:{trades:[
      t(25+offset,{da:true,daAt:900,open:1000+offset}),
      t(-5,{da:false,open:1100+offset}),
      t(15+offset,{da:true,daAt:1200,open:1200+offset})
    ]}
  });
  const b=aggregateSkResearchV2([mk('BTC',0),mk('ETH',100),mk('SOL',200)]);
  assert.equal(b.researchOnly,true);
  assert.equal(b.executionImpact,false);
  assert.equal(b.autoPromotion,false);
  assert.equal(b.assets.length,3);
  assert.equal(b.pooled.core.trades,9);
  assert.equal(b.pooled.double.trades,5);
});

test('V2 frozen gate checks sample PF expectancy DD windows asset breadth and concentration',()=>{
  const gate={...SK_RESEARCH_V2_GATE};
  const batch={
    pooled:{double:{trades:25,profitFactor:1.5,expectancy:8,maxDrawdownPct:5}},
    stability:{positiveWindows:4},
    assets:[
      {double:{pnl:100}},{double:{pnl:80}},{double:{pnl:70}},{double:{pnl:-20}}
    ]
  };
  const pass=evaluateSkResearchV2(batch,gate);
  assert.equal(pass.pass,true);
  assert.equal(pass.autoPromotion,false);

  const fail=evaluateSkResearchV2({
    pooled:{double:{trades:8,profitFactor:.8,expectancy:-2,maxDrawdownPct:14}},
    stability:{positiveWindows:1},
    assets:[{double:{pnl:100}},{double:{pnl:-5}}]
  },gate);
  assert.equal(fail.pass,false);
  assert.ok(fail.reasons.includes('DOUBLE_SAMPLE_LT_20'));
  assert.ok(fail.reasons.some(x=>x.startsWith('DOUBLE_PNL_CONCENTRATION_GT_')));
});

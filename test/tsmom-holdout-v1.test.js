import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TSMOM_HOLDOUT_V1_RULESET,TSMOM_TRANSFER_ASSETS,TSMOM_LEGACY_START,TSMOM_LEGACY_END,
  filterTsmomWindow,runLegacyTimeHoldout,runTransferUniverseHoldout,evaluateCombinedTsmomHoldout,holdoutProtocol
} from '../research/tsmom-holdout-v1.js';

const DAY=86400000;
function stableSeries(start,days,drift=.001,phase=0){
  let p=100;const rows=[];
  for(let i=0;i<days;i++){
    const r=drift+Math.sin((i+phase)/13)*.00012;
    const open=p;p=Math.max(.01,p*(1+r));
    rows.push({openTime:start+i*DAY,closeTime:start+(i+1)*DAY-1,open,high:Math.max(open,p)*1.001,low:Math.min(open,p)*.999,close:p,volume:1000+i});
  }
  return rows;
}

test('TSMOM Holdout V1 freezes legacy dates and new transfer universe before results',()=>{
  assert.equal(TSMOM_HOLDOUT_V1_RULESET,'TSMOM-HOLDOUT-V1-FROZEN');
  assert.equal(new Date(TSMOM_LEGACY_START).toISOString().slice(0,10),'2020-05-01');
  assert.equal(new Date(TSMOM_LEGACY_END).toISOString().slice(0,10),'2022-07-31');
  assert.deepEqual([...TSMOM_TRANSFER_ASSETS],['BNB','ADA','DOGE','DOT','XLM','TRX','LTC','BCH']);
});

test('legacy holdout uses unchanged TSMOM config and filters strictly to pre-discovery window',()=>{
  const start=Date.UTC(2018,0,1),days=1800;
  const data={
    BTC:stableSeries(start,days,.0010,0),
    ETH:stableSeries(start,days,.0009,3),
    XRP:stableSeries(start,days,-.0007,7),
    LINK:stableSeries(start,days,.0008,11)
  };
  const r=runLegacyTimeHoldout(data);
  assert.equal(r.ruleset,TSMOM_HOLDOUT_V1_RULESET);
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
  assert.ok(r.periods.length>0);
  assert.ok(r.periods.every(p=>p.at>=TSMOM_LEGACY_START&&p.at<=TSMOM_LEGACY_END));
  assert.equal(r.config.rebalanceDays,30);
  assert.deepEqual([...r.config.lookbacks],[30,90,365]);
});

test('window filter recomputes summary, assets and long/short diagnostics from selected periods only',()=>{
  const base={
    config:{startEquity:10000,rebalanceDays:30,lookbacks:[30,90,365],volLookbackDays:60,targetVolAnnual:.1,annualizationDays:365,maxLeverage:2,costBps:8,minActiveAssets:3},
    periods:[
      {at:100,netReturn:.02,costReturn:.001,grossReturn:.021,activeAssets:2,legs:[
        {symbol:'BTC',position:.5,leverage:.5,netReturn:.03},{symbol:'ETH',position:-.4,leverage:.4,netReturn:.01}
      ]},
      {at:200,netReturn:-.01,costReturn:.001,grossReturn:-.009,activeAssets:2,legs:[
        {symbol:'BTC',position:.4,leverage:.4,netReturn:-.02},{symbol:'ETH',position:-.3,leverage:.3,netReturn:0}
      ]},
      {at:300,netReturn:.03,costReturn:.001,grossReturn:.031,activeAssets:2,legs:[
        {symbol:'BTC',position:.5,leverage:.5,netReturn:.04},{symbol:'ETH',position:-.3,leverage:.3,netReturn:.02}
      ]}
    ]
  };
  const r=filterTsmomWindow(base,{start:150,end:300});
  assert.equal(r.summary.periods,2);
  assert.equal(r.assets.length,2);
  assert.ok(r.diagnostics.longContributionPct!==0);
  assert.ok(r.diagnostics.shortContributionPct!==0);
  assert.ok(r.diagnostics.avgLeverage>0);
  assert.ok(r.diagnostics.modeledCostSumPct>0);
});

test('transfer holdout preserves the fixed out-of-universe asset list',()=>{
  const start=Date.UTC(2021,0,1),days=2100;
  const data=Object.fromEntries(TSMOM_TRANSFER_ASSETS.map((a,i)=>[a,stableSeries(start,days,i<4?.0009:-.0007,i*5)]));
  const r=runTransferUniverseHoldout(data);
  assert.deepEqual(r.transferUniverse,[...TSMOM_TRANSFER_ASSETS]);
  assert.equal(r.ruleset,TSMOM_HOLDOUT_V1_RULESET);
  assert.equal(r.researchOnly,true);
  assert.equal(r.autoPromotion,false);
  assert.ok(r.summary.periods>=24);
});

test('combined holdout requires both gates and fixed data breadth',()=>{
  const pass={
    gate:{pass:true},assets:Array.from({length:4},(_,i)=>({symbol:'L'+i}))
  };
  const transfer={
    gate:{pass:true},assets:TSMOM_TRANSFER_ASSETS.map(symbol=>({symbol}))
  };
  const ok=evaluateCombinedTsmomHoldout({legacy:pass,transfer});
  assert.equal(ok.pass,true);
  assert.equal(ok.autoPromotion,false);

  const bad=evaluateCombinedTsmomHoldout({legacy:{gate:{pass:false},assets:pass.assets},transfer:{gate:{pass:true},assets:transfer.assets.slice(0,7)}});
  assert.equal(bad.pass,false);
  assert.ok(bad.reasons.includes('LEGACY_GATE_FAIL'));
  assert.ok(bad.reasons.includes('TRANSFER_DATA_BREADTH_LT_8'));
});

test('holdout protocol explicitly forbids optimization after discovery',()=>{
  const p=holdoutProtocol();
  assert.equal(p.ruleset,TSMOM_HOLDOUT_V1_RULESET);
  assert.deepEqual(p.transferUniverse,[...TSMOM_TRANSFER_ASSETS]);
  assert.match(p.requirements,/Both independent holdouts must pass/);
  assert.deepEqual([...p.unchangedConfig.lookbacks],[30,90,365]);
});

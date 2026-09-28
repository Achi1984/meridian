import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAPERBOT_PROFIT_AGENT_V3_RULESET,
  PAPERBOT_PROFIT_V3_CONFIG,
  PAPERBOT_PROFIT_V3_GATE,
  runAdaptiveUpTrend6hV3,
  evaluateProfitV3Gate
} from '../research/paperbot-profit-special-agent-v3.js';

const BAR=6*60*60*1000;
function series({bars=2200,start=100,drift=.002,phase=0,downAfter=null}={}){
  const rows=[];let p=start;
  for(let i=0;i<bars;i++){
    let d=drift+Math.sin((i+phase)/37)*.00035;
    if(downAfter!=null&&i>=downAfter)d=-Math.abs(drift)*1.7;
    const open=p,close=Math.max(.01,p*(1+d)),wiggle=.0007;
    rows.push({openTime:(i+1)*BAR,closeTime:(i+2)*BAR-1,open,high:Math.max(open,close)*(1+wiggle),low:Math.min(open,close)*(1-wiggle),close,volume:1000000+i});
    p=close;
  }
  return rows;
}
function universe(){
  const assets=['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI'];
  return Object.fromEntries(assets.map((a,i)=>[a,series({start:100+i*10,drift:.0015+.00004*i,phase:i*5})]));
}

test('V3 is frozen research-only with no execution impact',()=>{
  const out=runAdaptiveUpTrend6hV3(universe());
  assert.equal(out.ruleset,PAPERBOT_PROFIT_AGENT_V3_RULESET);
  assert.equal(out.strategy,'ADAPTIVE_UP_TREND_6H_V3');
  assert.equal(out.researchOnly,true);
  assert.equal(out.executionImpact,false);
  assert.equal(out.autoPromotion,false);
  assert.equal(out.config.entryBars,40);
  assert.equal(out.config.exitBars,20);
  assert.equal(out.config.regimeMaBars,200);
  assert.equal(out.config.regimeReturnBars,120);
  assert.equal(out.config.trailingAtrMult,3);
  assert.equal(out.config.costBps,10);
});

test('V3 produces only long active legs and obeys leverage cap',()=>{
  const out=runAdaptiveUpTrend6hV3(universe());
  assert.ok(out.periods.length>100);
  for(const p of out.periods)for(const leg of (p.legs||[]).filter(x=>!x.exitOnly)){
    assert.equal(leg.signal,1);
    assert.ok(leg.position>0);
    assert.ok(leg.leverage>0&&leg.leverage<=PAPERBOT_PROFIT_V3_CONFIG.maxLeverage+1e-12);
  }
});

test('V3 transfer filtering can use BTC as regime source without trading BTC',()=>{
  const out=runAdaptiveUpTrend6hV3(universe(),{tradeAssets:['ETH','SOL','XRP']});
  const traded=new Set(out.periods.flatMap(p=>(p.legs||[]).filter(x=>!x.exitOnly).map(x=>x.symbol)));
  assert.equal(traded.has('BTC'),false);
  assert.ok([...traded].every(x=>['ETH','SOL','XRP'].includes(x)));
});

test('V3 modeled cost stress cannot improve compounded return',()=>{
  const data=universe(),low=runAdaptiveUpTrend6hV3(data,{costBps:0}),high=runAdaptiveUpTrend6hV3(data,{costBps:80});
  assert.ok(high.summary.totalReturnPct<=low.summary.totalReturnPct+1e-9);
});

test('V3 exits when persistent regime breaks instead of opening shorts',()=>{
  const data=universe();
  data.SOL=series({drift:.0016,downAfter:1300});
  const out=runAdaptiveUpTrend6hV3(data);
  for(const p of out.periods)for(const leg of (p.legs||[]).filter(x=>!x.exitOnly))assert.ok(leg.signal>=0);
  assert.equal(out.periods.some(p=>(p.legs||[]).some(x=>x.symbol==='SOL'&&x.exitOnly)),true);
});

test('V3 profit gate rejects insufficient breadth/stability despite high raw return',()=>{
  const s={periods:200,totalReturnPct:80,profitFactor:2,maxDrawdownPct:5},stability={positiveWindows:3},assets=[
    {symbol:'BTC',summary:{pnl:5000}},{symbol:'ETH',summary:{pnl:1000}}
  ];
  const g=evaluateProfitV3Gate(s,stability,assets,83);
  assert.equal(g.pass,false);
  assert.ok(g.reasons.includes('POSITIVE_WINDOWS_LT_'+PAPERBOT_PROFIT_V3_GATE.minPositiveWindows));
  assert.ok(g.reasons.includes('POSITIVE_ASSETS_LT_'+PAPERBOT_PROFIT_V3_GATE.minPositiveAssets));
  assert.ok(g.reasons.includes('POSITIVE_PNL_CONCENTRATION_GT_'+PAPERBOT_PROFIT_V3_GATE.maxPositivePnlConcentrationPct+'PCT'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAPERBOT_PROFIT_AGENT_V2_RULESET,
  PAPERBOT_PROFIT_V2_GATE,
  runAsymmetricDonchianV2,
  runUpRegimeDonchianV2,
  runPaperBotProfitAgentV2,
  evaluateProfitCandidateV2
} from '../research/paperbot-profit-special-agent-v2.js';

const DAY=86400000;
function series({days=900,start=100,drift=.002,phase=0}={}){
  const rows=[];let p=start;
  for(let i=0;i<days;i++){
    const cyc=Math.sin((i+phase)/31)*.0008;
    const r=drift+cyc,open=p,close=Math.max(.01,p*(1+r));
    rows.push({
      openTime:(i+1)*DAY,
      closeTime:(i+2)*DAY-1,
      open,
      high:Math.max(open,close)*1.001,
      low:Math.min(open,close)*.999,
      close,
      volume:1000000+i
    });
    p=close;
  }
  return rows;
}
function mixedUniverse(){
  return {
    BTC:series({drift:.0020,phase:0}),
    ETH:series({drift:.0017,phase:4}),
    SOL:series({drift:-.0014,phase:8}),
    XRP:series({drift:-.0011,phase:12}),
    HBAR:series({drift:.0015,phase:16}),
    LINK:series({drift:-.0010,phase:20}),
    AVAX:series({drift:.0014,phase:24}),
    SUI:series({drift:-.0009,phase:28})
  };
}
function upUniverse(){
  const assets=['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI'];
  return Object.fromEntries(assets.map((a,i)=>[a,series({drift:.0012+.00008*i,phase:i*3})]));
}

test('V2 special-agent remains frozen research-only',()=>{
  const out=runPaperBotProfitAgentV2(mixedUniverse());
  assert.equal(out.ruleset,PAPERBOT_PROFIT_AGENT_V2_RULESET);
  assert.equal(out.researchOnly,true);
  assert.equal(out.executionImpact,false);
  assert.equal(out.autoPromotion,false);
  assert.deepEqual(Object.keys(out.candidates),['ASYMMETRIC_DONCHIAN_V2','UP_REGIME_DONCHIAN_V2']);
  assert.ok(['DISCOVERY_LEADER_ONLY','NO_CANDIDATE_PASSES'].includes(out.decision));
});

test('asymmetric Donchian uses frozen 70/30 side budgets when both sides are active',()=>{
  const out=runAsymmetricDonchianV2(mixedUniverse());
  const both=out.periods.filter(p=>p.longGross>0&&p.shortGross>0);
  assert.ok(both.length>0);
  for(const p of both){
    assert.ok(Math.abs(p.longGross-.70)<1e-9,'long gross '+p.longGross);
    assert.ok(Math.abs(p.shortGross-.30)<1e-9,'short gross '+p.shortGross);
  }
  assert.equal(out.executionImpact,false);
});

test('asymmetric Donchian cost stress cannot improve compounded return',()=>{
  const data=mixedUniverse(),low=runAsymmetricDonchianV2(data,{costBps:0}),high=runAsymmetricDonchianV2(data,{costBps:80});
  assert.ok(low.periods.length>20);
  assert.ok(high.summary.totalReturnPct<=low.summary.totalReturnPct+1e-9);
});

test('UP-regime Donchian is strictly long-only and records BTC regime',()=>{
  const out=runUpRegimeDonchianV2(upUniverse());
  assert.ok(out.periods.length>0);
  const active=out.periods.filter(p=>p.activeAssets>0);
  assert.ok(active.length>0);
  for(const p of active){
    assert.equal(p.btcRegimeUp,true);
    for(const leg of p.legs.filter(x=>!x.exitOnly)){
      assert.equal(leg.signal,1);
      assert.ok(leg.position>0);
    }
  }
});

test('UP-regime filter rejects persistent down assets instead of shorting them',()=>{
  const data=upUniverse();
  data.SOL=series({drift:-.0015,phase:6});
  const out=runUpRegimeDonchianV2(data);
  for(const p of out.periods)for(const leg of p.legs.filter(x=>!x.exitOnly)){
    assert.notEqual(leg.symbol==='SOL'&&leg.signal<0,true);
    assert.ok(leg.signal>=0);
  }
});

test('V2 profit gate still blocks attractive return without breadth/stability',()=>{
  const s={periods:40,totalReturnPct:50,profitFactor:2,maxDrawdownPct:8},stability={positiveWindows:2},assets=[
    {symbol:'BTC',summary:{pnl:2000}},
    {symbol:'ETH',summary:{pnl:-100}}
  ];
  const g=evaluateProfitCandidateV2(s,stability,assets,100);
  assert.equal(g.pass,false);
  assert.ok(g.reasons.includes('POSITIVE_WINDOWS_LT_'+PAPERBOT_PROFIT_V2_GATE.minPositiveWindows));
  assert.ok(g.reasons.includes('POSITIVE_ASSETS_LT_'+PAPERBOT_PROFIT_V2_GATE.minPositiveAssets));
  assert.ok(g.reasons.includes('POSITIVE_PNL_CONCENTRATION_GT_'+PAPERBOT_PROFIT_V2_GATE.maxPositivePnlConcentrationPct+'PCT'));
});

test('V2 discovery leader can only be selected from candidates that pass the frozen gate',()=>{
  const out=runPaperBotProfitAgentV2(upUniverse());
  if(out.discoveryLeader){
    assert.ok(out.passedCandidates.includes(out.discoveryLeader));
    assert.equal(out.candidates[out.discoveryLeader].gate.pass,true);
  }else{
    assert.equal(out.passedCandidates.length,0);
  }
});

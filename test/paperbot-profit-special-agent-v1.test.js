import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAPERBOT_PROFIT_AGENT_V1_RULESET,
  PAPERBOT_PROFIT_GATE,
  runPersistentTsmomV1,
  runDonchianTrendV1,
  runPaperBotProfitAgentV1,
  evaluateProfitCandidate
} from '../research/paperbot-profit-special-agent-v1.js';

const DAY=86400000;
function series({days=900,start=100,drift=.0012,phase=0,shockEvery=0}={}){
  const rows=[];let p=start;
  for(let i=0;i<days;i++){
    const cyc=Math.sin((i+phase)/17)*.0025+Math.sin((i+phase)/43)*.0015;
    const shock=shockEvery&&i>0&&i%shockEvery===0?-.07:0;
    const r=drift+cyc+shock;
    const open=p,close=Math.max(.01,p*(1+r)),wiggle=Math.max(.002,Math.abs(r)*.7);
    rows.push({openTime:i*DAY,closeTime:(i+1)*DAY-1,open,high:Math.max(open,close)*(1+wiggle),low:Math.min(open,close)*(1-wiggle),close,volume:1000000+i});
    p=close;
  }
  return rows;
}
function universe(){
  const assets=['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI'];
  return Object.fromEntries(assets.map((a,i)=>[a,series({start:100+i*10,drift:.001+.00005*i,phase:i*3})]));
}

test('profit special-agent module is research-only and frozen',()=>{
  const out=runPaperBotProfitAgentV1(universe());
  assert.equal(out.ruleset,PAPERBOT_PROFIT_AGENT_V1_RULESET);
  assert.equal(out.researchOnly,true);
  assert.equal(out.executionImpact,false);
  assert.equal(out.autoPromotion,false);
  assert.deepEqual(Object.keys(out.candidates),['TSMOM_CLASSIC','PERSISTENT_TSMOM_V1','DONCHIAN_TREND_V1']);
  assert.ok(['DISCOVERY_LEADER_ONLY','NO_CANDIDATE_PASSES'].includes(out.decision));
});

test('persistent TSMOM requires aligned horizons and includes modeled costs',()=>{
  const data=universe();
  const low=runPersistentTsmomV1(data,{costBps:0});
  const high=runPersistentTsmomV1(data,{costBps:50});
  assert.ok(low.periods.length>=10);
  assert.ok(low.periods.every(p=>p.legs.every(x=>[-1,1].includes(Math.sign(x.signal)))));
  assert.ok(high.summary.totalReturnPct<=low.summary.totalReturnPct+1e-9);
  assert.equal(low.executionImpact,false);
});

test('Donchian challenger never pyramids beyond frozen leverage cap',()=>{
  const out=runDonchianTrendV1(universe());
  assert.ok(out.periods.length>0);
  for(const p of out.periods)for(const leg of p.legs||[])assert.ok(Math.abs(Number(leg.leverage)||0)<=2+1e-12);
  assert.equal(out.autoPromotion,false);
});

test('profit gate blocks attractive return when breadth or stability is inadequate',()=>{
  const s={periods:30,totalReturnPct:40,profitFactor:2,maxDrawdownPct:8};
  const stability={positiveWindows:2};
  const assets=[
    {symbol:'BTC',summary:{pnl:1000}},
    {symbol:'ETH',summary:{pnl:-10}}
  ];
  const g=evaluateProfitCandidate(s,stability,assets,100);
  assert.equal(g.pass,false);
  assert.ok(g.reasons.includes('POSITIVE_WINDOWS_LT_'+PAPERBOT_PROFIT_GATE.minPositiveWindows));
  assert.ok(g.reasons.includes('POSITIVE_ASSETS_LT_'+PAPERBOT_PROFIT_GATE.minPositiveAssets));
  assert.ok(g.reasons.includes('POSITIVE_PNL_CONCENTRATION_GT_'+PAPERBOT_PROFIT_GATE.maxPositivePnlConcentrationPct+'PCT'));
});

test('discovery leader can only come from candidates that pass the frozen gate',()=>{
  const out=runPaperBotProfitAgentV1(universe());
  if(out.discoveryLeader){
    assert.ok(out.passedCandidates.includes(out.discoveryLeader));
    assert.equal(out.candidates[out.discoveryLeader].strategy,out.discoveryLeader);
  }else{
    assert.equal(out.passedCandidates.length,0);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {runUpRegimeDonchianV2} from '../research/paperbot-profit-special-agent-v2.js';

const DAY=86400000;
function series({days=1000,start=100,drift=.0015,phase=0}={}){
  const rows=[];let p=start;
  for(let i=0;i<days;i++){
    const cyc=Math.sin((i+phase)/29)*.0007,r=drift+cyc,open=p,close=Math.max(.01,p*(1+r));
    rows.push({openTime:(i+1)*DAY,closeTime:(i+2)*DAY-1,open,high:Math.max(open,close)*1.001,low:Math.min(open,close)*.999,close,volume:1000000+i});
    p=close;
  }
  return rows;
}
function data(){
  return {
    BTC:series({drift:.0016}),
    BNB:series({drift:.0015,phase:3}),
    DOGE:series({drift:.0014,phase:6}),
    ADA:series({drift:.0013,phase:9}),
    DOT:series({drift:.0012,phase:12}),
    LTC:series({drift:.0011,phase:15}),
    BCH:series({drift:.0010,phase:18}),
    TRX:series({drift:.0009,phase:21}),
    XLM:series({drift:.0008,phase:24})
  };
}
const transfer=['BNB','DOGE','ADA','DOT','LTC','BCH','TRX','XLM'];

test('transfer holdout uses BTC only as regime filter when BTC is not in tradeAssets',()=>{
  const out=runUpRegimeDonchianV2(data(),{tradeAssets:transfer});
  assert.ok(out.periods.length>0);
  const traded=new Set(out.periods.flatMap(p=>(p.legs||[]).filter(x=>!x.exitOnly).map(x=>x.symbol)));
  assert.equal(traded.has('BTC'),false);
  assert.ok([...traded].every(x=>transfer.includes(x)));
});

test('transfer holdout remains long-only with frozen signal parameters',()=>{
  const out=runUpRegimeDonchianV2(data(),{tradeAssets:transfer});
  assert.equal(out.config.entryDays,55);
  assert.equal(out.config.exitDays,20);
  assert.equal(out.config.rebalanceDays,7);
  assert.equal(out.config.volLookbackDays,60);
  assert.equal(out.config.regimeMaDays,200);
  assert.equal(out.config.regimeReturnDays,30);
  assert.equal(out.config.costBps,8);
  assert.equal(out.config.maxLeverage,2);
  for(const p of out.periods)for(const leg of (p.legs||[]).filter(x=>!x.exitOnly)){
    assert.equal(leg.signal,1);
    assert.ok(leg.position>0);
  }
});

test('default discovery behavior still includes BTC when no transfer list is supplied',()=>{
  const out=runUpRegimeDonchianV2(data());
  const traded=new Set(out.periods.flatMap(p=>(p.legs||[]).filter(x=>!x.exitOnly).map(x=>x.symbol)));
  assert.equal(traded.has('BTC'),true);
});

test('higher holdout costs cannot improve total return',()=>{
  const d=data(),low=runUpRegimeDonchianV2(d,{tradeAssets:transfer,costBps:0}),high=runUpRegimeDonchianV2(d,{tradeAssets:transfer,costBps:80});
  assert.ok(high.summary.totalReturnPct<=low.summary.totalReturnPct+1e-9);
});

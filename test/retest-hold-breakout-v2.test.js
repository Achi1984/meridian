import test from 'node:test';
import assert from 'node:assert/strict';
import {retestHoldDecision,findRetestHoldSetup} from '../retest-hold-breakout-v2.js';

function makeSeries({side='LONG',breakoutAt=70,retestAt=72,currentAt=74}={}){
  const rows=[];let p=100;
  for(let i=0;i<75;i++){
    let open=p,close=p+(i%2?0.08:-0.04),high=Math.max(open,close)+.25,low=Math.min(open,close)-.25,volume=100;
    if(i===breakoutAt){
      if(side==='LONG'){open=100.8;close=102.4;high=102.7;low=100.6}else{open=99.2;close=97.6;high=99.4;low=97.3}
      volume=180;
    }
    if(i===retestAt){
      if(side==='LONG'){open=102.0;close=101.5;high=102.1;low=100.9}else{open=98.0;close=98.5;high=99.1;low=97.9}
      volume=120;
    }
    if(i===currentAt){
      if(side==='LONG'){open=101.45;close=102.45;high=102.6;low=101.3}else{open=98.55;close=97.55;high=98.7;low=97.4}
      volume=150;
    }
    rows.push({open,high,low,close,volume,closeTime:i*900000});p=close;
  }
  return rows;
}

test('waits on insufficient history',()=>{
  const d=retestHoldDecision({symbol:'TEST',candles15m:makeSeries().slice(0,30)});
  assert.equal(d.decision,'WAIT');
  assert.equal(d.executionImpact,false);
});

test('detects long breakout retest hold sequence',()=>{
  const rows=makeSeries({side:'LONG'});
  const f=findRetestHoldSetup(rows,[]);
  assert.equal(f.ready,true);
  assert.equal(f.side,'LONG');
  assert.equal(f.retestSeen,true);
  assert.equal(f.holds,true);
});

test('detects short breakout retest hold sequence',()=>{
  const rows=makeSeries({side:'SHORT'});
  const f=findRetestHoldSetup(rows,[]);
  assert.equal(f.ready,true);
  assert.equal(f.side,'SHORT');
  assert.equal(f.retestSeen,true);
  assert.equal(f.holds,true);
});

test('decision stays research only and risk bounded',()=>{
  const d=retestHoldDecision({symbol:'TEST',candles15m:makeSeries({side:'LONG'})});
  assert.equal(d.researchOnly,true);
  assert.equal(d.executionImpact,false);
  assert.ok(d.riskPct>=0&&d.riskPct<=1);
  if(d.side==='LONG'){
    assert.ok(d.sl<d.entry);
    assert.ok(d.tp1>d.entry);
    assert.ok(d.tp2>d.tp1);
  }
});

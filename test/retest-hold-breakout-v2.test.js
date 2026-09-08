import test from 'node:test';
import assert from 'node:assert/strict';
import {retestHoldDecision,findRetestHoldSetup} from '../retest-hold-breakout-v2.js';

function makeSeries({side='LONG',breakoutAt=80,retestAt=82,currentAt=84}={}){
  const rows=[];
  for(let i=0;i<85;i++){
    let open=100,close=100+(i%2?0.04:-0.04),high=100.30,low=99.70,volume=100;
    if(i===breakoutAt){
      if(side==='LONG'){open=100.2;close=101.6;high=101.9;low=100.1}else{open=99.8;close=98.4;high=99.9;low=98.1}
      volume=180;
    }
    if(i===breakoutAt+1){
      if(side==='LONG'){open=101.55;close=101.25;high=101.7;low=101.0}else{open=98.45;close=98.75;high=99.0;low=98.3}
      volume=115;
    }
    if(i===retestAt){
      if(side==='LONG'){open=101.2;close=100.65;high=101.3;low=100.22}else{open=98.8;close=99.35;high=99.78;low=98.7}
      volume=120;
    }
    if(i===retestAt+1){
      if(side==='LONG'){open=100.65;close=100.9;high=101.0;low=100.45}else{open=99.35;close=99.1;high=99.55;low=99.0}
      volume=120;
    }
    if(i===currentAt){
      if(side==='LONG'){open=100.9;close=101.55;high=101.7;low=100.8}else{open=99.1;close=98.45;high=99.2;low=98.3}
      volume=150;
    }
    rows.push({open,high,low,close,volume,closeTime:i*900000});
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

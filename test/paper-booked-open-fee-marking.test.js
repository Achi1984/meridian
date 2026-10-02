import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {markPaperPosition} from '../paper-position-accounting.js';

test('booked opening fee is not deducted twice from open LONG equity',()=>{
  const p={entry:100,qty:2,side:'LONG',feeOpen:.10};
  const legacy=markPaperPosition(p,110,5,{openingFeeAlreadyBooked:false});
  const booked=markPaperPosition(p,110,5,{openingFeeAlreadyBooked:true});
  assert.equal(legacy.livePrice,110);
  assert.ok(Math.abs(legacy.unrealized-(20-.10-.11))<1e-12);
  assert.ok(Math.abs(booked.unrealized-(20-.11))<1e-12);
  assert.ok(Math.abs((booked.unrealized-legacy.unrealized)-p.feeOpen)<1e-12);
});

test('booked opening fee is not deducted twice from open SHORT equity',()=>{
  const p={entry:100,qty:2,side:'SHORT',feeOpen:.10};
  const booked=markPaperPosition(p,90,5,{openingFeeAlreadyBooked:true});
  assert.ok(Math.abs(booked.unrealized-(20-.09))<1e-12);
});

test('server routes booked-fee ledgers to the cash-aware marker while preserving V3 compensation',()=>{
  const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  assert.match(server,/function markPositionBookedOpenFee\(p,price\)/);
  const routes=[
    ['async function cycleUnlocked()','function cycle()'],
    ['async function shadowV1Cycle(m)','async function shadowV1Status()'],
    ['async function challengerV2Cycle(m)','async function challengerV2Status()'],
    ['async function regimeV1Cycle(m)','async function regimeV1Status()'],
  ];
  for(const [startMarker,endMarker] of routes){
    const start=server.indexOf(startMarker),end=server.indexOf(endMarker,start+startMarker.length);
    assert.ok(start>=0&&end>start,startMarker+' definition missing');
    const body=server.slice(start,end);
    assert.match(body,/markPositionBookedOpenFee\(p,q\.price\)/,startMarker+' must use booked-fee marker');
  }
  const v3Start=server.indexOf('async function challengerV3CycleUnlocked');
  const v3End=server.indexOf('async function challengerV3Status',v3Start);
  assert.ok(v3Start>=0&&v3End>v3Start,'V3 cycle definition missing');
  const v3=server.slice(v3Start,v3End);
  assert.match(v3,/markPosition\(p,q\.price\)/);
  assert.match(v3,/marked\.unrealized\+=p\.feeOpen/);
  assert.doesNotMatch(v3,/markPositionBookedOpenFee\(p,q\.price\)/);
});

test('booked-fee marking validates unsafe inputs',()=>{
  assert.throws(()=>markPaperPosition({entry:100,qty:1,side:'FLAT',feeOpen:0},100,5,{openingFeeAlreadyBooked:true}),/side/);
  assert.throws(()=>markPaperPosition({entry:100,qty:1,side:'LONG',feeOpen:0},0,5,{openingFeeAlreadyBooked:true}),/mark price/);
  assert.throws(()=>markPaperPosition({entry:100,qty:1,side:'LONG',feeOpen:0},100,-1,{openingFeeAlreadyBooked:true}),/fee bps/);
});

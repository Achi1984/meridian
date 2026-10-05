import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildV2EventSourcedLedger,reconcileLedger,verifyV2Ledger,ledgerMaxDrawdownUsd
} from '../research/cross-venue-funding-edge-v2-ledger.js';
import {tradePathDigest} from '../research/cross-venue-funding-edge-v2.js';
import {fundingSettlementInWindow} from '../research/cross-venue-funding-edge-v2-runner.js';

const H=60*60*1000;
const T=Date.parse('2026-01-01T00:00:00.000Z');

function syntheticCycle({
  entryTime=T,
  exitTime=T+16*H,
  binanceSide='LONG',
  okxSide='SHORT',
  binanceEntry=100,
  okxEntry=100,
  binanceExit=100,
  okxExit=100,
  slipBps=3,
  funding=[]
}={}){
  const bq=10000/binanceEntry,oq=10000/okxEntry;
  const fills=[
    {venue:'BINANCE',side:binanceSide,qty:bq,markOpen:binanceEntry,time:entryTime,feeBps:5,slipBps},
    {venue:'OKX',side:okxSide,qty:oq,markOpen:okxEntry,time:entryTime,feeBps:5,slipBps},
    {venue:'BINANCE',side:binanceSide,qty:bq,markOpen:binanceExit,time:exitTime,feeBps:5,slipBps},
    {venue:'OKX',side:okxSide,qty:oq,markOpen:okxExit,time:exitTime,feeBps:5,slipBps}
  ];
  const marks=[];
  const steps=(exitTime-entryTime)/H;
  for(let i=0;i<=steps;i++){
    const f=steps===0?1:i/steps,time=entryTime+i*H;
    marks.push({venue:'BINANCE',time,mark:binanceEntry+(binanceExit-binanceEntry)*f});
    marks.push({venue:'OKX',time,mark:okxEntry+(okxExit-okxEntry)*f});
  }
  return{fills,marks,funding};
}

test('G20 zero move and no funding leaves exactly baseline costs',()=>{
  const x=syntheticCycle();
  const ledger=buildV2EventSourcedLedger(x);
  assert.equal(ledger.openingEquity,20000);
  assert.equal(ledger.closingEquity,19963);
  assert.equal(ledger.closingEquity-ledger.openingEquity,-37);
  assert.equal(verifyV2Ledger(ledger),true);
  const r=reconcileLedger({ledger,decomposition:{fundingCashflows:[],basisPnlUsd:0,costsUsd:37}});
  assert.equal(r.actualDelta,-37);
  assert.equal(r.expectedDelta,-37);
  assert.equal(ledgerMaxDrawdownUsd(ledger)>=37,true);
});

test('G21 positive funding makes LONG pay and SHORT receive using signed quantity',()=>{
  const entry=T,exit=T+16*H,fundAt=T+8*H;
  const x=syntheticCycle({
    entryTime:entry,exitTime:exit,
    funding:[
      {venue:'BINANCE',time:fundAt,rate:.001,fundingMark:100},
      {venue:'OKX',time:fundAt,rate:.001,fundingMark:100}
    ]
  });
  const ledger=buildV2EventSourcedLedger(x);
  const funding=ledger.events.filter(e=>e.kind==='FUNDING');
  assert.equal(funding.length,2);
  assert.equal(funding.find(e=>e.venue==='BINANCE').cashDelta,-10);
  assert.equal(funding.find(e=>e.venue==='OKX').cashDelta,10);
  assert.equal(ledger.closingEquity-ledger.openingEquity,-37);
  assert.equal(reconcileLedger({ledger,decomposition:{fundingCashflows:[-10,10],basisPnlUsd:0,costsUsd:37}}).ok,true);
});

test('G22 basis-only movement is hand-calculated and reconciles independently',()=>{
  const x=syntheticCycle({binanceExit:110,okxExit:90});
  const ledger=buildV2EventSourcedLedger(x);
  const realized=ledger.events.filter(e=>e.kind==='FILL_CLOSE').reduce((a,e)=>a+e.realizedPnlUsd,0);
  assert.equal(realized,2000);
  assert.equal(ledger.closingEquity-ledger.openingEquity,1963);
  assert.equal(reconcileLedger({ledger,decomposition:{fundingCashflows:[],basisPnlUsd:2000,costsUsd:37}}).ok,true);
});

test('G23 mirrored long/short legs negate the hand-calculated basis values',()=>{
  const a=buildV2EventSourcedLedger(syntheticCycle({binanceSide:'LONG',okxSide:'SHORT',binanceExit:110,okxExit:90}));
  const b=buildV2EventSourcedLedger(syntheticCycle({binanceSide:'SHORT',okxSide:'LONG',binanceExit:110,okxExit:90}));
  const ar=a.events.filter(e=>e.kind==='FILL_CLOSE').map(e=>e.realizedPnlUsd);
  const br=b.events.filter(e=>e.kind==='FILL_CLOSE').map(e=>e.realizedPnlUsd);
  assert.deepEqual(br,ar.map(x=>-x));
  assert.equal(a.closingEquity-b.closingEquity,4000);
});

test('G24 baseline and stress preserve trade path digest and differ by exactly 12 USD costs',()=>{
  const base=syntheticCycle({slipBps:3});
  const stress=syntheticCycle({slipBps:6});
  const path=base.fills.map(f=>({venue:f.venue,side:f.side,time:f.time,qty:f.qty,mark:f.markOpen}));
  assert.equal(tradePathDigest(path),tradePathDigest(stress.fills.map(f=>({venue:f.venue,side:f.side,time:f.time,qty:f.qty,mark:f.markOpen}))));
  const l1=buildV2EventSourcedLedger(base),l2=buildV2EventSourcedLedger(stress);
  assert.equal(l1.closingEquity-l2.closingEquity,12);
  assert.equal(reconcileLedger({ledger:l1,decomposition:{fundingCashflows:[],basisPnlUsd:0,costsUsd:37}}).ok,true);
  assert.equal(reconcileLedger({ledger:l2,decomposition:{fundingCashflows:[],basisPnlUsd:0,costsUsd:49}}).ok,true);
});

test('G25 corruption of cash price fee quantity rate or sign cannot silently reconcile',()=>{
  const fundAt=T+8*H;
  const base=syntheticCycle({funding:[{venue:'BINANCE',time:fundAt,rate:.001,fundingMark:100}]});
  const ledger=buildV2EventSourcedLedger(base);
  const D={fundingCashflows:[-10],basisPnlUsd:0,costsUsd:37};
  assert.equal(reconcileLedger({ledger,decomposition:D}).ok,true);

  const cashCorrupt={...ledger,cashByVenue:{...ledger.cashByVenue,BINANCE:ledger.cashByVenue.BINANCE+1}};
  assert.throws(()=>reconcileLedger({ledger:cashCorrupt,decomposition:D}),/LEDGER_DIGEST_MISMATCH/);

  const price=syntheticCycle({binanceExit:101,funding:[{venue:'BINANCE',time:fundAt,rate:.001,fundingMark:100}]});
  assert.throws(()=>reconcileLedger({ledger:buildV2EventSourcedLedger(price),decomposition:D}),/LEDGER_RECONCILIATION/);

  const fee=structuredClone(base);fee.fills[0].feeBps=6;
  assert.throws(()=>reconcileLedger({ledger:buildV2EventSourcedLedger(fee),decomposition:D}),/LEDGER_RECONCILIATION/);

  const qty=structuredClone(base);qty.fills[2].qty+=1;
  assert.throws(()=>buildV2EventSourcedLedger(qty),/LEDGER_CLOSE_MISMATCH/);

  const rate=structuredClone(base);rate.funding[0].rate=.002;
  assert.throws(()=>reconcileLedger({ledger:buildV2EventSourcedLedger(rate),decomposition:D}),/LEDGER_RECONCILIATION/);

  const sign=syntheticCycle({binanceSide:'SHORT',okxSide:'LONG',funding:[{venue:'BINANCE',time:fundAt,rate:.001,fundingMark:100}]});
  assert.throws(()=>reconcileLedger({ledger:buildV2EventSourcedLedger(sign),decomposition:D}),/LEDGER_RECONCILIATION/);
});

test('G26 reconcileLedger rejects raw closing-equity shaped objects',()=>{
  assert.throws(()=>reconcileLedger({
    ledger:{openingEquity:20000,closingEquity:19963},
    decomposition:{fundingCashflows:[],basisPnlUsd:0,costsUsd:37}
  }),/INVALID_LEDGER_OBJECT/);
});

test('G27 funding window is entryFill < settlement <= exitDecision',()=>{
  const entry=T+H,decision=T+17*H,exitFill=decision+H;
  assert.equal(fundingSettlementInWindow({entryFillTime:entry,exitDecisionTime:decision,settlementTime:entry}),false);
  assert.equal(fundingSettlementInWindow({entryFillTime:entry,exitDecisionTime:decision,settlementTime:decision}),true);
  assert.equal(fundingSettlementInWindow({entryFillTime:entry,exitDecisionTime:decision,settlementTime:exitFill}),false);
});

test('G29 ledger rejects coercive scalar types NaN Infinity blanks and arrays',()=>{
  const bad=[NaN,Infinity,'',[],null,true];
  for(const value of bad){
    const q=syntheticCycle();q.fills[0].qty=value;
    assert.throws(()=>buildV2EventSourcedLedger(q),/INVALID_LEDGER_FILL/);
    const p=syntheticCycle({funding:[{venue:'BINANCE',time:T+8*H,rate:value,fundingMark:100}]});
    assert.throws(()=>buildV2EventSourcedLedger(p),/INVALID_LEDGER_FUNDING/);
  }
});

test('hourly mark gaps and unpaired marks fail closed before ledger construction',()=>{
  const x=syntheticCycle();
  x.marks=x.marks.filter(m=>!(m.venue==='OKX'&&m.time===T+5*H));
  assert.throws(()=>buildV2EventSourcedLedger(x),/UNPAIRED_LEDGER_MARK/);
});

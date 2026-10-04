import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSS_VENUE_FUNDING_EDGE_V1_SOURCE as BASE,
  canonicalFundingTime,normalizeFunding,normalizeMarks,commonFundingTimes,
  splitCommonTimes,validateCrossVenueSource
} from '../research/cross-venue-funding-edge-v1-data-contract.js';

const H=60*60*1000;
const START=Date.parse('2021-01-01T00:00:00.000Z');
const END=START+48*H-1;
const contract={...BASE,start:new Date(START).toISOString(),end:new Date(END).toISOString(),minCommonFundingDecisions:5};

function marks(){
  return Array.from({length:48},(_,i)=>({openTime:START+i*H,open:100+i,high:102+i,low:99+i,close:101+i}));
}
function funding(jitter=0){
  return Array.from({length:6},(_,i)=>({fundingTime:START+i*8*H+jitter,fundingRate:.0001+i*.00001}));
}
function pack(){
  return{
    binanceFunding:funding(2),
    bybitFunding:funding(47).map(x=>({fundingRateTimestamp:x.fundingTime,fundingRate:x.fundingRate})),
    binanceMarks:marks(),
    bybitMarks:marks().map(x=>({startTime:x.openTime,openPrice:x.open,highPrice:x.high,lowPrice:x.low,closePrice:x.close})),
    provenance:{binanceChecksumsVerified:true,bybitPagesHashed:true}
  };
}

test('funding timestamps canonicalize only inside one-second tolerance',()=>{
  assert.equal(canonicalFundingTime(START+999,contract),START);
  assert.equal(canonicalFundingTime(START+1001,contract),null);
});

test('normalized common funding decisions preserve six shared settlements',()=>{
  const p=pack();
  const b=normalizeFunding(p.binanceFunding,'BINANCE',contract);
  const y=normalizeFunding(p.bybitFunding,'BYBIT',contract);
  assert.equal(commonFundingTimes(b,y).length,6);
  const split=splitCommonTimes(commonFundingTimes(b,y));
  assert.equal(split.discovery.count,3);
  assert.equal(split.validation.count,1);
  assert.equal(split.holdout.count,2);
});

test('valid source requires complete marks, funding and provenance receipts',()=>{
  const r=validateCrossVenueSource(pack(),contract);
  assert.equal(r.ok,true);
  assert.equal(r.commonFundingDecisions,6);
  assert.equal(r.receipt.schema,BASE.schema);
  assert.match(r.receipt.digest,/^[a-f0-9]{64}$/);
});

test('source fails closed on mark cadence gap',()=>{
  const p=pack();p.bybitMarks.splice(10,1);
  assert.equal(validateCrossVenueSource(p,contract).reason,'BYBIT_MARK_CADENCE_GAP');
});

test('source fails closed on funding cadence gap beyond eight hours plus jitter',()=>{
  const p=pack();p.binanceFunding[2].fundingTime=p.binanceFunding[1].fundingTime+8*H+1001;
  assert.equal(validateCrossVenueSource(p,contract).reason,'BINANCE_FUNDING_CADENCE_GAP');
});

test('source fails closed on provider receipt failures',()=>{
  const p=pack();p.provenance.bybitPagesHashed=false;
  assert.equal(validateCrossVenueSource(p,contract).reason,'BYBIT_PAGE_RECEIPTS_NOT_VERIFIED');
});

test('source rejects canonical funding collisions created by timestamp jitter',()=>{
  const p=pack();p.bybitFunding[1].fundingRateTimestamp=p.bybitFunding[0].fundingRateTimestamp+1;
  assert.equal(validateCrossVenueSource(p,contract).reason,'BYBIT_DUPLICATE_FUNDING');
});

test('normalizers expose mark and funding semantics deterministically',()=>{
  const p=pack();
  assert.equal(normalizeMarks(p.bybitMarks,'BYBIT')[0].open,100);
  assert.equal(normalizeFunding(p.bybitFunding,'BYBIT',contract)[0].rate,.0001);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOkxFundingCsv,stableOkxReceiptPayload} from '../scripts/collect-cross-venue-funding-edge-v1-source.mjs';
import {
  CROSS_VENUE_FUNDING_EDGE_V1_SOURCE as BASE,
  canonicalFundingTime,normalizeFunding,normalizeMarks,commonFundingTimes,
  splitCommonTimes,sourceReceipt,validateCrossVenueSource
} from '../research/cross-venue-funding-edge-v1-data-contract.js';

const H=60*60*1000;
const START=Date.parse('2022-03-01T00:00:00.000Z');
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
    okxFunding:funding(47),
    binanceMarks:marks(),
    okxMarks:marks().map(x=>[String(x.openTime),String(x.open),String(x.high),String(x.low),String(x.close),'1']),
    provenance:{binanceChecksumsVerified:true,okxFundingArchivesHashed:true,okxMarkPagesHashed:true}
  };
}

test('production source starts at objectively proven OKX funding archive coverage',()=>{
  assert.equal(BASE.start,'2022-03-01T00:00:00.000Z');
  assert.equal(BASE.venues.okx.source,'OKX_PUBLIC_HISTORY');
});

test('funding timestamps canonicalize only inside one-second tolerance',()=>{
  assert.equal(canonicalFundingTime(START+999,contract),START);
  assert.equal(canonicalFundingTime(START+1001,contract),null);
  assert.equal(canonicalFundingTime(null,contract),null);
  assert.equal(canonicalFundingTime('',contract),null);
  assert.equal(canonicalFundingTime(undefined,contract),null);
  assert.equal(canonicalFundingTime(false,contract),null);
  assert.equal(canonicalFundingTime(true,contract),null);
  assert.equal(canonicalFundingTime([H],contract),null);
});

test('source rejects off-grid funding timestamps as invalid before cadence checks',()=>{
  const p=pack();
  p.okxFunding[2].fundingTime=START+2*8*H+6*60*1000;
  assert.equal(validateCrossVenueSource(p,contract).reason,'OKX_INVALID_FUNDING');
});

test('source rejects coercible non-numeric funding rates instead of silently converting them to zero',()=>{
  for(const bad of ['', '  ', false, true, []]){
    const p=pack();
    p.okxFunding[3].fundingRate=bad;
    assert.equal(validateCrossVenueSource(p,contract).reason,'OKX_INVALID_FUNDING');
  }
});

test('source rejects blank funding timestamps as invalid before gap or range checks',()=>{
  for(const bad of ['', '  ']){
    const p=pack();
    p.okxFunding[3].fundingTime=bad;
    assert.equal(validateCrossVenueSource(p,contract).reason,'OKX_INVALID_FUNDING');
  }
});

test('source rejects blank or boolean mark fields instead of coercing them to zero',()=>{
  for(const field of ['open','high','low','close']){
    for(const bad of ['', false]){
      const p=pack();
      p.binanceMarks[5][field]=bad;
      assert.equal(validateCrossVenueSource(p,contract).reason,'BINANCE_INVALID_MARK');
    }
  }
});

test('numeric strings remain valid for funding rates and funding timestamps',()=>{
  for(const rate of ['0.0001','0']){
    const p=pack();
    p.okxFunding=p.okxFunding.map(x=>({fundingTime:String(x.fundingTime),fundingRate:String(x.fundingRate)}));
    p.okxFunding[3].fundingRate=rate;
    assert.equal(validateCrossVenueSource(p,contract).ok,true);
  }
});

test('normalized common funding decisions preserve six shared settlements',()=>{
  const p=pack();
  const b=normalizeFunding(p.binanceFunding,'BINANCE',contract);
  const o=normalizeFunding(p.okxFunding,'OKX',contract);
  assert.equal(commonFundingTimes(b,o).length,6);
  const split=splitCommonTimes(commonFundingTimes(b,o));
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

test('source fails closed on OKX mark cadence gap',()=>{
  const p=pack();p.okxMarks.splice(10,1);
  assert.equal(validateCrossVenueSource(p,contract).reason,'OKX_MARK_CADENCE_GAP');
});

test('source fails closed on funding cadence gap beyond eight hours plus jitter',()=>{
  const p=pack();p.binanceFunding.splice(2,1);
  assert.equal(validateCrossVenueSource(p,contract).reason,'BINANCE_FUNDING_CADENCE_GAP');
});

test('source fails closed on provider receipt failures',()=>{
  const p=pack();p.provenance.okxFundingArchivesHashed=false;
  assert.equal(validateCrossVenueSource(p,contract).reason,'OKX_FUNDING_ARCHIVES_NOT_HASHED');
  p.provenance.okxFundingArchivesHashed=true;p.provenance.okxMarkPagesHashed=false;
  assert.equal(validateCrossVenueSource(p,contract).reason,'OKX_MARK_PAGE_RECEIPTS_NOT_VERIFIED');
});

test('source rejects canonical OKX funding collisions created by timestamp jitter',()=>{
  const p=pack();p.okxFunding[1].fundingTime=p.okxFunding[0].fundingTime+1;
  assert.equal(validateCrossVenueSource(p,contract).reason,'OKX_DUPLICATE_FUNDING');
});

test('normalizers expose OKX mark and funding semantics deterministically',()=>{
  const p=pack();
  assert.equal(normalizeMarks(p.okxMarks,'OKX')[0].open,100);
  assert.equal(normalizeFunding(p.okxFunding,'OKX',contract)[0].rate,.0001);
});

test('source receipt ignores collection time and receipt completion order',()=>{
  const p=pack();
  p.provenance.collectedAt='2026-10-05T05:00:00Z';
  p.provenance.binance={provider:'Binance Vision',archive:'https://data.binance.vision',receipts:[
    {kind:'funding',scope:'monthly',rel:'z',sha256:'2'},
    {kind:'marks',scope:'monthly',rel:'a',sha256:'1'}
  ]};
  p.provenance.okx={
    provider:'OKX public historical market data',
    baseUrl:'https://www.okx.com',
    fundingQueryReceipts:[
      {endpoint:'/history',params:{begin:'2'},sha256:'q2'},
      {endpoint:'/history',params:{begin:'1'},sha256:'q1'}
    ],
    fundingArchiveReceipts:[
      {filename:'z.zip',url:'https://static.okx.com/z',dateTs:2,sha256:'z'},
      {filename:'a.zip',url:'https://static.okx.com/a',dateTs:1,sha256:'a'}
    ],
    markPageReceipts:[
      {endpoint:'/mark',params:{after:'2'},sha256:'m2'},
      {endpoint:'/mark',params:{after:'1'},sha256:'m1'}
    ]
  };
  const a=sourceReceipt(p,contract);
  p.provenance.collectedAt='2026-10-05T06:00:00Z';
  p.provenance.binance.receipts.reverse();
  p.provenance.okx.fundingQueryReceipts.reverse();
  p.provenance.okx.fundingArchiveReceipts.reverse();
  p.provenance.okx.markPageReceipts.reverse();
  const b=sourceReceipt(p,contract);
  assert.equal(a.digest,b.digest);
});


test('OKX funding archive parser accepts only the verified official header schema',()=>{
  const csv='instrument_name,funding_rate,funding_time\nBTC-USDT-SWAP,-0.0001360076771935,1646064000000\nBTC-USDT-SWAP,0.000084197161794,1646121600000\n';
  assert.deepEqual(parseOkxFundingCsv(csv),[
    {fundingTime:1646064000000,fundingRate:-0.0001360076771935},
    {fundingTime:1646121600000,fundingRate:0.000084197161794}
  ]);
  assert.deepEqual(parseOkxFundingCsv('\uFEFF'+csv),parseOkxFundingCsv(csv));
  assert.throws(()=>parseOkxFundingCsv('symbol,rate,time\nBTC-USDT-SWAP,0.1,1\n'),/OKX_FUNDING_ARCHIVE_SCHEMA/);
  assert.throws(()=>parseOkxFundingCsv('instrument_name,funding_rate,funding_time\nETH-USDT-SWAP,0.1,1\n'),/OKX_FUNDING_ARCHIVE_SCHEMA/);
});


test('OKX historical funding query receipt excludes dynamic response timestamp',()=>{
  const endpoint='/api/v5/public/market-data-history';
  const a=[{ts:'100',dateAggrType:'monthly',totalSizeMB:'0',details:[{instFamily:'BTC-USDT'}]}];
  const b=[{ts:'999',dateAggrType:'monthly',totalSizeMB:'0',details:[{instFamily:'BTC-USDT'}]}];
  assert.deepEqual(stableOkxReceiptPayload(endpoint,a),stableOkxReceiptPayload(endpoint,b));
  assert.deepEqual(stableOkxReceiptPayload('/api/v5/market/history-mark-price-candles',[['1','2']]),[['1','2']]);
});

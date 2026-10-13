import test from 'node:test';
import assert from 'node:assert/strict';
import { applySpotFill } from '../docs/strategy-lab/spot-ledger.mjs';
const fixture=()=>({account:{currency:'EUR',cashMicros:'10000000000',positions:[],processedFillIds:[]},fill:{id:'fill-1',symbol:'BTC',side:'BUY',lots:'10',priceMicrosPerLot:'100000000',feeMicros:'1000000',signalAvailableAtMs:1000,quoteAtMs:1001,quoteReceivedAtMs:1002,fillAtMs:1003},maxQuoteAgeMs:10});
const reject=x=>{const r=applySpotFill(x);assert.equal(r.valid,false);assert.equal(r.account,null);assert.ok(r.errors.length);assert.equal(r.executionAuthorized,false);};
test('buy deducts exact notional and fee and creates position',()=>{const r=applySpotFill(fixture());assert.equal(r.valid,true);assert.equal(r.account.cashMicros,'8999000000');assert.deepEqual(r.account.positions,[{symbol:'BTC',lots:'10'}]);assert.deepEqual(r.account.processedFillIds,['fill-1']);assert.equal(r.executionAuthorized,false);assert.equal(r.researchOnly,true);});
test('sell roundtrip at same price loses precisely two fees',()=>{const x=fixture();x.account=applySpotFill(x).account;x.fill={...x.fill,id:'fill-2',side:'SELL'};const r=applySpotFill(x);assert.equal(r.valid,true);assert.equal(r.account.cashMicros,'9998000000');assert.ok(r.account.positions.every(p=>p.lots==='0'));});
test('fee cannot push cash negative',()=>{const x=fixture();x.account.cashMicros='1000000000';reject(x);});
test('no short sale or position oversell',()=>{const x=fixture();x.fill.side='SELL';reject(x);x.account.positions=[{symbol:'BTC',lots:'9'}];reject(x);});
test('replayed fill rejects without mutating input',()=>{const x=fixture();x.account=applySpotFill(x).account;const before=structuredClone(x);reject(x);assert.deepEqual(x,before);});
test('quote must follow signal availability and arrive before fill',()=>{for(const patch of [{quoteAtMs:1000},{quoteReceivedAtMs:1000},{fillAtMs:1001},{fillAtMs:1020}]){const x=fixture();Object.assign(x.fill,patch);reject(x);}});
test('malformed quantities and money reject without number coercion',()=>{for(const v of ['01','-1','1.5','1e3',1,'']){const x=fixture();x.fill.lots=v;reject(x);}const x=fixture();x.fill.lots='0';reject(x);});
test('unknown schema and nonEUR accounts reject',()=>{const x=fixture();x.account.currency='USD';reject(x);reject({...fixture(),extra:true});reject(null);});
test('duplicate holdings or processed ids reject',()=>{const x=fixture();x.account.positions=[{symbol:'BTC',lots:'1'},{symbol:'BTC',lots:'1'}];reject(x);const y=fixture();y.account.processedFillIds=['a','a'];reject(y);});
test('large integers retain values above floating point precision',()=>{const x=fixture();x.account.cashMicros='90071992547409930';x.fill.lots='1';x.fill.priceMicrosPerLot='9007199254740993';x.fill.feeMicros='1';const r=applySpotFill(x);assert.equal(r.valid,true);assert.equal(r.account.cashMicros,'81064793292668936');});
test('adverse sale fee cannot produce borrowing',()=>{const x=fixture();x.account.cashMicros='0';x.account.positions=[{symbol:'BTC',lots:'1'}];x.fill.side='SELL';x.fill.lots='1';x.fill.feeMicros='100000001';reject(x);});
test('successful operation leaves caller state unchanged',()=>{const x=fixture();const before=structuredClone(x);applySpotFill(x);assert.deepEqual(x,before);});
test('canonical amounts and symbols reject a trailing newline',()=>{for(const field of ['lots','priceMicrosPerLot','feeMicros','symbol']){const x=fixture();x.fill[field]+='\n';reject(x);}});
test('reserve closes all 50 positions with full history retained',()=>{
  const x=fixture();x.account.processedFillIds=Array.from({length:10000},(_,i)=>`old${i}`);
  x.account.positions=Array.from({length:50},(_,i)=>({symbol:`A${i}`,lots:'2'}));
  for(let i=0;i<50;i++) {
    x.fill={...x.fill,id:`close${i}`,symbol:`A${i}`,side:'SELL',lots:'2',feeMicros:'0'};
    const r=applySpotFill(x);assert.equal(r.valid,true,r.errors);x.account=r.account;
  }
  assert.equal(x.account.processedFillIds.length,10050);assert.deepEqual(x.account.positions,[]);
  assert.equal(x.account.processedFillIds[0],'old0');reject(x);
  x.fill={...x.fill,id:'newbuy',side:'BUY'};reject(x);
});
test('normal cap prevents buys and partial reserve sales',()=>{
  const x=fixture();x.account.processedFillIds=Array.from({length:10000},(_,i)=>`old${i}`);
  x.account.positions=[{symbol:'BTC',lots:'10'}];reject(x);
  x.fill={...x.fill,side:'SELL',lots:'9'};reject(x);
  x.fill.lots='10';assert.equal(applySpotFill(x).valid,true);
});
test('forged reserve state lacking one slot per held asset rejects',()=>{
  const x=fixture();x.account.processedFillIds=Array.from({length:10050},(_,i)=>`old${i}`);
  x.account.positions=[{symbol:'BTC',lots:'10'}];x.fill.side='SELL';reject(x);
});

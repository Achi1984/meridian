import test from 'node:test';import assert from 'node:assert/strict';import {validateSource,sourceReceipt,EDGE_V1_SOURCE} from '../research/paper-edge-v1-data-contract.js';import {parseFundingCsv,klineMonthCoverageOk} from '../scripts/collect-paper-edge-v1-source.mjs';
const t=Date.parse(EDGE_V1_SOURCE.start), bar={openTime:t,closeTime:t+14399999,open:1,high:2,low:.5,close:1.5,volume:1},fund={time:t+1000,rate:.0001};
const pack=()=>({provenance:{paginationComplete:true,fundingComplete:Object.fromEntries(EDGE_V1_SOURCE.symbols.map(s=>[s,true]))},barsBySymbol:Object.fromEntries(EDGE_V1_SOURCE.symbols.map(s=>[s,[{...bar}]])),fundingBySymbol:Object.fromEntries(EDGE_V1_SOURCE.symbols.map(s=>[s,[{...fund}]]))});
test('complete frozen source shape validates deterministically',()=>{const x=pack();assert.equal(validateSource(x).ok,true);assert.equal(sourceReceipt(x).digest,sourceReceipt(x).digest)});
test('missing funding fails closed',()=>{const x=pack();x.fundingBySymbol.ETHUSDT=[];assert.deepEqual(validateSource(x),{ok:false,reason:'MISSING_FUNDING',symbol:'ETHUSDT'})});
test('duplicate bars fail closed',()=>{const x=pack();x.barsBySymbol.BTCUSDT.push({...bar});assert.equal(validateSource(x).reason,'DUPLICATE_BARS')});

test('unordered bars fail closed',()=>{const x=pack();x.barsBySymbol.BTCUSDT=[{...bar,openTime:t+14400000,closeTime:t+28799999},{...bar}];assert.equal(validateSource(x).reason,'UNORDERED_BARS')});
test('nonfinite funding mark fails closed',()=>{const x=pack();x.fundingBySymbol.SOLUSDT[0].markPrice=NaN;assert.equal(validateSource(x).reason,'INVALID_FUNDING')});
test('funding archive rows parse from authoritative Binance schema',()=>{assert.deepEqual(parseFundingCsv('calc_time,funding_interval_hours,last_funding_rate\n1609459200000,8,0.00010000\n'),[{time:1609459200000,rate:.0001,markPrice:null,rateType:null}])});
test('unknown funding archive schema fails closed',()=>{assert.throws(()=>parseFundingCsv('time,rate\n1,0.1\n'),/FUNDING_ARCHIVE_SCHEMA/)});
test('monthly kline coverage detects an incomplete authoritative month',()=>{
 const step=EDGE_V1_SOURCE.intervalMs,first=Date.UTC(2022,1,1),last=Date.UTC(2022,2,1)-step;
 const rows=[];for(let x=first;x<=last;x+=step)rows.push({openTime:x,closeTime:x+step-1});
 assert.equal(klineMonthCoverageOk(rows,2022,2),true);
 assert.equal(klineMonthCoverageOk(rows.slice(0,-6),2022,2),false);
});

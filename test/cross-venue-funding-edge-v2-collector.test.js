import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assertV2SourceAuditAuthorized,
  collectCrossVenueFundingEdgeV2Source,
  parseBinanceMarkCsv,parseBinanceFundingCsv,
  parseOkxFundingCsv,parseOkxMarkRows,stableOkxReceiptPayload
} from '../scripts/collect-cross-venue-funding-edge-v2-source.mjs';

test('collector refuses all source collection while V2 sourceAudit is false',async()=>{
  assert.throws(()=>assertV2SourceAuditAuthorized(),/SOURCE_AUDIT_LOCKED/);
  await assert.rejects(()=>collectCrossVenueFundingEdgeV2Source(),/SOURCE_AUDIT_LOCKED/);
  assert.equal(assertV2SourceAuditAuthorized({ruleset:'CROSS-VENUE-FUNDING-EDGE-V2',sourceAudit:true}),true);
  assert.throws(()=>assertV2SourceAuditAuthorized({ruleset:'CROSS-VENUE-FUNDING-EDGE-V2',sourceAudit:false}),/SOURCE_AUDIT_LOCKED/);
});

test('Binance funding parser accepts explicit numeric cells and rejects blanks',()=>{
  const csv='calc_time,symbol,last_funding_rate\n1760000000000,BTCUSDT,0.0001\n';
  assert.deepEqual(parseBinanceFundingCsv(csv),[{fundingTime:1760000000000,fundingRate:.0001}]);
  assert.throws(()=>parseBinanceFundingCsv('calc_time,symbol,last_funding_rate\n1760000000000,BTCUSDT,\n'),/ARCHIVE_ROW/);
  assert.throws(()=>parseBinanceFundingCsv('calc_time,symbol,last_funding_rate\n,BTCUSDT,0.0001\n'),/ARCHIVE_ROW/);
  assert.throws(()=>parseBinanceFundingCsv('calc_time,symbol,last_funding_rate\n1760000000000,BTCUSDT,false\n'),/ARCHIVE_ROW/);
});

test('Binance mark parser rejects blank or non-numeric OHLC cells instead of coercing zero',()=>{
  const good='1760000000000,100,101,99,100.5,0,0,0\n';
  assert.deepEqual(parseBinanceMarkCsv(good),[{openTime:1760000000000,open:100,high:101,low:99,close:100.5,confirmed:true}]);
  assert.throws(()=>parseBinanceMarkCsv('1760000000000,100,101,,100.5\n'),/ARCHIVE_ROW/);
  assert.throws(()=>parseBinanceMarkCsv('1760000000000,100,false,99,100.5\n'),/ARCHIVE_ROW/);
});

test('OKX funding parser enforces exact schema instrument and strict cells',()=>{
  const csv='instrument_name,funding_rate,funding_time\nBTC-USDT-SWAP,-0.0001,1760000000000\n';
  assert.deepEqual(parseOkxFundingCsv(csv),[{fundingTime:1760000000000,fundingRate:-.0001}]);
  assert.throws(()=>parseOkxFundingCsv('instrument_name,funding_rate,funding_time\nBTC-USDT-SWAP,,1760000000000\n'),/ARCHIVE_ROW/);
  assert.throws(()=>parseOkxFundingCsv('instrument_name,funding_rate,funding_time\nETH-USDT-SWAP,0.1,1760000000000\n'),/ARCHIVE_SCHEMA/);
});

test('OKX mark parser requires confirmed rows and strict explicit array positions',()=>{
  const good=[['1760000000000','100','101','99','100.5','1']];
  assert.deepEqual(parseOkxMarkRows(good),[{openTime:1760000000000,open:100,high:101,low:99,close:100.5,confirmed:true}]);
  assert.throws(()=>parseOkxMarkRows([['1760000000000','100','101','99','100.5','0']]),/PAGE_ROW/);
  assert.throws(()=>parseOkxMarkRows([['1760000000000','100','','99','100.5','1']]),/PAGE_ROW/);
});

test('OKX archive-query receipt excludes only the dynamic response timestamp',()=>{
  const endpoint='/api/v5/public/market-data-history';
  const a=[{ts:'100',dateAggrType:'monthly',details:[{instFamily:'BTC-USDT'}]}];
  const b=[{ts:'999',dateAggrType:'monthly',details:[{instFamily:'BTC-USDT'}]}];
  assert.deepEqual(stableOkxReceiptPayload(endpoint,a),stableOkxReceiptPayload(endpoint,b));
  assert.deepEqual(stableOkxReceiptPayload('/api/v5/market/history-mark-price-candles',[['1','2']]),[['1','2']]);
});

test('new V2 source/data-contract code has no direct Number coercion outside strictNum core',()=>{
  const collector=fs.readFileSync(new URL('../scripts/collect-cross-venue-funding-edge-v2-source.mjs',import.meta.url),'utf8');
  const contract=fs.readFileSync(new URL('../research/cross-venue-funding-edge-v2-data-contract.js',import.meta.url),'utf8');
  const core=fs.readFileSync(new URL('../research/cross-venue-funding-edge-v2.js',import.meta.url),'utf8');
  assert.doesNotMatch(collector,/\bNumber\s*\(/);
  assert.doesNotMatch(contract,/\bNumber\s*\(/);
  assert.equal((core.match(/\bNumber\s*\(/g)||[]).length,1);
});

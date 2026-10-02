import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeOkxBalanceResponse,readOkxCredentials,mergeOkxAccountState,fetchOkxAccountSnapshot} from '../okx-account-read-sync.js';

test('OKX balance normalization uses totalEq USD and stores minimal provenance',()=>{
  const x=normalizeOkxBalanceResponse({code:'0',data:[{totalEq:'44480.5383',details:[{ccy:'USDT',uTime:'1790958000000'},{ccy:'BTC',uTime:'1790958060000'}]}]},'2026-10-02T16:40:00.000Z');
  assert.equal(x.totalEqUsd,44480.5383);
  assert.equal(x.source,'OKX_ACCOUNT_READ_API');
  assert.equal(x.readOnly,true);
  assert.equal(x.endpoint,'GET /api/v5/account/balance');
  assert.equal(x.currencyCount,2);
  assert.equal(x.snapshotAt,'2026-10-02T16:40:00.000Z');
});

test('successful OKX snapshot replaces only OKX venue authority and preserves other venues',()=>{
  const current={privateRevision:7,portfolio:{manualVenueBalances:[
    {venue:'Ledger',valueUsd:12000,updatedAt:'2026-10-02T00:00:00Z',source:'OTHER'},
    {venue:'OKX',valueUsd:1,updatedAt:'2026-10-01T00:00:00Z',source:'USER_CONFIRMED_PORTFOLIO_AUTHORITY'}
  ]}};
  const snapshot={totalEqUsd:2345.67,snapshotAt:'2026-10-02T16:40:00.000Z',source:'OKX_ACCOUNT_READ_API',readOnly:true};
  const next=mergeOkxAccountState(current,{snapshot,status:'OK',attemptAt:snapshot.snapshotAt,successAt:snapshot.snapshotAt,configured:true,apiBase:'https://eea.okx.com'});
  assert.equal(next.privateRevision,8);
  assert.equal(next.okxAccount.totalEqUsd,2345.67);
  assert.equal(next.portfolio.manualVenueBalances.filter(x=>x.venue==='Ledger').length,1);
  const okx=next.portfolio.manualVenueBalances.filter(x=>x.venue==='OKX');
  assert.equal(okx.length,1);
  assert.equal(okx[0].valueUsd,2345.67);
  assert.equal(okx[0].source,'OKX_ACCOUNT_READ_API');
  assert.equal(next.portfolio.okxAuthoritySource,'OKX_ACCOUNT_READ_API');
  assert.equal(next.okxAccountSync.readOnly,true);
  assert.deepEqual(next.okxAccountSync.endpoints,['GET /api/v5/account/balance']);
});

test('OKX error update keeps last successful authority intact',()=>{
  const current={privateRevision:1,portfolio:{manualVenueBalances:[{venue:'OKX',valueUsd:99,updatedAt:'2026-10-02T16:00:00Z',source:'OKX_ACCOUNT_READ_API'}]},okxAccount:{totalEqUsd:99,snapshotAt:'2026-10-02T16:00:00Z'}};
  const next=mergeOkxAccountState(current,{status:'ERROR',error:'network',attemptAt:'2026-10-02T16:45:00Z',configured:true,apiBase:'https://eea.okx.com'});
  assert.equal(next.okxAccount.totalEqUsd,99);
  assert.equal(next.portfolio.manualVenueBalances[0].valueUsd,99);
  assert.equal(next.okxAccountSync.status,'ERROR');
  assert.equal(next.okxAccountSync.lastSuccessAt,null);
});

test('OKX credentials require key secret passphrase and accept regional API base',()=>{
  const good=readOkxCredentials({OKX_READ_API_KEY:'k',OKX_READ_API_SECRET:'s',OKX_READ_API_PASSPHRASE:'p',OKX_READ_API_BASE_URL:'https://eea.okx.com'});
  assert.equal(good.ok,true); assert.equal(good.apiBase,'https://eea.okx.com');
  assert.equal(readOkxCredentials({OKX_READ_API_KEY:'k',OKX_READ_API_SECRET:'s'}).ok,false);
  assert.equal(readOkxCredentials({OKX_READ_API_KEY:'k',OKX_READ_API_SECRET:'s',OKX_READ_API_PASSPHRASE:'p',OKX_READ_API_BASE_URL:'https://evil.example'}).ok,false);
});

test('fetch OKX snapshot remains GET-only',async()=>{
  let method=null,url=null;
  const snapshot=await fetchOkxAccountSnapshot({
    apiKey:'k',apiSecret:'s',passphrase:'p',apiBase:'https://www.okx.com',now:()=>Date.parse('2026-10-02T16:40:00Z'),
    fetchImpl:async(u,o)=>{url=u;method=o.method;return{ok:true,status:200,text:async()=>JSON.stringify({code:'0',data:[{totalEq:'12.34',details:[]}]})}}
  });
  assert.equal(method,'GET');
  assert.equal(url,'https://www.okx.com/api/v5/account/balance');
  assert.equal(snapshot.totalEqUsd,12.34);
});

test('runtime wires OKX sync and public health exposes status only, not equity',()=>{
  const start=fs.readFileSync(new URL('../scripts/start-gateway.mjs',import.meta.url),'utf8');
  const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
  assert.match(start,/startOkxAccountReadSync/);
  assert.match(gateway,/okxReadConfigured:OKX_READ_CONFIGURED/);
  assert.match(gateway,/okxAccountStatus:String\(okxSync\.status/);
  assert.doesNotMatch(gateway,/okxAccountTotalEq|okxTotalEqUsd/);
});

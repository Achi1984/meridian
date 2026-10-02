import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  readOkxPortfolioAuthorityCredentials,
  okxPortfolioAuthorityBaseUrl,
  okxPortfolioAuthorityPath,
  okxPortfolioAuthorityHeaders,
  parseOkxAssetValuation,
  fetchOkxPortfolioAuthoritySnapshot,
  applyOkxPortfolioAuthoritySnapshot
} from '../okx-portfolio-authority-sync.js';

const start=fs.readFileSync(new URL('../scripts/start-gateway.mjs',import.meta.url),'utf8');
const backend=fs.readFileSync(new URL('../.github/workflows/backend-safety.yml',import.meta.url),'utf8');

test('OKX authority credentials are read-only and complete only with key secret passphrase',()=>{
  assert.equal(readOkxPortfolioAuthorityCredentials({}).ok,false);
  assert.equal(readOkxPortfolioAuthorityCredentials({OKX_READ_API_KEY:'k',OKX_READ_API_SECRET:'s',OKX_READ_API_PASSPHRASE:'p'}).ok,true);
});

test('OKX authority base URL is HTTPS-only and configurable for regional API domains',()=>{
  assert.equal(okxPortfolioAuthorityBaseUrl({}),'https://www.okx.com');
  assert.equal(okxPortfolioAuthorityBaseUrl({OKX_READ_API_BASE_URL:'https://eea.okx.com/'}),'https://eea.okx.com');
  assert.throws(()=>okxPortfolioAuthorityBaseUrl({OKX_READ_API_BASE_URL:'http://example.com'}),/invalid_okx_api_base_url/);
});

test('OKX asset valuation parser accepts fresh finite USD authority and rejects unsafe timestamps',()=>{
  const now=Date.parse('2026-10-02T16:30:00Z'),ts=now-20_000;
  const body={code:'0',data:[{totalBal:'1234.56',ts:String(ts),details:{trading:'1200',funding:'34.56'}}]};
  const x=parseOkxAssetValuation(body,{nowMs:now});
  assert.equal(x.totalUsd,1234.56);
  assert.equal(x.currency,'USD');
  assert.equal(x.source,'OKX_READ_API_ASSET_VALUATION');
  assert.equal(x.timestampMs,ts);
  assert.throws(()=>parseOkxAssetValuation({code:'1',data:[]},{nowMs:now}),/api_error/);
  assert.throws(()=>parseOkxAssetValuation({code:'0',data:[{totalBal:'-1',ts:String(ts)}]},{nowMs:now}),/invalid_total/);
  assert.throws(()=>parseOkxAssetValuation({code:'0',data:[{totalBal:'1',ts:String(now+31_000)}]},{nowMs:now}),/future_timestamp/);
  assert.throws(()=>parseOkxAssetValuation({code:'0',data:[{totalBal:'1',ts:String(now-301_000)}]},{nowMs:now,maxAgeMs:300_000}),/stale/);
});

test('OKX GET signature covers the exact USD asset-valuation request path',()=>{
  const path=okxPortfolioAuthorityPath(),now=Date.parse('2026-10-02T16:30:00Z');
  assert.equal(path,'/api/v5/asset/asset-valuation?ccy=USD');
  const h=okxPortfolioAuthorityHeaders(path,{apiKey:'key',apiSecret:'secret',passphrase:'pass',now});
  assert.equal(h['OK-ACCESS-KEY'],'key');
  assert.equal(h['OK-ACCESS-PASSPHRASE'],'pass');
  assert.equal(h['OK-ACCESS-TIMESTAMP'],new Date(now).toISOString());
  assert.match(h['OK-ACCESS-SIGN'],/^[A-Za-z0-9+/]+=*$/);
});

test('OKX authority fetch is GET-only and uses the configured regional base URL',async()=>{
  const now=Date.parse('2026-10-02T16:30:00Z'),seen=[];
  const fetchImpl=async(url,opts)=>{
    seen.push({url,opts});
    return {ok:true,status:200,text:async()=>JSON.stringify({code:'0',data:[{totalBal:'321.09',ts:String(now-1000)}]})};
  };
  const x=await fetchOkxPortfolioAuthoritySnapshot({
    env:{OKX_READ_API_KEY:'k',OKX_READ_API_SECRET:'s',OKX_READ_API_PASSPHRASE:'p',OKX_READ_API_BASE_URL:'https://eea.okx.com'},
    fetchImpl,now:()=>now
  });
  assert.equal(x.totalUsd,321.09);
  assert.equal(seen.length,1);
  assert.equal(seen[0].url,'https://eea.okx.com/api/v5/asset/asset-valuation?ccy=USD');
  assert.equal(seen[0].opts.method,'GET');
  assert.equal(seen[0].opts.body,undefined);
});

test('automatic OKX authority upsert replaces only OKX venue reference and preserves other portfolio sources',()=>{
  const snapshot={totalUsd:222.22,updatedAt:'2026-10-02T16:30:00.000Z',source:'OKX_READ_API_ASSET_VALUATION'};
  const current={privateRevision:4,portfolio:{
    holdings:[{venue:'Ledger',symbol:'BTC',quantity:.1,updatedAt:'2026-10-02T16:00:00Z'}],
    manualVenueBalances:[
      {venue:'Pionex',valueUsd:34000,updatedAt:'2026-10-02T16:29:00Z',source:'PIONEX'},
      {venue:'OKX',valueUsd:111,updatedAt:'2026-10-01T16:00:00Z',source:'USER_CONFIRMED_PORTFOLIO_AUTHORITY'}
    ]
  }};
  const r=applyOkxPortfolioAuthoritySnapshot(current,snapshot);
  assert.equal(r.ok,true);
  assert.equal(r.changed,true);
  assert.equal(r.nextRevision,5);
  assert.deepEqual(r.data.portfolio.holdings,current.portfolio.holdings);
  assert.equal(r.data.portfolio.manualVenueBalances.find(x=>x.venue==='Pionex').valueUsd,34000);
  const okx=r.data.portfolio.manualVenueBalances.filter(x=>x.venue==='OKX');
  assert.equal(okx.length,1);
  assert.equal(okx[0].valueUsd,222.22);
  assert.equal(okx[0].source,'OKX_READ_API_ASSET_VALUATION');
  assert.equal(r.data.portfolio.okxAuthoritySource,'OKX_READ_API_ASSET_VALUATION');
  assert.equal(r.data.privateUpdateSource,'automatic_read_only_okx_portfolio_authority_sync');
});

test('automatic OKX authority never rolls a newer manual or API authority backward',()=>{
  const current={privateRevision:8,portfolio:{manualVenueBalances:[{venue:'OKX',valueUsd:500,updatedAt:'2026-10-02T16:31:00Z',source:'USER_CONFIRMED_PORTFOLIO_AUTHORITY'}]}};
  const r=applyOkxPortfolioAuthoritySnapshot(current,{totalUsd:400,updatedAt:'2026-10-02T16:30:00Z',source:'OKX_READ_API_ASSET_VALUATION'});
  assert.equal(r.ok,true);
  assert.equal(r.changed,false);
  assert.equal(r.nextRevision,8);
  assert.equal(r.data.portfolio.manualVenueBalances[0].valueUsd,500);
});

test('gateway startup enables only the new value-authority sync, not the retired holdings auto-sync',()=>{
  assert.match(start,/startOkxPortfolioAuthoritySync/);
  assert.match(start,/startOkxPortfolioAuthoritySync\(\);\nstartPortfolioHistoryCapture\(\)/);
  assert.doesNotMatch(start,/startExchangeAutoSync/);
  assert.match(backend,/node --check okx-portfolio-authority-sync\.js/);
});

test('health exposes only a boolean OKX authority configuration diagnostic',()=>{
  const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
  assert.match(gateway,/const OKX_PORTFOLIO_AUTHORITY_CONFIGURED=!!\(/);
  assert.match(gateway,/okxPortfolioAuthorityConfigured:OKX_PORTFOLIO_AUTHORITY_CONFIGURED/);
  assert.doesNotMatch(gateway,/okxPortfolioAuthorityConfigured:[^\n]*OKX_READ_API_SECRET/);
});

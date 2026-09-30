import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reconcilePortfolioAuthority} from '../portfolio-authority-update.js';
import {historySnapshot} from '../portfolio-history-store.js';

const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r94 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r94');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/PORTFOLIO-AUTHORITY-SERVER-HISTORY/);
  assert.equal(manifest.start_url,'./v10/?build=r94&fresh=r94');
});

test('r94 Ledger confirmation refreshes only existing Ledger holding authority',()=>{
  const now='2026-09-30T18:30:00.000Z';
  const current={privateRevision:7,portfolio:{holdings:[
    {venue:'Ledger',symbol:'BTC',quantity:.01,updatedAt:'2026-09-01T00:00:00Z'},
    {venue:'Other',symbol:'SOL',quantity:2,updatedAt:'2026-09-01T00:00:00Z'}
  ]}};
  const r=reconcilePortfolioAuthority(current,{action:'confirm_ledger'},{now});
  assert.equal(r.ok,true);
  assert.equal(r.nextRevision,8);
  assert.equal(r.data.portfolio.ledgerAuthorityAt,now);
  assert.equal(r.data.portfolio.holdings[0].updatedAt,now);
  assert.equal(r.data.portfolio.holdings[1].updatedAt,'2026-09-01T00:00:00Z');
  assert.equal(r.data.portfolio.holdings[0].quantity,.01);
  assert.equal(current.portfolio.holdings[0].updatedAt,'2026-09-01T00:00:00Z');
});

test('r94 Ledger confirmation fails closed without known Ledger holdings',()=>{
  const r=reconcilePortfolioAuthority({privateRevision:1,portfolio:{holdings:[]}},{action:'confirm_ledger'},{now:'2026-09-30T18:30:00.000Z'});
  assert.deepEqual({ok:r.ok,error:r.error,currentRevision:r.currentRevision},{ok:false,error:'ledger_holdings_missing',currentRevision:1});
});

test('r94 OKX reconciliation upserts one finite nonnegative server reference',()=>{
  const now='2026-09-30T18:31:00.000Z';
  const current={privateRevision:2,portfolio:{manualVenueBalances:[
    {venue:'Pionex',valueUsd:34000,updatedAt:'2026-09-30T18:29:00Z'},
    {venue:'OKX',valueUsd:100,updatedAt:'2026-09-29T00:00:00Z'}
  ]}};
  const r=reconcilePortfolioAuthority(current,{action:'set_okx',valueUsd:132.45},{now});
  assert.equal(r.ok,true);
  const okx=r.data.portfolio.manualVenueBalances.filter(x=>x.venue==='OKX');
  assert.equal(okx.length,1);
  assert.equal(okx[0].valueUsd,132.45);
  assert.equal(okx[0].updatedAt,now);
  assert.equal(r.data.portfolio.manualVenueBalances.find(x=>x.venue==='Pionex').valueUsd,34000);
  assert.equal(reconcilePortfolioAuthority(current,{action:'set_okx',valueUsd:-1},{now}).ok,false);
});

test('r94 canonical history accepts fresh Ledger holdings plus current OKX authority',()=>{
  const now=Date.parse('2026-09-30T18:32:00Z');
  const data={
    privateRevision:9,
    livePrices:{BTC:{price:50000}},
    livePriceMeta:{fresh:true},
    portfolio:{
      ledgerAuthorityAt:'2026-09-30T18:30:00Z',
      holdings:[{venue:'Ledger',symbol:'BTC',quantity:.01,updatedAt:'2026-09-30T18:30:00Z'}],
      manualVenueBalances:[{venue:'OKX',valueUsd:130,updatedAt:'2026-09-30T18:31:00Z'}],
      pionexEquityUsd:34500,
      pionexEquitySource:'PIONEX_WALLET_READ_API',
      pionexEquityUpdatedAt:'2026-09-30T18:31:30Z'
    }
  };
  const snap=historySnapshot(data,{timestamp:now});
  assert.equal(snap.authorityComplete,true);
  assert.equal(snap.spotUsd,630);
  assert.equal(snap.tradingUsd,34500);
  assert.equal(snap.totalUsd,35130);
  assert.equal(snap.sourceStatus.spot,'STRICT_AUTHORITY');
});

test('r94 history still fails closed when OKX authority is absent',()=>{
  const now=Date.parse('2026-09-30T18:32:00Z');
  const snap=historySnapshot({
    livePrices:{BTC:{price:50000}},
    portfolio:{
      holdings:[{venue:'Ledger',symbol:'BTC',quantity:.01,updatedAt:'2026-09-30T18:30:00Z'}],
      manualVenueBalances:[],
      pionexEquityUsd:34500
    }
  },{timestamp:now});
  assert.equal(snap.authorityComplete,false);
});

test('r94 gateway exposes only the limited read-token portfolio reconciliation endpoint',()=>{
  assert.match(gateway,/POST"&&u\.pathname==="\/api\/private\/portfolio-authority"/);
  assert.match(gateway,/if\(!authorizedRead\(req\)\)return writeJson\(res,401,\{error:"read_token_required"\}/);
  assert.match(gateway,/reconcilePortfolioAuthority\(current,body\)/);
  assert.match(gateway,/capturePortfolioHistoryOnce\(\{db:pool\(\),data:merged\.data,dedupeMs:0\}\)/);
});

test('r94 client persists Ledger and OKX reconciliation on server before refresh',()=>{
  const start=v9.indexOf('function bindPortfolioRefEditor()'),end=v9.indexOf('const $=',start),block=v9.slice(start,end);
  assert.match(block,/postJson\('\/api\/private\/portfolio-authority',\{action:'confirm_ledger'\}\)/);
  assert.match(block,/postJson\('\/api\/private\/portfolio-authority',\{action:'set_okx',valueUsd:value\}\)/);
  assert.match(v9,/serverAt=String\(d\?\.portfolio\?\.ledgerAuthorityAt/);
  assert.match(v9,/byVenue=new Map\(\)/);
});

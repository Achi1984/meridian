import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canonicalPortfolioSnapshot,externalVenueBalanceSnapshot,PORTFOLIO_AUTHORITY_MAX_AGE_MS} from '../portfolio-data-contract.js';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r63 strict portfolio authority excludes stale holdings and avoids double counting covered venues',()=>{
  const now=Date.parse('2026-09-28T18:45:00Z');
  const data={
    livePrices:{BTC:{price:100},SOL:{price:20}},
    portfolio:{
      authorityMode:'STRICT_VENUE_SNAPSHOT',
      externalVenueSnapshotComplete:true,
      externalVenueExpectedVenues:['Ledger','OKX'],
      manualVenueBalances:[
        {venue:'Ledger',valueUsd:798.62,updatedAt:'2026-09-28T18:40:00Z',source:'LOCAL_USER_REFERENCE'},
        {venue:'OKX',valueUsd:119.21,updatedAt:'2026-09-28T18:39:00Z',source:'LOCAL_USER_REFERENCE'}
      ],
      holdings:[
        {venue:'Ledger',symbol:'BTC',quantity:100,updatedAt:'2026-09-28T18:41:00Z'},
        {venue:'Legacy Exchange',symbol:'SOL',quantity:1000,updatedAt:'2026-09-20T00:00:00Z'}
      ],
      pionexEquityUsd:35622.26,
      pionexEquitySource:'PIONEX_WALLET_READ_API'
    }
  };
  const snap=canonicalPortfolioSnapshot(data,now);
  assert.equal(snap.spotUsd,917.83);
  assert.equal(snap.tradingUsd,35622.26);
  assert.equal(snap.totalUsd,36540.09);
  assert.equal(snap.spotAuthority.complete,true);
  assert.equal(snap.spotAuthority.supersededHoldings,1);
  assert.equal(snap.spotAuthority.excludedStaleHoldings,1);
  assert.deepEqual(snap.spotAuthority.venues,['Ledger','OKX']);
});

test('r63 external snapshot is incomplete when an expected venue is missing or stale',()=>{
  const now=Date.parse('2026-09-28T18:45:00Z');
  const external=externalVenueBalanceSnapshot({portfolio:{
    externalVenueSnapshotComplete:true,
    externalVenueExpectedVenues:['Ledger','OKX'],
    manualVenueBalances:[
      {venue:'Ledger',valueUsd:798.62,updatedAt:'2026-09-28T18:40:00Z'},
      {venue:'OKX',valueUsd:119.21,updatedAt:'2026-09-26T18:00:00Z'}
    ]
  }},now,PORTFOLIO_AUTHORITY_MAX_AGE_MS);
  assert.equal(external.complete,false);
  assert.deepEqual(external.missingExpectedVenues,['OKX']);
  assert.equal(external.totalUsd,798.62);
});

test('r63 client uses local private venue references instead of hard-coded personal balances',()=>{
  assert.match(v9,/EXTERNAL_VENUE_REF_KEY='meridian\.v10\.externalVenueRefs'/);
  assert.match(v9,/EXTERNAL_VENUE_EXPECTED=\['Ledger','OKX'\]/);
  assert.match(v9,/authorityMode:'STRICT_VENUE_SNAPSHOT'/);
  assert.match(v9,/externalVenueSnapshotComplete:true/);
  assert.match(v9,/externalVenueExpectedVenues:expectedExternal/);
  assert.doesNotMatch(v9,/798\.62|119\.21|35509\.65/);
  assert.match(v9,/LEDGER ASSETS BESTÄTIGEN/);
  assert.match(v9,/OKX WERT AKTUALISIEREN/);
});

test('r63+ command excludes stale holdings and keeps legacy OKX DCA outside total',()=>{
  assert.match(v9,/CANONICAL TOTAL · LEDGER AUTO \+ OKX \+ PIONEX/);
  assert.match(v9,/nicht autorisierte Alt-Holdings ausgeschlossen/);
  assert.match(v9,/OKX DCA OLD REF/);
  assert.match(v9,/NICHT IM TOTAL/);
  assert.match(v10,/Ledger auto \+ OKX ref \+ Pionex SSOT/);
});

test('r63 remains portfolio presentation/data authority only in successor releases',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=63);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

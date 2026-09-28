import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canonicalPortfolioSnapshot} from '../portfolio-data-contract.js';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r64 strict authority can combine live-priced Ledger holdings with an OKX venue balance',()=>{
  const now=Date.parse('2026-09-28T19:10:00Z');
  const data={
    livePrices:{BTC:{price:50000},ETH:{price:2500}},
    livePriceMeta:{fresh:true},
    portfolio:{
      authorityMode:'STRICT_VENUE_SNAPSHOT',
      externalVenueSnapshotComplete:true,
      externalVenueExpectedVenues:['OKX'],
      requiredHoldingVenues:['Ledger'],
      manualVenueBalances:[{venue:'OKX',valueUsd:120,updatedAt:'2026-09-28T19:08:00Z'}],
      holdings:[
        {venue:'Ledger',symbol:'BTC',quantity:.01,updatedAt:'2026-09-28T19:09:00Z'},
        {venue:'Ledger',symbol:'ETH',quantity:.1,updatedAt:'2026-09-28T19:09:00Z'}
      ],
      pionexEquityUsd:35000,
      pionexEquitySource:'PIONEX_WALLET_READ_API'
    }
  };
  const snap=canonicalPortfolioSnapshot(data,now);
  assert.equal(snap.spotAuthority.complete,true);
  assert.equal(snap.spotAuthority.holdingsUsd,750);
  assert.equal(snap.spotAuthority.externalUsd,120);
  assert.equal(snap.spotUsd,870);
  assert.equal(snap.totalUsd,35870);
  assert.deepEqual(snap.spotAuthority.requiredHoldingVenues,['Ledger']);
  assert.deepEqual(snap.spotAuthority.missingRequiredHoldingVenues,[]);
});

test('r64 fails closed when a required Ledger holding venue is absent or not fully priced',()=>{
  const now=Date.parse('2026-09-28T19:10:00Z');
  const missing=canonicalPortfolioSnapshot({
    livePrices:{},livePriceMeta:{fresh:true},
    portfolio:{authorityMode:'STRICT_VENUE_SNAPSHOT',externalVenueSnapshotComplete:true,externalVenueExpectedVenues:['OKX'],requiredHoldingVenues:['Ledger'],manualVenueBalances:[{venue:'OKX',valueUsd:120,updatedAt:'2026-09-28T19:08:00Z'}],holdings:[],pionexEquityUsd:35000}
  },now);
  assert.equal(missing.spotAuthority.complete,false);
  assert.deepEqual(missing.spotAuthority.missingRequiredHoldingVenues,['Ledger']);

  const unpriced=canonicalPortfolioSnapshot({
    livePrices:{BTC:{price:50000}},livePriceMeta:{fresh:true},
    portfolio:{authorityMode:'STRICT_VENUE_SNAPSHOT',externalVenueSnapshotComplete:true,externalVenueExpectedVenues:['OKX'],requiredHoldingVenues:['Ledger'],manualVenueBalances:[{venue:'OKX',valueUsd:120,updatedAt:'2026-09-28T19:08:00Z'}],holdings:[{venue:'Ledger',symbol:'BTC',quantity:.01,updatedAt:'2026-09-28T19:09:00Z'},{venue:'Ledger',symbol:'XYZ',quantity:2,updatedAt:'2026-09-28T19:09:00Z'}],pionexEquityUsd:35000}
  },now);
  assert.equal(unpriced.priceCoverage.complete,false);
  assert.equal(unpriced.spotAuthority.complete,false);
});

test('r64 client derives Ledger authority from local confirmation or existing local Ledger reference',()=>{
  assert.match(v9,/LEDGER_AUTH_KEY='meridian\.v10\.ledgerAuthority'/);
  assert.match(v9,/function latestLedgerAuthority\(\)/);
  assert.match(v9,/legacy=loadExternalVenueRefs\(\)\.find/);
  assert.match(v9,/function ledgerAutoState\(d\)/);
  assert.match(v9,/authoritySource:'LOCAL_LEDGER_CONFIRMATION'/);
  assert.match(v9,/strictHoldings=ledgerAuto\.active\?ledgerAuto\.rows:\[\]/);
  assert.match(v9,/expectedExternal=ledgerAuto\.active\?\['OKX'\]:EXTERNAL_VENUE_EXPECTED/);
  assert.match(v9,/requiredHoldingVenues=ledgerAuto\.active\?\['Ledger'\]:\[\]/);
});

test('r64 separates Ledger confirmation from OKX value refresh and does not store account totals in source',()=>{
  assert.match(v9,/LEDGER ASSETS BESTÄTIGEN/);
  assert.match(v9,/OKX WERT AKTUALISIEREN/);
  assert.match(v9,/Ledger wird danach aus Mengen × Live-Preis berechnet/);
  assert.match(v9,/LEDGER AUTO/);
  assert.match(v9,/OKX DCA OLD REF/);
  assert.match(v10,/API TREND/);
});

test('r64 remains portfolio data and presentation only',()=>{
  assert.equal(release.terminalBuild,'10.0-r64');
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

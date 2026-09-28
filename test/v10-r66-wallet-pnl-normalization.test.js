import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeWalletOverview,buildWalletBotRisk} from '../pionex-account-read-sync.js';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function inverseProbe({token='BTC',profit='0.001'}={}){
  return {
    candidateCount:1,
    buOrderTypeCounts:{futures_grid:1},
    successBuOrderTypeCounts:{futures_grid:1},
    details:[{
      wallet:{buOrderId:'inverse-1',buOrderType:'futures_grid',cateType:'inverse',baseList:['USD'],investmentToken:token,investmentAmount:'0.1',profit},
      detail:{base:'USD',quote:'BTC',status:'running',buOrderData:{status:'running',trend:'short',leverage:'5',bottom:'50000',top:'100000',liquidationPrice:'120000',positionOpenPrice:'80000',usdtInvestment:'1000'}}
    }]
  };
}

test('r66 wallet overview keeps Pionex wallet USD prices for private normalization',()=>{
  const w=normalizeWalletOverview({
    prices:{BTC:{priceInUsd:'80000',priceInBtc:'1'},ETH:{priceInUsd:'2500'}},
    totalInUsdt:'123',botAccount:{detail:[]},traderAccount:{detail:[]}
  });
  assert.equal(w.prices.BTC.priceInUsd,80000);
  assert.equal(w.prices.ETH.priceInUsd,2500);
});

test('r66 converts inverse bot wallet profit from settlement coin into USD',()=>{
  const risk=buildWalletBotRisk(inverseProbe(),'2026-09-28T20:00:00.000Z',{BTC:{priceInUsd:80000}});
  assert.equal(risk.detailsComplete,true);
  assert.equal(risk.pnlUsdRows,1);
  assert.equal(risk.walletProfitRows,1);
  assert.deepEqual(risk.pnlSourceCounts,{WALLET_PROFIT_X_PIONEX_WALLET_PRICE:1});
  assert.equal(risk.bots[0].pnlUsd,80);
  assert.equal(risk.bots[0].totalProfitPct,8);
  assert.equal(risk.bots[0].walletProfitNative,0.001);
  assert.equal(risk.bots[0].walletProfitToken,'BTC');
  assert.equal(risk.bots[0].pnlSource,'WALLET_PROFIT_X_PIONEX_WALLET_PRICE');
});

test('r66 fails closed on wallet profit when token does not match inverse bot asset',()=>{
  const risk=buildWalletBotRisk(inverseProbe({token:'ETH'}),'2026-09-28T20:00:00.000Z',{BTC:{priceInUsd:80000},ETH:{priceInUsd:2500}});
  assert.equal(risk.detailsComplete,true);
  assert.equal(risk.pnlUsdRows,0);
  assert.equal(risk.walletProfitRows,1);
  assert.equal(risk.bots[0].pnlUsd,null);
  assert.equal(risk.bots[0].pnlSource,'NONE');
});

test('r66 gateway exposes aggregate PnL normalization diagnostics only',()=>{
  const start=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/gateway-health")');
  const end=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/api/private/write-check")');
  const block=gateway.slice(start,end);
  for(const token of ['pionexWalletRiskPnlUsdRows','pionexWalletRiskWalletProfitRows','pionexWalletRiskPnlSourceCounts'])assert.ok(block.includes(token),token);
  assert.doesNotMatch(block,/walletProfitNative|walletProfitToken|pnlUsd:/);
});

test('r66 UI distinguishes PnL blockers from market blockers',()=>{
  assert.match(v10,/pnlMissing=Math\.max\(0,matched-pnlReady\)/);
  assert.match(v10,/marketMissing=Math\.max\(0,matched-marketReady\)/);
  assert.match(v10,/PNL USD READY/);
  assert.match(v10,/PNL SOURCES/);
  assert.match(v10,/PNL miss /);
  assert.match(v10,/MKT miss /);
});

test('r66 remains read-only and execution-neutral',()=>{
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

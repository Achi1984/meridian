import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../v8-clean/app.js',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../v8-clean/data.js',import.meta.url),'utf8');
const more=fs.readFileSync(new URL('../v8-clean/more.js',import.meta.url),'utf8');
const moreRuntime=fs.readFileSync(new URL('../v8-clean/more-runtime.js',import.meta.url),'utf8');
const arch=fs.readFileSync(new URL('../v8-clean/ARCHITECTURE.md',import.meta.url),'utf8');

test('clean v8 has exactly five real view roots and one five-item nav',()=>{
  for(const key of ['center','depot','trade','paper','more']){
    assert.match(html,new RegExp(`id="view-${key}"`));
    assert.match(html,new RegExp(`data-route="${key}"`));
  }
  assert.equal((html.match(/class="view(?: is-active)?"/g)||[]).length,5);
  assert.equal((html.match(/data-route=/g)||[]).length,5);
});

test('clean v8 does not load legacy compatibility renderer stack',()=>{
  for(const legacy of ['app-v6.06.js','app-v7.32-legacy.js','app-v7.33-hardening.js','app-v8.0-navigation.js']){
    assert.doesNotMatch(html,new RegExp(legacy.replaceAll('.','\\.')));
    assert.doesNotMatch(app,new RegExp(legacy.replaceAll('.','\\.')));
  }
  assert.doesNotMatch(app,/legacy\.click|renderOne|primaryBottomNav|querySelector\([^\n]*data-view/);
});

test('clean CENTER consumes protected dashboard through a dedicated adapter',()=>{
  assert.match(data,/\/api\/private\/dashboard/);
  assert.match(data,/authorization:`Bearer \$\{t\}`/);
  assert.match(data,/meridian\.v8\.readToken/);
  assert.match(data,/source:'PRIVATE_DASHBOARD'/);
});

test('clean DEPOT uses canonical spot plus Pionex equity and private history only',()=>{
  assert.match(data,/function spotHoldings/);
  assert.match(data,/toLowerCase\(\)!=='pionex'/);
  assert.match(data,/function tradingValue/);
  assert.match(data,/portfolio\?\.pionexEquityUsd/);
  assert.match(data,/\/api\/private\/portfolio-history\?range=1d/);
  assert.match(data,/coverageMs>=16\.8\*60\*60\*1000/);
  assert.match(data,/CASHFLOW_ADJUSTED/);
  assert.match(app,/function depotHtml/);
  assert.match(app,/TOP POSITIONEN/);
  assert.match(app,/TRADING \/ BOTS/);
  assert.match(app,/KANONISCHE HISTORIE WIRD AUFGEBAUT/);
  assert.doesNotMatch(app,/snapshotTotalIncludingPionexUsd|querySelector\([^\n]*(portfolio|depot)/i);
});

test('clean TRADE uses one private bot-risk adapter and fixed buffer ladder',()=>{
  assert.match(data,/function normalizeBot/);
  assert.match(data,/data\?\.pionexRisk\?\.bots/);
  assert.match(data,/pionexLiqBufferPct/);
  assert.match(data,/b\.buffer<8/);
  assert.match(data,/b\.buffer<12/);
  assert.match(data,/targetPct:8/);
  assert.match(data,/targetPct:12/);
  assert.match(data,/export async function loadTrade/);
  assert.match(app,/function tradeHtml/);
  assert.match(app,/TRADE · RISK FIRST/);
  assert.match(app,/KRITISCHSTER BOT/);
  assert.match(app,/NEXT ACTION/);
  assert.match(app,/AKTIVE BOTS · NACH BUFFER SORTIERT/);
  assert.doesNotMatch(app,/Grid Commander|Liquidation First|querySelector\([^\n]*(trade|bot|risk)/i);
});

test('clean PAPER reads protected research telemetry and never promotes a model',()=>{
  assert.match(data,/\/api\/research-analytics/);
  assert.match(data,/\/api\/activity-summary/);
  assert.match(data,/function paperModel/);
  assert.match(data,/researchOnly:analytics\?\.researchOnly!==false/);
  assert.match(data,/executionImpact:analytics\?\.executionImpact===true/);
  assert.match(data,/challengerBaselineReadyDependency/);
  assert.match(data,/regimeAdaptedSideUsesBaselineDirectionalScores/);
  assert.match(app,/function paperHtml/);
  assert.match(app,/PAPER · RESEARCH BOARD/);
  assert.match(app,/RESEARCH ONLY/);
  assert.match(app,/Keine automatische Promotion/);
  assert.match(app,/BASELINE · SHADOW · CHALLENGER · REGIME/);
  assert.match(app,/OPPORTUNITY COST · CHALLENGER/);
  assert.doesNotMatch(app,/PROMOTE|AUTO[- ]?PROMOTION|best model|winner model/i);
});

test('clean MORE is a real owned view with explicit read-only modules',()=>{
  assert.match(html,/id="view-more"/);
  assert.match(html,/more-runtime\.js\?v=8\.0-clean-r5/);
  assert.match(more,/export async function loadMore/);
  assert.match(more,/\/gateway-health/);
  assert.match(more,/\/api\/private\/dashboard/);
  assert.match(more,/\/api\/research-analytics/);
  for(const module of ['MARKET','FORECAST','SCANNER','RESEARCH','DIAGNOSTICS','SETTINGS'])assert.match(more,new RegExp(module));
  assert.match(more,/kein Legacy-Overlay/);
  assert.match(moreRuntime,/location\.hash==='#more'/);
  assert.match(moreRuntime,/document\.getElementById\('view-more'\)/);
  assert.doesNotMatch(more+moreRuntime,/primaryBottomNav|legacy\.click|data-view="market"|id="v8-more-overlay"|class="[^"]*overlay/i);
});

test('clean v8 remains presentation/read-only',()=>{
  const all=html+app+data+more+moreRuntime+arch;
  assert.doesNotMatch(all,/placeOrder|createOrder|submitOrder|dashboard-update|holdings-sync|x-meridian-write-token|liveTrading\s*=\s*true/i);
  assert.match(arch,/Baseline `6\.2\.0 \/ 6\.2-SIGNAL-V1` remains frozen/);
  assert.match(arch,/server\.js` remains untouched/);
});

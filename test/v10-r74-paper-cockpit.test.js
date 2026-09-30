import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');

function block(start,end){
  const a=v10.indexOf(start),b=v10.indexOf(end,a);
  assert.ok(a>=0&&b>a,'block missing: '+start);
  return v10.slice(a,b);
}

test('r74 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r74');
  assert.equal(release.terminalExecutionImpact,false);
  assert.equal(release.dashboardShell,'10.0-r74-COMMAND-DEPOT-BOT-CONTROL-FORECAST-SCANNER-ASSET-DETAIL-PAPER-COCKPIT');
  assert.match(root,/10\.0-r74-production/);
  assert.match(html,/10\.0-r74/);
  assert.match(v10,/const BUILD='10\.0-r74'/);
  assert.equal(manifest.start_url,'./v10/?build=r74&fresh=r74');
});

test('r74 uses the existing protected GET-only Paper Overview bridge',()=>{
  assert.match(v9,/paperOverview:\(\)=>getJson\('\/api\/paper\/overview'\)/);
  const bridge=v9.slice(v9.indexOf('window.MERIDIAN_V10_BRIDGE='),v9.indexOf('document.querySelectorAll',v9.indexOf('window.MERIDIAN_V10_BRIDGE=')));
  assert.doesNotMatch(bridge,/paperOverview:[^\n]*postJson/);
});

test('r74 has one canonical protected Paper Overview SSOT and no duplicate analytics poller',()=>{
  assert.match(server,/u\.pathname==="\/api\/paper\/overview"[\s\S]*paperOverviewStatus\(\)/);
  assert.match(server,/schemaVersion:'8\.0-PAPER-OVERVIEW-V1'/);
  assert.match(server,/researchOnly:true/);
  assert.match(server,/executionImpact:false/);
  assert.match(gateway,/PROTECTED_PREFIXES[\s\S]*"\/api\/paper"/);
  assert.doesNotMatch(v9,/syncPaperTelemetry|\/api\/research-analytics|\/api\/activity-summary/);
});

test('r74 adds Paper Cockpit as secondary view without creating a sixth primary tab',()=>{
  assert.match(html,/id="view-paper"/);
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
  assert.doesNotMatch(html,/data-v="paper"/);
  assert.match(v10,/if\(active==='paper'\)return renderPaperCockpit\(force\)/);
  assert.match(v10,/data-open-paper/);
  assert.match(v10,/showSecondaryView\('paper','research'\)/);
});

test('r74 safety guard requires the frozen Paper Overview research-only contract',()=>{
  const trustSrc=block('function paperOverviewTrusted(d){','function paperTradePf(trades){');
  const trusted=new Function(trustSrc+';return paperOverviewTrusted')();
  const ok={schemaVersion:'8.0-PAPER-OVERVIEW-V1',researchOnly:true,executionImpact:false,status:{safety:{paperTrading:true,liveTrading:false}}};
  assert.equal(trusted(ok),true);
  assert.equal(trusted({...ok,executionImpact:true}),false);
  assert.equal(trusted({...ok,status:{safety:{paperTrading:true,liveTrading:true}}}),false);
  assert.equal(trusted({...ok,schemaVersion:'UNKNOWN'}),false);
});

test('r74 preserves missing Paper metrics as null instead of inventing zero',()=>{
  const src=block('function paperTradePf(trades){','function paperModelCard(m){');
  const stats=new Function(src+';return paperModelStats')();
  const missing=stats('MISSING',{},false);
  assert.equal(missing.equity,null);
  assert.equal(missing.pnl,null);
  assert.equal(missing.dd,null);
  assert.equal(missing.closed,null);
  assert.equal(missing.open,null);
  assert.equal(missing.pf,null);
  assert.equal(missing.wr,null);
  const explicit=stats('EMPTY',{account:{startEquity:10000,equity:10000,peakEquity:10000},trades:[],positions:[]},true);
  assert.equal(explicit.pnl,0);
  assert.equal(explicit.dd,0);
  assert.equal(explicit.closed,0);
  assert.equal(explicit.open,0);
});

test('r74 Paper cards show equity PnL drawdown trades PF and phase from independent ledgers',()=>{
  const card=block('function paperModelCard(m){','function paperR42Html(rows){');
  for(const token of ['EQUITY','MAX DD','CLOSED','OPEN','PF','WIN RATE'])assert.ok(card.includes(token),token);
  assert.match(v10,/BASELINE REFERENCE/);
  assert.match(v10,/PROSPECTIVE PAPER/);
  assert.match(v10,/STOPPED REVIEW/);
  assert.match(v10,/independent paper ledger/);
});

test('r74 keeps model order fixed and does not performance-rank Paper ledgers',()=>{
  const cockpit=block('function paperCockpitHtml(){','async function loadPaperCockpit');
  const names=['BASELINE 6.2','CHALLENGER V2','CHALLENGER V3','DIRECTIONAL V4','FUNDING CARRY V2'];
  let pos=-1;
  for(const name of names){const next=cockpit.indexOf(name);assert.ok(next>pos,name);pos=next}
  assert.doesNotMatch(cockpit,/models\.sort\(/);
  assert.match(cockpit,/feste Reihenfolge · keine Performance-Sortierung/);
  assert.match(cockpit,/bewertet keinen Gewinner/);
});

test('r74 separates R42 research cohorts from canonical Paper equity',()=>{
  assert.match(v10,/R42 RESEARCH COHORTS/);
  assert.match(v10,/separate Research-Runtime · keine Vermischung mit Paper-Equity/);
  assert.match(v10,/function paperR42Html\(rows\)/);
});

test('r74 refresh is read-only fail-closed and retains a labeled last-good snapshot on refresh error',()=>{
  const loader=block('async function loadPaperCockpit(force=false){','function renderPaperCockpit(force=false){');
  assert.match(loader,/b\.paperOverview\(\)/);
  assert.match(loader,/paperOverviewTrusted\(d\)/);
  assert.match(loader,/PAPER_OVERVIEW_CONTRACT_INVALID/);
  assert.doesNotMatch(loader,/postJson|submitOrder|placeOrder|createOrder|cancelOrder/);
  assert.match(v10,/REFRESH FEHLER/);
  assert.match(v10,/letzter gültiger Snapshot bleibt sichtbar/);
});

test('r74 cockpit is mobile-first and keeps Lab as a separate secondary surface',()=>{
  assert.match(css,/\.paper-cockpit-toolbar/);
  assert.match(css,/\.paper-model-stack/);
  assert.match(css,/\.paper-cohort-grid/);
  assert.match(css,/@media\(max-width:520px\)[\s\S]*\.paper-model-grid/);
  assert.match(v10,/data-paper-lab/);
  assert.match(v10,/showSecondaryView\('more','research'\)/);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

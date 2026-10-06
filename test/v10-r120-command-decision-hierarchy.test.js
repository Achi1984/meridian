import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const harness=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const checkpoint=JSON.parse(fs.readFileSync(new URL('../MERIDIAN_LIVE_CHECKPOINT.json',import.meta.url),'utf8'));
const resume=JSON.parse(fs.readFileSync(new URL('../MERIDIAN_RESUME.json',import.meta.url),'utf8'));
const handoff=fs.readFileSync(new URL('../docs/MERIDIAN_CHAT_HANDOFF.md',import.meta.url),'utf8');

function block(startNeedle,endNeedle){
  const a=js.indexOf(startNeedle),b=js.indexOf(endNeedle,a+1);
  assert.ok(a>=0&&b>a,'expected source block '+startNeedle);
  return js.slice(a,b);
}

test('r120+ release identity is coherent and preserves the UI principle',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.match(/r(\d+)$/)?.[1]||0)>=120);
  assert.equal(release.terminalExecutionImpact,false);
  assert.equal(checkpoint.terminalBuild,release.terminalBuild);
  assert.equal(resume.build,release.terminalBuild);
  assert.ok(handoff.includes('Build: **'+release.terminalBuild+'**'));
  assert.match(handoff,/Complex inside – simple outside/);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r120 uses one scoped PORTFOLIO RISK DATA health model',()=>{
  const health=block('function commandHealthSummary()','function commandAttentionHtml');
  const header=block('function renderSystemHeader()','function decorateA11y');
  assert.match(health,/PORTFOLIO/);
  assert.match(health,/AKTION NÖTIG/);
  assert.match(health,/FRISCH/);
  assert.match(health,/TEILWEISE/);
  assert.match(health,/STALE/);
  assert.match(health,/command-health-summary/);
  assert.match(header,/freshness=x=>x\.label==='READY'\?'FRESH':x\.label/);
});

test('r120 collapses complexity behind a total-first decision hierarchy',()=>{
  const hero=block('function portfolioChartHeroHtml()','function bindCommandPortfolioHero');
  const render=block('function renderCommand(','function assetWatchShareCard');
  assert.match(hero,/command-first-portfolio/);
  assert.match(hero,/portfolio-primary-delta/);
  assert.match(hero,/command-portfolio-details/);
  assert.match(hero,/7T Δ/);
  assert.match(render,/portfolioNode\.insertAdjacentElement\('afterend',overviewNode\)/);
  assert.match(render,/overviewNode\.insertAdjacentElement\('afterend',hubNode\)/);
  assert.match(render,/portfolioDetails=.*command-portfolio-details/);
  assert.match(render,/if\(portfolioDetails\)portfolioDetails\.remove\(\)/);
  assert.match(render,/sourceNode\.insertAdjacentElement\('afterend',portfolioDetails\)/);
  assert.doesNotMatch(render,/dataStateStripHtml\('command'\)/);
});

test('r120 scopes Paper failures to optional Command presentation and diagnostics',()=>{
  const hub=block('function commandPaperPresentation','function bindCommandActionHub');
  const paper=block('function paperReadiness()','function researchSessionReadiness');
  assert.match(hub,/OPTIONAL · NICHT VERFÜGBAR/);
  assert.match(hub,/command-paper-diagnostics/);
  assert.match(hub,/paper\.raw/);
  assert.match(paper,/label:paperCockpitUi\.error\?'ERROR':'NOT LOADED'/);
  assert.match(paper,/if\(!paperOverviewTrusted\(d\)\)return\{key:'PAPER',label:'BLOCKED',tone:'danger'/);
});

test('r120 has one full critical warning and scopes liquidation as a sub-status',()=>{
  const attention=block('function commandAttentionHtml','function commandPaperPresentation');
  const pair=block('function pairCard(','function criticalPair()');
  const render=block('function renderCommand(','function assetWatchShareCard');
  assert.match(attention,/Siehe NEXT ACTION · vollständige Begründung oben/);
  assert.match(pair,/decisionView=false/);
  assert.match(pair,/LIQ-ABSTAND/);
  assert.match(pair,/command-liq-substatus/);
  assert.match(pair,/decisionView\?'':'<div class="pair-reason">/);
  assert.match(render,/pairCard\(c\.symbol,true,false,false,true\)/);
  assert.match(css,/\.command-liq-substatus\{/);
  assert.match(css,/\.command-risk-card\.pair-tone-watch\{border-left-color:var\(--amber\)\}/);
});

test('r120 moves developer and source detail out of the primary flow without hiding it',()=>{
  const disclosure=block('function commandDataDisclosure','function commandSystemDiagnostics');
  const diagnostics=block('function commandSystemDiagnostics','function renderSystemHeader');
  const hero=block('function portfolioChartHeroHtml()','function bindCommandPortfolioHero');
  assert.match(disclosure,/command-diagnostics/);
  assert.match(disclosure,/dataStateStripHtml\('command'\)/);
  assert.match(diagnostics,/DIAGNOSTICS/);
  assert.match(diagnostics,/command-diagnostics/);
  assert.match(hero,/portfolioHistoryIntegrityHtml\(\)\+chart/);
  assert.match(css,/\.command-diagnostics>summary/);
});

test('r120 visual QA enforces first-viewport hierarchy and nav clearance',()=>{
  assert.match(js,/commandFirstViewportInvariant/);
  assert.match(js,/commandDiagnosticsCollapsed/);
  assert.match(js,/navEndClearance/);
  assert.match(harness,/mobile-375-command-bottom/);
  assert.match(harness,/mobile-320-command-bottom/);
  assert.match(css,/padding-bottom:calc\(104px \+ env\(safe-area-inset-bottom\)\)/);
});

test('r120 presentation layer does not introduce execution or authority mutation paths',()=>{
  const src=[
    block('function commandHealthSummary()','function commandAttentionHtml'),
    block('function commandAttentionHtml','function commandPaperPresentation'),
    block('function commandPaperPresentation','function bindCommandActionHub'),
    block('function commandDataDisclosure','function renderSystemHeader'),
    block('function portfolioChartHeroHtml()','function bindCommandPortfolioHero'),
    block('function renderCommand(','function assetWatchShareCard')
  ].join('\n');
  assert.doesNotMatch(src,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|postJson|executeTrade)/i);
  assert.doesNotMatch(src,/portfolio\.complete\s*=|paperCockpitUi\.data\s*=/);
});

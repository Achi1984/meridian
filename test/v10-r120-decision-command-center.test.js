import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const qa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const checkpoint=JSON.parse(fs.readFileSync(new URL('../MERIDIAN_LIVE_CHECKPOINT.json',import.meta.url),'utf8'));
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const resume=JSON.parse(fs.readFileSync(new URL('../MERIDIAN_RESUME.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

function block(name){
  const start=js.indexOf('function '+name);
  assert.ok(start>=0,'missing '+name);
  const end=js.indexOf('\nfunction ',start+10);
  return js.slice(start,end>start?end:js.length);
}

test('r120 release identity is coherent and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r120');
  assert.equal(checkpoint.terminalBuild,release.terminalBuild);
  assert.equal(resume.build,release.terminalBuild);
  assert.equal(manifest.start_url,'./v10/?build=r120&fresh=r120');
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(js.includes("const BUILD='10.0-r120'"));
});

test('r120 defines one Command health hierarchy and freshness-scoped header labels',()=>{
  const health=block('commandHealthSummary'),overview=block('commandOverviewHtml'),header=block('renderSystemHeader');
  assert.match(health,/ERROR:4/);
  assert.match(health,/ATTENTION:3/);
  assert.match(health,/PARTIAL:2/);
  assert.match(health,/OPTIONAL:0/);
  assert.match(overview,/SYSTEM HEALTH/);
  assert.match(header,/mr\.label==='READY'\?'FRESH'/);
  assert.match(header,/br\.label==='READY'\?'FRESH'/);
});

test('r120 Paper is optional on Command and raw errors stay in diagnostics',()=>{
  const mapper=block('commandPaperPresentation'),hub=block('commandActionHubHtml');
  assert.match(mapper,/OPTIONAL · UNAVAILABLE/);
  assert.match(mapper,/ERROR · PAPER/);
  assert.match(hub,/command-paper-diagnostics/);
  assert.match(hub,/WHY · RISK · INVALIDATION/);
});

test('r120 renders a single full critical explanation',()=>{
  const attention=block('commandAttentionHtml'),risk=block('commandRiskPriorityHtml'),render=block('renderCommand');
  assert.match(attention,/Siehe NEXT ACTION/);
  assert.doesNotMatch(attention,/detail:crit\.status\.reason/);
  assert.match(render,/commandRiskPriorityHtml\(c\)/);
  assert.doesNotMatch(render,/pairCard\(c\.symbol,true\)/);
  assert.match(risk,/LIQ = Teilstatus · Gesamt-Risiko bleibt/);
  assert.doesNotMatch(risk,/st\.reason/);
});

test('r120 moves secondary portfolio and data state behind closed details',()=>{
  const hero=block('portfolioChartHeroHtml'),render=block('renderCommand');
  assert.match(hero,/command-portfolio-details/);
  assert.match(hero,/7T Δ/);
  assert.match(render,/command-data-state-details/);
  assert.doesNotMatch(render,/command-next-priority/);
});

test('r120 first-fold and bottom-nav clearance are Visual-QA invariants',()=>{
  const reporter=block('writeLocalVisualQaReport');
  assert.match(reporter,/commandDiagnosticsClosed/);
  assert.match(reporter,/commandHierarchyInvariant/);
  assert.match(reporter,/nav\.top-8/);
  assert.match(qa,/mobile-375-command-bottom/);
  assert.match(qa,/mobile-320-command-bottom/);
  assert.match(css,/padding-bottom:calc\(96px \+ env\(safe-area-inset-bottom\)\)/);
});

test('r120 remains presentation-only and preserves hard research boundaries',()=>{
  for(const name of ['commandHealthSummary','commandOverviewHtml','commandAttentionHtml','commandPaperPresentation','commandActionHubHtml','commandRiskPriorityHtml','renderCommand']){
    assert.doesNotMatch(block(name),/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|postJson|strategyPnl)/i);
  }
  assert.equal(checkpoint.activeResearch.stage,'SOURCE_AUDIT');
  assert.equal(checkpoint.activeResearch.canonicalExecutionAuthorized,false);
  assert.equal(checkpoint.activeResearch.strategyPnlAuthorized,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r92 Command decision-flow contract remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=92,'expected r92 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/COMMAND-DECISION-FLOW/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r92 renders Next/Open before Attention as separate decision surfaces',()=>{
  assert.match(js,/function commandAttentionHtml\(\)/);
  assert.match(js,/attentionWrap\.innerHTML=commandAttentionHtml\(\)/);
  assert.match(js,/hubNode\.insertAdjacentElement\('afterend',attentionNode\)/);
});

test('r92 collapses fresh account positions in Command while keeping Bots full detail',()=>{
  assert.match(js,/command-position-details/);
  assert.match(css,/\.command-position-details>summary/);
  assert.ok(js.includes("accountPositionLayer(false)+walletDiscoveryLayer()+assetWatchShareCard()"));
});

test('r92 Account Futures disclosure is closed by default and touch friendly',()=>{
  const start=js.indexOf('function accountPositionLayer(compact=false)');
  const end=js.indexOf('function walletDiscoveryHealth()',start);
  const block=js.slice(start,end);
  assert.doesNotMatch(block,/<details class="v10-account-position-layer command-position-details" open/);
  assert.match(css,/\.command-position-details>summary\{[^}]*min-height:44px/);
});

test('r92 decision-flow adapter remains presentation-only',()=>{
  const start=js.indexOf('function commandOverviewHtml(){');
  const end=js.indexOf('function pionexDetailAssets(){');
  const block=js.slice(start,end);
  assert.doesNotMatch(block,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|method:\s*['"]POST|\/trade\/order/);
});


test('r92 interaction QA gives asynchronous flows the full iframe settle window',()=>{
  const qa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
  assert.match(qa,/virtualBudget=name\.startsWith\('flow-'\)\?8000:2600/);
  assert.match(qa,/--virtual-time-budget='\+virtualBudget/);
});

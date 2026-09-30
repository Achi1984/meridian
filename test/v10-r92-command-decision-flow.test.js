import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r92 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r92');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/COMMAND-DECISION-FLOW/);
  assert.equal(manifest.start_url,'./v10/?build=r92&fresh=r92');
  assert.ok(js.includes("const BUILD='10.0-r92'"));
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

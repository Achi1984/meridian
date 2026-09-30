import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r91 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r91');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/COMMAND-ABOVE-FOLD-PRIORITY/);
  assert.equal(manifest.start_url,'./v10/?build=r91&fresh=r91');
  assert.ok(js.includes("const BUILD='10.0-r91'"));
});

test('r91 separates KPIs, Next/Open and Attention into distinct priority surfaces',()=>{
  assert.match(js,/function commandOverviewHtml\(\)/);
  assert.match(js,/function commandAttentionHtml\(\)/);
  assert.match(js,/attentionWrap\.innerHTML=commandAttentionHtml\(\)/);
  assert.match(js,/hubNode\.insertAdjacentElement\('afterend',attentionNode\)/);
});

test('r91 collapses source diagnostics on Command without removing the canonical source strip',()=>{
  assert.match(js,/function commandDataDetails\(\)/);
  assert.match(js,/source\.innerHTML=commandDataDetails\(\)/);
  assert.match(js,/class="command-source-details"/);
  assert.match(js,/class="command-source-strip"/);
  assert.match(css,/\.command-source-details>summary/);
});

test('r91 makes fresh account positions on-demand on Command while Bots keeps full cards',()=>{
  assert.match(js,/command-position-details/);
  assert.ok(js.includes("accountPositionLayer(false)+walletDiscoveryLayer()+assetWatchShareCard()"));
  assert.match(css,/\.command-position-details>summary/);
});

test('r91 disclosure controls keep mobile touch targets and remain presentation-only',()=>{
  assert.match(css,/\.command-source-details>summary,[^\{]*\.command-position-details>summary\{[^}]*min-height:44px/);
  const block=js.slice(js.indexOf('function commandOverviewHtml(){'),js.indexOf('function pionexDetailAssets(){'));
  assert.doesNotMatch(block,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|method:\s*['"]POST|\/trade\/order/);
});

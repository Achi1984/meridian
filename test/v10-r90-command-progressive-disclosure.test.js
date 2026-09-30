import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r90 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r90');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/COMMAND-PROGRESSIVE-DISCLOSURE/);
  assert.equal(manifest.start_url,'./v10/?build=r90&fresh=r90');
  assert.ok(js.includes("const BUILD='10.0-r90'"));
});

test('r90 Next Action owns the critical-asset drilldown without a duplicate critical card',()=>{
  assert.match(js,/command-next-decision command-next-action-open/);
  assert.match(js,/data-command-asset=/);
  assert.doesNotMatch(js,/class="command-hub-card command-hub-critical/);
});

test('r90 Command uses compact Data Guard and wallet discovery',()=>{
  assert.match(js,/function dataGuardCard\(compact=false\)/);
  assert.match(js,/function walletDiscoveryLayer\(\)/);
  assert.match(js,/function walletDiscoveryLayerCompact\(\)/);
  assert.match(js,/function walletDiscoveryLayerMode\(compact=false\)/);
  assert.match(js,/guard\.innerHTML=dataGuardCard\(true\)/);
  assert.match(js,/wallet\.innerHTML=walletDiscoveryLayerCompact\(\)/);
  assert.match(js,/v10-command-tech-details/);
});

test('r90 Bots keeps the full technical diagnostics path',()=>{
  assert.ok(js.includes("accountPositionLayer(false)+walletDiscoveryLayer()+assetWatchShareCard()"));
});

test('r90 disclosure and remediation controls retain mobile touch targets',()=>{
  assert.match(css,/\.v10-command-tech-details>summary\{[^}]*min-height:44px/);
  assert.match(css,/button\.command-next-decision\{[^}]*touch-action:manipulation/);
  assert.match(css,/portfolio-reconcile-actions button\{[^}]*min-height:44px/);
});

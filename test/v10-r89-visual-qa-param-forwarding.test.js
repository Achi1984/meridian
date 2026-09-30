import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const frame=fs.readFileSync(new URL('../v10/visual-qa-frame.html',import.meta.url),'utf8');
const qa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r89 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r89');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/VISUAL-QA-PARAM-FORWARDING/);
  assert.equal(manifest.start_url,'./v10/?build=r89&fresh=r89');
});

test('r89 forwards qaFlow and qaData from the outer QA frame to the dashboard',()=>{
  assert.match(frame,/const inner=new URL\('\.\/',location\.href\)/);
  assert.match(frame,/for\(const key of \['qaFlow','qaData'\]\)/);
  assert.match(frame,/if\(value\)inner\.searchParams\.set\(key,value\)/);
  assert.match(frame,/frame\.src=inner\.pathname\+inner\.search/);
});

test('r89 runner emits the same forwarded parameter names',()=>{
  assert.match(qa,/if\(flow\)url\.searchParams\.set\('qaFlow',flow\)/);
  assert.match(qa,/if\(dataMode\)url\.searchParams\.set\('qaData',dataMode\)/);
  assert.ok(qa.includes("['flow-bot-filter-return','bots',0,'bot-filter-return']"));
  assert.ok(qa.includes("['flow-stale-recovery','command',0,'stale-recovery','stale']"));
});

test('r89 permanent regression gate protects parameter forwarding',()=>{
  assert.match(gate,/r89 permanent visual-QA parameter forwarding gates/);
  assert.match(gate,/visual QA frame must forward flow and data-mode parameters/);
});

test('r89 real Asset Detail flow is idempotent and exposes the contextual back selector',()=>{
  const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
  assert.match(js,/if\(!force&&\$\('\.asset-detail-topbar',view\)\)return/);
  assert.match(js,/data-asset-back data-context-back="asset-detail"/);
});

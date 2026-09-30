import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const qa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r88 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r88');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/DATA-RESILIENCE-QA/);
  assert.equal(manifest.start_url,'./v10/?build=r88&fresh=r88');
  assert.match(js,/const BUILD='10\.0-r88'/);
});

test('r88 exposes stale and error fixtures only through localhost visual QA',()=>{
  assert.match(js,/dataModes=\['fresh','stale','error'\]/);
  assert.match(js,/dataMode=dataModes\.includes\(q\.get\('qaData'\)\)\?q\.get\('qaData'\):'fresh'/);
  assert.match(js,/function setLocalVisualQaDataMode\(mode,s=S\(\),now=Date\.now\(\)\)/);
  assert.match(js,/if\(mode==='stale'\)/);
  assert.match(js,/if\(mode==='error'\)/);
});

test('r88 stale/error states are evidence-gated in the rendered DATA STATE strip',()=>{
  assert.match(js,/dataStateInvariant=cfg\.dataMode==='stale'\?dataStates\.BOTS==='REF'&&dataStates\.MARKET==='STALE'/);
  assert.match(js,/:cfg\.dataMode==='error'\?dataStates\.BOTS==='ERROR'&&dataStates\.MARKET==='STALE':true/);
  assert.match(js,/layout\.dataStateInvariant/);
  assert.ok(qa.includes("['data-command-stale','command',0,null,'stale']"));
  assert.ok(qa.includes("['data-bots-error','bots',0,null,'error']"));
});

test('r88 recovery flow proves stale state fails closed and recovers without reload',()=>{
  assert.match(js,/cfg\.flow==='stale-recovery'/);
  assert.match(js,/checks\.startsStale=before\.BOTS==='REF'&&before\.MARKET==='STALE'/);
  assert.match(js,/checks\.failClosedBefore=!!\$\('#view-command \.blocked-critical'\)/);
  assert.match(js,/setLocalVisualQaDataMode\('fresh',S\(\),Date\.now\(\)\)/);
  assert.match(js,/checks\.botRecovered=after\.BOTS==='READY'/);
  assert.match(js,/checks\.marketRecovered=after\.MARKET==='READY'/);
  assert.ok(qa.includes("['flow-stale-recovery','command',0,'stale-recovery','stale']"));
});

test('r88 remains QA/presentation only',()=>{
  const forbidden=/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/;
  assert.doesNotMatch(js,forbidden);
  assert.match(gate,/r88 permanent data-resilience QA gates/);
  assert.doesNotThrow(()=>new Function(js.replace(/^import .*$/gm,'')));
});

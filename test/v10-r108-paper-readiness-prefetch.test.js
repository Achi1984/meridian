import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r108 release identity is coherent and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r108');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/PAPER-READINESS-PREFETCH/);
  assert.equal(manifest.start_url,'./v10/?build=r108&fresh=r108');
  assert.ok(v10.includes("const BUILD='10.0-r108'"));
});

test('r108 prefetch is one-shot and uses the existing GET-only Paper Overview bridge',()=>{
  assert.match(v10,/paperCockpitUi=\{loading:false,data:null,error:null,loadedAt:0,prefetchStarted:false\}/);
  assert.match(v10,/function primePaperCockpit\(\)/);
  assert.match(v10,/if\(paperCockpitUi\.prefetchStarted\)return/);
  assert.match(v10,/paperCockpitUi\.prefetchStarted=true/);
  assert.match(v10,/queueMicrotask\(\(\)=>loadPaperCockpit\(false\)\)/);
  assert.match(v9,/paperOverview:\(\)=>getJson\('\/api\/paper\/overview'\)/);
  assert.doesNotMatch(v9,/paperOverview:[^\n]*postJson/);
});

test('r108 keeps the frozen Paper Overview trust guard before accepting prefetch data',()=>{
  assert.match(v10,/if\(!paperOverviewTrusted\(d\)\)throw new Error\('PAPER_OVERVIEW_CONTRACT_INVALID'\)/);
  assert.match(v10,/schemaVersion==='8\.0-PAPER-OVERVIEW-V1'/);
  assert.match(v10,/d\.researchOnly===true/);
  assert.match(v10,/d\.executionImpact===false/);
  assert.match(v10,/d\?\.status\?\.safety\?\.paperTrading===true/);
  assert.match(v10,/d\?\.status\?\.safety\?\.liveTrading===false/);
});

test('r108 refreshes COMMAND readiness on Paper load lifecycle without adding a poller',()=>{
  const start=v10.indexOf('async function loadPaperCockpit(force=false){');
  const end=v10.indexOf('function renderPaperCockpit(force=false){',start);
  assert.ok(start>=0&&end>start);
  const loader=v10.slice(start,end);
  assert.match(loader,/schedule\(true\)/);
  assert.match(loader,/paperCockpitUi\.loading=true/);
  assert.match(loader,/paperCockpitUi\.loading=false/);
  assert.doesNotMatch(v10,/setInterval\([^\n]*loadPaperCockpit/);
});

test('r108 production boot primes Paper Overview but visual QA remains network-isolated',()=>{
  const tail=v10.slice(v10.lastIndexOf('const visualQa=applyLocalVisualQaFixture()'));
  assert.match(tail,/if\(visualQa\)\{/);
  assert.match(tail,/\}else\{\n  decorate\(\);\n  primePaperCockpit\(\);\n\}/);
  const visualBlock=tail.slice(tail.indexOf('if(visualQa){'),tail.indexOf('}else{'));
  assert.doesNotMatch(visualBlock,/primePaperCockpit/);
});

test('r108 does not add promotion, ranking, order, or execution behavior',()=>{
  const prefetch=v10.slice(v10.indexOf('async function loadPaperCockpit(force=false){'),v10.indexOf('function renderLab(){'));
  assert.doesNotMatch(prefetch,/(?:submitOrder|placeOrder|createOrder|cancelOrder|postJson|promot|models\.sort\()/i);
});

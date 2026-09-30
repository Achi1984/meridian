import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const qa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const workflow=fs.readFileSync(new URL('../.github/workflows/v10-visual-qa.yml',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r83 visual-QA contract remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=83,'expected r83 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/VISUAL-QA-HARNESS/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
});

test('r83 visual fixture is localhost-only and disables live refresh only there',()=>{
  assert.match(v9,/const LOCAL_VISUAL_QA=\['127\.0\.0\.1','localhost'\]\.includes\(location\.hostname\).*visualQa/);
  assert.match(v9,/if\(LOCAL_VISUAL_QA\)[\s\S]*else\{[\s\S]*void refreshNow\(\)/);
  assert.match(v10,/function localVisualQaConfig\(\)/);
  assert.match(v10,/\['127\.0\.0\.1','localhost'\]\.includes\(location\.hostname\)/);
  assert.match(v10,/q\.get\('visualQa'\)!=='1'/);
});

test('r83 deterministic fixture covers five top-level views and FIB manual state',()=>{
  assert.match(v10,/allowed=\['command','depot','bots','market','research'\]/);
  assert.match(v10,/s\.botIdentityMode='API_NATIVE'/);
  assert.match(v10,/s\.marketTransport='VISUAL_QA'/);
  assert.match(v10,/fibUi\.mode='MANUAL'/);
  for(const x of ['command','depot','bots','market','research'])assert.ok(qa.includes("'"+x+"'"));
});

test('r83 layout report gates overflow, short buttons and fixed nav containment',()=>{
  assert.match(v10,/bodyOverflow:root\.scrollWidth>innerWidth\+2/);
  assert.match(v10,/keyOverflow:overflow,shortButtons/);
  assert.match(v10,/navInside:/);
  assert.match(v10,/report\.ok=viewportMatch&&(?:layout\.scannerActionsSameRow&&)?!report\.bodyOverflow/);
  assert.match(qa,/if\(failed\.length\)/);
});

test('r83 forces the app into a same-origin 390x844 CSS viewport',()=>{
  const frame=fs.readFileSync(new URL('../v10/visual-qa-frame.html',import.meta.url),'utf8');
  assert.match(frame,/width:390px;height:844px/);
  assert.match(frame,/frame\.width='390';frame\.height='844'/);
  assert.match(frame,/LOCAL VISUAL QA ONLY/);
  assert.match(v10,/viewportMatch=viewport\.w===390&&viewport\.h===844/);
  assert.match(qa,/visual-qa-frame\.html/);
});

test('r83 captures ten phone screenshots and uploads evidence',()=>{
  assert.match(qa,/width:390,height:844/);
  assert.equal((qa.match(/\['(?:command|depot|bots|forecast|scanner)-/g)||[]).length,10);
  assert.match(workflow,/name: MERIDIAN Visual QA/);
  assert.match(workflow,/google-chrome --version/);
  assert.match(workflow,/node scripts\/v10-visual-qa\.mjs/);
  assert.match(workflow,/actions\/upload-artifact@v4/);
  assert.match(workflow,/retention-days: 14/);
});

test('r83 remains presentation-only',()=>{
  const forbidden=/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/;
  assert.doesNotMatch(v10,forbidden);
  assert.match(gate,/r83 permanent visual-QA gates/);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

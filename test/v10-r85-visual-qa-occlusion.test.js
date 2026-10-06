import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const qa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r85 visual-occlusion contract remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=85,'expected r85 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/VISUAL-QA-OCCLUSION/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r85 gates bottom navigation occlusion at actual page bottom',()=>{
  assert.match(js,/const nearBottom=scrollY\+innerHeight>=root\.scrollHeight-4/);
  assert.match(js,/const navCandidates=nearBottom\?/);
  assert.match(js,/navOcclusions/);
  assert.match(js,/bottomClearance=!nearBottom\|\|!nav\|\|!mainRect\|\|mainRect\.bottom<=nav\.top\+1/);
  assert.match(js,/navEndClearance=!nearBottom/);
  assert.match(js,/layout\.bottomClearance&&layout\.navEndClearance&&!report\.bodyOverflow/);
});

test('r85 adds view-specific structural visual invariants',()=>{
  assert.match(js,/commandHubInvariant=cfg\.view!=='command'\|\|\(commandHubCards>=4&&!!active\.querySelector\('\.command-next-decision'\)\)/);
  assert.match(js,/botAccordionInvariant=cfg\.view!=='bots'\|\|\(botSummaries\.length>0&&botSummaries\.every\(r=>r\.height>=44\)\)/);
  assert.match(js,/forecastFibInvariant=cfg\.view!=='market'\|\|\(!!active\.querySelector\('\.fib-map-shell'\)&&!!active\.querySelector\('\.fib-output'\)\)/);
});

test('r85 visual evidence includes bottom states plus dedicated Forecast FIB state',()=>{
  for(const token of [
    "['command-bottom','command',6000]",
    "['depot-bottom','depot',6000]",
    "['bots-bottom','bots',6000]",
    "['forecast-fib','market',1050]",
    "['forecast-bottom','market',6000]",
    "['scanner-bottom','research',6000]"
  ])assert.ok(qa.includes(token),token);
  assert.equal((qa.match(/\['(?:command|depot|bots|forecast|scanner)-/g)||[]).length,11);
});

test('r85 occlusion audit ignores content hidden inside closed details',()=>{
  assert.match(js,/function visualQaVisible\(el\)/);
  assert.match(js,/node\.tagName==='DETAILS'&&!node\.open/);
  assert.match(js,/\.filter\(visualQaVisible\):\[\]/);
});

test('r85 visual report records actual scroll and document height for evidence review',()=>{
  assert.match(js,/actualScroll:Math\.round\(scrollY\)/);
  assert.match(js,/documentHeight:root\.scrollHeight/);
  assert.match(js,/botSummaryCount:botSummaries\.length/);
});

test('r85 remains QA/presentation only',()=>{
  const forbidden=/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/;
  assert.doesNotMatch(js,forbidden);
  assert.match(gate,/r85 permanent occlusion gates/);
  assert.doesNotThrow(()=>new Function(js.replace(/^import .*$/gm,'')));
});

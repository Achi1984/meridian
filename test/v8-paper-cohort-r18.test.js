import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v8-clean/paper-cohort-r18.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v8-clean/paper-cohort-r18.css',import.meta.url),'utf8');

test('R18 cohort board and R22 execution audit are wired into PAPER',()=>{
  assert.match(html,/paper-cohort-r18\.css\?v=8\.0-r22/);
  assert.match(html,/paper-cohort-r18\.js\?v=8\.0-r23/);
  assert.match(js,/\/api\/research-analytics/);
  assert.match(js,/COHORT DEEP DIVE/);
  assert.match(js,/FULL LEDGER EXECUTION AUDIT/);
  assert.match(js,/renderExecutionAudit\(a\?\.executionAudit\)/);
});

test('R18 exposes side regime asset cohort views and sample adequacy',()=>{
  assert.match(js,/block\('SIDE',deep\.bySide\)/);
  assert.match(js,/block\('REGIME',deep\.byRegime\)/);
  assert.match(js,/block\('ASSET',deep\.bySymbol\)/);
  assert.match(js,/N OK/);
  assert.match(js,/n&lt;8/);
});

test('R22 exposes aggregate stop, re-entry and bundle diagnostics per bot',()=>{
  assert.match(js,/audit\.total/);
  assert.match(js,/audit\.ledgers/);
  assert.match(js,/stop\.materialLosses/);
  assert.match(js,/stop\.averageActualLossR/);
  assert.match(js,/behavior\.postStopReentries/);
  assert.match(js,/behavior\.directionalMultiAssetBundles/);
  assert.match(js,/<details class="audit-r22-ledger">/);
  assert.match(js,/SHADOW · RETIRED/);
  assert.match(js,/REGIME · RETIRED/);
});

test('R22 is compact on mobile and remains protected aggregate read-only',()=>{
  const all=js+css;
  assert.match(css,/@media\(max-width:390px\)/);
  assert.match(js,/audit\?\.aggregateOnly/);
  assert.match(js,/nur geschützte Aggregate/);
  assert.doesNotMatch(all,/placeOrder|createOrder|submitOrder|dashboard-update|holdings-sync|x-meridian-write-token|method\s*:\s*['"]POST/i);
  assert.doesNotMatch(all,/server\.js/);
  assert.match(js,/Research only/);
  assert.match(js,/keine Strategie- oder Ausführungswirkung/);
});

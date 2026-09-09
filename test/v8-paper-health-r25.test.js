import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../v8-clean/app.js',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../v8-clean/data.js',import.meta.url),'utf8');
const audit=fs.readFileSync(new URL('../v8-clean/paper-cohort-r18.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v8-clean/paper-health-r25.css',import.meta.url),'utf8');

test('R25 loads a cache-coherent bot health presentation',()=>{
  assert.match(html,/paper-health-r25\.css\?v=8\.0-r25/);
  assert.match(html,/app\.js\?v=8\.0-r37/);
  assert.match(html,/paper-cohort-r18\.js\?v=8\.0-r37/);
  assert.match(app,/\.\/data\.js\?v=8\.0-r37/);
  assert.match(audit,/\.\/data\.js\?v=8\.0-r37/);
  assert.match(app,/botHealth:state\.paper\.botHealth/);
  assert.match(css,/#view-paper \.paper-hero-r23 \.paper-state\{font-size:25px/);
});

test('R25 derives health from existing protected read-only contracts',()=>{
  assert.match(data,/lastGoodMarketAt/);
  assert.match(data,/lastSignalScanAt/);
  assert.match(data,/challengerEvaluations\.filter/);
  assert.match(data,/reasonCounts\(challengerBlocked\)/);
  assert.doesNotMatch(data,/\/api\/events/);
});

test('R25 separates active audit findings from retired history and explains CHECK',()=>{
  assert.match(audit,/sumLedgers\(ledgers,\['baseline','challenger','challengerV3'\]\)/);
  assert.match(audit,/sumLedgers\(ledgers,\['shadow','regime'\]\)/);
  assert.match(audit,/HISTORISCHE RETIRED-AUFFÄLLIGKEITEN/);
  assert.match(audit,/Stop-Verluste >1,25R/);
  assert.match(audit,/rate\(active\.materialLosses,active\.evaluableStops\)/);
  assert.match(audit,/gateLabel/);
  assert.match(audit,/TECHNISCHE DIAGNOSE/);
});

test('R25 health remains optional, protected aggregate and execution-free',()=>{
  assert.match(data,/available:!!\(status\?\.engine\|\|challenger\?\.lastScanAt\)/);
  const all=app+data+audit+css;
  assert.doesNotMatch(all,/placeOrder|createOrder|submitOrder|dashboard-update|holdings-sync|x-meridian-write-token|method\s*:\s*['"]POST/i);
  assert.doesNotMatch(all,/server\.js/);
});

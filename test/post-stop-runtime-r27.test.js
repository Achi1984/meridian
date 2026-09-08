import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const analytics=fs.readFileSync(new URL('../research-analytics.js',import.meta.url),'utf8');
const learning=fs.readFileSync(new URL('../post-stop-learning.js',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../v8-clean/data.js',import.meta.url),'utf8');
const paper=fs.readFileSync(new URL('../v8-clean/paper-cohort-r18.js',import.meta.url),'utf8');

test('R27 creates one separate V3 ledger only after the qualified V2 stop',()=>{
  assert.match(server,/buildSuccessorPlan\(parent,config,challengerV2Params\(\)\)/);
  assert.match(server,/if\(!plan\.eligible\)return null/);
  assert.match(server,/const CHALLENGER_V3_KEY="challenger_v3"/);
  assert.match(server,/parent:"CHALLENGER_V2",createdAt:now,trigger:"MAX_DRAWDOWN",autoPromotion:false/);
  assert.match(server,/parameters:plan\.parameters/);
  assert.match(server,/if\(!challengerV3\)try\{await submitChallengerV2/);
  assert.match(server,/if\(!await getState\(CHALLENGER_V3_KEY,null\)\)try\{await challengerV2Cycle/);
  assert.doesNotMatch(server,/setState\("challenger_v2"\s*,\s*\{/);
  assert.doesNotMatch(server,/deleteState\(|TRUNCATE|DROP TABLE/);
});

test('R27 runs V3 prospectively with frozen risk and anti-repeat controls',()=>{
  assert.match(server,/await observeChallengerV3Scan\(candidates,challengerV3\)/);
  assert.match(server,/await submitChallengerV3\(\{\.\.\.c,source:"MERIDIAN-CHALLENGER-V3"\}\)/);
  assert.match(server,/await challengerV3Cycle\(m\)/);
  assert.match(server,/POST_STOP_COOLDOWN/);
  assert.match(server,/positions\.length>=p\.maxOpenPositions/);
  assert.match(server,/drawdownPct>=p\.maxDrawdownPct/);
  assert.match(server,/CHALLENGER_V3_POSITION_OPENED/);
  assert.match(server,/CHALLENGER_V3_POSITION_CLOSED/);
});

test('R27 exposes V3 through protected telemetry and the compact PAPER answer',()=>{
  assert.match(gateway,/"\/api\/challenger-v3"/);
  assert.match(gateway,/stateGet\("challenger_v3"\)/);
  assert.match(analytics,/const challengerV3=ledgerAnalytics/);
  assert.match(analytics,/challengerV3:auditLedger/);
  assert.match(data,/getJson\('\/api\/challenger-v3'\)/);
  assert.match(data,/challengerV3:\{enabled:/);
  assert.match(paper,/V3 GESTARTET · V2 BLEIBT VERSIEGELT/);
  assert.match(paper,/eingefrorenen Parametern/);
  assert.match(paper,/LETZTE TRADES/);
});

test('R27 remains PAPER-only and cannot auto-promote or touch Pionex',()=>{
  const source=server+analytics+learning+paper;
  assert.match(server,/if\(!config\.paperTrading\|\|config\.liveTrading\) throw new Error/);
  assert.match(server,/autoPromotion:false/);
  assert.doesNotMatch(source,/Pionex|placeOrder|createOrder|submitOrder|AUTO_PROMOTE|LIVE_PROMOTION/);
});

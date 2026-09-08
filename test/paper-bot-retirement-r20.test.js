import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../v8-clean/research-control-r19.js',import.meta.url),'utf8');

test('R20 retires Shadow and Regime with immutable lifecycle metadata',()=>{
  assert.match(server,/SHADOW_V1:Object\.freeze\(\{status:"RETIRED",active:false,ledgerFrozen:true/);
  assert.match(server,/REGIME_V1:Object\.freeze\(\{status:"RETIRED",active:false,ledgerFrozen:true/);
  assert.match(server,/DOMINATED_BY_CHALLENGER_V2/);
  assert.match(server,/NEGATIVE_EDGE_AND_SIDE_CONFLICT/);
});

test('retired bots cannot observe submit or cycle while their ledgers remain readable',()=>{
  for(const marker of [
    /if\(BOT_LIFECYCLE\.SHADOW_V1\.active\)try\{await observeShadowV1Scan/,
    /if\(BOT_LIFECYCLE\.SHADOW_V1\.active\)try\{await submitShadowV1/,
    /if\(BOT_LIFECYCLE\.SHADOW_V1\.active\)try\{await shadowV1Cycle/,
    /if\(BOT_LIFECYCLE\.REGIME_V1\.active\)try\{await observeRegimeV1Scan/,
    /if\(BOT_LIFECYCLE\.REGIME_V1\.active\)for\(const c of candidates\)/,
    /if\(BOT_LIFECYCLE\.REGIME_V1\.active\)try\{await regimeV1Cycle/
  ]) assert.match(server,marker);
  assert.match(server,/shadowV1Status\(\)/);
  assert.match(server,/regimeV1Status\(\)/);
  assert.match(server,/botLifecycle:BOT_LIFECYCLE/);
  assert.doesNotMatch(server,/deleteState\(|TRUNCATE|DROP TABLE/);
});

test('Baseline and Challenger execution paths stay present and retirement is visible',()=>{
  assert.match(server,/const r=await submitSignal\(\{\.\.\.c,source:"MERIDIAN-6\.2-AUTO"\}\)/);
  assert.match(server,/await submitChallengerV2\(\{\.\.\.c,source:"MERIDIAN-CHALLENGER-V2"\}\)/);
  assert.match(server,/await challengerV2Cycle\(m\)/);
  assert.match(ui,/SHADOW \/ REGIME/);
  assert.match(ui,/status:'RETIRED'/);
  assert.match(ui,/Challenger V2 bleibt/);
});

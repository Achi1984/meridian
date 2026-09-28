import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r31 decision completeness requires every matched row to be decision-ready',()=>{
  const block=v10.slice(v10.indexOf('function syncHealth(){'),v10.indexOf('function marketReadiness'));
  assert.match(block,/decisionComplete=matched>0&&coverageComplete&&decisionReady===matched/);
  assert.match(block,/return\{[^}]*decisionComplete/s);
});

test('r31 bot readiness and Data Guard use the same decision-complete state',()=>{
  const readiness=v10.slice(v10.indexOf('function botReadiness'),v10.indexOf('function dataGuardCard'));
  assert.match(readiness,/if\(g\.decisionComplete\)return\{label:'READY'/);
  const guard=v10.slice(v10.indexOf('function dataGuardCard'),v10.indexOf('function liveOverview'));
  assert.match(guard,/tone=g\.decisionComplete\?'safe'/);
  assert.match(guard,/label=g\.decisionComplete\?'DECISION READY':g\.decisionReady>0\?'PARTIAL READY'/);
});

test('r31 profit watch and lock counts consume only shared decision-ready rows',()=>{
  const live=v10.slice(v10.indexOf('function liveOverview(){'),v10.indexOf('function snapshotBotLine'));
  assert.match(live,/decisionRows=rows\.filter\(b=>h\.decisionReadyBot\?h\.decisionReadyBot\(b\)/);
  assert.match(live,/plans=decisionRows\.map/);
  assert.match(live,/PROFIT WATCH \/ LOCK/);
});

test('r31 release identity remains canonical and execution-neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r31');
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  verifyFrozenDiscoveryParity,
  runRegimeTrendBreakoutV1Holdout,
  sha256Buffer
} from '../research/paper-profit-regime-trend-breakout-v1-holdout.js';
import {REGIME_TREND_BREAKOUT_V1} from '../research/paper-profit-regime-trend-breakout-v1-preregistration.js';

const DAY=86400000;
function flatDataset(days=700){
  const start=Date.UTC(2023,0,1);
  return Object.fromEntries(REGIME_TREND_BREAKOUT_V1.universe.map(s=>[s,Array.from({length:days},(_,i)=>({
    openTime:start+i*DAY,closeTime:start+(i+1)*DAY-1,open:100,high:101,low:99,close:100,volume:1
  }))]));
}

test('Holdout adapter refuses any frozen result that is not a Discovery pass',()=>{
  const r=verifyFrozenDiscoveryParity(flatDataset(),{result:{decision:'REGIME_TREND_BREAKOUT_V1_DISCOVERY_FAIL',holdout:null}});
  assert.equal(r.ok,false);
  assert.equal(r.reason,'FROZEN_DISCOVERY_NOT_PASS');
});

test('Holdout adapter blocks on Discovery replay mismatch before Holdout evaluation',()=>{
  const frozen=JSON.parse(fs.readFileSync('research/results/regime-trend-breakout-v1-result.json','utf8'));
  const r=runRegimeTrendBreakoutV1Holdout(flatDataset(),frozen);
  assert.equal(r.decision,'HOLDOUT_BLOCKED_DISCOVERY_PARITY_FAIL');
  assert.equal(r.holdout,null);
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
});

test('frozen Discovery result still proves Holdout was untouched',()=>{
  const frozen=JSON.parse(fs.readFileSync('research/results/regime-trend-breakout-v1-result.json','utf8'));
  assert.equal(frozen.result.decision,'REGIME_TREND_BREAKOUT_V1_DISCOVERY_PASS_HOLDOUT_REQUIRED');
  assert.equal(frozen.result.holdout,null);
  assert.equal(frozen.sourceSha256,'08fb30cd3c9028920637c71d86035a723be2fdc63ee25607b842dc79211cc69b');
});

test('source SHA helper is deterministic',()=>{
  assert.equal(sha256Buffer(Buffer.from('meridian')),'0814b92d127cd03a2f5e1a9ae60a7b4432e9201d2838905ca6dafd60e38bf4e8');
});

test('Holdout workflow cannot touch historical source on pull requests',()=>{
  const y=fs.readFileSync('.github/workflows/paper-profit-regime-trend-breakout-v1-holdout.yml','utf8');
  assert.match(y,/research\/regime-trend-breakout-v1-holdout-run/);
  assert.match(y,/11266308720/);
  const source=y.slice(y.indexOf('\n  source:'),y.indexOf('\n  evaluate:'));
  const evaluate=y.slice(y.indexOf('\n  evaluate:'));
  assert.match(source,/if: github\.event_name != 'pull_request'/);
  assert.match(evaluate,/if: github\.event_name != 'pull_request'/);
  const inv=y.slice(y.indexOf('\n  invariants:'),y.indexOf('\n  source:'));
  assert.doesNotMatch(inv,/11266308720|run-paper-profit-regime-trend-breakout-v1-holdout/);
});

test('Holdout implementation does not modify the frozen Discovery evaluator',()=>{
  const guard=fs.readFileSync('scripts/frozen-research-guard.mjs','utf8');
  assert.match(guard,/paper-profit-regime-trend-breakout-v1-evaluator\.js':'1947cb7e85929c1cd49966e8b5fc96fd340eca2b'/);
  const body=fs.readFileSync('research/paper-profit-regime-trend-breakout-v1-holdout.js','utf8')+fs.readFileSync('research/run-paper-profit-regime-trend-breakout-v1-holdout.mjs','utf8');
  assert.doesNotMatch(body,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|liveTrading\s*=\s*true|paperTrading\s*=\s*true)/i);
});

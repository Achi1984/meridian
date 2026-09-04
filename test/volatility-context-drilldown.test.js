import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../volatility-context-drilldown.js';

const row=(r,fold='OOS1',asset='BTCUSDT')=>({realizedR:r,foldId:fold,asset});

test('key summary reports fold stability and asset concentration',()=>{
  const x=__test.keySummary([row(.5,'OOS1','BTC'),row(.4,'OOS1','ETH'),row(.3,'OOS2','SOL'),row(-.1,'OOS2','BTC')],['OOS1','OOS2','OOS3']);
  assert.equal(x.n,4);
  assert.equal(x.activeFolds,2);
  assert.equal(x.positiveFolds,2);
  assert.equal(x.assetCount,3);
  assert.equal(x.maxAssetSharePct,50);
});

test('stats preserve normalized-R payoff',()=>{
  const s=__test.stats([{realizedR:1},{realizedR:-.5},{realizedR:.5}]);
  assert.equal(s.n,3);
  assert.equal(s.avgR,0.3333);
  assert.equal(s.pf,3);
});

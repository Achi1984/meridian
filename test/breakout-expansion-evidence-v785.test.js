import test from 'node:test';
import assert from 'node:assert/strict';
import { outcomeR,stats,breakoutEvidenceReport } from '../breakout-expansion-evidence-v785.js';

test('fixed TP1 produces positive normalized R after costs',()=>{
  const s={side:'LONG',entry:100,sl:98,tp1:103};
  const o=outcomeR(s,[{high:103.2,low:99.5,close:103}]);
  assert.equal(o.reason,'TP1');
  assert.ok(o.r>1.3&&o.r<1.5);
});

test('same candle SL and TP1 resolves conservatively to SL',()=>{
  const s={side:'LONG',entry:100,sl:98,tp1:103};
  const o=outcomeR(s,[{high:104,low:97.5,close:101}]);
  assert.equal(o.reason,'SL');
  assert.ok(o.r<-1);
});

test('report preserves research-only no-promotion guard',()=>{
  const now=Date.now();
  const rows=[
    {ts:now-1000,symbol:'BTCUSDT',decision:'TRADE',side:'LONG',outcomeR:1},
    {ts:now-500,symbol:'ETHUSDT',decision:'TRADE',side:'SHORT',outcomeR:-1}
  ];
  const r=breakoutEvidenceReport(rows,{windowsDays:[30],dataEnd:now});
  assert.equal(r.promotion.allowed,false);
  assert.equal(r.windows['30d'].trade.n,2);
  assert.equal(stats(rows).n,2);
});

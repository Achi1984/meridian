import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAssistantSnapshot,tradeFacts} from '../paper-execution-audit.js';

const t=(symbol,side,openedAt,closedAt,entry,sl,exit,realized)=>({symbol,side,openedAt,closedAt,entry,sl,exit,qty:10,realized,exitReason:'SL'});

test('computes stop overrun from frozen entry-stop risk without changing execution',()=>{
  const x=tradeFacts(t('SOLUSDT','LONG','2026-09-01T00:00:00Z','2026-09-01T01:00:00Z',100,99,98.5,-15));
  assert.equal(x.plannedRisk,10);
  assert.equal(x.actualLossR,1.5);
  assert.equal(x.stopSlipBps,50.5);
});

test('detects clustered closes, directional bundles and post-stop re-entry',()=>{
  const rows=[
    t('BTCUSDT','SHORT','2026-09-01T00:00:00Z','2026-09-01T01:00:00Z',100,101,101,-10),
    t('ETHUSDT','SHORT','2026-09-01T00:10:00Z','2026-09-01T01:00:40Z',100,101,101,-10),
    t('BTCUSDT','SHORT','2026-09-01T02:00:00Z','2026-09-01T03:00:00Z',100,101,101,-10)
  ];
  const out=auditAssistantSnapshot({generatedAt:'2026-09-02T00:00:00Z',engine:{running:true},safety:{paperTrading:true,liveTrading:false},paper:{closedCount:4,recentClosed:rows}});
  const b=out.bots[0];
  assert.equal(b.sampleComplete,false);
  assert.equal(b.closureClusters.length,1);
  assert.equal(b.openingBundles.length,1);
  assert.equal(b.sameDirectionReentries.length,1);
  assert.equal(out.executionImpact,false);
});

test('invalid trade fields cannot fabricate stop diagnostics',()=>{
  const x=tradeFacts({entry:null,sl:'bad',qty:0,exitReason:'SL'});
  assert.equal(x.plannedRisk,null);
  assert.equal(x.actualLossR,null);
  assert.equal(x.stopSlipBps,null);
});

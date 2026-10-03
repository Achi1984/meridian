import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,cleanTrade,ledgerReceipt,buildPaperExecutionAuditExport} from '../paper-execution-audit-v2-export.js';

test('digest is deterministic across object key order',()=>assert.equal(digest({b:2,a:1}),digest({a:1,b:2})));
test('export allowlist excludes arbitrary/private fields',()=>{
  const x=cleanTrade({id:'1',symbol:'BTCUSDT',side:'LONG',entry:100,qty:2,sl:90,closedAt:'2026-01-01T00:00:00Z',realized:-20,secret:'never'});
  assert.equal(x.secret,undefined);assert.equal(x.qty,2);assert.equal(x.sl,90);
});
test('missing ledger is explicit and fail-closed',()=>{
  const x=ledgerReceipt('X','x',null);assert.equal(x.available,false);assert.equal(x.digest,null);assert.equal(x.closedCount,0);
});
test('full closed ledger is not recentClosed-truncated',async()=>{
  const trades=Array.from({length:30},(_,i)=>({id:String(i),symbol:'BTCUSDT',side:'LONG',status:'CLOSED',entry:100,qty:1,sl:99,exit:101,exitReason:'TP1',realized:1,openedAt:'2026-01-01T00:00:00Z',closedAt:'2026-01-01T01:00:00Z'}));
  const state={paper:{updatedAt:'2026-01-02T00:00:00Z',positions:[],trades,recentClosed:trades.slice(-12)}};
  const out=await buildPaperExecutionAuditExport(async k=>state[k]||null,{generatedAt:'2026-01-03T00:00:00Z'});
  const base=out.ledgers.find(x=>x.name==='BASELINE');assert.equal(base.closedCount,30);assert.equal(base.trades.length,30);assert.match(out.digest,/^[a-f0-9]{64}$/);
});

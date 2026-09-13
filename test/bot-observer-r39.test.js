import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildBotObserver} from '../bot-observer.js';

test('observer exposes decision telemetry while excluding private and execution fields',()=>{
  const out=buildBotObserver({engine:{running:true,marketFresh:true},safety:{paperTrading:true},challengerV3:{lifecycle:{status:'ACTIVE_PAPER'},account:{startEquity:10000,equity:10020,drawdownPct:1},closedCount:1,openCount:0,profitFactor:1.2,winRate:50,recentClosed:[{id:'secret-id',symbol:'BTCUSDT',side:'SHORT',closedAt:'2026-09-13T00:00:00Z',exitReason:'TP1',realized:20,qty:99,entry:100,plannedRiskBudgetUsd:25}],lastSignal:{gate:{reasons:['MAX_OPEN_POSITIONS']}}},fundingCarry:{lifecycle:'ACTIVE_PAPER',basket:{quantity:4,spotEntry:100,netPnl:-12,fundingIncome:5,basisPnl:-1,totalEstimatedCosts:16},telemetry:{breakEvenRemaining:12,nextFundingTime:123,lastSettlement:{at:'2026-09-13T00:00:00Z',rate:.0001,income:1}}}});
  assert.equal(out.bots.challengerV3.recentClosed[0].netR,.8);assert.deepEqual(out.bots.challengerV3.blockedReasons,['MAX_OPEN_POSITIONS']);
  const raw=JSON.stringify(out);for(const forbidden of ['secret-id','"qty"','"entry"','spotEntry','portfolio','credential'])assert.equal(raw.includes(forbidden),false);
  assert.equal(out.safety.liveTrading,false);assert.equal(out.executionImpact,false);
});

test('observer route is public read-only and server serializes competing ledger work',()=>{
  const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
  assert.match(server,/u\.pathname==="\/api\/bot-observer"/);assert.match(gateway,/"\/api\/bot-observer"/);
  assert.doesNotMatch(gateway,/PUBLIC_PATHS[^\n]+api\/(assistant|public-status)/);
  assert.match(gateway,/PROTECTED_PREFIXES[\s\S]{0,500}"\/api\/public-status","\/api\/assistant"/);
  assert.match(server,/serializePaper\(\(\)=>submitSignalUnlocked/);
  assert.match(server,/serializeCycle\(\(\)=>serializePaper\(cycleUnlocked\)\)/);
  assert.match(server,/serializeScan\(signalScanUnlocked\)/);
  for(const method of ['POST','PUT','DELETE'])assert.equal(server.includes(`req.method==="${method}"&&u.pathname==="/api/bot-observer"`),false);
});

test('baseline summary uses the complete ledger for PF and win rate',()=>{
  const trades=Array.from({length:12},(_,i)=>({status:'CLOSED',symbol:'BTCUSDT',side:'LONG',closedAt:new Date(Date.UTC(2026,8,1,i)).toISOString(),realized:i<2?100:-10}));
  const out=buildBotObserver({baselineState:{account:{startEquity:10000,equity:10100,peakEquity:10200},trades,positions:[]}}).bots.baseline;
  assert.equal(out.closedTrades,12);assert.equal(out.recentClosed.length,10);
  assert.equal(out.profitFactor,2);assert.equal(out.winRate,16.7);
});

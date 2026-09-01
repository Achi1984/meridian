import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_BT_CONFIG, __test } from '../cloud-backtest.js';

const cfg=(extra={})=>({...CLOUD_BT_CONFIG,...extra});
const sig=(symbol='AAAUSDT',extra={})=>({
  symbol,side:'LONG',technical:80,candidate:80,regime:'BULL',status:'READY',
  entry:100,sl:90,tp1:110,tp2:120,distanceAtr:.2,...extra
});

test('opening fee is charged exactly once across open and close accounting',()=>{
  const c=cfg({slippageBps:0,feeBps:5,startEquity:10000});
  const L=__test.makeLedger('T',c);
  const t=Date.UTC(2026,0,1,0,0,0);
  __test.markLedger(L,{AAAUSDT:100},t,c);
  assert.equal(__test.openPosition(L,sig(),1,t,{},c),true);
  assert.equal(Number(L.cash.toFixed(2)),9999.50);
  const p=L.positions[0];
  const tr=__test.closePosition(L,p,110,t+900000,'TEST',c);
  L.positions=[];
  __test.markLedger(L,{AAAUSDT:110},t+900000,c);
  assert.equal(Number(tr.gross.toFixed(2)),100.00);
  assert.equal(Number(tr.feeOpen.toFixed(2)),0.50);
  assert.equal(Number(tr.feeClose.toFixed(2)),0.55);
  assert.equal(Number(tr.realized.toFixed(2)),98.95);
  assert.equal(Number(L.cash.toFixed(2)),10098.95);
  const s=__test.stats(L,c);
  assert.equal(Number(s.pnl.toFixed(2)),98.95);
  assert.equal(Number(s.endEquity.toFixed(2)),10098.95);
});

test('portfolio gate enforces shared max positions and portfolio risk',()=>{
  const c=cfg({slippageBps:0,maxOpenPositions:3,maxPortfolioRiskPct:3});
  const L=__test.makeLedger('T',c);
  const t=Date.UTC(2026,0,1,0,0,0);
  __test.markLedger(L,{AAAUSDT:100,BBBUSDT:100,CCCUSDT:100,DDDUSDT:100},t,c);
  for(const s of [sig('AAAUSDT'),sig('BBBUSDT'),sig('CCCUSDT')]){
    assert.equal(__test.gate(L,s,1,t,c).ok,true);
    assert.equal(__test.openPosition(L,s,1,t,{},c),true);
  }
  const g=__test.gate(L,sig('DDDUSDT'),1,t,c);
  assert.equal(g.ok,false);
  assert.ok(g.reasons.includes('MAX_OPEN_POSITIONS'));
  assert.ok(g.reasons.includes('MAX_PORTFOLIO_RISK'));
});

test('baseline, shadow and challenger replay on independent ledgers',()=>{
  const c=cfg({slippageBps:0,feeBps:0});
  const t0=Date.UTC(2026,0,1,0,0,0),t1=t0+900000;
  const events=[
    {t:t0,candles:{AAAUSDT:{low:99,high:101,close:100}},signals:{AAAUSDT:sig()}},
    {t:t1,candles:{AAAUSDT:{low:100,high:121,close:120}},signals:{}}
  ];
  const r=__test.replayPrepared(events,t0,t1,c);
  assert.equal(r.baseline.trades,1);
  assert.equal(r.shadow.trades,1);
  assert.equal(r.challenger.trades,1);
  assert.equal(r.baseline.tradeList[0].exitReason,'TP2');
  assert.equal(r.shadow.tradeList[0].exitReason,'TP2');
  assert.equal(r.challenger.tradeList[0].exitReason,'TP2');
  assert.notStrictEqual(r.baseline.tradeList,r.shadow.tradeList);
});

test('legacy Shadow V1 regime gates remain mirrored only in research replay',()=>{
  assert.equal(__test.shadowDecision(sig('A',{regime:'BULL'})).decision,'TRADE');
  const longRange=__test.shadowDecision(sig('A',{regime:'RANGE'}));
  assert.equal(longRange.decision,'SKIP');
  assert.ok(longRange.reasons.includes('SHADOW_LONG_ONLY_BULL'));
  const shortRange=__test.shadowDecision(sig('A',{side:'SHORT',regime:'RANGE',sl:110,tp1:90,tp2:80}));
  assert.equal(shortRange.decision,'TRADE');
});

test('challenger uses soft TRADE/CAUTION/SKIP confidence without changing baseline status',()=>{
  const high=__test.challengerDecision(sig('A',{technical:85,candidate:85,regime:'BULL'}));
  assert.equal(high.decision,'TRADE');
  const blocked=__test.challengerDecision(sig('A',{status:'WAIT_ENTRY_ZONE'}));
  assert.equal(blocked.decision,'SKIP');
  assert.ok(blocked.reasons.includes('WAIT_ENTRY_ZONE'));
});

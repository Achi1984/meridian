import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SK_PAPERBOT_V1_CONFIG,normalizeSkCandles,replaySkPaperBot,
  skChronologicalStability,evaluateSkPaperGate
} from '../research/sk-paperbot-v1.js';

const c=(t,o,h,l,cl)=>({openTime:t,closeTime:t+1,open:o,high:h,low:l,close:cl});

test('SK V1 policy is frozen research-only with four entries and three targets',()=>{
  assert.equal(SK_PAPERBOT_V1_CONFIG.timeframe,'4h');
  assert.deepEqual([...SK_PAPERBOT_V1_CONFIG.entryRatios],[.5,.559,.618,.667]);
  assert.deepEqual([...SK_PAPERBOT_V1_CONFIG.targetRatios],[1.618,1.809,2]);
  assert.equal(SK_PAPERBOT_V1_CONFIG.gateRatio,.382);
  assert.equal(SK_PAPERBOT_V1_CONFIG.riskPct,1);
});

test('SK V1 normalizes and chronologically sorts candle input',()=>{
  const rows=normalizeSkCandles([c(2,1,3,1,2),c(1,1,2,.5,1.5)]);
  assert.equal(rows[0].openTime,1);
  assert.equal(rows[1].openTime,2);
});

test('SK V1 bullish sequence gates at 0.382, scales entries and exits through targets',()=>{
  const rows=[
    c(0,88,90,86,88),
    c(1,86,88,80,84),   // pivot LOW = 80
    c(2,84,94,83,92),
    c(3,92,100,90,98),  // pivot HIGH = 100
    c(4,98,99,95,96),   // confirms A
    c(5,96,97,94,95),   // counter swing / double advantage candidate
    c(6,95,96,91,92),   // gate .382
    c(7,92,93,88,89),   // fills .500 and .559
    c(8,89,90,86.5,88), // fills .618 and .667
    c(9,88,105,87,104),
    c(10,104,113,103,112), // TP 1.618
    c(11,112,117,111,116), // TP 1.809
    c(12,116,121,115,120)  // TP 2.000
  ];
  const r=replaySkPaperBot(rows,{config:{pivotLeft:1,pivotRight:1,feeBps:0,slippageBps:0}});
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
  assert.equal(r.summary.trades,1);
  assert.equal(r.trades[0].side,'LONG');
  assert.deepEqual(r.trades[0].entryRatios,[.5,.559,.618,.667]);
  assert.deepEqual(r.trades[0].targetRatios,[1.618,1.809,2]);
  assert.equal(r.trades[0].exitReason,'TARGET_COMPLETE');
  assert.ok(r.trades[0].realizedPnl>0);
  assert.ok(r.events.some(x=>x.type==='GATE'));
  assert.ok(r.events.filter(x=>x.type==='ENTRY').length===4);
});

test('SK V1 invalidates at origin before inventing a recovery',()=>{
  const rows=[
    c(0,88,90,86,88),c(1,86,88,80,84),c(2,84,94,83,92),c(3,92,100,90,98),c(4,98,99,95,96),
    c(5,96,96,91,92),c(6,92,92,88,89),c(7,89,90,79,80)
  ];
  const r=replaySkPaperBot(rows,{config:{pivotLeft:1,pivotRight:1,feeBps:0,slippageBps:0}});
  assert.equal(r.summary.trades,1);
  assert.equal(r.trades[0].exitReason,'ORIGIN_INVALIDATION');
  assert.ok(r.trades[0].realizedPnl<0);
});

test('SK V1 keeps Double Advantage as measured cohort, not entry requirement',()=>{
  const rows=[
    c(0,88,90,86,88),c(1,86,88,80,84),c(2,84,94,83,92),c(3,92,100,90,98),c(4,98,99,96,97),
    c(5,97,99,94,95), // opposing move target overlaps parent GKL
    c(6,95,96,91,92),c(7,92,93,88,89),c(8,89,90,86.5,88),c(9,88,113,87,112),c(10,112,121,111,120)
  ];
  const r=replaySkPaperBot(rows,{config:{pivotLeft:1,pivotRight:1,feeBps:0,slippageBps:0}});
  assert.equal(r.summary.trades,1);
  assert.equal(r.trades[0].doubleAdvantage,true);
  assert.equal(r.summary.doubleAdvantageTrades,1);
});

test('SK V1 applies fees and slippage instead of reporting frictionless PnL',()=>{
  const rows=[
    c(0,88,90,86,88),c(1,86,88,80,84),c(2,84,94,83,92),c(3,92,100,90,98),c(4,98,99,95,96),
    c(5,96,96,91,92),c(6,92,93,88,89),c(7,89,90,86.5,88),c(8,88,121,87,120)
  ];
  const free=replaySkPaperBot(rows,{config:{pivotLeft:1,pivotRight:1,feeBps:0,slippageBps:0}});
  const cost=replaySkPaperBot(rows,{config:{pivotLeft:1,pivotRight:1,feeBps:5,slippageBps:3}});
  assert.ok(cost.summary.fees>0);
  assert.ok(cost.summary.pnl<free.summary.pnl);
});

test('SK V1 research gate never auto-promotes and requires sample stability',()=>{
  const summary={trades:25,profitFactor:1.4,expectancy:12,maxDrawdownPct:6};
  const pass=evaluateSkPaperGate(summary,{positiveWindows:4});
  assert.equal(pass.pass,true);
  assert.equal(pass.autoPromotion,false);
  const fail=evaluateSkPaperGate({...summary,trades:8},{positiveWindows:4});
  assert.equal(fail.pass,false);
  assert.ok(fail.reasons.includes('SAMPLE_LT_20'));
});

test('SK V1 chronological stability reports five windows without parameter refit',()=>{
  const trades=Array.from({length:10},(_,i)=>({openedAt:1000+i*100,realizedPnl:i%3===0?-5:10,side:i%2?'LONG':'SHORT',fees:1}));
  const s=skChronologicalStability(trades,5);
  assert.equal(s.windows.length,5);
  assert.ok(s.positiveWindows>=1);
});

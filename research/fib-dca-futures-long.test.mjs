import assert from "node:assert/strict";
import { fibPrices, backtestFibCycle } from "./fib-dca-futures-long.js";

const lv=fibPrices(100,200);
assert.equal(lv.dca[0],161.8);
assert.equal(lv.dca[1],150);
assert.equal(lv.invalidation,100);
assert.equal(lv.tp[0],200);
assert.equal(lv.tp[1],227.2);
assert.equal(lv.tp[2],261.8);

const candles=[
 {ts:1,open:170,high:175,low:160,close:165},
 {ts:2,open:165,high:205,low:155,close:200},
 {ts:3,open:205,high:230,low:198,close:225},
 {ts:4,open:225,high:265,low:220,close:260},
];
const r=backtestFibCycle(candles,100,200,{feeRate:0,slippageRate:0});
assert.deepEqual(r.tpHits,[true,true,true]);
assert.ok(r.realizedPnl>0);
console.log("fib-dca research tests passed", {pnl:r.realizedPnl, entry:r.weightedEntry});

const blocked=backtestFibCycle(candles,100,200,{feeRate:0,slippageRate:0,entryGate:()=>({pass:false})});
assert.equal(blocked.fills.length,0);
assert.ok(blocked.events.some(x=>x.type==="DCA_BLOCKED"));
const selective=backtestFibCycle(candles,100,200,{feeRate:0,slippageRate:0,entryGate:({level})=>({pass:level===1})});
assert.equal(selective.fills.length,1);
assert.equal(selective.fills[0].level,0);

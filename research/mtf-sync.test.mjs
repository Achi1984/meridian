import assert from "node:assert/strict";import {commonWindow,splitByTimestamp} from "./mtf-sync.js";
const mk=(a,n,s)=>Array.from({length:n},(_,i)=>({ts:a+i*s,close:i}));
const x=commonWindow({h4:mk(0,10,4),h1:mk(8,30,1),m15:mk(12,100,.25)});
assert.equal(x.start,12);assert.equal(x.end,36);assert.ok(Object.values(x.series).every(v=>v.every(c=>c.ts>=12&&c.ts<=36)));
const w=splitByTimestamp(x.series,.7);assert.ok(w.cut>12&&w.cut<36);console.log("MTF sync tests passed");

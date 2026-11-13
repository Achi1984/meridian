import test from "node:test";
import assert from "node:assert/strict";
import {createCausalQuoteCostAdapter,evaluateCausalQuoteChain} from "../scripts/memecoin-paper/market-quote-adapter.mjs";

const prov=(source)=>({source,receiptTime:"2026-11-13T20:00:01.000Z"});
const leg=(o={})=>({asset:"SOL",quoteCurrency:"USD",poolId:"pool-1",routeId:"route-1",sourceTime:"2026-11-13T20:00:00.000Z",receiptTime:"2026-11-13T20:00:01.000Z",grossInput:100,grossOutput:100,fees:{amount:1,provenance:prov("fees")},slippage:{amount:.5,provenance:prov("slippage")},impact:{amount:.2,provenance:prov("impact")},network:{amount:.01,provenance:prov("network")},...o});

test("causal entry/exit chain computes net and never authorizes",()=>{
 const r=evaluateCausalQuoteChain({entry:leg(),exit:leg({grossOutput:120,sourceTime:"2026-11-13T20:01:00.000Z",receiptTime:"2026-11-13T20:01:01.000Z"}),fx:{rate:1,pair:"USD/USD",provenance:prov("fx")},now:"2026-11-13T20:02:00.000Z"});
 assert.equal(r.status,"READY"); assert.equal(r.netQuote,16.58); assert.equal(r.executionAuthorized,false);
});
test("missing fee provenance and invented zero fail closed",()=>{
 const r=evaluateCausalQuoteChain({entry:leg({fees:{amount:0}}),exit:leg(),fx:{rate:1,pair:"USD/USD",provenance:prov("fx")},now:"2026-11-13T20:02:00.000Z"});
 assert.equal(r.status,"UNKNOWN"); assert.equal(r.reason,"MISSING_OR_UNPROVEN_FEES");
});
test("stale, future, mixed identity and missing FX are UNKNOWN",()=>{
 const fx={rate:1,pair:"USD/USD",provenance:prov("fx")};
 assert.equal(evaluateCausalQuoteChain({entry:leg(),exit:leg({sourceTime:"2026-11-13T20:01:00.000Z"}),fx,now:"2026-11-13T20:30:00.000Z"}).reason,"STALE_QUOTE");
 assert.equal(evaluateCausalQuoteChain({entry:leg(),exit:leg(),fx,now:"2026-11-13T19:59:00.000Z"}).reason,"FUTURE_SOURCE_TIME");
 assert.equal(evaluateCausalQuoteChain({entry:leg(),exit:leg({poolId:"other"}),fx,now:"2026-11-13T20:02:00.000Z"}).reason,"MIXED_QUOTE_IDENTITY");
 assert.equal(evaluateCausalQuoteChain({entry:leg(),exit:leg(),now:"2026-11-13T20:02:00.000Z"}).reason,"MISSING_OR_UNPROVEN_FX");
});
test("transport is bounded, fixed-origin and aborts",async()=>{
 let aborted=false;
 const a=createCausalQuoteCostAdapter({origin:"https://quotes.example",maxDurationMs:10,transport:(_url,init)=>new Promise((_,rej)=>init.signal.addEventListener("abort",()=>{aborted=true;rej(new Error("abort"));},{once:true}))});
 const r=await a.request({path:"/quote"}); assert.equal(r.reason,"TIMEOUT"); assert.equal(aborted,true);
 assert.equal((await a.request({path:"https://evil.example/quote"})).reason,"ORIGIN_MISMATCH");
});

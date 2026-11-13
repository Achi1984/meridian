import test from "node:test";
import assert from "node:assert/strict";
import {createCausalQuoteCostAdapter,evaluateCausalQuoteChain} from "../scripts/memecoin-paper/market-quote-adapter.mjs";

const prov=(source,receiptTime="2026-11-13T20:00:01.000Z",id={})=>({source,receiptTime,asset:"SOL",quoteCurrency:"USD",poolId:"pool-1",routeId:"route-1",...id});
const leg=(o={})=>{const x={asset:"SOL",quoteCurrency:"USD",poolId:"pool-1",routeId:"route-1",sourceTime:"2026-11-13T20:00:00.000Z",receiptTime:"2026-11-13T20:00:01.000Z",grossInput:"100",grossOutput:"100",fee:{amount:"1",provenance:prov("fee")},slippage:{amount:"0.5",provenance:prov("slippage")},impact:{amount:"0.2",provenance:prov("impact")},network:{amount:"0.01",provenance:prov("network")},...o};const p=x.receiptTime;for(const k of ["fee","slippage","impact","network"])if(x[k]&&x[k].provenance&&x[k].provenance.receiptTime==="2026-11-13T20:00:01.000Z"&&p!=="2026-11-13T20:00:01.000Z")x[k]={...x[k],provenance:{...x[k].provenance,receiptTime:p}};return x;};

test("causal entry/exit chain uses deterministic decimal strings and never authorizes",()=>{
 const r=evaluateCausalQuoteChain({entry:leg(),exit:leg({grossOutput:"120",sourceTime:"2026-11-13T20:01:00.000Z",receiptTime:"2026-11-13T20:01:01.000Z"}),fx:{rate:"1",pair:"USD/USD",provenance:prov("fx")},now:"2026-11-13T20:02:00.000Z"});
 assert.equal(r.status,"READY");assert.equal(r.netQuote,"118.29");assert.equal(r.netUsd,"118.29");assert.equal(r.executionAuthorized,false);
});
test("missing fee provenance and invented zero fail closed",()=>{
 const r=evaluateCausalQuoteChain({entry:leg({fee:{amount:"0"}}),exit:leg(),fx:{rate:"1",pair:"USD/USD",provenance:prov("fx")},now:"2026-11-13T20:02:00.000Z"});
 assert.equal(r.status,"UNKNOWN");assert.equal(r.reason,"MISSING_PROVENANCE");
});
test("stale, future, mixed identity, FX pair and missing FX are UNKNOWN",()=>{
 const fx={rate:"1",pair:"USD/USD",provenance:prov("fx")};
 assert.equal(evaluateCausalQuoteChain({entry:leg(),exit:leg({sourceTime:"2026-11-13T20:01:00.000Z",receiptTime:"2026-11-13T20:01:01.000Z"}),fx,now:"2026-11-13T20:30:00.000Z"}).reason,"STALE_QUOTE");
 assert.equal(evaluateCausalQuoteChain({entry:leg(),exit:leg({sourceTime:"2026-11-13T20:01:00.000Z"}),fx,now:"2026-11-13T19:59:00.000Z"}).reason,"FUTURE_SOURCE_TIME");
 assert.equal(evaluateCausalQuoteChain({entry:leg(),exit:leg({poolId:"other"}),fx,now:"2026-11-13T20:02:00.000Z"}).reason,"MISSING_PROVENANCE");
 assert.equal(evaluateCausalQuoteChain({entry:leg(),exit:leg({sourceTime:"2026-11-13T20:01:00.000Z"}),fx:{...fx,pair:"EUR/USD"},now:"2026-11-13T20:02:00.000Z"}).reason,"MISSING_PROVENANCE");
 assert.equal(evaluateCausalQuoteChain({entry:leg(),exit:leg({sourceTime:"2026-11-13T20:01:00.000Z"}),now:"2026-11-13T20:02:00.000Z"}).reason,"MISSING_PROVENANCE");
});
test("receipt and FX provenance future timestamps fail closed",()=>{
 const future={...prov("fx"),receiptTime:"2026-11-13T20:03:00.000Z"};
 assert.equal(evaluateCausalQuoteChain({entry:leg(),exit:leg({sourceTime:"2026-11-13T20:01:00.000Z"}),fx:{rate:"1",pair:"USD/USD",provenance:future},now:"2026-11-13T20:02:00.000Z"}).reason,"FUTURE_SOURCE_TIME");
});
test("transport is bounded, fixed-origin and aborts",async()=>{
 let aborted=false;
 const a=createCausalQuoteCostAdapter({maxDurationMs:10,transport:(_url,init)=>new Promise((_,rej)=>init.signal.addEventListener("abort",()=>{aborted=true;rej(new Error("abort"));},{once:true}))});
 assert.equal((await a.fetchJson("/quote")).reason,"TIMEOUT");assert.equal(aborted,true);
 assert.equal((await a.fetchJson("https://evil.example/quote")).reason,"ORIGIN_NOT_ALLOWED");
});

test("exit cannot begin before entry receipt",()=>{
 const r=evaluateCausalQuoteChain({entry:leg(),exit:leg({sourceTime:"2026-11-13T20:00:00.500Z"}),fx:{rate:"1",pair:"USD/USD",provenance:prov("fx")},now:"2026-11-13T20:02:00.000Z"});
 assert.equal(r.status,"UNKNOWN");assert.equal(r.reason,"MIXED_PROVENANCE");
});
test("causal transport rejects response without a readable bounded body",async()=>{
 const a=createCausalQuoteCostAdapter({transport:async()=>({text:async()=>"{\"ok\":true}"})});
 const r=await a.fetchJson("/quote");assert.equal(r.status,"UNKNOWN");assert.equal(r.reason,"TRANSPORT_FAILED");
});

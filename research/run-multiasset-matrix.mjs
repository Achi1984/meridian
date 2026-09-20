import {fetchOkxHistory} from "./okx-history.js";
import {bullishFibCycles} from "./swing-detector.js";
import {backtestFibCycle} from "./fib-dca-futures-long.js";
import {portfolioMetrics,buyHold} from "./portfolio-metrics.js";

const assets=["BTC","ETH","SOL","AVAX"];
const leverages=[2,3,4];
const weights=[[.15,.2,.3,.35],[.1,.2,.3,.4],[.25,.25,.25,.25]];
function run(set,l,w){
 const cy=bullishFibCycles(set,{leftBars:3,rightBars:3});
 const rs=cy.map((x,i)=>backtestFibCycle(set.slice(x.startIndex,i+1<cy.length?cy[i+1].startIndex:set.length),x.swingLow,x.swingHigh,{leverage:l,dcaWeights:w}));
 return portfolioMetrics(rs);
}
const rows=[];
for(const asset of assets){
 const c=await fetchOkxHistory({instId:`${asset}-USDT-SWAP`,bar:"4H",pages:60});
 if(c.length<200){rows.push({asset,error:"insufficient candles",candles:c.length});continue;}
 const cut=Math.floor(c.length*.7),train=c.slice(0,cut),test=c.slice(cut);
 const candidates=[];
 for(const l of leverages)for(const w of weights){const m=run(train,l,w);candidates.push({l,w,m,score:m.netReturn-m.maxDrawdown});}
 candidates.sort((a,b)=>b.score-a.score);const best=candidates[0];
 rows.push({asset,candles:c.length,selected:{leverage:best.l,weights:best.w},train:best.m,test:run(test,best.l,best.w),buyHoldTest:buyHold(test)});
}
console.log(JSON.stringify(rows,null,2));

import {fetchOkxHistory} from "./okx-history.js";
import {bullishFibCycles} from "./swing-detector.js";
import {backtestFibCycle} from "./fib-dca-futures-long.js";
import {confirmationScore} from "./mtf-confirmation.js";
import {commonWindow,splitByTimestamp} from "./mtf-sync.js";
import {portfolioMetrics,buyHold} from "./portfolio-metrics.js";

const assets=["BTC","ETH","SOL","AVAX"];
function historyUntil(c,ts,n=80){return c.filter(z=>z.ts<=ts).slice(-n)}
function run(h4,h1,m15){
 const cy=bullishFibCycles(h4,{leftBars:3,rightBars:3}),rs=[];
 for(let i=0;i<cy.length;i++){
   const x=cy[i],start=x.startIndex,end=i+1<cy.length?cy[i+1].startIndex:h4.length;
   const ts=h4[start]?.ts;if(!ts)continue;
   const g4=confirmationScore(historyUntil(h4,ts));
   const g1=confirmationScore(historyUntil(h1,ts));
   const g15=confirmationScore(historyUntil(m15,ts));
   if(!(g4.pass&&g1.pass&&g15.score>=2))continue;
   rs.push(backtestFibCycle(h4.slice(start,end),x.swingLow,x.swingHigh,{leverage:2,dcaWeights:[.1,.2,.3,.4]}));
 }
 return portfolioMetrics(rs);
}
const rows=[];
for(const asset of assets){
 const instId=`${asset}-USDT-SWAP`;
 // Fetch roughly comparable durations: 4H is the limiting history series.
 const [m15raw,h1raw,h4raw]=await Promise.all([
   fetchOkxHistory({instId,bar:"15m",pages:240}),
   fetchOkxHistory({instId,bar:"1H",pages:120}),
   fetchOkxHistory({instId,bar:"4H",pages:60})
 ]);
 const aligned=commonWindow({h4:h4raw,h1:h1raw,m15:m15raw});
 const split=splitByTimestamp(aligned.series,.7);
 if(!split?.test?.h4?.length) throw new Error(`No aligned test window for ${asset}`);
 rows.push({
   asset,
   window:{start:new Date(aligned.start).toISOString(),end:new Date(aligned.end).toISOString(),cut:new Date(split.cut).toISOString()},
   candles:Object.fromEntries(Object.entries(aligned.series).map(([k,v])=>[k,v.length])),
   testCandles:Object.fromEntries(Object.entries(split.test).map(([k,v])=>[k,v.length])),
   v02:run(split.test.h4,split.test.h1,split.test.m15),
   buyHold:buyHold(split.test.h4)
 });
}
console.log(JSON.stringify(rows,null,2));

import {fetchOkxHistory} from "./okx-history.js";
import {bullishFibCycles} from "./swing-detector.js";
import {backtestFibCycle} from "./fib-dca-futures-long.js";
import {confirmationScore} from "./mtf-confirmation.js";
import {portfolioMetrics,buyHold} from "./portfolio-metrics.js";

const assets=["BTC","ETH","SOL","AVAX"];
function resample(candles,factor){
 const out=[]; for(let i=0;i+factor<=candles.length;i+=factor){const a=candles.slice(i,i+factor);out.push({ts:a.at(-1).ts,open:a[0].open,high:Math.max(...a.map(x=>x.high)),low:Math.min(...a.map(x=>x.low)),close:a.at(-1).close,volume:a.reduce((s,x)=>s+(x.volume||0),0)});} return out;
}
function historyUntil(c,ts,n=60){const x=c.filter(z=>z.ts<=ts);return x.slice(-n)}
function run(set,h1,m15){
 const cy=bullishFibCycles(set,{leftBars:3,rightBars:3}),rs=[];
 for(let i=0;i<cy.length;i++){
   const x=cy[i], start=x.startIndex, end=i+1<cy.length?cy[i+1].startIndex:set.length;
   const ts=set[start]?.ts;if(!ts)continue;
   const g4=confirmationScore(historyUntil(set,ts));
   const g1=confirmationScore(historyUntil(h1,ts));
   const g15=confirmationScore(historyUntil(m15,ts));
   if(!(g4.pass&&g1.pass&&g15.score>=2))continue;
   rs.push(backtestFibCycle(set.slice(start,end),x.swingLow,x.swingHigh,{leverage:2,dcaWeights:[.1,.2,.3,.4]}));
 }
 return portfolioMetrics(rs);
}
const rows=[];
for(const asset of assets){
 const m15=await fetchOkxHistory({instId:`${asset}-USDT-SWAP`,bar:"15m",pages:60});
 const h1=await fetchOkxHistory({instId:`${asset}-USDT-SWAP`,bar:"1H",pages:60});
 const h4=await fetchOkxHistory({instId:`${asset}-USDT-SWAP`,bar:"4H",pages:60});
 const cut=Math.floor(h4.length*.7),test=h4.slice(cut),testStart=test[0]?.ts||0;
 rows.push({asset,candles:{h4:h4.length,h1:h1.length,m15:m15.length},v02:run(test,h1.filter(x=>x.ts>=testStart-60*60*1000*80),m15.filter(x=>x.ts>=testStart-15*60*1000*80)),buyHold:buyHold(test)});
}
console.log(JSON.stringify(rows,null,2));

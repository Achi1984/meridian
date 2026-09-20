import {fetchOkxHistory} from "./okx-history.js";
import {bullishFibCycles} from "./swing-detector.js";
import {backtestFibCycle} from "./fib-dca-futures-long.js";
import {portfolioMetrics,buyHold} from "./portfolio-metrics.js";
const c=await fetchOkxHistory({instId:"BTC-USDT-SWAP",bar:"4H",pages:60});
const cut=Math.floor(c.length*.7), train=c.slice(0,cut), test=c.slice(cut);
const weights=[[.15,.2,.3,.35],[.1,.2,.3,.4],[.25,.25,.25,.25]];
function run(set,leverage,w){
 const cy=bullishFibCycles(set,{leftBars:3,rightBars:3});
 const rs=cy.map((x,i)=>backtestFibCycle(set.slice(x.startIndex,i+1<cy.length?cy[i+1].startIndex:set.length),x.swingLow,x.swingHigh,{leverage,dcaWeights:w}));
 return portfolioMetrics(rs);
}
const trainRows=[]; for(const l of [2,3,4])for(const w of weights)trainRows.push({leverage:l,weights:w,...run(train,l,w)});
trainRows.sort((a,b)=>(b.netReturn-b.maxDrawdown)-(a.netReturn-a.maxDrawdown));
const selected=trainRows[0];
const out={data:{candles:c.length,train:train.length,test:test.length},benchmark:{train:buyHold(train),test:buyHold(test)},selected:{leverage:selected.leverage,weights:selected.weights},train:selected,test:run(test,selected.leverage,selected.weights)};
console.log(JSON.stringify(out,null,2));

import {fetchOkxHistory,splitWalkForward} from "./okx-history.js";
import {bullishFibCycles} from "./swing-detector.js";
import {backtestFibCycle} from "./fib-dca-futures-long.js";

function metrics(results){
 const closed=results.filter(x=>x.events.some(e=>e.type==="STOP"||e.type==="TP3"));
 const pnls=results.map(x=>x.realizedPnl);
 const wins=pnls.filter(x=>x>0), losses=pnls.filter(x=>x<0);
 const grossWin=wins.reduce((a,b)=>a+b,0), grossLoss=-losses.reduce((a,b)=>a+b,0);
 return {cycles:results.length,closed:closed.length,netPnl:pnls.reduce((a,b)=>a+b,0),
   winRate:results.length?wins.length/results.length:0,profitFactor:grossLoss?grossWin/grossLoss:null,
   tp1:results.filter(x=>x.tpHits[0]).length,tp2:results.filter(x=>x.tpHits[1]).length,tp3:results.filter(x=>x.tpHits[2]).length,
   stops:results.filter(x=>x.stopped).length};
}
const candles=await fetchOkxHistory({instId:"BTC-USDT-SWAP",bar:"4H",pages:30});
const {train,test}=splitWalkForward(candles,.7);
for(const [name,set] of [["train",train],["test",test]]){
 const cycles=bullishFibCycles(set,{leftBars:3,rightBars:3});
 const rs=cycles.map((cy,i)=>{
   const end=i+1<cycles.length?cycles[i+1].startIndex:set.length;
   return backtestFibCycle(set.slice(cy.startIndex,end),cy.swingLow,cy.swingHigh,{leverage:3});
 });
 console.log(name,metrics(rs));
}

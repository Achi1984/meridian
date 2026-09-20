export function portfolioMetrics(cycles, initialEquity=10000){
 let eq=initialEquity, peak=eq, maxDD=0, grossWin=0,grossLoss=0,wins=0;
 const curve=[{i:0,equity:eq}];
 cycles.forEach((r,i)=>{const p=r.realizedPnl-(r.fundingCost||0);eq+=p;if(p>0){wins++;grossWin+=p}else grossLoss-=Math.min(0,p);peak=Math.max(peak,eq);maxDD=Math.max(maxDD,(peak-eq)/peak);curve.push({i:i+1,equity:eq});});
 return {initialEquity,finalEquity:eq,netReturn:(eq/initialEquity)-1,maxDrawdown:maxDD,profitFactor:grossLoss?grossWin/grossLoss:null,winRate:cycles.length?wins/cycles.length:0,cycles:cycles.length,equityCurve:curve};
}
export function buyHold(candles,initialEquity=10000){if(candles.length<2)return null;return {start:candles[0].close,end:candles.at(-1).close,return:candles.at(-1).close/candles[0].close-1,finalEquity:initialEquity*candles.at(-1).close/candles[0].close};}

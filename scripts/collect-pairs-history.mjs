// Read-only historical snapshot; stdout can be saved for reproducible offline scans.
const symbols=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','LINKUSDT','AVAXUSDT','DOGEUSDT'];
const asOf=Date.now(),series={},funding={};
await Promise.all(symbols.map(async symbol=>{
  const newestUrl=`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=4h&limit=1000&endTime=${asOf}`;
  const newestResponse=await fetch(newestUrl,{signal:AbortSignal.timeout(30000)});
  if(!newestResponse.ok)throw new Error(`${symbol} klines: HTTP ${newestResponse.status}`);
  const newest=await newestResponse.json();
  const olderEnd=Number(newest[0][0])-1;
  const olderUrl=`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=4h&limit=1000&endTime=${olderEnd}`;
  const fundingUrl=`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&startTime=${olderEnd-1000*14400000}&endTime=${asOf}&limit=1000`;
  const [olderResponse,fundingResponse]=await Promise.all([
    fetch(olderUrl,{signal:AbortSignal.timeout(30000)}),fetch(fundingUrl,{signal:AbortSignal.timeout(30000)})]);
  if(!olderResponse.ok)throw new Error(`${symbol} older klines: HTTP ${olderResponse.status}`);
  if(!fundingResponse.ok)throw new Error(`${symbol} funding: HTTP ${fundingResponse.status}`);
  const older=await olderResponse.json(),fundingRows=await fundingResponse.json();
  if(!Array.isArray(newest)||!Array.isArray(older)||!Array.isArray(fundingRows))throw new Error(`${symbol}: invalid response`);
  const combined=[...older,...newest].filter((r,i,a)=>i===0||Number(r[0])!==Number(a[i-1][0]));
  series[symbol]=combined.filter(r=>Number(r[0])+14400000<=asOf).slice(-1751).map(r=>[Number(r[0]),Number(r[4])]);
  const firstAt=series[symbol][0][0];
  funding[symbol]=fundingRows.filter(r=>Number(r.fundingTime)>=firstAt&&Number(r.fundingTime)<=asOf)
    .map(r=>[Number(r.fundingTime),Number(r.fundingRate),Number(r.markPrice)]);
}));
console.log(JSON.stringify({asOf,source:'Binance USD-M closed 4h candles and funding settlements',series,funding}));

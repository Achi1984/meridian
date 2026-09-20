/**
 * OKX public history-candle loader for MERIDIAN research.
 * Node 18+ (global fetch). Returns oldest -> newest, confirmed candles only.
 */
const BASE="https://www.okx.com/api/v5/market/history-candles";

export async function fetchOkxHistory({instId="BTC-USDT-SWAP",bar="4H",pages=20,limit=100,endMs}={}) {
  let after=endMs ? String(endMs) : undefined;
  const rows=[];
  for(let p=0;p<pages;p++){
    const u=new URL(BASE);
    u.searchParams.set("instId",instId); u.searchParams.set("bar",bar); u.searchParams.set("limit",String(limit));
    if(after) u.searchParams.set("after",after);
    const res=await fetch(u,{headers:{"User-Agent":"MERIDIAN-research/1.0"}});
    if(!res.ok) throw new Error(`OKX HTTP ${res.status}`);
    const j=await res.json();
    if(j.code!=="0") throw new Error(`OKX ${j.code}: ${j.msg}`);
    if(!j.data?.length) break;
    for(const x of j.data){
      const [ts,o,h,l,c,vol,volCcy,volQuote,confirm]=x;
      if(String(confirm)!=="1") continue;
      rows.push({ts:Number(ts),open:+o,high:+h,low:+l,close:+c,volume:+vol,volumeBase:+volCcy,volumeQuote:+volQuote});
    }
    after=j.data[j.data.length-1][0];
    if(j.data.length<limit) break;
    await new Promise(r=>setTimeout(r,120));
  }
  const unique=new Map(rows.map(x=>[x.ts,x]));
  return [...unique.values()].sort((a,b)=>a.ts-b.ts);
}

export function splitWalkForward(candles, trainFraction=0.7){
  const n=Math.max(1,Math.min(candles.length-1,Math.floor(candles.length*trainFraction)));
  return {train:candles.slice(0,n),test:candles.slice(n)};
}

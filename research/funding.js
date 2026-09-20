/** Funding utilities. funding rows: {ts, rate}. */
export function fundingCostForWindow(funding, fromTs, toTs, notional){
  return funding.filter(x=>x.ts>=fromTs&&x.ts<=toTs).reduce((s,x)=>s+notional*x.rate,0);
}
export async function fetchOkxFundingHistory({instId="BTC-USDT-SWAP",pages=20,limit=100}={}){
  const out=[]; let after;
  for(let p=0;p<pages;p++){
    const u=new URL("https://www.okx.com/api/v5/public/funding-rate-history");
    u.searchParams.set("instId",instId);u.searchParams.set("limit",String(limit)); if(after)u.searchParams.set("after",after);
    const r=await fetch(u); if(!r.ok) throw new Error(`OKX funding HTTP ${r.status}`);
    const j=await r.json(); if(j.code!=="0") throw new Error(j.msg);
    if(!j.data?.length)break;
    for(const x of j.data) out.push({ts:+x.fundingTime,rate:+x.fundingRate});
    const oldest=Math.min(...j.data.map(x=>+x.fundingTime));\n    if(after&&String(oldest)===String(after))break;\n    after=String(oldest);
    if(j.data.length<limit)break;
    await new Promise(r=>setTimeout(r,120));
  }
  return [...new Map(out.map(x=>[x.ts,x])).values()].sort((a,b)=>a.ts-b.ts);
}

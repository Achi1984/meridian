// MERIDIAN v7.86 R2 — public Binance market source for Retest/Hold research.
// Research-only. No private state and no execution impact.

const ENDPOINTS=['https://api.binance.com','https://data-api.binance.vision'];
const MS={'15m':900000,'1h':3600000};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function fetchPage(symbol,interval,start,end,{fetchImpl,onRetry}){
  let lastErr;
  for(const endpoint of ENDPOINTS){
    for(let attempt=0;attempt<5;attempt++){
      const url=`${endpoint}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${Math.floor(start)}&endTime=${Math.floor(end)}&limit=1000`;
      try{
        const r=await fetchImpl(url,{headers:{'user-agent':'ACHI-MERIDIAN-RETEST-HOLD/7.86'}});
        if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.status=r.status;throw e}
        const j=await r.json();if(!Array.isArray(j))throw new Error('Invalid kline response');
        return{json:j,endpoint};
      }catch(e){lastErr=e;onRetry?.({symbol,interval,endpoint,attempt:attempt+1,error:String(e.message||e)});if([403,451].includes(Number(e.status)))break;if(attempt<4)await sleep(Math.min(6000,400*2**attempt));}
    }
  }
  throw lastErr||new Error('Market source failed');
}

export async function fetchKlines(symbol,interval,start,end,{fetchImpl=globalThis.fetch,onRetry=()=>{}}={}){
  let cur=start,out=[],guard=0,lastEndpoint=null;
  while(cur<end&&guard++<1000){
    const p=await fetchPage(symbol,interval,cur,end,{fetchImpl,onRetry});lastEndpoint=p.endpoint;if(!p.json.length)break;
    const rows=p.json.map(k=>({openTime:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5],closeTime:+k[6]}));out.push(...rows);
    const next=rows.at(-1).openTime+MS[interval];if(next<=cur)break;cur=next;await sleep(60);
  }
  return{rows:[...new Map(out.map(x=>[x.openTime,x])).values()].sort((a,b)=>a.openTime-b.openTime),endpoint:lastEndpoint};
}

export async function loadRetestHoldMarket({assets,start,end,fetchImpl=globalThis.fetch,onProgress=()=>{}}={}){
  const market={},endpoints={};
  for(let i=0;i<assets.length;i++){
    const symbol=String(assets[i]).toUpperCase();onProgress({stage:'loading',symbol,index:i,total:assets.length});
    const opt={fetchImpl,onRetry:x=>onProgress({stage:'retry',...x})};
    const [m15,h1]=await Promise.all([fetchKlines(symbol,'15m',start,end,opt),fetchKlines(symbol,'1h',start,end,opt)]);
    market[symbol]={'15m':m15.rows,'1h':h1.rows};endpoints[symbol]={'15m':m15.endpoint,'1h':h1.endpoint};
  }
  return{market,endpoints};
}

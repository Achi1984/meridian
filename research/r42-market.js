import {POLICY} from './r42-ledger.js';
const DAY=86400000;
export const UNIVERSE=Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','LINKUSDT','AVAXUSDT','DOGEUSDT']);
const numeric=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
export function dailyHistory(rows,now){
  if(!Array.isArray(rows))return null;
  const closed=rows.filter(k=>numeric(k[6])&&Number(k[6])<now).slice(-32);
  if(closed.length<32||closed.some(k=>!numeric(k[4])||Number(k[4])<=0)||closed.some((k,i)=>i>0&&Number(k[0])-Number(closed[i-1][0])!==DAY)||now-Number(closed.at(-1)[6])>DAY)return null;
  return closed.map(k=>({at:Number(k[0]),close:Number(k[4])}));
}
export function betaToBtc(series,btc){
  if(!series||!btc||series.length!==btc.length||series.some((k,i)=>k.at!==btc[i].at))return null;
  const ret=a=>a.slice(1).map((x,i)=>Math.log(x.close/a[i].close));const x=ret(btc),y=ret(series),avg=a=>a.reduce((s,v)=>s+v,0)/a.length,mx=avg(x),my=avg(y);
  const variance=x.reduce((s,v)=>s+(v-mx)**2,0);return variance>0?x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0)/variance:null;
}
export function fundingHistory(rows,now,start){
  if(!Array.isArray(rows))return {rows:[],complete:false};
  const clean=rows.filter(r=>numeric(r.fundingTime)&&Number(r.fundingTime)>=start&&Number(r.fundingTime)<=now&&numeric(r.fundingRate)&&numeric(r.markPrice)&&Number(r.markPrice)>0).map(r=>({fundingTime:Number(r.fundingTime),fundingRate:Number(r.fundingRate),markPrice:Number(r.markPrice)})).sort((a,b)=>a.fundingTime-b.fundingTime);
  const unique=[...new Map(clean.map(r=>[r.fundingTime,r])).values()];
  const complete=rows.length<1000&&unique.length>=80&&unique[0].fundingTime-start<=12*3600000&&now-unique.at(-1).fundingTime<=12*3600000&&unique.every((r,i)=>!i||r.fundingTime-unique[i-1].fundingTime<=12*3600000);
  return {rows:unique,complete};
}
// Only public GET endpoints; concurrency limited to two assets.
export async function collectMarket(fetchJson,spotBase,perpBase,now=Date.now(),oldestOpen=now,clock=Date.now){
  const market={books:{},funding:{},momentum:[],carry:[],errors:[]},histories={},tickers={};
  const start=Math.min(now-30*DAY,oldestOpen);
  for(let i=0;i<UNIVERSE.length;i+=2)await Promise.all(UNIVERSE.slice(i,i+2).map(async symbol=>{
      const endpoints=['klines','ticker','funding'];
      const results=await Promise.allSettled([
        fetchJson(`${perpBase}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=34`),
        fetchJson(`${perpBase}/fapi/v1/ticker/24hr?symbol=${symbol}`),
        fetchJson(`${perpBase}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${start}&endTime=${now}&limit=1000`)
      ]);
      results.forEach((r,j)=>{if(r.status==='rejected')market.errors.push({symbol,endpoint:endpoints[j],reason:['TimeoutError','AbortError'].includes(r.reason?.name)?'TIMEOUT':'MARKET_REQUEST_FAILED'});});
      if(results[0].status==='fulfilled')histories[symbol]=dailyHistory(results[0].value,now);
      if(results[1].status==='fulfilled')tickers[symbol]=results[1].value;
      if(results[2].status==='fulfilled')market.funding[symbol]=fundingHistory(results[2].value,now,start);
  }));
  // Fetch executable quotes after slow history requests. Keep exchange timestamps;
  // never turn a future or old exchange quote into a current quote by clamping it.
  const books=await Promise.allSettled([
    fetchJson(`${spotBase}/api/v3/ticker/bookTicker`),
    fetchJson(`${perpBase}/fapi/v1/ticker/bookTicker`)
  ].map(async request=>({rows:await request,receivedAt:clock()})));
  books.forEach((result,i)=>{
    const venue=i===0?'spot':'perp';
    if(result.status==='rejected'||!Array.isArray(result.value.rows)){
      market.errors.push({endpoint:`${venue}_books`,reason:'BOOK_REQUEST_FAILED'});return;
    }
    for(const b of result.value.rows)if(UNIVERSE.includes(b.symbol))market.books[`${venue}:${b.symbol}`]={bid:Number(b.bidPrice),ask:Number(b.askPrice),at:i===0?result.value.receivedAt:Number(b.time)||0};
  });
  const quoteNow=clock();
  for(const symbol of UNIVERSE){
    const h=histories[symbol],q=market.books[`perp:${symbol}`],s=market.books[`spot:${symbol}`],f=market.funding[symbol],volume=Number(tickers[symbol]?.quoteVolume);
    if(!h||!q||!s||!f)continue;
    market.momentum.push({symbol,quoteAt:q.at,return30d:h.at(-1).close/h.at(-31).close-1,beta:betaToBtc(h,histories.BTCUSDT),quoteVolumeUsd:volume,historyComplete:true});
    const p30=f.rows.filter(r=>r.fundingTime>=now-30*DAY),p7=p30.filter(r=>r.fundingTime>=now-7*DAY),sum=a=>a.reduce((v,r)=>v+r.fundingRate,0),notional=POLICY.grossNotional/2;
    const positive=p30.length&&p30.filter(r=>r.fundingRate>0).length/p30.length>=.85;
    const basis=(q.bid-s.ask)/s.ask;
    const bookValid=[q,s].every(b=>b.bid>0&&b.ask>=b.bid&&b.at<=quoteNow&&quoteNow-b.at<=60000);
    const spreadCost=notional*((s.ask-s.bid)/s.ask+(q.ask-q.bid)/q.bid);
    market.carry.push({symbol,asOf:Math.min(q.at,s.at),completeFundingHistory:f.complete&&positive,executableQuotes:bookValid,basisWithinBand:basis>=-.001&&basis<=.0075,liquidityPassed:volume>=2e7,conservativeFundingUsd:notional*Math.min(sum(p30),sum(p7)*30/7),allInRoundTripCostsUsd:notional*4*(POLICY.feeBps+POLICY.slippageBps)/10000+spreadCost});
  }
  market.collectedAt=quoteNow;
  market.dataErrors=UNIVERSE.flatMap(symbol=>{
    const reasons=[];
    if(!histories[symbol])reasons.push('INCOMPLETE_DAILY_HISTORY');
    if(!market.funding[symbol]?.complete)reasons.push('INCOMPLETE_FUNDING_HISTORY');
    if(!Number.isFinite(Number(tickers[symbol]?.quoteVolume)))reasons.push('INVALID_VOLUME');
    if(!['spot','perp'].every(v=>{const b=market.books[`${v}:${symbol}`];return b&&b.bid>0&&b.ask>=b.bid&&b.at<=quoteNow&&quoteNow-b.at<=60000;}))reasons.push('INVALID_OR_STALE_BOOK');
    return reasons.map(reason=>({symbol,reason}));
  });
  return market;
}

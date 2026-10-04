import crypto from 'node:crypto';
export const EDGE_V1_SOURCE=Object.freeze({symbols:['BTCUSDT','ETHUSDT','SOLUSDT'],interval:'4h',intervalMs:14400000,start:'2021-01-01T00:00:00.000Z',end:'2026-09-30T23:59:59.999Z',market:'USD-M-PERPETUAL'});
export const EDGE_V1_FUNDING_MAX_GAP_MS=8*60*60*1000+1000;
const finite=x=>Number.isFinite(Number(x));
const canonicalBars=a=>(a||[]).map(x=>({openTime:+x.openTime,closeTime:+x.closeTime,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume})).sort((a,b)=>a.openTime-b.openTime);
const canonicalFunding=a=>(a||[]).map(x=>({time:+x.time,rate:+x.rate,markPrice:x.markPrice==null?null:+x.markPrice,rateType:x.rateType??null})).sort((a,b)=>a.time-b.time);
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function sourceReceipt({barsBySymbol={},fundingBySymbol={},provenance={}}={}){
 const out={schema:'PAPER-EDGE-V1-SOURCE-2',source:EDGE_V1_SOURCE,provenance,symbols:{}};
 for(const symbol of EDGE_V1_SOURCE.symbols){const bars=canonicalBars(barsBySymbol[symbol]),funding=canonicalFunding(fundingBySymbol[symbol]);out.symbols[symbol]={bars:bars.length,funding:funding.length,firstBar:bars[0]?.openTime??null,lastBar:bars.at(-1)?.closeTime??null,firstFunding:funding[0]?.time??null,lastFunding:funding.at(-1)?.time??null,digest:hash({bars,funding})};}
 out.digest=hash({source:EDGE_V1_SOURCE,provenance,symbols:out.symbols});return out;
}
export function validateSource({barsBySymbol={},fundingBySymbol={},provenance={}}={}){
 const start=Date.parse(EDGE_V1_SOURCE.start),end=Date.parse(EDGE_V1_SOURCE.end),step=EDGE_V1_SOURCE.intervalMs;
 if(provenance?.paginationComplete!==true)return{ok:false,reason:'PAGINATION_NOT_CERTIFIED'};
 for(const s of EDGE_V1_SOURCE.symbols){
  const raw=barsBySymbol[s]||[],rawFunding=fundingBySymbol[s]||[],bars=canonicalBars(raw),funding=canonicalFunding(rawFunding);
  if(!bars.length)return{ok:false,reason:'MISSING_BARS',symbol:s};
  if(new Set(bars.map(x=>x.openTime)).size!==bars.length)return{ok:false,reason:'DUPLICATE_BARS',symbol:s};
  if(raw.some((x,i)=>i>0&&Number(x.openTime)<Number(raw[i-1].openTime)))return{ok:false,reason:'UNORDERED_BARS',symbol:s};
  for(const b of bars){if(![b.openTime,b.closeTime,b.open,b.high,b.low,b.close,b.volume].every(finite)||b.openTime<start||b.closeTime>end||b.closeTime<=b.openTime)return{ok:false,reason:'INVALID_BAR',symbol:s};if(!(b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close,b.high)))return{ok:false,reason:'INVALID_OHLC',symbol:s};}
  for(let i=1;i<bars.length;i++)if(bars[i].openTime-bars[i-1].openTime!==step)return{ok:false,reason:'BAR_CADENCE_GAP',symbol:s,after:bars[i-1].openTime,before:bars[i].openTime};
  if(!funding.length)return{ok:false,reason:'MISSING_FUNDING',symbol:s};
  if(new Set(funding.map(x=>x.time)).size!==funding.length)return{ok:false,reason:'DUPLICATE_FUNDING',symbol:s};
  if(rawFunding.some((x,i)=>i>0&&Number(x.time)<Number(rawFunding[i-1].time)))return{ok:false,reason:'UNORDERED_FUNDING',symbol:s};
  if(funding.some(x=>!finite(x.time)||!finite(x.rate)||(x.markPrice!=null&&!finite(x.markPrice))||x.time<start||x.time>end))return{ok:false,reason:'INVALID_FUNDING',symbol:s};
  for(let i=1;i<funding.length;i++)if(funding[i].time-funding[i-1].time>EDGE_V1_FUNDING_MAX_GAP_MS)return{ok:false,reason:'FUNDING_CADENCE_GAP',symbol:s,after:funding[i-1].time,before:funding[i].time};
  if(provenance?.fundingComplete?.[s]!==true)return{ok:false,reason:'FUNDING_COVERAGE_NOT_CERTIFIED',symbol:s};
 }
 const starts=EDGE_V1_SOURCE.symbols.map(x=>canonicalBars(barsBySymbol[x])[0].openTime),ends=EDGE_V1_SOURCE.symbols.map(x=>canonicalBars(barsBySymbol[x]).at(-1).closeTime);const commonStart=Math.max(...starts),commonEnd=Math.min(...ends);if(!(commonStart<commonEnd))return{ok:false,reason:'NO_COMMON_TIME_OVERLAP'};
 return{ok:true,commonStart,commonEnd,receipt:sourceReceipt({barsBySymbol,fundingBySymbol,provenance})};
}

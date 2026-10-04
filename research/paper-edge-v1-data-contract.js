import crypto from 'node:crypto';
export const EDGE_V1_SOURCE={symbols:['BTCUSDT','ETHUSDT','SOLUSDT'],interval:'4h',start:'2021-01-01T00:00:00.000Z',end:'2026-09-30T23:59:59.999Z',market:'USD-M-PERPETUAL'};
const stable=x=>JSON.stringify(x,Object.keys(x).sort());
export function sourceReceipt({barsBySymbol={},fundingBySymbol={}}={}){
 const out={schema:'PAPER-EDGE-V1-SOURCE-1',source:EDGE_V1_SOURCE,symbols:{}};
 for(const symbol of EDGE_V1_SOURCE.symbols){
  const bars=barsBySymbol[symbol]||[],funding=fundingBySymbol[symbol]||[];
  out.symbols[symbol]={bars:bars.length,funding:funding.length,firstBar:bars[0]?.openTime??null,lastBar:bars.at(-1)?.closeTime??null,firstFunding:funding[0]?.time??null,lastFunding:funding.at(-1)?.time??null,digest:crypto.createHash('sha256').update(JSON.stringify({bars,funding})).digest('hex')};
 }
 out.digest=crypto.createHash('sha256').update(JSON.stringify(out.symbols)).digest('hex');return out;
}
export function validateSource({barsBySymbol={},fundingBySymbol={}}={}){
 const start=Date.parse(EDGE_V1_SOURCE.start),end=Date.parse(EDGE_V1_SOURCE.end);
 for(const s of EDGE_V1_SOURCE.symbols){
  const bars=barsBySymbol[s]||[],funding=fundingBySymbol[s]||[];
  if(!bars.length)return{ok:false,reason:'MISSING_BARS',symbol:s};
  const times=bars.map(x=>Number(x.openTime));if(new Set(times).size!==times.length)return{ok:false,reason:'DUPLICATE_BARS',symbol:s};
  if(bars.some(x=>!Number.isFinite(Number(x.openTime))||!Number.isFinite(Number(x.closeTime))||Number(x.openTime)<start||Number(x.closeTime)>end))return{ok:false,reason:'INVALID_BAR_WINDOW',symbol:s};
  if(!funding.length)return{ok:false,reason:'MISSING_FUNDING',symbol:s};
  const ft=funding.map(x=>Number(x.time));if(new Set(ft).size!==ft.length)return{ok:false,reason:'DUPLICATE_FUNDING',symbol:s};
 }
 return{ok:true,receipt:sourceReceipt({barsBySymbol,fundingBySymbol})};
}

import {validateLedgerManualSnapshot} from '../ledger-manual-snapshot.js';
export function buildLedgerManualModel(snapshot,{tickers,pricesAt,now=Date.now()}={}){
  const clean=validateLedgerManualSnapshot(snapshot,{now});if(!clean)return null;
  const age=now-pricesAt,priceFresh=Number.isSafeInteger(pricesAt)&&age>=0&&age<=180000;
  const prices=new Map();
  if(priceFresh&&Array.isArray(tickers)&&tickers.length<=10000){
    for(const row of tickers){
      if(typeof row?.symbol!=='string'||prices.has(row.symbol)){prices.clear();break;}
      const price=typeof row.price==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(row.price)?Number(row.price):NaN;
      prices.set(row.symbol,Number.isFinite(price)&&price>0?price:null);
    }
  }
  const holdings=clean.holdings.map(h=>{
    const quantity=Number(h.quantity),price=prices.get(h.symbol+'USDT')??null;
    const value=quantity===0?0:price===null?null:quantity*price;
    return {...h,price,value:Number.isFinite(value)?value:null};
  });
  const complete=holdings.every(h=>h.value!==null),sum=complete?holdings.reduce((a,h)=>a+h.value,0):null;
  return {...clean,holdings,valuationCurrency:'USDT',total:complete&&Number.isFinite(sum)?sum:null,
    priceSource:'BINANCE_PUBLIC_SPOT_USDT',pricesAt:priceFresh?new Date(pricesAt).toISOString():null,
    priceExpiresAt:priceFresh?pricesAt+180000:null,quantityAgeMs:now-Date.parse(clean.observedAt)};
}
export function parseLedgerManualText(text,observedAt){
  if(typeof text!=='string'||text.length>16000)return null;
  const holdings=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{
    const parts=line.split(';').map(x=>x.trim());
    return parts.length===2?{symbol:parts[0].toUpperCase(),quantity:parts[1].replace(',','.')}:null;
  });
  return validateLedgerManualSnapshot({source:'USER_MANUAL_SNAPSHOT',observedAt,holdings});
}

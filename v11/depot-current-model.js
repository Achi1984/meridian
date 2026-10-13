import {canonicalPortfolioSnapshot,authoritativePionexEquitySnapshot} from '../portfolio-data-contract.js';
import {buildLivePriceOverlay} from '../v8-clean/live-price-core-r18.js';

// Current server-held authority only. No local references, history fallback or bot capital.
const DAY=86400000,PIONEX_AGE=900000,PRICE_AGE=180000;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const decimal=x=>typeof x==='number'?x:typeof x==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(x)?Number(x):NaN;
const amount=x=>Number.isFinite(decimal(x))&&decimal(x)>=0;
const missing=x=>x===null||x===undefined||x==='';
function need(ok,code='INVALID_CURRENT_SOURCE'){if(!ok)throw new Error(code);}
function stamp(value,now){
  let time;
  if(Number.isSafeInteger(value)&&value>0)time=value;
  else{
    const match=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
    need(match);
    const [,year,month,day,hour,minute,second,fraction,,sign,offsetHour,offsetMinute]=match;
    const parts=[year,month,day,hour,minute,second].map(Number),[y,m,d,h,min,s]=parts;
    need(m>=1&&m<=12&&d>=1&&d<=31&&h<=23&&min<=59&&s<=59);
    const wall=Date.UTC(y,m-1,d,h,min,s,Number((fraction||'').padEnd(3,'0').slice(0,3)));
    const date=new Date(wall);
    need(date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d);
    const oh=Number(offsetHour||0),om=Number(offsetMinute||0);need(oh<=23&&om<=59);
    time=wall-(sign==='-'?-1:1)*(oh*60+om)*60000;
    need(Number.isSafeInteger(time)&&time>0);
  }
  need(time<=now&&time<=8640000000000000);
  return time;
}
const iso=time=>new Date(time).toISOString();
function source(value,fallback){
  if(missing(value))return fallback;
  need(typeof value==='string'&&/^[A-Z0-9_]{1,80}$/.test(value)&&!['MISSING','MISSING_OR_STALE','FALLBACK_SCREENSHOT'].includes(value));
  return value;
}
export function buildCurrentDepotModel(payload,{tickers,tickersAt,now=Date.now()}={}){
  const empty={status:'UNKNOWN',readOnly:true,executionAllowed:false,totalUsd:null,spotUsd:null,tradingUsd:null,
    snapshotAt:null,sourceAt:null,source:null,expiresAt:null,excludedIncompletePoints:0};
  try{
    need(Number.isSafeInteger(now)&&now>0&&now<=8640000000000000);
    need(object(payload)&&payload.private===true&&object(payload.data)&&object(payload.data.portfolio));
    const data=payload.data,p=data.portfolio;
    const rows=missing(p.manualVenueBalances)?[]:p.manualVenueBalances;
    need(Array.isArray(rows)&&rows.length<=100);
    const normalized=rows.map(row=>{
      need(object(row));
      const venue=row.venue??row.name;
      need(typeof venue==='string'&&/^[A-Za-z0-9 _-]{1,40}$/.test(venue)&&venue.trim());
      const value=row.valueUsd??row.value??row.totalUsd??row.equityUsd;
      need(amount(value));
      const time=stamp(row.updatedAt??row.snapshotAt??row.asOf,now);
      return {venue:venue.trim(),valueUsd:decimal(value),updatedAt:iso(time),source:source(row.source,'PRIVATE_VENUE_BALANCE')};
    });
    const holdings=missing(p.holdings)?[]:p.holdings;
    need(Array.isArray(holdings)&&holdings.length<=1000);
    const ledger=[];
    for(const h of holdings){
      need(object(h));
      if(typeof h.venue!=='string'||h.venue.trim().toLowerCase()!=='ledger')continue;
      need(amount(h.quantity)&&typeof h.symbol==='string'&&/^[A-Z0-9._-]{1,20}$/.test(h.symbol));
      if(decimal(h.quantity)>0)ledger.push({venue:'Ledger',symbol:h.symbol,quantity:decimal(h.quantity)});
    }
    const authority=missing(p.ledgerAuthorityAt)?null:stamp(p.ledgerAuthorityAt,now);
    const ledgerActive=authority!==null&&now-authority<=DAY&&ledger.length>0;
    const usedHoldings=ledgerActive?ledger.map(h=>({...h,updatedAt:iso(authority)})):[];
    const balances=ledgerActive?normalized.filter(r=>r.venue.toLowerCase()!=='ledger'):normalized;
    const portfolio={holdings:usedHoldings,manualVenueBalances:balances,authorityMode:'STRICT_VENUE_SNAPSHOT',
      externalVenueSnapshotComplete:true,externalVenueExpectedVenues:ledgerActive?['OKX']:['Ledger','OKX'],
      requiredHoldingVenues:ledgerActive?['Ledger']:[]};
    if(!missing(p.pionexEquityUsd)){
      need(amount(p.pionexEquityUsd));
      portfolio.pionexEquityUsd=decimal(p.pionexEquityUsd);
      portfolio.pionexEquityUpdatedAt=iso(stamp(p.pionexEquityUpdatedAt,now));
      portfolio.pionexEquitySource=source(p.pionexEquitySource,'PRIVATE_PORTFOLIO_SNAPSHOT');
    }
    let account;
    if(data.pionexAccount?.walletStatus==='OK'&&data.pionexAccountSync?.status==='OK'){
      need(object(data.pionexAccount.wallet)&&amount(data.pionexAccount.wallet.totalInUsdt));
      account={walletStatus:'OK',updatedAt:iso(stamp(data.pionexAccount.updatedAt??data.pionexAccount.snapshotAt,now)),
        wallet:{totalInUsdt:decimal(data.pionexAccount.wallet.totalInUsdt)}};
    }
    let selected={portfolio,pionexAccount:account,pionexAccountSync:account?{status:'OK'}:undefined};
    const pionex=authoritativePionexEquitySnapshot(selected,now);
    if(!pionex.found){
      const stale=pionex.reason==='WALLET_STALE_OR_UNTIMED'||pionex.reason==='PRIVATE_STALE_OR_UNTIMED';
      need(false,stale?'STALE':'CURRENT_SOURCE_INCOMPLETE');
    }
    const pionexTime=stamp(pionex.updatedAt,now);
    // Replace the direct candidate with the actual authoritative choice before summing.
    selected.portfolio={...portfolio,pionexEquityUsd:pionex.value,pionexEquitySource:pionex.source,pionexEquityUpdatedAt:iso(pionexTime)};
    let priceTime=null;
    if(ledgerActive){
      priceTime=stamp(tickersAt,now);need(now-priceTime<=PRICE_AGE,'STALE');
      need(Array.isArray(tickers)&&tickers.length>0&&tickers.length<=10000);
      const seen=new Set(),clean=[];
      for(const row of tickers){
        need(object(row)&&typeof row.symbol==='string'&&/^[A-Z0-9]{2,40}$/.test(row.symbol)&&!seen.has(row.symbol));
        seen.add(row.symbol);
        const raw=row.price;
        need(typeof raw==='number'||typeof raw==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw));
        const price=Number(raw);need(Number.isFinite(price)&&price>=0);
        clean.push({symbol:row.symbol,price});
      }
      selected=buildLivePriceOverlay(selected,clean,priceTime);
    }
    const snapshot=canonicalPortfolioSnapshot(selected,now);
    const spot=snapshot.spotAuthority;
    if(spot.complete!==true){
      const old=balances.some(r=>r.venue.toLowerCase()!=='pionex'&&now-Date.parse(r.updatedAt)>DAY)||authority!==null&&now-authority>DAY;
      need(false,old?'STALE':'CURRENT_SOURCE_INCOMPLETE');
    }
    need([snapshot.totalUsd,snapshot.spotUsd,snapshot.tradingUsd].every(amount)&&
      Number.isFinite(snapshot.spotUsd+snapshot.tradingUsd)&&Math.abs(snapshot.totalUsd-snapshot.spotUsd-snapshot.tradingUsd)<=1);
    const spotTimes=spot.externalRows.map(r=>stamp(r.updatedAt,now));
    if(ledgerActive)spotTimes.push(authority);
    need(spotTimes.length>0);
    const times=[...spotTimes,pionexTime,...(priceTime===null?[]:[priceTime])];
    const expiresAt=Math.min(...spotTimes.map(t=>t+DAY),pionexTime+PIONEX_AGE,...(priceTime===null?[]:[priceTime+PRICE_AGE]));
    return {...empty,status:'FRESH_SNAPSHOT',totalUsd:snapshot.totalUsd,spotUsd:snapshot.spotUsd,
      tradingUsd:snapshot.tradingUsd,snapshotAt:iso(Math.min(...times)),sourceAt:iso(pionexTime),
      source:'SERVER_PORTFOLIO_CURRENT',expiresAt};
  }catch(error){
    return {...empty,status:error?.message==='STALE'?'STALE':'UNKNOWN',
      reason:error?.message==='STALE'?'SOURCE_EXPIRED':'CURRENT_SOURCE_INCOMPLETE'};
  }
}

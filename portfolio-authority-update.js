// MERIDIAN v10 r94 — limited portfolio reconciliation authority.
// Pure helpers: only refresh Ledger holding authority timestamps or upsert one OKX USD venue reference.

const clone=x=>JSON.parse(JSON.stringify(x));
const clean=x=>String(x||'').trim();
const num=x=>x===null||x===undefined||x===''?null:(Number.isFinite(Number(x))?Number(x):null);

export function reconcilePortfolioAuthority(current={},body={},opts={}){
  const action=clean(body?.action).toLowerCase(),now=String(opts.now||new Date().toISOString()),next=clone(current||{});
  next.portfolio=next.portfolio&&typeof next.portfolio==='object'&&!Array.isArray(next.portfolio)?next.portfolio:{};
  const currentRevision=Number.isInteger(next.privateRevision)?next.privateRevision:0;

  if(action==='confirm_ledger'){
    const holdings=Array.isArray(next.portfolio.holdings)?next.portfolio.holdings:[];
    const ledgerIndexes=holdings.map((h,i)=>[h,i]).filter(([h])=>clean(h?.venue).toLowerCase()==='ledger'&&num(h?.quantity)!=null&&num(h.quantity)>0).map(([,i])=>i);
    if(!ledgerIndexes.length)return{ok:false,error:'ledger_holdings_missing',currentRevision};
    for(const i of ledgerIndexes){
      holdings[i]={...holdings[i],updatedAt:now,authoritySource:'USER_CONFIRMED_PORTFOLIO_AUTHORITY'};
    }
    next.portfolio.holdings=holdings;
    next.portfolio.ledgerAuthorityAt=now;
    next.portfolio.ledgerAuthoritySource='USER_CONFIRMED_PORTFOLIO_AUTHORITY';
    next.privateUpdateSource='portfolio_authority_ledger_confirmation';
  }else if(action==='set_okx'){
    const valueUsd=num(body?.valueUsd);
    if(valueUsd==null||valueUsd<0)return{ok:false,error:'invalid_okx_value',currentRevision};
    const rows=Array.isArray(next.portfolio.manualVenueBalances)?next.portfolio.manualVenueBalances:[];
    const kept=rows.filter(x=>clean(x?.venue||x?.name).toLowerCase()!=='okx');
    next.portfolio.manualVenueBalances=[...kept,{venue:'OKX',valueUsd,value:valueUsd,updatedAt:now,source:'USER_CONFIRMED_PORTFOLIO_AUTHORITY'}];
    next.portfolio.okxAuthorityAt=now;
    next.portfolio.okxAuthoritySource='USER_CONFIRMED_PORTFOLIO_AUTHORITY';
    next.privateUpdateSource='portfolio_authority_okx_reference';
  }else{
    return{ok:false,error:'invalid_portfolio_authority_action',currentRevision};
  }

  next.privateStorageVersion=String(next.privateStorageVersion||'1');
  next.privateRevision=currentRevision+1;
  next.privateUpdatedAt=now;
  return{
    ok:true,
    data:next,
    currentRevision,
    nextRevision:next.privateRevision,
    action,
    updatedAt:now,
    ledgerHoldingCount:Array.isArray(next.portfolio.holdings)?next.portfolio.holdings.filter(h=>clean(h?.venue).toLowerCase()==='ledger'&&num(h?.quantity)>0).length:0,
    okxValueUsd:action==='set_okx'?num(body?.valueUsd):null
  };
}


export function upsertOkxPortfolioAuthority(current={},valueUsd,opts={}){
  const value=num(valueUsd),now=String(opts.now||new Date().toISOString()),source=clean(opts.source)||'OKX_PORTFOLIO_AUTHORITY',privateUpdateSource=clean(opts.privateUpdateSource)||'portfolio_authority_okx_sync',next=clone(current||{});
  next.portfolio=next.portfolio&&typeof next.portfolio==='object'&&!Array.isArray(next.portfolio)?next.portfolio:{};
  const currentRevision=Number.isInteger(next.privateRevision)?next.privateRevision:0;
  if(value==null||value<0)return{ok:false,error:'invalid_okx_value',currentRevision};
  const sourceTs=Date.parse(now);
  if(!Number.isFinite(sourceTs))return{ok:false,error:'invalid_okx_timestamp',currentRevision};
  const rows=Array.isArray(next.portfolio.manualVenueBalances)?next.portfolio.manualVenueBalances:[],existing=rows.filter(x=>clean(x?.venue||x?.name).toLowerCase()==='okx').sort((a,b)=>Date.parse(String(b?.updatedAt||''))-Date.parse(String(a?.updatedAt||'')))[0]||null,existingTs=Date.parse(String(existing?.updatedAt||''));
  if(Number.isFinite(existingTs)&&existingTs>sourceTs){
    return{ok:true,changed:false,reason:'existing_okx_authority_newer',data:next,currentRevision,nextRevision:currentRevision,updatedAt:existing.updatedAt||null,okxValueUsd:num(existing?.valueUsd??existing?.value),source:String(existing?.source||'UNKNOWN')};
  }
  const kept=rows.filter(x=>clean(x?.venue||x?.name).toLowerCase()!=='okx');
  next.portfolio.manualVenueBalances=[...kept,{venue:'OKX',valueUsd:value,value,updatedAt:now,source}];
  next.portfolio.okxAuthorityAt=now;
  next.portfolio.okxAuthoritySource=source;
  next.privateUpdateSource=privateUpdateSource;
  next.privateStorageVersion=String(next.privateStorageVersion||'1');
  next.privateRevision=currentRevision+1;
  next.privateUpdatedAt=now;
  return{ok:true,changed:true,data:next,currentRevision,nextRevision:next.privateRevision,updatedAt:now,okxValueUsd:value,source};
}

export function portfolioAuthorityReceipt(result={},history=null){
  return{
    ok:true,
    action:result.action,
    revision:result.nextRevision,
    previousRevision:result.currentRevision,
    updatedAt:result.updatedAt,
    ledgerHoldingCount:result.ledgerHoldingCount,
    okxValueUsd:result.okxValueUsd,
    historyCaptured:history?.inserted===true,
    historyReason:history?.reason||null
  };
}

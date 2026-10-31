// Shared bounded projection: no valuation, timestamps or credentials.
export function ledgerReviewHoldings(data){
  const rows=data?.portfolio?.holdings;
  if(!Array.isArray(rows)||rows.length>1000)return null;
  const result=[];
  for(const row of rows){
    if(!row||typeof row!=='object')return null;
    if(typeof row.venue!=='string'||row.venue.trim().toLowerCase()!=='ledger')continue;
    const q=row.quantity;
    if(typeof row.symbol!=='string'||!/^[A-Z0-9._-]{1,20}$/.test(row.symbol)||
      !((typeof q==='number'&&Number.isFinite(q))||(typeof q==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(q)))||!Number.isFinite(Number(q))||Number(q)<0)return null;
    if(Number(q)>0)result.push({symbol:row.symbol,quantity:q});
  }
  if(!result.length||result.length>100)return null;
  return result.sort((a,b)=>a.symbol.localeCompare(b.symbol)||String(a.quantity).localeCompare(String(b.quantity)));
}

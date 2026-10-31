import {ledgerReviewHoldings} from './v11/ledger-review-model.js';
import {reconcilePortfolioAuthority} from './portfolio-authority-update.js';

// The expected full JSONB document prevents a concurrent writer from being
// silently overwritten between the read, review comparison and update.
export async function confirmReviewedLedger({db,key,current,body,now}){
  const actual=ledgerReviewHoldings(current);
  if(!actual)return {ok:false,status:400,error:'ledger_holdings_invalid'};
  if(!Array.isArray(body?.reviewedHoldings)||
    JSON.stringify(actual)!==JSON.stringify(body.reviewedHoldings))
    return {ok:false,status:409,error:'ledger_review_changed'};
  const merged=reconcilePortfolioAuthority(current,{action:'confirm_ledger'},{now});
  if(!merged.ok)return {...merged,status:400};
  const result=await db.query(
    'UPDATE meridian_state SET value=$2::jsonb,updated_at=now() WHERE key=$1 AND value=$3::jsonb RETURNING key',
    [key,JSON.stringify(merged.data),JSON.stringify(current)]);
  if(result.rowCount!==1)return {ok:false,status:409,error:'ledger_review_changed'};
  return {...merged,action:'confirm_ledger_reviewed'};
}

// Cost-aware sizing for new Paper entries. No orders, state writes or resets.
export const PAPER_COST_POLICY='R31-COST-BUDGET-V1';
export function costAwareSize({entry,sl,side,equity,riskPct,feeBps=5,slippageBps=3,tp1=null}){
  if(![entry,sl,equity,riskPct,feeBps,slippageBps].every(Number.isFinite)||
    !['LONG','SHORT'].includes(side)||entry<=0||sl<=0||equity<=0||riskPct<=0||riskPct>100||feeBps<0||slippageBps<0||slippageBps>=10000||
    (side==='LONG'?sl>=entry:sl<=entry))throw new Error('INVALID_COST_SIZING_INPUT');
  const direction=side==='LONG'?1:-1;
  const expectedStopFill=sl*(1-direction*slippageBps/10000);
  const priceLossPerUnit=(entry-expectedStopFill)*direction;
  const feesPerUnit=(entry+expectedStopFill)*feeBps/10000;
  const plannedRiskBudgetUsd=equity*riskPct/100;
  const qty=plannedRiskBudgetUsd/(priceLossPerUnit+feesPerUnit);
  if(!Number.isFinite(qty)||qty<=0)throw new Error('INVALID_COST_POSITION_SIZE');
  const expectedTargetFill=Number.isFinite(tp1)&&tp1>0?tp1*(1-direction*slippageBps/10000):null;
  const expectedTargetNetUsd=expectedTargetFill==null?null:qty*((expectedTargetFill-entry)*direction-(entry+expectedTargetFill)*feeBps/10000);
  return {qty,plannedRiskBudgetUsd,expectedStopFill,plannedStopLossUsd:qty*priceLossPerUnit,plannedFeesAtStopUsd:qty*feesPerUnit,expectedTargetNetUsd,executionPolicyVersion:PAPER_COST_POLICY};
}

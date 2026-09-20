/**
 * Conservative isolated-long liquidation approximation for research.
 * This is NOT exchange liquidation parity; venue maintenance tiers differ.
 */
export function approxLongLiquidation(entry, leverage, maintenanceMarginRate=0.005){
  if(!entry||leverage<=1)return 0;
  return entry*Math.max(0,1-(1/leverage)+maintenanceMarginRate);
}
export function liquidationTouched(candle,liq){return liq>0&&candle.low<=liq;}

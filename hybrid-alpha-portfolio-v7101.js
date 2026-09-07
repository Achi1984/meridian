// MERIDIAN v7.101 — simultaneous portfolio risk budget.
// RESEARCH ONLY. No outcome, ranking or trade blocking.
export const HYBRID_ALPHA_V7101_PORTFOLIO=Object.freeze({bundleRiskBudget:1});
const round=(v,d=6)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
export function applyPortfolioBudget(rows=[],config=HYBRID_ALPHA_V7101_PORTFOLIO){
  const bundles=new Map();for(const row of rows){const key=String(row.timestamp);if(!bundles.has(key))bundles.set(key,[]);bundles.get(key).push(row)}
  return rows.map(row=>{const bundle=bundles.get(String(row.timestamp)),incoming=bundle.reduce((a,x)=>a+Math.max(0,Number(x.riskMultiplier)||0),0),scale=incoming>config.bundleRiskBudget?config.bundleRiskBudget/incoming:1,outgoing=incoming*scale;return {...row,riskMultiplier:round(Number(row.riskMultiplier)*scale,3),grossR:round(Number(row.grossR)*scale,3),costR:round(Number(row.costR)*scale,3),netR:round(Number(row.netR)*scale,3),portfolioBundleSize:bundle.length,portfolioIncomingRisk:round(incoming),portfolioOutgoingRisk:round(outgoing),portfolioRiskScale:round(scale),portfolioScaled:scale<1}});
}

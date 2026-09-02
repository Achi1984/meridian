// MERIDIAN v7.68 — portfolio risk sensitivity for frozen Challenger V3.2
// Research-only. No UI, Paper execution, signal score, sizing or runtime changes.
import { replayPortfolioPath } from './portfolio-path-v767.js';

const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
export const V768_RISK_LEVELS=Object.freeze([0.25,0.5,0.75,1]);

function one(rows,riskPerTradePct,{disableDrawdown=false}={}){
  const config={riskPerTradePct};
  if(disableDrawdown)config.maxDrawdownPct=Number.POSITIVE_INFINITY;
  return replayPortfolioPath(rows,{config});
}

export function runRiskSensitivity(rows=[],options={}){
  const levels=Array.isArray(options.riskLevels)&&options.riskLevels.length?options.riskLevels:V768_RISK_LEVELS;
  const variants={};
  for(const risk of levels){
    const k=`risk_${Number(risk).toFixed(2)}`;
    variants[k]=one(rows,Number(risk));
  }
  const diagnosticNoDd=one(rows,Number(options.diagnosticRiskPct||1),{disableDrawdown:true});
  const compact=Object.fromEntries(Object.entries(variants).map(([k,r])=>[k,{
    riskPerTradePct:r.config.riskPerTradePct,
    baseline:r.baseline,
    challengerV32:r.challengerV32,
    opportunity:r.opportunity,
    comparison:r.comparison
  }]));
  const bestByEndEquity=Object.entries(compact).slice().sort((a,b)=>(b[1].challengerV32.endEquity??-Infinity)-(a[1].challengerV32.endEquity??-Infinity))[0]?.[0]||null;
  const bestByDdAdjusted=Object.entries(compact).map(([k,v])=>{
    const ret=Number(v.challengerV32.returnPct||0),dd=Number(v.challengerV32.maxDrawdownPct||0);
    return [k,dd>0?ret/dd:ret>0?99:0];
  }).sort((a,b)=>b[1]-a[1])[0]||[null,null];
  return {
    schemaVersion:'7.68-RISK-SENSITIVITY-V1',researchOnly:true,executionImpact:false,
    scorerFrozen:true,scoreVersion:'7.66-CHALLENGER-V3.2',
    method:'same chronological cohort and portfolio gates as v7.67; only riskPerTradePct varies; diagnostic run disables max-drawdown shutdown without changing entry ranking',
    variants:compact,
    diagnosticNoDrawdown:{riskPerTradePct:diagnosticNoDd.config.riskPerTradePct,baseline:diagnosticNoDd.baseline,challengerV32:diagnosticNoDd.challengerV32,opportunity:diagnosticNoDd.opportunity,comparison:diagnosticNoDd.comparison},
    summary:{bestByEndEquity,bestByDdAdjusted:bestByDdAdjusted[0],bestDdAdjustedRatio:round(bestByDdAdjusted[1],3)}
  };
}

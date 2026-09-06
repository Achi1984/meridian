// MERIDIAN v7.97 — Low-Liquidity Risk Attenuation.
// RESEARCH ONLY. Predeclared from v7.95 attribution: liquidityQuality <0.50 gets 0.60x risk.
// Builds on frozen v7.96; no trade is blocked and side selection is unchanged.
import {hybridAlphaWeakDecision} from './hybrid-alpha-weak-v796.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const LOW_LIQUIDITY_THRESHOLD=0.50;
const LOW_LIQUIDITY_FACTOR=0.60;

export function hybridAlphaLiquidityDecision(evidence={}){
  const base=hybridAlphaWeakDecision(evidence);
  const raw=Number(evidence?.liquidityQuality);
  const liquidityQuality=Number.isFinite(raw)?clamp(raw,0,1):1;
  if(base.side==='OBSERVE')return {
    ...base,
    schemaVersion:'7.97-HYBRID-LOW-LIQUIDITY-V1',
    liquidityQuality:Number(liquidityQuality.toFixed(3)),
    lowLiquidityRiskFactor:1,
    liquidityBand:liquidityQuality<LOW_LIQUIDITY_THRESHOLD?'LOW':'OK'
  };
  const applies=liquidityQuality<LOW_LIQUIDITY_THRESHOLD;
  const lowLiquidityRiskFactor=applies?LOW_LIQUIDITY_FACTOR:1;
  const riskMultiplier=clamp(base.riskMultiplier*lowLiquidityRiskFactor,.01,base.riskMultiplier);
  return {
    ...base,
    schemaVersion:'7.97-HYBRID-LOW-LIQUIDITY-V1',
    liquidityQuality:Number(liquidityQuality.toFixed(3)),
    lowLiquidityRiskFactor,
    liquidityBand:applies?'LOW':'OK',
    riskMultiplier:Number(riskMultiplier.toFixed(3)),
    researchOnly:true,
    executionImpact:false
  };
}

export const HYBRID_ALPHA_V797_LOW_LIQUIDITY=Object.freeze({threshold:LOW_LIQUIDITY_THRESHOLD,factor:LOW_LIQUIDITY_FACTOR});

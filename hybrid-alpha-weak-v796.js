// MERIDIAN v7.96 — Weak Alpha Risk Attenuation.
// RESEARCH ONLY. Predeclared after v7.95 attribution: weak alpha (|alpha| 0.20–0.35) gets 0.60x risk.
// No trade is blocked; trade count and side selection are unchanged.
import {hybridAlphaTransitionDecision} from './hybrid-alpha-transition-v793.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const WEAK_ALPHA_MIN=0.20;
const WEAK_ALPHA_MAX=0.35;
const WEAK_ALPHA_FACTOR=0.60;

export function hybridAlphaWeakDecision(evidence={}){
  const base=hybridAlphaTransitionDecision(evidence);
  if(base.side==='OBSERVE')return {...base,schemaVersion:'7.96-HYBRID-WEAK-ALPHA-V1',weakAlphaRiskFactor:1};
  const magnitude=Math.abs(Number(base.alpha)||0);
  const applies=magnitude>=WEAK_ALPHA_MIN&&magnitude<WEAK_ALPHA_MAX;
  const weakAlphaRiskFactor=applies?WEAK_ALPHA_FACTOR:1;
  const riskMultiplier=clamp(base.riskMultiplier*weakAlphaRiskFactor,.01,base.riskMultiplier);
  return {
    ...base,
    schemaVersion:'7.96-HYBRID-WEAK-ALPHA-V1',
    weakAlphaRiskFactor,
    weakAlphaBand:applies?'WEAK':'OTHER',
    riskMultiplier:Number(riskMultiplier.toFixed(3)),
    researchOnly:true,
    executionImpact:false
  };
}

export const HYBRID_ALPHA_V796_WEAK_ALPHA=Object.freeze({min:WEAK_ALPHA_MIN,max:WEAK_ALPHA_MAX,factor:WEAK_ALPHA_FACTOR});

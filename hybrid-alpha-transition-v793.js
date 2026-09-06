// MERIDIAN v7.93 — Transition Side Asymmetry overlay.
// RESEARCH ONLY. Narrow predeclared hypothesis: attenuate SHORT risk in TRANSITION only.
import {hybridAlphaMacroDecision} from './hybrid-alpha-macro-v792.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const TRANSITION_SHORT_FACTOR=0.60;

export function hybridAlphaTransitionDecision(evidence={}){
  const base=hybridAlphaMacroDecision(evidence);
  if(base.side==='OBSERVE')return {...base,schemaVersion:'7.93-HYBRID-TRANSITION-V1',transitionRiskFactor:1};
  const applies=base.regime==='TRANSITION'&&base.side==='SHORT';
  const transitionRiskFactor=applies?TRANSITION_SHORT_FACTOR:1;
  const riskMultiplier=clamp(base.riskMultiplier*transitionRiskFactor,.01,base.riskMultiplier);
  return {...base,schemaVersion:'7.93-HYBRID-TRANSITION-V1',transitionRiskFactor,riskMultiplier:Number(riskMultiplier.toFixed(3)),researchOnly:true,executionImpact:false};
}

export const HYBRID_ALPHA_V793_TRANSITION_SHORT_FACTOR=TRANSITION_SHORT_FACTOR;

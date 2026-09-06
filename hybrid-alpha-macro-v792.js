// MERIDIAN v7.92 — Macro Trend Overlay for Hybrid Alpha V1.
// RESEARCH ONLY. Slow directional context may only reduce opposing-side risk.
import {hybridAlphaDecision} from './hybrid-alpha-v1.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const num=v=>Number.isFinite(Number(v))?Number(v):null;

export function hybridAlphaMacroDecision(evidence={}){
  const base=hybridAlphaDecision(evidence);
  const macroTrend=clamp(num(evidence.macroTrend)??0,-1,1);
  if(base.side==='OBSERVE')return {...base,schemaVersion:'7.92-HYBRID-MACRO-V1',macroTrend,macroAlignment:0,macroRiskFactor:1};
  const direction=base.side==='LONG'?1:-1;
  const alignment=direction*macroTrend;
  // Only opposing slow trend attenuates risk. Aligned/neutral macro never increases V1 risk.
  const macroRiskFactor=alignment>=0?1:clamp(1/(1+Math.abs(alignment)),.5,1);
  return {...base,schemaVersion:'7.92-HYBRID-MACRO-V1',macroTrend:Number(macroTrend.toFixed(3)),macroAlignment:Number(alignment.toFixed(3)),macroRiskFactor:Number(macroRiskFactor.toFixed(3)),riskMultiplier:Number((base.riskMultiplier*macroRiskFactor).toFixed(3)),researchOnly:true,executionImpact:false};
}

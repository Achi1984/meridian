// MERIDIAN v7.89 — Hybrid Alpha V1
// RESEARCH ONLY. Pure scoring/router prototype. No order placement, sizing mutation or execution hooks.
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const signed=v=>num(v)==null?null:clamp(Number(v),-1,1);

const WEIGHTS={
  BULL:{trend:.34,momentum:.24,relativeStrength:.16,meanReversion:.06,carry:.08,orderFlow:.12},
  BEAR:{trend:.36,momentum:.22,relativeStrength:.10,meanReversion:.06,carry:.10,orderFlow:.16},
  RANGE:{trend:.16,momentum:.12,relativeStrength:.10,meanReversion:.34,carry:.10,orderFlow:.18},
  TRANSITION:{trend:.26,momentum:.18,relativeStrength:.12,meanReversion:.18,carry:.08,orderFlow:.18}
};

function regimeKey(raw){
  const r=String(raw||'TRANSITION').toUpperCase();
  if(/BULL|RISK-ON|TREND_UP/.test(r))return 'BULL';
  if(/BEAR|RISK-OFF|TREND_DOWN/.test(r))return 'BEAR';
  if(/RANGE|SIDEWAYS|CHOP/.test(r))return 'RANGE';
  return 'TRANSITION';
}

function normalizedBlend(evidence,weights){
  let total=0,den=0,count=0,positive=0,negative=0;
  const components={};
  for(const [key,w] of Object.entries(weights)){
    const x=signed(evidence?.[key]);
    if(x==null)continue;
    const contribution=x*w;
    components[key]={score:x,weight:w,contribution};
    total+=contribution;den+=w;count++;
    if(x>0.15)positive++;else if(x<-.15)negative++;
  }
  const alpha=den>0?total/den:0;
  const agreement=count?Math.max(positive,negative)/count:0;
  return {alpha,agreement,evidenceCount:count,components};
}

export function hybridAlphaDecision(evidence={}){
  const regime=regimeKey(evidence.regime);
  const weights=WEIGHTS[regime];
  const blend=normalizedBlend(evidence,weights);
  const reversalRisk=clamp(num(evidence.reversalRisk)??0,0,1);
  const volRatio=clamp(num(evidence.volatilityRatio)??1,.25,4);
  const liquidityQuality=clamp(num(evidence.liquidityQuality)??1,0,1);

  // Reversal risk is a soft attenuation, not an entry veto.
  const reversalPenalty=1-.45*reversalRisk;
  const alpha=clamp(blend.alpha*reversalPenalty,-1,1);

  // Volatility targeting + liquidity haircut can only reduce risk, never lever it above 1x.
  const volMultiplier=clamp(1/volRatio,.25,1);
  const riskMultiplier=clamp(volMultiplier*(.5+.5*liquidityQuality)*(1-.35*reversalRisk),.1,1);

  // One data sufficiency guard; otherwise evidence remains soft-scored.
  const sufficient=blend.evidenceCount>=3;
  const threshold=.20;
  const side=!sufficient||Math.abs(alpha)<threshold?'OBSERVE':alpha>0?'LONG':'SHORT';
  const confidence=clamp(Math.round((Math.abs(alpha)*70+blend.agreement*30)*100)/100,0,100);

  return {
    schemaVersion:'7.89-HYBRID-ALPHA-V1',researchOnly:true,executionImpact:false,
    regime,side,alpha:Number(alpha.toFixed(4)),confidence,
    riskMultiplier:Number(riskMultiplier.toFixed(3)),
    evidenceCount:blend.evidenceCount,agreement:Number(blend.agreement.toFixed(3)),
    reversalRisk:Number(reversalRisk.toFixed(3)),volatilityRatio:Number(volRatio.toFixed(3)),
    components:blend.components,
    reason:!sufficient?'INSUFFICIENT_EVIDENCE':Math.abs(alpha)<threshold?'EDGE_BELOW_THRESHOLD':'SOFT_SCORE_EDGE'
  };
}

export const HYBRID_ALPHA_V1_WEIGHTS=Object.freeze(WEIGHTS);

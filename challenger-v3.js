// MERIDIAN v7.52 — Challenger V3 independent soft-score research model
// Research-only. Evaluates the valid scanner universe without a Baseline READY hard dependency.

export const CHALLENGER_V3_RULESET='7.52-CHALLENGER-V3';
export const CHALLENGER_V3_CONFIG=Object.freeze({
  tradeConfidence:72,
  cautionConfidence:62,
  cautionRiskFactor:.5,
  maxSoftDistanceAtr:2.5
});

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function regimeAdjustment(side,regime){
  const s=String(side||'').toUpperCase(),r=String(regime||'').toUpperCase();
  if(s==='LONG'){
    if(r==='BULL')return 10;
    if(r==='BEAR')return-12;
    if(r==='RANGE')return-2;
    return-5;
  }
  if(s==='SHORT'){
    if(r==='BEAR')return 10;
    if(r==='RANGE')return 4;
    if(r==='BULL')return-12;
    return-5;
  }
  return-20;
}

function baselineStatusAdjustment(status){
  const s=String(status||'NO_SETUP').toUpperCase();
  if(s==='READY')return 5;
  if(s==='WAIT_ENTRY_ZONE')return-3;
  return-6;
}

function validSignal(sig){
  const side=String(sig?.side||'').toUpperCase();
  return ['LONG','SHORT'].includes(side)&&Number(sig?.entry)>0&&Number(sig?.sl)>0&&Number(sig?.tp1)>0&&Number.isFinite(Number(sig?.technical))&&Number.isFinite(Number(sig?.candidate));
}

export function challengerV3Decision(sig,{fullRiskPct=1,cautionRiskPct=null,config={}}={}){
  const cfg={...CHALLENGER_V3_CONFIG,...config};
  if(!validSignal(sig))return{ruleset:CHALLENGER_V3_RULESET,decision:'SKIP',riskPct:0,confidence:0,reasons:['INVALID_SIGNAL'],baselineReadyDependency:false,researchOnly:true};

  const technical=clamp(Number(sig.technical),0,100);
  const candidate=clamp(Number(sig.candidate),0,100);
  const d=Number(sig.distanceAtr);
  const distanceQuality=Number.isFinite(d)?clamp(100-(Math.max(0,d)/Math.max(.1,cfg.maxSoftDistanceAtr))*62.5,0,100):35;
  const regimeAdj=regimeAdjustment(sig.side,sig.regime);
  const baselineAdj=baselineStatusAdjustment(sig.status);
  const confidence=clamp(Math.round(technical*.40+candidate*.35+distanceQuality*.15+regimeAdj+baselineAdj),0,100);

  let decision='SKIP',riskPct=0,reasons=[];
  if(confidence>=cfg.tradeConfidence){decision='TRADE';riskPct=Math.max(.1,Number(fullRiskPct)||1)}
  else if(confidence>=cfg.cautionConfidence){decision='CAUTION';riskPct=Math.max(.1,Number(cautionRiskPct??((Number(fullRiskPct)||1)*cfg.cautionRiskFactor)))}
  else reasons.push('CONFIDENCE_LT_CAUTION');

  if(String(sig.status||'').toUpperCase()!=='READY')reasons.push('BASELINE_STATUS_SOFT_ONLY');
  return{
    ruleset:CHALLENGER_V3_RULESET,decision,riskPct:round(riskPct,3),confidence,
    technical:round(technical,1),candidate:round(candidate,1),distanceQuality:round(distanceQuality,1),
    regimeAdjustment:regimeAdj,baselineStatusAdjustment:baselineAdj,baselineStatus:String(sig.status||'NO_SETUP'),
    baselineReadyDependency:false,researchOnly:true,executionImpact:false,reasons
  };
}

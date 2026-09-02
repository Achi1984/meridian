// MERIDIAN v7.53 — Challenger V3.1 calibrated independent soft-score research model
// Research-only. Keeps the full valid scanner universe while penalizing poor entry timing softly.

export const CHALLENGER_V31_RULESET='7.53-CHALLENGER-V3.1';
export const CHALLENGER_V31_CONFIG=Object.freeze({
  tradeConfidence:78,
  cautionConfidence:68,
  cautionRiskFactor:.30,
  waitRiskFactor:.35,
  noSetupRiskFactor:.25,
  distanceReferenceAtr:1.35
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
  if(s==='READY')return 6;
  if(s==='WAIT_ENTRY_ZONE')return-10;
  return-18;
}

function statusRiskFactor(status,cfg){
  const s=String(status||'NO_SETUP').toUpperCase();
  if(s==='READY')return 1;
  if(s==='WAIT_ENTRY_ZONE')return cfg.waitRiskFactor;
  return cfg.noSetupRiskFactor;
}

function validSignal(sig){
  const side=String(sig?.side||'').toUpperCase();
  return ['LONG','SHORT'].includes(side)&&Number(sig?.entry)>0&&Number(sig?.sl)>0&&Number(sig?.tp1)>0&&Number.isFinite(Number(sig?.technical))&&Number.isFinite(Number(sig?.candidate));
}

function distanceQuality(distanceAtr,cfg){
  const d=Math.max(0,Number(distanceAtr));
  if(!Number.isFinite(d))return 20;
  // Stronger non-linear timing penalty than V3, but still soft: no distance hard gate.
  const x=d/Math.max(.1,cfg.distanceReferenceAtr);
  return clamp(Math.round(100-72*x-18*x*x),0,100);
}

export function challengerV31Decision(sig,{fullRiskPct=1,cautionRiskPct=null,config={}}={}){
  const cfg={...CHALLENGER_V31_CONFIG,...config};
  if(!validSignal(sig))return{ruleset:CHALLENGER_V31_RULESET,decision:'SKIP',riskPct:0,confidence:0,reasons:['INVALID_SIGNAL'],baselineReadyDependency:false,researchOnly:true,executionImpact:false};

  const technical=clamp(Number(sig.technical),0,100);
  const candidate=clamp(Number(sig.candidate),0,100);
  const dq=distanceQuality(sig.distanceAtr,cfg);
  const regimeAdj=regimeAdjustment(sig.side,sig.regime);
  const baselineAdj=baselineStatusAdjustment(sig.status);
  const confidence=clamp(Math.round(technical*.39+candidate*.31+dq*.20+regimeAdj+baselineAdj),0,100);

  let decision='SKIP',baseRisk=0,reasons=[];
  if(confidence>=cfg.tradeConfidence){decision='TRADE';baseRisk=Math.max(.1,Number(fullRiskPct)||1)}
  else if(confidence>=cfg.cautionConfidence){decision='CAUTION';baseRisk=Math.max(.1,Number(cautionRiskPct??((Number(fullRiskPct)||1)*cfg.cautionRiskFactor)))}
  else reasons.push('CONFIDENCE_LT_CAUTION');

  const status=String(sig.status||'NO_SETUP').toUpperCase();
  const riskFactor=statusRiskFactor(status,cfg);
  let riskPct=baseRisk?Math.max(.1,baseRisk*riskFactor):0;
  // Outside READY is deliberately still tradeable, but only at reduced research risk.
  if(status!=='READY')reasons.push('BASELINE_STATUS_SOFT_ONLY');
  if(Number(sig.distanceAtr)>.75)reasons.push('ENTRY_DISTANCE_SOFT_PENALTY');

  return{
    ruleset:CHALLENGER_V31_RULESET,decision,riskPct:round(riskPct,3),confidence,
    technical:round(technical,1),candidate:round(candidate,1),distanceQuality:round(dq,1),
    regimeAdjustment:regimeAdj,baselineStatusAdjustment:baselineAdj,baselineStatus:status,
    statusRiskFactor:round(riskFactor,2),baselineReadyDependency:false,researchOnly:true,executionImpact:false,reasons
  };
}

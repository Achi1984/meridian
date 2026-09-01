// MERIDIAN REGIME V1 — research-only adaptive strategy selector.
// No live execution path. Baseline 6.2 remains frozen.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;

export const REGIME_V1_RULESET='7.38-REGIME-V1';
export const REGIME_V1_CONFIG=Object.freeze({
  tradeScore:76,
  cautionScore:68,
  fullRiskPct:1,
  cautionRiskPct:.5,
  riskMultipliers:{TREND_UP:1,TREND_DOWN:1,RANGE:.65,EXPANSION:.8,CHOP:.35},
  weights:{technical:.30,candidate:.22,regimeQuality:.20,entryQuality:.15,momentumFit:.13}
});

function frame(signal,key){return signal?.frames?.[key]||{};}
function distAtr(f){const p=num(f.price,NaN),e=num(f.ema20,NaN),a=num(f.atr,NaN);return Number.isFinite(p)&&Number.isFinite(e)&&a>0?Math.abs(p-e)/a:NaN;}
function trendSide(h4,h1){
  const up=num(h4.ema20)>num(h4.ema50)&&num(h1.ema20)>num(h1.ema50);
  const down=num(h4.ema20)<num(h4.ema50)&&num(h1.ema20)<num(h1.ema50);
  return up?'LONG':down?'SHORT':null;
}

export function classifyRegime(signal){
  const m15=frame(signal,'15m'),h1=frame(signal,'1h'),h4=frame(signal,'4h');
  const adx4=num(h4.adx),adx1=num(h1.adx),vol=num(m15.volumeRatio,1),d=distAtr(m15);
  const aligned=trendSide(h4,h1);
  if(vol>=1.30&&adx1>=20&&Number.isFinite(d)&&d>=.45)return 'EXPANSION';
  if(adx4>=20&&aligned==='LONG')return 'TREND_UP';
  if(adx4>=20&&aligned==='SHORT')return 'TREND_DOWN';
  if(adx4<18&&adx1<22)return 'RANGE';
  return 'CHOP';
}

function selectSide(signal,regime){
  const base=String(signal?.side||'').toUpperCase()==='SHORT'?'SHORT':'LONG';
  if(regime==='TREND_UP')return 'LONG';
  if(regime==='TREND_DOWN')return 'SHORT';
  const m15=frame(signal,'15m');
  if(regime==='RANGE'){
    const r=num(m15.rsi,50);
    if(r<=45)return 'LONG';
    if(r>=55)return 'SHORT';
  }
  if(regime==='EXPANSION'){
    const h1=frame(signal,'1h');
    const hist=num(h1?.macd?.hist??h1?.macdHist,0);
    if(hist>0)return 'LONG';
    if(hist<0)return 'SHORT';
  }
  return base;
}

function regimeQuality(regime){return regime==='EXPANSION'?90:regime==='TREND_UP'||regime==='TREND_DOWN'?88:regime==='RANGE'?82:38;}
function entryQuality(regime,d){
  if(!Number.isFinite(d))return 45;
  if(regime==='RANGE')return clamp(48+d*58,35,100);
  if(regime==='EXPANSION')return clamp(55+d*35,40,100);
  if(regime==='TREND_UP'||regime==='TREND_DOWN')return clamp(100-Math.abs(d-.45)*78,35,100);
  return clamp(70-Math.abs(d-.4)*55,25,80);
}
function momentumFit(signal,side){
  const h1=frame(signal,'1h'),m15=frame(signal,'15m');
  const hist=num(h1?.macd?.hist??h1?.macdHist,0),r=num(m15.rsi,50),long=side==='LONG';
  let score=50;
  score+=(long?hist>0:hist<0)?25:-20;
  if(long){score+=r>=48&&r<=72?18:r<38?-15:0;}else{score+=r<=52&&r>=28?18:r>62?-15:0;}
  return clamp(score,0,100);
}
function geometry(signal,side,regime){
  const m15=frame(signal,'15m'),entry=num(signal?.entry,num(m15.price,0)),atr=num(m15.atr,entry*.01);
  const spec=regime==='RANGE'?{sl:1.25,tp1:1.0,tp2:1.5}:regime==='EXPANSION'?{sl:1.8,tp1:1.6,tp2:2.8}:regime==='CHOP'?{sl:1.35,tp1:1.2,tp2:1.8}:{sl:1.5,tp1:1.4,tp2:2.3};
  const stop=Math.max(atr*spec.sl,entry*.001),sl=side==='LONG'?entry-stop:entry+stop,R=Math.abs(entry-sl);
  return{entry,sl,tp1:side==='LONG'?entry+R*spec.tp1:entry-R*spec.tp1,tp2:side==='LONG'?entry+R*spec.tp2:entry-R*spec.tp2,atr,stopMult:spec.sl,tp1R:spec.tp1,tp2R:spec.tp2};
}

export function regimeDecision(signal,overrides={}){
  const cfg={...REGIME_V1_CONFIG,...overrides,riskMultipliers:{...REGIME_V1_CONFIG.riskMultipliers,...(overrides.riskMultipliers||{})}};
  const regime=classifyRegime(signal),side=selectSide(signal,regime),m15=frame(signal,'15m');
  const d=Number.isFinite(Number(signal?.distanceAtr))?Number(signal.distanceAtr):distAtr(m15);
  const rq=regimeQuality(regime),eq=entryQuality(regime,d),mf=momentumFit(signal,side);
  const technical=clamp(num(signal?.technical,50),0,100),candidate=clamp(num(signal?.candidate,50),0,100);
  const score=clamp(Math.round(technical*cfg.weights.technical+candidate*cfg.weights.candidate+rq*cfg.weights.regimeQuality+eq*cfg.weights.entryQuality+mf*cfg.weights.momentumFit),0,100);
  let decision='SKIP',baseRisk=0;
  if(score>=cfg.tradeScore){decision='TRADE';baseRisk=cfg.fullRiskPct;}else if(score>=cfg.cautionScore){decision='CAUTION';baseRisk=cfg.cautionRiskPct;}
  const riskPct=decision==='SKIP'?0:Math.max(.1,round(baseRisk*num(cfg.riskMultipliers[regime],1),3));
  const g=geometry(signal,side,regime);
  const reasons=[];
  if(decision==='SKIP')reasons.push('REGIME_SCORE_LT_CAUTION');
  if(regime==='CHOP')reasons.push('CHOP_RISK_REDUCED');
  if(String(signal?.side||'').toUpperCase()&&String(signal.side).toUpperCase()!==side)reasons.push('SIDE_ADAPTED_TO_REGIME');
  return{symbol:String(signal?.symbol||'').toUpperCase(),side,sourceSide:String(signal?.side||'').toUpperCase(),regime,decision,score,riskPct,technical,candidate,entryQuality:round(eq,1),regimeQuality:rq,momentumFit:round(mf,1),distanceAtr:round(d,3),...g,reasons,researchOnly:true,executionImpact:false,ruleset:REGIME_V1_RULESET};
}

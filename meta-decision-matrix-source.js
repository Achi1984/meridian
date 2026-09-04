// ACHI MERIDIAN Meta Allocator — Decision Matrix Source v7.80 R2
// Research-only adapter over canonical cloud-backtest candidate opportunities.
// Outcome remains the source/Baseline-side A_CURRENT normalized-R outcome: this tests whether model disagreement predicts opportunity quality, not whether an alternate Regime side would have won.

import { CLOUD_BT_CONFIG } from './cloud-backtest.js';
import { regimeDecision } from './regime-v1.js';
import { buildBotDecisionMatrix, attachMatrixOutcome } from './meta-decision-matrix.js';

export const META_MATRIX_SOURCE_VERSION='7.80-R2-CANONICAL-OPPORTUNITY-MATRIX-V1';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function shadowOpinion(sig={}){
  const reasons=[];
  if(sig.status!=='READY')reasons.push(sig.status==='WAIT_ENTRY_ZONE'?'WAIT_ENTRY_ZONE':'BASE_NOT_READY');
  if(Number(sig.technical||0)<75)reasons.push('SHADOW_TECH_LT_75');
  if(Number(sig.candidate||0)<70)reasons.push('SHADOW_CAND_LT_70');
  if(sig.regime==='TRANSITION')reasons.push('SHADOW_BLOCK_TRANSITION');
  if(sig.side==='LONG'&&sig.regime!=='BULL')reasons.push('SHADOW_LONG_ONLY_BULL');
  if(sig.side==='SHORT'&&!['BEAR','RANGE'].includes(sig.regime))reasons.push('SHADOW_SHORT_ONLY_BEAR_RANGE');
  return{decision:reasons.length?(reasons[0]==='WAIT_ENTRY_ZONE'?'WAIT':'SKIP'):'TRADE',side:sig.side,score:sig.candidate,regime:sig.regime,reasons};
}

function challengerAdjustment(side,r){
  if(side==='LONG'){if(r==='BULL')return 10;if(r==='BEAR')return-12;if(r==='RANGE')return-2;return-5;}
  if(r==='BEAR')return 10;if(r==='RANGE')return 4;if(r==='BULL')return-12;return-5;
}
function challengerOpinion(sig={},cfg=CLOUD_BT_CONFIG){
  const d=Number(sig.distanceAtr),dq=Number.isFinite(d)?clamp(100-(d/Math.max(cfg.maxEntryDistanceAtr,.01))*35,0,100):40;
  const confidence=clamp(Math.round(Number(sig.technical||0)*.42+Number(sig.candidate||0)*.38+dq*.20+challengerAdjustment(sig.side,sig.regime)),0,100);
  let decision='SKIP',riskPct=0,reasons=[];
  if(sig.status!=='READY')reasons.push(sig.status==='WAIT_ENTRY_ZONE'?'WAIT_ENTRY_ZONE':'BASE_NOT_READY');
  else if(confidence>=72){decision='TRADE';riskPct=cfg.riskPerTradePct;}
  else if(confidence>=62){decision='CAUTION';riskPct=Math.max(.1,round(cfg.riskPerTradePct*.5,3));}
  else reasons.push('CONFIDENCE_LT_CAUTION');
  if(reasons[0]==='WAIT_ENTRY_ZONE')decision='WAIT';
  return{decision,side:sig.side,confidence,riskPct,regime:sig.regime,reasons};
}

export function matrixForSignal(signal,ts,outcome=null){
  if(!signal)return null;
  const baseline={status:signal.status,side:signal.side,candidate:signal.candidate,regime:signal.regime,reasons:signal.status==='READY'?[]:[signal.status]};
  const shadow=shadowOpinion(signal),challenger=challengerOpinion(signal),regime=regimeDecision(signal);
  const matrix=buildBotDecisionMatrix({symbol:signal.symbol,ts,market:{regime:signal.regime},baseline,shadow,challenger,regime});
  return outcome?attachMatrixOutcome(matrix,outcome):matrix;
}

export function matricesFromCohort(events=[],cohort=[]){
  const signals=new Map();
  for(const ev of events)for(const [symbol,signal] of Object.entries(ev?.signals||{}))signals.set(`${ev.t}|${symbol}`,signal);
  const out=[];
  for(const row of cohort){
    const signal=signals.get(`${row.ts}|${row.symbol}`);if(!signal)continue;
    const matrix=matrixForSignal(signal,row.ts,{realizedR:row.realizedR,mfeR:row.maxOpenR,exitReason:row.exitReason,horizonHours:(row.horizonEnd-row.ts)/3600000});
    out.push({...matrix,sourceOutcome:{side:row.side,status:row.status,geometry:'A_CURRENT_BASELINE_SIDE',fullHorizon:row.fullHorizon}});
  }
  return out;
}

export const __test={shadowOpinion,challengerOpinion,challengerAdjustment};

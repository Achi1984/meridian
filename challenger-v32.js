// MERIDIAN v7.66 — Challenger V3.2 evidence-backed soft-score lab
// Research-only. No Paper execution impact. Uses robust v7.65 interactions as small additive soft weights.
import { extractRawFeatures } from './feature-attribution.js';

const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const outcome=r=>Number.isFinite(Number(r?.outcomeR))?Number(r.outcomeR):Number.isFinite(Number(r?.normalizedR))?Number(r.normalizedR):null;

export const V766_WEIGHTS=Object.freeze([
  {id:'VOL_GE15_ADX_LT18',weight:3,match:{volume15:'>=1.5',adx15:'<18'}},
  {id:'SHORT_TRANSITION_VOL_065_1',weight:3,match:{volume15:'0.65-1',side:'SHORT',regime:'TRANSITION'}},
  {id:'VOL_GE15_ADX_18_25',weight:2,match:{volume15:'>=1.5',adx15:'18-25'}},
  {id:'VOL_1_115_RSI_50_58',weight:1,match:{volume15:'1-1.15',rsi15:'50-58'}},
  {id:'VOL_GE15_RSI_50_58',weight:1,match:{volume15:'>=1.5',rsi15:'50-58'}},
  {id:'VOL_1_115_READY',weight:.5,match:{volume15:'1-1.15',baselineStatus:'READY'}},
  {id:'VOL_GE15_NO_SETUP',weight:.5,match:{volume15:'>=1.5',baselineStatus:'NO_SETUP'}}
]);

const matches=(raw,match)=>Object.entries(match).every(([k,v])=>String(raw?.[k]??'UNKNOWN')===String(v));

export function scoreChallengerV32(row={},options={}){
  const raw=extractRawFeatures(row,options.bins),weights=options.weights||V766_WEIGHTS;
  const hits=weights.filter(x=>matches(raw,x.match));
  const evidenceScore=round(hits.reduce((a,b)=>a+Number(b.weight||0),0),2);
  return {schemaVersion:'7.66-CHALLENGER-V32-SOFT-V1',researchOnly:true,executionImpact:false,evidenceScore,hits:hits.map(x=>x.id),raw};
}

function summarize(rows){
  const rs=rows.map(outcome).filter(Number.isFinite),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0)),total=rs.reduce((a,b)=>a+b,0);
  return {samples:rs.length,totalR:round(total),avgR:rs.length?round(total/rs.length):null,winRate:rs.length?round(wins.length/rs.length*100,1):null,pf:gl>0?round(gp/gl):(gp>0?99:0)};
}

export function compareV32ToBaseline(rows=[],options={}){
  const clean=rows.filter(r=>outcome(r)!=null);
  const baseline=clean.filter(r=>String(r.baselineStatus||r.status||'').toUpperCase()==='READY');
  const ranked=clean.map((r,i)=>({r,i,s:scoreChallengerV32(r,options)})).sort((a,b)=>b.s.evidenceScore-a.s.evidenceScore||Number(b.r.candidate||0)-Number(a.r.candidate||0)||Number(b.r.technical||0)-Number(a.r.technical||0)||a.i-b.i);
  const challenger=ranked.slice(0,baseline.length).map(x=>x.r);
  const key=r=>`${r.sampledAt||''}|${r.symbol||''}`;
  const baseKeys=new Set(baseline.map(key)),challKeys=new Set(challenger.map(key));
  const displaced=baseline.filter(r=>!challKeys.has(key(r))),discovered=challenger.filter(r=>!baseKeys.has(key(r)));
  return {
    schemaVersion:'7.66-CHALLENGER-V32-COMPARE-V1',researchOnly:true,executionImpact:false,selectionMethod:'top evidence score at Baseline READY-equivalent coverage',
    universe:clean.length,baseline:summarize(baseline),challengerV32:summarize(challenger),
    opportunity:{coverageMatched:challenger.length===baseline.length,baselineCount:baseline.length,challengerCount:challenger.length,overlap:baseline.filter(r=>challKeys.has(key(r))).length,discovered:discovered.length,displaced:displaced.length,avoidedLosers:displaced.filter(r=>outcome(r)<0).length,missedWinners:displaced.filter(r=>outcome(r)>0).length,discoveredWinners:discovered.filter(r=>outcome(r)>0).length,discoveredLosers:discovered.filter(r=>outcome(r)<0).length},
    scoreDistribution:{positiveScore:ranked.filter(x=>x.s.evidenceScore>0).length,zeroScore:ranked.filter(x=>x.s.evidenceScore===0).length,maxScore:ranked.length?ranked[0].s.evidenceScore:0}
  };
}

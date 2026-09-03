// MERIDIAN v7.74 — Adaptive Evidence Weighting Lab
// Research-only. No Paper/runtime/UI/execution impact.
import { scoreChallengerV32 } from './challenger-v32.js';
import { extractRawFeatures } from './feature-attribution.js';

const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const outcome=r=>Number.isFinite(Number(r?.outcomeR))?Number(r.outcomeR):Number.isFinite(Number(r?.normalizedR))?Number(r.normalizedR):null;
const key=r=>`${r?.sampledAt||''}|${r?.symbol||''}`;

export const V774_POLICIES=Object.freeze({
  NONE:{bonus:0},
  LR_MTF3:{bonus:0.5},
  LR_VOLUME:{bonus:0.5},
  LR_MTF3_VOLUME:{bonus:0.5},
});

function isHighVolume(raw){return ['1.15-1.5','>=1.5'].includes(raw.volume15)}
function policyBonus(raw,policy){
  if(String(raw.side)!=='LONG'||String(raw.regime)!=='RANGE')return 0;
  if(policy==='LR_MTF3')return raw.mtfAlignment==='3/3'?0.5:0;
  if(policy==='LR_VOLUME')return isHighVolume(raw)?0.5:0;
  if(policy==='LR_MTF3_VOLUME')return raw.mtfAlignment==='3/3'&&isHighVolume(raw)?0.5:0;
  return 0;
}

export function scoreV774(row={},options={}){
  const policy=String(options.policy||'NONE');
  const base=scoreChallengerV32(row,options);
  const raw=extractRawFeatures(row,options.bins);
  const bonus=policyBonus(raw,policy);
  return {...base,schemaVersion:'7.74-ADAPTIVE-EVIDENCE-V1',policy,baseEvidenceScore:base.evidenceScore,adaptiveBonus:bonus,evidenceScore:round(Number(base.evidenceScore||0)+bonus,2)};
}

function summarize(rows){
  const rs=rows.map(outcome).filter(Number.isFinite),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0)),total=rs.reduce((a,b)=>a+b,0);
  return {samples:rs.length,avgR:rs.length?round(total/rs.length):null,pf:gl>0?round(gp/gl):(gp>0?99:0),winRate:rs.length?round(wins.length/rs.length*100,1):null};
}
function rank(rows,scorer,options){return rows.map((r,i)=>({r,i,s:scorer(r,options)})).sort((a,b)=>b.s.evidenceScore-a.s.evidenceScore||Number(b.r.candidate||0)-Number(a.r.candidate||0)||a.i-b.i)}

export function comparePolicy(rows=[],policy='NONE',options={}){
  const clean=rows.filter(r=>outcome(r)!=null);
  const n=clean.filter(r=>String(r.baselineStatus||r.status||'').toUpperCase()==='READY').length;
  const base=rank(clean,scoreChallengerV32,options).slice(0,n).map(x=>x.r);
  const adaptive=rank(clean,scoreV774,{...options,policy}).slice(0,n).map(x=>x.r);
  const a=new Set(base.map(key)),b=new Set(adaptive.map(key));
  const displaced=base.filter(r=>!b.has(key(r))),discovered=adaptive.filter(r=>!a.has(key(r)));
  const bs=summarize(base),as=summarize(adaptive);
  return {policy,equalCoverage:base.length===adaptive.length,base:bs,adaptive:as,comparison:{avgRDelta:round((as.avgR??0)-(bs.avgR??0)),pfDelta:round((as.pf??0)-(bs.pf??0))},opportunity:{displaced:displaced.length,discovered:discovered.length,avoidedLosers:displaced.filter(r=>outcome(r)<0).length,missedWinners:displaced.filter(r=>outcome(r)>0).length,discoveredWinners:discovered.filter(r=>outcome(r)>0).length,discoveredLosers:discovered.filter(r=>outcome(r)<0).length}};
}

export function evaluateAdaptivePolicies(rows=[],options={}){
  const policies=Object.keys(V774_POLICIES).filter(x=>x!=='NONE');
  const results=Object.fromEntries(policies.map(p=>[p,comparePolicy(rows,p,options)]));
  return {schemaVersion:'7.74-ADAPTIVE-EVIDENCE-LAB-V1',researchOnly:true,executionImpact:false,results};
}

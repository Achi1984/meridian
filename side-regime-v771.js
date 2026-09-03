// MERIDIAN v7.71 — Side × Regime Attribution
// Research-only. No Paper/runtime/UI/execution impact.
import { scoreChallengerV32 } from './challenger-v32.js';
import { extractRawFeatures } from './feature-attribution.js';

const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const outcome=r=>Number.isFinite(Number(r?.outcomeR))?Number(r.outcomeR):Number.isFinite(Number(r?.normalizedR))?Number(r.normalizedR):null;
const key=r=>`${r.sampledAt||''}|${r.symbol||''}`;

function summarize(rows){
  const rs=rows.map(outcome).filter(Number.isFinite),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0);
  const gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0)),total=rs.reduce((a,b)=>a+b,0);
  return {samples:rs.length,totalR:round(total),avgR:rs.length?round(total/rs.length):null,winRate:rs.length?round(wins.length/rs.length*100,1):null,pf:gl>0?round(gp/gl):(gp>0?99:0)};
}

function select(rows=[],options={}){
  const clean=rows.filter(r=>outcome(r)!=null);
  const baseline=clean.filter(r=>String(r.baselineStatus||r.status||'').toUpperCase()==='READY');
  const ranked=clean.map((r,i)=>({r,i,s:scoreChallengerV32(r,options)}))
    .sort((a,b)=>b.s.evidenceScore-a.s.evidenceScore||Number(b.r.candidate||0)-Number(a.r.candidate||0)||Number(b.r.technical||0)-Number(a.r.technical||0)||a.i-b.i);
  const challenger=ranked.slice(0,baseline.length).map(x=>x.r);
  return {baseline,challenger};
}

function bucketOf(row,options={}){
  const raw=extractRawFeatures(row,options.bins);
  return {side:String(raw.side||row.side||'UNKNOWN').toUpperCase(),regime:String(raw.regime||row.regime||'UNKNOWN').toUpperCase()};
}

function bucket(rows,options={}){
  const out={};
  for(const row of rows){
    const {side,regime}=bucketOf(row,options),id=`${side}__${regime}`;
    (out[id]??=[]).push(row);
  }
  return out;
}

export function attributeSideRegime(rows=[],options={}){
  const {baseline,challenger}=select(rows,options),baseBuckets=bucket(baseline,options),challBuckets=bucket(challenger,options);
  const ids=[...new Set([...Object.keys(baseBuckets),...Object.keys(challBuckets)])].sort();
  const cells={};
  for(const id of ids){
    const b=summarize(baseBuckets[id]||[]),c=summarize(challBuckets[id]||[]);
    cells[id]={baseline:b,challengerV32:c,deltaAvgR:(b.avgR==null||c.avgR==null)?null:round(c.avgR-b.avgR),deltaPf:(b.pf==null||c.pf==null)?null:round(c.pf-b.pf),coverageDelta:c.samples-b.samples};
  }
  const sideOnly={};
  for(const side of ['LONG','SHORT','UNKNOWN']){
    const idsFor=ids.filter(id=>id.startsWith(`${side}__`));
    if(!idsFor.length)continue;
    const b=idsFor.flatMap(id=>baseBuckets[id]||[]),c=idsFor.flatMap(id=>challBuckets[id]||[]);
    const bs=summarize(b),cs=summarize(c);
    sideOnly[side]={baseline:bs,challengerV32:cs,deltaAvgR:(bs.avgR==null||cs.avgR==null)?null:round(cs.avgR-bs.avgR),coverageDelta:cs.samples-bs.samples};
  }
  return {
    schemaVersion:'7.71-SIDE-REGIME-ATTRIBUTION-V1',researchOnly:true,executionImpact:false,
    selectionMethod:'same V3.2 equal-coverage ranking as v7.66',
    baselineCount:baseline.length,challengerCount:challenger.length,equalCoverage:baseline.length===challenger.length,
    overlap:baseline.filter(r=>new Set(challenger.map(key)).has(key(r))).length,
    sideOnly,cells
  };
}

// ACHI MERIDIAN Prospective Holdout — v7.79
// Research-only. Locks hypotheses before future outcomes mature.

export const PROSPECTIVE_HOLDOUT_VERSION='7.79-PROSPECTIVE-HOLDOUT-V1';
export const HOLDOUT_START_UTC='2026-09-04T20:02:00Z';
export const HOLDOUT_START_MS=Date.parse(HOLDOUT_START_UTC);
export const HORIZON_DAYS=14;
export const MIN_MATURED_SIGNALS=30;
export const RAW_CONTEXT='LONG|TRANSITION|NORMAL';
export const FAMILY_SPEC='SIDE_REGIME_VOLATILITY';

const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
function stats(rows=[]){
  const rs=rows.map(x=>Number(x.realizedR||0)),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0);
  const gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  return{n:rs.length,avgR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length):null,totalR:round(rs.reduce((a,b)=>a+b,0)),winRate:rs.length?round(wins.length/rs.length*100,2):null,pf:gl?round(gp/gl,3):(gp?99:0)};
}
function contextKey(row){const o=row.observations||row;return [o.side,o.regime,o.volatility].map(x=>String(x??'UNKNOWN').toUpperCase()).join('|')}

export function eligibleProspectiveRows(rows=[],opts={}){
  const start=Number(opts.startMs??HOLDOUT_START_MS),now=Number(opts.nowMs??Date.now()),horizonMs=Number(opts.horizonDays??HORIZON_DAYS)*86400000;
  return rows.filter(r=>Number(r.ts)>=start&&Number(r.ts)+horizonMs<=now);
}

export function evaluateProspectiveHoldout(rows=[],opts={}){
  const matured=eligibleProspectiveRows(rows,opts),raw=matured.filter(r=>contextKey(r)===RAW_CONTEXT);
  const result={
    version:PROSPECTIVE_HOLDOUT_VERSION,researchOnly:true,executionImpact:false,
    lock:{startUtc:HOLDOUT_START_UTC,startMs:HOLDOUT_START_MS,horizonDays:HORIZON_DAYS,minMaturedSignals:MIN_MATURED_SIGNALS,rawContext:RAW_CONTEXT,familySpec:FAMILY_SPEC},
    maturedUniverse:stats(matured),rawContext:stats(raw),
    readiness:{rawContext:raw.length>=MIN_MATURED_SIGNALS,status:raw.length>=MIN_MATURED_SIGNALS?'READY_FOR_REVIEW':'WAITING_FOR_MATURED_SAMPLE'},
    promotion:{allowed:false,reason:'PROSPECTIVE_HOLDOUT_REQUIRES_HUMAN_REVIEW'}
  };
  return result;
}

export const __test={stats,contextKey};

// MERIDIAN v7.75 — Chronological Policy Selection Lab
// Research-only. Selects the next-period adaptive policy using only the immediately older period.
// No Paper/runtime/UI/execution impact.

const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

export const V775_PERIOD_ORDER=Object.freeze(['P3','P2','P1','P0']); // oldest -> newest
export const V775_POLICIES=Object.freeze(['LR_MTF3','LR_VOLUME','LR_MTF3_VOLUME']);

function policyResult(period,policy){
  return period?.results?.[policy]||null;
}

export function selectPolicyFromPeriod(period={}){
  const ranked=V775_POLICIES.map(policy=>{
    const r=policyResult(period,policy)||{};
    const c=r.comparison||{};
    const o=r.opportunity||{};
    return {
      policy,
      avgRDelta:Number(c.avgRDelta||0),
      pfDelta:Number(c.pfDelta||0),
      displaced:Number(o.displaced||0),
      equalCoverage:r.equalCoverage===true,
    };
  }).filter(x=>x.equalCoverage).sort((a,b)=>
    b.avgRDelta-a.avgRDelta ||
    b.pfDelta-a.pfDelta ||
    a.displaced-b.displaced ||
    V775_POLICIES.indexOf(a.policy)-V775_POLICIES.indexOf(b.policy)
  );
  return ranked[0]||null;
}

export function evaluateChronologicalPolicy(report={}){
  const periods=report?.periods||{};
  const steps=[];
  for(let i=0;i<V775_PERIOD_ORDER.length-1;i++){
    const trainKey=V775_PERIOD_ORDER[i];
    const testKey=V775_PERIOD_ORDER[i+1];
    const selected=selectPolicyFromPeriod(periods[trainKey]);
    if(!selected)continue;
    const test=policyResult(periods[testKey],selected.policy);
    if(!test)continue;
    steps.push({
      trainPeriod:trainKey,
      testPeriod:testKey,
      selectedPolicy:selected.policy,
      trainSignal:{avgRDelta:selected.avgRDelta,pfDelta:selected.pfDelta,displaced:selected.displaced},
      test:{
        equalCoverage:test.equalCoverage===true,
        avgRDelta:Number(test.comparison?.avgRDelta||0),
        pfDelta:Number(test.comparison?.pfDelta||0),
        base:test.base||null,
        adaptive:test.adaptive||null,
        opportunity:test.opportunity||null,
      },
    });
  }
  const valid=steps.filter(x=>x.test.equalCoverage);
  const avgRDelta=valid.length?round(valid.reduce((s,x)=>s+x.test.avgRDelta,0)/valid.length):null;
  const pfDelta=valid.length?round(valid.reduce((s,x)=>s+x.test.pfDelta,0)/valid.length):null;
  const positive=valid.filter(x=>x.test.avgRDelta>0&&x.test.pfDelta>0).length;
  const negative=valid.filter(x=>x.test.avgRDelta<0||x.test.pfDelta<0).length;
  const neutral=valid.length-positive-negative;
  const persistent=valid.length>=3&&positive>=2&&negative===0&&avgRDelta>0&&pfDelta>0;
  return {
    schemaVersion:'7.75-CHRONOLOGICAL-POLICY-V1',
    researchOnly:true,
    executionImpact:false,
    method:'PREVIOUS_PERIOD_SELECTS_NEXT_PERIOD_POLICY',
    chronology:V775_PERIOD_ORDER,
    steps,
    summary:{periods:valid.length,positivePeriods:positive,neutralPeriods:neutral,negativePeriods:negative,avgAvgRDelta:avgRDelta,avgPfDelta:pfDelta,persistent},
    promotionAllowed:false,
    nextStep:persistent?'INDEPENDENT_CHRONOLOGICAL_REPLICATION':'REJECT_PERIOD_SWITCHING_POLICY',
  };
}

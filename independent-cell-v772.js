// MERIDIAN v7.72 — Independent Side×Regime Cell Validation
// Research-only. No Paper/runtime/UI/execution impact.
import { attributeSideRegime } from './side-regime-v771.js';

export const V772_CANDIDATE_CELLS=Object.freeze([
  'LONG__RANGE',
  'LONG__TRANSITION',
  'SHORT__BEAR',
  'SHORT__RANGE'
]);

const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

export function validateIndependentCells(periodRows={},options={}){
  const cells=options.cells||V772_CANDIDATE_CELLS;
  const minSamples=Number(options.minSamples??25);
  const minPositivePeriods=Number(options.minPositivePeriods??3);
  const periods={};
  for(const [period,rows] of Object.entries(periodRows)) periods[period]=attributeSideRegime(rows,options);

  const validation={};
  for(const cell of cells){
    const observations=[];
    for(const [period,report] of Object.entries(periods)){
      const x=report.cells?.[cell];
      if(!x) continue;
      const b=Number(x.baseline?.samples||0),c=Number(x.challengerV32?.samples||0),delta=Number(x.deltaAvgR);
      observations.push({period,baselineSamples:b,challengerSamples:c,deltaAvgR:Number.isFinite(delta)?delta:null,coverageDelta:Number(x.coverageDelta||0),adequate:b>=minSamples&&c>=minSamples});
    }
    const adequate=observations.filter(x=>x.adequate&&x.deltaAvgR!=null);
    const positive=adequate.filter(x=>x.deltaAvgR>0);
    const negative=adequate.filter(x=>x.deltaAvgR<0);
    const meanDelta=adequate.length?round(adequate.reduce((s,x)=>s+x.deltaAvgR,0)/adequate.length):null;
    validation[cell]={
      observations,
      adequatePeriods:adequate.length,
      positivePeriods:positive.length,
      negativePeriods:negative.length,
      meanDeltaAvgR:meanDelta,
      independentlyValidated:adequate.length>=minPositivePeriods&&positive.length>=minPositivePeriods&&meanDelta>0
    };
  }

  const validatedCells=Object.entries(validation).filter(([,x])=>x.independentlyValidated).map(([id])=>id);
  return {
    schemaVersion:'7.72-INDEPENDENT-CELL-VALIDATION-V1',researchOnly:true,executionImpact:false,
    sourceCandidates:[...cells],validation,validatedCells,
    allCandidatesValidated:validatedCells.length===cells.length,
    promotionAllowed:false,
    guardrail:'Validated cells may inform small soft-score/risk-allocation experiments only; never become hard entry gates from this evidence.'
  };
}

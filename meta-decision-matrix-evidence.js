// ACHI MERIDIAN Meta Allocator — Decision Matrix Evidence v7.80 R2
// Research-only pattern attribution. No routing, sizing or execution.

export const META_MATRIX_EVIDENCE_VERSION='7.80-R2-DECISION-PATTERN-EVIDENCE-V1';
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
function stats(rows=[]){
  const rs=rows.map(x=>Number(x?.outcome?.realizedR)).filter(Number.isFinite),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  return{n:rs.length,avgR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length):null,totalR:round(rs.reduce((a,b)=>a+b,0)),winRate:rs.length?round(wins.length/rs.length*100,2):null,pf:gl?round(gp/gl,3):(gp?99:0)};
}
function group(rows,keyFn){const m={};for(const r of rows){const k=keyFn(r);(m[k]??=[]).push(r)}return Object.entries(m).map(([key,x])=>({key,...stats(x)})).sort((a,b)=>b.n-a.n)}
export function decisionMatrixEvidence(rows=[]){
  const matured=rows.filter(x=>Number.isFinite(Number(x?.outcome?.realizedR)));
  return{
    version:META_MATRIX_EVIDENCE_VERSION,researchOnly:true,executionImpact:false,
    all:stats(matured),
    bySupport:group(matured,x=>`SUPPORT_${x.actions?.supportive??0}`),
    bySideConflict:group(matured,x=>x.disagreement?.sideConflict?'SIDE_CONFLICT':'NO_SIDE_CONFLICT'),
    byHardDisagreement:group(matured,x=>x.disagreement?.hardDisagreement?'HARD_DISAGREEMENT':'NO_HARD_DISAGREEMENT'),
    byDirectionAgreement:group(matured,x=>{const a=Number(x.direction?.agreementPct||0);return a===100?'DIR_AGREE_100':a>=67?'DIR_AGREE_67_99':a>50?'DIR_AGREE_51_66':a===50?'DIR_SPLIT_50':'DIR_NONE'}),
    byPattern:group(matured,x=>x.patternKey).filter(x=>x.n>=8),
    promotion:{allowed:false,reason:'ATTRIBUTION_ONLY_NO_ALLOCATOR_POLICY'}
  };
}
export const __test={stats,group};

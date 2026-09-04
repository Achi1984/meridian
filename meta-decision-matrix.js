// ACHI MERIDIAN Meta Allocator — Bot Decision Matrix v7.80
// Research-only. Normalizes existing bot opinions for attribution; does not route or size Paper trades.

export const META_DECISION_MATRIX_VERSION='7.80-BOT-DECISION-MATRIX-V1';
export const META_BOTS=Object.freeze(['BASELINE','SHADOW','CHALLENGER','REGIME']);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const upper=v=>String(v??'UNKNOWN').toUpperCase();
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function normalizeDecision(name,input={}){
  const bot=upper(name);
  const raw=upper(input.decision??input.status);
  let action='UNKNOWN';
  if(['TRADE','ENTER','ELIGIBLE','READY'].includes(raw))action='TRADE';
  else if(['CAUTION','REDUCED'].includes(raw))action='CAUTION';
  else if(['WAIT','WAIT_ENTRY_ZONE'].includes(raw))action='WAIT';
  else if(['SKIP','BLOCK','NO_SETUP','REJECT'].includes(raw))action='SKIP';
  const side=upper(input.side??input.selectedSide??input.sourceSide);
  return{
    bot,action,
    side:['LONG','SHORT'].includes(side)?side:null,
    score:round(input.score??input.confidence??input.candidate??input.technical),
    riskPct:round(input.riskPct),
    regime:upper(input.regime??input.regimeType),
    reasons:Array.isArray(input.reasons)?input.reasons.map(String):[],
    rawDecision:raw
  };
}

function directionVotes(opinions=[]){
  const active=opinions.filter(x=>['TRADE','CAUTION'].includes(x.action)&&x.side);
  const longs=active.filter(x=>x.side==='LONG').length,shorts=active.filter(x=>x.side==='SHORT').length;
  const direction=longs>shorts?'LONG':shorts>longs?'SHORT':active.length?'SPLIT':'NONE';
  return{active:active.length,long:longs,short:shorts,direction,agreementPct:active.length?round(Math.max(longs,shorts)/active.length*100,2):0};
}

function actionVotes(opinions=[]){
  const counts={TRADE:0,CAUTION:0,WAIT:0,SKIP:0,UNKNOWN:0};
  for(const x of opinions)counts[x.action]=(counts[x.action]??0)+1;
  const supportive=counts.TRADE+counts.CAUTION;
  return{...counts,supportive,supportPct:opinions.length?round(supportive/opinions.length*100,2):0};
}

export function buildBotDecisionMatrix({symbol,ts,market={},baseline={},shadow={},challenger={},regime={}}={}){
  const opinions=[
    normalizeDecision('BASELINE',baseline),
    normalizeDecision('SHADOW',shadow),
    normalizeDecision('CHALLENGER',challenger),
    normalizeDecision('REGIME',regime)
  ];
  const direction=directionVotes(opinions),actions=actionVotes(opinions);
  const baselineOpinion=opinions[0],regimeOpinion=opinions[3];
  const sideConflict=Boolean(baselineOpinion.side&&regimeOpinion.side&&baselineOpinion.side!==regimeOpinion.side&&['TRADE','CAUTION'].includes(regimeOpinion.action));
  const hardDisagreement=actions.supportive>0&&actions.SKIP>0;
  const dispersion=clamp((sideConflict?50:0)+(hardDisagreement?25:0)+(100-direction.agreementPct)*.25,0,100);
  return{
    version:META_DECISION_MATRIX_VERSION,researchOnly:true,executionImpact:false,
    symbol:upper(symbol),ts:Number.isFinite(Number(ts))?Number(ts):null,
    market:{regime:upper(market.regime),volatility:upper(market.volatility),cluster:upper(market.cluster)},
    opinions,direction,actions,
    disagreement:{sideConflict,hardDisagreement,dispersion:round(dispersion,2)},
    patternKey:opinions.map(x=>`${x.bot}:${x.action}:${x.side||'-'}`).join('|'),
    outcome:null
  };
}

export function attachMatrixOutcome(matrix,outcome={}){
  return{...matrix,outcome:{realizedR:round(outcome.realizedR),mfeR:round(outcome.mfeR),maeR:round(outcome.maeR),horizonHours:round(outcome.horizonHours),exitReason:outcome.exitReason??null}};
}

export function matrixCohortSummary(rows=[]){
  const matured=rows.filter(x=>Number.isFinite(Number(x?.outcome?.realizedR)));
  const rs=matured.map(x=>Number(x.outcome.realizedR)),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  const conflict=matured.filter(x=>x.disagreement?.sideConflict),aligned=matured.filter(x=>!x.disagreement?.sideConflict&&x.direction?.active>=2&&x.direction?.agreementPct===100);
  const stats=a=>{const r=a.map(x=>Number(x.outcome.realizedR));return{n:r.length,avgR:r.length?round(r.reduce((p,v)=>p+v,0)/r.length):null,totalR:round(r.reduce((p,v)=>p+v,0))}};
  return{version:META_DECISION_MATRIX_VERSION,researchOnly:true,n:matured.length,avgR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length):null,winRate:rs.length?round(wins.length/rs.length*100,2):null,pf:gl?round(gp/gl,3):(gp?99:0),sideConflict:stats(conflict),fullDirectionalAgreement:stats(aligned)};
}

export const __test={normalizeDecision,directionVotes,actionVotes};

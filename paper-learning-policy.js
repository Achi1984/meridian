// MERIDIAN R32 — prospective, evidence-gated Paper bot evaluation.
// The policy never changes entries or promotes a bot to live execution.
const finite=(v,f=null)=>Number.isFinite(Number(v))?Number(v):f;
const round=(v,d=3)=>Math.round(Number(v)*10**d)/10**d;

export const PAPER_LEARNING_POLICY=Object.freeze({
  version:'R32-PAPER-LEARNING-V1',
  firstCheckpointTrades:20,
  retirementCheckpointTrades:30,
  finalCheckpointTrades:50,
  weakProfitFactor:.9,
  promisingProfitFactor:1.1
});

function stats(rows=[]){
  const pnl=rows.reduce((sum,x)=>sum+finite(x?.realized,0),0);
  const profit=rows.filter(x=>finite(x?.realized,0)>0).reduce((sum,x)=>sum+finite(x.realized,0),0);
  const loss=Math.abs(rows.filter(x=>finite(x?.realized,0)<0).reduce((sum,x)=>sum+finite(x.realized,0),0));
  return Object.freeze({
    closedTrades:rows.length,
    pnl:round(pnl,2),
    expectancy:rows.length?round(pnl/rows.length,2):null,
    profitFactor:loss>0?round(profit/loss,3):(profit>0?99:0),
    winRate:rows.length?round(rows.filter(x=>finite(x?.realized,0)>0).length/rows.length*100,1):null
  });
}

export function evaluatePaperLearning(state={},policy=PAPER_LEARNING_POLICY){
  const all=Array.isArray(state?.trades)?state.trades.filter(x=>x?.status==='CLOSED'):[];
  const phaseStarted=state?.executionPolicy?.version!=null;
  const start=Math.max(0,Math.min(all.length,Math.floor(finite(state?.executionPolicy?.startingClosedCount,all.length))));
  const phase=phaseStarted?all.slice(start):[];
  const performance=stats(phase),n=performance.closedTrades,pf=performance.profitFactor,exp=performance.expectancy;
  let status='WAITING_FOR_PHASE',decision='KEEP_RUNNING',target=policy.firstCheckpointTrades,reason='Kostenphase startet nach der letzten offenen Altposition.';
  if(!phaseStarted)return Object.freeze({policyVersion:policy.version,phaseStarted:false,startingClosedCount:start,status,decision,targetClosedTrades:target,remainingTrades:target,performance,reason,researchOnly:true,livePromotion:false});
  if(n<policy.firstCheckpointTrades){status='BUILDING';reason=`${policy.firstCheckpointTrades-n} Trades bis zur ersten Bewertung.`;}
  else if(phaseStarted&&n<policy.retirementCheckpointTrades){
    status=pf>=policy.promisingProfitFactor&&exp>0?'PROMISING_EARLY':'CHECKPOINT';
    target=policy.retirementCheckpointTrades;
    reason=status==='PROMISING_EARLY'?'Frühes positives Signal; Stichprobe weiter aufbauen.':`${policy.retirementCheckpointTrades-n} Trades bis zur belastbaren Behalten/Ausmustern-Entscheidung.`;
  }else if(phaseStarted&&n>=policy.retirementCheckpointTrades&&pf<policy.weakProfitFactor&&exp<0){
    status='RETIRE';decision='RETIRE_NO_EDGE';target=n;reason='Negative Expectancy und PF unter 0,90 nach mindestens 30 Trades.';
  }else if(phaseStarted&&n<policy.finalCheckpointTrades){
    status=pf>=policy.promisingProfitFactor&&exp>0?'PROMISING':'EXTEND';target=policy.finalCheckpointTrades;
    reason=status==='PROMISING'?'Prospektive Kostenphase positiv; unverändert weiterlaufen lassen.':`${policy.finalCheckpointTrades-n} weitere Trades zur Klärung der Grenzlage.`;
  }else if(phaseStarted&&pf<1&&exp<=0){
    status='RETIRE';decision='RETIRE_NO_EDGE';target=n;reason='Nach 50 Trades kein positiver Netto-Edge.';
  }else{
    status=pf>=policy.promisingProfitFactor&&exp>0?'PROMISING':'WATCH';target=n;
    reason=status==='PROMISING'?'Netto-Edge vorhanden; unverändert weiter validieren.':'Grenzbereich: keine Parameteränderung ohne neue Hypothese.';
  }
  return Object.freeze({policyVersion:policy.version,phaseStarted,startingClosedCount:start,status,decision,targetClosedTrades:target,remainingTrades:Math.max(0,target-n),performance,reason,researchOnly:true,livePromotion:false});
}

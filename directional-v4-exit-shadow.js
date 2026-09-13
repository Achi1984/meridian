// MERIDIAN CHALLENGER V4 — prospective paired exit shadow.
// It may only mirror an accepted V3 paper position. No signal or venue path.

const copy=x=>structuredClone(x);
const round=(v,d=8)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const direction=side=>String(side).toUpperCase()==='SHORT'?-1:1;

export const DIRECTIONAL_V4_RULESET='8.40-CHALLENGER-V4-PAIRED-PROTECTED-EXIT';
export const DIRECTIONAL_V4_POLICY=Object.freeze({
  tp1ClosePct:50,runnerTarget:'TP2',protectAfterTp1:'COST_BREAK_EVEN',
  diagnosticPairs:20,decisionPairs:30,graduationPairs:50,maxDrawdownPct:8,
  autoPromotion:false,researchOnly:true
});

export function newDirectionalV4State(now=Date.now(),costs={feeBps:5,slippageBps:3}){
  const at=new Date(now).toISOString();
  return{schemaVersion:'1.0',ruleset:DIRECTIONAL_V4_RULESET,researchOnly:true,executionImpact:false,
    lifecycle:{status:'PAIRED_SHADOW',createdAt:at,autoPromotion:false},
    frozenPolicy:{...DIRECTIONAL_V4_POLICY,feeBps:Number(costs.feeBps),slippageBps:Number(costs.slippageBps),frozenAt:at},
    account:{startEquity:10000,cash:10000,equity:10000,peakEquity:10000,realizedPnl:0,unrealizedPnl:0},
    positions:[],trades:[],pairs:[],createdAt:at,updatedAt:at};
}

function exitFill(price,side,slippageBps){
  const r=Number(slippageBps)/10000,d=direction(side);
  return Number(price)*(d===1?1-r:1+r);
}

function costBreakEven(entry,side,feeBps,slippageBps){
  const f=Number(feeBps)/10000,s=Number(slippageBps)/10000;
  return direction(side)===1?entry*(1+f)/((1-s)*(1-f)):entry*(1-f)/((1+s)*(1+f));
}

export function pairDirectionalV4Position(state,parent,now=Date.now()){
  const out=copy(state),id=String(parent?.id||'');
  if(!id)throw new Error('V4 pair requires parent id');
  if(out.positions.some(x=>x.parentPositionId===id)||out.trades.some(x=>x.parentPositionId===id))return out;
  const qty=Number(parent.qty),entry=Number(parent.entry),sl=Number(parent.sl),tp1=Number(parent.tp1),tp2=Number(parent.tp2);
  if(!(qty>0&&entry>0&&sl>0&&tp1>0&&tp2>0))throw new Error('V4 pair requires complete V3 position');
  const feeOpen=Number(parent.feeOpen||0),p={
    id:`v4-${id}`,parentPositionId:id,symbol:parent.symbol,side:parent.side,status:'OPEN',
    entry,initialSl:sl,sl,tp1,tp2,qty,remainingQty:qty,feeOpen,riskPct:Number(parent.riskPct),
    plannedRiskBudgetUsd:Number(parent.plannedRiskBudgetUsd||0),openedAt:parent.openedAt||new Date(now).toISOString(),
    tp1Filled:false,realizedAfterEntryCosts:0,source:'CHALLENGER_V3_PAIRED',ruleset:DIRECTIONAL_V4_RULESET
  };
  out.positions.push(p);out.account.cash-=feeOpen;out.account.realizedPnl-=feeOpen;out.updatedAt=new Date(now).toISOString();return out;
}

function crossesStop(p,price){return direction(p.side)===1?price<=p.sl:price>=p.sl;}
function crossesTarget(p,price,target){return direction(p.side)===1?price>=target:price<=target;}

function closeQuantity(out,p,qty,triggerPrice,reason,now,costs){
  const fill=exitFill(triggerPrice,p.side,costs.slippageBps),gross=(fill-p.entry)*qty*direction(p.side),fee=fill*qty*Number(costs.feeBps)/10000,net=gross-fee;
  p.remainingQty=round(p.remainingQty-qty,10);p.realizedAfterEntryCosts=round(Number(p.realizedAfterEntryCosts||0)+net,8);
  out.account.cash+=net;out.account.realizedPnl+=net;
  if(p.remainingQty<=1e-9){
    p.status='CLOSED';p.closedAt=new Date(now).toISOString();p.exit=fill;p.exitReason=reason;p.feeClose=round(Number(p.feeClose||0)+fee,8);
    p.realized=round(p.realizedAfterEntryCosts-p.feeOpen,8);
  }else{p.feeClose=round(Number(p.feeClose||0)+fee,8);}
}

export function cycleDirectionalV4(state,quotes,now=Date.now()){
  const out=copy(state),costs=out.frozenPolicy,open=[];let unrealized=0;
  if(costs.feeBps==null||costs.slippageBps==null)throw new Error('V4 costs not frozen');
  for(const p of out.positions){
    if(p.status!=='OPEN')continue;const q=quotes?.[p.symbol],price=Number(q?.price);
    if(!(price>0)){open.push(p);unrealized+=Number(p.unrealized||0);continue;}
    if(crossesStop(p,price))closeQuantity(out,p,p.remainingQty,price,p.tp1Filled?'PROTECTED_STOP':'SL',now,costs);
    else if(crossesTarget(p,price,p.tp2))closeQuantity(out,p,p.remainingQty,p.tp2,'TP2',now,costs);
    else if(!p.tp1Filled&&crossesTarget(p,price,p.tp1)){
      closeQuantity(out,p,p.qty*costs.tp1ClosePct/100,p.tp1,'TP1_PARTIAL',now,costs);p.tp1Filled=true;p.tp1FilledAt=new Date(now).toISOString();
      p.sl=round(costBreakEven(p.entry,p.side,costs.feeBps,costs.slippageBps),8);
    }
    if(p.status==='CLOSED')out.trades.push(p);else{
      const gross=(price-p.entry)*p.remainingQty*direction(p.side),fee=price*p.remainingQty*Number(costs.feeBps)/10000;
      p.livePrice=price;p.unrealized=round(gross-fee,8);unrealized+=p.unrealized;open.push(p);
    }
  }
  out.positions=open;out.account.unrealizedPnl=round(unrealized,8);out.account.equity=round(out.account.cash+unrealized,8);
  out.account.peakEquity=Math.max(Number(out.account.peakEquity||out.account.equity),out.account.equity);
  const dd=out.account.peakEquity>0?(out.account.peakEquity-out.account.equity)/out.account.peakEquity*100:0;
  if(dd>=costs.maxDrawdownPct)out.lifecycle={...out.lifecycle,status:'STOPPED_REVIEW',stoppedAt:new Date(now).toISOString(),reason:'MAX_DRAWDOWN'};
  out.updatedAt=new Date(now).toISOString();return out;
}

export function recordDirectionalV3Close(state,parentTrade){
  const out=copy(state),id=String(parentTrade?.id||'');if(!id)return out;
  const child=out.trades.find(x=>x.parentPositionId===id);if(!child)return out;
  if(!out.pairs.some(x=>x.parentPositionId===id))out.pairs.push({parentPositionId:id,symbol:child.symbol,side:child.side,
    v3Realized:round(Number(parentTrade.realized),8),v4Realized:round(Number(child.realized),8),deltaUsd:round(Number(child.realized)-Number(parentTrade.realized),8),
    v3ClosedAt:parentTrade.closedAt,v4ClosedAt:child.closedAt});
  return out;
}

export function directionalV4Status(state){
  const s=state||newDirectionalV4State(),tr=s.trades||[],wins=tr.filter(x=>Number(x.realized)>0),losses=tr.filter(x=>Number(x.realized)<0),gp=wins.reduce((a,x)=>a+Number(x.realized),0),gl=Math.abs(losses.reduce((a,x)=>a+Number(x.realized),0)),a=s.account||{};
  const peak=Number(a.peakEquity||a.equity||10000),eq=Number(a.equity||10000);
  return{enabled:true,researchOnly:true,executionImpact:false,independentLedger:true,ruleset:s.ruleset,lifecycle:s.lifecycle,policy:s.frozenPolicy,
    account:{...a,drawdownPct:round(peak>0?(peak-eq)/peak*100:0,2)},openPositions:s.positions||[],openCount:(s.positions||[]).length,closedCount:tr.length,
    winRate:tr.length?round(wins.length/tr.length*100,1):0,profitFactor:gl>0?round(gp/gl,2):(gp>0?99:0),recentClosed:tr.slice(-12).reverse(),matchedPairs:(s.pairs||[]).slice(-50)};
}

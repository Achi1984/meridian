import {relativeMomentum,carrySelector} from './r42-candidates.js';
export const IDS=['momentum','pairs','squeeze','carry'];
export const POLICY=Object.freeze({version:'R42-PAPER-V1',startEquity:10000,grossNotional:2000,feeBps:10,slippageBps:5,maxLossUsd:100,maxDrawdownUsd:500,momentumHoldMs:7*86400000,carryHoldMs:30*86400000,maxQuoteAgeMs:60000});
export function newLedger(id){
  if(!IDS.includes(id))throw Error('Unknown experiment');
  return {id,policy:{...POLICY},researchOnly:true,executionImpact:false,lifecycle:'WAITING_DATA',cash:POLICY.startEquity,equity:POLICY.startEquity,peak:POLICY.startEquity,basket:null,trades:[],lastScanAt:null,lastDecision:null};
}
const validBook=(q,now,p)=>q&&Number.isFinite(q.at)&&q.at<=now&&now-q.at<=p.maxQuoteAgeMs&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.bid>0&&q.ask>=q.bid;
const quote=(m,l)=>m.books?.[`${l.venue}:${l.symbol}`];
function mark(b,m,p,now){
  if(!b.legs.every(l=>validBook(quote(m,l),now,p)))return null;
  let gross=0,exitFees=0;
  for(const l of b.legs){const q=quote(m,l),exit=(l.side===1?q.bid:q.ask)*(1-l.side*p.slippageBps/10000);gross+=l.side*l.quantity*(exit-l.entry);exitFees+=l.quantity*exit*p.feeBps/10000;}
  return {gross,exitFees,net:gross+b.funding-b.entryFees-exitFees};
}
export function stepLedger(input,m,now=Date.now()){
  const s=structuredClone(input),p=s.policy;s.lastScanAt=new Date(now).toISOString();
  if(['SEALED','REVIEW'].includes(s.lifecycle))return s;
  if(s.basket){
    const b=s.basket;
    // Funding is signed per perpetual leg, deduplicated across polling and restart.
    let complete=true;
    for(const l of b.legs.filter(l=>l.venue==='perp')){
      const history=m.funding?.[l.symbol];
      if(!history?.complete){complete=false;continue;}
      for(const r of history.rows){
        const key=`${l.symbol}:${r.fundingTime}`;
        if(r.fundingTime>b.openedAt&&r.fundingTime<=now&&Number.isFinite(r.fundingRate)&&Number.isFinite(r.markPrice)&&r.markPrice>0&&!b.applied.includes(key)){
          b.funding-=l.side*l.quantity*r.markPrice*r.fundingRate;b.applied.push(key);
        }
      }
    }
    const result=mark(b,m,p,now);
    if(!result||!complete){s.lifecycle='DATA_STALE';s.lastDecision={eligible:false,reasons:[!result?'STALE_EXECUTABLE_QUOTES':'INCOMPLETE_FUNDING_HISTORY']};return s;}
    s.equity=s.cash+result.gross+b.funding-result.exitFees;s.peak=Math.max(s.peak,s.equity);s.lifecycle='IN_TRADE';b.net=result.net;b.lastMarkedAt=now;
    const reason=result.net<=-p.maxLossUsd?'LOSS_LIMIT':s.peak-s.equity>=p.maxDrawdownUsd?'DRAWDOWN':now>=b.closeAt?'TIME_EXIT':null;
    if(reason){s.cash+=result.gross+b.funding-result.exitFees;s.equity=s.cash;s.trades.push({...b,closedAt:new Date(now).toISOString(),exitReason:reason,realized:result.net});s.basket=null;
      if(s.id==='momentum'){s.lifecycle='SEALED';s.lastDecision={eligible:false,reasons:['HISTORICAL_WALK_FORWARD_REJECTED']};}
      else s.lifecycle=s.peak-s.equity>=p.maxDrawdownUsd?'SEALED':s.trades.length>=(s.id==='carry'?12:30)?'REVIEW':'WAITING_ENTRY';}
    return s; // no close/reopen in the same cycle
  }
  if(s.id==='pairs'){
    // PAIRS-WALKFORWARD-V1: 28 fixed pairs, 3 windows and 167 days yielded
    // no eligible entry. Preserve the empty ledger and stop evaluating entries.
    s.lifecycle='SEALED';s.lastDecision={eligible:false,reasons:['NO_ROBUST_PAIR_IN_WALK_FORWARD']};return s;
  }
  if(s.id==='squeeze'){
    s.lifecycle='WAITING_DATA';s.lastDecision={eligible:false,reasons:['COMPLETE_LIQUIDATION_FEED_REQUIRED']};return s;
  }
  if(s.id==='momentum'){
    // The existing basket is managed above until its frozen exit. Flat ledgers do not
    // reopen after MOMENTUM-WALKFORWARD-V1 failed the independent historical replay.
    s.lifecycle='SEALED';s.lastDecision={eligible:false,reasons:['HISTORICAL_WALK_FORWARD_REJECTED']};return s;
  }
  if(m.errors?.length||m.dataErrors?.length){s.lifecycle='WAITING_DATA';s.lastDecision={eligible:false,reasons:['INCOMPLETE_MARKET_UNIVERSE']};return s;}
  const decision=s.id==='momentum'?relativeMomentum(m.momentum||[],now):carrySelector(m.carry||[],now);s.lastDecision=decision;
  if(!decision.eligible){s.lifecycle='WAITING_ENTRY';return s;}
  const legs=s.id==='momentum'?decision.legs.map(l=>({venue:'perp',symbol:l.symbol,side:Math.sign(l.weight),notional:p.grossNotional*Math.abs(l.weight)})):[{venue:'spot',symbol:decision.symbol,side:1,notional:p.grossNotional/2},{venue:'perp',symbol:decision.symbol,side:-1,notional:p.grossNotional/2}];
  if(!legs.every(l=>validBook(quote(m,l),now,p)&& (l.venue!=='perp'||m.funding?.[l.symbol]?.complete))){s.lifecycle='WAITING_DATA';s.lastDecision={eligible:false,reasons:['EXECUTION_OR_FUNDING_DATA_MISSING']};return s;}
  let entryFees=0;
  for(const l of legs){const q=quote(m,l);l.entry=(l.side===1?q.ask:q.bid)*(1+l.side*p.slippageBps/10000);l.quantity=l.notional/l.entry;
    if(s.id==='carry'&&l.venue==='perp')l.quantity=legs[0].quantity;
    entryFees+=l.entry*l.quantity*p.feeBps/10000;
  }
  s.basket={openedAt:now,closeAt:now+(s.id==='carry'?p.carryHoldMs:p.momentumHoldMs),legs,entryFees,funding:0,applied:[]};
  s.cash-=entryFees;const initial=mark(s.basket,m,p,now);s.basket.net=initial.net;s.basket.lastMarkedAt=now;s.equity=s.cash+initial.gross-initial.exitFees;s.lifecycle='IN_TRADE';return s;
}
export function ledgerSummary(s){
  const wins=s.trades.reduce((v,t)=>v+Math.max(0,t.realized),0),losses=s.trades.reduce((v,t)=>v+Math.max(0,-t.realized),0);
  return {id:s.id,lifecycle:s.lifecycle,closedTrades:s.trades.length,openTrades:s.basket?1:0,pnl:s.equity-s.policy.startEquity,profitFactor:losses>0?wins/losses:null,lastScanAt:s.lastScanAt,lastMarkedAt:s.basket?.lastMarkedAt||null,reasons:s.lastDecision?.reasons||[],lastClosedAt:s.trades.at(-1)?.closedAt||null,recentClosed:s.trades.slice(-5).reverse().map(t=>({closedAt:t.closedAt,pnl:t.realized,exitReason:t.exitReason,symbols:t.legs.map(l=>l.symbol)}))};
}

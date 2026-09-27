import {buildFibLevels,skLongShortZones,skTargetZone,skDoubleAdvantage} from '../v10/fib-core.js';
import {costAwareSize} from '../paper-cost-policy.js';

export const SK_PAPERBOT_V1_RULESET='SK-PAPER-V1-4H-SEQUENCE-FROZEN';
export const SK_PAPERBOT_V1_CONFIG=Object.freeze({
  timeframe:'4h',
  pivotLeft:2,
  pivotRight:2,
  gateRatio:.382,
  entryRatios:Object.freeze([.5,.559,.618,.667]),
  targetRatios:Object.freeze([1.618,1.809,2]),
  targetFractions:Object.freeze([1/3,1/3,1]),
  startEquity:10000,
  riskPct:1,
  feeBps:5,
  slippageBps:3,
  researchGate:Object.freeze({minTrades:20,minProfitFactor:1.2,maxDrawdownPct:10,minPositiveWindows:3})
});

const finite=v=>Number.isFinite(Number(v));
const num=v=>Number(v);
const round=(v,d=6)=>finite(v)?Math.round(num(v)*10**d)/10**d:null;
const clone=x=>structuredClone(x);
const dir=side=>side==='LONG'?1:-1;
const touched=(bar,price,side)=>side==='LONG'?num(bar.low)<=price:num(bar.high)>=price;
const stopTouched=(bar,price,side)=>side==='LONG'?num(bar.low)<=price:num(bar.high)>=price;
const targetTouched=(bar,price,side)=>side==='LONG'?num(bar.high)>=price:num(bar.low)<=price;
const adverseFill=(price,side,entry,cfg)=>price*(side==='LONG'?(entry?1+cfg.slippageBps/10000:1-cfg.slippageBps/10000):(entry?1-cfg.slippageBps/10000:1+cfg.slippageBps/10000));

export function normalizeSkCandles(rows){
  return (Array.isArray(rows)?rows:[]).map((r,i)=>({
    openTime:num(r.openTime??r.ts??i),closeTime:num(r.closeTime??r.openTime??r.ts??i),
    open:num(r.open??r.close),high:num(r.high),low:num(r.low),close:num(r.close),volume:finite(r.volume)?num(r.volume):null
  })).filter(r=>[r.openTime,r.high,r.low,r.close].every(finite)&&r.high>=r.low&&r.close>0).sort((a,b)=>a.openTime-b.openTime);
}

function pivotAt(rows,confirmIndex,cfg){
  const idx=confirmIndex-cfg.pivotRight;
  if(idx<cfg.pivotLeft||idx+cfg.pivotRight>confirmIndex)return null;
  const c=rows[idx],left=rows.slice(idx-cfg.pivotLeft,idx),right=rows.slice(idx+1,idx+cfg.pivotRight+1);
  const high=left.concat(right).every(x=>c.high>x.high),low=left.concat(right).every(x=>c.low<x.low);
  if(high===low)return null;
  return{type:high?'HIGH':'LOW',price:high?c.high:c.low,index:idx,time:c.openTime,confirmedAt:rows[confirmIndex].openTime};
}

function levelPrice(levels,ratio){
  const row=levels.find(x=>Math.abs(num(x.ratio)-ratio)<1e-10);
  return row?.price??null;
}

function sequenceLevels(zero,a,side,cfg){
  const direction=side==='LONG'?'UP':'DOWN',levels=buildFibLevels(Math.min(zero,a),Math.max(zero,a),direction);
  return{
    gate:levelPrice(levels,cfg.gateRatio),
    entries:cfg.entryRatios.map(r=>({ratio:r,price:levelPrice(levels,r)})),
    targets:cfg.targetRatios.map(r=>({ratio:r,price:levelPrice(levels,r)})),
    levels
  };
}

function makeSequence(p0,pA,cfg,id){
  if(!p0||!pA||p0.type===pA.type)return null;
  const side=p0.type==='LOW'&&pA.type==='HIGH'?'LONG':p0.type==='HIGH'&&pA.type==='LOW'?'SHORT':null;
  if(!side)return null;
  const zero=p0.price,a=pA.price;
  if(!(side==='LONG'?a>zero:zero>a))return null;
  const lv=sequenceLevels(zero,a,side,cfg);
  return{
    id,side,state:'SEQUENCE',zero,a,zeroIndex:p0.index,aIndex:pA.index,openedSignalAt:pA.confirmedAt,
    gate:lv.gate,entries:lv.entries.map(x=>({...x,filled:false})),targets:lv.targets.map(x=>({...x,hit:false})),
    gateTouched:false,gateAt:null,correctionExtreme:a,doubleAdvantage:null,position:null,events:[]
  };
}

function refreshImpulse(seq,bar,index,cfg){
  if(seq.gateTouched||seq.position)return;
  const extend=seq.side==='LONG'?bar.high>seq.a:bar.low<seq.a;
  if(!extend)return;
  seq.a=seq.side==='LONG'?bar.high:bar.low;seq.aIndex=index;seq.correctionExtreme=seq.a;
  const lv=sequenceLevels(seq.zero,seq.a,seq.side,cfg);
  seq.gate=lv.gate;seq.entries=lv.entries.map(x=>({...x,filled:false}));seq.targets=lv.targets.map(x=>({...x,hit:false}));
}

function updateDoubleAdvantage(seq,bar){
  seq.correctionExtreme=seq.side==='LONG'?Math.min(seq.correctionExtreme,bar.low):Math.max(seq.correctionExtreme,bar.high);
  const parent=seq.side==='LONG'
    ?{low:seq.zero,high:seq.a,direction:'UP'}
    :{low:seq.a,high:seq.zero,direction:'DOWN'};
  const child=seq.side==='LONG'
    ?{low:seq.correctionExtreme,high:seq.a,direction:'DOWN'}
    :{low:seq.a,high:seq.correctionExtreme,direction:'UP'};
  if(!(child.high>child.low))return;
  const da=skDoubleAdvantage(parent,child);
  if(da.candidate&&!seq.doubleAdvantage)seq.doubleAdvantage={...da,detected:true};
}

function newPosition(seq){
  return{
    side:seq.side,qty:0,initialQty:0,avgEntry:0,entryNotional:0,entryFees:0,remainingQty:0,
    realizedPnl:0,fees:0,openedAt:null,closedAt:null,exitReason:null,targetHits:[],tranches:[]
  };
}

function fillEntries(seq,bar,index,equity,cfg,events){
  if(!seq.gateTouched)return;
  if(!seq.position)seq.position=newPosition(seq);
  for(const e of seq.entries){
    if(e.filled||!finite(e.price)||!touched(bar,e.price,seq.side))continue;
    const entry=adverseFill(e.price,seq.side,true,cfg),riskSlice=cfg.riskPct/cfg.entryRatios.length;
    let sizing;
    try{sizing=costAwareSize({entry,sl:seq.zero,side:seq.side,equity,riskPct:riskSlice,feeBps:cfg.feeBps,slippageBps:cfg.slippageBps});}
    catch{continue}
    const qty=sizing.qty,fee=entry*qty*cfg.feeBps/10000,p=seq.position;
    p.entryNotional+=entry*qty;p.qty+=qty;p.initialQty+=qty;p.remainingQty+=qty;p.avgEntry=p.entryNotional/p.qty;p.entryFees+=fee;p.fees+=fee;p.realizedPnl-=fee;
    p.openedAt??=bar.openTime;e.filled=true;e.fillPrice=entry;e.qty=qty;e.filledAt=bar.openTime;
    p.tranches.push({ratio:e.ratio,level:e.price,fill:entry,qty,fee,at:bar.openTime,plannedRiskUsd:sizing.plannedRiskBudgetUsd});
    if(seq.state!=='ACTIVE'){seq.state='ACTIVE';events.push({type:'ACTIVE',at:bar.openTime,sequenceId:seq.id,side:seq.side})}
    events.push({type:'ENTRY',at:bar.openTime,sequenceId:seq.id,side:seq.side,ratio:e.ratio,price:round(entry),qty:round(qty,8)});
  }
}

function exitQty(seq,level,fraction,bar,cfg,events,reason){
  const p=seq.position;if(!p||p.remainingQty<=0)return 0;
  const qty=fraction>=1?p.remainingQty:Math.min(p.remainingQty,p.initialQty*fraction);
  if(!(qty>0))return 0;
  const exit=adverseFill(level,seq.side,false,cfg),gross=(exit-p.avgEntry)*qty*dir(seq.side),fee=exit*qty*cfg.feeBps/10000;
  p.remainingQty-=qty;p.realizedPnl+=gross-fee;p.fees+=fee;
  events.push({type:reason,at:bar.openTime,sequenceId:seq.id,side:seq.side,price:round(exit),qty:round(qty,8),gross:round(gross),fee:round(fee)});
  return qty;
}

function closeStop(seq,bar,cfg,events){
  const p=seq.position;if(!p||p.remainingQty<=0)return;
  exitQty(seq,seq.zero,1,bar,cfg,events,'STOP');
  p.closedAt=bar.openTime;p.exitReason='ORIGIN_INVALIDATION';seq.state='INVALID';
}

function processTargets(seq,bar,cfg,events){
  const p=seq.position;if(!p||p.remainingQty<=0)return;
  for(let i=0;i<seq.targets.length;i++){
    const t=seq.targets[i];if(t.hit||!targetTouched(bar,t.price,seq.side))continue;
    const fraction=i===seq.targets.length-1?1:cfg.targetFractions[i];
    const q=exitQty(seq,t.price,fraction,bar,cfg,events,'TP');
    if(q>0){t.hit=true;p.targetHits.push({ratio:t.ratio,price:t.price,at:bar.openTime});seq.state=i===0?'TP1':i===1?'TP2':'COMPLETE'}
    if(p.remainingQty<=1e-12){p.remainingQty=0;p.closedAt=bar.openTime;p.exitReason='TARGET_COMPLETE';seq.state='COMPLETE';break}
  }
}

function unrealized(seq,close){
  const p=seq?.position;if(!p||p.remainingQty<=0)return 0;
  return (close-p.avgEntry)*p.remainingQty*dir(seq.side);
}

function tradeRecord(seq){
  const p=seq.position;if(!p)return null;
  return{
    sequenceId:seq.id,side:seq.side,state:seq.state,zero:seq.zero,a:seq.a,gate:seq.gate,
    longShortZone:skLongShortZones(Math.min(seq.zero,seq.a),Math.max(seq.zero,seq.a)),
    targetZone:skTargetZone(Math.min(seq.zero,seq.a),Math.max(seq.zero,seq.a),seq.side==='LONG'?'UP':'DOWN'),
    doubleAdvantage:!!seq.doubleAdvantage?.candidate,doubleAdvantageOverlap:seq.doubleAdvantage?.overlap||null,
    openedAt:p.openedAt,closedAt:p.closedAt,exitReason:p.exitReason,avgEntry:round(p.avgEntry),qty:round(p.initialQty,8),
    entryRatios:seq.entries.filter(x=>x.filled).map(x=>x.ratio),targetRatios:p.targetHits.map(x=>x.ratio),
    fees:round(p.fees),realizedPnl:round(p.realizedPnl),tranches:clone(p.tranches)
  };
}

function stats(trades,startEquity,maxDrawdownPct){
  const closed=(trades||[]).filter(t=>finite(t.realizedPnl)),wins=closed.filter(t=>t.realizedPnl>0),losses=closed.filter(t=>t.realizedPnl<0);
  const grossWin=wins.reduce((a,t)=>a+t.realizedPnl,0),grossLoss=Math.abs(losses.reduce((a,t)=>a+t.realizedPnl,0)),pnl=closed.reduce((a,t)=>a+t.realizedPnl,0);
  const da=closed.filter(t=>t.doubleAdvantage),longs=closed.filter(t=>t.side==='LONG'),shorts=closed.filter(t=>t.side==='SHORT');
  return{
    trades:closed.length,wins:wins.length,losses:losses.length,winRate:closed.length?wins.length/closed.length*100:0,
    pnl,endEquity:startEquity+pnl,profitFactor:grossLoss>0?grossWin/grossLoss:(grossWin>0?99:0),expectancy:closed.length?pnl/closed.length:0,
    maxDrawdownPct,longTrades:longs.length,shortTrades:shorts.length,longPnl:longs.reduce((a,t)=>a+t.realizedPnl,0),shortPnl:shorts.reduce((a,t)=>a+t.realizedPnl,0),
    doubleAdvantageTrades:da.length,doubleAdvantagePnl:da.reduce((a,t)=>a+t.realizedPnl,0),fees:closed.reduce((a,t)=>a+(t.fees||0),0)
  };
}

export function replaySkPaperBot(input,{config={},closeAtEnd=true}={}){
  const cfg={...SK_PAPERBOT_V1_CONFIG,...config,entryRatios:[...(config.entryRatios||SK_PAPERBOT_V1_CONFIG.entryRatios)],targetRatios:[...(config.targetRatios||SK_PAPERBOT_V1_CONFIG.targetRatios)],targetFractions:[...(config.targetFractions||SK_PAPERBOT_V1_CONFIG.targetFractions)]};
  const rows=normalizeSkCandles(input),minBars=Math.max(8,cfg.pivotLeft+cfg.pivotRight+5);if(rows.length<minBars)return{ruleset:SK_PAPERBOT_V1_RULESET,researchOnly:true,executionImpact:false,autoPromotion:false,config:cfg,summary:stats([],cfg.startEquity,0),trades:[],events:[],latestState:'WAITING_DATA',latestSequence:null};
  let seed=null,seq=null,seqNo=0,realized=0,peak=cfg.startEquity,maxDD=0;
  const trades=[],events=[];
  for(let i=0;i<rows.length;i++){
    const bar=rows[i];
    if(seq){
      refreshImpulse(seq,bar,i,cfg);
      updateDoubleAdvantage(seq,bar);
      const invalid=stopTouched(bar,seq.zero,seq.side);
      if(invalid){
        if(seq.position?.remainingQty>0){closeStop(seq,bar,cfg,events);realized+=seq.position.realizedPnl;trades.push(tradeRecord(seq))}
        else events.push({type:'INVALID',at:bar.openTime,sequenceId:seq.id,side:seq.side,reason:'ORIGIN_INVALIDATION'});
        seq=null;seed=null;
      }else if(seq){
        if(!seq.gateTouched&&touched(bar,seq.gate,seq.side)){seq.gateTouched=true;seq.gateAt=bar.openTime;seq.state='B_FORMING';events.push({type:'GATE',at:bar.openTime,sequenceId:seq.id,side:seq.side,ratio:cfg.gateRatio,price:round(seq.gate)})}
        if(seq.gateTouched&&!seq.position){
          const missed=seq.side==='LONG'?bar.high>seq.a:bar.low<seq.a;
          if(missed&&!cfg.entryRatios.some(r=>touched(bar,levelPrice(sequenceLevels(seq.zero,seq.a,seq.side,cfg).levels,r),seq.side))){
            events.push({type:'MISSED',at:bar.openTime,sequenceId:seq.id,side:seq.side,reason:'RETURNED_THROUGH_A_WITHOUT_ENTRY'});seq=null;seed=null;
          }
        }
        if(seq){
          if(seq.position?.remainingQty>0&&stopTouched(bar,seq.zero,seq.side)){closeStop(seq,bar,cfg,events);realized+=seq.position.realizedPnl;trades.push(tradeRecord(seq));seq=null;seed=null}
          else{
            const equity=Math.max(1,cfg.startEquity+realized+Number(seq?.position?.realizedPnl||0)+unrealized(seq,bar.close));
            fillEntries(seq,bar,i,equity,cfg,events);
            if(seq?.position?.remainingQty>0){processTargets(seq,bar,cfg,events);if(['COMPLETE'].includes(seq.state)){realized+=seq.position.realizedPnl;trades.push(tradeRecord(seq));seq=null;seed=null}}
          }
        }
      }
    }
    if(!seq){
      const p=pivotAt(rows,i,cfg);
      if(p){
        if(!seed)seed=p;
        else if(seed.type===p.type){
          const stronger=p.type==='HIGH'?p.price>seed.price:p.price<seed.price;if(stronger)seed=p;
        }else{
          const candidate=makeSequence(seed,p,cfg,++seqNo);
          seed=p;
          if(candidate){seq=candidate;events.push({type:'SEQUENCE',at:bar.openTime,sequenceId:seq.id,side:seq.side,zero:round(seq.zero),a:round(seq.a),state:'SEQUENCE'})}
        }
      }
    }
    const equity=cfg.startEquity+realized+Number(seq?.position?.realizedPnl||0)+unrealized(seq,bar.close);peak=Math.max(peak,equity);const dd=peak>0?(peak-equity)/peak*100:0;maxDD=Math.max(maxDD,dd);
  }
  const latestSequence=seq?clone(seq):null,latestState=seq?.state||events.at(-1)?.type||'SEARCH';
  if(closeAtEnd&&seq?.position?.remainingQty>0){
    const bar=rows.at(-1),p=seq.position,exit=adverseFill(bar.close,seq.side,false,cfg),gross=(exit-p.avgEntry)*p.remainingQty*dir(seq.side),fee=exit*p.remainingQty*cfg.feeBps/10000;
    p.realizedPnl+=gross-fee;p.fees+=fee;p.remainingQty=0;p.closedAt=bar.openTime;p.exitReason='END_OF_SAMPLE';seq.state='COMPLETE';events.push({type:'END_OF_SAMPLE',at:bar.openTime,sequenceId:seq.id,side:seq.side,price:round(exit)});
    realized+=p.realizedPnl;trades.push(tradeRecord(seq));
  }
  const summary=stats(trades,cfg.startEquity,maxDD);
  return{ruleset:SK_PAPERBOT_V1_RULESET,researchOnly:true,executionImpact:false,autoPromotion:false,config:cfg,summary,trades,events:events.slice(-300),latestState,latestSequence};
}

export function skChronologicalStability(trades,parts=5){
  const rows=[...(trades||[])].filter(t=>finite(t.openedAt)).sort((a,b)=>a.openedAt-b.openedAt);
  if(!rows.length)return{windows:[],positiveWindows:0,adequateWindows:0};
  const min=rows[0].openedAt,max=rows.at(-1).openedAt,span=Math.max(1,max-min+1),windows=[];
  for(let i=0;i<parts;i++){
    const from=min+span*i/parts,to=i===parts-1?max+1:min+span*(i+1)/parts,sub=rows.filter(t=>t.openedAt>=from&&t.openedAt<to);
    const s=stats(sub,10000,0);windows.push({i:i+1,from,to,trades:s.trades,pnl:s.pnl,profitFactor:s.profitFactor,expectancy:s.expectancy,positive:s.pnl>0});
  }
  return{windows,positiveWindows:windows.filter(x=>x.positive).length,adequateWindows:windows.filter(x=>x.trades>=3).length};
}

export function evaluateSkPaperGate(summary,stability,cfg=SK_PAPERBOT_V1_CONFIG){
  const g=cfg.researchGate,reasons=[];
  if((summary?.trades||0)<g.minTrades)reasons.push('SAMPLE_LT_'+g.minTrades);
  if((summary?.profitFactor||0)<g.minProfitFactor)reasons.push('PF_LT_'+g.minProfitFactor);
  if(!finite(summary?.expectancy)||summary.expectancy<=0)reasons.push('EXPECTANCY_NOT_POSITIVE');
  if((summary?.maxDrawdownPct??Infinity)>g.maxDrawdownPct)reasons.push('DRAWDOWN_GT_'+g.maxDrawdownPct+'PCT');
  if((stability?.positiveWindows||0)<g.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+g.minPositiveWindows);
  return{pass:reasons.length===0,reasons,autoPromotion:false,label:reasons.length?'RESEARCH_GATE_FAIL':'RESEARCH_GATE_PASS'};
}

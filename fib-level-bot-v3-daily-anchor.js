// MERIDIAN FIB Level Bot V3 — confirmed daily anchors, 4h execution.
// Research only. Entries and exits use frozen Fibonacci prices only.

const DAY=86400000;
const PIVOT_DAYS=2;
const RATIOS=Object.freeze([0.382,0.500,0.618,0.786]);
const WEIGHT=0.25;
const COST_RATE=0.001;
const n=v=>Number.isFinite(Number(v))?Number(v):null;

function dailyBars(xs){
  const m=new Map();
  for(const r of xs){
    const t=Math.floor(r.t/DAY)*DAY,b=m.get(t);
    if(!b)m.set(t,{t,o:r.o,h:r.h,l:r.l,c:r.c});
    else{b.h=Math.max(b.h,r.h);b.l=Math.min(b.l,r.l);b.c=r.c}
  }
  return [...m.values()].sort((a,b)=>a.t-b.t).filter(x=>xs.some(r=>r.t===x.t+20*3600000));
}
function pivots(ds){
  const out=[];
  for(let i=PIVOT_DAYS;i<ds.length-PIVOT_DAYS;i++){
    const b=ds[i],others=ds.slice(i-PIVOT_DAYS,i).concat(ds.slice(i+1,i+PIVOT_DAYS+1));
    const high=others.every(x=>b.h>x.h),low=others.every(x=>b.l<x.l);
    if(high===low)continue;
    out.push({type:high?'HIGH':'LOW',price:high?b.h:b.l,t:b.t,confirmedAt:ds[i+PIVOT_DAYS].t+DAY});
  }
  return out;
}
function ema(values,p){const k=2/(p+1),out=[];let e=null;for(const v of values){e=e==null?v:e+k*(v-e);out.push(e)}return out}
function regimeAt(xs,i,e50,e200){if(i<199)return 'UNKNOWN';const spread=Math.abs(e50[i]-e200[i]),range=(xs[i].h-xs[i].l)||1;if(spread<=.5*range)return 'RANGE';if(e50[i]>e200[i]&&xs[i].c>e50[i])return 'BULL';if(e50[i]<e200[i]&&xs[i].c<e50[i])return 'BEAR';return 'TRANSITION'}
function setupFromPair(a,b,regime,id){
  let side;if(a.type==='LOW'&&b.type==='HIGH'&&b.price>a.price)side='LONG';else if(a.type==='HIGH'&&b.type==='LOW'&&b.price<a.price)side='SHORT';else return null;
  const leg=Math.abs(b.price-a.price),priceAt=r=>side==='LONG'?b.price-leg*r:b.price+leg*r;
  return {id,side,createdAt:b.confirmedAt,regime,origin:a.price,extreme:b.price,leg,stop:priceAt(1),tp1:priceAt(.236),tp2:priceAt(0),levels:RATIOS.map(r=>({ratio:r,price:priceAt(r),weight:WEIGHT,filled:false})),fills:[],status:'PENDING',tp1Done:false,rawPnl:0,cost:0,firstFillAt:null,firstFillIndex:null,closedAt:null,closedIndex:null,exit:'',deepestRatio:null};
}
const touched=(bar,side,price)=>side==='LONG'?bar.l<=price:bar.h>=price;
const targetTouched=(bar,side,price)=>side==='LONG'?bar.h>=price:bar.l<=price;
function conservativeFill(bar,side,price){if(side==='LONG'&&bar.o<price)return bar.o;if(side==='SHORT'&&bar.o>price)return bar.o;return price}
function closeFraction(s,price,fraction){for(const f of s.fills){const qty=f.remaining*fraction;if(!(qty>0))continue;s.rawPnl+=qty*(s.side==='LONG'?(price-f.price)/f.price:(f.price-price)/f.price);s.cost+=qty*COST_RATE;f.remaining-=qty}}
const openWeight=s=>s.fills.reduce((sum,f)=>sum+f.remaining,0);
function finish(s,bar,index,exit){const risk=s.fills.reduce((sum,f)=>sum+f.weight*Math.abs(f.price-s.stop)/f.price,0),net=s.rawPnl-s.cost;s.status='CLOSED';s.closedAt=bar.t;s.closedIndex=index;s.exit=exit;s.netR=risk>0?net/risk:null;s.maxRiskPct=risk;s.timeInMarketBars=s.firstFillIndex==null?0:index-s.firstFillIndex+1;return s}

export function runFibDailyAnchorBot(bars=[],meta={}){
  const xs=bars.map(b=>({t:n(b.t),o:n(b.o),h:n(b.h),l:n(b.l),c:n(b.c)})).filter(b=>Object.values(b).every(Number.isFinite)).sort((a,b)=>a.t-b.t);
  const signals=pivots(dailyBars(xs)),e50=ema(xs.map(x=>x.c),50),e200=ema(xs.map(x=>x.c),200),closed=[],allSetups=[];
  let active=null,lastPivot=null,signalIndex=0,setupSeq=0,replacements=0,unfilledInvalidations=0;
  for(let i=0;i<xs.length;i++){
    const bar=xs[i];
    if(active){
      const hadOpen=openWeight(active)>1e-12;let newFill=false;
      for(const level of active.levels){if(level.filled||!touched(bar,active.side,level.price))continue;const price=conservativeFill(bar,active.side,level.price);level.filled=true;active.fills.push({ratio:level.ratio,price,weight:level.weight,remaining:level.weight});active.status='OPEN';active.firstFillAt??=bar.t;active.firstFillIndex??=i;active.deepestRatio=Math.max(active.deepestRatio||0,level.ratio);newFill=true}
      const hasOpen=openWeight(active)>1e-12;
      if(hasOpen&&touched(bar,active.side,active.stop)){closeFraction(active,active.stop,1);closed.push(finish(active,bar,i,'STOP_1.000'));active=null}
      else if(hasOpen&&hadOpen&&!newFill){if(!active.tp1Done&&targetTouched(bar,active.side,active.tp1)){closeFraction(active,active.tp1,.5);active.tp1Done=true;for(const level of active.levels)if(!level.filled)level.cancelled=true}if(active&&targetTouched(bar,active.side,active.tp2)){closeFraction(active,active.tp2,1);closed.push(finish(active,bar,i,'TP2_0.000'));active=null}}
      else if(!hasOpen&&(touched(bar,active.side,active.stop)||targetTouched(bar,active.side,active.tp2))){active.status='UNFILLED_INVALIDATED';active.closedAt=bar.t;active.closedIndex=i;unfilledInvalidations++;active=null}
    }
    while(signalIndex<signals.length&&signals[signalIndex].confirmedAt<=bar.t){
      const pivot=signals[signalIndex++];
      if(lastPivot?.type===pivot.type){const moreExtreme=pivot.type==='HIGH'?pivot.price>lastPivot.price:pivot.price<lastPivot.price;if(moreExtreme)lastPivot=pivot;continue}
      if(lastPivot){const candidate=setupFromPair(lastPivot,pivot,regimeAt(xs,i,e50,e200),`${meta.symbol||'ASSET'}-D1H4-${++setupSeq}`);if(candidate){if(!active){active=candidate;allSetups.push(candidate)}else if(active.status==='PENDING'){active.status='REPLACED';active.closedAt=bar.t;active.closedIndex=i;replacements++;active=candidate;allSetups.push(candidate)}}}
      lastPivot=pivot;
    }
  }
  const open=active&&openWeight(active)>1e-12?[active]:[],pending=active&&active.status==='PENDING'?[active]:[];
  return {schemaVersion:'FIB-LEVEL-BOT-V3-DAILY-ANCHOR',researchOnly:true,executionImpact:false,symbol:meta.symbol||null,timeframe:'daily-anchor/4h-execution',closed,open,pending,setups:allSetups,opportunity:{setups:allSetups.length,filledBaskets:allSetups.filter(s=>s.fills.length).length,closedBaskets:closed.length,replacements,unfilledInvalidations,openBaskets:open.length,pendingMaps:pending.length}};
}

export const FIB_LEVEL_BOT_V3=Object.freeze({pivotDays:PIVOT_DAYS,ratios:RATIOS,weight:WEIGHT,costRate:COST_RATE,symbols:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']),primaryStart:'2023-09-06T14:15:00.000Z',secondaryStart:'2024-09-06T14:15:00.000Z',secondaryYear2:'2025-09-06T14:15:00.000Z',holdoutStart:'2026-09-06T14:15:00.000Z'});

export function evaluateFibV3(primary,secondaryYears,secondaryAggregate){
  const summary=primary?.summary||{},folds=primary?.walkForward||[],sides=primary?.bySide||{},assets=primary?.bySymbol||{},groups=primary?.byUniverseGroup||{};
  const positiveAssets=Object.values(assets).filter(x=>(x?.closedBaskets||0)>=15&&(x?.profitFactor||0)>1&&(x?.expectancy||0)>0).length;
  const shares=Object.values(primary?.positiveNetRConcentrationPct||{}).filter(Number.isFinite);
  const edge=x=>(x?.profitFactor||0)>1&&(x?.expectancy||0)>0;
  const gates={primarySample:(summary.closedBaskets||0)>=100,primaryEdge:(summary.profitFactor||0)>=1.10&&(summary.expectancy||0)>0,allPrimaryFolds:folds.length===3&&folds.every(x=>edge(x.summary)),bothSides:['LONG','SHORT'].every(k=>(sides[k]?.closedBaskets||0)>=30&&edge(sides[k])),assetBreadth:positiveAssets>=5,universeBreadth:['CORE','EXPANSION'].every(k=>(groups[k]?.expectancy??-Infinity)>=0),concentration:shares.length>0&&Math.max(...shares)<=40,eachSecondaryYear:Array.isArray(secondaryYears)&&secondaryYears.length===2&&secondaryYears.every(x=>edge(x.summary)),secondaryAggregate:edge(secondaryAggregate?.summary)};
  return {schemaVersion:'FIB-LEVEL-BOT-V3-HISTORICAL-GATE',researchOnly:true,executionImpact:false,gates,historicallyRobust:Object.values(gates).every(Boolean),promotionPermitted:false,positiveAssets};
}

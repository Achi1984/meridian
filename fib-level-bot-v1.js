// MERIDIAN FIB Level Bot V1 — price-only, research-only harness.
// Entries/exits use frozen FIB prices only. Pivots are confirmed 3 bars later.

const RATIOS=Object.freeze([0.382,0.500,0.618,0.786]);
const WEIGHT=0.25;
const COST_RATE=0.001;
const PIVOT_BARS=3;
const ATR_PERIOD=14;
const MIN_LEG_ATR=1.5;

const n=v=>Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=6)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;

function trueRanges(bars){
  return bars.map((b,i)=>i?Math.max(b.h-b.l,Math.abs(b.h-bars[i-1].c),Math.abs(b.l-bars[i-1].c)):b.h-b.l);
}
function rollingAtr(bars,p=ATR_PERIOD){
  const tr=trueRanges(bars),out=[];let sum=0;
  for(let i=0;i<tr.length;i++){sum+=tr[i];if(i>=p)sum-=tr[i-p];out.push(i>=p-1?sum/p:null)}
  return out;
}
function ema(values,p){
  const k=2/(p+1),out=[];let e=null;
  for(const v of values){e=e==null?v:e+k*(v-e);out.push(e)}
  return out;
}
function regimeAt(bars,i,atr,e50,e200){
  const a=atr[i];if(!(a>0)||i<199)return 'UNKNOWN';
  const spread=Math.abs(e50[i]-e200[i]);
  if(spread<=.5*a)return 'RANGE';
  if(e50[i]>e200[i]&&bars[i].c>e50[i])return 'BULL';
  if(e50[i]<e200[i]&&bars[i].c<e50[i])return 'BEAR';
  return 'TRANSITION';
}
function confirmedPivot(bars,confirmIndex){
  const i=confirmIndex-PIVOT_BARS;if(i<PIVOT_BARS)return null;
  const b=bars[i],others=bars.slice(i-PIVOT_BARS,i).concat(bars.slice(i+1,i+PIVOT_BARS+1));
  const high=others.every(x=>b.h>x.h),low=others.every(x=>b.l<x.l);
  if(high===low)return null;
  return {type:high?'HIGH':'LOW',index:i,confirmedIndex:confirmIndex,t:b.t,confirmedAt:bars[confirmIndex].t,price:high?b.h:b.l};
}
function setupFromPair(a,b,atrValue,regime,id){
  if(!(atrValue>0)||Math.abs(b.price-a.price)<MIN_LEG_ATR*atrValue)return null;
  let side;if(a.type==='LOW'&&b.type==='HIGH'&&b.price>a.price)side='LONG';
  else if(a.type==='HIGH'&&b.type==='LOW'&&b.price<a.price)side='SHORT';
  else return null;
  const leg=Math.abs(b.price-a.price),extreme=b.price,origin=a.price;
  const priceAt=r=>side==='LONG'?extreme-leg*r:extreme+leg*r;
  return {id,side,createdAt:b.confirmedAt,createdIndex:b.confirmedIndex,regime,origin,extreme,leg,stop:priceAt(1),tp1:priceAt(.236),tp2:priceAt(0),levels:RATIOS.map(r=>({ratio:r,price:priceAt(r),weight:WEIGHT,filled:false})),fills:[],status:'PENDING',tp1Done:false,rawPnl:0,cost:0,firstFillAt:null,firstFillIndex:null,closedAt:null,closedIndex:null,exit:'',deepestRatio:null};
}
function touched(bar,side,price){return side==='LONG'?bar.l<=price:bar.h>=price}
function targetTouched(bar,side,price){return side==='LONG'?bar.h>=price:bar.l<=price}
function conservativeFill(bar,side,price){
  if(side==='LONG'&&bar.o<price)return bar.o;
  if(side==='SHORT'&&bar.o>price)return bar.o;
  return price;
}
function closeFraction(s,price,fraction){
  for(const f of s.fills){
    const qty=f.remaining*fraction;if(!(qty>0))continue;
    s.rawPnl+=qty*(s.side==='LONG'?(price-f.price)/f.price:(f.price-price)/f.price);
    s.cost+=qty*COST_RATE;f.remaining-=qty;
  }
}
function finish(s,bar,index,exit){
  const risk=s.fills.reduce((sum,f)=>sum+f.weight*Math.abs(f.price-s.stop)/f.price,0);
  const net=s.rawPnl-s.cost;
  s.status='CLOSED';s.closedAt=bar.t;s.closedIndex=index;s.exit=exit;s.netR=risk>0?net/risk:null;s.maxRiskPct=risk;s.timeInMarketBars=s.firstFillIndex==null?0:index-s.firstFillIndex+1;
  return s;
}
function openWeight(s){return s.fills.reduce((sum,f)=>sum+f.remaining,0)}

export function runFibLevelBot(bars=[],meta={}){
  const xs=bars.map(b=>({t:n(b.t),o:n(b.o),h:n(b.h),l:n(b.l),c:n(b.c)})).filter(b=>Object.values(b).every(Number.isFinite)).sort((a,b)=>a.t-b.t);
  const atr=rollingAtr(xs),closes=xs.map(x=>x.c),e50=ema(closes,50),e200=ema(closes,200);
  const closed=[],allSetups=[];let active=null,lastPivot=null,setupSeq=0,replacements=0,unfilledInvalidations=0;
  for(let i=0;i<xs.length;i++){
    const bar=xs[i];
    if(active){
      const hadOpen=openWeight(active)>1e-12;let newFill=false;
      for(const level of active.levels){
        if(level.filled||!touched(bar,active.side,level.price))continue;
        const fillPrice=conservativeFill(bar,active.side,level.price);
        level.filled=true;active.fills.push({ratio:level.ratio,price:fillPrice,weight:level.weight,remaining:level.weight});
        active.status='OPEN';active.firstFillAt??=bar.t;active.firstFillIndex??=i;active.firstRatio??=level.ratio;active.deepestRatio=Math.max(active.deepestRatio||0,level.ratio);newFill=true;
      }
      const hasOpen=openWeight(active)>1e-12;
      if(hasOpen&&touched(bar,active.side,active.stop)){
        closeFraction(active,active.stop,1);closed.push(finish(active,bar,i,'STOP_1.000'));active=null;
      }else if(hasOpen&&hadOpen&&!newFill){
        if(!active.tp1Done&&targetTouched(bar,active.side,active.tp1)){
          closeFraction(active,active.tp1,.5);active.tp1Done=true;
          for(const level of active.levels)if(!level.filled)level.cancelled=true;
        }
        if(active&&targetTouched(bar,active.side,active.tp2)){
          closeFraction(active,active.tp2,1);closed.push(finish(active,bar,i,'TP2_0.000'));active=null;
        }
      }else if(!hasOpen&&(touched(bar,active.side,active.stop)||targetTouched(bar,active.side,active.tp2))){
        active.status='UNFILLED_INVALIDATED';active.closedAt=bar.t;active.closedIndex=i;unfilledInvalidations++;active=null;
      }
    }

    const pivot=confirmedPivot(xs,i);
    if(!pivot)continue;
    if(lastPivot?.type===pivot.type){
      const moreExtreme=pivot.type==='HIGH'?pivot.price>lastPivot.price:pivot.price<lastPivot.price;
      if(moreExtreme)lastPivot=pivot;
      continue;
    }
    if(lastPivot){
      const candidate=setupFromPair(lastPivot,pivot,atr[i],regimeAt(xs,i,atr,e50,e200),`${meta.symbol||'ASSET'}-${meta.timeframe||'TF'}-${++setupSeq}`);
      if(candidate){
        if(!active){active=candidate;allSetups.push(candidate)}
        else if(active.status==='PENDING'){active.status='REPLACED';active.closedAt=bar.t;active.closedIndex=i;replacements++;active=candidate;allSetups.push(candidate)}
      }
    }
    lastPivot=pivot;
  }
  const open=active&&openWeight(active)>1e-12?[active]:[];
  const pending=active&&active.status==='PENDING'?[active]:[];
  return {schemaVersion:'FIB-LEVEL-BOT-V1',researchOnly:true,executionImpact:false,symbol:meta.symbol||null,timeframe:meta.timeframe||null,closed,open,pending,setups:allSetups,opportunity:{setups:allSetups.length,filledBaskets:allSetups.filter(s=>s.fills.length).length,closedBaskets:closed.length,replacements,unfilledInvalidations,openBaskets:open.length,pendingMaps:pending.length}};
}

export const FIB_LEVEL_BOT_V1=Object.freeze({ratios:RATIOS,weight:WEIGHT,costRate:COST_RATE,pivotBars:PIVOT_BARS,atrPeriod:ATR_PERIOD,minLegAtr:MIN_LEG_ATR});

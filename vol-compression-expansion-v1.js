// MERIDIAN Volatility Compression Expansion V1 — predeclared research engine.
// Research only. No state writes, Paper/live execution or exchange order path.

const H4=4*3600000,DAY=86400000;
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=8)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

export const VOL_COMPRESSION_EXPANSION_V1=Object.freeze({
  version:'VOL-COMPRESSION-EXPANSION-V1',
  symbols:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']),
  atrPeriod:14,rangeBars:12,percentileLookback:126,compressionPercentile:.25,compressionStreak:3,
  boxBars:12,armedBars:6,expansionAtrMultiple:1.25,stopAtrMultiple:1.5,targetR:2.5,
  breakEvenTriggerR:1,maxHoldMs:7*DAY,roundTripCostRate:.0016,warmupDays:260,
  primaryStart:'2022-09-06T00:00:00.000Z',primaryEnd:'2024-09-06T00:00:00.000Z',
  secondaryStart:'2024-09-06T00:00:00.000Z',secondaryEnd:'2026-09-06T00:00:00.000Z'
});

function normalize(bars=[]){
  return bars.map(x=>({t:n(x.t),o:n(x.o),h:n(x.h),l:n(x.l),c:n(x.c)}))
    .filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)&&x.o>0&&x.c>0&&x.h>=x.l&&x.h>=x.o&&x.h>=x.c&&x.l<=x.o&&x.l<=x.c)
    .sort((a,b)=>a.t-b.t)
    .filter((x,i,a)=>!i||x.t!==a[i-1].t);
}
function tr(xs,i){
  if(i<=0)return xs[i].h-xs[i].l;
  const x=xs[i],p=xs[i-1].c;
  return Math.max(x.h-x.l,Math.abs(x.h-p),Math.abs(x.l-p));
}
function atrWilder(xs,period){
  const out=Array(xs.length).fill(null);if(xs.length<period+1)return out;
  let a=0;for(let i=1;i<=period;i++)a+=tr(xs,i);a/=period;out[period]=a;
  for(let i=period+1;i<xs.length;i++){a=(a*(period-1)+tr(xs,i))/period;out[i]=a;}
  return out;
}
function extrema(xs,start,end,key,mode){
  let v=mode==='max'?-Infinity:Infinity;
  for(let i=Math.max(0,start);i<=end;i++)v=mode==='max'?Math.max(v,xs[i][key]):Math.min(v,xs[i][key]);
  return Number.isFinite(v)?v:null;
}
function percentile(values,p){
  const a=values.filter(Number.isFinite).slice().sort((x,y)=>x-y);
  if(!a.length)return null;const i=Math.floor((a.length-1)*p);return a[i];
}
function costBreakEven(entry,side,costRate){return side==='LONG'?entry*(1+costRate):entry*(1-costRate);}
function closeTrade(p,exit,closedAt,reason,cfg){
  const dir=p.side==='LONG'?1:-1,riskFraction=p.initialRisk/p.entry,grossFraction=dir*(exit-p.entry)/p.entry;
  const grossR=riskFraction>0?grossFraction/riskFraction:null,costR=riskFraction>0?cfg.roundTripCostRate/riskFraction:null;
  return {...p,status:'CLOSED',exit:round(exit,10),closedAt,exitReason:reason,grossR:round(grossR,6),costR:round(costR,6),netR:round(grossR-costR,6)};
}

export function runVolCompressionExpansionV1(bars=[],meta={},overrides={}){
  const cfg={...VOL_COMPRESSION_EXPANSION_V1,...overrides},xs=normalize(bars),atr=atrWilder(xs,cfg.atrPeriod);
  const entryStart=Number.isFinite(Number(meta.entryStart))?Number(meta.entryStart):-Infinity;
  const entryEnd=Number.isFinite(Number(meta.entryEnd))?Number(meta.entryEnd):Infinity;
  const natr=atr.map((a,i)=>Number.isFinite(a)&&xs[i]?.c>0?a/xs[i].c:null);
  const widths=xs.map((x,i)=>i>=cfg.rangeBars-1?(extrema(xs,i-cfg.rangeBars+1,i,'h','max')-extrema(xs,i-cfg.rangeBars+1,i,'l','min'))/x.c:null);
  const compressed=Array(xs.length).fill(false);
  for(let i=0;i<xs.length;i++){
    if(!Number.isFinite(natr[i])||!Number.isFinite(widths[i])||i<cfg.percentileLookback)continue;
    const a=natr.slice(i-cfg.percentileLookback,i),w=widths.slice(i-cfg.percentileLookback,i);
    if(a.length!==cfg.percentileLookback||w.length!==cfg.percentileLookback||a.some(x=>!Number.isFinite(x))||w.some(x=>!Number.isFinite(x)))continue;
    compressed[i]=natr[i]<=percentile(a,cfg.compressionPercentile)&&widths[i]<=percentile(w,cfg.compressionPercentile);
  }

  const closed=[],signals=[],armedHistory=[];let position=null,pending=null,armed=null,streak=0,closedThisBar=false;
  for(let i=0;i<xs.length;i++){
    const bar=xs[i];closedThisBar=false;

    if(!position&&pending){
      if(bar.t>=entryEnd){pending=null;}
      else{
        const entry=bar.o,risk=cfg.stopAtrMultiple*pending.atr;
        if(entry>0&&risk>0){
          const side=pending.side,stop=side==='LONG'?entry-risk:entry+risk,target=side==='LONG'?entry+cfg.targetR*risk:entry-cfg.targetR*risk;
          if(stop>0&&target>0)position={id:`${meta.symbol||'ASSET'}-${side}-${pending.signalAt}`,symbol:meta.symbol||null,side,status:'OPEN',
            armedAt:pending.armedAt,signalAt:pending.signalAt,openedAt:bar.t,entry:round(entry,10),initialStop:round(stop,10),stop:round(stop,10),
            target:round(target,10),initialRisk:round(risk,10),signalAtr:round(pending.atr,10),boxHigh:pending.boxHigh,boxLow:pending.boxLow,
            breakEvenActive:false,breakEvenEligible:false,maxFavR:0,maxAdvR:0};
        }
        pending=null;
      }
    }

    if(position){
      const p=position,dir=p.side==='LONG'?1:-1,risk=p.initialRisk;
      const stopHit=p.side==='LONG'?bar.l<=p.stop:bar.h>=p.stop;
      const targetHit=p.side==='LONG'?bar.h>=p.target:bar.l<=p.target;
      const fav=p.side==='LONG'?bar.h-p.entry:p.entry-bar.l,adv=p.side==='LONG'?p.entry-bar.l:bar.h-p.entry;
      p.maxFavR=Math.max(p.maxFavR,fav/risk);p.maxAdvR=Math.max(p.maxAdvR,adv/risk);

      if(stopHit){
        const gap=p.side==='LONG'?bar.o<=p.stop:bar.o>=p.stop,exit=gap?bar.o:p.stop;
        closed.push(closeTrade(p,exit,bar.t+(gap?0:H4),gap?'GAP_STOP':p.breakEvenActive?'BREAK_EVEN_STOP':'INITIAL_STOP',cfg));
        position=null;closedThisBar=true;
      }else if(targetHit){
        closed.push(closeTrade(p,p.target,bar.t+H4,'TARGET',cfg));position=null;closedThisBar=true;
      }else if(bar.t-p.openedAt+H4>=cfg.maxHoldMs){
        closed.push(closeTrade(p,bar.c,bar.t+H4,'MAX_HOLD',cfg));position=null;closedThisBar=true;
      }else if(!p.breakEvenActive&&fav/risk>=cfg.breakEvenTriggerR){
        p.stop=round(costBreakEven(p.entry,p.side,cfg.roundTripCostRate),10);p.breakEvenActive=true;p.breakEvenActivatedAt=bar.t+H4;
      }
    }

    streak=compressed[i]?streak+1:0;
    if(position||pending||closedThisBar)continue;

    if(armed&&i>armed.expiresIndex)armed=null;
    if(armed&&i>armed.armedIndex&&i<=armed.expiresIndex&&i>0&&Number.isFinite(atr[i-1])&&atr[i-1]>0){
      const expansion=tr(xs,i)>=cfg.expansionAtrMultiple*atr[i-1];
      let side=null;
      if(expansion&&bar.c>armed.boxHigh)side='LONG';
      else if(expansion&&bar.c<armed.boxLow)side='SHORT';
      const signalAt=bar.t+H4;
      if(side&&signalAt>=entryStart&&signalAt<entryEnd){
        pending={side,signalAt,atr:atr[i-1],armedAt:armed.armedAt,boxHigh:armed.boxHigh,boxLow:armed.boxLow};
        signals.push({symbol:meta.symbol||null,side,signalAt,breakoutBar:bar.t,armedAt:armed.armedAt,boxHigh:armed.boxHigh,boxLow:armed.boxLow,
          breakoutClose:bar.c,trueRange:round(tr(xs,i),10),priorAtr:round(atr[i-1],10)});
        armed=null;continue;
      }
    }

    if(!armed&&streak>=cfg.compressionStreak&&i>=cfg.boxBars-1){
      const boxHigh=extrema(xs,i-cfg.boxBars+1,i,'h','max'),boxLow=extrema(xs,i-cfg.boxBars+1,i,'l','min');
      if(boxHigh>boxLow){
        armed={armedAt:bar.t+H4,armedIndex:i,expiresIndex:i+cfg.armedBars,boxHigh:round(boxHigh,10),boxLow:round(boxLow,10)};
        armedHistory.push({...armed,symbol:meta.symbol||null});
      }
    }
  }
  return {schemaVersion:cfg.version,researchOnly:true,executionImpact:false,symbol:meta.symbol||null,
    config:{atrPeriod:cfg.atrPeriod,rangeBars:cfg.rangeBars,percentileLookback:cfg.percentileLookback,compressionPercentile:cfg.compressionPercentile,
      compressionStreak:cfg.compressionStreak,boxBars:cfg.boxBars,armedBars:cfg.armedBars,expansionAtrMultiple:cfg.expansionAtrMultiple,
      stopAtrMultiple:cfg.stopAtrMultiple,targetR:cfg.targetR,breakEvenTriggerR:cfg.breakEvenTriggerR,maxHoldMs:cfg.maxHoldMs,roundTripCostRate:cfg.roundTripCostRate},
    closed,open:position?[position]:[],pending:pending?[pending]:[],signals,armed:armed?[armed]:[],armedHistory,
    diagnostics:{bars:xs.length,compressedBars:compressed.filter(Boolean).length}};
}

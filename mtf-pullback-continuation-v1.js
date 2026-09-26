// MERIDIAN Multi-Timeframe Pullback Continuation V1 — predeclared research engine.
// Research only. No state writes, Paper/live execution or exchange order path.

const H4=4*3600000,DAY=86400000;
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=8)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

export const MTF_PULLBACK_CONTINUATION_V1=Object.freeze({
  version:'MTF-PULLBACK-CONTINUATION-V1',
  symbols:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']),
  dailyFast:50,dailySlow:200,h4Fast:20,h4Slow:50,atrPeriod:14,validBars:6,
  stopAtrMultiple:1.5,targetR:2.5,breakEvenTriggerR:1,maxHoldMs:10*DAY,roundTripCostRate:.0016,warmupDays:260,
  primaryStart:'2022-09-06T00:00:00.000Z',primaryEnd:'2024-09-06T00:00:00.000Z',
  secondaryStart:'2024-09-06T00:00:00.000Z',secondaryEnd:'2026-09-06T00:00:00.000Z'
});

function normalize(bars=[]){
  return bars.map(x=>({t:n(x.t),o:n(x.o),h:n(x.h),l:n(x.l),c:n(x.c)}))
    .filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)&&x.o>0&&x.c>0&&x.h>=x.l&&x.h>=x.o&&x.h>=x.c&&x.l<=x.o&&x.l<=x.c)
    .sort((a,b)=>a.t-b.t)
    .filter((x,i,a)=>!i||x.t!==a[i-1].t);
}
function ema(values,period){
  const out=Array(values.length).fill(null);if(!values.length)return out;
  const k=2/(period+1);let e=null;
  for(let i=0;i<values.length;i++){e=e==null?values[i]:values[i]*k+e*(1-k);out[i]=e;}
  return out;
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
function dailyBars(xs){
  const m=new Map();
  for(const x of xs){
    const t=Math.floor(x.t/DAY)*DAY,b=m.get(t);
    if(!b)m.set(t,{t,o:x.o,h:x.h,l:x.l,c:x.c,count:1});
    else{b.h=Math.max(b.h,x.h);b.l=Math.min(b.l,x.l);b.c=x.c;b.count++;}
  }
  return [...m.values()].filter(x=>x.count===6).sort((a,b)=>a.t-b.t);
}
function dailyTrend(xs,cfg){
  const ds=dailyBars(xs),f=ema(ds.map(x=>x.c),cfg.dailyFast),s=ema(ds.map(x=>x.c),cfg.dailySlow),out=Array(xs.length).fill(null);
  let j=-1;
  for(let i=0;i<xs.length;i++){
    const knownAt=xs[i].t+H4;
    while(j+1<ds.length&&ds[j+1].t+DAY<=knownAt)j++;
    if(j<cfg.dailySlow-1)continue;
    out[i]=f[j]>s[j]?'LONG':f[j]<s[j]?'SHORT':null;
  }
  return out;
}
function costBreakEven(entry,side,costRate){return side==='LONG'?entry*(1+costRate):entry*(1-costRate);}
function closeTrade(p,exit,closedAt,reason,cfg){
  const dir=p.side==='LONG'?1:-1,riskFraction=p.initialRisk/p.entry,grossFraction=dir*(exit-p.entry)/p.entry;
  const grossR=riskFraction>0?grossFraction/riskFraction:null,costR=riskFraction>0?cfg.roundTripCostRate/riskFraction:null;
  return {...p,status:'CLOSED',exit:round(exit,10),closedAt,exitReason:reason,grossR:round(grossR,6),costR:round(costR,6),netR:round(grossR-costR,6)};
}

export function runMtfPullbackContinuationV1(bars=[],meta={},overrides={}){
  const cfg={...MTF_PULLBACK_CONTINUATION_V1,...overrides},xs=normalize(bars),closes=xs.map(x=>x.c);
  const h4f=ema(closes,cfg.h4Fast),h4s=ema(closes,cfg.h4Slow),atr=atrWilder(xs,cfg.atrPeriod),daily=dailyTrend(xs,cfg);
  const entryStart=Number.isFinite(Number(meta.entryStart))?Number(meta.entryStart):-Infinity;
  const entryEnd=Number.isFinite(Number(meta.entryEnd))?Number(meta.entryEnd):Infinity;
  const closed=[],signals=[],armedHistory=[];let position=null,pending=null,armed=null,closedThisBar=false;

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
            target:round(target,10),initialRisk:round(risk,10),signalAtr:round(pending.atr,10),pullbackExtreme:pending.pullbackExtreme,
            breakEvenActive:false,maxFavR:0,maxAdvR:0};
        }
        pending=null;
      }
    }

    if(position){
      const p=position,risk=p.initialRisk;
      const stopHit=p.side==='LONG'?bar.l<=p.stop:bar.h>=p.stop;
      const targetHit=p.side==='LONG'?bar.h>=p.target:bar.l<=p.target;
      const fav=p.side==='LONG'?bar.h-p.entry:p.entry-bar.l,adv=p.side==='LONG'?p.entry-bar.l:bar.h-p.entry;
      p.maxFavR=Math.max(p.maxFavR,fav/risk);p.maxAdvR=Math.max(p.maxAdvR,adv/risk);
      if(stopHit){
        const gap=p.side==='LONG'?bar.o<=p.stop:bar.o>=p.stop,exit=gap?bar.o:p.stop;
        closed.push(closeTrade(p,exit,bar.t+(gap?0:H4),gap?'GAP_STOP':p.breakEvenActive?'BREAK_EVEN_STOP':'INITIAL_STOP',cfg));position=null;closedThisBar=true;
      }else if(targetHit){
        closed.push(closeTrade(p,p.target,bar.t+H4,'TARGET',cfg));position=null;closedThisBar=true;
      }else if(bar.t-p.openedAt+H4>=cfg.maxHoldMs){
        closed.push(closeTrade(p,bar.c,bar.t+H4,'MAX_HOLD',cfg));position=null;closedThisBar=true;
      }else if(!p.breakEvenActive&&fav/risk>=cfg.breakEvenTriggerR){
        p.stop=round(costBreakEven(p.entry,p.side,cfg.roundTripCostRate),10);p.breakEvenActive=true;p.breakEvenActivatedAt=bar.t+H4;
      }
    }

    if(position||pending||closedThisBar)continue;
    if(i<Math.max(cfg.h4Slow,cfg.atrPeriod)||!Number.isFinite(atr[i])||!Number.isFinite(h4f[i])||!Number.isFinite(h4s[i]))continue;

    if(armed){
      if(i>armed.expiresIndex)armed=null;
      else if(i>armed.armedIndex){
        const trendStill=armed.side==='LONG'
          ?daily[i]==='LONG'&&h4f[i]>h4s[i]&&bar.c>=h4s[i]
          :daily[i]==='SHORT'&&h4f[i]<h4s[i]&&bar.c<=h4s[i];
        if(!trendStill)armed=null;
        else{
          const confirm=armed.side==='LONG'
            ?bar.c>h4f[i]&&bar.c>xs[i-1].h
            :bar.c<h4f[i]&&bar.c<xs[i-1].l;
          const signalAt=bar.t+H4;
          if(confirm&&signalAt>=entryStart&&signalAt<entryEnd){
            pending={side:armed.side,signalAt,atr:atr[i],armedAt:armed.armedAt,pullbackExtreme:armed.pullbackExtreme};
            signals.push({symbol:meta.symbol||null,side:armed.side,signalAt,confirmBar:bar.t,armedAt:armed.armedAt,pullbackExtreme:armed.pullbackExtreme,
              ema20:round(h4f[i],10),ema50:round(h4s[i],10),atr:round(atr[i],10)});
            armed=null;continue;
          }
        }
      }
    }

    if(!armed){
      if(daily[i]==='LONG'&&h4f[i]>h4s[i]&&bar.c<=h4f[i]&&bar.c>=h4s[i]){
        armed={side:'LONG',armedAt:bar.t+H4,armedIndex:i,expiresIndex:i+cfg.validBars,pullbackExtreme:bar.l};
        armedHistory.push({...armed,symbol:meta.symbol||null});
      }else if(daily[i]==='SHORT'&&h4f[i]<h4s[i]&&bar.c>=h4f[i]&&bar.c<=h4s[i]){
        armed={side:'SHORT',armedAt:bar.t+H4,armedIndex:i,expiresIndex:i+cfg.validBars,pullbackExtreme:bar.h};
        armedHistory.push({...armed,symbol:meta.symbol||null});
      }
    }
  }

  return {schemaVersion:cfg.version,researchOnly:true,executionImpact:false,symbol:meta.symbol||null,
    config:{dailyFast:cfg.dailyFast,dailySlow:cfg.dailySlow,h4Fast:cfg.h4Fast,h4Slow:cfg.h4Slow,atrPeriod:cfg.atrPeriod,validBars:cfg.validBars,
      stopAtrMultiple:cfg.stopAtrMultiple,targetR:cfg.targetR,breakEvenTriggerR:cfg.breakEvenTriggerR,maxHoldMs:cfg.maxHoldMs,roundTripCostRate:cfg.roundTripCostRate},
    closed,open:position?[position]:[],pending:pending?[pending]:[],signals,armed:armed?[armed]:[],armedHistory,
    diagnostics:{bars:xs.length,completeDays:dailyBars(xs).length}};
}

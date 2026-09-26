// MERIDIAN Breakout Trend V1 — predeclared research engine.
// Research only. No state writes, orders, Paper/live execution or Pionex integration.

const H4=4*3600000,DAY=86400000;
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=8)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

export const BREAKOUT_TREND_V1=Object.freeze({
  version:'BREAKOUT-TREND-V1',
  symbols:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']),
  dailyFast:50,dailySlow:200,breakoutBars:20,atrPeriod:14,atrMultiple:2,
  trailingBars:10,maxHoldMs:60*DAY,roundTripCostRate:.0016,
  primaryStart:'2022-09-06T00:00:00.000Z',primaryEnd:'2024-09-06T00:00:00.000Z',
  secondaryStart:'2024-09-06T00:00:00.000Z',secondaryEnd:'2026-09-06T00:00:00.000Z',
  warmupDays:260
});

function normalize(bars=[]){
  return bars.map(x=>({t:n(x.t),o:n(x.o),h:n(x.h),l:n(x.l),c:n(x.c)}))
    .filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)&&x.o>0&&x.h>=x.l&&x.h>=x.o&&x.h>=x.c&&x.l<=x.o&&x.l<=x.c)
    .sort((a,b)=>a.t-b.t)
    .filter((x,i,a)=>!i||x.t!==a[i-1].t);
}

function ema(values,period){
  const out=Array(values.length).fill(null);if(!values.length)return out;
  const k=2/(period+1);let e=null;
  for(let i=0;i<values.length;i++){e=e==null?values[i]:values[i]*k+e*(1-k);out[i]=e;}
  return out;
}

function atrWilder(xs,period){
  const out=Array(xs.length).fill(null);if(xs.length<period+1)return out;
  const tr=Array(xs.length).fill(null);
  for(let i=1;i<xs.length;i++)tr[i]=Math.max(xs[i].h-xs[i].l,Math.abs(xs[i].h-xs[i-1].c),Math.abs(xs[i].l-xs[i-1].c));
  let a=0;for(let i=1;i<=period;i++)a+=tr[i];a/=period;out[period]=a;
  for(let i=period+1;i<xs.length;i++){a=(a*(period-1)+tr[i])/period;out[i]=a;}
  return out;
}

function dailySeries(xs){
  const m=new Map();
  for(const x of xs){
    const t=Math.floor(x.t/DAY)*DAY,b=m.get(t);
    if(!b)m.set(t,{t,o:x.o,h:x.h,l:x.l,c:x.c,count:1});
    else{b.h=Math.max(b.h,x.h);b.l=Math.min(b.l,x.l);b.c=x.c;b.count++;}
  }
  return [...m.values()].filter(x=>x.count===6).sort((a,b)=>a.t-b.t);
}

function dailyRegimeMap(xs,cfg){
  const ds=dailySeries(xs),fast=ema(ds.map(x=>x.c),cfg.dailyFast),slow=ema(ds.map(x=>x.c),cfg.dailySlow),out=Array(xs.length).fill(null);
  let j=-1;
  for(let i=0;i<xs.length;i++){
    const knownAt=xs[i].t+H4;
    while(j+1<ds.length&&ds[j+1].t+DAY<=knownAt)j++;
    if(j<cfg.dailySlow-1)continue;
    out[i]=fast[j]>slow[j]?'LONG':fast[j]<slow[j]?'SHORT':null;
  }
  return out;
}

function extrema(xs,start,end,key,mode){
  let v=mode==='max'?-Infinity:Infinity;
  for(let i=start;i<end;i++)v=mode==='max'?Math.max(v,xs[i][key]):Math.min(v,xs[i][key]);
  return Number.isFinite(v)?v:null;
}

function closeTrade(p,exit,closedAt,reason,cfg){
  const dir=p.side==='LONG'?1:-1,riskFraction=Math.abs(p.entry-p.initialStop)/p.entry;
  const grossFraction=dir*(exit-p.entry)/p.entry;
  const grossR=riskFraction>0?grossFraction/riskFraction:null;
  const costR=riskFraction>0?cfg.roundTripCostRate/riskFraction:null;
  return {...p,status:'CLOSED',exit:round(exit,10),closedAt,exitReason:reason,
    grossR:round(grossR,6),costR:round(costR,6),netR:round(grossR-costR,6)};
}

export function runBreakoutTrendV1(bars=[],meta={},overrides={}){
  const cfg={...BREAKOUT_TREND_V1,...overrides},xs=normalize(bars),atr=atrWilder(xs,cfg.atrPeriod),regimes=dailyRegimeMap(xs,cfg);
  const entryStart=Number.isFinite(Number(meta.entryStart))?Number(meta.entryStart):-Infinity;
  const entryEnd=Number.isFinite(Number(meta.entryEnd))?Number(meta.entryEnd):Infinity;
  const closed=[],signals=[];let position=null,pending=null;
  let skippedInvalidRisk=0;
  for(let i=0;i<xs.length;i++){
    const bar=xs[i];

    if(!position&&pending){
      if(bar.t>=entryEnd){pending=null;}
      else{
        const a=pending.atr,entry=bar.o,stop=pending.side==='LONG'?entry-cfg.atrMultiple*a:entry+cfg.atrMultiple*a;
        if(entry>0&&a>0&&stop>0&&stop!==entry){
          position={id:`${meta.symbol||'ASSET'}-${pending.side}-${pending.signalAt}`,symbol:meta.symbol||null,side:pending.side,status:'OPEN',
            signalAt:pending.signalAt,openedAt:bar.t,entry:round(entry,10),initialStop:round(stop,10),stop:round(stop,10),
            initialAtr:round(a,10),regime:pending.regime,maxFavR:0,maxAdvR:0};
        }else skippedInvalidRisk++;
        pending=null;
      }
    }

    if(position){
      const trailStart=Math.max(0,i-cfg.trailingBars);
      const trail=position.side==='LONG'?extrema(xs,trailStart,i,'l','min'):extrema(xs,trailStart,i,'h','max');
      if(Number.isFinite(trail))position.stop=round(position.side==='LONG'?Math.max(position.stop,trail):Math.min(position.stop,trail),10);
      const dir=position.side==='LONG'?1:-1,risk=Math.abs(position.entry-position.initialStop);
      if(risk>0){
        const fav=position.side==='LONG'?bar.h-position.entry:position.entry-bar.l;
        const adv=position.side==='LONG'?position.entry-bar.l:bar.h-position.entry;
        position.maxFavR=Math.max(position.maxFavR,fav/risk);position.maxAdvR=Math.max(position.maxAdvR,adv/risk);
      }
      const hit=position.side==='LONG'?bar.l<=position.stop:bar.h>=position.stop;
      if(hit){
        const gap=position.side==='LONG'?bar.o<=position.stop:bar.o>=position.stop;
        const exit=gap?bar.o:position.stop;
        closed.push(closeTrade(position,exit,bar.t+(gap?0:H4),gap?'GAP_STOP':'TRAIL_STOP',cfg));position=null;
      }else if(bar.t-position.openedAt+H4>=cfg.maxHoldMs){
        closed.push(closeTrade(position,bar.c,bar.t+H4,'MAX_HOLD',cfg));position=null;
      }
    }

    if(position||pending||bar.t<entryStart||bar.t+H4>=entryEnd)continue;
    if(i<Math.max(cfg.breakoutBars,cfg.atrPeriod)||!Number.isFinite(atr[i])||!regimes[i])continue;
    const hi=extrema(xs,i-cfg.breakoutBars,i,'h','max'),lo=extrema(xs,i-cfg.breakoutBars,i,'l','min');
    let side=null;
    if(regimes[i]==='LONG'&&bar.c>hi)side='LONG';
    else if(regimes[i]==='SHORT'&&bar.c<lo)side='SHORT';
    if(!side)continue;
    pending={side,signalAt:bar.t+H4,atr:atr[i],regime:regimes[i],breakoutLevel:side==='LONG'?hi:lo};
    signals.push({symbol:meta.symbol||null,side,signalAt:bar.t+H4,signalClose:bar.c,regime:regimes[i],atr:round(atr[i],10),breakoutLevel:round(pending.breakoutLevel,10)});
  }
  return {schemaVersion:cfg.version,researchOnly:true,executionImpact:false,symbol:meta.symbol||null,
    config:{dailyFast:cfg.dailyFast,dailySlow:cfg.dailySlow,breakoutBars:cfg.breakoutBars,atrPeriod:cfg.atrPeriod,atrMultiple:cfg.atrMultiple,trailingBars:cfg.trailingBars,maxHoldMs:cfg.maxHoldMs,roundTripCostRate:cfg.roundTripCostRate},
    closed,open:position?[position]:[],pending:pending?[pending]:[],signals,diagnostics:{bars:xs.length,completeDays:dailySeries(xs).length,skippedInvalidRisk}};
}

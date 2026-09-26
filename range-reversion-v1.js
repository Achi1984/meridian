// MERIDIAN Range Reversion V1 — predeclared research engine.
// Research only. No state writes, exchange orders, Paper/live execution or Pionex integration.

const H4=4*3600000,DAY=86400000;
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=8)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

export const RANGE_REVERSION_V1=Object.freeze({
  version:'RANGE-REVERSION-V1',
  symbols:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']),
  meanBars:20,zEntry:2,adxPeriod:14,maxAdx:20,atrPeriod:14,atrMultiple:2,
  maxHoldMs:7*DAY,roundTripCostRate:.0016,warmupDays:60,
  primaryStart:'2022-09-06T00:00:00.000Z',primaryEnd:'2024-09-06T00:00:00.000Z',
  secondaryStart:'2024-09-06T00:00:00.000Z',secondaryEnd:'2026-09-06T00:00:00.000Z'
});

function normalize(bars=[]){
  return bars.map(x=>({t:n(x.t),o:n(x.o),h:n(x.h),l:n(x.l),c:n(x.c)}))
    .filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)&&x.o>0&&x.h>=x.l&&x.h>=x.o&&x.h>=x.c&&x.l<=x.o&&x.l<=x.c)
    .sort((a,b)=>a.t-b.t).filter((x,i,a)=>!i||x.t!==a[i-1].t);
}

function rollingMeanStd(xs,period){
  const mean=Array(xs.length).fill(null),std=Array(xs.length).fill(null);let sum=0,sumSq=0;
  for(let i=0;i<xs.length;i++){
    const v=xs[i].c;sum+=v;sumSq+=v*v;
    if(i>=period){const old=xs[i-period].c;sum-=old;sumSq-=old*old;}
    if(i>=period-1){
      const m=sum/period,variance=Math.max(0,sumSq/period-m*m);
      mean[i]=m;std[i]=Math.sqrt(variance);
    }
  }
  return{mean,std};
}

function atrWilder(xs,period){
  const out=Array(xs.length).fill(null);if(xs.length<period+1)return out;
  const tr=Array(xs.length).fill(null);
  for(let i=1;i<xs.length;i++)tr[i]=Math.max(xs[i].h-xs[i].l,Math.abs(xs[i].h-xs[i-1].c),Math.abs(xs[i].l-xs[i-1].c));
  let a=0;for(let i=1;i<=period;i++)a+=tr[i];a/=period;out[period]=a;
  for(let i=period+1;i<xs.length;i++){a=(a*(period-1)+tr[i])/period;out[i]=a;}
  return out;
}

function adxWilder(xs,period){
  const out=Array(xs.length).fill(null);if(xs.length<period*2)return out;
  const tr=Array(xs.length).fill(0),pd=Array(xs.length).fill(0),md=Array(xs.length).fill(0);
  for(let i=1;i<xs.length;i++){
    const up=xs[i].h-xs[i-1].h,dn=xs[i-1].l-xs[i].l;
    tr[i]=Math.max(xs[i].h-xs[i].l,Math.abs(xs[i].h-xs[i-1].c),Math.abs(xs[i].l-xs[i-1].c));
    pd[i]=up>dn&&up>0?up:0;md[i]=dn>up&&dn>0?dn:0;
  }
  let trs=0,pds=0,mds=0;for(let i=1;i<=period;i++){trs+=tr[i];pds+=pd[i];mds+=md[i];}
  let adx=null,dxCount=0;
  for(let i=period;i<xs.length;i++){
    if(i>period){trs=trs-trs/period+tr[i];pds=pds-pds/period+pd[i];mds=mds-mds/period+md[i];}
    const pdi=trs>0?100*pds/trs:0,mdi=trs>0?100*mds/trs:0,dx=pdi+mdi>0?100*Math.abs(pdi-mdi)/(pdi+mdi):0;
    dxCount++;
    if(dxCount===period){let sum=0;
      // Reconstruct the first ADX from the period DX observations ending here.
      let ttrs=0,tpds=0,tmds=0,vals=[];
      for(let k=1;k<=period;k++){ttrs+=tr[k];tpds+=pd[k];tmds+=md[k];}
      for(let k=period;k<=i;k++){
        if(k>period){ttrs=ttrs-ttrs/period+tr[k];tpds=tpds-tpds/period+pd[k];tmds=tmds-tmds/period+md[k];}
        const a=ttrs>0?100*tpds/ttrs:0,b=ttrs>0?100*tmds/ttrs:0;vals.push(a+b>0?100*Math.abs(a-b)/(a+b):0);
      }
      for(const v of vals.slice(-period))sum+=v;adx=sum/period;out[i]=adx;
    }else if(dxCount>period){adx=(adx*(period-1)+dx)/period;out[i]=adx;}
  }
  return out;
}

function closeTrade(p,exit,closedAt,reason,cfg){
  const dir=p.side==='LONG'?1:-1,riskFraction=Math.abs(p.entry-p.stop)/p.entry;
  const grossFraction=dir*(exit-p.entry)/p.entry,grossR=riskFraction>0?grossFraction/riskFraction:null,costR=riskFraction>0?cfg.roundTripCostRate/riskFraction:null;
  return{...p,status:'CLOSED',exit:round(exit,10),closedAt,exitReason:reason,grossR:round(grossR,6),costR:round(costR,6),netR:round(grossR-costR,6)};
}

export function runRangeReversionV1(bars=[],meta={},overrides={}){
  const cfg={...RANGE_REVERSION_V1,...overrides},xs=normalize(bars),stats=rollingMeanStd(xs,cfg.meanBars),atr=atrWilder(xs,cfg.atrPeriod),adx=adxWilder(xs,cfg.adxPeriod);
  const entryStart=Number.isFinite(Number(meta.entryStart))?Number(meta.entryStart):-Infinity,entryEnd=Number.isFinite(Number(meta.entryEnd))?Number(meta.entryEnd):Infinity;
  const closed=[],signals=[];let position=null,pending=null,expiredGapTarget=0,skippedInvalidRisk=0;
  for(let i=0;i<xs.length;i++){
    const bar=xs[i];

    if(!position&&pending){
      if(bar.t>=entryEnd)pending=null;
      else{
        const pastTarget=pending.side==='LONG'?bar.o>=pending.target:bar.o<=pending.target;
        if(pastTarget){expiredGapTarget++;pending=null;}
        else{
          const entry=bar.o,stop=pending.side==='LONG'?entry-cfg.atrMultiple*pending.atr:entry+cfg.atrMultiple*pending.atr;
          if(entry>0&&stop>0&&stop!==entry){
            position={id:`${meta.symbol||'ASSET'}-${pending.side}-${pending.signalAt}`,symbol:meta.symbol||null,side:pending.side,status:'OPEN',
              signalAt:pending.signalAt,openedAt:bar.t,entry:round(entry,10),stop:round(stop,10),target:round(pending.target,10),
              signalZ:round(pending.z,4),signalAdx:round(pending.adx,4),initialAtr:round(pending.atr,10)};
          }else skippedInvalidRisk++;
          pending=null;
        }
      }
    }

    if(position){
      const stopHit=position.side==='LONG'?bar.l<=position.stop:bar.h>=position.stop;
      const targetHit=position.side==='LONG'?bar.h>=position.target:bar.l<=position.target;
      if(stopHit){
        const gap=position.side==='LONG'?bar.o<=position.stop:bar.o>=position.stop;
        closed.push(closeTrade(position,gap?bar.o:position.stop,bar.t+(gap?0:H4),gap?'GAP_STOP':'STOP',cfg));position=null;
      }else if(targetHit){
        closed.push(closeTrade(position,position.target,bar.t+H4,'MEAN_TARGET',cfg));position=null;
      }else if(bar.t-position.openedAt+H4>=cfg.maxHoldMs){
        closed.push(closeTrade(position,bar.c,bar.t+H4,'MAX_HOLD',cfg));position=null;
      }
    }

    if(position||pending||bar.t<entryStart||bar.t+H4>=entryEnd)continue;
    const m=stats.mean[i],sd=stats.std[i],a=atr[i],d=adx[i];
    if(!(Number.isFinite(m)&&Number.isFinite(sd)&&sd>0&&Number.isFinite(a)&&a>0&&Number.isFinite(d)&&d<cfg.maxAdx))continue;
    const z=(bar.c-m)/sd;let side=null;
    if(z<=-cfg.zEntry)side='LONG';else if(z>=cfg.zEntry)side='SHORT';
    if(!side)continue;
    pending={side,signalAt:bar.t+H4,target:m,atr:a,adx:d,z};
    signals.push({symbol:meta.symbol||null,side,signalAt:bar.t+H4,signalClose:bar.c,target:round(m,10),z:round(z,4),adx:round(d,4),atr:round(a,10)});
  }
  return{schemaVersion:cfg.version,researchOnly:true,executionImpact:false,symbol:meta.symbol||null,
    config:{meanBars:cfg.meanBars,zEntry:cfg.zEntry,adxPeriod:cfg.adxPeriod,maxAdx:cfg.maxAdx,atrPeriod:cfg.atrPeriod,atrMultiple:cfg.atrMultiple,maxHoldMs:cfg.maxHoldMs,roundTripCostRate:cfg.roundTripCostRate},
    closed,open:position?[position]:[],pending:pending?[pending]:[],signals,diagnostics:{bars:xs.length,expiredGapTarget,skippedInvalidRisk}};
}

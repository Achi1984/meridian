// MERIDIAN Elliott ABC Reversal V1 — predeclared mechanical research engine.
// Research only. No Paper/live execution or discretionary relabelling.

const H4=4*3600000,DAY=86400000,PIVOT4H=3,PIVOT1D=2,LOOKBACK=30*DAY,COST_R=.05;
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=8)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const median=a=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};

export const ELLIOTT_ABC_REVERSAL_V1=Object.freeze({
  version:'ELLIOTT-ABC-REVERSAL-V1',
  symbols:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']),
  pivot4h:PIVOT4H,pivot1d:PIVOT1D,noiseLookbackDays:30,noiseMultiple:2,
  bMin:.382,bMax:.786,cMin:.8,cMax:1.618,entryFib:.236,costR:COST_R,warmupDays:180,
  primaryStart:'2022-09-06T00:00:00.000Z',primaryEnd:'2024-09-06T00:00:00.000Z',
  secondaryStart:'2024-09-06T00:00:00.000Z',secondaryEnd:'2026-09-06T00:00:00.000Z'
});

function normalize(bars=[]){
  return bars.map(x=>({t:n(x.t),o:n(x.o),h:n(x.h),l:n(x.l),c:n(x.c)}))
    .filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)&&x.o>0&&x.c>0&&x.h>=x.l)
    .sort((a,b)=>a.t-b.t).filter((x,i,a)=>!i||x.t!==a[i-1].t);
}
function confirmedPivots(xs,width,barMs=H4){
  const out=[];
  for(let i=width;i<xs.length-width;i++){
    const b=xs[i],left=xs.slice(i-width,i),right=xs.slice(i+1,i+width+1);
    const high=left.every(x=>b.h>x.h)&&right.every(x=>b.h>=x.h);
    const low=left.every(x=>b.l<x.l)&&right.every(x=>b.l<=x.l);
    if(high===low)continue;
    out.push({type:high?'HIGH':'LOW',price:high?b.h:b.l,index:i,t:b.t,confirmedIndex:i+width,confirmedAt:xs[i+width].t+barMs});
  }
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
function dailyContexts(xs){
  const ds=dailyBars(xs),ps=confirmedPivots(ds,PIVOT1D,DAY),out=[];
  for(let i=1;i<ps.length;i++){
    const a=ps[i-1],b=ps[i];if(a.type===b.type)continue;
    out.push({confirmedAt:b.confirmedAt,direction:a.type==='LOW'&&b.type==='HIGH'?'LONG':'SHORT'});
  }
  return out;
}
function trueRange(xs,i){
  if(!i)return xs[i].h-xs[i].l;
  return Math.max(xs[i].h-xs[i].l,Math.abs(xs[i].h-xs[i-1].c),Math.abs(xs[i].l-xs[i-1].c));
}
function noiseFloor(xs,pivot){
  const bars=Math.floor(LOOKBACK/H4),start=Math.max(0,pivot.index-bars),trs=[];
  for(let i=start;i<pivot.index;i++)trs.push(trueRange(xs,i));
  const m=median(trs);return m==null?null:2*m;
}
function abcCandidate(pivots,k,xs,ctx,seq,symbol){
  if(k<3)return null;
  const p0=pivots[k-3],a=pivots[k-2],b=pivots[k-1],c=pivots[k];
  let side=null;
  if(p0.type==='HIGH'&&a.type==='LOW'&&b.type==='HIGH'&&c.type==='LOW')side='LONG';
  else if(p0.type==='LOW'&&a.type==='HIGH'&&b.type==='LOW'&&c.type==='HIGH')side='SHORT';
  else return null;
  if(ctx!==side)return null;

  const leg=Math.abs(p0.price-a.price),floor=noiseFloor(xs,a);
  if(!(leg>0&&floor>0&&leg>=floor))return null;

  let bRetrace,cExtension,trigger,stop,tp1=b.price,tp2=p0.price;
  if(side==='LONG'){
    bRetrace=(b.price-a.price)/leg;
    cExtension=(b.price-c.price)/leg;
    if(!(b.price<p0.price&&c.price<a.price))return null;
    trigger=c.price+ELLIIOTT_SAFE().entryFib*(b.price-c.price);
    stop=c.price;
    if(!(tp2>tp1&&tp1>trigger&&trigger>stop))return null;
  }else{
    bRetrace=(a.price-b.price)/leg;
    cExtension=(c.price-b.price)/leg;
    if(!(b.price>p0.price&&c.price>a.price))return null;
    trigger=c.price-ELLIIOTT_SAFE().entryFib*(c.price-b.price);
    stop=c.price;
    if(!(tp2<tp1&&tp1<trigger&&trigger<stop))return null;
  }
  const cfg=ELLIIOTT_SAFE();
  if(!(bRetrace>=cfg.bMin&&bRetrace<=cfg.bMax&&cExtension>=cfg.cMin&&cExtension<=cfg.cMax))return null;
  return {id:`${symbol}-ABC-${seq}`,symbol,side,status:'PENDING',p0,a,b,c,leg:round(leg),bRetrace:round(bRetrace,6),cExtension:round(cExtension,6),
    createdAt:c.confirmedAt,createdIndex:c.confirmedIndex,entryTrigger:round(trigger,10),stop:round(stop,10),target1:round(tp1,10),target2:round(tp2,10),
    entryAt:null,entryIndex:null,closedAt:null,netR:null,dailyContext:ctx};
}
function ELLIIOTT_SAFE(){return ELLIOTT_ABC_REVERSAL_V1}
const crosses=(bar,side,p)=>side==='LONG'?bar.h>p:bar.l<p;
const invalid=(bar,side,p)=>side==='LONG'?bar.l<=p:bar.h>=p;
const entryPrice=(bar,side,p)=>side==='LONG'?Math.max(bar.o,p):Math.min(bar.o,p);
function finish(s,bar,i,reason,grossR){
  s.status='CLOSED';s.closedAt=bar.t+H4;s.closedIndex=i;s.exitReason=reason;s.grossR=round(grossR,6);s.netR=round(grossR-COST_R,6);
  s.timeInMarketBars=s.entryIndex==null?0:i-s.entryIndex+1;return s;
}

export function runElliottAbcReversalV1(bars=[],meta={}){
  const xs=normalize(bars),symbol=meta.symbol||'ASSET',entryStart=Number.isFinite(Number(meta.entryStart))?Number(meta.entryStart):-Infinity,entryEnd=Number.isFinite(Number(meta.entryEnd))?Number(meta.entryEnd):Infinity;
  const pivots=confirmedPivots(xs,PIVOT4H),contexts=dailyContexts(xs),byConfirm=new Map();
  for(let k=0;k<pivots.length;k++){const p=pivots[k],arr=byConfirm.get(p.confirmedIndex)||[];arr.push(k);byConfirm.set(p.confirmedIndex,arr);}
  const setups=[],closed=[];let pending=null,active=null,seq=0,ctx=null,ci=0;
  const rejected={invalidStructure:0,competing:0,activePosition:0,pendingInvalidation:0,outsideWindow:0};

  for(let i=0;i<xs.length;i++){
    const bar=xs[i];
    while(ci<contexts.length&&contexts[ci].confirmedAt<=bar.t){ctx=contexts[ci].direction;ci++;}

    if(active){
      if(active.tp1Done&&active.moveStopAtIndex!=null&&i>=active.moveStopAtIndex)active.stop=active.entryAt;
      const risk=Math.abs(active.entryAt-active.initialStop);
      const stopHit=invalid(bar,active.side,active.stop),t1Hit=crosses(bar,active.side,active.target1),t2Hit=crosses(bar,active.side,active.target2);
      if(stopHit){
        const gap=active.side==='LONG'?bar.o<=active.stop:bar.o>=active.stop;
        let gross=-1;
        if(active.tp1Done)gross=.5*active.r1;
        closed.push(finish(active,bar,i,gap?'GAP_STOP':active.tp1Done?'BREAKEVEN_AFTER_TP1':'STOP',gross));active=null;
      }else{
        if(!active.tp1Done&&t1Hit){
          active.tp1Done=true;active.r1=Math.abs(active.target1-active.entryAt)/risk;active.moveStopAtIndex=i+1;
        }
        if(active&&t2Hit){
          const r2=Math.abs(active.target2-active.entryAt)/risk,gross=.5*(active.r1||0)+.5*r2;
          closed.push(finish(active,bar,i,'TARGET_P0',gross));active=null;
        }
      }
    }

    if(pending&&!active){
      if(invalid(bar,pending.side,pending.stop)){pending.status='INVALIDATED';pending.closedAt=bar.t+H4;rejected.pendingInvalidation++;pending=null;}
      else if(i>pending.createdIndex&&crosses(bar,pending.side,pending.entryTrigger)){
        const signalAt=bar.t+H4;
        if(signalAt<entryStart||signalAt>=entryEnd){pending.status='OUTSIDE_WINDOW';rejected.outsideWindow++;pending=null;}
        else{
          pending.entryAt=round(entryPrice(bar,pending.side,pending.entryTrigger),10);pending.entryIndex=i;pending.openedAt=bar.t;pending.status='OPEN';
          pending.initialStop=pending.stop;pending.tp1Done=false;active=pending;pending=null;
          const risk=Math.abs(active.entryAt-active.initialStop);
          if(!(risk>0)||invalid(bar,active.side,active.initialStop)){closed.push(finish(active,bar,i,'STOP',-1));active=null;}
          else{
            const t1Hit=crosses(bar,active.side,active.target1),t2Hit=crosses(bar,active.side,active.target2);
            if(t1Hit){active.tp1Done=true;active.r1=Math.abs(active.target1-active.entryAt)/risk;active.moveStopAtIndex=i+1;}
            if(active&&t2Hit){const r2=Math.abs(active.target2-active.entryAt)/risk;closed.push(finish(active,bar,i,'TARGET_P0',.5*(active.r1||0)+.5*r2));active=null;}
          }
        }
      }
    }

    for(const k of byConfirm.get(i)||[]){
      const s=abcCandidate(pivots,k,xs,ctx,++seq,symbol);
      if(!s){rejected.invalidStructure++;continue;}
      setups.push(s);
      if(active){s.status='REJECTED_ACTIVE';rejected.activePosition++;continue;}
      if(pending){pending.status='REJECTED_COMPETING';pending.closedAt=bar.t+H4;s.status='REJECTED_COMPETING';rejected.competing+=2;pending=null;continue;}
      pending=s;
    }
  }

  return {schemaVersion:ELLIOTT_ABC_REVERSAL_V1.version,researchOnly:true,executionImpact:false,symbol,
    closed,open:active?[active]:[],pending:pending?[pending]:[],setups,rejected,pivots:pivots.length,contexts:contexts.length};
}

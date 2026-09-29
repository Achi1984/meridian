export const ADAPTIVE_TREND_SHARPE_PROXY_V1_RULESET='ADAPTIVE-TREND-SHARPE-PROXY-V1-FROZEN';
export const ADAPTIVE_TREND_SHARPE_PROXY_V1_ASSETS=Object.freeze(['BNB','DOGE','ADA','DOT','LTC','BCH','TRX','XLM','ETC','FIL','ATOM','NEAR']);
export const ADAPTIVE_TREND_SHARPE_PROXY_V1_CONFIG=Object.freeze({
  evalStart:Date.UTC(2022,0,1),evalEnd:Date.UTC(2026,8,1),
  momLookbackBars:24,thetaEntry:.03,atrPeriod:14,atrMult:2.5,
  longBudget:.70,shortBudget:.30,longSharpeThreshold:1.3,shortSharpeThreshold:1.7,
  selectorBufferBars:4,selectorMinBars:100,maxBarGapHours:7,maxFundingGapHours:12,
  costBps:8,stressCostBps:12,startEquity:10000,
  gate:Object.freeze({minPeriods:4000,minProfitFactor:1.20,maxDrawdownPct:20,minSharpe:1.00,minPositiveWindows:4,minPositiveAssets:6,maxPositivePnlConcentrationPct:35})
});
const HOUR=3600000,DAY=24*HOUR,SIX=6*HOUR,ANNUAL_BARS=4*365;
const finite=x=>Number.isFinite(Number(x));
const n=x=>Number(x);
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
function stdev(a){if(a.length<2)return 0;const m=mean(a);return Math.sqrt(Math.max(0,a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1)))}
function uniq(rows,key){const m=new Map();for(const x of rows)m.set(x[key],x);return [...m.values()].sort((a,b)=>a[key]-b[key])}
export function normalizeBars(rows){
  return uniq((Array.isArray(rows)?rows:[]).map(x=>Array.isArray(x)?({openTime:n(x[0]),open:n(x[1]),high:n(x[2]),low:n(x[3]),close:n(x[4]),volume:n(x[5]),closeTime:n(x[6])}):({openTime:n(x.openTime??x.t??x.time),open:n(x.open??x.o),high:n(x.high??x.h),low:n(x.low??x.l),close:n(x.close??x.c),volume:n(x.volume??x.v??0),closeTime:n(x.closeTime??x.T??x.openTime??x.t??x.time)})).filter(x=>[x.openTime,x.open,x.high,x.low,x.close,x.closeTime].every(finite)&&x.open>0&&x.high>0&&x.low>0&&x.close>0),'openTime');
}
export function normalizeFunding(rows){
  return uniq((Array.isArray(rows)?rows:[]).map(x=>({time:n(x.fundingTime??x.ts??x.time),rate:n(x.fundingRate??x.rate)})).filter(x=>finite(x.time)&&finite(x.rate)),'time');
}
function lowerBound(rows,t,key='time'){let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid][key]<t)lo=mid+1;else hi=mid}return lo}
function sumFundingBetween(rows,startExclusive,endInclusive){let i=lowerBound(rows,startExclusive+1),s=0;for(;i<rows.length&&rows[i].time<=endInclusive;i++)s+=rows[i].rate;return s}
function fundingCoverage(rows,start,end,maxGapMs){
  if(!rows.length)return false;
  let i=lowerBound(rows,start+1),prev=i>0?rows[i-1]:null;
  if(!prev||start-prev.time>maxGapMs)return false;
  let last=prev.time;
  for(;i<rows.length&&rows[i].time<=end;i++){if(rows[i].time-last>maxGapMs)return false;last=rows[i].time}
  return end-last<=maxGapMs;
}
function buildSeries(rawBars,rawFunding,cfg){
  const rows=normalizeBars(rawBars),funding=normalizeFunding(rawFunding),by=new Map(rows.map((x,i)=>[x.openTime,i]));
  const tr=rows.map((x,i)=>i===0?x.high-x.low:Math.max(x.high-x.low,Math.abs(x.high-rows[i-1].close),Math.abs(x.low-rows[i-1].close)));
  const atr=Array(rows.length).fill(null);if(rows.length>=cfg.atrPeriod){let a=mean(tr.slice(0,cfg.atrPeriod));atr[cfg.atrPeriod-1]=a;for(let i=cfg.atrPeriod;i<rows.length;i++){a=(a*(cfg.atrPeriod-1)+tr[i])/cfg.atrPeriod;atr[i]=a}}
  const mom=rows.map((x,i)=>i>=cfg.momLookbackBars?x.close/rows[i-cfg.momLookbackBars].close-1:null);
  return{rows,funding,by,atr,mom};
}
function monthStart(ts){const d=new Date(ts);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)}
function monthKey(ts){const d=new Date(ts);return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')}
function prevMonthStart(ts){const d=new Date(ts);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)}
function sharpe(rs){const sd=stdev(rs);return rs.length>1&&sd>0?mean(rs)/sd*Math.sqrt(ANNUAL_BARS):0}
function summarize(rs,start=10000){let eq=start,peak=eq,dd=0;for(const r of rs){eq*=1+r;peak=Math.max(peak,eq);dd=Math.max(dd,peak>0?(peak-eq)/peak*100:0)}const wins=rs.filter(x=>x>0).reduce((a,b)=>a+b,0),loss=Math.abs(rs.filter(x=>x<0).reduce((a,b)=>a+b,0));return{periods:rs.length,totalReturnPct:(eq/start-1)*100,endEquity:eq,profitFactor:loss>0?wins/loss:(wins>0?99:0),maxDrawdownPct:dd,sharpe:sharpe(rs)}}
function chronological(periods,parts=5){const windows=[];for(let k=0;k<parts;k++){const a=Math.floor(periods.length*k/parts),b=Math.floor(periods.length*(k+1)/parts),rs=periods.slice(a,b).map(x=>x.return);windows.push({index:k+1,periods:rs.length,returnPct:summarize(rs,100).totalReturnPct})}return{windows,positiveWindows:windows.filter(x=>x.returnPct>0).length}}
function contiguous(a,b,cfg){return !!a&&!!b&&b.openTime>a.openTime&&b.openTime-a.openTime<=cfg.maxBarGapHours*HOUR}
function updateState(state,series,i,side,cfg){
  const row=series.rows[i],mom=series.mom[i],atr=series.atr[i];
  if(!row||!finite(atr)||atr<=0)return{active:false,trail:null};
  let active=!!state.active,trail=state.trail;
  if(active){
    if(side>0){if(row.close<trail)return{active:false,trail:null};trail=Math.max(trail,row.close-cfg.atrMult*atr)}
    else{if(row.close>trail)return{active:false,trail:null};trail=Math.min(trail,row.close+cfg.atrMult*atr)}
  }
  if(!active&&finite(mom)){
    if(side>0&&mom>cfg.thetaEntry)return{active:true,trail:row.close-cfg.atrMult*atr};
    if(side<0&&mom<-cfg.thetaEntry)return{active:true,trail:row.close+cfg.atrMult*atr};
  }
  return{active,trail};
}
function standaloneSide(series,side,sampleStart,sampleEnd,cfg,costBps=cfg.costBps){
  const indices=[];for(let i=0;i<series.rows.length-1;i++){const t=series.rows[i].openTime;if(t>=sampleStart&&t<sampleEnd)indices.push(i)}
  if(indices.length<cfg.selectorMinBars)return{eligibleData:false,returns:[],sharpe:0,unavailable:0};
  let state={active:false,trail:null},prevW=0,unavailable=0;const rs=[];
  for(const i of indices){const cur=series.rows[i],next=series.rows[i+1];let nextState=updateState(state,series,i,side,cfg);let w=nextState.active?side:0;
    if(!contiguous(cur,next,cfg)){nextState={active:false,trail:null};w=0;unavailable++}
    else if(w&&!fundingCoverage(series.funding,cur.closeTime,next.closeTime,cfg.maxFundingGapHours*HOUR)){nextState={active:false,trail:null};w=0;unavailable++}
    const cost=Math.abs(w-prevW)*costBps/10000;let r=-cost;
    if(w){r+=w*(next.close/cur.close-1)-w*sumFundingBetween(series.funding,cur.closeTime,next.closeTime)}
    rs.push(r);prevW=w;state=nextState;
  }
  if(prevW&&rs.length)rs[rs.length-1]-=Math.abs(prevW)*costBps/10000;
  return{eligibleData:rs.length>=cfg.selectorMinBars,returns:rs,sharpe:sharpe(rs),unavailable};
}
function selectorForMonth(seriesByAsset,assets,monthTs,cfg){
  const sampleStart=prevMonthStart(monthTs),sampleEnd=monthTs-cfg.selectorBufferBars*SIX;
  const long=[],short=[],details={};
  for(const asset of assets){const s=seriesByAsset[asset];const l=standaloneSide(s,1,sampleStart,sampleEnd,cfg),sh=standaloneSide(s,-1,sampleStart,sampleEnd,cfg);details[asset]={longSharpe:l.sharpe,shortSharpe:sh.sharpe,longData:l.eligibleData,shortData:sh.eligibleData,longUnavailable:l.unavailable,shortUnavailable:sh.unavailable};if(l.eligibleData&&l.sharpe>=cfg.longSharpeThreshold)long.push(asset);if(sh.eligibleData&&sh.sharpe>=cfg.shortSharpeThreshold)short.push(asset)}
  return{month:monthKey(monthTs),sampleStart,sampleEnd,long,short,details};
}
function bnh(series,start,end){const a=series.rows.find(x=>x.openTime>=start),b=[...series.rows].reverse().find(x=>x.openTime<end);return a&&b&&b.close>0?(b.close/a.close-1)*100:null}
export function runAdaptiveTrendSharpeProxyV1(dataset,config={}){
  const cfg={...ADAPTIVE_TREND_SHARPE_PROXY_V1_CONFIG,...config,gate:{...ADAPTIVE_TREND_SHARPE_PROXY_V1_CONFIG.gate,...(config.gate||{})}};
  const assets=Array.isArray(config.assets)&&config.assets.length?[...new Set(config.assets.map(String))]:[...ADAPTIVE_TREND_SHARPE_PROXY_V1_ASSETS];
  const all=[...new Set(['BTC',...assets])],series={};for(const a of all)series[a]=buildSeries(dataset?.[a]?.bars,dataset?.[a]?.funding,cfg);
  const master=series.BTC;if(!master.rows.length)throw new Error('BTC benchmark data required');
  const selectorCache=new Map(),states=Object.fromEntries(assets.map(a=>[a,{side:0,trail:null}])),prevW=new Map(),assetContribution=Object.fromEntries(assets.map(a=>[a,0]));
  let longContribution=0,shortContribution=0,longFunding=0,shortFunding=0,totalTurnover=0,totalCost=0,totalStressCost=0,unavailable=Object.fromEntries(assets.map(a=>[a,0]));const periods=[],selection=[];
  const evalRows=master.rows.filter(x=>x.openTime>=cfg.evalStart&&x.openTime<cfg.evalEnd);const masterIdx=new Map(master.rows.map((x,i)=>[x.openTime,i]));
  let lastMonth=null,currentSel=null;
  for(const mr of evalRows){const mi=masterIdx.get(mr.openTime);if(mi==null||mi>=master.rows.length-1)continue;const mnext=master.rows[mi+1];if(!contiguous(mr,mnext,cfg))continue;const ms=monthStart(mr.openTime);if(ms!==lastMonth){currentSel=selectorForMonth(series,assets,ms,cfg);selectorCache.set(currentSel.month,currentSel);selection.push(currentSel);lastMonth=ms}
    const candidate=[];
    for(const asset of assets){const s=series[asset],i=s.by.get(mr.openTime);let st=states[asset];if(i==null||i>=s.rows.length-1||!contiguous(s.rows[i],s.rows[i+1],cfg)){states[asset]={side:0,trail:null};unavailable[asset]++;continue}const row=s.rows[i],next=s.rows[i+1];if(st.side>0&&!currentSel.long.includes(asset))st={side:0,trail:null};if(st.side<0&&!currentSel.short.includes(asset))st={side:0,trail:null};
      let exitedThisBar=false;if(st.side){const oldSide=st.side,u=updateState({active:true,trail:st.trail},s,i,oldSide,cfg);if(u.active)st={side:oldSide,trail:u.trail};else{st={side:0,trail:null};exitedThisBar=true}}
      if(!st.side&&!exitedThisBar){const mom=s.mom[i],atr=s.atr[i];if(finite(mom)&&finite(atr)&&atr>0){if(currentSel.long.includes(asset)&&mom>cfg.thetaEntry)st={side:1,trail:row.close-cfg.atrMult*atr};else if(currentSel.short.includes(asset)&&mom<-cfg.thetaEntry)st={side:-1,trail:row.close+cfg.atrMult*atr}}}
      if(st.side&&!fundingCoverage(s.funding,row.closeTime,next.closeTime,cfg.maxFundingGapHours*HOUR)){st={side:0,trail:null};unavailable[asset]++}
      states[asset]=st;if(st.side)candidate.push({asset,side:st.side,row,next,series:s});
    }
    const longs=candidate.filter(x=>x.side>0),shorts=candidate.filter(x=>x.side<0),weights=new Map();for(const x of longs)weights.set(x.asset,cfg.longBudget/longs.length);for(const x of shorts)weights.set(x.asset,-cfg.shortBudget/shorts.length);
    const keys=new Set([...prevW.keys(),...weights.keys()]);let turnover=0,cost=0,stressCost=0;for(const a of keys){const d=Math.abs((weights.get(a)||0)-(prevW.get(a)||0));turnover+=d;cost+=d*cfg.costBps/10000;stressCost+=d*cfg.stressCostBps/10000;const side=(weights.get(a)||0)!==0?Math.sign(weights.get(a)):Math.sign(prevW.get(a)||0);assetContribution[a]-=d*cfg.costBps/10000;if(side>0)longContribution-=d*cfg.costBps/10000;else if(side<0)shortContribution-=d*cfg.costBps/10000}
    let gross=0,funding=0;for(const x of candidate){const w=weights.get(x.asset)||0;if(!w)continue;const pr=w*(x.next.close/x.row.close-1),fr=-w*sumFundingBetween(x.series.funding,x.row.closeTime,x.next.closeTime);gross+=pr;funding+=fr;assetContribution[x.asset]+=pr+fr;if(w>0){longContribution+=pr+fr;longFunding+=fr}else{shortContribution+=pr+fr;shortFunding+=fr}}
    const ret=gross+funding-cost,stressRet=gross+funding-stressCost;periods.push({at:mr.openTime,nextAt:mnext.openTime,month:currentSel.month,longs:longs.map(x=>x.asset),shorts:shorts.map(x=>x.asset),grossReturn:gross,fundingReturn:funding,turnover,costReturn:cost,return:ret,stressReturn:stressRet,grossExposure:[...weights.values()].reduce((s,w)=>s+Math.abs(w),0)});prevW.clear();for(const [a,w] of weights)prevW.set(a,w);totalTurnover+=turnover;totalCost+=cost;totalStressCost+=stressCost;
  }
  if(periods.length&&prevW.size){let closeTurn=0;for(const [a,w] of prevW){closeTurn+=Math.abs(w);assetContribution[a]-=Math.abs(w)*cfg.costBps/10000;if(w>0)longContribution-=Math.abs(w)*cfg.costBps/10000;else shortContribution-=Math.abs(w)*cfg.costBps/10000}const p=periods.at(-1);const c=closeTurn*cfg.costBps/10000,sc=closeTurn*cfg.stressCostBps/10000;p.return-=c;p.stressReturn-=sc;p.costReturn+=c;p.turnover+=closeTurn;totalTurnover+=closeTurn;totalCost+=c;totalStressCost+=sc}
  const summary=summarize(periods.map(x=>x.return),cfg.startEquity),stressSummary=summarize(periods.map(x=>x.stressReturn),cfg.startEquity),stability=chronological(periods,5);const byAsset=assets.map(asset=>({asset,contributionPct:assetContribution[asset]*100,unavailableIntervals:unavailable[asset]}));const positive=byAsset.filter(x=>x.contributionPct>0),posTotal=positive.reduce((s,x)=>s+x.contributionPct,0),concentration=posTotal>0?Math.max(...positive.map(x=>x.contributionPct/posTotal*100)):0;
  const g=cfg.gate,reasons=[];if(summary.periods<g.minPeriods)reasons.push('PERIODS_LT_'+g.minPeriods);if(summary.totalReturnPct<=0)reasons.push('RETURN_NOT_POSITIVE');if(summary.profitFactor<g.minProfitFactor)reasons.push('PF_LT_'+g.minProfitFactor);if(summary.maxDrawdownPct>g.maxDrawdownPct)reasons.push('DD_GT_'+g.maxDrawdownPct+'PCT');if(summary.sharpe<g.minSharpe)reasons.push('SHARPE_LT_'+g.minSharpe);if(stability.positiveWindows<g.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+g.minPositiveWindows);if(positive.length<g.minPositiveAssets)reasons.push('POSITIVE_ASSETS_LT_'+g.minPositiveAssets);if(concentration>g.maxPositivePnlConcentrationPct)reasons.push('POSITIVE_PNL_CONCENTRATION_GT_'+g.maxPositivePnlConcentrationPct+'PCT');if(stressSummary.totalReturnPct<=0)reasons.push('STRESS_RETURN_NOT_POSITIVE');
  const benchmarkAssets=assets.map(a=>bnh(series[a],cfg.evalStart,cfg.evalEnd)).filter(finite);return{ruleset:ADAPTIVE_TREND_SHARPE_PROXY_V1_RULESET,exactReplication:false,researchOnly:true,executionImpact:false,autoPromotion:false,assets,config:cfg,periods,selection,summary,stressSummary,stability,byAsset,positivePnlConcentrationPct:concentration,gate:{pass:reasons.length===0,reasons,positiveAssets:positive.length},diagnostics:{longContributionPct:longContribution*100,shortContributionPct:shortContribution*100,longFundingPct:longFunding*100,shortFundingPct:shortFunding*100,totalTurnover,totalModeledCostPct:totalCost*100,totalStressCostPct:totalStressCost*100,activeLongBarSharePct:periods.length?periods.filter(x=>x.longs.length).length/periods.length*100:0,activeShortBarSharePct:periods.length?periods.filter(x=>x.shorts.length).length/periods.length*100:0,unavailableIntervals:unavailable},benchmarks:{btcBuyHoldReturnPct:bnh(series.BTC,cfg.evalStart,cfg.evalEnd),equalWeightBuyHoldReturnPct:benchmarkAssets.length?mean(benchmarkAssets):null},decision:reasons.length?'DISCOVERY_FAIL_RESEARCH_REDESIGN':'DISCOVERY_PASS_HOLDOUT_REQUIRED'};
}

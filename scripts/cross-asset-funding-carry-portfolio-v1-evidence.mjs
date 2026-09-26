import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {
  FUNDING_CARRY_V2_CONFIG as BASE_CONFIG,
  newFundingCarryV2State,
  fundingEligibilityV2,
  openFundingCarryV2,
  applyFundingSettlementsV2,
  markFundingCarryV2,
  fundingCarryV2ExitReason,
  closeFundingCarryV2
} from '../funding-carry-paper-v2.js';
import {CROSS_ASSET_FUNDING_CARRY_PORTFOLIO_V1 as C} from '../cross-asset-funding-carry-portfolio-v1.js';

const VISION='https://data.binance.vision/data',H4=4*3600000,HOUR=3600000,MIN=60000,DAY=86400000;
const FUNDING_START=Date.parse(C.fundingWarmupStart),START=Date.parse(C.evaluationStart),SPLIT=Date.parse(C.splitAt),END=Date.parse(C.evaluationEnd);
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function monthsBetween(startMs,endMs){
  const out=[];let d=new Date(Date.UTC(new Date(startMs).getUTCFullYear(),new Date(startMs).getUTCMonth(),1));
  while(d.getTime()<endMs){const y=d.getUTCFullYear(),m=d.getUTCMonth()+1;out.push(`${y}-${String(m).padStart(2,'0')}`);d=new Date(Date.UTC(y,m,1));}
  return out;
}
function daysBetween(startMs,endMs){const out=[];for(let t=startMs;t<endMs;t+=DAY)out.push(new Date(t).toISOString().slice(0,10));return out;}
function monthDays(ym){
  const [y,m]=ym.split('-').map(Number),a=Date.UTC(y,m-1,1),b=Date.UTC(y,m,1);
  return daysBetween(a,b);
}
function tsNorm(v){
  const x=Number(v);if(Number.isFinite(x))return x>1e14?Math.floor(x/1000):x;
  const p=Date.parse(String(v||''));return Number.isFinite(p)?p:null;
}
function csvLines(text){return String(text||'').trim().split(/\r?\n/).filter(Boolean).map(line=>line.split(',').map(x=>x.replace(/^"|"$/g,'').trim()));}

async function fetchZipCsv(url,tmpDir){
  const r=await fetch(url,{headers:{'user-agent':'MERIDIAN-CROSS-ASSET-CARRY-PORTFOLIO-V1/1.0'}});
  if(r.status===404)return null;
  if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);
  const buf=Buffer.from(await r.arrayBuffer()),p=path.join(tmpDir,`x-${Math.random().toString(36).slice(2)}.zip`);
  await fs.writeFile(p,buf);
  try{return execFileSync('unzip',['-p',p],{encoding:'utf8',maxBuffer:30*1024*1024});}
  finally{await fs.unlink(p).catch(()=>{});}
}
async function poolMap(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out;
}
function parseKlines(text){
  if(!text)return[];const out=[];
  for(const row of csvLines(text)){
    const t=tsNorm(row[0]),o=Number(row[1]),h=Number(row[2]),l=Number(row[3]),c=Number(row[4]);
    if([t,o,h,l,c].every(Number.isFinite)&&o>0&&c>0)out.push({t,o,h,l,c});
  }
  return out;
}
function parseFunding(text){
  if(!text)return[];const rows=csvLines(text);if(!rows.length)return[];
  const header=rows[0].map(x=>String(x).toLowerCase()),hasHeader=header.some(x=>x.includes('calc_time')||x.includes('funding'));
  const timeIdx=hasHeader?Math.max(0,header.findIndex(x=>x.includes('calc_time')||x==='fundingtime')):0;
  let rateIdx=hasHeader?header.findIndex(x=>x.includes('last_funding_rate')||x==='fundingrate'):-1;if(rateIdx<0)rateIdx=2;
  const out=[];
  for(const row of rows.slice(hasHeader?1:0)){const t=tsNorm(row[timeIdx]),rate=Number(row[rateIdx]);if(Number.isFinite(t)&&Number.isFinite(rate))out.push({fundingTime:t,fundingRate:rate});}
  return out;
}
function uniqSort(rows,key){const m=new Map();for(const x of rows)m.set(x[key],x);return [...m.values()].sort((a,b)=>a[key]-b[key]);}

function monthlyUrl(symbol,kind,ym,interval='4h'){
  if(kind==='spot')return `${VISION}/spot/monthly/klines/${symbol}/${interval}/${symbol}-${interval}-${ym}.zip`;
  if(kind==='perp')return `${VISION}/futures/um/monthly/klines/${symbol}/${interval}/${symbol}-${interval}-${ym}.zip`;
  return `${VISION}/futures/um/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${ym}.zip`;
}
function dailyUrl(symbol,kind,day,interval='4h'){
  if(kind==='spot')return `${VISION}/spot/daily/klines/${symbol}/${interval}/${symbol}-${interval}-${day}.zip`;
  if(kind==='perp')return `${VISION}/futures/um/daily/klines/${symbol}/${interval}/${symbol}-${interval}-${day}.zip`;
  return `${VISION}/futures/um/daily/fundingRate/${symbol}/${symbol}-fundingRate-${day}.zip`;
}

function missing4h(rows,start,end){
  const have=new Set(rows.map(x=>x.t)),out=[];
  for(let t=start;t<end;t+=H4)if(!have.has(t))out.push(t);
  return out;
}
function aggregateExact(rows,sourceMs,required){
  const m=new Map();
  for(const x of rows){
    const bucket=Math.floor(x.t/H4)*H4,b=m.get(bucket);
    if(!b)m.set(bucket,{t:bucket,o:x.o,h:x.h,l:x.l,c:x.c,seen:new Set([x.t])});
    else{b.h=Math.max(b.h,x.h);b.l=Math.min(b.l,x.l);b.c=x.c;b.seen.add(x.t);}
  }
  return [...m.values()].filter(x=>x.seen.size===required).map(({seen,...x})=>x).sort((a,b)=>a.t-b.t);
}
async function repairMarket(symbol,kind,rows,tmpDir){
  let merged=uniqSort(rows,'t'),initial=missing4h(merged,START,END);
  if(!initial.length)return{rows:merged,diagnostics:{initialMissing:[],repaired1h:[],repaired1m:[],remaining:[]}};
  const wanted=new Set(initial),days=[...new Set(initial.map(t=>new Date(t).toISOString().slice(0,10)))];
  const h1files=await poolMap(days,8,async d=>({d,text:await fetchZipCsv(dailyUrl(symbol,kind,d,'1h'),tmpDir)}));
  const r1=h1files.flatMap(x=>aggregateExact(parseKlines(x.text),HOUR,4)).filter(x=>wanted.has(x.t));
  merged=uniqSort([...merged,...r1],'t');
  const rem1=missing4h(merged,START,END),wanted1=new Set(rem1),days1=[...new Set(rem1.map(t=>new Date(t).toISOString().slice(0,10)))];
  const m1files=await poolMap(days1,4,async d=>({d,text:await fetchZipCsv(dailyUrl(symbol,kind,d,'1m'),tmpDir)}));
  const r2=m1files.flatMap(x=>aggregateExact(parseKlines(x.text),MIN,240)).filter(x=>wanted1.has(x.t));
  merged=uniqSort([...merged,...r2],'t');
  return{rows:merged,diagnostics:{initialMissing:initial.map(t=>new Date(t).toISOString()),repaired1h:r1.map(x=>new Date(x.t).toISOString()),repaired1m:r2.map(x=>new Date(x.t).toISOString()),remaining:missing4h(merged,START,END).map(t=>new Date(t).toISOString())}};
}

async function loadMarket(symbol,kind,tmpDir){
  const months=monthsBetween(START,END);
  const monthly=await poolMap(months,10,async ym=>({ym,text:await fetchZipCsv(monthlyUrl(symbol,kind,ym),tmpDir)}));
  let rows=monthly.flatMap(x=>parseKlines(x.text));
  const repaired=await repairMarket(symbol,kind,rows,tmpDir);
  return{rows:repaired.rows,missingMonths:monthly.filter(x=>!x.text).map(x=>x.ym),repair:repaired.diagnostics,filesLoaded:monthly.filter(x=>x.text).length,filesRequested:monthly.length};
}
async function loadFunding(symbol,tmpDir){
  const months=monthsBetween(FUNDING_START,END);
  const monthly=await poolMap(months,10,async ym=>({ym,text:await fetchZipCsv(monthlyUrl(symbol,'funding',ym),tmpDir)}));
  let rows=monthly.flatMap(x=>parseFunding(x.text));
  const missingMonths=monthly.filter(x=>!x.text).map(x=>x.ym),fallbackDays=[...new Set(missingMonths.flatMap(monthDays).filter(d=>Date.parse(d+'T00:00:00Z')<END))];
  const daily=await poolMap(fallbackDays,10,async d=>({d,text:await fetchZipCsv(dailyUrl(symbol,'funding',d),tmpDir)}));
  rows=uniqSort([...rows,...daily.flatMap(x=>parseFunding(x.text))],'fundingTime');
  return{rows,missingMonths,dailyMissing:daily.filter(x=>!x.text).map(x=>x.d),filesLoaded:monthly.filter(x=>x.text).length+daily.filter(x=>x.text).length,filesRequested:monthly.length+daily.length};
}
function coverage(rows,start,end,key='t'){
  const expected=Math.floor((end-start)/H4),actual=rows.filter(x=>x[key]>=start&&x[key]<end).length;
  return{expected4h:expected,actual4h:actual,complete:actual===expected};
}
function maxFundingGapHours(rows,start,end){
  const xs=rows.filter(x=>x.fundingTime>=start&&x.fundingTime<end);
  if(!xs.length)return Infinity;
  let max=(xs[0].fundingTime-start)/HOUR;
  for(let i=1;i<xs.length;i++)max=Math.max(max,(xs[i].fundingTime-xs[i-1].fundingTime)/HOUR);
  max=Math.max(max,(end-xs.at(-1).fundingTime)/HOUR);return max;
}
function stats(rows=[]){
  const xs=[...rows].sort((a,b)=>a.closedAtMs-b.closedAtMs),vals=xs.map(x=>x.netPnl),wins=vals.filter(x=>x>0),losses=vals.filter(x=>x<0);
  const gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0)),net=vals.reduce((a,b)=>a+b,0);
  let eq=0,peak=0,dd=0;for(const v of vals){eq+=v;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}
  return{cycles:xs.length,netPnl:round(net,2),profitFactor:gl?round(gp/gl,2):(gp>0?99:0),profitableShare:xs.length?round(wins.length/xs.length,4):null,maxDrawdown:round(dd,2)};
}
function group(rows,key){const m={};for(const x of rows)(m[key(x)]||(m[key(x)]=[])).push(x);return Object.fromEntries(Object.entries(m).map(([k,v])=>[k,stats(v)]));}
function pf(vals){const gp=vals.filter(x=>x>0).reduce((a,b)=>a+b,0),gl=Math.abs(vals.filter(x=>x<0).reduce((a,b)=>a+b,0));return gl?gp/gl:(gp>0?99:0);}

const tmpDir=await fs.mkdtemp(path.join(os.tmpdir(),'meridian-carry-portfolio-'));
try{
  const data={};
  for(const symbol of C.symbols){
    console.log('load',symbol);
    const [spot,perp,funding]=await Promise.all([loadMarket(symbol,'spot',tmpDir),loadMarket(symbol,'perp',tmpDir),loadFunding(symbol,tmpDir)]);
    const spotAt=new Map(spot.rows.map(x=>[x.t,x])),perpAt=new Map(perp.rows.map(x=>[x.t,x]));
    const fundingRows=funding.rows.map(x=>({...x,markPrice:Number(perpAt.get(Math.floor(x.fundingTime/H4)*H4)?.o)}));
    data[symbol]={spot,perp,funding,fundingRows,spotAt,perpAt};
  }

  const ptr=Object.fromEntries(C.symbols.map(s=>[s,0]));
  const states=Object.fromEntries(C.symbols.map(s=>[s,null]));
  const cooldownUntil=Object.fromEntries(C.symbols.map(s=>[s,START]));
  const entryEligibility=Object.fromEntries(C.symbols.map(s=>[s,null]));
  const cycles=[];
  let realized=0,portfolioEquity=C.portfolioReferenceCapital,peakEquity=portfolioEquity,maxMarkedDrawdown=0,maxSimultaneousBaskets=0;

  for(let t=START;t<END;t+=H4){
    for(const symbol of C.symbols){
      const rows=data[symbol].fundingRows;
      while(ptr[symbol]<rows.length&&rows[ptr[symbol]].fundingTime<=t)ptr[symbol]++;
    }

    for(const symbol of C.symbols){
      let state=states[symbol];
      if(!state)continue;
      const d=data[symbol],spot=d.spotAt.get(t),perp=d.perpAt.get(t);
      if(!spot||!perp)continue;
      const recent=d.fundingRows.slice(Math.max(0,ptr[symbol]-120),ptr[symbol]);
      state=applyFundingSettlementsV2(state,recent,t);
      state=markFundingCarryV2(state,{spotBid:spot.o,perpAsk:perp.o},t);
      const reason=fundingCarryV2ExitReason(state,recent,t);
      if(reason){
        state=closeFundingCarryV2(state,{spotBid:spot.o,perpAsk:perp.o},reason,t);
        const done=state.closedCycles.at(-1),net=Number(done.realizedPnl??done.netPnl??0);
        cycles.push({
          symbol,openedAt:done.openedAt,closedAt:done.closedAt,openedAtMs:Date.parse(done.openedAt),closedAtMs:Date.parse(done.closedAt),
          holdDays:round((Date.parse(done.closedAt)-Date.parse(done.openedAt))/DAY,3),exitReason:done.exitReason,
          entryCoverage:entryEligibility[symbol]?.grossCostCoverage??null,entryPositiveShare:entryEligibility[symbol]?.positiveShare??null,entryBasisPct:done.entryBasisPct,
          fundingIncome:Number(done.fundingIncome||0),basisPnl:Number(done.basisPnl||0),totalEstimatedCosts:Number(done.totalEstimatedCosts||0),netPnl:net
        });
        realized+=net;states[symbol]=null;entryEligibility[symbol]=null;cooldownUntil[symbol]=t+C.cooldownMs;
      }else states[symbol]=state;
    }

    for(const symbol of C.symbols){
      if(states[symbol]||t<cooldownUntil[symbol])continue;
      const d=data[symbol],spot=d.spotAt.get(t),perp=d.perpAt.get(t);
      if(!spot||!perp)continue;
      const recent=d.fundingRows.slice(Math.max(0,ptr[symbol]-120),ptr[symbol]);
      const cfg=Object.freeze({...BASE_CONFIG,symbol});
      const eligibility=fundingEligibilityV2(recent,{spotAsk:spot.o,perpBid:perp.o},t,cfg);
      if(!eligibility.eligible)continue;
      let state=newFundingCarryV2State(t,cfg);
      state=openFundingCarryV2(state,{spotAsk:spot.o,perpBid:perp.o},eligibility,t);
      state=markFundingCarryV2(state,{spotBid:spot.o,perpAsk:perp.o},t);
      states[symbol]=state;entryEligibility[symbol]=eligibility;
    }

    const openStates=C.symbols.map(s=>states[s]).filter(Boolean);
    maxSimultaneousBaskets=Math.max(maxSimultaneousBaskets,openStates.length);
    const openNet=openStates.reduce((sum,s)=>sum+Number(s?.basket?.netPnl||0),0);
    portfolioEquity=C.portfolioReferenceCapital+realized+openNet;
    peakEquity=Math.max(peakEquity,portfolioEquity);
    maxMarkedDrawdown=Math.max(maxMarkedDrawdown,peakEquity-portfolioEquity);
  }

  const overall=stats(cycles),primaryRows=cycles.filter(x=>x.closedAtMs<SPLIT),secondaryRows=cycles.filter(x=>x.closedAtMs>=SPLIT);
  const primary=stats(primaryRows),secondary=stats(secondaryRows),byAsset=group(cycles,x=>x.symbol),byYear=group(cycles,x=>String(new Date(x.closedAtMs).getUTCFullYear()));
  const positive=cycles.filter(x=>x.netPnl>0),positiveSum=positive.reduce((a,x)=>a+x.netPnl,0);
  const assetPositivePnlShare=Object.fromEntries(C.symbols.map(s=>[s,positiveSum>0?round(positive.filter(x=>x.symbol===s).reduce((a,x)=>a+x.netPnl,0)/positiveSum,4):0]));
  const fundingMinusCosts=cycles.reduce((a,x)=>a+x.fundingIncome-x.totalEstimatedCosts,0);
  const stressed=cycles.map(x=>x.netPnl-C.extraStressUsdPerCycle),stressedNet=stressed.reduce((a,b)=>a+b,0),stressedPf=pf(stressed);
  const years=Object.values(byYear),positiveYears=years.filter(x=>(x.netPnl||0)>=0).length;

  const dataQuality={};
  for(const symbol of C.symbols){
    const d=data[symbol],spotCov=coverage(d.spot.rows,START,END),perpCov=coverage(d.perp.rows,START,END),fundGap=maxFundingGapHours(d.fundingRows,FUNDING_START,END);
    const fundingComplete=d.fundingRows.length>0&&d.fundingRows[0].fundingTime<=FUNDING_START+8*HOUR&&d.fundingRows.at(-1).fundingTime>=END-16*HOUR&&fundGap<=12&&d.funding.dailyMissing.length===0;
    dataQuality[symbol]={spot:spotCov,perp:perpCov,fundingPeriods:d.fundingRows.length,fundingFirst:d.fundingRows[0]?new Date(d.fundingRows[0].fundingTime).toISOString():null,fundingLast:d.fundingRows.at(-1)?new Date(d.fundingRows.at(-1).fundingTime).toISOString():null,maxFundingGapHours:round(fundGap,2),fundingComplete,spotRepair:d.spot.repair,perpRepair:d.perp.repair,missingFundingMonths:d.funding.missingMonths,dailyFundingMissing:d.funding.dailyMissing};
  }
  const dataAdequacy=Object.values(dataQuality).every(x=>x.spot.complete&&x.perp.complete&&x.fundingComplete);

  const gates={
    sample:overall.cycles>=18,
    aggregateNet:(overall.netPnl||0)>0,
    profitFactor:(overall.profitFactor||0)>=1.5,
    profitableShare:(overall.profitableShare||0)>=.65,
    carryPaysCosts:fundingMinusCosts>0,
    markedDrawdown:maxMarkedDrawdown<=600,
    primary:primary.cycles>=8&&(primary.netPnl||0)>0&&(primary.profitFactor||0)>=1.25,
    secondary:secondary.cycles>=8&&(secondary.netPnl||0)>0&&(secondary.profitFactor||0)>=1.25,
    perAssetSample:C.symbols.every(s=>(byAsset[s]?.cycles||0)>=4),
    perAssetNet:C.symbols.every(s=>(byAsset[s]?.netPnl||0)>0),
    pnlConcentration:Math.max(...Object.values(assetPositivePnlShare))<=.70,
    calendarBreadth:years.length>=4&&positiveYears===years.length,
    frictionStress:stressedNet>0&&stressedPf>=1.10,
    dataAdequacy
  };

  const openTail=Object.fromEntries(C.symbols.filter(s=>states[s]).map(s=>[s,{openedAt:states[s].basket?.openedAt,netPnl:states[s].basket?.netPnl,fundingIncome:states[s].basket?.fundingIncome}]));
  const out={
    schemaVersion:'CROSS-ASSET-FUNDING-CARRY-PORTFOLIO-V1-EVIDENCE',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,
    predeclaredDesign:'research/cross-asset-funding-carry-portfolio-v1-design.md',source:'BINANCE_VISION_OFFICIAL_ARCHIVES',
    window:{fundingWarmupStart:C.fundingWarmupStart,evaluationStart:C.evaluationStart,splitAt:C.splitAt,evaluationEnd:C.evaluationEnd},
    portfolioReferenceCapital:C.portfolioReferenceCapital,overall,primary,secondary,byAsset,byYear,
    markedPortfolio:{endingEquity:round(portfolioEquity,2),peakEquity:round(peakEquity,2),maxMarkedDrawdown:round(maxMarkedDrawdown,2),maxMarkedDrawdownPct:round(maxMarkedDrawdown/C.portfolioReferenceCapital*100,3),maxSimultaneousBaskets},
    fundingMinusModeledCosts:round(fundingMinusCosts,2),stressedNetPnl:round(stressedNet,2),stressedProfitFactor:round(stressedPf,2),
    assetPositivePnlShare,exitReasons:Object.fromEntries(Object.entries(cycles.reduce((m,x)=>(m[x.exitReason]=(m[x.exitReason]||0)+1,m),{})).sort()),
    gates,pass:Object.values(gates).every(Boolean),dataQuality,openTail,cycles
  };
  await fs.mkdir('artifacts',{recursive:true});
  await fs.writeFile('artifacts/cross-asset-funding-carry-portfolio-v1-evidence.json',JSON.stringify(out,null,2));
  console.log(JSON.stringify({overall,primary,secondary,byAsset,byYear,markedPortfolio:out.markedPortfolio,fundingMinusModeledCosts:out.fundingMinusModeledCosts,stressedNetPnl:out.stressedNetPnl,stressedProfitFactor:out.stressedProfitFactor,assetPositivePnlShare,gates,pass:out.pass,dataQuality,openTail,cycles:cycles.map(x=>({symbol:x.symbol,openedAt:x.openedAt,closedAt:x.closedAt,netPnl:round(x.netPnl,2),fundingIncome:round(x.fundingIncome,2),basisPnl:round(x.basisPnl,2),exitReason:x.exitReason,entryCoverage:x.entryCoverage}))},null,2));
}finally{
  await fs.rm(tmpDir,{recursive:true,force:true}).catch(()=>{});
}

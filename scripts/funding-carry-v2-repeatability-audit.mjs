import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {
  FUNDING_CARRY_V2_CONFIG as C,
  newFundingCarryV2State,
  fundingEligibilityV2,
  openFundingCarryV2,
  applyFundingSettlementsV2,
  markFundingCarryV2,
  fundingCarryV2ExitReason,
  closeFundingCarryV2
} from '../funding-carry-paper-v2.js';

const VISION='https://data.binance.vision/data',H4=4*3600000,HOUR=3600000,DAY=86400000;
const AUDIT_START=Date.parse('2022-01-01T00:00:00.000Z');
const AUDIT_END=Date.parse('2026-09-06T00:00:00.000Z');
const FUNDING_START=Date.parse('2021-12-01T00:00:00.000Z');
const COOLDOWN=DAY,EXTRA_STRESS_USD=8;
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function monthsBetween(startMs,endMs){
  const out=[];let d=new Date(Date.UTC(new Date(startMs).getUTCFullYear(),new Date(startMs).getUTCMonth(),1));
  const end=new Date(endMs);
  while(d.getTime()<endMs){
    const y=d.getUTCFullYear(),m=d.getUTCMonth()+1;
    out.push(`${y}-${String(m).padStart(2,'0')}`);
    d=new Date(Date.UTC(y,m,1));
  }
  return out;
}
function daysBetween(startMs,endMs){
  const out=[];for(let t=startMs;t<endMs;t+=DAY)out.push(new Date(t).toISOString().slice(0,10));return out;
}
function tsNorm(v){
  const x=Number(v);
  if(Number.isFinite(x))return x>1e14?Math.floor(x/1000):x;
  const p=Date.parse(String(v||''));return Number.isFinite(p)?p:null;
}
function csvLines(text){
  return text.trim().split(/\r?\n/).map(line=>line.split(',').map(x=>x.replace(/^"|"$/g,'').trim()));
}
async function fetchZipCsv(url,tmpDir){
  const r=await fetch(url,{headers:{'user-agent':'MERIDIAN-FUNDING-CARRY-V2-AUDIT/2.0'}});
  if(r.status===404)return null;
  if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);
  const buf=Buffer.from(await r.arrayBuffer());
  const p=path.join(tmpDir,`v2-${Math.random().toString(36).slice(2)}.zip`);
  await fs.writeFile(p,buf);
  let text;
  try{text=execFileSync('unzip',['-p',p],{encoding:'utf8',maxBuffer:20*1024*1024});}
  finally{await fs.unlink(p).catch(()=>{});}
  return text;
}
async function poolMap(items,limit,fn){
  const out=new Array(items.length);let idx=0;
  async function worker(){while(true){const i=idx++;if(i>=items.length)return;out[i]=await fn(items[i],i);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return out;
}
function parseKlines(text){
  if(!text)return[];
  const out=[];
  for(const row of csvLines(text)){
    const t=tsNorm(row[0]);if(!Number.isFinite(t))continue;
    const o=Number(row[1]),h=Number(row[2]),l=Number(row[3]),c=Number(row[4]);
    if([o,h,l,c].every(Number.isFinite)&&o>0&&c>0)out.push({t,o,h,l,c});
  }
  return out;
}
function parseFunding(text){
  if(!text)return[];
  const rows=csvLines(text);if(!rows.length)return[];
  const header=rows[0].map(x=>String(x).toLowerCase());
  const hasHeader=header.some(x=>x.includes('calc_time')||x.includes('funding'));
  const timeIdx=hasHeader?Math.max(0,header.findIndex(x=>x.includes('calc_time')||x==='fundingtime')):0;
  let rateIdx=hasHeader?header.findIndex(x=>x.includes('last_funding_rate')||x==='fundingrate'):-1;
  if(rateIdx<0)rateIdx=2;
  const out=[];
  for(const row of rows.slice(hasHeader?1:0)){
    const t=tsNorm(row[timeIdx]);if(!Number.isFinite(t))continue;
    const rate=Number(row[rateIdx]);if(Number.isFinite(rate))out.push({fundingTime:t,fundingRate:rate});
  }
  return out;
}
function uniqSort(rows,key){
  const m=new Map();for(const x of rows)m.set(x[key],x);return [...m.values()].sort((a,b)=>a[key]-b[key]);
}
function monthUrl(kind,ym){
  if(kind==='spot')return `${VISION}/spot/monthly/klines/BTCUSDT/4h/BTCUSDT-4h-${ym}.zip`;
  if(kind==='swap')return `${VISION}/futures/um/monthly/klines/BTCUSDT/4h/BTCUSDT-4h-${ym}.zip`;
  return `${VISION}/futures/um/monthly/fundingRate/BTCUSDT/BTCUSDT-fundingRate-${ym}.zip`;
}
function dayUrl(kind,day){
  if(kind==='spot')return `${VISION}/spot/daily/klines/BTCUSDT/4h/BTCUSDT-4h-${day}.zip`;
  if(kind==='swap')return `${VISION}/futures/um/daily/klines/BTCUSDT/4h/BTCUSDT-4h-${day}.zip`;
  return `${VISION}/futures/um/daily/fundingRate/BTCUSDT/BTCUSDT-fundingRate-${day}.zip`;
}
async function loadVision(kind,tmpDir){
  const lastFullMonth=Date.parse('2026-09-01T00:00:00Z');
  const months=monthsBetween(FUNDING_START,lastFullMonth),days=daysBetween(lastFullMonth,AUDIT_END);
  const monthly=await poolMap(months,8,async ym=>({tag:ym,text:await fetchZipCsv(monthUrl(kind,ym),tmpDir)}));
  if(kind==='funding'){
    const diag=monthly.find(x=>x.tag==='2024-01'&&x.text);
    if(diag)console.log('FUNDING_ARCHIVE_2024_01_HEAD',diag.text.split(/\\r?\\n/).slice(0,6));
  }
  const daily=await poolMap(days,8,async d=>({tag:d,text:await fetchZipCsv(dayUrl(kind,d),tmpDir)}));
  const missing=[...monthly,...daily].filter(x=>x.text==null).map(x=>x.tag);
  const rows=[...monthly,...daily].flatMap(x=>kind==='funding'?parseFunding(x.text):parseKlines(x.text));
  return{rows:uniqSort(rows,kind==='funding'?'fundingTime':'t'),missing,filesRequested:monthly.length+daily.length,filesLoaded:monthly.filter(x=>x.text!=null).length+daily.filter(x=>x.text!=null).length};
}

function coverage(rows,start,end){
  const expected=Math.floor((end-start)/H4),actual=rows.filter(x=>x.t>=start&&x.t<end).length;
  return{expected4h:expected,actual4h:actual,complete:actual===expected};
}
function pf(values){
  const gp=values.filter(x=>x>0).reduce((a,b)=>a+b,0),gl=Math.abs(values.filter(x=>x<0).reduce((a,b)=>a+b,0));
  return gl?gp/gl:(gp>0?99:0);
}
function maxDrawdown(values){
  let eq=0,peak=0,dd=0;for(const v of values){eq+=v;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}return dd;
}
function yearKey(ts){return new Date(ts).getUTCFullYear().toString();}
function fundingMaxGapHours(rows,start,end){
  const xs=rows.filter(x=>x.fundingTime>=start&&x.fundingTime<=end);
  if(!xs.length)return Infinity;
  let max=Math.max((xs[0].fundingTime-start)/HOUR,(end-xs.at(-1).fundingTime)/HOUR);
  for(let i=1;i<xs.length;i++)max=Math.max(max,(xs[i].fundingTime-xs[i-1].fundingTime)/HOUR);
  return max;
}
function activeFundingGapHours(rows,openedAt,closedAt){return fundingMaxGapHours(rows,openedAt,closedAt);}

const tmpDir=await fs.mkdtemp(path.join(os.tmpdir(),'meridian-v2-'));
try{
  console.log('loading Binance Vision BTCUSDT spot/perpetual/funding archives');
  const [spotRaw,swapRaw,fundRaw]=await Promise.all([
    loadVision('spot',tmpDir),loadVision('swap',tmpDir),loadVision('funding',tmpDir)
  ]);
  const spot=spotRaw.rows,swap=swapRaw.rows,funding=fundRaw.rows;
  const spotAt=new Map(spot.map(x=>[x.t,x])),swapAt=new Map(swap.map(x=>[x.t,x]));
  const timeline=spot.filter(x=>x.t>=AUDIT_START&&x.t<AUDIT_END&&swapAt.has(x.t)).map(x=>x.t);

  // Funding archives do not include mark price; use contemporaneous perpetual 4h open.
  const enrichedFunding=funding.map(x=>{
    const px=swapAt.get(x.fundingTime)?.o;
    return {...x,markPrice:Number(px)};
  }).filter(x=>x.markPrice>0);

  let state=newFundingCarryV2State(AUDIT_START,C),cooldownUntil=AUDIT_START;
  let fundingPtr=0,lastAppliedPtr=0,cycles=[],entrySnapshots=[];
  while(fundingPtr<enrichedFunding.length&&enrichedFunding[fundingPtr].fundingTime<=AUDIT_START)fundingPtr++;
  lastAppliedPtr=fundingPtr;

  for(const t of timeline){
    while(fundingPtr<enrichedFunding.length&&enrichedFunding[fundingPtr].fundingTime<=t)fundingPtr++;
    const spotBar=spotAt.get(t),swapBar=swapAt.get(t);if(!spotBar||!swapBar)continue;
    const eligibilitySnapshot={spotAsk:spotBar.o,perpBid:swapBar.o};
    const markSnapshot={spotBid:spotBar.o,perpAsk:swapBar.o};

    if(state.lifecycle==='ACTIVE_PAPER'&&state.basket){
      if(fundingPtr>lastAppliedPtr)state=applyFundingSettlementsV2(state,enrichedFunding.slice(lastAppliedPtr,fundingPtr),t);
      lastAppliedPtr=fundingPtr;
      state=markFundingCarryV2(state,markSnapshot,t);
      const recent=enrichedFunding.slice(Math.max(0,fundingPtr-40),fundingPtr);
      const reason=fundingCarryV2ExitReason(state,recent,t);
      if(reason){
        const eligibilityAtEntry=state.lastEligibility;
        state=closeFundingCarryV2(state,markSnapshot,reason,t);
        const done=state.closedCycles.at(-1),openedAt=Date.parse(done.openedAt),closedAt=Date.parse(done.closedAt);
        cycles.push({...done,holdDays:round((closedAt-openedAt)/DAY,3),entryCoverage:eligibilityAtEntry?.grossCostCoverage??null,
          entryPositiveShare:eligibilityAtEntry?.positiveShare??null,activeFundingMaxGapHours:round(activeFundingGapHours(enrichedFunding,openedAt,closedAt),2)});
        cooldownUntil=t+COOLDOWN;
      }
    }

    if(state.lifecycle==='STOPPED_REVIEW'&&t>=cooldownUntil){
      state=newFundingCarryV2State(t,C);lastAppliedPtr=fundingPtr;
    }

    if(state.lifecycle==='WAITING_ENTRY'&&t>=cooldownUntil){
      const lookback=enrichedFunding.slice(Math.max(0,fundingPtr-120),fundingPtr).filter(x=>x.fundingTime>=t-30*DAY&&x.fundingTime<=t);
      const eligibility=fundingEligibilityV2(lookback,eligibilitySnapshot,t,C);
      if(eligibility.eligible){
        entrySnapshots.push({t,at:new Date(t).toISOString(),coverage:eligibility.grossCostCoverage,positiveShare:eligibility.positiveShare,basisPct:eligibility.executableEntryBasisPct});
        state=openFundingCarryV2(state,eligibilitySnapshot,eligibility,t);
        state=markFundingCarryV2(state,markSnapshot,t);
        lastAppliedPtr=fundingPtr;
        const reason=fundingCarryV2ExitReason(state,lookback,t);
        if(reason){
          state=closeFundingCarryV2(state,markSnapshot,reason,t);
          const done=state.closedCycles.at(-1),openedAt=Date.parse(done.openedAt),closedAt=Date.parse(done.closedAt);
          cycles.push({...done,holdDays:round((closedAt-openedAt)/DAY,3),entryCoverage:eligibility.grossCostCoverage,
            entryPositiveShare:eligibility.positiveShare,activeFundingMaxGapHours:round(activeFundingGapHours(enrichedFunding,openedAt,closedAt),2)});
          cooldownUntil=t+COOLDOWN;
        }
      }
    }
  }

  const net=cycles.map(x=>Number(x.realizedPnl??x.netPnl??0)),positives=net.filter(x=>x>0),positiveSum=positives.reduce((a,b)=>a+b,0);
  const totalNet=net.reduce((a,b)=>a+b,0),profitFactor=pf(net),winShare=cycles.length?positives.length/cycles.length:0,dd=maxDrawdown(net);
  const carryBeforeBasis=cycles.reduce((a,x)=>a+Number(x.fundingIncome||0)-Number(x.totalEstimatedCosts||0),0);
  const stressed=net.map(x=>x-EXTRA_STRESS_USD),stressNet=stressed.reduce((a,b)=>a+b,0),stressPf=pf(stressed);
  const byYear={};for(const c of cycles){const y=yearKey(Date.parse(c.closedAt));(byYear[y]||(byYear[y]=[])).push(Number(c.realizedPnl??c.netPnl??0));}
  const yearStats=Object.fromEntries(Object.entries(byYear).map(([y,v])=>[y,{cycles:v.length,netPnl:round(v.reduce((a,b)=>a+b,0),2),profitFactor:round(pf(v),2)}]));
  const yearsWithCycles=Object.values(yearStats).filter(x=>x.cycles>0),positiveYears=yearsWithCycles.filter(x=>x.netPnl>0).length;
  const concentration=positiveSum>0?Math.max(0,...cycles.map(x=>{const v=Number(x.realizedPnl??x.netPnl??0);return v>0?v/positiveSum:0;})):1;
  const spotCov=coverage(spot,AUDIT_START,AUDIT_END),swapCov=coverage(swap,AUDIT_START,AUDIT_END);
  const fullFundingGap=fundingMaxGapHours(enrichedFunding,FUNDING_START,AUDIT_END-8*HOUR);
  const fundingCoverage=enrichedFunding.length>0&&enrichedFunding[0].fundingTime<=FUNDING_START+8*HOUR&&enrichedFunding.at(-1).fundingTime>=AUDIT_END-16*HOUR&&fullFundingGap<=12;
  const cycleFundingComplete=cycles.every(x=>Number(x.activeFundingMaxGapHours)<=12);
  const archiveComplete=[spotRaw,swapRaw,fundRaw].every(x=>x.missing.length===0);

  const gates={
    sample:cycles.length>=8,
    aggregateNet:totalNet>0,
    profitFactor:profitFactor>=1.5,
    profitableShare:winShare>=.65,
    carryPaysCosts:carryBeforeBasis>0,
    maxDrawdown:dd<=250,
    calendarBreadth:yearsWithCycles.length>=3&&positiveYears===yearsWithCycles.length,
    concentration:concentration<=.40,
    frictionStress:stressNet>0&&stressPf>=1.10,
    dataAdequacy:archiveComplete&&spotCov.complete&&swapCov.complete&&fundingCoverage&&cycleFundingComplete
  };

  const summary={
    completedCycles:cycles.length,
    openTail:state.lifecycle==='ACTIVE_PAPER'&&state.basket?{openedAt:state.basket.openedAt,netPnl:state.basket.netPnl,fundingIncome:state.basket.fundingIncome,basisPnl:state.basket.basisPnl}:null,
    aggregateNetPnl:round(totalNet,2),profitFactor:round(profitFactor,2),profitableShare:round(winShare,4),positiveCycles:positives.length,
    maxClosedEquityDrawdown:round(dd,2),fundingMinusModeledCosts:round(carryBeforeBasis,2),stressedNetPnl:round(stressNet,2),
    stressedProfitFactor:round(stressPf,2),maxPositiveCycleConcentration:round(concentration,4),calendarYearsWithCycles:yearsWithCycles.length,positiveCalendarYears:positiveYears
  };

  const out={
    schemaVersion:'FUNDING-CARRY-V2-REPEATABILITY-AUDIT-2',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,
    productionRuleset:'8.40-PAPER-BTC-FUNDING-CARRY-V2-COST-AMORTIZED',predeclaredDesign:'research/funding-carry-v2-repeatability-design.md',
    source:'BINANCE_VISION_OFFICIAL_SPOT_4H_UM_PERP_4H_AND_UM_FUNDINGRATE_ARCHIVES',
    auditWindow:{start:new Date(AUDIT_START).toISOString(),end:new Date(AUDIT_END).toISOString(),fundingWarmupStart:new Date(FUNDING_START).toISOString()},
    productionConfig:C,summary,yearStats,gates,auditPass:Object.values(gates).every(Boolean),
    cycles:cycles.map(c=>({openedAt:c.openedAt,closedAt:c.closedAt,holdDays:c.holdDays,exitReason:c.exitReason,entryBasisPct:c.entryBasisPct,
      entryCoverage:c.entryCoverage,entryPositiveShare:c.entryPositiveShare,fundingIncome:round(c.fundingIncome,2),basisPnl:round(c.basisPnl,2),
      totalEstimatedCosts:round(c.totalEstimatedCosts,2),netPnl:round(Number(c.realizedPnl??c.netPnl),2),activeFundingMaxGapHours:c.activeFundingMaxGapHours})),
    data:{
      spot:{bars:spot.length,filesRequested:spotRaw.filesRequested,filesLoaded:spotRaw.filesLoaded,missing:spotRaw.missing,coverage:spotCov},
      swap:{bars:swap.length,filesRequested:swapRaw.filesRequested,filesLoaded:swapRaw.filesLoaded,missing:swapRaw.missing,coverage:swapCov},
      funding:{periods:enrichedFunding.length,filesRequested:fundRaw.filesRequested,filesLoaded:fundRaw.filesLoaded,missing:fundRaw.missing,
        first:enrichedFunding[0]?new Date(enrichedFunding[0].fundingTime).toISOString():null,last:enrichedFunding.at(-1)?new Date(enrichedFunding.at(-1).fundingTime).toISOString():null,maxGapHours:round(fullFundingGap,2)},
      matchedTimelineBars:timeline.length,eligibleEntriesObserved:entrySnapshots.length
    }
  };
  await fs.mkdir('artifacts',{recursive:true});
  await fs.writeFile('artifacts/funding-carry-v2-repeatability-audit.json',JSON.stringify(out,null,2));
  console.log(JSON.stringify({summary:out.summary,yearStats:out.yearStats,gates:out.gates,auditPass:out.auditPass,cycles:out.cycles,data:out.data},null,2));
}finally{await fs.rm(tmpDir,{recursive:true,force:true}).catch(()=>{});}

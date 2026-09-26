import fs from 'node:fs/promises';
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

const BASE='https://www.okx.com',H4=4*3600000,HOUR=3600000,DAY=86400000;
const AUDIT_START=Date.parse('2022-01-01T00:00:00.000Z');
const AUDIT_END=Date.parse('2026-09-06T00:00:00.000Z');
const FUNDING_START=Date.parse('2021-12-01T00:00:00.000Z');
const COOLDOWN=DAY,EXTRA_STRESS_USD=8;
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function getJson(url,attempt=0){
  const r=await fetch(url,{headers:{'user-agent':'MERIDIAN-FUNDING-CARRY-V2-AUDIT/1.0','accept':'application/json'}});
  if(r.ok){const j=await r.json();if(String(j?.code||'0')==='0')return j;throw new Error(`OKX code ${j?.code}: ${j?.msg||'unknown'}`);}
  if((r.status===429||r.status>=500)&&attempt<6){await sleep(500*2**attempt);return getJson(url,attempt+1);}
  throw new Error(`${r.status} ${url}`);
}

async function historyCandles(instId){
  let cursor=AUDIT_END,out=[],calls=0;
  while(cursor>FUNDING_START){
    const url=`${BASE}/api/v5/market/history-candles?instId=${instId}&bar=4H&after=${cursor}&limit=100`;
    const j=await getJson(url),rows=Array.isArray(j?.data)?j.data:[];calls++;
    if(!rows.length)break;
    let oldest=Infinity;
    for(const k of rows){
      const t=Number(k[0]);if(Number.isFinite(t))oldest=Math.min(oldest,t);
      if(String(k[8]??'1')==='1'&&t>=FUNDING_START&&t<AUDIT_END)out.push({t,o:Number(k[1]),h:Number(k[2]),l:Number(k[3]),c:Number(k[4])});
    }
    if(!Number.isFinite(oldest)||oldest>=cursor)throw new Error(`${instId} non-advancing candle cursor`);
    cursor=oldest;await sleep(100);
  }
  out.sort((a,b)=>a.t-b.t);
  return {calls,rows:out.filter((x,i,a)=>!i||x.t!==a[i-1].t)};
}

async function fundingHistory(){
  let cursor=AUDIT_END,out=[],calls=0;
  while(cursor>FUNDING_START){
    const url=`${BASE}/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&after=${cursor}&limit=400`;
    const j=await getJson(url),rows=Array.isArray(j?.data)?j.data:[];calls++;
    if(!rows.length)break;
    let oldest=Infinity;
    for(const x of rows){
      const t=Number(x.fundingTime);if(Number.isFinite(t))oldest=Math.min(oldest,t);
      if(t>=FUNDING_START&&t<AUDIT_END){
        const rate=Number(x.realizedRate??x.fundingRate);
        if(Number.isFinite(rate))out.push({fundingTime:t,fundingRate:rate});
      }
    }
    if(!Number.isFinite(oldest)||oldest>=cursor)throw new Error('non-advancing funding cursor');
    cursor=oldest;await sleep(100);
  }
  out.sort((a,b)=>a.fundingTime-b.fundingTime);
  return {calls,rows:out.filter((x,i,a)=>!i||x.fundingTime!==a[i-1].fundingTime)};
}

function coverage(rows,start,end){
  const expected=Math.floor((end-start)/H4),actual=rows.filter(x=>x.t>=start&&x.t<end).length;
  return {expected4h:expected,actual4h:actual,complete:actual===expected};
}
function pf(values){
  const gp=values.filter(x=>x>0).reduce((a,b)=>a+b,0),gl=Math.abs(values.filter(x=>x<0).reduce((a,b)=>a+b,0));
  return gl?gp/gl:(gp>0?99:0);
}
function maxDrawdown(values){
  let eq=0,peak=0,dd=0;
  for(const v of values){eq+=v;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}
  return dd;
}
function latestOpen(rows,t){
  let lo=0,hi=rows.length-1,best=null;
  while(lo<=hi){const m=(lo+hi)>>1;if(rows[m].t<=t){best=rows[m];lo=m+1;}else hi=m-1;}
  return best;
}
function yearKey(ts){return new Date(ts).getUTCFullYear().toString();}
function activeFundingGapHours(funding,openedAt,closedAt){
  const xs=funding.filter(x=>x.fundingTime>openedAt&&x.fundingTime<=closedAt);
  if(!xs.length)return Infinity;
  let max=Math.max((xs[0].fundingTime-openedAt)/HOUR,(closedAt-xs.at(-1).fundingTime)/HOUR);
  for(let i=1;i<xs.length;i++)max=Math.max(max,(xs[i].fundingTime-xs[i-1].fundingTime)/HOUR);
  return max;
}

console.log('loading OKX BTC spot/swap/funding history');
const [spotRaw,swapRaw,fundRaw]=await Promise.all([
  historyCandles('BTC-USDT'),
  historyCandles('BTC-USDT-SWAP'),
  fundingHistory()
]);
const spot=spotRaw.rows,swap=swapRaw.rows,funding=fundRaw.rows;
const swapAt=new Map(swap.map(x=>[x.t,x]));
const timeline=spot.filter(x=>x.t>=AUDIT_START&&x.t<AUDIT_END&&swapAt.has(x.t)).map(x=>x.t);

// Enrich funding settlements with contemporaneous swap open/nearest prior swap open.
const enrichedFunding=funding.map(x=>{
  const px=swapAt.get(x.fundingTime)?.o??latestOpen(swap,x.fundingTime)?.o;
  return {...x,markPrice:Number(px)};
}).filter(x=>x.markPrice>0);

let state=newFundingCarryV2State(AUDIT_START,C),cooldownUntil=AUDIT_START;
let fundingPtr=0,lastAppliedPtr=0,cycles=[],entrySnapshots=[];
while(fundingPtr<enrichedFunding.length&&enrichedFunding[fundingPtr].fundingTime<=AUDIT_START)fundingPtr++;
lastAppliedPtr=fundingPtr;

for(const t of timeline){
  while(fundingPtr<enrichedFunding.length&&enrichedFunding[fundingPtr].fundingTime<=t)fundingPtr++;
  const spotBar=spot.find(x=>x.t===t),swapBar=swapAt.get(t);
  if(!spotBar||!swapBar)continue;
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
      cycles.push({...done,
        holdDays:round((closedAt-openedAt)/DAY,3),
        entryCoverage:eligibilityAtEntry?.grossCostCoverage??null,
        entryPositiveShare:eligibilityAtEntry?.positiveShare??null,
        entryBasisPct:done.entryBasisPct,
        activeFundingMaxGapHours:round(activeFundingGapHours(enrichedFunding,openedAt,closedAt),2)
      });
      cooldownUntil=t+COOLDOWN;
    }
  }

  if(state.lifecycle==='STOPPED_REVIEW'&&t>=cooldownUntil){
    state=newFundingCarryV2State(t,C);
    lastAppliedPtr=fundingPtr;
  }

  if(state.lifecycle==='WAITING_ENTRY'&&t>=cooldownUntil){
    const lookback=enrichedFunding.filter(x=>x.fundingTime>=t-30*DAY&&x.fundingTime<=t);
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
        cycles.push({...done,holdDays:round((closedAt-openedAt)/DAY,3),entryCoverage:eligibility.grossCostCoverage,entryPositiveShare:eligibility.positiveShare,entryBasisPct:done.entryBasisPct,activeFundingMaxGapHours:0});
        cooldownUntil=t+COOLDOWN;
      }
    }
  }
}

// The audit gate uses completed cycles only; any open tail is reported but not force-closed.
const net=cycles.map(x=>Number(x.realizedPnl??x.netPnl??0));
const positives=net.filter(x=>x>0),positiveSum=positives.reduce((a,b)=>a+b,0);
const totalNet=net.reduce((a,b)=>a+b,0),profitFactor=pf(net),winShare=cycles.length?positives.length/cycles.length:0,dd=maxDrawdown(net);
const carryBeforeBasis=cycles.reduce((a,x)=>a+Number(x.fundingIncome||0)-Number(x.totalEstimatedCosts||0),0);
const stressed=net.map(x=>x-EXTRA_STRESS_USD),stressNet=stressed.reduce((a,b)=>a+b,0),stressPf=pf(stressed);
const byYear={};
for(const c of cycles){const y=yearKey(Date.parse(c.closedAt));(byYear[y]||(byYear[y]=[])).push(Number(c.realizedPnl??c.netPnl??0));}
const yearStats=Object.fromEntries(Object.entries(byYear).map(([y,v])=>[y,{cycles:v.length,netPnl:round(v.reduce((a,b)=>a+b,0),2),profitFactor:round(pf(v),2)}]));
const yearsWithCycles=Object.values(yearStats).filter(x=>x.cycles>0),positiveYears=yearsWithCycles.filter(x=>x.netPnl>0).length;
const concentration=positiveSum>0?Math.max(0,...cycles.map(x=>{const v=Number(x.realizedPnl??x.netPnl??0);return v>0?v/positiveSum:0;})):1;
const spotCov=coverage(spot,AUDIT_START,AUDIT_END),swapCov=coverage(swap,AUDIT_START,AUDIT_END);
const cycleFundingComplete=cycles.every(x=>Number(x.activeFundingMaxGapHours)<=12);

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
  dataAdequacy:spotCov.complete&&swapCov.complete&&cycleFundingComplete
};

const summary={
  completedCycles:cycles.length,
  openTail:state.lifecycle==='ACTIVE_PAPER'&&state.basket?{openedAt:state.basket.openedAt,netPnl:state.basket.netPnl,fundingIncome:state.basket.fundingIncome,basisPnl:state.basket.basisPnl}:null,
  aggregateNetPnl:round(totalNet,2),
  profitFactor:round(profitFactor,2),
  profitableShare:round(winShare,4),
  positiveCycles:positives.length,
  maxClosedEquityDrawdown:round(dd,2),
  fundingMinusModeledCosts:round(carryBeforeBasis,2),
  stressedNetPnl:round(stressNet,2),
  stressedProfitFactor:round(stressPf,2),
  maxPositiveCycleConcentration:round(concentration,4),
  calendarYearsWithCycles:yearsWithCycles.length,
  positiveCalendarYears:positiveYears
};

const out={
  schemaVersion:'FUNDING-CARRY-V2-REPEATABILITY-AUDIT-1',
  generatedAt:new Date().toISOString(),
  researchOnly:true,executionImpact:false,
  productionRuleset:'8.40-PAPER-BTC-FUNDING-CARRY-V2-COST-AMORTIZED',
  predeclaredDesign:'research/funding-carry-v2-repeatability-design.md',
  source:'OKX_PUBLIC_BTC_USDT_SPOT_AND_SWAP_CONFIRMED_4H_PLUS_FUNDING_HISTORY',
  auditWindow:{start:new Date(AUDIT_START).toISOString(),end:new Date(AUDIT_END).toISOString(),fundingWarmupStart:new Date(FUNDING_START).toISOString()},
  productionConfig:C,
  summary,yearStats,gates,
  auditPass:Object.values(gates).every(Boolean),
  cycles:cycles.map(c=>({
    openedAt:c.openedAt,closedAt:c.closedAt,holdDays:c.holdDays,exitReason:c.exitReason,
    entryBasisPct:c.entryBasisPct,entryCoverage:c.entryCoverage,entryPositiveShare:c.entryPositiveShare,
    fundingIncome:round(c.fundingIncome,2),basisPnl:round(c.basisPnl,2),totalEstimatedCosts:round(c.totalEstimatedCosts,2),
    netPnl:round(Number(c.realizedPnl??c.netPnl),2),activeFundingMaxGapHours:c.activeFundingMaxGapHours
  })),
  data:{
    spot:{bars:spot.length,calls:spotRaw.calls,coverage:spotCov},
    swap:{bars:swap.length,calls:swapRaw.calls,coverage:swapCov},
    funding:{periods:enrichedFunding.length,calls:fundRaw.calls,first:enrichedFunding[0]?new Date(enrichedFunding[0].fundingTime).toISOString():null,last:enrichedFunding.at(-1)?new Date(enrichedFunding.at(-1).fundingTime).toISOString():null},
    matchedTimelineBars:timeline.length,
    eligibleEntriesObserved:entrySnapshots.length
  }
};
await fs.mkdir('artifacts',{recursive:true});
await fs.writeFile('artifacts/funding-carry-v2-repeatability-audit.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({summary:out.summary,yearStats:out.yearStats,gates:out.gates,auditPass:out.auditPass,cycles:out.cycles,data:out.data},null,2));

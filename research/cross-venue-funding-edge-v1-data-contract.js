import crypto from 'node:crypto';

export const CROSS_VENUE_FUNDING_EDGE_V1_SOURCE=Object.freeze({
  schema:'CROSS-VENUE-FUNDING-EDGE-V1-SOURCE-1',
  symbol:'BTCUSDT',
  start:'2022-03-01T00:00:00.000Z',
  end:'2026-09-30T23:59:59.999Z',
  markInterval:'1h',
  markIntervalMs:60*60*1000,
  nominalFundingIntervalMs:8*60*60*1000,
  timestampToleranceMs:1000,
  minCommonFundingDecisions:100,
  venues:Object.freeze({
    binance:Object.freeze({market:'USD-M-PERPETUAL',source:'BINANCE_VISION'}),
    okx:Object.freeze({market:'USDT-SWAP',source:'OKX_PUBLIC_HISTORY'})
  })
});

const strictNum=x=>(typeof x==='number'||(typeof x==='string'&&x.trim()!==''))?Number(x):NaN;
const finite=x=>Number.isFinite(strictNum(x));
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');

export function canonicalFundingTime(value,contract=CROSS_VENUE_FUNDING_EDGE_V1_SOURCE){
  const t=strictNum(value);
  if(!Number.isFinite(t))return null;
  const h=contract.markIntervalMs;
  const canonical=Math.round(t/h)*h;
  return Math.abs(t-canonical)<=contract.timestampToleranceMs?canonical:null;
}

export function normalizeFunding(rows=[],venue,contract=CROSS_VENUE_FUNDING_EDGE_V1_SOURCE){
  return (rows||[]).map(x=>{
    const rawTime=strictNum(x?.fundingTime??x?.fundingRateTimestamp??x?.time??x?.ts);
    const rate=strictNum(x?.fundingRate??x?.rate);
    return{venue,rawTime,time:canonicalFundingTime(rawTime,contract),rate};
  }).sort((a,b)=>a.rawTime-b.rawTime);
}

export function normalizeMarks(rows=[],venue){
  return (rows||[]).map(x=>{
    if(Array.isArray(x))return{venue,openTime:strictNum(x[0]),open:strictNum(x[1]),high:strictNum(x[2]),low:strictNum(x[3]),close:strictNum(x[4])};
    return{
      venue,
      openTime:strictNum(x?.openTime??x?.startTime??x?.time??x?.t??x?.ts),
      open:strictNum(x?.open??x?.openPrice??x?.o),
      high:strictNum(x?.high??x?.highPrice??x?.h),
      low:strictNum(x?.low??x?.lowPrice??x?.l),
      close:strictNum(x?.close??x?.closePrice??x?.c)
    };
  }).sort((a,b)=>a.openTime-b.openTime);
}

function duplicate(values=[]){return new Set(values).size!==values.length}
function exactCadence(rows,step){for(let i=1;i<rows.length;i++)if(rows[i].openTime-rows[i-1].openTime!==step)return{ok:false,after:rows[i-1].openTime,before:rows[i].openTime};return{ok:true}}
function fundingGap(rows,maxGap){for(let i=1;i<rows.length;i++)if(rows[i].rawTime-rows[i-1].rawTime>maxGap)return{ok:false,after:rows[i-1].rawTime,before:rows[i].rawTime,gapMs:rows[i].rawTime-rows[i-1].rawTime};return{ok:true}}

export function commonFundingTimes(binanceFunding=[],okxFunding=[]){
  const b=new Set(binanceFunding.map(x=>x.time).filter(Number.isFinite));
  return [...new Set(okxFunding.map(x=>x.time).filter(t=>Number.isFinite(t)&&b.has(t)))].sort((a,b)=>a-b);
}

export function splitCommonTimes(times=[]){
  const xs=[...new Set(times.map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
  if(xs.length<5)return{ok:false,reason:'INSUFFICIENT_COMMON_TIMES'};
  const a=Math.floor(xs.length*.6),b=Math.floor(xs.length*.8);
  return{
    ok:true,total:xs.length,
    discovery:{from:xs[0],to:xs[a-1],count:a},
    validation:{from:xs[a],to:xs[b-1],count:b-a},
    holdout:{from:xs[b],to:xs.at(-1),count:xs.length-b}
  };
}

function stableSourceProvenance(provenance={}){
  const cleanQueryReceipt=x=>({endpoint:x?.endpoint??null,params:x?.params??{},sha256:x?.sha256??null});
  const cleanArchiveReceipt=x=>({filename:x?.filename??null,url:x?.url??null,dateTs:x?.dateTs??null,sha256:x?.sha256??null});
  const sortJson=(a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b));
  return{
    binance:{
      provider:provenance?.binance?.provider??null,
      archive:provenance?.binance?.archive??null,
      receipts:[...(provenance?.binance?.receipts||[])].map(x=>({kind:x?.kind??null,scope:x?.scope??null,rel:x?.rel??null,sha256:x?.sha256??null})).sort((a,b)=>String(a.rel).localeCompare(String(b.rel)))
    },
    okx:{
      provider:provenance?.okx?.provider??null,
      baseUrl:provenance?.okx?.baseUrl??null,
      fundingQueryReceipts:[...(provenance?.okx?.fundingQueryReceipts||[])].map(cleanQueryReceipt).sort(sortJson),
      fundingArchiveReceipts:[...(provenance?.okx?.fundingArchiveReceipts||[])].map(cleanArchiveReceipt).sort((a,b)=>String(a.filename).localeCompare(String(b.filename))),
      markPageReceipts:[...(provenance?.okx?.markPageReceipts||[])].map(cleanQueryReceipt).sort(sortJson)
    },
    binanceChecksumsVerified:provenance?.binanceChecksumsVerified===true,
    okxFundingArchivesHashed:provenance?.okxFundingArchivesHashed===true,
    okxMarkPagesHashed:provenance?.okxMarkPagesHashed===true,
    strategyPnlCalculated:provenance?.strategyPnlCalculated===true
  };
}

export function sourceReceipt({binanceFunding=[],okxFunding=[],binanceMarks=[],okxMarks=[],provenance={}}={},contract=CROSS_VENUE_FUNDING_EDGE_V1_SOURCE){
  const bf=normalizeFunding(binanceFunding,'BINANCE',contract),of=normalizeFunding(okxFunding,'OKX',contract);
  const bm=normalizeMarks(binanceMarks,'BINANCE'),om=normalizeMarks(okxMarks,'OKX');
  const common=commonFundingTimes(bf,of),split=splitCommonTimes(common),stableProvenance=stableSourceProvenance(provenance);
  const symbols={
    binance:{funding:bf.length,marks:bm.length,firstFunding:bf[0]?.rawTime??null,lastFunding:bf.at(-1)?.rawTime??null,firstMark:bm[0]?.openTime??null,lastMark:bm.at(-1)?.openTime??null,digest:hash({funding:bf,marks:bm})},
    okx:{funding:of.length,marks:om.length,firstFunding:of[0]?.rawTime??null,lastFunding:of.at(-1)?.rawTime??null,firstMark:om[0]?.openTime??null,lastMark:om.at(-1)?.openTime??null,digest:hash({funding:of,marks:om})}
  };
  const core={schema:contract.schema,contract,provenance:stableProvenance,symbols,commonFundingDecisions:common.length,split};
  return{...core,digest:hash(core)};
}

export function validateCrossVenueSource({binanceFunding=[],okxFunding=[],binanceMarks=[],okxMarks=[],provenance={}}={},contract=CROSS_VENUE_FUNDING_EDGE_V1_SOURCE){
  const start=Date.parse(contract.start),end=Date.parse(contract.end),step=contract.markIntervalMs,maxFundingGap=contract.nominalFundingIntervalMs+contract.timestampToleranceMs;
  const rawSets=[
    ['BINANCE',binanceFunding,binanceMarks],
    ['OKX',okxFunding,okxMarks]
  ];
  const normalized={};
  for(const [venue,rawFunding,rawMarks] of rawSets){
    const funding=normalizeFunding(rawFunding,venue,contract),marks=normalizeMarks(rawMarks,venue);
    normalized[venue]={funding,marks};
    if(!funding.length)return{ok:false,reason:venue+'_MISSING_FUNDING'};
    if(!marks.length)return{ok:false,reason:venue+'_MISSING_MARKS'};
    if(funding.some(x=>!finite(x.rawTime)||!finite(x.rate)||!finite(x.time)))return{ok:false,reason:venue+'_INVALID_FUNDING'};
    if(marks.some(x=>![x.openTime,x.open,x.high,x.low,x.close].every(finite)||x.open<=0||x.high<Math.max(x.open,x.close,x.low)||x.low>Math.min(x.open,x.close,x.high)))return{ok:false,reason:venue+'_INVALID_MARK'};
    if(duplicate(funding.map(x=>x.rawTime))||duplicate(funding.map(x=>x.time)))return{ok:false,reason:venue+'_DUPLICATE_FUNDING'};
    if(duplicate(marks.map(x=>x.openTime)))return{ok:false,reason:venue+'_DUPLICATE_MARK'};
    if((rawFunding||[]).some((x,i)=>i>0&&Number(x?.fundingTime??x?.fundingRateTimestamp??x?.time??x?.ts)<Number(rawFunding[i-1]?.fundingTime??rawFunding[i-1]?.fundingRateTimestamp??rawFunding[i-1]?.time??rawFunding[i-1]?.ts)))return{ok:false,reason:venue+'_UNORDERED_FUNDING'};
    if((rawMarks||[]).some((x,i)=>i>0&&Number(x?.openTime??x?.startTime??x?.time??x?.t??x?.ts)<Number(rawMarks[i-1]?.openTime??rawMarks[i-1]?.startTime??rawMarks[i-1]?.time??rawMarks[i-1]?.t??rawMarks[i-1]?.ts)))return{ok:false,reason:venue+'_UNORDERED_MARK'};
    const cadence=exactCadence(marks,step);if(!cadence.ok)return{ok:false,reason:venue+'_MARK_CADENCE_GAP',...cadence};
    const fgap=fundingGap(funding,maxFundingGap);if(!fgap.ok)return{ok:false,reason:venue+'_FUNDING_CADENCE_GAP',...fgap};
    if(marks[0].openTime!==start)return{ok:false,reason:venue+'_MARK_START_MISMATCH',actual:marks[0].openTime,expected:start};
    if(marks.at(-1).openTime<end-step+1)return{ok:false,reason:venue+'_MARK_END_INCOMPLETE',actual:marks.at(-1).openTime};
    if(funding[0].rawTime>start+contract.nominalFundingIntervalMs)return{ok:false,reason:venue+'_FUNDING_START_INCOMPLETE',actual:funding[0].rawTime};
    if(funding.at(-1).rawTime<end-contract.nominalFundingIntervalMs)return{ok:false,reason:venue+'_FUNDING_END_INCOMPLETE',actual:funding.at(-1).rawTime};
    if(funding.some(x=>x.rawTime<start||x.rawTime>end))return{ok:false,reason:venue+'_FUNDING_OUT_OF_RANGE'};
    if(marks.some(x=>x.openTime<start||x.openTime>end))return{ok:false,reason:venue+'_MARK_OUT_OF_RANGE'};
  }
  const common=commonFundingTimes(normalized.BINANCE.funding,normalized.OKX.funding);
  if(common.length<contract.minCommonFundingDecisions)return{ok:false,reason:'COMMON_FUNDING_DECISIONS_LT_'+contract.minCommonFundingDecisions,count:common.length};
  const split=splitCommonTimes(common);if(!split.ok)return{ok:false,reason:split.reason};
  if(provenance?.binanceChecksumsVerified!==true)return{ok:false,reason:'BINANCE_CHECKSUMS_NOT_VERIFIED'};
  if(provenance?.okxFundingArchivesHashed!==true)return{ok:false,reason:'OKX_FUNDING_ARCHIVES_NOT_HASHED'};
  if(provenance?.okxMarkPagesHashed!==true)return{ok:false,reason:'OKX_MARK_PAGE_RECEIPTS_NOT_VERIFIED'};
  return{
    ok:true,
    commonFundingDecisions:common.length,
    commonStart:common[0],
    commonEnd:common.at(-1),
    split,
    receipt:sourceReceipt({binanceFunding,okxFunding,binanceMarks,okxMarks,provenance},contract)
  };
}

const HOUR=3600000;

export const ALPHA_LAB_R43_KEY='alpha_lab_r43';
export const ALPHA_LAB_R43_POLICY=Object.freeze({
  version:'R43-ALPHA-ATTRIBUTION-V1',sampleEveryMs:4*HOUR,
  horizons:Object.freeze({h4:4*HOUR,h12:12*HOUR,h24:24*HOUR,d3:72*HOUR,d7:168*HOUR}),
  maxObservations:12000,minimumLabels:100,minimumDistinctBuckets:25,minimumSymbols:3,
  maximumLabelDelayMs:2*HOUR,staleAfterMs:15*60*1000
});

// Missing telemetry must stay missing. Number(null) and Number('') are zero,
// which would otherwise invent neutral feature values and corrupt attribution.
const finite=v=>v==null||v===''||typeof v==='boolean'?null:Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=4)=>finite(v)==null?null:Math.round(Number(v)*10**d)/10**d;
const direction=side=>String(side).toUpperCase()==='SHORT'?-1:1;
const frame=(candidate,key)=>candidate?.frames?.[key]||{};
const signed=(value,side)=>finite(value)==null?null:finite(value)*direction(side);
const pct=(a,b)=>finite(a)!=null&&finite(b)>0?(finite(a)/finite(b)-1)*100:null;

export function newAlphaLabState(now=Date.now(),costs={}){
  return {schemaVersion:ALPHA_LAB_R43_POLICY.version,researchOnly:true,executionImpact:false,autoPromotion:false,
    policy:{...ALPHA_LAB_R43_POLICY,horizons:{...ALPHA_LAB_R43_POLICY.horizons},roundTripCostBps:Math.max(0,2*(finite(costs.feeBps)||0)+2*(finite(costs.slippageBps)||0))},
    observations:[],lastBuckets:{},createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()};
}

function features(candidate){
  const side=candidate?.side,m15=frame(candidate,'15m'),h1=frame(candidate,'1h'),h4=frame(candidate,'4h');
  return {technical:finite(candidate?.technical),candidate:finite(candidate?.candidate),distanceAtr:finite(candidate?.distanceAtr),
    emaSpread15m:signed(pct(m15.ema20,m15.ema50),side),emaSpread1h:signed(pct(h1.ema20,h1.ema50),side),emaSpread4h:signed(pct(h4.ema20,h4.ema50),side),
    macdAtr15m:signed(finite(m15.macdHist)!=null&&finite(m15.atr)>0?finite(m15.macdHist)/finite(m15.atr):null,side),
    macdAtr1h:signed(finite(h1.macdHist)!=null&&finite(h1.atr)>0?finite(h1.macdHist)/finite(h1.atr):null,side),
    rsi15m:signed(finite(m15.rsi)!=null?finite(m15.rsi)-50:null,side),rsi1h:signed(finite(h1.rsi)!=null?finite(h1.rsi)-50:null,side),
    adx1h:finite(h1.adx),adx4h:finite(h4.adx),volumeRatio15m:finite(m15.volumeRatio)};
}

function settle(observation,price,now,costBps,horizons){
  if(!(price>0))return observation;
  const next={...observation,outcomes:{...(observation.outcomes||{})}};
  for(const [key,ms] of Object.entries(horizons)){
    if(next.outcomes[key]||now-observation.observedAt<ms)continue;
    const delayMs=now-observation.observedAt-ms;
    const maximumDelayMs=finite(observation.maximumLabelDelayMs)??ALPHA_LAB_R43_POLICY.maximumLabelDelayMs;
    if(delayMs>maximumDelayMs){
      next.outcomes[key]={valid:false,reason:'LABEL_WINDOW_MISSED',dueAt:observation.observedAt+ms,asOf:now,delayMs};
      continue;
    }
    const raw=direction(observation.side)*(price/observation.price-1)*10000;
    next.outcomes[key]={valid:true,dueAt:observation.observedAt+ms,asOf:now,delayMs,price:round(price,8),rawBps:round(raw,3),netBps:round(raw-costBps,3)};
  }
  return next;
}

export function observeAlphaScan(input,candidates=[],now=Date.now(),costs={}){
  const state=input?.schemaVersion===ALPHA_LAB_R43_POLICY.version?structuredClone(input):newAlphaLabState(now,costs);
  const horizons=state.policy?.horizons||ALPHA_LAB_R43_POLICY.horizons;
  const costBps=finite(state.policy?.roundTripCostBps)??Math.max(0,2*(finite(costs.feeBps)||0)+2*(finite(costs.slippageBps)||0));
  const prices=new Map((candidates||[]).map(c=>[String(c?.symbol||'').toUpperCase(),finite(c?.price)]).filter(([symbol,price])=>symbol&&price>0));
  state.lastAttemptAt=new Date(now).toISOString();
  state.observations=(state.observations||[]).map(o=>settle(o,prices.get(o.symbol),now,costBps,horizons));
  const bucket=Math.floor(now/ALPHA_LAB_R43_POLICY.sampleEveryMs);
  for(const c of candidates||[]){
    const symbol=String(c?.symbol||'').toUpperCase(),price=finite(c?.price);
    if(!symbol||!(price>0)||state.lastBuckets?.[symbol]===bucket)continue;
    state.lastBuckets[symbol]=bucket;
    state.observations.push({id:`${symbol}:${bucket}`,symbol,side:String(c?.side||'LONG').toUpperCase(),observedAt:now,price:round(price,8),status:String(c?.status||'UNKNOWN'),
      source:state.mode==='HISTORICAL_REPLAY'?'HISTORICAL_REPLAY':'FORWARD_SCANNER_SNAPSHOT',maximumLabelDelayMs:finite(state.policy?.maximumLabelDelayMs)??ALPHA_LAB_R43_POLICY.maximumLabelDelayMs,features:features(c),outcomes:{}});
  }
  if(state.observations.length>ALPHA_LAB_R43_POLICY.maxObservations)state.observations=state.observations.slice(-ALPHA_LAB_R43_POLICY.maxObservations);
  if(prices.size)state.updatedAt=new Date(now).toISOString();return state;
}

function ranks(values){
  const sorted=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),out=Array(values.length);let i=0;
  while(i<sorted.length){let j=i+1;while(j<sorted.length&&sorted[j].v===sorted[i].v)j++;const rank=(i+j-1)/2+1;for(let k=i;k<j;k++)out[sorted[k].i]=rank;i=j;}
  return out;
}
function correlation(a,b){
  if(a.length<3||a.length!==b.length)return null;
  const ar=ranks(a),br=ranks(b),am=ar.reduce((s,x)=>s+x,0)/ar.length,bm=br.reduce((s,x)=>s+x,0)/br.length;
  let cov=0,av=0,bv=0;for(let i=0;i<ar.length;i++){const x=ar[i]-am,y=br[i]-bm;cov+=x*y;av+=x*x;bv+=y*y;}
  return av>0&&bv>0?cov/Math.sqrt(av*bv):null;
}
function featureStats(rows,name,horizon){
  const pairs=rows.map(o=>({x:finite(o.features?.[name]),y:finite(o.outcomes?.[horizon]?.netBps)})).filter(p=>p.x!=null&&p.y!=null).sort((a,b)=>a.x-b.x);
  if(!pairs.length)return {feature:name,samples:0,spearman:null,quartileNetBps:[],topMinusBottomBps:null,monotonic:false};
  const buckets=[[],[],[],[]];pairs.forEach((p,i)=>buckets[Math.min(3,Math.floor(i*4/pairs.length))].push(p.y));
  const means=buckets.map(xs=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null);
  const valid=means.every(x=>x!=null),inc=valid&&means.every((x,i)=>i===0||x>=means[i-1]),dec=valid&&means.every((x,i)=>i===0||x<=means[i-1]);
  return {feature:name,samples:pairs.length,spearman:round(correlation(pairs.map(p=>p.x),pairs.map(p=>p.y)),3),quartileNetBps:means.map(x=>round(x,2)),topMinusBottomBps:valid?round(means[3]-means[0],2):null,monotonic:inc||dec};
}

function alphaTimer(rows,labels,ready,candidates,state,now){
  const sampleMs=finite(state?.policy?.sampleEveryMs)||ALPHA_LAB_R43_POLICY.sampleEveryMs;
  const horizonMs=finite(state?.policy?.horizons?.h24)||ALPHA_LAB_R43_POLICY.horizons.h24;
  const target=finite(state?.policy?.minimumLabels)||ALPHA_LAB_R43_POLICY.minimumLabels;
  const currentBucket=Math.floor(now/sampleMs),buckets=state?.lastBuckets||{};
  const latestBucket=Math.max(-1,...Object.values(buckets).map(finite).filter(x=>x!=null));
  const updatedMs=Date.parse(state?.updatedAt||''),staleAfterMs=finite(state?.policy?.staleAfterMs)||ALPHA_LAB_R43_POLICY.staleAfterMs;
  const dataStatus=!rows.length?'EMPTY':Number.isFinite(updatedMs)&&now-updatedMs<=staleAfterMs?'LIVE':'STALE';
  const nextSampleAt=dataStatus==='LIVE'?(latestBucket>=currentBucket?(currentBucket+1)*sampleMs:now):null;
  const pending=rows.filter(o=>!o.outcomes?.h24).map(o=>Number(o.observedAt)+horizonMs).filter(Number.isFinite).sort((a,b)=>a-b);
  const nextLabelAt=dataStatus==='LIVE'&&pending.length?Math.max(now,pending[0]):null;
  const remaining=Math.max(0,target-(labels.h24?.samples||0));
  let evaluationAt=ready?now:null;
  if(!ready&&dataStatus==='LIVE'){
    const perBucket=Math.max(0,new Set(rows.filter(o=>Math.floor(Number(o.observedAt)/sampleMs)===latestBucket).map(o=>o.symbol)).size,Object.keys(buckets).length);
    const due=[...pending];let captureAt=nextSampleAt;
    while(perBucket&&due.length<remaining){for(let i=0;i<perBucket&&due.length<remaining;i++)due.push(captureAt+horizonMs);captureAt+=sampleMs;}
    if(due.length>=remaining)evaluationAt=Math.max(now,due.sort((a,b)=>a-b)[remaining-1]);
  }
  return {dataStatus,lastUpdateAt:state?.updatedAt||null,nextSampleAt:nextSampleAt==null?null:new Date(nextSampleAt).toISOString(),nextLabelAt:nextLabelAt==null?null:new Date(nextLabelAt).toISOString(),evaluationAt:evaluationAt==null?null:new Date(evaluationAt).toISOString(),
    evaluationReached:ready,factorSignalReached:ready&&candidates.length>0,factorHypothesisFound:ready&&candidates.length>0,labelsRemaining:remaining,labelTarget:target};
}

export function alphaAttributionSummary(state={},now=Date.now()){
  const rows=Array.isArray(state?.observations)?state.observations:[],horizons=state?.policy?.horizons||ALPHA_LAB_R43_POLICY.horizons;
  const featureNames=[...new Set(rows.flatMap(o=>Object.keys(o.features||{})))].sort();
  const labels=Object.fromEntries(Object.keys(horizons).map(h=>{const xs=rows.map(o=>finite(o.outcomes?.[h]?.netBps)).filter(x=>x!=null);return [h,{samples:xs.length,meanNetBps:xs.length?round(xs.reduce((s,x)=>s+x,0)/xs.length,2):null,positiveRate:xs.length?round(xs.filter(x=>x>0).length/xs.length*100,1):null}];}));
  const byHorizon=Object.fromEntries(['h12','h24','d3'].map(h=>[h,featureNames.map(f=>featureStats(rows,f,h))]));
  const primary=byHorizon.h24||[],labeled=rows.filter(o=>finite(o.outcomes?.h24?.netBps)!=null);
  const distinctBuckets=new Set(labeled.map(o=>Math.floor(Number(o.observedAt)/(finite(state?.policy?.sampleEveryMs)||ALPHA_LAB_R43_POLICY.sampleEveryMs)))).size;
  const distinctSymbols=new Set(labeled.map(o=>o.symbol)).size;
  const ready=(labels.h24?.samples||0)>=ALPHA_LAB_R43_POLICY.minimumLabels&&distinctBuckets>=ALPHA_LAB_R43_POLICY.minimumDistinctBuckets&&distinctSymbols>=ALPHA_LAB_R43_POLICY.minimumSymbols;
  const candidates=ready?primary.filter(f=>f.samples>=ALPHA_LAB_R43_POLICY.minimumLabels&&f.monotonic&&Math.abs(f.spearman||0)>=.15&&Math.abs(f.topMinusBottomBps||0)>=10).map(f=>f.feature):[];
  return {schemaVersion:ALPHA_LAB_R43_POLICY.version,researchOnly:true,executionImpact:false,autoPromotion:false,
    state:ready?(candidates.length?'RESEARCH_HYPOTHESES_ONLY':'NO_STABLE_FACTOR_OBSERVED'):'BUILDING_FORWARD_LABELS',coverage:{observations:rows.length,labels,distinctBuckets,distinctSymbols},
    legacyScore:{verdict:'REJECTED',reason:'NEGATIVE_AND_NON_MONOTONIC_30_60_90D'},primaryHorizon:'h24',candidateFactors:candidates,
    topFactors:primary.slice().filter(x=>x.samples>0).sort((a,b)=>Math.abs(b.spearman||0)-Math.abs(a.spearman||0)).slice(0,5),
    timer:alphaTimer(rows,labels,ready,candidates,state,now),
    methodology:{sampleEveryHours:4,minimumLabels:ALPHA_LAB_R43_POLICY.minimumLabels,minimumDistinctBuckets:ALPHA_LAB_R43_POLICY.minimumDistinctBuckets,minimumSymbols:ALPHA_LAB_R43_POLICY.minimumSymbols,
      maximumLabelDelayMinutes:ALPHA_LAB_R43_POLICY.maximumLabelDelayMs/60000,roundTripCostBps:finite(state?.policy?.roundTripCostBps)??null,
      sampleScope:'SAMPLED_SCANNER_OUTPUTS',directionSelection:'LEGACY_SCANNER_SIDE',overlapWarning:true,descriptiveOnly:true,fundingExcluded:true},
    nextAction:ready?'REVIEW_STABLE_FACTORS_ACROSS_12H_24H_3D':'COLLECT_FORWARD_OUTCOMES',updatedAt:state?.updatedAt||null};
}

// Historical replay is intentionally a separate state. Callers must rebuild each
// scanner snapshot from information available at that timestamp and closed candles.
export function replayHistoricalAlphaScans(scans=[],costs={},asOf=Date.now()){
  let state=newAlphaLabState(0,costs);state.mode='HISTORICAL_REPLAY';
  let previous=-Infinity;
  for(const scan of scans){
    const at=finite(scan?.at);
    if(at==null||at<previous||at>asOf)throw Error('Historical scans must be chronological and not from the future');
    if(scan?.closedCandles!==true)throw Error('Historical replay requires closed-candle snapshots');
    state=observeAlphaScan(state,scan.candidates||[],at,costs);state.mode='HISTORICAL_REPLAY';previous=at;
  }
  return {state,summary:{...alphaAttributionSummary(state,asOf),mode:'HISTORICAL_REPLAY',independentFromForward:true}};
}

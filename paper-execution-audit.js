const DEFAULTS=Object.freeze({materialOverrunR:1.25,closureClusterSeconds:90,reentryHours:6,bundleMinutes:30});

const n=value=>Number(value);
const valid=value=>Number.isFinite(n(value));
const iso=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const round=(value,digits=3)=>Number.isFinite(value)?Math.round(value*10**digits)/10**digits:null;

function tradeFacts(trade){
  const entry=n(trade.entry),stop=n(trade.sl),exit=n(trade.exit),qty=n(trade.qty),realized=n(trade.realized);
  const plannedRisk=valid(entry)&&valid(stop)&&valid(qty)?Math.abs(entry-stop)*Math.abs(qty):null;
  const actualLoss=valid(realized)&&realized<0?Math.abs(realized):0;
  const actualLossR=plannedRisk>0&&actualLoss>0?actualLoss/plannedRisk:null;
  let stopSlipBps=null;
  if(trade.exitReason==='SL'&&valid(stop)&&stop>0&&valid(exit)){
    stopSlipBps=String(trade.side).toUpperCase()==='LONG'
      ?Math.max(0,(stop-exit)/stop*10000)
      :Math.max(0,(exit-stop)/stop*10000);
  }
  return {...trade,openedAt:iso(trade.openedAt),closedAt:iso(trade.closedAt),plannedRisk:round(plannedRisk),actualLossR:round(actualLossR),stopSlipBps:round(stopSlipBps,1)};
}

function timeClusters(rows,key,windowMs,minSize=2){
  const sorted=rows.filter(x=>x[key]).toSorted((a,b)=>Date.parse(a[key])-Date.parse(b[key]));
  const groups=[]; let group=[];
  for(const row of sorted){
    if(!group.length||Date.parse(row[key])-Date.parse(group.at(-1)[key])<=windowMs)group.push(row);
    else{if(group.length>=minSize)groups.push(group);group=[row];}
  }
  if(group.length>=minSize)groups.push(group);
  return groups.map(g=>({at:g[0][key],count:g.length,symbols:[...new Set(g.map(x=>x.symbol))],sides:[...new Set(g.map(x=>x.side))]}));
}

function reentries(rows,hours){
  const sorted=rows.filter(x=>x.openedAt&&x.closedAt).toSorted((a,b)=>Date.parse(a.openedAt)-Date.parse(b.openedAt));
  const found=[];
  for(let i=1;i<sorted.length;i++)for(let j=i-1;j>=0;j--){
    const prev=sorted[j],cur=sorted[i];
    if(prev.symbol!==cur.symbol||prev.side!==cur.side)continue;
    const delta=Date.parse(cur.openedAt)-Date.parse(prev.closedAt);
    if(delta>=0&&delta<=hours*3600000)found.push({symbol:cur.symbol,side:cur.side,previousClosedAt:prev.closedAt,reopenedAt:cur.openedAt,minutes:round(delta/60000,1)});
    break;
  }
  return found;
}

function auditBot(name,raw,policy){
  const trades=(raw?.recentClosed||[]).map(tradeFacts);
  const stops=trades.filter(x=>x.exitReason==='SL'&&x.actualLossR!=null);
  const material=stops.filter(x=>x.actualLossR>policy.materialOverrunR);
  const expected=Number(raw?.closedCount||0);
  return {
    name,expectedClosed:expected,observedClosed:trades.length,coveragePct:expected?round(trades.length/expected*100,1):100,
    sampleComplete:trades.length>=expected,lastClosedAt:trades.map(x=>x.closedAt).filter(Boolean).toSorted().at(-1)||null,
    stopAudit:{observed:stops.length,averageActualLossR:round(stops.reduce((s,x)=>s+x.actualLossR,0)/(stops.length||1)),maxActualLossR:stops.length?Math.max(...stops.map(x=>x.actualLossR)):null,materialOverruns:material.length,maxStopSlipBps:stops.length?Math.max(...stops.map(x=>x.stopSlipBps||0)):null},
    closureClusters:timeClusters(trades,'closedAt',policy.closureClusterSeconds*1000),
    openingBundles:timeClusters(trades,'openedAt',policy.bundleMinutes*60000).filter(x=>x.symbols.length>1&&x.sides.length===1),
    sameDirectionReentries:reentries(trades,policy.reentryHours)
  };
}

function auditAssistantSnapshot(snapshot,overrides={}){
  const policy={...DEFAULTS,...overrides};
  const sources=[['BASELINE',snapshot.paper],['SHADOW_V1',snapshot.shadowV1],['CHALLENGER_V2',snapshot.challengerV2],['REGIME_V1',snapshot.regimeV1]];
  const bots=sources.map(([name,raw])=>auditBot(name,raw,policy));
  return {
    schemaVersion:'1.0',researchOnly:true,executionImpact:false,sourceGeneratedAt:iso(snapshot.generatedAt),policy,
    engine:{state:snapshot.engine?.state||null,running:!!snapshot.engine?.running,marketFresh:!!snapshot.engine?.marketFresh,errors:Number(snapshot.engine?.errors||0),lastCycleAt:iso(snapshot.engine?.lastCycleAt),lastSignalScanAt:iso(snapshot.engine?.lastSignalScanAt)},
    safety:snapshot.safety||null,bots,
    limitations:['Public assistant status exposes only recentClosed windows, not every persisted trade.','Diagnostics describe execution behavior; they are not entry filters or promotion evidence.','Stop-loss R includes realized fees and sampled-price slippage; it is not an exchange fill reconstruction.']
  };
}

export {DEFAULTS,auditAssistantSnapshot,tradeFacts};

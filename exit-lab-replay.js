// MERIDIAN v7.49 — Exit Lab historical cohort replay
// Uses fixed historical entries and replays only exit policy differences on 15m candles.
import { compareExitModels, aggregateExitLab, EXIT_LAB_VERSION } from './exit-lab.js';

const DAY=86400000;
const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const openedMs=t=>Number.isFinite(Number(t.openedAt))?Number(t.openedAt):Date.parse(t.openedAt||'');
const regimeLabel=t=>t.regimeType||t.challengerRegime||t.regime||'UNKNOWN';

function replayCandlesForTrade(trade,market,end,horizonDays){
  const symbol=String(trade.symbol||'').toUpperCase(),rows=market?.[symbol]?.['15m']||[];
  const opened=openedMs(trade);if(!Number.isFinite(opened))return[];
  const limit=Math.min(Number(end)||Infinity,opened+Math.max(1,Number(horizonDays||14))*DAY);
  return rows.filter(c=>Number(c.closeTime)>opened&&Number(c.closeTime)<=limit).map(c=>({
    ts:Number(c.closeTime),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)
  }));
}

function groupReplay(rows,keyFn){
  const buckets={};
  for(const row of rows){const key=String(keyFn(row)||'UNKNOWN');(buckets[key]||(buckets[key]=[])).push(row.comparison);}
  return Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,aggregateExitLab(v)]));
}

export function replayExitCohort(trades,market,{end=Date.now(),horizonDays=14,feeBps=5,slippageBps=3,includeRows=false}={}){
  const source=(trades||[]).filter(t=>t&&t.symbol&&t.side&&Number(t.entry)>0&&Number(t.sl)>0&&Number(t.tp1)>0);
  const rows=[];let noCandles=0;
  for(const trade of source){
    const candles=replayCandlesForTrade(trade,market,end,horizonDays);if(!candles.length){noCandles++;continue;}
    const normalized={...trade,regimeType:regimeLabel(trade)};
    const comparison=compareExitModels(normalized,candles,{feeBps,slippageBps});
    rows.push({symbol:String(trade.symbol).toUpperCase(),side:String(trade.side).toUpperCase(),openedAt:trade.openedAt,regime:regimeLabel(trade),candles:candles.length,comparison});
  }
  const aggregate=aggregateExitLab(rows.map(x=>x.comparison));
  return{
    version:EXIT_LAB_VERSION,method:'FIXED_ENTRY_15M_EXIT_COHORT_REPLAY',researchOnly:true,executionImpact:false,
    horizonDays,sourceTrades:source.length,replayedTrades:rows.length,noCandles,
    aggregate,bySide:groupReplay(rows,x=>x.side),bySymbol:groupReplay(rows,x=>x.symbol),byRegime:groupReplay(rows,x=>x.regime),
    rows:includeRows?rows:rows.slice(-20)
  };
}

export function replayExitLabForLedgers({ledgers={},market={},end=Date.now(),opts={}}={}){
  const result={};
  for(const [name,ledger] of Object.entries(ledgers)){
    const trades=Array.isArray(ledger)?ledger:(ledger?.tradeList||ledger?.trades||[]);
    result[name]=replayExitCohort(trades,market,{end,...opts});
  }
  const ranked={};
  for(const [name,x] of Object.entries(result)){
    ranked[name]=Object.entries(x.aggregate.models).sort((a,b)=>Number(b[1].totalR||0)-Number(a[1].totalR||0)).map(([model,m],i)=>({rank:i+1,model,totalR:round(m.totalR),avgR:round(m.avgR),deltaVsCurrent:round(m.deltaTotalRvsCurrent)}));
  }
  return{version:EXIT_LAB_VERSION,method:'SAME_HISTORICAL_ENTRIES_PARALLEL_EXIT_POLICIES',researchOnly:true,executionImpact:false,ledgers:result,ranked};
}

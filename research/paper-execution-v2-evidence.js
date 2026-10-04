import {digest} from '../paper-execution-audit-v2-export.js';
import {replayClosedTrade,summarizeReplay} from './paper-execution-v2-replay.js';

const required=['id','symbol','side','entry','qty','sl','openedAt','closedAt'];
export function ledgerEvidenceStatus(exported){
  const ledgers=Array.isArray(exported?.ledgers)?exported.ledgers:[];
  const rows=ledgers.flatMap(l=>(l.trades||[]).map(t=>({...t,ledger:l.name})));
  const incomplete=rows.map(t=>({id:t.id,ledger:t.ledger,missing:required.filter(k=>t[k]==null||t[k]==='')})).filter(x=>x.missing.length);
  return{schemaVersion:exported?.schemaVersion||null,digest:exported?.digest||null,ledgers:ledgers.map(l=>({name:l.name,available:l.available,closedCount:l.closedCount,digest:l.digest})),closedTrades:rows.length,incompleteCount:incomplete.length,incomplete,ready:ledgers.length>0&&ledgers.every(l=>l.available)&&rows.length>0&&incomplete.length===0};
}
export function immutableMarketReceipt(marketBySymbol,{source='UNKNOWN',cutoff=null}={}){
  const symbols={};
  for(const [symbol,rows] of Object.entries(marketBySymbol||{})){
    const clean=(rows||[]).map(r=>({openTime:r.openTime??r.time,open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close)}));
    symbols[symbol]={rows:clean.length,digest:digest(clean),first:clean[0]?.openTime??null,last:clean.at(-1)?.openTime??null};
  }
  const receipt={source,cutoff,symbols};return{...receipt,digest:digest(receipt)};
}
export function runPaperExecutionV2Evidence(exported,marketBySymbol,options={}){
  const status=ledgerEvidenceStatus(exported);
  if(!status.ready)return{decision:'PAPER_EXECUTION_V2_INCONCLUSIVE',reason:'LEDGER_EVIDENCE_INCOMPLETE',ledger:status,market:immutableMarketReceipt(marketBySymbol,options.market||{}),executionImpact:false};
  const rows=[];
  for(const l of exported.ledgers)for(const t of l.trades||[])rows.push({ledger:l.name,tradeId:t.id,symbol:t.symbol,...replayClosedTrade(t,marketBySymbol?.[t.symbol]||[],options.costs)});
  const summary=summarizeReplay(rows),market=immutableMarketReceipt(marketBySymbol,options.market||{});
  const unexplained=rows.filter(x=>x.eligible&&(!Number.isFinite(x.netR)||!Number.isFinite(x.replayExit))).length;
  const decision=unexplained?'PAPER_EXECUTION_V2_FAIL':summary.coveragePct<95?'PAPER_EXECUTION_V2_INCONCLUSIVE':(summary.p90NetStopR!=null&&summary.p90NetStopR>1.25?'PAPER_EXECUTION_V2_FAIL':'PASS');
  return{decision,ledger:status,market,summary,unexplainedAccounting:unexplained,rows,executionImpact:false,autoPromotion:false};
}

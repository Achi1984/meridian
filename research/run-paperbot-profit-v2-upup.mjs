import fs from 'node:fs';
import path from 'node:path';
import {PAPERBOT_PROFIT_AGENT_V2_RULESET,runUpUpRiskManagedMomentumProxyV1} from './paperbot-profit-special-agent-v2.js';

const ASSETS=['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI'];
const WANT=1880,OUT=path.resolve('research/results');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function json(url){
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'MERIDIAN-research-only'}});
  if(!r.ok)throw new Error('HTTP '+r.status+' '+url);
  return r.json();
}
async function page(symbol,limit,endTime){
  const q=new URLSearchParams({symbol:symbol+'USDT',interval:'1d',limit:String(limit),endTime:String(Math.floor(endTime))});
  let last;
  for(const base of ['https://api.binance.com/api/v3/klines','https://data-api.binance.vision/api/v3/klines']){
    try{const x=await json(base+'?'+q);if(Array.isArray(x))return x}catch(e){last=e}
  }
  throw last||new Error('NO_SOURCE');
}
async function history(symbol){
  const out=[];let end=Date.now(),guard=0;
  while(out.length<WANT&&guard++<12){
    const raw=await page(symbol,Math.min(1000,WANT-out.length),end);
    if(!raw.length)break;
    const rows=raw.map(x=>({openTime:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],closeTime:+x[6]}))
      .filter(x=>[x.openTime,x.open,x.high,x.low,x.close,x.closeTime].every(Number.isFinite));
    if(!rows.length)break;
    out.unshift(...rows);end=rows[0].openTime-1;
    if(out.length<WANT)await sleep(150);
  }
  return [...new Map(out.map(x=>[x.openTime,x])).values()].filter(x=>x.closeTime<Date.now()-1000).sort((a,b)=>a.openTime-b.openTime).slice(-WANT);
}
const data={},sources={};
for(const symbol of ASSETS){
  process.stdout.write('load '+symbol+' ... ');
  const rows=await history(symbol);
  if(rows.length<500)throw new Error(symbol+' source gate <500 bars: '+rows.length);
  data[symbol]=rows;sources[symbol]={bars:rows.length,first:new Date(rows[0].openTime).toISOString(),last:new Date(rows.at(-1).openTime).toISOString()};
  console.log(rows.length);await sleep(180);
}
const r=runUpUpRiskManagedMomentumProxyV1(data),s=r.summary||{},g=r.gate||{};
const summary={
  generatedAt:new Date().toISOString(),
  ruleset:PAPERBOT_PROFIT_AGENT_V2_RULESET,
  strategy:r.strategy,
  sources,
  periods:s.periods,
  totalReturnPct:s.totalReturnPct,
  pnl:s.pnl,
  profitFactor:s.profitFactor,
  maxDrawdownPct:s.maxDrawdownPct,
  positiveWindows:r.stability?.positiveWindows??0,
  positiveAssets:g.positiveAssets??null,
  positivePnlConcentrationPct:r.positivePnlConcentrationPct,
  gatePass:!!g.pass,
  gateReasons:g.reasons||[],
  diagnostics:r.diagnostics,
  benchmarks:r.benchmarks,
  exactReplication:r.exactReplication,
  limitation:r.limitation,
  decision:g.pass?'V2_DISCOVERY_PASS_ONLY':'V2_DISCOVERY_FAIL',
  nextStage:g.pass?'INDEPENDENT_HOLDOUT':'KEEP_RESEARCH_ONLY',
  researchOnly:true,executionImpact:false,autoPromotion:false
};
fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'paperbot-profit-v2-upup-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(OUT,'paperbot-profit-v2-upup-full.json'),JSON.stringify({summary,result:r},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));

import fs from 'node:fs';
import path from 'node:path';
import {runUpRegimeDonchianV2,PAPERBOT_PROFIT_AGENT_V2_RULESET} from './paperbot-profit-special-agent-v2.js';

const TRADE_ASSETS=Object.freeze(['BNB','DOGE','ADA','DOT','LTC','BCH','TRX','XLM']);
const LOAD_ASSETS=Object.freeze(['BTC',...TRADE_ASSETS]);
const DAYS=1460,WARMUP=420,BARS=DAYS+WARMUP,OUT_DIR=path.resolve('research/results');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function getJson(url){
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'MERIDIAN-research-only'}});
  if(!r.ok)throw new Error('HTTP '+r.status+' '+url);
  return r.json();
}
async function page(symbol,limit,endTime){
  const qs=new URLSearchParams({symbol:symbol+'USDT',interval:'1d',limit:String(limit),endTime:String(Math.floor(endTime))});
  let last;
  for(const base of ['https://api.binance.com/api/v3/klines','https://data-api.binance.vision/api/v3/klines']){
    try{
      const rows=await getJson(base+'?'+qs.toString());
      if(Array.isArray(rows))return rows;
      last=new Error('INVALID '+base);
    }catch(e){last=e}
  }
  throw last||new Error('NO_SOURCE');
}
async function history(symbol,want=BARS){
  const out=[];let end=Date.now(),guard=0;
  while(out.length<want&&guard++<12){
    const limit=Math.min(1000,want-out.length),raw=await page(symbol,limit,end);
    if(!raw.length)break;
    const rows=raw.map(x=>({openTime:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],closeTime:+x[6]}))
      .filter(x=>[x.openTime,x.open,x.high,x.low,x.close,x.closeTime].every(Number.isFinite));
    if(!rows.length)break;
    out.unshift(...rows);end=rows[0].openTime-1;
    if(out.length<want)await sleep(150);
  }
  const now=Date.now();
  return [...new Map(out.map(x=>[x.openTime,x])).values()]
    .filter(x=>x.closeTime<now-1000)
    .sort((a,b)=>a.openTime-b.openTime)
    .slice(-want);
}
const data={},sources={};
for(const symbol of LOAD_ASSETS){
  process.stdout.write('load '+symbol+' ... ');
  const rows=await history(symbol);
  if(rows.length<500)throw new Error(symbol+' source gate <500 bars: '+rows.length);
  data[symbol]=rows;
  sources[symbol]={bars:rows.length,role:symbol==='BTC'?'REGIME_FILTER_ONLY':'TRADED_HOLDOUT',first:new Date(rows[0].openTime).toISOString(),last:new Date(rows.at(-1).openTime).toISOString()};
  console.log(rows.length);
  await sleep(200);
}
const result=runUpRegimeDonchianV2(data,{tradeAssets:[...TRADE_ASSETS]});
const g=result.gate||{},s=result.summary||{};
const summary={
  generatedAt:new Date().toISOString(),
  ruleset:PAPERBOT_PROFIT_AGENT_V2_RULESET,
  strategy:'UP_REGIME_DONCHIAN_V2',
  holdoutType:'NON_OVERLAPPING_TRADE_UNIVERSE_SHARED_BTC_REGIME_FILTER',
  tradeAssets:[...TRADE_ASSETS],
  btcRole:'REGIME_FILTER_ONLY_NOT_TRADED',
  sources,
  periods:s.periods||0,
  totalReturnPct:s.totalReturnPct??null,
  pnl:s.pnl??null,
  profitFactor:s.profitFactor??null,
  maxDrawdownPct:s.maxDrawdownPct??null,
  positiveWindows:result.stability?.positiveWindows??0,
  positiveAssets:g.positiveAssets??null,
  positivePnlConcentrationPct:result.positivePnlConcentrationPct??null,
  gatePass:!!g.pass,
  gateReasons:g.reasons||[],
  decision:g.pass?'HOLDOUT_PASS_PAPER_SHADOW_ONLY':'HOLDOUT_FAIL_RESEARCH_REDESIGN',
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false
};
fs.mkdirSync(OUT_DIR,{recursive:true});
fs.writeFileSync(path.join(OUT_DIR,'paperbot-profit-v2-transfer-holdout-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(OUT_DIR,'paperbot-profit-v2-transfer-holdout-full.json'),JSON.stringify({summary,result},null,2)+'\n');
const md=`# Paper Bot Profit V2 — Transfer Holdout

Generated: ${summary.generatedAt}

Trade universe: ${summary.tradeAssets.join(', ')}

BTC role: regime filter only; not traded.

| Periods | Net return | PF | Max DD | Positive windows | Positive assets | PnL concentration | Gate |
|---:|---:|---:|---:|---:|---:|---:|---|
| ${summary.periods} | ${Number(summary.totalReturnPct??0).toFixed(2)}% | ${Number(summary.profitFactor??0).toFixed(3)} | ${Number(summary.maxDrawdownPct??0).toFixed(2)}% | ${summary.positiveWindows}/5 | ${summary.positiveAssets??'—'} | ${Number(summary.positivePnlConcentrationPct??0).toFixed(1)}% | ${summary.gatePass?'PASS':'FAIL'} |

**Decision:** ${summary.decision}

Research only. No live execution impact and no auto-promotion.
`;
fs.writeFileSync(path.join(OUT_DIR,'paperbot-profit-v2-transfer-holdout.md'),md);
console.log(JSON.stringify(summary,null,2));

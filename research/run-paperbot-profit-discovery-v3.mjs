import fs from 'node:fs';
import path from 'node:path';
import {
  PAPERBOT_PROFIT_AGENT_V3_ASSETS,
  PAPERBOT_PROFIT_AGENT_V3_RULESET,
  runAdaptiveUpTrend6hV3
} from './paperbot-profit-special-agent-v3.js';

const DAYS=1460;
const BARS=DAYS*4+1000;
const OUT_DIR=path.resolve('research/results');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function getJson(url){
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'MERIDIAN-research-only'}});
  if(!r.ok)throw new Error('HTTP '+r.status+' '+url);
  return r.json();
}
async function page(symbol,limit,endTime){
  const qs=new URLSearchParams({symbol:symbol+'USDT',interval:'6h',limit:String(limit),endTime:String(Math.floor(endTime))});
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
    if(out.length<want)await sleep(120);
  }
  const now=Date.now();
  return [...new Map(out.map(x=>[x.openTime,x])).values()]
    .filter(x=>x.closeTime<now-1000)
    .sort((a,b)=>a.openTime-b.openTime)
    .slice(-want);
}

const data={},sources={};
for(const symbol of PAPERBOT_PROFIT_AGENT_V3_ASSETS){
  process.stdout.write('load '+symbol+' ... ');
  const rows=await history(symbol);
  if(rows.length<1500)throw new Error(symbol+' source gate <1500 6h bars: '+rows.length);
  data[symbol]=rows;
  sources[symbol]={bars:rows.length,first:new Date(rows[0].openTime).toISOString(),last:new Date(rows.at(-1).openTime).toISOString()};
  console.log(rows.length);
  await sleep(180);
}
const result=runAdaptiveUpTrend6hV3(data);
const g=result.gate||{},s=result.summary||{};
const summary={
  generatedAt:new Date().toISOString(),
  ruleset:PAPERBOT_PROFIT_AGENT_V3_RULESET,
  strategy:'ADAPTIVE_UP_TREND_6H_V3',
  requestedDays:DAYS,
  requestedBars:BARS,
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
  decision:g.pass?'DISCOVERY_PASS_HOLDOUT_REQUIRED':'DISCOVERY_FAIL_RESEARCH_REDESIGN',
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false
};
fs.mkdirSync(OUT_DIR,{recursive:true});
fs.writeFileSync(path.join(OUT_DIR,'paperbot-profit-discovery-v3-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(OUT_DIR,'paperbot-profit-discovery-v3-full.json'),JSON.stringify({summary,result},null,2)+'\n');
const md=`# Paper Bot Profit Discovery V3

Generated: ${summary.generatedAt}

Ruleset: \`${summary.ruleset}\`

| Periods | Net return | PF | Max DD | Positive windows | Positive assets | PnL concentration | Gate |
|---:|---:|---:|---:|---:|---:|---:|---|
| ${summary.periods} | ${Number(summary.totalReturnPct??0).toFixed(2)}% | ${Number(summary.profitFactor??0).toFixed(3)} | ${Number(summary.maxDrawdownPct??0).toFixed(2)}% | ${summary.positiveWindows}/5 | ${summary.positiveAssets??'—'} | ${Number(summary.positivePnlConcentrationPct??0).toFixed(1)}% | ${summary.gatePass?'PASS':'FAIL'} |

**Decision:** ${summary.decision}

Research only. No auto-promotion and no live execution impact.
`;
fs.writeFileSync(path.join(OUT_DIR,'paperbot-profit-discovery-v3.md'),md);
console.log(JSON.stringify(summary,null,2));

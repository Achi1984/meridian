import fs from 'node:fs';
import path from 'node:path';
import {
  PAPERBOT_PROFIT_AGENT_V2_ASSETS,
  PAPERBOT_PROFIT_AGENT_V2_RULESET,
  runPaperBotProfitAgentV2
} from './paperbot-profit-special-agent-v2.js';

const DAYS=1460;
const WARMUP=420;
const BARS=DAYS+WARMUP;
const OUT_DIR=path.resolve('research/results');
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
    const rows=raw.map(x=>({
      openTime:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],closeTime:+x[6]
    })).filter(x=>[x.openTime,x.open,x.high,x.low,x.close,x.closeTime].every(Number.isFinite));
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
function conciseCandidate(r){
  const g=r?.gate||{},s=r?.summary||{};
  return{
    strategy:r?.strategy||null,
    periods:s.periods||0,
    totalReturnPct:s.totalReturnPct??null,
    pnl:s.pnl??null,
    profitFactor:s.profitFactor??null,
    maxDrawdownPct:s.maxDrawdownPct??null,
    positiveWindows:r?.stability?.positiveWindows??0,
    positiveAssets:g.positiveAssets??null,
    positivePnlConcentrationPct:r?.positivePnlConcentrationPct??null,
    gatePass:!!g.pass,
    gateReasons:g.reasons||[]
  };
}
const data={},sources={};
for(const symbol of PAPERBOT_PROFIT_AGENT_V2_ASSETS){
  process.stdout.write('load '+symbol+' ... ');
  const rows=await history(symbol);
  if(rows.length<500)throw new Error(symbol+' source gate <500 bars: '+rows.length);
  data[symbol]=rows;
  sources[symbol]={
    bars:rows.length,
    first:new Date(rows[0].openTime).toISOString(),
    last:new Date(rows.at(-1).openTime).toISOString()
  };
  console.log(rows.length);
  await sleep(200);
}
const result=runPaperBotProfitAgentV2(data);
const summary={
  generatedAt:new Date().toISOString(),
  ruleset:PAPERBOT_PROFIT_AGENT_V2_RULESET,
  requestedDays:DAYS,
  requestedBars:BARS,
  sources,
  discoveryLeader:result.discoveryLeader,
  discoveryLeaderReturnPct:result.discoveryLeaderReturnPct,
  passedCandidates:result.passedCandidates,
  decision:result.decision,
  nextStage:result.nextStage,
  candidates:Object.fromEntries(Object.entries(result.candidates).map(([k,v])=>[k,conciseCandidate(v)])),
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false
};
fs.mkdirSync(OUT_DIR,{recursive:true});
fs.writeFileSync(path.join(OUT_DIR,'paperbot-profit-discovery-v2-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(OUT_DIR,'paperbot-profit-discovery-v2-full.json'),JSON.stringify({summary,result},null,2)+'\n');
const rows=Object.entries(summary.candidates).map(([k,v])=>`| ${k} | ${v.periods} | ${Number(v.totalReturnPct??0).toFixed(2)}% | ${Number(v.profitFactor??0).toFixed(2)} | ${Number(v.maxDrawdownPct??0).toFixed(2)}% | ${v.positiveWindows}/5 | ${v.positiveAssets??'—'} | ${Number(v.positivePnlConcentrationPct??0).toFixed(1)}% | ${v.gatePass?'PASS':'FAIL'} |`).join('\n');
const md=`# Paper Bot Profit Discovery V2

Generated: ${summary.generatedAt}

Ruleset: \`${summary.ruleset}\`

| Candidate | Periods | Net return | PF | Max DD | Windows | Positive assets | Positive PnL concentration | Gate |
|---|---:|---:|---:|---:|---:|---:|---:|---|
${rows}

**Discovery leader:** ${summary.discoveryLeader||'none'}

**Decision:** ${summary.decision}

**Next stage:** ${summary.nextStage}

This is discovery evidence only. No auto-promotion and no live execution impact.
`;
fs.writeFileSync(path.join(OUT_DIR,'paperbot-profit-discovery-v2.md'),md);
console.log(JSON.stringify({leader:summary.discoveryLeader,decision:summary.decision,candidates:summary.candidates},null,2));

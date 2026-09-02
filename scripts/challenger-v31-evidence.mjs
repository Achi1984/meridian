import fs from 'node:fs';
import { runCloudBacktest } from '../cloud-backtest.js';

const ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const WINDOWS=[30,60,90],END=Date.now();
const rnd=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const key=t=>`${t.symbol}|${t.openedAt}`;
const pct=(a,b)=>b?rnd(a/b*100,1):0;

function summarize(name,L){
  const tr=L?.tradeList||[],nonReady=tr.filter(t=>String(t.baselineStatusAtEntry||'')!=='READY'),wait=tr.filter(t=>t.baselineStatusAtEntry==='WAIT_ENTRY_ZONE'),noSetup=tr.filter(t=>t.baselineStatusAtEntry==='NO_SETUP');
  const avgRisk=tr.length?tr.reduce((a,t)=>a+Number(t.riskPct||0),0)/tr.length:0;
  return{name,trades:L?.trades||0,pnl:rnd(L?.pnl,2),pf:rnd(L?.pf),expectancy:rnd(L?.expectancy,2),winRate:rnd(L?.winRate,1),maxDD:rnd(L?.maxDD,2),longP:rnd(L?.longP,2),shortP:rnd(L?.shortP,2),avgRiskPct:rnd(avgRisk,3),nonReadyTrades:nonReady.length,nonReadyPct:pct(nonReady.length,tr.length),waitTrades:wait.length,noSetupTrades:noSetup.length};
}
function overlap(a,b){const A=new Set((a?.tradeList||[]).map(key)),B=new Set((b?.tradeList||[]).map(key)),shared=[...A].filter(k=>B.has(k)).length;return{shared,aCoverageOfB:pct(shared,B.size),bCoverageOfA:pct(shared,A.size)}}

const runs=[];
for(const days of WINDOWS){
  console.log('V3.1 evidence',days+'d');
  const r=await runCloudBacktest({assets:ASSETS,days,end:END});
  const b=r.ledgers.baseline,v2=r.ledgers.challenger,v3=r.ledgers.challengerV3,v31=r.ledgers.challengerV31;
  runs.push({days,baseline:summarize('BASELINE',b),challengerV2:summarize('CHALLENGER_V2',v2),challengerV3:summarize('CHALLENGER_V3',v3),challengerV31:summarize('CHALLENGER_V3_1',v31),overlapV31V2:overlap(v31,v2),overlapV31V3:overlap(v31,v3),walkForward:(r.researchContinuous?.variants||[]).find(x=>x.name==='CHALLENGER V3.1')||null});
}
const out={schemaVersion:'7.53-CHALLENGER-V3.1-EVIDENCE-V1',generatedAt:new Date().toISOString(),assets:ASSETS,windows:WINDOWS,runs};
fs.mkdirSync('research',{recursive:true});fs.writeFileSync('research/challenger-v31-evidence-v753.json',JSON.stringify(out,null,2));
let md=`# MERIDIAN v7.53 — Challenger V3.1 Evidence\n\nGenerated: ${out.generatedAt}\n\nAssets: ${ASSETS.join(', ')}\n\nExit: A_CURRENT / full TP1 for clean entry/scoring comparison.\n\n`;
for(const x of runs){md+=`## ${x.days} days\n\n| Model | Trades | P&L | PF | Expectancy | WR | Max DD | Avg Risk | LONG P&L | SHORT P&L | Non-READY |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;for(const m of [x.baseline,x.challengerV2,x.challengerV3,x.challengerV31])md+=`| ${m.name} | ${m.trades} | ${m.pnl} | ${m.pf} | ${m.expectancy} | ${m.winRate}% | ${m.maxDD}% | ${m.avgRiskPct}% | ${m.longP} | ${m.shortP} | ${m.nonReadyTrades} (${m.nonReadyPct}%) |\n`;md+=`\nV3.1 WAIT: **${x.challengerV31.waitTrades}** · NO_SETUP: **${x.challengerV31.noSetupTrades}** · overlap with V2: **${x.overlapV31V2.shared}** · overlap with V3: **${x.overlapV31V3.shared}**.\n\nWalk-forward V3.1 stability: **${x.walkForward?.stability??'n/a'}**, positive windows: **${x.walkForward?.positive??'n/a'}/5**, adequate: **${x.walkForward?.adequate??'n/a'}/5**, severe: **${x.walkForward?.severe??'n/a'}/5**.\n\n`}
fs.writeFileSync('research/challenger-v31-evidence-v753.md',md);console.log('wrote Challenger V3.1 evidence');

import fs from 'node:fs';
import { runCloudBacktest } from '../cloud-backtest.js';

const ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const WINDOWS=[30,60,90],END=Date.now();
const rnd=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const key=t=>`${t.symbol}|${t.openedAt}`;
const pct=(a,b)=>b?rnd(a/b*100,1):0;

function summarize(name,L){
  const tr=L?.tradeList||[],nonReady=tr.filter(t=>String(t.baselineStatusAtEntry||'')!=='READY'),wait=tr.filter(t=>t.baselineStatusAtEntry==='WAIT_ENTRY_ZONE'),noSetup=tr.filter(t=>t.baselineStatusAtEntry==='NO_SETUP');
  return{name,trades:L?.trades||0,pnl:rnd(L?.pnl,2),pf:rnd(L?.pf),expectancy:rnd(L?.expectancy,2),winRate:rnd(L?.winRate,1),maxDD:rnd(L?.maxDD,2),longP:rnd(L?.longP,2),shortP:rnd(L?.shortP,2),nonReadyTrades:nonReady.length,nonReadyPct:pct(nonReady.length,tr.length),waitTrades:wait.length,noSetupTrades:noSetup.length};
}
function compare(result){
  const b=result.ledgers.baseline,v2=result.ledgers.challenger,v3=result.ledgers.challengerV3;
  const bset=new Set((b.tradeList||[]).map(key)),v2set=new Set((v2.tradeList||[]).map(key)),v3set=new Set((v3.tradeList||[]).map(key));
  const uniqueVsV2=[...v3set].filter(k=>!v2set.has(k)).length,uniqueVsBase=[...v3set].filter(k=>!bset.has(k)).length,overlapV2=[...v3set].filter(k=>v2set.has(k)).length;
  return{baseline:summarize('BASELINE',b),challengerV2:summarize('CHALLENGER_V2',v2),challengerV3:summarize('CHALLENGER_V3',v3),coverage:{uniqueVsV2,uniqueVsBase,overlapV2,v3CoverageOfV2:pct(overlapV2,v2set.size)}};
}

const runs=[];
for(const days of WINDOWS){console.log('V3 evidence',days+'d');const r=await runCloudBacktest({assets:ASSETS,days,end:END});runs.push({days,...compare(r),walkForward:(r.researchContinuous?.variants||[]).find(x=>x.name==='CHALLENGER V3')||null})}
const out={schemaVersion:'7.52-CHALLENGER-V3-EVIDENCE-V1',generatedAt:new Date().toISOString(),assets:ASSETS,windows:WINDOWS,runs};
fs.mkdirSync('research',{recursive:true});fs.writeFileSync('research/challenger-v3-evidence-v752.json',JSON.stringify(out,null,2));
let md=`# MERIDIAN v7.52 — Challenger V3 Evidence\n\nGenerated: ${out.generatedAt}\n\nAssets: ${ASSETS.join(', ')}\n\nExit: A_CURRENT / full TP1 for V2 and V3 comparison.\n\n`;
for(const x of runs){md+=`## ${x.days} days\n\n| Model | Trades | P&L | PF | Expectancy | WR | Max DD | LONG P&L | SHORT P&L | Non-READY trades |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;for(const m of [x.baseline,x.challengerV2,x.challengerV3])md+=`| ${m.name} | ${m.trades} | ${m.pnl} | ${m.pf} | ${m.expectancy} | ${m.winRate}% | ${m.maxDD}% | ${m.longP} | ${m.shortP} | ${m.nonReadyTrades} (${m.nonReadyPct}%) |\n`;md+=`\nV3 unique entries vs V2: **${x.coverage.uniqueVsV2}** · vs Baseline: **${x.coverage.uniqueVsBase}** · V3/V2 overlap: **${x.coverage.overlapV2}** · V3 coverage of V2: **${x.coverage.v3CoverageOfV2}%**. V3 WAIT entries: **${x.challengerV3.waitTrades}**, NO_SETUP entries: **${x.challengerV3.noSetupTrades}**.\n\nWalk-forward V3 stability: **${x.walkForward?.stability??'n/a'}**, positive windows: **${x.walkForward?.positive??'n/a'}/5**, adequate windows: **${x.walkForward?.adequate??'n/a'}/5**, severe windows: **${x.walkForward?.severe??'n/a'}/5**.\n\n`}
fs.writeFileSync('research/challenger-v3-evidence-v752.md',md);console.log('wrote Challenger V3 evidence');

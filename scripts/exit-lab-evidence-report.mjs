import fs from 'node:fs';
import { runCloudBacktest } from '../cloud-backtest.js';

const ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const WINDOWS=[30,60,90];
const END=Date.now();
const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const safe=o=>o&&typeof o==='object'?o:{};

function modelRows(replay){
  const rows=[];
  for(const [bot,ledger] of Object.entries(safe(replay?.ledgers))){
    for(const [model,m] of Object.entries(safe(ledger?.aggregate?.models))){
      rows.push({bot,model,trades:m.trades,totalR:round(m.totalR),avgR:round(m.avgR),medianR:round(m.medianR),winRateR:round(m.winRateR,1),givebackR:round(m.totalGivebackR),tp1ThenBeRate:round(m.tp1ThenBeRate,1),tp2Rate:round(m.tp2Rate,1),deltaVsCurrent:round(m.deltaTotalRvsCurrent)});
    }
  }
  return rows;
}
function mdTable(rows){
  const h='| Bot | Modell | Trades | Total R | Avg R | Median R | R-WR | Giveback R | TP1→BE | TP2 | ΔR vs A |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|';
  return h+'\n'+rows.map(r=>`| ${r.bot} | ${r.model} | ${r.trades??0} | ${r.totalR??0} | ${r.avgR??0} | ${r.medianR??0} | ${r.winRateR??0}% | ${r.givebackR??0} | ${r.tp1ThenBeRate??0}% | ${r.tp2Rate??0}% | ${r.deltaVsCurrent??0} |`).join('\n');
}
function rankRobust(all){
  const map=new Map();
  for(const run of all){for(const r of run.rows){const k=`${r.bot}|${r.model}`,x=map.get(k)||{bot:r.bot,model:r.model,windows:0,positiveDeltaWindows:0,sumDelta:0,sumAvgR:0,sumTotalR:0};x.windows++;x.sumDelta+=Number(r.deltaVsCurrent||0);x.sumAvgR+=Number(r.avgR||0);x.sumTotalR+=Number(r.totalR||0);if(Number(r.deltaVsCurrent||0)>0)x.positiveDeltaWindows++;map.set(k,x)}}
  return [...map.values()].map(x=>({...x,avgDeltaR:round(x.sumDelta/x.windows),meanAvgR:round(x.sumAvgR/x.windows),meanTotalR:round(x.sumTotalR/x.windows)})).sort((a,b)=>b.positiveDeltaWindows-a.positiveDeltaWindows||b.avgDeltaR-a.avgDeltaR);
}

const runs=[];
for(const days of WINDOWS){
  console.log(`Running ${days}d Exit Lab evidence report on ${ASSETS.length} assets...`);
  const result=await runCloudBacktest({assets:ASSETS,days,end:END,onProgress:p=>{if(p.pct%10===0)console.log(days,p.stage,p.pct)}});
  runs.push({days,summary:result.summary,rows:modelRows(result.exitLabReplay),ranked:result.exitLabReplay?.ranked,exitLabReplay:result.exitLabReplay});
}
const robustness=rankRobust(runs);
const out={schemaVersion:'7.51-EXIT-LAB-EVIDENCE-V1',generatedAt:new Date().toISOString(),end:END,assets:ASSETS,windows:WINDOWS,runs,robustness};
fs.mkdirSync('research',{recursive:true});
fs.writeFileSync('research/exit-lab-evidence-v751.json',JSON.stringify(out,null,2));
let md=`# MERIDIAN v7.51 — Exit Lab Evidence Report\n\nGenerated: ${out.generatedAt}\n\nAssets: ${ASSETS.join(', ')}\n\nWindows: ${WINDOWS.join('d, ')}d\n\nMethod: same historical entries, parallel exit policies on subsequent 15m candles. Research-only.\n\n`;
for(const run of runs){md+=`## ${run.days}-day window\n\n${mdTable(run.rows)}\n\n`;}
md+='## Cross-window robustness\n\n| Bot | Modell | Positive Δ windows | Avg ΔR vs A | Mean Avg R | Mean Total R |\n|---|---|---:|---:|---:|---:|\n'+robustness.map(x=>`| ${x.bot} | ${x.model} | ${x.positiveDeltaWindows}/${x.windows} | ${x.avgDeltaR} | ${x.meanAvgR} | ${x.meanTotalR} |`).join('\n')+'\n';
fs.writeFileSync('research/exit-lab-evidence-v751.md',md);
console.log('Wrote research/exit-lab-evidence-v751.{json,md}');

import fs from 'node:fs';
import { runCloudBacktest } from '../cloud-backtest.js';

const ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const WINDOWS=[30,60,90],END=Date.now();
const rnd=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function group(rows,keyFn){
  const m=new Map();
  for(const t of rows){const k=keyFn(t);if(!m.has(k))m.set(k,[]);m.get(k).push(t)}
  return [...m.entries()].map(([key,x])=>stat(key,x)).sort((a,b)=>b.trades-a.trades);
}
function stat(key,x){
  const pnl=x.reduce((a,t)=>a+Number(t.realized||0),0),wins=x.filter(t=>Number(t.realized)>0),losses=x.filter(t=>Number(t.realized)<0),gp=wins.reduce((a,t)=>a+Number(t.realized||0),0),gl=Math.abs(losses.reduce((a,t)=>a+Number(t.realized||0),0));
  return{key,trades:x.length,pnl:rnd(pnl,2),expectancy:rnd(x.length?pnl/x.length:0,2),winRate:rnd(x.length?wins.length/x.length*100:0,1),pf:rnd(gl?gp/gl:(gp?99:0)),avgRiskPct:rnd(x.length?x.reduce((a,t)=>a+Number(t.riskPct||0),0)/x.length:0,3),riskWeightedEdge:rnd(x.reduce((a,t)=>a+Number(t.riskPct||0),0)?pnl/x.reduce((a,t)=>a+Number(t.riskPct||0),0):0,2)};
}
function distanceBucket(t){const d=Number(t.distanceAtr);if(!Number.isFinite(d))return'UNKNOWN';if(d<=.25)return'<=0.25';if(d<=.50)return'0.25-0.50';if(d<=.75)return'0.50-0.75';if(d<=1.0)return'0.75-1.00';if(d<=1.5)return'1.00-1.50';return'>1.50'}
function confidenceBucket(t){const c=Number(t.confidence);if(c>=85)return'>=85';if(c>=80)return'80-84';if(c>=75)return'75-79';if(c>=70)return'70-74';return'<70'}
function regime(t){return String(t.regime||t.regimeType||'UNKNOWN').toUpperCase()}
function status(t){return String(t.baselineStatusAtEntry||'UNKNOWN').toUpperCase()}

const runs=[];
for(const days of WINDOWS){
  console.log('V3.1 attribution',days+'d');
  const r=await runCloudBacktest({assets:ASSETS,days,end:END});
  const tr=r.ledgers.challengerV31?.tradeList||[];
  runs.push({days,total:stat('ALL',tr),byStatus:group(tr,status),bySide:group(tr,t=>t.side),byRegime:group(tr,regime),bySideRegime:group(tr,t=>`${t.side}|${regime(t)}`),byDistance:group(tr,distanceBucket),byConfidence:group(tr,confidenceBucket),byStatusDistance:group(tr,t=>`${status(t)}|${distanceBucket(t)}`),byAsset:group(tr,t=>t.symbol)});
}
const out={schemaVersion:'7.54-V31-ATTRIBUTION-V1',generatedAt:new Date().toISOString(),assets:ASSETS,windows:WINDOWS,runs};
fs.mkdirSync('research',{recursive:true});fs.writeFileSync('research/challenger-v31-attribution-v754.json',JSON.stringify(out,null,2));
function table(title,rows){let s=`### ${title}\n\n| Bucket | Trades | P&L | Expectancy | WR | PF | Avg Risk | P&L / RiskPt |\n|---|---:|---:|---:|---:|---:|---:|---:|\n`;for(const x of rows)s+=`| ${x.key} | ${x.trades} | ${x.pnl} | ${x.expectancy} | ${x.winRate}% | ${x.pf} | ${x.avgRiskPct}% | ${x.riskWeightedEdge} |\n`;return s+'\n'}
let md=`# MERIDIAN v7.54 — Challenger V3.1 Attribution\n\nGenerated: ${out.generatedAt}\n\nPurpose: explain V3.1 performance before changing weights again. Research-only.\n\n`;
for(const r of runs){md+=`## ${r.days} days\n\n${table('Side × Regime',r.bySideRegime)}${table('Baseline status',r.byStatus)}${table('Entry distance ATR',r.byDistance)}${table('Confidence',r.byConfidence)}${table('Status × Distance',r.byStatusDistance)}${table('Assets',r.byAsset)}`}
fs.writeFileSync('research/challenger-v31-attribution-v754.md',md);console.log('wrote V3.1 attribution');

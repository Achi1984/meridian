import fs from 'node:fs';
import { __test, CLOUD_BT_CONFIG } from '../cloud-backtest.js';
import { challengerV31Decision } from '../challenger-v31.js';

const {fetchKlines,prepareEvents}=__test;
const ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const WINDOWS=[30,60,90],END=Date.now(),DAY=86400000,FOUR_H=14400000;
const rnd=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function lowerBound(rows,t){let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>1;if(Number(rows[m].closeTime)<=t)lo=m+1;else hi=m}return lo}
function outcomeR(sig,openedAt,rows,end,cfg=CLOUD_BT_CONFIG){
  const entry=Number(sig.entry),sl=Number(sig.sl),tp1=Number(sig.tp1),side=String(sig.side).toUpperCase(),risk=Math.abs(entry-sl);if(!(entry>0&&sl>0&&tp1>0&&risk>0))return null;
  const feeSlipR=((cfg.feeBps*2+cfg.slippageBps*2)/10000)*entry/risk;
  const start=lowerBound(rows,openedAt),limit=Math.min(end,openedAt+14*DAY);let last=entry;
  for(let i=start;i<rows.length&&Number(rows[i].closeTime)<=limit;i++){
    const c=rows[i],stop=side==='LONG'?Number(c.low)<=sl:Number(c.high)>=sl,target=side==='LONG'?Number(c.high)>=tp1:Number(c.low)<=tp1;last=Number(c.close||last);
    if(stop)return rnd(-1-feeSlipR,4); // conservative same-candle order
    if(target)return rnd(((tp1-entry)*(side==='LONG'?1:-1)/risk)-feeSlipR,4);
  }
  return rnd(((last-entry)*(side==='LONG'?1:-1)/risk)-feeSlipR,4);
}
function stat(key,x){const rs=x.map(z=>z.realizedR).filter(Number.isFinite),n=rs.length,sum=rs.reduce((a,b)=>a+b,0),wins=rs.filter(v=>v>0),loss=rs.filter(v=>v<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(loss.reduce((a,b)=>a+b,0));return{key,samples:n,totalR:rnd(sum),avgR:rnd(n?sum/n:0),winRate:rnd(n?wins.length/n*100:0,1),pf:rnd(gl?gp/gl:(gp?99:0))}}
function group(rows,keyFn){const m=new Map();for(const r of rows){const k=String(keyFn(r));if(!m.has(k))m.set(k,[]);m.get(k).push(r)}return[...m.entries()].map(([k,v])=>stat(k,v)).sort((a,b)=>b.samples-a.samples)}
function confBucket(x){const c=Number(x.confidence);if(c>=90)return'>=90';if(c>=85)return'85-89';if(c>=80)return'80-84';if(c>=75)return'75-79';if(c>=70)return'70-74';if(c>=65)return'65-69';if(c>=60)return'60-64';return'<60'}
function distBucket(x){const d=Number(x.distanceAtr);if(d<=.25)return'<=0.25';if(d<=.5)return'0.25-0.50';if(d<=.75)return'0.50-0.75';if(d<=1)return'0.75-1.00';if(d<=1.5)return'1.00-1.50';return'>1.50'}
function table(title,rows){let s=`### ${title}\n\n| Bucket | Samples | Total R | Avg R | WR | PF |\n|---|---:|---:|---:|---:|---:|\n`;for(const x of rows)s+=`| ${x.key} | ${x.samples} | ${x.totalR} | ${x.avgR} | ${x.winRate}% | ${x.pf} |\n`;return s+'\n'}

const runs=[];
for(const days of WINDOWS){
  console.log('Signal calibration',days+'d');const start=END-days*DAY,warm=start-60*FOUR_H,market={};
  for(const symbol of ASSETS){const[m15,h1,h4]=await Promise.all([fetchKlines(symbol,'15m',warm,END),fetchKlines(symbol,'1h',warm,END),fetchKlines(symbol,'4h',warm,END)]);market[symbol]={'15m':m15,'1h':h1,'4h':h4}}
  const events=prepareEvents(market,start,END,CLOUD_BT_CONFIG),lastSample=new Map(),rows=[];
  for(const ev of events){for(const sig of Object.values(ev.signals||{})){const prev=lastSample.get(sig.symbol)||0;if(ev.t-prev<FOUR_H)continue;lastSample.set(sig.symbol,ev.t);const d=challengerV31Decision(sig,{fullRiskPct:1,cautionRiskPct:.3});const realizedR=outcomeR(sig,ev.t,market[sig.symbol]['15m'],END);if(realizedR==null)continue;rows.push({symbol:sig.symbol,side:sig.side,regime:sig.regime,status:sig.status,distanceAtr:rnd(sig.distanceAtr,3),technical:sig.technical,candidate:sig.candidate,confidence:d.confidence,decision:d.decision,realizedR})}}
  runs.push({days,total:stat('ALL',rows),byConfidence:group(rows,confBucket),byDecision:group(rows,x=>x.decision),byStatus:group(rows,x=>x.status),byDistance:group(rows,distBucket),bySideRegime:group(rows,x=>`${x.side}|${x.regime}`),byConfidenceSideRegime:group(rows,x=>`${confBucket(x)}|${x.side}|${x.regime}`)});
}
const out={schemaVersion:'7.55-SIGNAL-CALIBRATION-V1',generatedAt:new Date().toISOString(),sampling:'one candidate per symbol per 4h',outcome:'A_CURRENT normalized R, stop-first same candle, 14d horizon',assets:ASSETS,windows:WINDOWS,runs};
fs.mkdirSync('research',{recursive:true});fs.writeFileSync('research/signal-calibration-v755.json',JSON.stringify(out,null,2));
let md=`# MERIDIAN v7.55 — Signal Calibration Lab\n\nGenerated: ${out.generatedAt}\n\nSampling: ${out.sampling}. Outcome: ${out.outcome}. Portfolio gates intentionally excluded.\n\n`;
for(const r of runs)md+=`## ${r.days} days\n\n${table('Confidence',r.byConfidence)}${table('Decision',r.byDecision)}${table('Baseline status',r.byStatus)}${table('Entry distance',r.byDistance)}${table('Side × Regime',r.bySideRegime)}`;
fs.writeFileSync('research/signal-calibration-v755.md',md);console.log('wrote Signal Calibration Lab');

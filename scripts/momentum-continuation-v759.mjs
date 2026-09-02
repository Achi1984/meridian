import fs from 'node:fs';
import { __test, CLOUD_BT_CONFIG } from '../cloud-backtest.js';

const {fetchKlines,prepareEvents}=__test;
const ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const WINDOWS=[30,60,90],END=Date.now(),DAY=86400000,FOUR_H=14400000;
const rnd=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function lowerBound(rows,t){let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>1;if(+rows[m].closeTime<=t)lo=m+1;else hi=m}return lo}
function ema(v,p){if(!v.length)return[];const k=2/(p+1),o=[v[0]];for(let i=1;i<v.length;i++)o.push(v[i]*k+o[i-1]*(1-k));return o}
function rsiSeries(vals,p=14){const out=Array(vals.length).fill(null);if(vals.length<p+1)return out;let g=0,l=0;for(let i=1;i<=p;i++){const d=vals[i]-vals[i-1];g+=Math.max(d,0);l+=Math.max(-d,0)}g/=p;l/=p;out[p]=l===0?100:100-100/(1+g/l);for(let i=p+1;i<vals.length;i++){const d=vals[i]-vals[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p;out[i]=l===0?100:100-100/(1+g/l)}return out}
function timeline(rows){const c=rows.map(x=>+x.close),r=rsiSeries(c),e=ema(c,20);return rows.map((x,i)=>({t:+x.closeTime,close:+x.close,high:+x.high,rsi:r[i],ema20:e[i]}))}
function idxAt(tl,t){let lo=0,hi=tl.length;while(lo<hi){const m=(lo+hi)>>1;if(tl[m].t<=t)lo=m+1;else hi=m}return Math.max(0,lo-1)}
function streak(tl,i,thr){let n=0;for(let j=i;j>=0&&Number(tl[j].rsi)>thr;j--)n++;return n}
function highDist(tl,i,n=20){const a=tl.slice(Math.max(0,i-n+1),i+1),hi=Math.max(...a.map(x=>x.high)),px=tl[i]?.close;return hi>0?100*(hi-px)/hi:null}
function emaDist(tl,i){const x=tl[i];return x?.ema20>0?100*(x.close-x.ema20)/x.ema20:null}
function outcomeR(sig,t,rows,end,cfg=CLOUD_BT_CONFIG){const entry=+sig.entry,sl=+sig.sl,tp1=+sig.tp1,side=sig.side,R=Math.abs(entry-sl);if(!(entry>0&&sl>0&&tp1>0&&R>0))return null;const cost=((cfg.feeBps*2+cfg.slippageBps*2)/10000)*entry/R,start=lowerBound(rows,t),limit=Math.min(end,t+14*DAY);let last=entry;for(let i=start;i<rows.length&&+rows[i].closeTime<=limit;i++){const c=rows[i],stop=side==='LONG'?+c.low<=sl:+c.high>=sl,target=side==='LONG'?+c.high>=tp1:+c.low<=tp1;last=+c.close||last;if(stop)return rnd(-1-cost,4);if(target)return rnd(((tp1-entry)*(side==='LONG'?1:-1)/R)-cost,4)}return rnd(((last-entry)*(side==='LONG'?1:-1)/R)-cost,4)}
function stat(key,a){const rs=a.map(x=>x.r).filter(Number.isFinite),n=rs.length,sum=rs.reduce((x,y)=>x+y,0),w=rs.filter(x=>x>0),l=rs.filter(x=>x<0),gp=w.reduce((x,y)=>x+y,0),gl=Math.abs(l.reduce((x,y)=>x+y,0));return{key,samples:n,totalR:rnd(sum),avgR:rnd(n?sum/n:0),wr:rnd(n?w.length/n*100:0,1),pf:rnd(gl?gp/gl:(gp?99:0))}}
function group(rows,fn,min=20){const m=new Map();for(const x of rows){const k=String(fn(x));if(!m.has(k))m.set(k,[]);m.get(k).push(x)}return [...m.entries()].map(([k,v])=>stat(k,v)).filter(x=>x.samples>=min).sort((a,b)=>b.samples-a.samples)}
function bucket(v,cuts,labels){const n=+v;if(!Number.isFinite(n))return'UNKNOWN';for(let i=0;i<cuts.length;i++){if(n<cuts[i])return labels[i]}return labels[labels.length-1]}
function table(title,rows){let s=`### ${title}\n\n| Bucket | Samples | Total R | Avg R | WR | PF |\n|---|---:|---:|---:|---:|---:|\n`;for(const x of rows)s+=`| ${x.key} | ${x.samples} | ${x.totalR} | ${x.avgR} | ${x.wr}% | ${x.pf} |\n`;return s+'\n'}

const runs=[];
for(const days of WINDOWS){
  console.log('Momentum Continuation Lab',days+'d');
  const start=END-days*DAY,warm=start-80*FOUR_H,market={},tls={};
  for(const symbol of ASSETS){
    const [m15,h1,h4]=await Promise.all([fetchKlines(symbol,'15m',warm,END),fetchKlines(symbol,'1h',warm,END),fetchKlines(symbol,'4h',warm,END)]);
    market[symbol]={'15m':m15,'1h':h1,'4h':h4};tls[symbol]={h1:timeline(h1),h4:timeline(h4)};
  }
  const events=prepareEvents(market,start,END,CLOUD_BT_CONFIG),last=new Map(),rows=[];
  for(const ev of events){
    for(const sig of Object.values(ev.signals||{})){
      if(sig.side!=='LONG'||sig.regime!=='BULL')continue;
      if(ev.t-(last.get(sig.symbol)||0)<FOUR_H)continue;
      last.set(sig.symbol,ev.t);
      const r=outcomeR(sig,ev.t,market[sig.symbol]['15m'],END);if(r==null)continue;
      const h1=tls[sig.symbol].h1,h4=tls[sig.symbol].h4,i1=idxAt(h1,ev.t),i4=idxAt(h4,ev.t),x1=h1[i1],x4=h4[i4];
      if(!Number.isFinite(x1?.rsi)||!Number.isFinite(x4?.rsi))continue;
      rows.push({symbol:sig.symbol,r,rsi1:x1.rsi,rsi4:x4.rsi,slope1_3:x1.rsi-(h1[i1-3]?.rsi??x1.rsi),slope4_1:x4.rsi-(h4[i4-1]?.rsi??x4.rsi),slope4_3:x4.rsi-(h4[i4-3]?.rsi??x4.rsi),streak1:streak(h1,i1,70),streak4:streak(h4,i4,70),highDist4:highDist(h4,i4),emaDist4:emaDist(h4,i4),adx4:+sig.frames?.['4h']?.adx,vol15:+sig.frames?.['15m']?.volumeRatio,status:sig.status});
    }
  }
  const features={
    rsi4:group(rows,x=>bucket(x.rsi4,[70,75,80,85],['<70','70-74','75-79','80-84','>=85'])),
    rsi1:group(rows,x=>bucket(x.rsi1,[65,70,75,80],['<65','65-69','70-74','75-79','>=80'])),
    slope4_1:group(rows,x=>bucket(x.slope4_1,[-5,-1,1,5],['<-5','-5..-1','-1..1','1..5','>5'])),
    slope4_3:group(rows,x=>bucket(x.slope4_3,[-10,-3,3,10],['<-10','-10..-3','-3..3','3..10','>10'])),
    slope1_3:group(rows,x=>bucket(x.slope1_3,[-10,-3,3,10],['<-10','-10..-3','-3..3','3..10','>10'])),
    streak4:group(rows,x=>bucket(x.streak4,[1,2,4,7],['0','1','2-3','4-6','>=7'])),
    streak1:group(rows,x=>bucket(x.streak1,[1,2,4,7],['0','1','2-3','4-6','>=7'])),
    highDist4:group(rows,x=>bucket(x.highDist4,[0.5,1.5,3,6],['<0.5%','0.5-1.5%','1.5-3%','3-6%','>=6%'])),
    emaDist4:group(rows,x=>bucket(x.emaDist4,[0,2,5,10],['<0%','0-2%','2-5%','5-10%','>=10%'])),
    adx4:group(rows,x=>bucket(x.adx4,[20,30,40,50],['<20','20-29','30-39','40-49','>=50'])),
    volume15:group(rows,x=>bucket(x.vol15,[0.8,1,1.2,1.5],['<0.8','0.8-0.99','1.0-1.19','1.2-1.49','>=1.5'])),
    comboRsi:group(rows,x=>`${bucket(x.rsi1,[70,75,80],['<70','70-74','75-79','>=80'])}|${bucket(x.rsi4,[75,80,85],['<75','75-79','80-84','>=85'])}`),
    comboRsiSlope:group(rows,x=>`${bucket(x.rsi4,[75,80,85],['<75','75-79','80-84','>=85'])}|${bucket(x.slope4_1,[-1,1],['DOWN','FLAT','UP'])}`),
    status:group(rows,x=>x.status),asset:group(rows,x=>x.symbol)
  };
  runs.push({days,total:stat('LONG|BULL',rows),features});
}

function robust(feature){
  const keys=new Set(runs.flatMap(r=>r.features[feature].map(x=>x.key))),out=[];
  for(const k of keys){
    const vals=runs.map(r=>r.features[feature].find(x=>x.key===k)).filter(Boolean),adequate=vals.filter(x=>x.samples>=20),positive=adequate.filter(x=>x.avgR>0&&x.pf>=1);
    if(adequate.length)out.push({key:k,adequate:adequate.length,positive:positive.length,meanAvgR:rnd(adequate.reduce((a,x)=>a+x.avgR,0)/adequate.length),minSamples:Math.min(...adequate.map(x=>x.samples))});
  }
  return out.sort((a,b)=>b.positive-a.positive||b.meanAvgR-a.meanAvgR);
}
const robustness={};for(const f of Object.keys(runs[0].features))robustness[f]=robust(f);
const out={schemaVersion:'7.59-MOMENTUM-CONTINUATION-V1',generatedAt:new Date().toISOString(),cohort:'LONG+BULL only',sampling:'max one candidate per symbol per 4h',outcome:'A_CURRENT normalized R, 14d horizon, portfolio gates excluded',assets:ASSETS,windows:WINDOWS,runs,robustness};
fs.mkdirSync('research',{recursive:true});
fs.writeFileSync('research/momentum-continuation-v759.json',JSON.stringify(out,null,2));
let md=`# MERIDIAN v7.59 — Momentum Continuation Lab\n\nGenerated: ${out.generatedAt}\n\nCohort: ${out.cohort}. Sampling: ${out.sampling}. Outcome: ${out.outcome}.\n\n`;
for(const r of runs){
  md+=`## ${r.days} days\n\n`;
  md+=table('RSI 4h',r.features.rsi4)+table('RSI 1h',r.features.rsi1)+table('4h RSI slope 1 candle',r.features.slope4_1)+table('4h RSI slope 3 candles',r.features.slope4_3)+table('1h RSI slope 3 candles',r.features.slope1_3)+table('4h RSI >70 duration',r.features.streak4)+table('Distance from recent 4h high',r.features.highDist4)+table('4h distance from EMA20',r.features.emaDist4)+table('4h ADX',r.features.adx4)+table('15m volume',r.features.volume15)+table('RSI 1h x RSI 4h',r.features.comboRsi)+table('RSI 4h x slope',r.features.comboRsiSlope);
}
md+='## Robust positive interactions\n\n';
for(const [name,rows] of Object.entries(robustness)){
  const good=rows.filter(x=>x.positive>0).slice(0,20);if(!good.length)continue;
  md+=`### ${name}\n\n| Bucket | Positive windows | Adequate windows | Mean Avg R | Min samples |\n|---|---:|---:|---:|---:|\n`;
  for(const x of good)md+=`| ${x.key} | ${x.positive} | ${x.adequate} | ${x.meanAvgR} | ${x.minSamples} |\n`;
  md+='\n';
}
fs.writeFileSync('research/momentum-continuation-v759.md',md);
console.log('wrote Momentum Continuation Lab');

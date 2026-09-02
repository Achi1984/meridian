import fs from 'node:fs';
import { __test, CLOUD_BT_CONFIG } from '../cloud-backtest.js';

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
    if(stop)return rnd(-1-feeSlipR,4);
    if(target)return rnd(((tp1-entry)*(side==='LONG'?1:-1)/risk)-feeSlipR,4);
  }
  return rnd(((last-entry)*(side==='LONG'?1:-1)/risk)-feeSlipR,4);
}
function stat(key,x){const rs=x.map(z=>z.realizedR).filter(Number.isFinite),n=rs.length,sum=rs.reduce((a,b)=>a+b,0),wins=rs.filter(v=>v>0),loss=rs.filter(v=>v<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(loss.reduce((a,b)=>a+b,0));return{key,samples:n,totalR:rnd(sum),avgR:rnd(n?sum/n:0),winRate:rnd(n?wins.length/n*100:0,1),pf:rnd(gl?gp/gl:(gp?99:0))}}
function group(rows,keyFn){const m=new Map();for(const r of rows){const k=String(keyFn(r));if(!m.has(k))m.set(k,[]);m.get(k).push(r)}return[...m.entries()].map(([k,v])=>stat(k,v)).sort((a,b)=>b.samples-a.samples)}
function numBucket(v,cuts,labels){const n=Number(v);if(!Number.isFinite(n))return'UNKNOWN';for(let i=0;i<cuts.length;i++)if(n<cuts[i])return labels[i];return labels[labels.length-1]}
function sign(x){const n=Number(x);return n>0?'POS':n<0?'NEG':'ZERO'}
function sideAlignedSign(side,x){const s=String(side).toUpperCase();const n=Number(x);return (s==='LONG'&&n>0)||(s==='SHORT'&&n<0)?'ALIGNED':'OPPOSED'}
function emaStructure(side,f){let aligned=0;for(const tf of ['15m','1h','4h']){const m=f?.[tf]||{},bull=Number(m.ema20)>Number(m.ema50),ok=side==='LONG'?bull:!bull;if(ok)aligned++}return `${aligned}/3`}
function priceEmaAlignment(side,f){let aligned=0;for(const tf of ['15m','1h','4h']){const m=f?.[tf]||{},bull=Number(m.price)>Number(m.ema20),ok=side==='LONG'?bull:!bull;if(ok)aligned++}return `${aligned}/3`}
function macdAlignment(side,f){let aligned=0,seen=0;for(const tf of ['15m','1h','4h']){const h=Number(f?.[tf]?.macd?.hist);if(!Number.isFinite(h))continue;seen++;if((side==='LONG'&&h>0)||(side==='SHORT'&&h<0))aligned++}return `${aligned}/${seen||3}`}
function rsiSideState(side,rsi){const n=Number(rsi);if(!Number.isFinite(n))return'UNKNOWN';if(side==='LONG'){if(n<42)return'WEAK';if(n<52)return'NEUTRAL_LOW';if(n<=72)return'FAVORABLE';if(n<=78)return'HOT';return'EXTREME'}else{if(n>58)return'WEAK';if(n>48)return'NEUTRAL_HIGH';if(n>=28)return'FAVORABLE';if(n>=22)return'COLD';return'EXTREME'}}
function table(title,rows){let s=`### ${title}\n\n| Bucket | Samples | Total R | Avg R | WR | PF |\n|---|---:|---:|---:|---:|---:|\n`;for(const x of rows)s+=`| ${x.key} | ${x.samples} | ${x.totalR} | ${x.avgR} | ${x.winRate}% | ${x.pf} |\n`;return s+'\n'}

const runs=[];
for(const days of WINDOWS){
  console.log('Feature Edge Map',days+'d');const start=END-days*DAY,warm=start-60*FOUR_H,market={};
  for(const symbol of ASSETS){const[m15,h1,h4]=await Promise.all([fetchKlines(symbol,'15m',warm,END),fetchKlines(symbol,'1h',warm,END),fetchKlines(symbol,'4h',warm,END)]);market[symbol]={'15m':m15,'1h':h1,'4h':h4}}
  const events=prepareEvents(market,start,END,CLOUD_BT_CONFIG),lastSample=new Map(),rows=[];
  for(const ev of events){for(const sig of Object.values(ev.signals||{})){const prev=lastSample.get(sig.symbol)||0;if(ev.t-prev<FOUR_H)continue;lastSample.set(sig.symbol,ev.t);const realizedR=outcomeR(sig,ev.t,market[sig.symbol]['15m'],END);if(realizedR==null)continue;const f=sig.frames||{},m15=f['15m']||{},h1=f['1h']||{},h4=f['4h']||{};rows.push({symbol:sig.symbol,side:sig.side,regime:sig.regime,status:sig.status,realizedR,distanceAtr:rnd(sig.distanceAtr,3),technical:sig.technical,candidate:sig.candidate,emaStruct:emaStructure(sig.side,f),priceEmaAlign:priceEmaAlignment(sig.side,f),macdAlign:macdAlignment(sig.side,f),rsi15:rsiSideState(sig.side,m15.rsi),rsi1h:rsiSideState(sig.side,h1.rsi),rsi4h:rsiSideState(sig.side,h4.rsi),adx15:numBucket(m15.adx,[18,25,35],['<18','18-24','25-34','>=35']),adx1h:numBucket(h1.adx,[18,25,35],['<18','18-24','25-34','>=35']),adx4h:numBucket(h4.adx,[18,25,35],['<18','18-24','25-34','>=35']),vol15:numBucket(m15.volumeRatio,[.65,1,1.15,1.5],['<0.65','0.65-0.99','1.00-1.14','1.15-1.49','>=1.50']),vol1h:numBucket(h1.volumeRatio,[.65,1,1.15,1.5],['<0.65','0.65-0.99','1.00-1.14','1.15-1.49','>=1.50']),macd15:sideAlignedSign(sig.side,m15.macd?.hist),macd1h:sideAlignedSign(sig.side,h1.macd?.hist),macd4h:sideAlignedSign(sig.side,h4.macd?.hist)})}}
  const features={
    sideRegime:group(rows,x=>`${x.side}|${x.regime}`),status:group(rows,x=>x.status),emaStructure:group(rows,x=>x.emaStruct),priceEmaAlignment:group(rows,x=>x.priceEmaAlign),macdAlignment:group(rows,x=>x.macdAlign),rsi15:group(rows,x=>x.rsi15),rsi1h:group(rows,x=>x.rsi1h),rsi4h:group(rows,x=>x.rsi4h),adx15:group(rows,x=>x.adx15),adx1h:group(rows,x=>x.adx1h),adx4h:group(rows,x=>x.adx4h),volume15:group(rows,x=>x.vol15),volume1h:group(rows,x=>x.vol1h),macd15:group(rows,x=>x.macd15),macd1h:group(rows,x=>x.macd1h),macd4h:group(rows,x=>x.macd4h),distance:group(rows,x=>numBucket(x.distanceAtr,[.25,.5,.75,1,1.5],['<=0.25','0.25-0.50','0.50-0.75','0.75-1.00','1.00-1.50','>1.50'])),asset:group(rows,x=>x.symbol)};
  runs.push({days,total:stat('ALL',rows),features});
}

function featureRobustness(runs){const out=[];const names=Object.keys(runs[0]?.features||{});for(const feature of names){const keys=new Set(runs.flatMap(r=>(r.features[feature]||[]).map(x=>x.key)));for(const key of keys){const vals=runs.map(r=>(r.features[feature]||[]).find(x=>x.key===key)).filter(Boolean);const adequate=vals.filter(x=>x.samples>=30),positive=adequate.filter(x=>x.avgR>0&&x.pf>=1),meanAvg=adequate.length?adequate.reduce((a,x)=>a+x.avgR,0)/adequate.length:null;out.push({feature,bucket:key,windows:vals.length,adequateWindows:adequate.length,positiveWindows:positive.length,meanAvgR:rnd(meanAvg),minSamples:adequate.length?Math.min(...adequate.map(x=>x.samples)):0})}}return out.sort((a,b)=>b.positiveWindows-a.positiveWindows||Number(b.meanAvgR??-99)-Number(a.meanAvgR??-99))}
const robustness=featureRobustness(runs);
const out={schemaVersion:'7.57-FEATURE-EDGE-MAP-V1',generatedAt:new Date().toISOString(),sampling:'one candidate per symbol per 4h',outcome:'A_CURRENT normalized R, 14d horizon, portfolio gates excluded',assets:ASSETS,windows:WINDOWS,runs,robustness};
fs.mkdirSync('research',{recursive:true});fs.writeFileSync('research/feature-edge-map-v757.json',JSON.stringify(out,null,2));
let md=`# MERIDIAN v7.57 — Raw Feature Edge Map\n\nGenerated: ${out.generatedAt}\n\nSampling: ${out.sampling}. Outcome: ${out.outcome}.\n\n`;
for(const r of runs){md+=`## ${r.days} days\n\n${table('EMA20/50 side alignment across timeframes',r.features.emaStructure)}${table('Price vs EMA20 side alignment',r.features.priceEmaAlignment)}${table('MACD side alignment across timeframes',r.features.macdAlignment)}${table('RSI 15m state',r.features.rsi15)}${table('RSI 1h state',r.features.rsi1h)}${table('ADX 1h',r.features.adx1h)}${table('ADX 4h',r.features.adx4h)}${table('15m volume participation',r.features.volume15)}${table('Entry distance ATR',r.features.distance)}${table('Side × Regime',r.features.sideRegime)}`}
md+='## Cross-window robust positive buckets\n\n| Feature | Bucket | Positive adequate windows | Adequate windows | Mean Avg R | Min samples |\n|---|---|---:|---:|---:|---:|\n'+robustness.filter(x=>x.positiveWindows>0).slice(0,40).map(x=>`| ${x.feature} | ${x.bucket} | ${x.positiveWindows} | ${x.adequateWindows} | ${x.meanAvgR} | ${x.minSamples} |`).join('\n')+'\n';
fs.writeFileSync('research/feature-edge-map-v757.md',md);console.log('wrote Raw Feature Edge Map');

#!/usr/bin/env node
// MERIDIAN v7.62 — portfolio-independent raw signal cohort generator.
// Research-only. Fetches public Binance klines, samples one candidate per symbol per 4h,
// and evaluates A_CURRENT/full-TP1 normalized-R with stop-first same-candle handling.
import fs from 'node:fs';

const BINANCE='https://api.binance.com';
const M15=15*60*1000,H4=4*60*60*1000,DAY=24*60*60*1000;
const DEFAULT_SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const CFG=Object.freeze({atrStopMult:1.6,tp1R:1.4,minTechnicalScore:68,minCandidateScore:62,maxEntryDistanceAtr:.75,horizonDays:14});
const args=process.argv.slice(2);
const valueOf=f=>{const i=args.indexOf(f);return i>=0?args[i+1]:null};
const outDir=valueOf('--out-dir')||'research/generated-v762';
const symbols=(valueOf('--symbols')||DEFAULT_SYMBOLS.join(',')).split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);
const endAtArg=valueOf('--end-at');
const now=Date.now();
const outcomeEnd=endAtArg?Date.parse(endAtArg):now;
if(!Number.isFinite(outcomeEnd))throw new Error('Invalid --end-at');
const sampleEnd=outcomeEnd-CFG.horizonDays*DAY;
const sampleStart=sampleEnd-90*DAY;
const fetchStart=sampleStart-12*DAY; // warmup for 4h EMA50/ADX and indicator stability

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const last=a=>a[a.length-1];
const round=(v,d=6)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function fetchJson(url){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),15000);
  try{const r=await fetch(url,{signal:c.signal,headers:{'user-agent':'ACHI-MERIDIAN-RESEARCH/7.62'}});if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);return await r.json();}
  finally{clearTimeout(t)}
}
async function fetch15m(symbol,start,end){
  const out=[];let cursor=start;
  while(cursor<end){
    const url=`${BINANCE}/api/v3/klines?symbol=${symbol}&interval=15m&limit=1000&startTime=${cursor}&endTime=${end}`;
    const j=await fetchJson(url);if(!Array.isArray(j)||!j.length)break;
    for(const k of j)out.push({openTime:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5],closeTime:+k[6]});
    const next=out[out.length-1].openTime+M15;if(next<=cursor)break;cursor=next;await sleep(80);
  }
  return out.filter((x,i,a)=>!i||x.openTime!==a[i-1].openTime);
}
function aggregate(candles,ms){
  const out=[];let cur=null;
  for(const c of candles){const bucket=Math.floor(c.openTime/ms)*ms;if(!cur||cur.openTime!==bucket){if(cur)out.push(cur);cur={openTime:bucket,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume,closeTime:bucket+ms-1};}else{cur.high=Math.max(cur.high,c.high);cur.low=Math.min(cur.low,c.low);cur.close=c.close;cur.volume+=c.volume;}}
  if(cur)out.push(cur);return out;
}
function ema(v,p){if(!v.length)return[];const k=2/(p+1),o=[v[0]];for(let i=1;i<v.length;i++)o.push(v[i]*k+o[i-1]*(1-k));return o}
function rsi(v,p=14){if(v.length<p+1)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];d>=0?g+=d:l-=d}g/=p;l/=p;for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p}if(l===0)return 100;const rs=g/l;return 100-100/(1+rs)}
function atr(c,p=14){if(c.length<p+1)return null;const tr=[];for(let i=1;i<c.length;i++){const x=c[i],y=c[i-1];tr.push(Math.max(x.high-x.low,Math.abs(x.high-y.close),Math.abs(x.low-y.close)))}let a=tr.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<tr.length;i++)a=(a*(p-1)+tr[i])/p;return a}
function macd(v){if(v.length<35)return null;const a=ema(v,12),b=ema(v,26),m=v.map((_,i)=>(a[i]??0)-(b[i]??0)),s=ema(m,9);return{hist:last(m)-last(s)}}
function adx(c,p=14){if(c.length<p*2+2)return null;const tr=[],pd=[],md=[];for(let i=1;i<c.length;i++){const x=c[i],y=c[i-1],up=x.high-y.high,dn=y.low-x.low;pd.push(up>dn&&up>0?up:0);md.push(dn>up&&dn>0?dn:0);tr.push(Math.max(x.high-x.low,Math.abs(x.high-y.close),Math.abs(x.low-y.close)))}let trp=tr.slice(0,p).reduce((a,b)=>a+b,0),pp=pd.slice(0,p).reduce((a,b)=>a+b,0),mp=md.slice(0,p).reduce((a,b)=>a+b,0),dx=[];for(let i=p;i<tr.length;i++){if(i>p){trp=trp-trp/p+tr[i];pp=pp-pp/p+pd[i];mp=mp-mp/p+md[i]}const pdi=trp?100*pp/trp:0,mdi=trp?100*mp/trp:0;dx.push(pdi+mdi?100*Math.abs(pdi-mdi)/(pdi+mdi):0)}if(dx.length<p)return null;let a=dx.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<dx.length;i++)a=(a*(p-1)+dx[i])/p;return a}
function vol(c,n=20){if(c.length<n+1)return 1;const v=c.map(x=>x.volume),cur=last(v),base=v.slice(-(n+1),-1).reduce((a,b)=>a+b,0)/n;return base>0?cur/base:1}
function metrics(c){const closes=c.map(x=>x.close),e20=ema(closes,20),e50=ema(closes,50);return{price:last(closes),ema20:last(e20),ema50:last(e50),rsi:rsi(closes),macdHist:macd(closes)?.hist??null,atr:atr(c),adx:adx(c),volumeRatio:vol(c)}}
function directional(m,side){let sc=50,L=side==='LONG';if(m.ema20&&m.ema50){sc+=(L?m.ema20>m.ema50:m.ema20<m.ema50)?12:-12;sc+=(L?m.price>m.ema20:m.price<m.ema20)?7:-7}if(Number.isFinite(m.macdHist))sc+=(L?m.macdHist>0:m.macdHist<0)?10:-10;if(m.rsi!=null){if(L){if(m.rsi>=52&&m.rsi<=72)sc+=10;else if(m.rsi>78)sc-=9;else if(m.rsi<42)sc-=6}else{if(m.rsi<=48&&m.rsi>=28)sc+=10;else if(m.rsi<22)sc-=9;else if(m.rsi>58)sc-=6}}if(m.adx!=null)sc+=m.adx>=25?7:m.adx<18?-6:0;if(m.volumeRatio>=1.15)sc+=5;else if(m.volumeRatio<.65)sc-=3;return clamp(Math.round(sc),0,100)}
function observedRegime(f){const h4=f['4h'],h1=f['1h'];if((h4.adx??0)<18)return'RANGE';const b4=(h4.ema20??0)>(h4.ema50??0),b1=(h1.ema20??0)>(h1.ema50??0),s4=(h4.ema20??0)<(h4.ema50??0),s1=(h1.ema20??0)<(h1.ema50??0);if(b4&&b1)return'BULL';if(s4&&s1)return'BEAR';return'TRANSITION'}
function candidate(symbol,f){const L={m15:directional(f['15m'],'LONG'),h1:directional(f['1h'],'LONG'),h4:directional(f['4h'],'LONG')},S={m15:directional(f['15m'],'SHORT'),h1:directional(f['1h'],'SHORT'),h4:directional(f['4h'],'SHORT')};const w=x=>Math.round(x.m15*.4+x.h1*.35+x.h4*.25),lt=w(L),st=w(S),side=lt>=st?'LONG':'SHORT',technical=Math.max(lt,st),sel=side==='LONG'?L:S,align=[sel.m15,sel.h1,sel.h4].filter(x=>x>=60).length;let cand=technical+(align===3?8:align===2?3:-8)+((f['1h'].adx??0)>=25?4:0)+((f['15m'].volumeRatio??1)>=1.1?3:0);cand=clamp(Math.round(cand),0,100);const price=f['15m'].price,A=f['15m'].atr||price*.01,anchor=f['15m'].ema20||price,dAtr=A>0?Math.abs(price-anchor)/A:999;let status='NO_SETUP';if(technical>=CFG.minTechnicalScore&&cand>=CFG.minCandidateScore)status=dAtr<=CFG.maxEntryDistanceAtr?'READY':'WAIT_ENTRY_ZONE';return{symbol,side,technical,candidate:cand,regime:observedRegime(f),status,entry:price,atr:A,distanceAtr:dAtr}}
function compactFrame(m){return{price:round(m.price,8),ema20:round(m.ema20,8),ema50:round(m.ema50,8),rsi:round(m.rsi,3),macdHist:round(m.macdHist,10),atr:round(m.atr,8),adx:round(m.adx,3),volumeRatio:round(m.volumeRatio,4)}}
function evaluateOutcome(sig,future){const risk=sig.atr*CFG.atrStopMult;if(!(risk>0))return null;const stop=sig.side==='LONG'?sig.entry-risk:sig.entry+risk,tp1=sig.side==='LONG'?sig.entry+risk*CFG.tp1R:sig.entry-risk*CFG.tp1R;for(const c of future){const stopHit=sig.side==='LONG'?c.low<=stop:c.high>=stop;const tpHit=sig.side==='LONG'?c.high>=tp1:c.low<=tp1;if(stopHit)return{outcomeR:-1,exitReason:'SL',exitAt:c.closeTime};if(tpHit)return{outcomeR:CFG.tp1R,exitReason:'TP1',exitAt:c.closeTime};}const px=future.length?last(future).close:sig.entry;const r=(sig.side==='LONG'?(px-sig.entry):(sig.entry-px))/risk;return{outcomeR:round(r,6),exitReason:'HORIZON',exitAt:future.length?last(future).closeTime:null}}
function sliceUntil(a,t,max){let lo=0,hi=a.length;while(lo<hi){const m=(lo+hi)>>1;if(a[m].closeTime<=t)lo=m+1;else hi=m}return a.slice(Math.max(0,lo-max),lo)}
function futureAfter(a,t,end){let lo=0,hi=a.length;while(lo<hi){const m=(lo+hi)>>1;if(a[m].closeTime<=t)lo=m+1;else hi=m}const out=[];for(let i=lo;i<a.length&&a[i].closeTime<=end;i++)out.push(a[i]);return out}

const all=[];
for(const symbol of symbols){
  console.error(`fetch ${symbol}`);const m15=await fetch15m(symbol,fetchStart,outcomeEnd);if(m15.length<1000){console.error(`skip ${symbol}: insufficient candles ${m15.length}`);continue}
  const h1=aggregate(m15,60*60*1000),h4=aggregate(m15,H4);
  let t=Math.ceil(sampleStart/H4)*H4+H4-1;
  for(;t<=sampleEnd;t+=H4){
    const c15=sliceUntil(m15,t,220),c1=sliceUntil(h1,t,220),c4=sliceUntil(h4,t,220);if(c15.length<60||c1.length<60||c4.length<60)continue;
    const frames={'15m':metrics(c15),'1h':metrics(c1),'4h':metrics(c4)};const sig=candidate(symbol,frames);const future=futureAfter(m15,t,t+CFG.horizonDays*DAY);const outcome=evaluateOutcome(sig,future);if(!outcome)continue;
    all.push({schemaVersion:'7.62-SIGNAL-COHORT-V1',sampledAt:new Date(t).toISOString(),symbol,side:sig.side,regime:sig.regime,baselineStatus:sig.status,technical:sig.technical,candidate:sig.candidate,distanceAtr:round(sig.distanceAtr,6),entry:round(sig.entry,8),frames:{'15m':compactFrame(frames['15m']),'1h':compactFrame(frames['1h']),'4h':compactFrame(frames['4h'])},outcomeR:outcome.outcomeR,exitReason:outcome.exitReason,exitAt:outcome.exitAt?new Date(outcome.exitAt).toISOString():null,horizonDays:CFG.horizonDays,portfolioGatesExcluded:true});
  }
}
all.sort((a,b)=>Date.parse(a.sampledAt)-Date.parse(b.sampledAt)||a.symbol.localeCompare(b.symbol));
fs.mkdirSync(outDir,{recursive:true});
const windows={30:sampleEnd-30*DAY,60:sampleEnd-60*DAY,90:sampleEnd-90*DAY};
for(const [days,start] of Object.entries(windows)){
  const rows=all.filter(x=>Date.parse(x.sampledAt)>=start&&Date.parse(x.sampledAt)<=sampleEnd);
  const payload={schemaVersion:'7.62-SIGNAL-COHORT-V1',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,portfolioGatesExcluded:true,sampling:'one candidate per symbol per 4h',outcome:'A_CURRENT full TP1; SL first on same candle; 14d horizon',symbols,sampleStart:new Date(start).toISOString(),sampleEnd:new Date(sampleEnd).toISOString(),outcomeDataThrough:new Date(outcomeEnd).toISOString(),samples:rows.length,rows};
  fs.writeFileSync(`${outDir}/signal-cohort-${days}d.json`,JSON.stringify(payload,null,2)+'\n');
  console.error(`${days}d samples ${rows.length}`);
}
console.log(JSON.stringify({ok:true,outDir,totalSamples:all.length,symbols,sampleEnd:new Date(sampleEnd).toISOString()},null,2));

// ACHI MERIDIAN Research Engine V2 — v7.34
// Research-only. Shared multi-asset timeline with independent Baseline/Shadow/Challenger ledgers.
// Does NOT alter live/Paper execution in server.js.
import { regimeDecision } from './regime-v1.js';
import { replayExitLabForLedgers } from './exit-lab-replay.js';
import { challengerV3Decision, CHALLENGER_V3_RULESET } from './challenger-v3.js';
const BINANCE='https://api.binance.com';
const MS={'15m':900000,'1h':3600000,'4h':14400000};
const DAY=86400000;

export const CLOUD_BT_CONFIG=Object.freeze({
  feeBps:5,slippageBps:3,minTechnicalScore:68,minCandidateScore:62,maxEntryDistanceAtr:.75,
  atrStopMult:1.6,tp1R:1.4,tp2R:2.2,riskPerTradePct:1,cooldownMinutes:30,startEquity:10000,
  maxDailyLossPct:3,maxDrawdownPct:8,maxOpenPositions:3,maxPortfolioRiskPct:3,maxTradesPerDay:8
});

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const last=a=>a[a.length-1];
const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dayKey=ts=>new Date(ts).toISOString().slice(0,10);

function ema(v,p){if(!v.length)return[];const k=2/(p+1),o=[v[0]];for(let i=1;i<v.length;i++)o.push(v[i]*k+o[i-1]*(1-k));return o}
function rsi(v,p=14){if(v.length<p+1)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];d>=0?g+=d:l-=d}g/=p;l/=p;for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p}if(l===0)return 100;const rs=g/l;return 100-100/(1+rs)}
function atr(c,p=14){if(c.length<p+1)return null;const tr=[];for(let i=1;i<c.length;i++){const x=c[i],y=c[i-1];tr.push(Math.max(x.high-x.low,Math.abs(x.high-y.close),Math.abs(x.low-y.close)))}let a=tr.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<tr.length;i++)a=(a*(p-1)+tr[i])/p;return a}
function macd(v){if(v.length<35)return null;const a=ema(v,12),b=ema(v,26),m=v.map((_,i)=>(a[i]??0)-(b[i]??0)),s=ema(m,9);return{hist:last(m)-last(s)}}
function adx(c,p=14){if(c.length<p*2+2)return null;const tr=[],pd=[],md=[];for(let i=1;i<c.length;i++){const x=c[i],y=c[i-1],up=x.high-y.high,dn=y.low-x.low;pd.push(up>dn&&up>0?up:0);md.push(dn>up&&dn>0?dn:0);tr.push(Math.max(x.high-x.low,Math.abs(x.high-y.close),Math.abs(x.low-y.close)))}let trp=tr.slice(0,p).reduce((a,b)=>a+b,0),pp=pd.slice(0,p).reduce((a,b)=>a+b,0),mp=md.slice(0,p).reduce((a,b)=>a+b,0),dx=[];for(let i=p;i<tr.length;i++){if(i>p){trp=trp-trp/p+tr[i];pp=pp-pp/p+pd[i];mp=mp-mp/p+md[i]}const pdi=trp?100*pp/trp:0,mdi=trp?100*mp/trp:0;dx.push(pdi+mdi?100*Math.abs(pdi-mdi)/(pdi+mdi):0)}if(dx.length<p)return null;let a=dx.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<dx.length;i++)a=(a*(p-1)+dx[i])/p;return a}
function vol(c,n=20){if(c.length<n+1)return 1;const v=c.map(x=>x.volume),cur=last(v),base=v.slice(-(n+1),-1).reduce((a,b)=>a+b,0)/n;return base>0?cur/base:1}
function metrics(c){const closes=c.map(x=>x.close),e20=ema(closes,20),e50=ema(closes,50);return{price:last(closes),ema20:last(e20),ema50:last(e50),rsi:rsi(closes),macd:macd(closes),atr:atr(c),adx:adx(c),volumeRatio:vol(c)}}
function directional(m,side){let sc=50,L=side==='LONG';if(m.ema20&&m.ema50){sc+=(L?m.ema20>m.ema50:m.ema20<m.ema50)?12:-12;sc+=(L?m.price>m.ema20:m.price<m.ema20)?7:-7}if(m.macd)sc+=(L?m.macd.hist>0:m.macd.hist<0)?10:-10;if(m.rsi!=null){if(L){if(m.rsi>=52&&m.rsi<=72)sc+=10;else if(m.rsi>78)sc-=9;else if(m.rsi<42)sc-=6}else{if(m.rsi<=48&&m.rsi>=28)sc+=10;else if(m.rsi<22)sc-=9;else if(m.rsi>58)sc-=6}}if(m.adx!=null)sc+=m.adx>=25?7:m.adx<18?-6:0;if(m.volumeRatio>=1.15)sc+=5;else if(m.volumeRatio<.65)sc-=3;return clamp(Math.round(sc),0,100)}
function regime(f){const h4=f['4h'],h1=f['1h'];if((h4.adx??0)<18)return'RANGE';const b4=(h4.ema20??0)>(h4.ema50??0),b1=(h1.ema20??0)>(h1.ema50??0),s4=(h4.ema20??0)<(h4.ema50??0),s1=(h1.ema20??0)<(h1.ema50??0);if(b4&&b1)return'BULL';if(s4&&s1)return'BEAR';return'TRANSITION'}
function candidate(symbol,f,cfg=CLOUD_BT_CONFIG){const L={m15:directional(f['15m'],'LONG'),h1:directional(f['1h'],'LONG'),h4:directional(f['4h'],'LONG')},S={m15:directional(f['15m'],'SHORT'),h1:directional(f['1h'],'SHORT'),h4:directional(f['4h'],'SHORT')};const w=x=>Math.round(x.m15*.4+x.h1*.35+x.h4*.25),lt=w(L),st=w(S),side=lt>=st?'LONG':'SHORT',technical=Math.max(lt,st),sel=side==='LONG'?L:S,align=[sel.m15,sel.h1,sel.h4].filter(x=>x>=60).length;let cand=technical+(align===3?8:align===2?3:-8)+((f['1h'].adx??0)>=25?4:0)+((f['15m'].volumeRatio??1)>=1.1?3:0);cand=clamp(Math.round(cand),0,100);const price=f['15m'].price,A=f['15m'].atr||price*.01,anchor=f['15m'].ema20||price,dAtr=A>0?Math.abs(price-anchor)/A:999,entryZone=dAtr<=cfg.maxEntryDistanceAtr,stop=A*cfg.atrStopMult,sl=side==='LONG'?price-stop:price+stop,R=Math.abs(price-sl),tp1=side==='LONG'?price+R*cfg.tp1R:price-R*cfg.tp1R,tp2=side==='LONG'?price+R*cfg.tp2R:price-R*cfg.tp2R;let status='NO_SETUP';if(technical>=cfg.minTechnicalScore&&cand>=cfg.minCandidateScore)status=entryZone?'READY':'WAIT_ENTRY_ZONE';return{symbol,side,technical,candidate:cand,regime:regime(f),status,entry:price,sl,tp1,tp2,distanceAtr:dAtr,frames:f}}
const slip=(p,side,entry,cfg=CLOUD_BT_CONFIG)=>p*(side==='LONG'?(entry?1+cfg.slippageBps/10000:1-cfg.slippageBps/10000):(entry?1-cfg.slippageBps/10000:1+cfg.slippageBps/10000));

function shadowDecision(sig){const reasons=[];if(sig.status!=='READY')reasons.push(sig.status==='WAIT_ENTRY_ZONE'?'WAIT_ENTRY_ZONE':'BASE_NOT_READY');if(sig.technical<75)reasons.push('SHADOW_TECH_LT_75');if(sig.candidate<70)reasons.push('SHADOW_CAND_LT_70');if(sig.regime==='TRANSITION')reasons.push('SHADOW_BLOCK_TRANSITION');if(sig.side==='LONG'&&sig.regime!=='BULL')reasons.push('SHADOW_LONG_ONLY_BULL');if(sig.side==='SHORT'&&!['BEAR','RANGE'].includes(sig.regime))reasons.push('SHADOW_SHORT_ONLY_BEAR_RANGE');return{decision:reasons.length?'SKIP':'TRADE',riskPct:CLOUD_BT_CONFIG.riskPerTradePct,reasons}}
function challengerRegimeAdjustment(side,r){if(side==='LONG'){if(r==='BULL')return 10;if(r==='BEAR')return-12;if(r==='RANGE')return-2;return-5}if(r==='BEAR')return 10;if(r==='RANGE')return 4;if(r==='BULL')return-12;return-5}
function challengerDecision(sig,cfg=CLOUD_BT_CONFIG){const d=Number(sig.distanceAtr),dq=Number.isFinite(d)?clamp(100-(d/Math.max(cfg.maxEntryDistanceAtr,.01))*35,0,100):40,adj=challengerRegimeAdjustment(sig.side,sig.regime),confidence=clamp(Math.round(sig.technical*.42+sig.candidate*.38+dq*.20+adj),0,100);let decision='SKIP',riskPct=0,reasons=[];if(sig.status!=='READY')reasons.push(sig.status==='WAIT_ENTRY_ZONE'?'WAIT_ENTRY_ZONE':'BASE_NOT_READY');else if(confidence>=72){decision='TRADE';riskPct=cfg.riskPerTradePct}else if(confidence>=62){decision='CAUTION';riskPct=Math.max(.1,round(cfg.riskPerTradePct*.5,3))}else reasons.push('CONFIDENCE_LT_CAUTION');return{decision,riskPct,confidence,distanceQuality:round(dq,1),regimeAdjustment:adj,reasons}}

function makeLedger(name,cfg=CLOUD_BT_CONFIG){return{name,cash:cfg.startEquity,equity:cfg.startEquity,peakEquity:cfg.startEquity,dayStartEquity:cfg.startEquity,currentDay:null,positions:[],trades:[],equityCurve:[],lastCloseBySymbol:new Map(),entriesByDay:new Map(),maxDrawdown:0}}
function markLedger(L,prices,t,cfg=CLOUD_BT_CONFIG){let unreal=0;for(const p of L.positions){const px=prices[p.symbol];if(!(px>0))continue;const dir=p.side==='LONG'?1:-1;unreal+=(px-p.entry)*p.qty*dir}L.equity=L.cash+unreal;if(L.currentDay!==dayKey(t)){L.currentDay=dayKey(t);L.dayStartEquity=L.equity}L.peakEquity=Math.max(L.peakEquity,L.equity);const dd=L.peakEquity>0?Math.max(0,(L.peakEquity-L.equity)/L.peakEquity*100):0;L.maxDrawdown=Math.max(L.maxDrawdown,dd);const prev=last(L.equityCurve);if(!prev||t-prev.ts>=3600000)L.equityCurve.push({ts:t,equity:round(L.equity,4)});return unreal}
function openRisk(L){return L.positions.reduce((a,p)=>a+Number(p.riskPct||0),0)}
function entriesToday(L,t){return Number(L.entriesByDay.get(dayKey(t))||0)}
function gate(L,sig,riskPct,t,cfg=CLOUD_BT_CONFIG){const reasons=[];if(L.positions.some(p=>p.symbol===sig.symbol))reasons.push('SAME_SYMBOL_POSITION_OPEN');if(L.positions.length>=cfg.maxOpenPositions)reasons.push('MAX_OPEN_POSITIONS');if(entriesToday(L,t)>=cfg.maxTradesPerDay)reasons.push('MAX_TRADES_PER_DAY');if(openRisk(L)+riskPct>cfg.maxPortfolioRiskPct+1e-9)reasons.push('MAX_PORTFOLIO_RISK');const lastClose=L.lastCloseBySymbol.get(sig.symbol)||0;if(t-lastClose<cfg.cooldownMinutes*60000)reasons.push('SYMBOL_COOLDOWN');const dl=L.dayStartEquity>0?Math.max(0,(L.dayStartEquity-L.equity)/L.dayStartEquity*100):0,dd=L.peakEquity>0?Math.max(0,(L.peakEquity-L.equity)/L.peakEquity*100):0;if(dl>=cfg.maxDailyLossPct)reasons.push('MAX_DAILY_LOSS');if(dd>=cfg.maxDrawdownPct)reasons.push('MAX_DRAWDOWN');return{ok:reasons.length===0,reasons,dailyLossPct:dl,drawdownPct:dd,openRiskPct:openRisk(L)}}
function openPosition(L,sig,riskPct,t,meta={},cfg=CLOUD_BT_CONFIG){const entry=slip(sig.entry,sig.side,true,cfg),dist=Math.abs(entry-sig.sl);if(!(dist>0))return false;const qty=L.equity*(riskPct/100)/dist;if(!(qty>0))return false;const feeOpen=qty*entry*cfg.feeBps/10000;L.cash-=feeOpen;L.positions.push({symbol:sig.symbol,side:sig.side,entry,sl:sig.sl,tp1:sig.tp1,tp2:sig.tp2,qty,riskPct,feeOpen,openedAt:t,technical:sig.technical,candidate:sig.candidate,distanceAtr:sig.distanceAtr,regime:sig.regime,...meta});const k=dayKey(t);L.entriesByDay.set(k,entriesToday(L,t)+1);return true}
function closePosition(L,p,px,t,reason,cfg=CLOUD_BT_CONFIG){const exit=slip(px,p.side,false,cfg),dir=p.side==='LONG'?1:-1,gross=(exit-p.entry)*p.qty*dir,feeClose=exit*p.qty*cfg.feeBps/10000,realized=gross-p.feeOpen-feeClose;L.cash+=gross-feeClose;const tr={...p,exit,closedAt:t,exitReason:reason,gross,feeClose,realized};L.trades.push(tr);L.lastCloseBySymbol.set(p.symbol,t);return tr}
function processExits(L,candles,t,cfg=CLOUD_BT_CONFIG){const keep=[];for(const p of L.positions){const c=candles[p.symbol];if(!c){keep.push(p);continue}const adverse=p.side==='LONG'?c.low<=p.sl:c.high>=p.sl,hit2=p.tp2!=null&&(p.side==='LONG'?c.high>=p.tp2:c.low<=p.tp2),hit1=p.tp1!=null&&(p.side==='LONG'?c.high>=p.tp1:c.low<=p.tp1);let reason=null,px=null;if(adverse){reason='SL';px=p.sl}else if(hit2){reason='TP2';px=p.tp2}else if(hit1){reason='TP1';px=p.tp1}if(reason)closePosition(L,p,px,t,reason,cfg);else keep.push(p)}L.positions=keep}
function stats(L,cfg=CLOUD_BT_CONFIG){const tr=L.trades,wins=tr.filter(x=>x.realized>0),losses=tr.filter(x=>x.realized<0),gp=wins.reduce((a,x)=>a+x.realized,0),gl=Math.abs(losses.reduce((a,x)=>a+x.realized,0)),pnl=tr.reduce((a,x)=>a+x.realized,0),longP=tr.filter(x=>x.side==='LONG').reduce((a,x)=>a+x.realized,0),shortP=tr.filter(x=>x.side==='SHORT').reduce((a,x)=>a+x.realized,0);return{trades:tr.length,wins:wins.length,winRate:tr.length?wins.length/tr.length*100:0,pnl,endEquity:cfg.startEquity+pnl,pf:gl>0?gp/gl:(gp>0?99:0),maxDD:L.maxDrawdown,expectancy:tr.length?pnl/tr.length:0,longP,shortP,grossWin:gp,grossLoss:gl,tradeList:tr,equityCurve:L.equityCurve}}

function lastIndexAt(rows,t){let lo=0,hi=rows.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(rows[m].closeTime<=t){ans=m;lo=m+1}else hi=m-1}return ans}
function windowMetrics(rows,t){const i=lastIndexAt(rows,t);if(i<59)return null;return metrics(rows.slice(Math.max(0,i-179),i+1))}
function signalAt(symbol,data,t,cfg=CLOUD_BT_CONFIG){const a=windowMetrics(data['15m'],t),b=windowMetrics(data['1h'],t),c=windowMetrics(data['4h'],t);if(!a||!b||!c)return null;return candidate(symbol,{'15m':a,'1h':b,'4h':c},cfg)}
function prepareEvents(market,start,end,cfg=CLOUD_BT_CONFIG,onProgress=()=>{}){const times=[...new Set(Object.values(market).flatMap(x=>x['15m'].map(c=>c.closeTime).filter(t=>t>=start&&t<=end)))].sort((a,b)=>a-b),events=[];const maps={};for(const [s,d] of Object.entries(market))maps[s]=new Map(d['15m'].map(c=>[c.closeTime,c]));for(let i=0;i<times.length;i++){const t=times[i],candles={},signals={};for(const [s,d] of Object.entries(market)){const c=maps[s].get(t);if(!c)continue;candles[s]=c;const sig=signalAt(s,d,t,cfg);if(sig)signals[s]=sig}events.push({t,candles,signals});if(i&&i%1000===0)onProgress({stage:'prepare',pct:Math.round(i/times.length*100)})}return events}

function replayPrepared(events,start,end,cfg=CLOUD_BT_CONFIG){const ledgers={baseline:makeLedger('BASELINE',cfg),shadow:makeLedger('SHADOW_V1',cfg),challenger:makeLedger('CHALLENGER_V2',cfg),challengerV3:makeLedger('CHALLENGER_V3',cfg),regime:makeLedger('REGIME_V1',cfg)},lastPrices={};for(const ev of events){if(ev.t<start||ev.t>end)continue;for(const [s,c] of Object.entries(ev.candles))lastPrices[s]=c.close;for(const L of Object.values(ledgers)){processExits(L,ev.candles,ev.t,cfg);markLedger(L,lastPrices,ev.t,cfg)}for(const sig of Object.values(ev.signals)){if(sig.status==='READY'){const L=ledgers.baseline,g=gate(L,sig,cfg.riskPerTradePct,ev.t,cfg);if(g.ok)openPosition(L,sig,cfg.riskPerTradePct,ev.t,{modelDecision:'BASELINE'},cfg)}const sd=shadowDecision(sig);if(sd.decision==='TRADE'){const L=ledgers.shadow,g=gate(L,sig,sd.riskPct,ev.t,cfg);if(g.ok)openPosition(L,sig,sd.riskPct,ev.t,{modelDecision:'TRADE'},cfg)}const cd=challengerDecision(sig,cfg);if(cd.decision==='TRADE'||cd.decision==='CAUTION'){const L=ledgers.challenger,g=gate(L,sig,cd.riskPct,ev.t,cfg);if(g.ok)openPosition(L,sig,cd.riskPct,ev.t,{modelDecision:cd.decision,confidence:cd.confidence},cfg)}const c3=challengerV3Decision(sig,{fullRiskPct:cfg.riskPerTradePct,cautionRiskPct:Math.max(.1,round(cfg.riskPerTradePct*.5,3))});if(c3.decision==='TRADE'||c3.decision==='CAUTION'){const L=ledgers.challengerV3,g=gate(L,sig,c3.riskPct,ev.t,cfg);if(g.ok)openPosition(L,sig,c3.riskPct,ev.t,{modelDecision:c3.decision,confidence:c3.confidence,challengerRuleset:CHALLENGER_V3_RULESET,baselineStatusAtEntry:sig.status,baselineReadyDependency:false},cfg)}const rd=regimeDecision(sig,{fullRiskPct:cfg.riskPerTradePct,cautionRiskPct:Math.max(.1,round(cfg.riskPerTradePct*.5,3))});if(rd.decision==='TRADE'||rd.decision==='CAUTION'){const rs={...sig,side:rd.side,entry:rd.entry,sl:rd.sl,tp1:rd.tp1,tp2:rd.tp2};const L=ledgers.regime,g=gate(L,rs,rd.riskPct,ev.t,cfg);if(g.ok)openPosition(L,rs,rd.riskPct,ev.t,{modelDecision:rd.decision,regimeType:rd.regime,regimeScore:rd.score,sourceSide:rd.sourceSide},cfg)}}for(const L of Object.values(ledgers))markLedger(L,lastPrices,ev.t,cfg)}const lastT=Math.min(end,events.filter(x=>x.t<=end).at(-1)?.t??end);for(const L of Object.values(ledgers)){for(const p of [...L.positions]){const px=lastPrices[p.symbol];if(px>0)closePosition(L,p,px,lastT,'EOD',cfg)}L.positions=[];markLedger(L,lastPrices,lastT,cfg)}return{baseline:stats(ledgers.baseline,cfg),shadow:stats(ledgers.shadow,cfg),challenger:stats(ledgers.challenger,cfg),challengerV3:stats(ledgers.challengerV3,cfg),regime:stats(ledgers.regime,cfg)}}

function assetBreakdown(trades){const m={};for(const t of trades||[]){const q=m[t.symbol]||(m[t.symbol]={symbol:t.symbol,trades:0,wins:0,pnl:0,grossWin:0,grossLoss:0});q.trades++;q.pnl+=t.realized;if(t.realized>0){q.wins++;q.grossWin+=t.realized}else q.grossLoss+=Math.abs(t.realized)}return Object.values(m).map(q=>({...q,winRate:q.trades?q.wins/q.trades*100:0,pf:q.grossLoss?q.grossWin/q.grossLoss:(q.grossWin?99:0)})).sort((a,b)=>b.trades-a.trades)}
function compactStats(x){const {tradeList,equityCurve,...z}=x;return{...z,trades:z.trades,winRate:round(z.winRate,2),pnl:round(z.pnl,2),endEquity:round(z.endEquity,2),pf:round(z.pf,3),maxDD:round(z.maxDD,3),expectancy:round(z.expectancy,2),longP:round(z.longP,2),shortP:round(z.shortP,2),grossWin:round(z.grossWin,2),grossLoss:round(z.grossLoss,2)}}
function variantStability(name,key,windows,total){
  const perWindow=windows.map(w=>({i:w.i,from:w.from,to:w.to,...w[key]}));
  const positive=perWindow.filter(x=>x.trades>=8&&x.pf>=1&&x.expectancy>0).length;
  const adequate=perWindow.filter(x=>x.trades>=8).length;
  const severe=perWindow.filter(x=>x.trades>=8&&(x.pf<.75||x.expectancy<-20)).length;
  const stability=Math.max(0,Math.min(100,Math.round(100*(.55*positive/5+.25*adequate/5+.20*(1-severe/5)))));
  return{name,total:compactStats(total),perWindow,positive,adequate,severe,stability};
}
function continuousSummary(events,start,end,cfg=CLOUD_BT_CONFIG,full=null){
  const span=(end-start)/5,windows=[];
  for(let i=0;i<5;i++){
    const from=i===0?start:start+i*span+1,to=i===4?end:start+(i+1)*span;
    const r=replayPrepared(events,from,to,cfg),baseline=compactStats(r.baseline),shadow=compactStats(r.shadow),challenger=compactStats(r.challenger),challengerV3=compactStats(r.challengerV3),regime=compactStats(r.regime);
    windows.push({i:i+1,from,to,...baseline,baseline,shadow,challenger,challengerV3,regime});
  }
  const whole=full||replayPrepared(events,start,end,cfg);
  return{
    method:'FRESH_INDEPENDENT_PORTFOLIO_LEDGER_EACH_20PCT_CALENDAR_WINDOW',
    windows,
    variants:[
      variantStability('BASE','baseline',windows,whole.baseline),
      variantStability('SHADOW V1','shadow',windows,whole.shadow),
      variantStability('CHALLENGER V2','challenger',windows,whole.challenger),
      variantStability('CHALLENGER V3','challengerV3',windows,whole.challengerV3),
      variantStability('REGIME V1','regime',windows,whole.regime)
    ]
  };
}

async function fetchKlines(symbol,interval,start,end){let out=[],cur=start,guard=0;while(cur<end&&guard++<800){const u=`${BINANCE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${Math.floor(cur)}&endTime=${Math.floor(end)}&limit=1000`;let j,lastErr;for(let a=0;a<6;a++){try{const r=await fetch(u,{headers:{'user-agent':'ACHI-MERIDIAN-RESEARCH-V2/7.34'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);j=await r.json();break}catch(e){lastErr=e;await sleep(Math.min(8000,500*2**a))}}if(!Array.isArray(j))throw lastErr||new Error('Binance load failed');if(!j.length)break;const rows=j.map(k=>({openTime:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5],closeTime:+k[6]}));out.push(...rows);const nx=rows.at(-1).openTime+MS[interval];if(nx<=cur)break;cur=nx;await sleep(75)}return [...new Map(out.map(x=>[x.openTime,x])).values()].sort((a,b)=>a.openTime-b.openTime)}

export async function runCloudBacktest({assets,days=90,end=Date.now(),onProgress=()=>{}}){
  const cfg=CLOUD_BT_CONFIG,start=end-days*DAY,warmStart=start-60*MS['4h'],market={};
  for(let i=0;i<assets.length;i++){
    const symbol=assets[i];onProgress({stage:'loading',asset:symbol,index:i,total:assets.length,pct:Math.round(i/assets.length*45)});
    const [m15,h1,h4]=await Promise.all([fetchKlines(symbol,'15m',warmStart,end),fetchKlines(symbol,'1h',warmStart,end),fetchKlines(symbol,'4h',warmStart,end)]);
    market[symbol]={'15m':m15,'1h':h1,'4h':h4};
  }
  onProgress({stage:'prepare',pct:50});
  const events=prepareEvents(market,start,end,cfg,p=>onProgress({...p,pct:50+Math.round((p.pct||0)*.15)}));
  onProgress({stage:'portfolio-replay',pct:68});
  const ledgers=replayPrepared(events,start,end,cfg);
  onProgress({stage:'walk-forward',pct:82});
  const researchContinuous=continuousSummary(events,start,end,cfg,ledgers);
  onProgress({stage:'exit-lab-replay',pct:92});
  const exitLabReplay=replayExitLabForLedgers({
    ledgers:{baseline:ledgers.baseline.tradeList,shadow:ledgers.shadow.tradeList,challenger:ledgers.challenger.tradeList,regime:ledgers.regime.tradeList},
    market,end,opts:{horizonDays:14,feeBps:cfg.feeBps,slippageBps:cfg.slippageBps}
  });
  const result={mode:'PORTFOLIO_V2',cloud:true,version:'7.49-EXIT-LAB-REPLAY-V1',challengerModel:'7.52-CHALLENGER-V3',researchEngine:'7.34-RESEARCH-V2',regimeModel:'7.38-REGIME-V1',method:'SHARED_MULTI_ASSET_TIMELINE_INDEPENDENT_LEDGERS',executionImpact:false,days,start,end,assets,config:cfg,summary:compactStats(ledgers.baseline),ledgers:{baseline:{...compactStats(ledgers.baseline),tradeList:ledgers.baseline.tradeList,equityCurve:ledgers.baseline.equityCurve,byAsset:assetBreakdown(ledgers.baseline.tradeList)},shadow:{...compactStats(ledgers.shadow),tradeList:ledgers.shadow.tradeList,equityCurve:ledgers.shadow.equityCurve,byAsset:assetBreakdown(ledgers.shadow.tradeList)},challenger:{...compactStats(ledgers.challenger),tradeList:ledgers.challenger.tradeList,equityCurve:ledgers.challenger.equityCurve,byAsset:assetBreakdown(ledgers.challenger.tradeList)},challengerV3:{...compactStats(ledgers.challengerV3),tradeList:ledgers.challengerV3.tradeList,equityCurve:ledgers.challengerV3.equityCurve,byAsset:assetBreakdown(ledgers.challengerV3.tradeList)},regime:{...compactStats(ledgers.regime),tradeList:ledgers.regime.tradeList,equityCurve:ledgers.regime.equityCurve,byAsset:assetBreakdown(ledgers.regime.tradeList)}},researchContinuous,exitLabReplay,generatedAt:new Date().toISOString()};
  onProgress({stage:'done',pct:100});return result;
}

export const __test={makeLedger,markLedger,gate,openPosition,closePosition,processExits,stats,replayPrepared,shadowDecision,challengerDecision,candidate,slip};

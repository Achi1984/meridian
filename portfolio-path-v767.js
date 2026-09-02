// MERIDIAN v7.67 — portfolio-path replay for Baseline READY vs Challenger V3.2
// Research-only. Uses historical cohort outcomes chronologically and never changes Paper execution.
import { scoreChallengerV32 } from './challenger-v32.js';

const DAY=86400000;
const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const ts=r=>Date.parse(r?.sampledAt||'');
const exitTs=r=>Date.parse(r?.exitAt||'');
const outcome=r=>Number.isFinite(Number(r?.outcomeR))?Number(r.outcomeR):Number.isFinite(Number(r?.normalizedR))?Number(r.normalizedR):null;
const dayKey=t=>new Date(t).toISOString().slice(0,10);
const key=r=>`${r?.sampledAt||''}|${r?.symbol||''}`;

export const V767_CONFIG=Object.freeze({
  startEquity:10000,
  riskPerTradePct:1,
  maxOpenPositions:3,
  maxPortfolioRiskPct:3,
  maxTradesPerDay:8,
  maxDailyLossPct:3,
  maxDrawdownPct:8,
  cooldownMinutes:30
});

function summarizeTrades(trades,startEquity,equity,maxDrawdown){
  const rs=trades.map(x=>x.outcomeR),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0)),total=rs.reduce((a,b)=>a+b,0);
  return {trades:trades.length,totalR:round(total),avgR:trades.length?round(total/trades.length):null,winRate:trades.length?round(wins.length/trades.length*100,1):null,pf:gl>0?round(gp/gl):(gp>0?99:0),startEquity:round(startEquity,2),endEquity:round(equity,2),returnPct:startEquity?round((equity/startEquity-1)*100,2):null,maxDrawdownPct:round(maxDrawdown,2)};
}

function makeState(cfg){return{equity:cfg.startEquity,peak:cfg.startEquity,maxDD:0,positions:[],trades:[],entriesByDay:new Map(),dayStartEquity:new Map(),lastCloseBySymbol:new Map(),skips:{maxOpen:0,maxPortfolioRisk:0,maxTradesDay:0,maxDailyLoss:0,maxDrawdown:0,sameSymbol:0,cooldown:0},maxConcurrent:0,concurrencySum:0,concurrencySamples:0};}
function refreshDay(S,t){const d=dayKey(t);if(!S.dayStartEquity.has(d))S.dayStartEquity.set(d,S.equity);return d;}
function markDD(S){S.peak=Math.max(S.peak,S.equity);const dd=S.peak>0?Math.max(0,(S.peak-S.equity)/S.peak*100):0;S.maxDD=Math.max(S.maxDD,dd);}
function closeDue(S,t){
  const keep=[];
  for(const p of S.positions){if(p.exitAt<=t){const pnl=p.equityAtRiskAtOpen*(p.riskPct/100)*p.outcomeR;S.equity+=pnl;S.trades.push({...p,pnl:round(pnl,4),equityAfter:round(S.equity,4)});S.lastCloseBySymbol.set(p.symbol,p.exitAt);markDD(S);}else keep.push(p)}
  S.positions=keep;
}
function gate(S,r,t,cfg){
  const reasons=[];const d=refreshDay(S,t),entries=Number(S.entriesByDay.get(d)||0),openRisk=S.positions.reduce((a,p)=>a+p.riskPct,0),dayStart=S.dayStartEquity.get(d)||S.equity,dayLoss=dayStart>0?Math.max(0,(dayStart-S.equity)/dayStart*100):0,dd=S.peak>0?Math.max(0,(S.peak-S.equity)/S.peak*100):0,lastClose=S.lastCloseBySymbol.get(r.symbol)||0;
  if(S.positions.some(p=>p.symbol===r.symbol))reasons.push('sameSymbol');
  if(S.positions.length>=cfg.maxOpenPositions)reasons.push('maxOpen');
  if(openRisk+cfg.riskPerTradePct>cfg.maxPortfolioRiskPct+1e-9)reasons.push('maxPortfolioRisk');
  if(entries>=cfg.maxTradesPerDay)reasons.push('maxTradesDay');
  if(dayLoss>=cfg.maxDailyLossPct)reasons.push('maxDailyLoss');
  if(dd>=cfg.maxDrawdownPct)reasons.push('maxDrawdown');
  if(lastClose&&t-lastClose<cfg.cooldownMinutes*60000)reasons.push('cooldown');
  return{ok:!reasons.length,reasons,d};
}
function rankBaseline(rows){return rows.filter(r=>String(r.baselineStatus||r.status||'').toUpperCase()==='READY').sort((a,b)=>Number(b.candidate||0)-Number(a.candidate||0)||Number(b.technical||0)-Number(a.technical||0)||String(a.symbol||'').localeCompare(String(b.symbol||'')));}
function rankV32(rows,options){return rows.map(r=>({r,s:scoreChallengerV32(r,options)})).sort((a,b)=>b.s.evidenceScore-a.s.evidenceScore||Number(b.r.candidate||0)-Number(a.r.candidate||0)||Number(b.r.technical||0)-Number(a.r.technical||0)||String(a.r.symbol||'').localeCompare(String(b.r.symbol||''))).map(x=>({...x.r,__v32Score:x.s.evidenceScore,__v32Hits:x.s.hits}));}
function simulate(rows,selector,cfg,options={}){
  const clean=rows.filter(r=>Number.isFinite(ts(r))&&Number.isFinite(exitTs(r))&&outcome(r)!=null).sort((a,b)=>ts(a)-ts(b)||String(a.symbol||'').localeCompare(String(b.symbol||''))),S=makeState(cfg),selectedKeys=new Set(),candidateKeys=new Set();
  let i=0;
  while(i<clean.length){const t=ts(clean[i]);closeDue(S,t);const batch=[];while(i<clean.length&&ts(clean[i])===t)batch.push(clean[i++]);const ranked=selector(batch,options);for(const r of ranked){candidateKeys.add(key(r));const g=gate(S,r,t,cfg);if(!g.ok){for(const reason of new Set(g.reasons))S.skips[reason]=(S.skips[reason]||0)+1;continue}const riskPct=cfg.riskPerTradePct,d=g.d;S.entriesByDay.set(d,Number(S.entriesByDay.get(d)||0)+1);S.positions.push({symbol:r.symbol,side:r.side,sampledAt:r.sampledAt,exitAt:exitTs(r),exitAtIso:r.exitAt,outcomeR:outcome(r),riskPct,equityAtRiskAtOpen:S.equity,baselineStatus:r.baselineStatus,score:Number(r.__v32Score??NaN),hits:r.__v32Hits||[]});selectedKeys.add(key(r));S.maxConcurrent=Math.max(S.maxConcurrent,S.positions.length)}S.concurrencySum+=S.positions.length;S.concurrencySamples++}
  closeDue(S,Number.POSITIVE_INFINITY);
  const stats=summarizeTrades(S.trades,cfg.startEquity,S.equity,S.maxDD);stats.maxConcurrent=S.maxConcurrent;stats.avgConcurrent=S.concurrencySamples?round(S.concurrencySum/S.concurrencySamples,2):0;stats.entriesPerActiveDay=S.entriesByDay.size?round(S.trades.length/S.entriesByDay.size,2):0;
  return{stats,trades:S.trades,selectedKeys,candidateKeys,skips:S.skips};
}

export function replayPortfolioPath(rows=[],options={}){
  const cfg={...V767_CONFIG,...(options.config||{})},baseline=simulate(rows,rankBaseline,cfg,options),v32=simulate(rows,rankV32,cfg,options);
  const baseSelected=baseline.selectedKeys,v32Selected=v32.selectedKeys;
  const displaced=baseline.trades.filter(t=>!v32Selected.has(`${t.sampledAt}|${t.symbol}`)),discovered=v32.trades.filter(t=>!baseSelected.has(`${t.sampledAt}|${t.symbol}`));
  const improvement=(v32.stats.avgR??-999)-(baseline.stats.avgR??-999);
  return {schemaVersion:'7.67-PORTFOLIO-PATH-V1',researchOnly:true,executionImpact:false,markToMarket:false,drawdownMethod:'realized-equity drawdown from cohort exit events; intratrade MTM unavailable in compact cohort',config:cfg,universe:rows.length,baseline:{...baseline.stats,skips:baseline.skips},challengerV32:{...v32.stats,skips:v32.skips},opportunity:{overlap:baseline.trades.filter(t=>v32Selected.has(`${t.sampledAt}|${t.symbol}`)).length,discovered:discovered.length,displaced:displaced.length,avoidedLosers:displaced.filter(t=>t.outcomeR<0).length,missedWinners:displaced.filter(t=>t.outcomeR>0).length,discoveredWinners:discovered.filter(t=>t.outcomeR>0).length,discoveredLosers:discovered.filter(t=>t.outcomeR<0).length},comparison:{avgRDelta:round(improvement),pfDelta:round((v32.stats.pf??0)-(baseline.stats.pf??0)),endEquityDelta:round((v32.stats.endEquity??0)-(baseline.stats.endEquity??0),2),maxDrawdownDeltaPct:round((v32.stats.maxDrawdownPct??0)-(baseline.stats.maxDrawdownPct??0),2),v32BetterAvgR:improvement>0}};
}

export function sliceRecentWindow(rows=[],days=90){const valid=rows.filter(r=>Number.isFinite(ts(r)));if(!valid.length)return[];const end=Math.max(...valid.map(ts));return valid.filter(r=>ts(r)>=end-days*DAY&&ts(r)<=end);}

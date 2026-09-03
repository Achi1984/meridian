// MERIDIAN v7.73 — Soft Allocation Lab
// Research-only. No Paper/runtime/UI/execution impact.
import { scoreChallengerV32 } from './challenger-v32.js';
import { extractRawFeatures } from './feature-attribution.js';

const DAY=86400000;
const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const outcome=r=>Number.isFinite(Number(r?.outcomeR))?Number(r.outcomeR):Number.isFinite(Number(r?.normalizedR))?Number(r.normalizedR):null;
const ts=r=>Date.parse(r?.sampledAt||'');
const exitTs=r=>Date.parse(r?.exitAt||'');
const key=r=>`${r?.sampledAt||''}|${r?.symbol||''}`;

export const V773_CONFIG=Object.freeze({
  rangeBonus:0.5,
  riskPerTradePct:0.25,
  startEquity:10000,
  maxOpenPositions:3,
  maxPortfolioRiskPct:3,
  maxTradesPerDay:8,
  maxDailyLossPct:3,
  maxDrawdownPct:8,
  cooldownMinutes:30,
});

export function scoreV773(row={},options={}){
  const base=scoreChallengerV32(row,options);
  const raw=extractRawFeatures(row,options.bins);
  const bonus=String(raw.side).toUpperCase()==='LONG'&&String(raw.regime).toUpperCase()==='RANGE' ? Number(options.rangeBonus??V773_CONFIG.rangeBonus) : 0;
  return {...base,schemaVersion:'7.73-SOFT-ALLOCATION-SCORE-V1',baseEvidenceScore:base.evidenceScore,allocationBonus:bonus,evidenceScore:round(Number(base.evidenceScore||0)+bonus,2)};
}

function summarize(rows){
  const rs=rows.map(outcome).filter(Number.isFinite),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0)),total=rs.reduce((a,b)=>a+b,0);
  return {samples:rs.length,totalR:round(total),avgR:rs.length?round(total/rs.length):null,winRate:rs.length?round(wins.length/rs.length*100,1):null,pf:gl>0?round(gp/gl):(gp>0?99:0)};
}

function rank(rows,scorer,options){
  return rows.map((r,i)=>({r,i,s:scorer(r,options)})).sort((a,b)=>b.s.evidenceScore-a.s.evidenceScore||Number(b.r.candidate||0)-Number(a.r.candidate||0)||Number(b.r.technical||0)-Number(a.r.technical||0)||a.i-b.i);
}

export function compareSignalSelection(rows=[],options={}){
  const clean=rows.filter(r=>outcome(r)!=null);
  const n=clean.filter(r=>String(r.baselineStatus||r.status||'').toUpperCase()==='READY').length;
  const v32=rank(clean,scoreChallengerV32,options).slice(0,n).map(x=>x.r);
  const v773=rank(clean,scoreV773,options).slice(0,n).map(x=>x.r);
  const a=new Set(v32.map(key)),b=new Set(v773.map(key));
  const displaced=v32.filter(r=>!b.has(key(r))),discovered=v773.filter(r=>!a.has(key(r)));
  return {
    equalCoverage:v32.length===v773.length,
    v32:summarize(v32),v773:summarize(v773),
    opportunity:{overlap:v32.filter(r=>b.has(key(r))).length,discovered:discovered.length,displaced:displaced.length,avoidedLosers:displaced.filter(r=>outcome(r)<0).length,missedWinners:displaced.filter(r=>outcome(r)>0).length,discoveredWinners:discovered.filter(r=>outcome(r)>0).length,discoveredLosers:discovered.filter(r=>outcome(r)<0).length},
    comparison:{avgRDelta:round((summarize(v773).avgR??0)-(summarize(v32).avgR??0)),pfDelta:round((summarize(v773).pf??0)-(summarize(v32).pf??0))}
  };
}

function simulate(rows,scorer,options={}){
  const cfg={...V773_CONFIG,...options};
  const clean=rows.filter(r=>Number.isFinite(ts(r))&&Number.isFinite(exitTs(r))&&outcome(r)!=null).sort((a,b)=>ts(a)-ts(b)||String(a.symbol||'').localeCompare(String(b.symbol||'')));
  let equity=cfg.startEquity,peak=equity,maxDD=0; const open=[],trades=[],entriesByDay=new Map(),dayStart=new Map(),lastClose=new Map(); let maxConcurrent=0;
  const closeDue=t=>{open.sort((a,b)=>a.exitAt-b.exitAt);for(let i=open.length-1;i>=0;i--){if(open[i].exitAt>t)continue;const p=open.splice(i,1)[0];equity+=p.riskCapital*p.r;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak>0?(peak-equity)/peak*100:0);lastClose.set(p.symbol,p.exitAt);trades.push(p)}};
  let i=0; while(i<clean.length){const t=ts(clean[i]);closeDue(t);const batch=[];while(i<clean.length&&ts(clean[i])===t)batch.push(clean[i++]);for(const {r} of rank(batch,scorer,options)){
      const d=new Date(t).toISOString().slice(0,10); if(!dayStart.has(d))dayStart.set(d,equity); const entries=entriesByDay.get(d)||0; const dayLoss=Math.max(0,(dayStart.get(d)-equity)/dayStart.get(d)*100); const dd=peak>0?Math.max(0,(peak-equity)/peak*100):0;
      if(open.some(p=>p.symbol===r.symbol)||open.length>=cfg.maxOpenPositions||entries>=cfg.maxTradesPerDay||dayLoss>=cfg.maxDailyLossPct||dd>=cfg.maxDrawdownPct)continue;
      if((lastClose.get(r.symbol)||0)&&t-lastClose.get(r.symbol)<cfg.cooldownMinutes*60000)continue;
      const riskCapital=equity*(cfg.riskPerTradePct/100);open.push({symbol:r.symbol,sampledAt:r.sampledAt,exitAt:exitTs(r),r:outcome(r),riskCapital});entriesByDay.set(d,entries+1);maxConcurrent=Math.max(maxConcurrent,open.length);
    }} closeDue(Number.POSITIVE_INFINITY);
  const s=summarize(trades.map(x=>({outcomeR:x.r}))); return {...s,startEquity:cfg.startEquity,endEquity:round(equity,2),returnPct:round((equity/cfg.startEquity-1)*100,2),maxDrawdownPct:round(maxDD,2),maxConcurrent,entriesPerActiveDay:entriesByDay.size?round(trades.length/entriesByDay.size,2):0,trades:trades.length};
}

export function comparePortfolioPath(rows=[],options={}){
  const v32=simulate(rows,scoreChallengerV32,options),v773=simulate(rows,scoreV773,options);
  return {v32,v773,comparison:{avgRDelta:round((v773.avgR??0)-(v32.avgR??0)),pfDelta:round((v773.pf??0)-(v32.pf??0)),returnDeltaPct:round((v773.returnPct??0)-(v32.returnPct??0),2),maxDrawdownDeltaPct:round((v773.maxDrawdownPct??0)-(v32.maxDrawdownPct??0),2),tradeDelta:v773.trades-v32.trades}};
}

export function sliceRecentWindow(rows=[],days=90){const valid=rows.filter(r=>Number.isFinite(ts(r)));if(!valid.length)return[];const end=Math.max(...valid.map(ts));return valid.filter(r=>ts(r)>=end-days*DAY&&ts(r)<=end)}

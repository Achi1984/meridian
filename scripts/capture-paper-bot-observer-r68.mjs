import fs from 'node:fs/promises';

const GATEWAY=String(process.env.MERIDIAN_GATEWAY_URL||'https://p01--achi-meridian--ttvk44grdlp7.code.run').replace(/\/$/,'');
const OUT=process.env.MERIDIAN_OBSERVER_OUT||'research/results/paper-runtime-observer-r68.json';
const MAX_AGE_MS=Math.max(30000,Number(process.env.MERIDIAN_OBSERVER_MAX_AGE_MS||180000));
const TIMEOUT_MS=Math.max(1000,Number(process.env.MERIDIAN_OBSERVER_TIMEOUT_MS||15000));

const c=new AbortController();
const timer=setTimeout(()=>c.abort(),TIMEOUT_MS);
let response;
try {
  response=await fetch(`${GATEWAY}/api/bot-observer?audit=${Date.now()}`,{cache:'no-store',signal:c.signal});
} finally {
  clearTimeout(timer);
}
if(!response.ok) throw new Error(`observer HTTP ${response.status}`);
const o=await response.json();

if(o?.schemaVersion!=='8.0-BOT-OBSERVER-V2') throw new Error(`unexpected schema ${o?.schemaVersion}`);
if(o?.publicReadOnly!==true||o?.executionImpact!==false) throw new Error('observer safety contract invalid');
if(o?.safety?.liveTrading!==false) throw new Error('observer reports liveTrading=true');
if(o?.safety?.paperTrading!==true) throw new Error('observer reports paperTrading!=true');

const generatedMs=Date.parse(o.generatedAt||'');
if(!Number.isFinite(generatedMs)) throw new Error('observer generatedAt invalid');
const captureMs=Date.now();
const ageMs=captureMs-generatedMs;
if(ageMs<0||ageMs>MAX_AGE_MS) throw new Error(`observer stale/future ageMs=${ageMs}`);

const numeric=(v)=>v==null?null:(Number.isFinite(Number(v))?Number(v):null);
const botRows=Object.entries(o?.bots||{}).map(([key,b])=>({
  key,
  name:b?.name||key,
  lifecycle:b?.lifecycle||'UNKNOWN',
  closedTrades:numeric(b?.closedTrades),
  openTrades:numeric(b?.openTrades),
  pnl:numeric(b?.pnl),
  drawdownPct:numeric(b?.drawdownPct),
  profitFactor:numeric(b?.profitFactor),
  winRate:numeric(b?.winRate),
  phaseStatus:b?.phase?.status||null,
  phaseTrades:numeric(b?.phase?.trades),
  phaseExpectancy:numeric(b?.phase?.expectancy),
  phaseProfitFactor:numeric(b?.phase?.profitFactor),
  remainingTrades:numeric(b?.phase?.remainingTrades),
  lastClosedAt:b?.lastClosedAt||null,
  lastScanAt:b?.lastScanAt||null,
  blockedReasons:Array.isArray(b?.blockedReasons)?b.blockedReasons:[]
}));

const result={
  schema:1,
  stage:'PAPER_RUNTIME_OBSERVER_SNAPSHOT_R68',
  source:{url:`${GATEWAY}/api/bot-observer`,schemaVersion:o.schemaVersion,publicReadOnly:true},
  capturedAt:new Date(captureMs).toISOString(),
  observerGeneratedAt:o.generatedAt,
  observerAgeMs:ageMs,
  engine:o.engine||null,
  safety:o.safety||null,
  bots:botRows,
  archived:o.archived||null,
  sourcePayload:o,
  interpretation:{
    researchOnly:true,
    executionImpact:false,
    rankingAuthorized:false,
    reason:'Snapshot records current public telemetry; different bot lineages/lifecycles are not automatically comparable and no promotion decision is implied.'
  }
};

await fs.mkdir(OUT.split('/').slice(0,-1).join('/'),{recursive:true});
await fs.writeFile(OUT,JSON.stringify(result,null,2)+'\n');

console.log(JSON.stringify({
  capturedAt:result.capturedAt,
  observerGeneratedAt:result.observerGeneratedAt,
  observerAgeMs:result.observerAgeMs,
  engine:result.engine,
  safety:result.safety,
  bots:botRows.map(({key,name,lifecycle,closedTrades,openTrades,pnl,drawdownPct,profitFactor,winRate,phaseStatus,phaseTrades,phaseExpectancy,phaseProfitFactor,remainingTrades,lastClosedAt})=>({key,name,lifecycle,closedTrades,openTrades,pnl,drawdownPct,profitFactor,winRate,phaseStatus,phaseTrades,phaseExpectancy,phaseProfitFactor,remainingTrades,lastClosedAt}))
},null,2));

import http from "node:http";
import { URL } from "node:url";
import pg from "pg";
import { runCloudBacktest } from "./cloud-backtest.js";

const { Pool } = pg;
const num=(k,f)=>Number.isFinite(Number(process.env[k]))?Number(process.env[k]):f;
const bool=(k,f)=>process.env[k]==null?f:String(process.env[k]).toLowerCase()==="true";
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const last=a=>a[a.length-1];
const round=(v,d=2)=>v==null||!Number.isFinite(Number(v))?null:Math.round(Number(v)*10**d)/10**d;

const config=Object.freeze({
  paperTrading:bool("PAPER_TRADING",true), liveTrading:bool("LIVE_TRADING",false),
  databaseUrl:process.env.DATABASE_URL||"", ingestToken:process.env.MERIDIAN_INGEST_TOKEN||"",
  intervalMs:Math.max(10000,num("ENGINE_INTERVAL_MS",30000)),
  signalIntervalMs:Math.max(60000,num("SIGNAL_INTERVAL_MS",60000)),
  marketStaleMs:Math.max(30000,num("MARKET_STALE_MS",120000)),
  symbols:(process.env.SYMBOLS||"BTCUSDT,ETHUSDT,SOLUSDT").split(",").map(s=>s.trim().toUpperCase()).filter(Boolean),
  startEquity:num("START_EQUITY",10000), maxOpenPositions:Math.max(1,Math.floor(num("MAX_OPEN_POSITIONS",3))),
  riskPerTradePct:num("RISK_PER_TRADE_PCT",1), maxPortfolioRiskPct:num("MAX_PORTFOLIO_RISK_PCT",3),
  maxDailyLossPct:num("MAX_DAILY_LOSS_PCT",3), maxDrawdownPct:num("MAX_DRAWDOWN_PCT",8),
  maxTradesPerDay:Math.max(1,Math.floor(num("MAX_TRADES_PER_DAY",8))),
  slippageBps:Math.max(0,num("SLIPPAGE_BPS",3)), feeBps:Math.max(0,num("FEE_BPS",5)),
  minTechnicalScore:clamp(num("MIN_TECHNICAL_SCORE",68),50,95),
  minCandidateScore:clamp(num("MIN_CANDIDATE_SCORE",62),50,95),
  maxEntryDistanceAtr:Math.max(.1,num("MAX_ENTRY_DISTANCE_ATR",.75)),
  atrStopMult:Math.max(.5,num("ATR_STOP_MULT",1.6)), tp1R:Math.max(.5,num("TP1_R",1.4)), tp2R:Math.max(1,num("TP2_R",2.2)),
  cooldownMinutes:Math.max(1,num("SIGNAL_COOLDOWN_MINUTES",30))
});
if(!config.paperTrading||config.liveTrading) throw new Error("Unsafe configuration: PAPER only required.");

let pool=null; let memory={paper:null,scanner:null,events:[],evidence:[]};
async function initDb(){
  if(!config.databaseUrl){console.warn("[DB] memory fallback");return;}
  pool=new Pool({connectionString:config.databaseUrl,ssl:{rejectUnauthorized:false}});
  await pool.query(`CREATE TABLE IF NOT EXISTS meridian_state (key TEXT PRIMARY KEY,value JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS meridian_events (id BIGSERIAL PRIMARY KEY,type TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS meridian_evidence (
    id BIGSERIAL PRIMARY KEY,
    position_id TEXT UNIQUE NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    ruleset TEXT NOT NULL,
    technical NUMERIC,
    candidate NUMERIC,
    distance_atr NUMERIC,
    regime TEXT,
    snapshot JSONB NOT NULL,
    result JSONB,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS meridian_evidence_opened_idx ON meridian_evidence(opened_at DESC);
  CREATE INDEX IF NOT EXISTS meridian_evidence_symbol_idx ON meridian_evidence(symbol,side);
  CREATE TABLE IF NOT EXISTS meridian_backtest_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    request JSONB NOT NULL,
    progress JSONB,
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS meridian_backtest_jobs_created_idx ON meridian_backtest_jobs(created_at DESC);`);
}
async function getState(k,f=null){if(!pool)return memory[k]??f;const r=await pool.query("SELECT value FROM meridian_state WHERE key=$1",[k]);return r.rows[0]?.value??f;}
async function setState(k,v){if(!pool){memory[k]=v;return;}await pool.query(`INSERT INTO meridian_state(key,value,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[k,JSON.stringify(v)]);}
async function addEvent(type,payload){if(!pool){memory.events.push({type,payload,created_at:new Date().toISOString()});if(memory.events.length>1000)memory.events.shift();return;}await pool.query("INSERT INTO meridian_events(type,payload) VALUES($1,$2::jsonb)",[type,JSON.stringify(payload)]);}
async function recentEvents(limit=100){limit=Math.max(1,Math.min(Number(limit)||100,500));if(!pool)return memory.events.slice(-limit).reverse();const r=await pool.query("SELECT id,type,payload,created_at FROM meridian_events ORDER BY id DESC LIMIT $1",[limit]);return r.rows;}

async function saveEvidence(snapshot){
  if(!snapshot?.positionId)return;
  if(!pool){
    const i=memory.evidence.findIndex(x=>x.positionId===snapshot.positionId);
    if(i>=0)memory.evidence[i]=snapshot;else memory.evidence.push(snapshot);
    if(memory.evidence.length>5000)memory.evidence=memory.evidence.slice(-5000);
    return;
  }
  await pool.query(`INSERT INTO meridian_evidence(
    position_id,symbol,side,ruleset,technical,candidate,distance_atr,regime,snapshot,opened_at,updated_at
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now())
  ON CONFLICT(position_id) DO UPDATE SET
    technical=EXCLUDED.technical,
    candidate=EXCLUDED.candidate,
    distance_atr=EXCLUDED.distance_atr,
    regime=EXCLUDED.regime,
    snapshot=EXCLUDED.snapshot,
    updated_at=now()`,[
      snapshot.positionId,snapshot.symbol,snapshot.side,snapshot.ruleset,
      snapshot.technical,snapshot.candidate,snapshot.distanceAtr,snapshot.regime,
      JSON.stringify(snapshot),snapshot.openedAt
    ]);
}
async function closeEvidence(positionId,result){
  if(!positionId)return;
  if(!pool){
    const i=memory.evidence.findIndex(x=>x.positionId===positionId);
    if(i>=0)memory.evidence[i]={...memory.evidence[i],result,closedAt:result?.closedAt||new Date().toISOString()};
    return;
  }
  await pool.query(`UPDATE meridian_evidence
    SET result=$2::jsonb,closed_at=$3,updated_at=now()
    WHERE position_id=$1`,[
      positionId,JSON.stringify(result||{}),result?.closedAt||new Date().toISOString()
    ]);
}
async function recentEvidence(limit=100){
  limit=Math.max(1,Math.min(Number(limit)||100,500));
  if(!pool)return memory.evidence.slice(-limit).reverse();
  const r=await pool.query(`SELECT
    position_id,symbol,side,ruleset,technical,candidate,distance_atr,regime,
    snapshot,result,opened_at,closed_at,updated_at
    FROM meridian_evidence ORDER BY opened_at DESC LIMIT $1`,[limit]);
  return r.rows;
}

async function dbPing(){if(!pool)return{ok:true,mode:"memory",persistent:false};await pool.query("SELECT 1");return{ok:true,mode:"postgres",persistent:true};}
const dbMode=()=>pool?"postgres":"memory";

const BINANCE="https://api.binance.com";
async function fetchJson(url,timeoutMs=8000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{signal:c.signal,headers:{"user-agent":"ACHI-MERIDIAN/6.2"}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}finally{clearTimeout(t);}}
async function getTicker(symbol){const j=await fetchJson(`${BINANCE}/api/v3/ticker/price?symbol=${symbol}`);const price=Number(j.price);if(!(price>0))throw new Error("invalid ticker");return{symbol,price,ts:Date.now()};}
async function getKlines(symbol,interval,limit=180){const j=await fetchJson(`${BINANCE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);return j.map(k=>({openTime:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5],closeTime:+k[6]}));}
async function getMarketSnapshot(symbols){const s=await Promise.allSettled(symbols.map(getTicker));const quotes={},errors=[];s.forEach((r,i)=>r.status==="fulfilled"?quotes[symbols[i]]=r.value:errors.push({symbol:symbols[i],error:String(r.reason?.message||r.reason)}));return{quotes,errors,ts:Date.now()};}

function ema(v,p){if(!v.length)return[];const k=2/(p+1),o=[v[0]];for(let i=1;i<v.length;i++)o.push(v[i]*k+o[i-1]*(1-k));return o;}
function rsi(v,p=14){if(v.length<p+1)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];d>=0?g+=d:l-=d;}g/=p;l/=p;for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p;}if(l===0)return 100;const rs=g/l;return 100-100/(1+rs);}
function atr(c,p=14){if(c.length<p+1)return null;const tr=[];for(let i=1;i<c.length;i++){const x=c[i],y=c[i-1];tr.push(Math.max(x.high-x.low,Math.abs(x.high-y.close),Math.abs(x.low-y.close)));}let a=tr.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<tr.length;i++)a=(a*(p-1)+tr[i])/p;return a;}
function macd(v){if(v.length<35)return null;const a=ema(v,12),b=ema(v,26),m=v.map((_,i)=>(a[i]??0)-(b[i]??0)),s=ema(m,9);return{macd:last(m),signal:last(s),hist:last(m)-last(s)};}
function adx(c,p=14){if(c.length<p*2+2)return null;const tr=[],pd=[],md=[];for(let i=1;i<c.length;i++){const x=c[i],y=c[i-1],up=x.high-y.high,dn=y.low-x.low;pd.push(up>dn&&up>0?up:0);md.push(dn>up&&dn>0?dn:0);tr.push(Math.max(x.high-x.low,Math.abs(x.high-y.close),Math.abs(x.low-y.close)));}let trp=tr.slice(0,p).reduce((a,b)=>a+b,0),pp=pd.slice(0,p).reduce((a,b)=>a+b,0),mp=md.slice(0,p).reduce((a,b)=>a+b,0),dx=[];for(let i=p;i<tr.length;i++){if(i>p){trp=trp-trp/p+tr[i];pp=pp-pp/p+pd[i];mp=mp-mp/p+md[i];}const pdi=trp?100*pp/trp:0,mdi=trp?100*mp/trp:0;dx.push(pdi+mdi?100*Math.abs(pdi-mdi)/(pdi+mdi):0);}if(dx.length<p)return null;let a=dx.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<dx.length;i++)a=(a*(p-1)+dx[i])/p;return a;}
function volumeRatio(c,n=20){if(c.length<n+1)return 1;const v=c.map(x=>x.volume),cur=last(v),base=v.slice(-(n+1),-1).reduce((a,b)=>a+b,0)/n;return base>0?cur/base:1;}
function frameMetrics(c){const closes=c.map(x=>x.close);return{price:last(closes),ema20:last(ema(closes,20)),ema50:last(ema(closes,50)),rsi:rsi(closes),macd:macd(closes),atr:atr(c),adx:adx(c),volumeRatio:volumeRatio(c)};}
function directionalScore(m,side){let s=50,longSide=side==="LONG";if(m.ema20&&m.ema50){s+=(longSide?m.ema20>m.ema50:m.ema20<m.ema50)?12:-12;s+=(longSide?m.price>m.ema20:m.price<m.ema20)?7:-7;}if(m.macd)s+=(longSide?m.macd.hist>0:m.macd.hist<0)?10:-10;if(m.rsi!=null){if(longSide){if(m.rsi>=52&&m.rsi<=72)s+=10;else if(m.rsi>78)s-=9;else if(m.rsi<42)s-=6;}else{if(m.rsi<=48&&m.rsi>=28)s+=10;else if(m.rsi<22)s-=9;else if(m.rsi>58)s-=6;}}if(m.adx!=null)s+=m.adx>=25?7:m.adx<18?-6:0;if(m.volumeRatio>=1.15)s+=5;else if(m.volumeRatio<.65)s-=3;return clamp(Math.round(s),0,100);}
function compact(m){return{price:round(m.price,8),ema20:round(m.ema20,8),ema50:round(m.ema50,8),rsi:round(m.rsi,2),macdHist:round(m.macd?.hist,8),adx:round(m.adx,2),atr:round(m.atr,8),volumeRatio:round(m.volumeRatio,2)};}
function observedRegime(frames){
  const h4=frames?.["4h"]||{},h1=frames?.["1h"]||{};
  const h4Bull=Number(h4.ema20)>Number(h4.ema50)&&Number(h4.price)>Number(h4.ema20);
  const h4Bear=Number(h4.ema20)<Number(h4.ema50)&&Number(h4.price)<Number(h4.ema20);
  const h1Bull=Number(h1.ema20)>Number(h1.ema50);
  const h1Bear=Number(h1.ema20)<Number(h1.ema50);
  const adx=Number(h4.adx);
  if(Number.isFinite(adx)&&adx<18)return"RANGE";
  if(h4Bull&&h1Bull)return"BULL";
  if(h4Bear&&h1Bear)return"BEAR";
  return"TRANSITION";
}
function evidenceSnapshot(signal,position){
  const frames=signal?.frames||{};
  return{
    schemaVersion:"1.0",
    captureVersion:"6.53-EVIDENCE",
    positionId:position.id,
    openedAt:position.openedAt,
    symbol:position.symbol,
    side:position.side,
    ruleset:position.ruleset,
    source:position.source,
    technical:signal.technical??null,
    candidate:signal.candidate??null,
    statusAtEntry:signal.status??"READY",
    entry:round(position.entry,8),
    signalEntry:round(signal.entry,8),
    sl:round(position.sl,8),
    tp1:round(position.tp1,8),
    tp2:round(position.tp2,8),
    atr:round(signal.atr,8),
    entryAnchor:round(signal.entryAnchor,8),
    distanceAtr:signal.distanceAtr??null,
    regime:observedRegime(frames),
    frames:{
      "15m":frames["15m"]||null,
      "1h":frames["1h"]||null,
      "4h":frames["4h"]||null
    },
    configAtEntry:{
      minTechnicalScore:config.minTechnicalScore,
      minCandidateScore:config.minCandidateScore,
      maxEntryDistanceAtr:config.maxEntryDistanceAtr,
      atrStopMult:config.atrStopMult,
      tp1R:config.tp1R,
      tp2R:config.tp2R,
      riskPerTradePct:config.riskPerTradePct
    },
    shadow:{
      ruleset:"6.3-SHADOW",
      executionImpact:false,
      hypotheses:{
        H1_LONG_REGIME:{eligible:position.side!=="LONG"||((signal.technical??0)>=80&&(signal.candidate??0)>=75),note:"Observation only"},
        H2_ENTRY_QUALITY:{distanceAtr:signal.distanceAtr??null,note:"Captured for later outcome correlation"},
        H3_ASSET_QUALITY:{symbol:position.symbol,note:"Captured for rolling asset evidence"},
        H4_DIRECTION_SPLIT:{side:position.side,note:"Captured for Long/Short split"},
        H5_REGIME_LINK:{regime:observedRegime(frames),note:"Captured for outcome-by-regime analysis"}
      }
    }
  };
}

function buildCandidate(symbol,f){const L={m15:directionalScore(f["15m"],"LONG"),h1:directionalScore(f["1h"],"LONG"),h4:directionalScore(f["4h"],"LONG")},S={m15:directionalScore(f["15m"],"SHORT"),h1:directionalScore(f["1h"],"SHORT"),h4:directionalScore(f["4h"],"SHORT")};const w=x=>Math.round(x.m15*.4+x.h1*.35+x.h4*.25),lt=w(L),st=w(S),side=lt>=st?"LONG":"SHORT",technical=Math.max(lt,st),sel=side==="LONG"?L:S;const align=[sel.m15,sel.h1,sel.h4].filter(x=>x>=60).length;let candidate=technical+(align===3?8:align===2?3:-8)+((f["1h"].adx??0)>=25?4:0)+((f["15m"].volumeRatio??1)>=1.1?3:0);candidate=clamp(Math.round(candidate),0,100);const price=f["15m"].price,A=f["15m"].atr||price*.01,anchor=f["15m"].ema20||price,dAtr=A>0?Math.abs(price-anchor)/A:999,entryZoneOk=dAtr<=config.maxEntryDistanceAtr,stop=A*config.atrStopMult,entry=price,sl=side==="LONG"?entry-stop:entry+stop,r=Math.abs(entry-sl),tp1=side==="LONG"?entry+r*config.tp1R:entry-r*config.tp1R,tp2=side==="LONG"?entry+r*config.tp2R:entry-r*config.tp2R;let status="NO_SETUP",reasons=[];if(technical<config.minTechnicalScore)reasons.push("TECH_SCORE_LOW");if(candidate<config.minCandidateScore)reasons.push("CANDIDATE_SCORE_LOW");if(!entryZoneOk)reasons.push("OUTSIDE_ENTRY_ZONE");if(technical>=config.minTechnicalScore&&candidate>=config.minCandidateScore)status=entryZoneOk?"READY":"WAIT_ENTRY_ZONE";return{symbol,side,technical,candidate,status,price,entry,sl,tp1,tp2,atr:A,entryAnchor:anchor,distanceAtr:round(dAtr,3),reasons,frames:{"15m":{score:side==="LONG"?L.m15:S.m15,...compact(f["15m"])},"1h":{score:side==="LONG"?L.h1:S.h1,...compact(f["1h"])},"4h":{score:side==="LONG"?L.h4:S.h4,...compact(f["4h"])}},evaluatedAt:new Date().toISOString(),ruleset:"6.2-SIGNAL-V1"};}
async function analyzeSymbol(symbol){const [a,b,c]=await Promise.all([getKlines(symbol,"15m"),getKlines(symbol,"1h"),getKlines(symbol,"4h")]);return buildCandidate(symbol,{"15m":frameMetrics(a),"1h":frameMetrics(b),"4h":frameMetrics(c)});}

const today=()=>new Date().toISOString().slice(0,10);
async function loadPaperState(){const s=await getState("paper",null);if(s)return rollover(s);const x={account:{startEquity:config.startEquity,cash:config.startEquity,equity:config.startEquity,peakEquity:config.startEquity,dayStartEquity:config.startEquity,dayKey:today(),realizedPnl:0,unrealizedPnl:0},positions:[],trades:[],equityCurve:[{ts:new Date().toISOString(),equity:config.startEquity}],lastSignal:null,updatedAt:new Date().toISOString()};await savePaperState(x);return x;}
function rollover(s){if(s.account.dayKey!==today()){s.account.dayKey=today();s.account.dayStartEquity=s.account.equity;}return s;}
async function savePaperState(s){s.updatedAt=new Date().toISOString();await setState("paper",s);}
function openRisk(p){return p.reduce((a,x)=>a+(Number(x.riskPct)||0),0);}
function riskGate({account,positions,tradesToday,signal}){const r=[];if(!signal||!["LONG","SHORT"].includes(signal.side))r.push("NO_DIRECTION");if(!(Number(signal.entry)>0&&Number(signal.sl)>0))r.push("INVALID_ENTRY_OR_SL");if(positions.length>=config.maxOpenPositions)r.push("MAX_OPEN_POSITIONS");if(tradesToday>=config.maxTradesPerDay)r.push("MAX_TRADES_PER_DAY");const o=openRisk(positions);if(o+config.riskPerTradePct>config.maxPortfolioRiskPct+1e-9)r.push("MAX_PORTFOLIO_RISK");const eq=Number(account.equity||config.startEquity),day=Number(account.dayStartEquity||eq),peak=Number(account.peakEquity||eq),dl=day>0?Math.max(0,(day-eq)/day*100):0,dd=peak>0?Math.max(0,(peak-eq)/peak*100):0;if(dl>=config.maxDailyLossPct)r.push("MAX_DAILY_LOSS");if(dd>=config.maxDrawdownPct)r.push("MAX_DRAWDOWN");return{ok:r.length===0,reasons:r,openRiskPct:o,dailyLossPct:dl,drawdownPct:dd};}
function sizeForRisk({equity,entry,sl}){const d=Math.abs(entry-sl);return d>0?equity*(config.riskPerTradePct/100)/d:0;}
const slip=(p,s,e)=>p*(s==="LONG"?(e?1+config.slippageBps/10000:1-config.slippageBps/10000):(e?1-config.slippageBps/10000:1+config.slippageBps/10000));
function openPaperPosition({signal,account}){const entry=slip(+signal.entry,signal.side,true),qty=sizeForRisk({equity:account.equity,entry,sl:+signal.sl});if(!(qty>0))throw new Error("position size <=0");const fee=qty*entry*config.feeBps/10000;const p={id:crypto.randomUUID(),symbol:signal.symbol,side:signal.side,status:"OPEN",entry,qty,sl:+signal.sl,tp1:+signal.tp1||null,tp2:+signal.tp2||null,openedAt:new Date().toISOString(),riskPct:config.riskPerTradePct,feeOpen:fee,source:signal.source||"MERIDIAN-6.2",ruleset:signal.ruleset||"6.2-SIGNAL-V1",technical:signal.technical??null,candidate:signal.candidate??null,distanceAtr:signal.distanceAtr??null};p.evidenceSnapshot=evidenceSnapshot(signal,p);return p;}
function markPosition(p,price){const d=p.side==="LONG"?1:-1,g=(price-p.entry)*p.qty*d,closeFee=price*p.qty*config.feeBps/10000;return{...p,livePrice:price,unrealized:g-p.feeOpen-closeFee};}
function exitReason(p,x){if(p.side==="LONG"){if(x<=p.sl)return"SL";if(p.tp2&&x>=p.tp2)return"TP2";if(p.tp1&&x>=p.tp1)return"TP1";}else{if(x>=p.sl)return"SL";if(p.tp2&&x<=p.tp2)return"TP2";if(p.tp1&&x<=p.tp1)return"TP1";}return null;}
function closePaperPosition(p,x,reason){const exit=slip(x,p.side,false),d=p.side==="LONG"?1:-1,g=(exit-p.entry)*p.qty*d,fee=exit*p.qty*config.feeBps/10000;return{...p,status:"CLOSED",exit,closedAt:new Date().toISOString(),exitReason:reason,realized:g-p.feeOpen-fee,feeClose:fee};}

let running=false,timer=null,signalTimer=null;let status={version:"6.2.0",startedAt:null,lastCycleAt:null,lastSignalScanAt:null,lastGoodMarketAt:null,cycles:0,signalScans:0,errors:0,marketErrors:[],signalErrors:[],state:"BOOTING"};let scannerCache={updatedAt:null,assets:[],readyCount:0};
function dayTradeCount(s){const d=today();return s.trades.filter(t=>(t.openedAt||"").startsWith(d)).length;}
async function submitSignal(signal){const s=rollover(await loadPaperState()),n={...signal,symbol:String(signal.symbol||"").toUpperCase(),side:String(signal.side||"").toUpperCase(),entry:+signal.entry,sl:+signal.sl,tp1:signal.tp1==null?null:+signal.tp1,tp2:signal.tp2==null?null:+signal.tp2,source:signal.source||"MERIDIAN-6.2-AUTO",ruleset:signal.ruleset||"6.2-SIGNAL-V1"};if(!config.symbols.includes(n.symbol))return{accepted:false,reasons:["SYMBOL_NOT_ALLOWED"]};if(s.positions.some(p=>p.status==="OPEN"&&p.symbol===n.symbol))return{accepted:false,reasons:["SAME_SYMBOL_POSITION_OPEN"]};const cutoff=Date.now()-config.cooldownMinutes*60000;if(s.trades.some(t=>t.symbol===n.symbol&&new Date(t.closedAt||t.openedAt||0).getTime()>=cutoff))return{accepted:false,reasons:["SYMBOL_COOLDOWN"]};const gate=riskGate({account:s.account,positions:s.positions.filter(p=>p.status==="OPEN"),tradesToday:dayTradeCount(s),signal:n});s.lastSignal={...n,receivedAt:new Date().toISOString(),gate};if(!gate.ok){await savePaperState(s);await addEvent("SIGNAL_REJECTED",s.lastSignal);return{accepted:false,reasons:gate.reasons,gate};}const p=openPaperPosition({signal:n,account:s.account});s.positions.push(p);s.account.cash-=p.feeOpen;s.account.realizedPnl-=p.feeOpen;await savePaperState(s);await addEvent("POSITION_OPENED",p);
try{await saveEvidence(p.evidenceSnapshot);await addEvent("POSITION_EVIDENCE_CAPTURED",{positionId:p.id,symbol:p.symbol,side:p.side,technical:p.technical,candidate:p.candidate,distanceAtr:p.distanceAtr,regime:p.evidenceSnapshot?.regime,captureVersion:"6.53-EVIDENCE"});}catch(e){await addEvent("EVIDENCE_CAPTURE_ERROR",{positionId:p.id,message:String(e?.message||e)}).catch(()=>{});}
return{accepted:true,position:p,gate};}
async function signalScan(){const errors=[],candidates=[];try{for(const symbol of config.symbols){try{candidates.push(await analyzeSymbol(symbol));}catch(e){errors.push({symbol,error:String(e?.message||e)});}}candidates.sort((a,b)=>b.candidate-a.candidate);scannerCache={updatedAt:new Date().toISOString(),assets:candidates,readyCount:candidates.filter(c=>c.status==="READY").length};await setState("scanner",scannerCache);try{await observeShadowV1Scan(candidates);}catch(e){await addEvent("SHADOW_V1_ERROR",{stage:"observe",message:String(e?.message||e)}).catch(()=>{});}const ready=candidates.filter(c=>c.status==="READY");if(ready.length)await addEvent("SIGNAL_SCAN_READY",{assets:ready.map(x=>({symbol:x.symbol,side:x.side,technical:x.technical,candidate:x.candidate,price:x.price,status:x.status}))});for(const c of ready){const r=await submitSignal({...c,source:"MERIDIAN-6.2-AUTO"});try{await submitShadowV1({...c,source:"MERIDIAN-SHADOW-V1"});}catch(e){await addEvent("SHADOW_V1_ERROR",{stage:"signal",message:String(e?.message||e)}).catch(()=>{});}if(!r.accepted&&r.reasons?.includes("MAX_OPEN_POSITIONS"))break;}status.lastSignalScanAt=new Date().toISOString();status.signalScans++;status.signalErrors=errors;}catch(e){status.errors++;status.signalErrors=[{error:String(e?.message||e)}];await addEvent("SIGNAL_ENGINE_ERROR",{message:String(e?.message||e)}).catch(()=>{});}}
async function cycle(){try{let s=rollover(await loadPaperState());const m=await getMarketSnapshot(config.symbols);status.marketErrors=m.errors;if(!Object.keys(m.quotes).length)throw new Error("No market quotes");status.lastGoodMarketAt=new Date().toISOString();const next=[],closed=[];let unreal=0;for(const p of s.positions){if(p.status!=="OPEN")continue;const q=m.quotes[p.symbol];if(!q||Date.now()-q.ts>config.marketStaleMs){next.push(p);continue;}const marked=markPosition(p,q.price),reason=exitReason(marked,q.price);if(reason){const done=closePaperPosition(marked,q.price,reason);s.account.cash+=done.realized+p.feeOpen;s.account.realizedPnl+=done.realized+p.feeOpen;s.trades.push(done);closed.push(done);}else{unreal+=marked.unrealized;next.push(marked);}}s.positions=next;s.account.unrealizedPnl=unreal;s.account.equity=s.account.cash+unreal;s.account.peakEquity=Math.max(s.account.peakEquity||s.account.equity,s.account.equity);const le=last(s.equityCurve);if(!le||Date.now()-new Date(le.ts).getTime()>=60000){s.equityCurve.push({ts:new Date().toISOString(),equity:s.account.equity});if(s.equityCurve.length>50000)s.equityCurve=s.equityCurve.slice(-50000);}await savePaperState(s);try{await shadowV1Cycle(m);}catch(e){await addEvent("SHADOW_V1_ERROR",{stage:"cycle",message:String(e?.message||e)}).catch(()=>{});}for(const c of closed){await addEvent("POSITION_CLOSED",c);try{await closeEvidence(c.id,{closedAt:c.closedAt,exitReason:c.exitReason,exit:round(c.exit,8),realized:round(c.realized,8),side:c.side,symbol:c.symbol,ruleset:c.ruleset});await addEvent("POSITION_EVIDENCE_RESULT",{positionId:c.id,symbol:c.symbol,side:c.side,exitReason:c.exitReason,realized:round(c.realized,8)});}catch(e){await addEvent("EVIDENCE_RESULT_ERROR",{positionId:c.id,message:String(e?.message||e)}).catch(()=>{});}}status.state="RUNNING";status.lastCycleAt=new Date().toISOString();status.cycles++;}catch(e){status.errors++;status.state="DEGRADED";status.lastCycleAt=new Date().toISOString();await addEvent("ENGINE_ERROR",{message:String(e?.message||e),at:status.lastCycleAt}).catch(()=>{});}}
async function startEngine(){if(running)return;running=true;status.startedAt=new Date().toISOString();scannerCache=await getState("scanner",scannerCache);await cycle();await signalScan();timer=setInterval(cycle,config.intervalMs);signalTimer=setInterval(signalScan,config.signalIntervalMs);timer.unref?.();signalTimer.unref?.();}
function engineStatus(){const t=status.lastGoodMarketAt?new Date(status.lastGoodMarketAt).getTime():0;return{...status,running,marketFresh:!!t&&Date.now()-t<=config.marketStaleMs,intervalMs:config.intervalMs,signalIntervalMs:config.signalIntervalMs};}


async function assistantStatus(){
  const [paper, evidence, events, db, shadowV1] = await Promise.all([
    loadPaperState(),
    recentEvidence(100),
    recentEvents(25),
    dbPing(),
    shadowV1Status()
  ]);
  const eng=engineStatus();
  const acct=paper?.account||{};
  const positions=(paper?.positions||[]).filter(p=>p.status==="OPEN").map(p=>({
    id:p.id,symbol:p.symbol,side:p.side,status:p.status,entry:round(p.entry,8),livePrice:round(p.livePrice,8),
    sl:round(p.sl,8),tp1:round(p.tp1,8),tp2:round(p.tp2,8),openedAt:p.openedAt,riskPct:p.riskPct,
    unrealized:round(p.unrealized,2),technical:p.technical??null,candidate:p.candidate??null,ruleset:p.ruleset
  }));
  const closed=(paper?.trades||[]).slice(-25).reverse().map(t=>({
    symbol:t.symbol,side:t.side,entry:round(t.entry,8),exit:round(t.exit,8),openedAt:t.openedAt,closedAt:t.closedAt,
    exitReason:t.exitReason,realized:round(t.realized,2),technical:t.technical??null,candidate:t.candidate??null,ruleset:t.ruleset
  }));
  const ev=(evidence||[]);
  const outcomes=ev.filter(x=>x?.closed_at||x?.closedAt||x?.outcome||x?.realized_pnl!=null||x?.realizedPnl!=null);
  const realized=outcomes.reduce((a,x)=>a+Number(x?.realized_pnl??x?.realizedPnl??x?.result?.realizedPnl??0),0);
  return {
    publicReadOnly:true,
    generatedAt:new Date().toISOString(),
    app:"ACHI MERIDIAN Paperbot",
    apiVersion:"6.54-PUBLIC-STATUS",
    engine:{...eng,version:"6.2.0",ruleset:"6.2-SIGNAL-V1"},
    health:{ok:!!(db.ok&&eng.running&&eng.marketFresh),db},
    safety:{paperTrading:config.paperTrading,liveTrading:config.liveTrading},
    paper:{
      account:{startEquity:round(acct.startEquity,2),cash:round(acct.cash,2),equity:round(acct.equity,2),peakEquity:round(acct.peakEquity,2),realizedPnl:round(acct.realizedPnl,2),unrealizedPnl:round(acct.unrealizedPnl,2)},
      openPositions:positions,openCount:positions.length,closedCount:(paper?.trades||[]).length,recentClosed:closed
    },
    scanner:{updatedAt:scannerCache.updatedAt,readyCount:scannerCache.readyCount,assets:scannerCache.assets.map(a=>({symbol:a.symbol,side:a.side,technical:a.technical,candidate:a.candidate,status:a.status,price:round(a.price,8),distanceAtr:a.distanceAtr}))},
    evidence:{captureVersion:"6.53-EVIDENCE",captured:ev.length,outcomes:outcomes.length,realized:round(realized,2),latest:ev.slice(0,20)},
    shadowV1,
    events:(events||[]).slice(0,20)
  };
}

const PORT=Number(process.env.PORT||10000);
function send(res,code,body){const p=JSON.stringify(body);res.writeHead(code,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(p),"cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"content-type, authorization","access-control-allow-methods":"GET,POST,OPTIONS"});res.end(p);}
async function bodyJson(req){let raw="";for await(const c of req){raw+=c;if(raw.length>64000)throw new Error("body too large");}return raw?JSON.parse(raw):{};}
function authorized(req){return !!config.ingestToken&&(req.headers.authorization||"")===`Bearer ${config.ingestToken}`;}


// MERIDIAN SHADOW V1 — research-only parallel paper ledger. Baseline 6.2 remains unchanged.
const SHADOW_V1_KEY="shadow_v1";
const SHADOW_V1_RULESET="6.98-SHADOW-V1";
const SHADOW_V1_START=10000;
const SHADOW_V1_MIN_TECH=75;
const SHADOW_V1_MIN_CAND=70;
async function loadShadowV1(){
  const z=await getState(SHADOW_V1_KEY,null);
  if(z)return rollover(z);
  const x={account:{startEquity:SHADOW_V1_START,cash:SHADOW_V1_START,equity:SHADOW_V1_START,peakEquity:SHADOW_V1_START,dayStartEquity:SHADOW_V1_START,dayKey:today(),realizedPnl:0,unrealizedPnl:0},positions:[],trades:[],equityCurve:[{ts:new Date().toISOString(),equity:SHADOW_V1_START}],lastSignal:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),ruleset:SHADOW_V1_RULESET};
  await saveShadowV1(x);return x;
}
async function saveShadowV1(x){x.updatedAt=new Date().toISOString();await setState(SHADOW_V1_KEY,x);}
function shadowRegime(signal){try{return observedRegime(signal.frames||{});}catch{return "TRANSITION";}}
function shadowRuleGate(signal){
  const reasons=[]; const regime=shadowRegime(signal);
  if(Number(signal.technical||0)<SHADOW_V1_MIN_TECH)reasons.push("SHADOW_TECH_LT_75");
  if(Number(signal.candidate||0)<SHADOW_V1_MIN_CAND)reasons.push("SHADOW_CAND_LT_70");
  if(regime==="TRANSITION")reasons.push("SHADOW_BLOCK_TRANSITION");
  if(signal.side==="LONG"&&regime!=="BULL")reasons.push("SHADOW_LONG_ONLY_BULL");
  if(signal.side==="SHORT"&&!['BEAR','RANGE'].includes(regime))reasons.push("SHADOW_SHORT_ONLY_BEAR_RANGE");
  return {ok:reasons.length===0,reasons,regime,technical:Number(signal.technical||0),candidate:Number(signal.candidate||0)};
}
function shadowDecision(signal){
  const rule=shadowRuleGate(signal), reasons=[...rule.reasons];
  if(signal.status!=="READY") reasons.unshift(signal.status==="WAIT_ENTRY_ZONE"?"WAIT_ENTRY_ZONE":"BASE_NOT_READY");
  const decision=reasons.length?((reasons[0]==="WAIT_ENTRY_ZONE")?"WAIT":"BLOCK"):"ELIGIBLE";
  return {symbol:String(signal.symbol||"").toUpperCase(),side:String(signal.side||"").toUpperCase(),status:signal.status||null,decision,reasons,technical:Number(signal.technical||0),candidate:Number(signal.candidate||0),distanceAtr:Number(signal.distanceAtr||0),maxEntryDistanceAtr:config.maxEntryDistanceAtr,regime:rule.regime,evaluatedAt:new Date().toISOString(),baselineGateIndependent:true};
}
async function observeShadowV1Scan(candidates){
  const s=rollover(await loadShadowV1());
  const obs=(candidates||[]).map(shadowDecision);
  s.lastEvaluations=obs.slice(0,10);
  s.lastDecision=obs[0]||null;
  s.lastScanAt=new Date().toISOString();
  await saveShadowV1(s);
  return obs;
}
async function submitShadowV1(signal){
  const rule=shadowRuleGate(signal);
  const s=rollover(await loadShadowV1());
  const n={...signal,symbol:String(signal.symbol||"").toUpperCase(),side:String(signal.side||"").toUpperCase(),entry:+signal.entry,sl:+signal.sl,tp1:signal.tp1==null?null:+signal.tp1,tp2:signal.tp2==null?null:+signal.tp2,source:"MERIDIAN-SHADOW-V1",ruleset:SHADOW_V1_RULESET,shadowRegime:rule.regime};
  s.lastSignal={...n,receivedAt:new Date().toISOString(),shadowRule:rule};
  if(n.status!=="READY"){const reasons=[n.status==="WAIT_ENTRY_ZONE"?"WAIT_ENTRY_ZONE":"BASE_NOT_READY"];s.lastSignal.decision="WAIT";s.lastSignal.reasons=reasons;await saveShadowV1(s);return {accepted:false,reasons,shadowRule:rule};}
  if(!rule.ok){s.lastSignal.decision="BLOCK";s.lastSignal.reasons=rule.reasons;await saveShadowV1(s);return {accepted:false,reasons:rule.reasons,shadowRule:rule};}
  if(s.positions.some(p=>p.status==="OPEN"&&p.symbol===n.symbol))return {accepted:false,reasons:["SAME_SYMBOL_POSITION_OPEN"]};
  const cutoff=Date.now()-config.cooldownMinutes*60000;
  if(s.trades.some(t=>t.symbol===n.symbol&&new Date(t.closedAt||t.openedAt||0).getTime()>=cutoff))return {accepted:false,reasons:["SYMBOL_COOLDOWN"]};
  const gate=riskGate({account:s.account,positions:s.positions.filter(p=>p.status==="OPEN"),tradesToday:dayTradeCount(s),signal:n});
  if(!gate.ok){s.lastSignal.gate=gate;await saveShadowV1(s);return {accepted:false,reasons:gate.reasons,gate,shadowRule:rule};}
  const p=openPaperPosition({signal:n,account:s.account}); p.shadowRegime=rule.regime; p.ruleset=SHADOW_V1_RULESET;
  s.positions.push(p); s.account.cash-=p.feeOpen; s.account.realizedPnl-=p.feeOpen; s.lastSignal.decision="ENTER";s.lastSignal.reasons=[]; await saveShadowV1(s);
  await addEvent("SHADOW_V1_POSITION_OPENED",{id:p.id,symbol:p.symbol,side:p.side,regime:p.shadowRegime,technical:p.technical,candidate:p.candidate,entry:p.entry,sl:p.sl,tp1:p.tp1});
  return {accepted:true,position:p,gate,shadowRule:rule};
}
async function shadowV1Cycle(m){
  let s=rollover(await loadShadowV1()); const next=[],closed=[]; let unreal=0;
  for(const p of s.positions){
    if(p.status!=="OPEN")continue; const q=m.quotes[p.symbol];
    if(!q||Date.now()-q.ts>config.marketStaleMs){next.push(p);continue;}
    const marked=markPosition(p,q.price),reason=exitReason(marked,q.price);
    if(reason){const done=closePaperPosition(marked,q.price,reason);done.ruleset=SHADOW_V1_RULESET;done.shadowRegime=p.shadowRegime||null;s.account.cash+=done.realized+p.feeOpen;s.account.realizedPnl+=done.realized+p.feeOpen;s.trades.push(done);closed.push(done);}else{unreal+=marked.unrealized;next.push(marked);}
  }
  s.positions=next;s.account.unrealizedPnl=unreal;s.account.equity=s.account.cash+unreal;s.account.peakEquity=Math.max(s.account.peakEquity||s.account.equity,s.account.equity);
  const le=last(s.equityCurve);if(!le||Date.now()-new Date(le.ts).getTime()>=60000){s.equityCurve.push({ts:new Date().toISOString(),equity:s.account.equity});if(s.equityCurve.length>50000)s.equityCurve=s.equityCurve.slice(-50000);}
  await saveShadowV1(s); for(const c of closed)await addEvent("SHADOW_V1_POSITION_CLOSED",{symbol:c.symbol,side:c.side,regime:c.shadowRegime,realized:round(c.realized,2),exitReason:c.exitReason});
}
async function shadowV1Status(){
  const s=await loadShadowV1(), a=s.account||{}, tr=s.trades||[], op=(s.positions||[]).filter(x=>x.status==="OPEN");
  const wins=tr.filter(x=>Number(x.realized)>0),losses=tr.filter(x=>Number(x.realized)<0),gp=wins.reduce((q,x)=>q+Number(x.realized||0),0),gl=Math.abs(losses.reduce((q,x)=>q+Number(x.realized||0),0));
  const peak=Number(a.peakEquity||a.equity||SHADOW_V1_START),eq=Number(a.equity||SHADOW_V1_START),dd=peak>0?Math.max(0,(peak-eq)/peak*100):0;
  return {enabled:true,researchOnly:true,independentLedger:true,baselineRiskGateIgnored:true,ruleset:SHADOW_V1_RULESET,filters:{minTechnical:SHADOW_V1_MIN_TECH,minCandidate:SHADOW_V1_MIN_CAND,longRegime:"BULL",shortRegimes:["BEAR","RANGE"],blockRegime:"TRANSITION",maxEntryDistanceAtr:config.maxEntryDistanceAtr},account:{startEquity:round(a.startEquity,2),cash:round(a.cash,2),equity:round(eq,2),peakEquity:round(peak,2),realizedPnl:round(a.realizedPnl,2),unrealizedPnl:round(a.unrealizedPnl,2),drawdownPct:round(dd,2)},openPositions:op,openCount:op.length,closedCount:tr.length,winRate:tr.length?round(wins.length/tr.length*100,1):0,profitFactor:gl>0?round(gp/gl,2):(gp>0?99:0),recentClosed:tr.slice(-12).reverse(),lastSignal:s.lastSignal||null,lastDecision:s.lastDecision||null,lastEvaluations:s.lastEvaluations||[],lastScanAt:s.lastScanAt||null,updatedAt:s.updatedAt};
}

// MERIDIAN v6.88 — persistent Cloud Backtest Jobs (research-only)
let cloudBtBusy=false;
const CLOUD_BT_ASSETS=["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","SUIUSDT","ADAUSDT","LINKUSDT","AVAXUSDT","DOGEUSDT","NEARUSDT"];
async function btJobPut(job){
  if(!pool){memory.backtestJobs=memory.backtestJobs||{};memory.backtestJobs[job.id]=job;return;}
  await pool.query(`INSERT INTO meridian_backtest_jobs(id,status,request,progress,result,error,created_at,started_at,finished_at,updated_at)
    VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,COALESCE($7,now()),$8,$9,now())
    ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,progress=EXCLUDED.progress,result=EXCLUDED.result,error=EXCLUDED.error,started_at=COALESCE(EXCLUDED.started_at,meridian_backtest_jobs.started_at),finished_at=EXCLUDED.finished_at,updated_at=now()`,
    [job.id,job.status,JSON.stringify(job.request||{}),JSON.stringify(job.progress||{}),job.result?JSON.stringify(job.result):null,job.error||null,job.createdAt||null,job.startedAt||null,job.finishedAt||null]);
}
async function btJobGet(id){
  if(!pool)return memory.backtestJobs?.[id]||null;
  const r=await pool.query(`SELECT id,status,request,progress,result,error,created_at,started_at,finished_at,updated_at FROM meridian_backtest_jobs WHERE id=$1`,[id]);
  return r.rows[0]||null;
}
async function btJobLatest(){
  if(!pool){const a=Object.values(memory.backtestJobs||{});return a.sort((x,y)=>new Date(y.createdAt)-new Date(x.createdAt))[0]||null;}
  const r=await pool.query(`SELECT id,status,request,progress,result,error,created_at,started_at,finished_at,updated_at FROM meridian_backtest_jobs ORDER BY created_at DESC LIMIT 1`);
  return r.rows[0]||null;
}
async function runBtJob(job){
  if(cloudBtBusy)return;
  cloudBtBusy=true;
  try{
    job.status='RUNNING';job.startedAt=new Date().toISOString();job.progress={stage:'starting',pct:0};await btJobPut(job);
    const result=await runCloudBacktest({...job.request,onProgress:async p=>{job.progress=p;try{await btJobPut(job)}catch{}}});
    job.status='DONE';job.progress={stage:'done',pct:100};job.result=result;job.finishedAt=new Date().toISOString();await btJobPut(job);
    await addEvent('CLOUD_BACKTEST_DONE',{jobId:job.id,days:job.request.days,assets:job.request.assets?.length||0,trades:result?.summary?.trades||0,pnl:round(result?.summary?.pnl,2),pf:round(result?.summary?.pf,2)});
  }catch(e){job.status='ERROR';job.error=String(e?.message||e);job.finishedAt=new Date().toISOString();await btJobPut(job).catch(()=>{});await addEvent('CLOUD_BACKTEST_ERROR',{jobId:job.id,error:job.error}).catch(()=>{});}
  finally{cloudBtBusy=false;}
}
async function createBtJob(payload){
  const days=Math.max(7,Math.min(365,Math.floor(Number(payload?.days)||90)));
  const requested=Array.isArray(payload?.assets)?payload.assets.map(x=>String(x).toUpperCase()).filter(x=>CLOUD_BT_ASSETS.includes(x)):CLOUD_BT_ASSETS;
  const assets=requested.length?requested:CLOUD_BT_ASSETS;
  const job={id:crypto.randomUUID(),status:'QUEUED',request:{days,assets,end:Date.now()},progress:{stage:'queued',pct:0},createdAt:new Date().toISOString(),result:null,error:null};
  await btJobPut(job);setTimeout(()=>runBtJob(job),25);return job;
}
const server=http.createServer(async(req,res)=>{try{if(req.method==="OPTIONS")return send(res,204,{});const u=new URL(req.url,`http://${req.headers.host||"localhost"}`);if(req.method==="GET"&&u.pathname==="/")return send(res,200,{app:"ACHI MERIDIAN Paperbot",version:"6.2.0",mode:"PAPER_ONLY",liveTrading:false,db:dbMode(),signalEngine:"AUTO",symbols:config.symbols,endpoints:["/health","/api/status","/api/paper","/api/events","/api/signals","/api/evidence","/api/public-status","/api/assistant","/api/backtests/latest","/api/backtests/:id","/api/shadow-v1"]});if(req.method==="GET"&&u.pathname==="/health"){const db=await dbPing(),eng=engineStatus(),ok=db.ok&&eng.running&&eng.marketFresh;return send(res,ok?200:503,{ok,db,engine:eng,mode:"PAPER_ONLY"});}if(req.method==="GET"&&u.pathname==="/api/status")return send(res,200,{engine:engineStatus(),db:await dbPing(),safety:{paperTrading:config.paperTrading,liveTrading:config.liveTrading},evidenceCapture:{version:"6.53-EVIDENCE",enabled:true,executionImpact:false,storage:dbMode()},scanner:{updatedAt:scannerCache.updatedAt,readyCount:scannerCache.readyCount,assets:scannerCache.assets.map(a=>({symbol:a.symbol,side:a.side,technical:a.technical,candidate:a.candidate,status:a.status,price:a.price,distanceAtr:a.distanceAtr}))}});if(req.method==="GET"&&u.pathname==="/api/signals")return send(res,200,scannerCache);if(req.method==="GET"&&u.pathname==="/api/shadow-v1")return send(res,200,await shadowV1Status());if(req.method==="GET"&&u.pathname==="/api/paper")return send(res,200,await loadPaperState());if(req.method==="GET"&&u.pathname==="/api/events")return send(res,200,await recentEvents(+u.searchParams.get("limit")||100));if(req.method==="GET"&&u.pathname==="/api/evidence")return send(res,200,{captureVersion:"6.53-EVIDENCE",executionImpact:false,items:await recentEvidence(+u.searchParams.get("limit")||100)});if(req.method==="GET"&&(u.pathname==="/api/public-status"||u.pathname==="/api/assistant"))return send(res,200,await assistantStatus());if(req.method==="GET"&&u.pathname==="/api/backtests/latest")return send(res,200,(await btJobLatest())||{status:"NONE"});if(req.method==="GET"&&u.pathname.startsWith("/api/backtests/")){const id=u.pathname.split("/").pop();const j=await btJobGet(id);return j?send(res,200,j):send(res,404,{error:"backtest job not found"});}if(req.method==="POST"&&u.pathname==="/api/backtests"){const j=await createBtJob(await bodyJson(req));return send(res,202,{id:j.id,status:j.status,request:j.request,progress:j.progress});}if(req.method==="POST"&&u.pathname==="/api/paper/signal"){if(!authorized(req))return send(res,401,{error:"unauthorized"});const r=await submitSignal(await bodyJson(req));return send(res,r.accepted?201:409,r);}return send(res,404,{error:"not found"});}catch(e){return send(res,500,{error:String(e?.message||e)});}});
await initDb();await startEngine();server.listen(PORT,"0.0.0.0",()=>{console.log(`ACHI MERIDIAN 6.2 listening on :${PORT}`);console.log("PAPER ONLY / AUTO SIGNAL ENGINE ACTIVE");});

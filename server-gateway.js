import http from "node:http";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import pg from "pg";
import { researchComparison } from "./research-analytics.js";
import { mergePrivateDashboard, privateDashboardPublicReceipt } from "./private-dashboard-update.js";

const { Pool } = pg;
const RELEASE=JSON.parse(await fs.readFile(new URL("./version.json",import.meta.url),"utf8"));
const DEPLOYMENT_SHA=String(process.env.NF_DEPLOYMENT_SHA||process.env.GITHUB_SHA||"").trim();
const EXTERNAL_PORT = Number(process.env.PORT || 10000);
const INTERNAL_PORT = Number(process.env.MERIDIAN_INTERNAL_PORT || (EXTERNAL_PORT + 1));
const READ_TOKEN_HASH = String(process.env.MERIDIAN_READ_TOKEN_SHA256 || "bd92c80bb4a43ea04788f2ee21591bad56052c5d609696402357597a43cbe4bc").trim().toLowerCase();
const WRITE_TOKEN_HASH = String(process.env.MERIDIAN_WRITE_TOKEN_SHA256 || "").trim().toLowerCase();
const ALLOWED_ORIGINS = new Set(
  String(process.env.MERIDIAN_ALLOWED_ORIGINS || "https://achi1984.github.io,http://localhost:3000,http://127.0.0.1:3000")
    .split(",").map(x=>x.trim()).filter(Boolean)
);
const PRIVATE_STATE_KEY = "private_dashboard_v1";
const DATABASE_URL = process.env.DATABASE_URL || "";
const PUBLIC_PATHS = new Set(["/","/health","/api/public-status","/api/assistant"]);
const PROTECTED_PREFIXES = [
  "/api/status","/api/paper","/api/events","/api/signals","/api/evidence",
  "/api/shadow-v1","/api/challenger-v2","/api/regime-v1","/api/backtests","/api/activity-summary","/api/research-analytics",
  "/api/private/"
];

function sha256(v){return crypto.createHash("sha256").update(String(v)).digest("hex");}
function bearer(req){
  const h=String(req.headers.authorization||"");
  return h.startsWith("Bearer ")?h.slice(7).trim():"";
}
function hashAuthorized(token,expectedHash){
  if(!token||!/^[a-f0-9]{64}$/.test(expectedHash))return false;
  return crypto.timingSafeEqual(Buffer.from(sha256(token),"hex"),Buffer.from(expectedHash,"hex"));
}
function authorizedRead(req){return hashAuthorized(bearer(req),READ_TOKEN_HASH);}
function writeToken(req){return String(req.headers["x-meridian-write-token"]||"").trim();}
function authorizedWrite(req){return hashAuthorized(writeToken(req),WRITE_TOKEN_HASH);}
function isProtected(pathname){
  return PROTECTED_PREFIXES.some(p=>pathname===p || pathname.startsWith(p.endsWith("/")?p:p+"/"));
}
function allowOrigin(req){
  const origin=String(req.headers.origin||"");
  if(!origin)return "";
  return ALLOWED_ORIGINS.has(origin)?origin:null;
}
function writeJson(res,code,body,origin=""){
  const raw=JSON.stringify(body);
  const h={
    "content-type":"application/json; charset=utf-8",
    "content-length":Buffer.byteLength(raw),
    "cache-control":"no-store",
    "vary":"Origin",
    "x-content-type-options":"nosniff"
  };
  if(origin)h["access-control-allow-origin"]=origin;
  res.writeHead(code,h);res.end(raw);
}
function corsPreflight(req,res,origin){
  if(origin===null)return writeJson(res,403,{error:"origin_not_allowed"});
  res.writeHead(204,{
    ...(origin?{"access-control-allow-origin":origin}:{}),
    "access-control-allow-headers":"content-type, authorization, x-meridian-write-token",
    "access-control-allow-methods":"GET,POST,OPTIONS",
    "access-control-max-age":"600",
    "vary":"Origin"
  });res.end();
}
async function readJsonBody(req,maxBytes=131072){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>maxBytes){const e=new Error("request_body_too_large");e.code="BODY_TOO_LARGE";throw e;}
    chunks.push(chunk);
  }
  if(!chunks.length)return {};
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
  catch(_e){const e=new Error("invalid_json");e.code="INVALID_JSON";throw e;}
}

let privatePool=null;
function pool(){
  if(!DATABASE_URL)return null;
  if(!privatePool)privatePool=new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false}});
  return privatePool;
}
async function stateGet(key){
  const p=pool(); if(!p)return null;
  const r=await p.query("SELECT value FROM meridian_state WHERE key=$1",[key]);
  return r.rows[0]?.value??null;
}
async function stateSet(key,value){
  const p=pool(); if(!p)return false;
  await p.query(`INSERT INTO meridian_state(key,value,updated_at)
    VALUES($1,$2::jsonb,now())
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[key,JSON.stringify(value)]);
  return true;
}
function looksPrivateDashboard(x){
  return !!x && typeof x==="object" &&
    (Array.isArray(x?.portfolio?.holdings) && x.portfolio.holdings.length>0 ||
     Array.isArray(x?.pionexRisk?.bots) && x.pionexRisk.bots.length>0);
}
async function migrateStaticDashboardOnce(){
  if(!pool())return {ok:false,reason:"no_database"};
  const existing=await stateGet(PRIVATE_STATE_KEY);
  if(existing)return {ok:true,migrated:false,reason:"already_present"};
  try{
    const raw=await fs.readFile(new URL("./data.json",import.meta.url),"utf8");
    const data=JSON.parse(raw);
    if(!looksPrivateDashboard(data))return {ok:false,reason:"static_data_not_private_or_already_scrubbed"};
    await stateSet(PRIVATE_STATE_KEY,{...data,privateStorageVersion:"1",migratedAt:new Date().toISOString()});
    return {ok:true,migrated:true};
  }catch(e){return {ok:false,reason:String(e?.message||e)};}
}
async function activitySummary(){
  const p=pool();
  const defs={
    baseline:["POSITION_OPENED","POSITION_CLOSED"],
    shadow:["SHADOW_V1_POSITION_OPENED","SHADOW_V1_POSITION_CLOSED"],
    challenger:["CHALLENGER_V2_POSITION_OPENED","CHALLENGER_V2_POSITION_CLOSED"],
    regime:["REGIME_V1_POSITION_OPENED","REGIME_V1_POSITION_CLOSED"]
  };
  if(!p){
    return {coverageComplete:false,source:"NO_DATABASE",generatedAt:new Date().toISOString(),ledgers:{}};
  }
  const out={};
  for(const [key,[openType,closeType]] of Object.entries(defs)){
    const r=await p.query(`
      SELECT
        min(created_at) FILTER (WHERE type=$1 OR type=$2) AS first_event,
        max(created_at) FILTER (WHERE type=$1 OR type=$2) AS last_event,
        count(*) FILTER (WHERE type=$1)::int AS opened,
        count(*) FILTER (WHERE type=$2)::int AS closed,
        count(*) FILTER (WHERE type=$2 AND created_at>=now()-interval '7 days')::int AS closed_7d,
        count(DISTINCT (created_at AT TIME ZONE 'UTC')::date) FILTER (WHERE type=$1 OR type=$2)::int AS active_days
      FROM meridian_events WHERE type=$1 OR type=$2`,[openType,closeType]);
    const q=r.rows[0]||{};
    out[key]={
      firstEvent:q.first_event||null,lastEvent:q.last_event||null,
      opened:Number(q.opened||0),closed:Number(q.closed||0),closed7d:Number(q.closed_7d||0),
      activeDays:Number(q.active_days||0)
    };
  }
  const starts=Object.values(out).map(x=>x.firstEvent?Date.parse(x.firstEvent):NaN).filter(Number.isFinite);
  const ends=Object.values(out).map(x=>x.lastEvent?Date.parse(x.lastEvent):NaN).filter(Number.isFinite);
  const commonStart=starts.length===Object.keys(defs).length?Math.max(...starts):null;
  const commonEnd=ends.length===Object.keys(defs).length?Math.min(...ends):null;
  const common={};
  if(Number.isFinite(commonStart)&&Number.isFinite(commonEnd)&&commonEnd>commonStart){
    for(const [key,[openType,closeType]] of Object.entries(defs)){
      const r=await p.query(`
        SELECT
          count(*) FILTER (WHERE type=$1)::int AS opened,
          count(*) FILTER (WHERE type=$2)::int AS closed,
          count(*) FILTER (WHERE type=$2 AND created_at>=GREATEST(to_timestamp($3/1000.0),to_timestamp($4/1000.0)-interval '7 days'))::int AS closed_7d,
          count(DISTINCT (created_at AT TIME ZONE 'UTC')::date) FILTER (WHERE type=$1 OR type=$2)::int AS active_days
        FROM meridian_events
        WHERE (type=$1 OR type=$2) AND created_at>=to_timestamp($3/1000.0) AND created_at<=to_timestamp($4/1000.0)`,
        [openType,closeType,commonStart,commonEnd]);
      const q=r.rows[0]||{};
      common[key]={opened:Number(q.opened||0),closed:Number(q.closed||0),closed7d:Number(q.closed_7d||0),activeDays:Number(q.active_days||0)};
    }
  }
  return {
    coverageComplete:true,source:"POSTGRES_AGGREGATE",generatedAt:new Date().toISOString(),
    ledgers:out,
    commonWindow:Number.isFinite(commonStart)&&Number.isFinite(commonEnd)&&commonEnd>commonStart
      ? {start:new Date(commonStart).toISOString(),end:new Date(commonEnd).toISOString(),days:(commonEnd-commonStart)/86400000,ledgers:common}
      : null
  };
}
async function researchAnalytics(){
  if(!pool())return {schemaVersion:"7.47-TELEMETRY-V1",researchOnly:true,executionImpact:false,source:"NO_DATABASE",generatedAt:new Date().toISOString(),ledgers:{}};
  const [baseline,shadow,challenger,regime]=await Promise.all([
    stateGet("paper"),stateGet("shadow_v1"),stateGet("challenger_v2"),stateGet("regime_v1")
  ]);
  return {...researchComparison({baseline,shadow,challenger,regime}),source:"POSTGRES_STATE"};
}

function proxy(req,res,origin){
  const headers={...req.headers,host:`127.0.0.1:${INTERNAL_PORT}`};
  delete headers.origin;
  const p=http.request({
    hostname:"127.0.0.1",port:INTERNAL_PORT,path:req.url,method:req.method,headers
  },up=>{
    const h={...up.headers};
    for(const k of Object.keys(h))if(k.toLowerCase().startsWith("access-control-"))delete h[k];
    h["cache-control"]="no-store";
    h["vary"]="Origin";
    h["x-content-type-options"]="nosniff";
    if(origin)h["access-control-allow-origin"]=origin;
    res.writeHead(up.statusCode||502,h);
    up.pipe(res);
  });
  p.on("error",e=>writeJson(res,502,{error:"upstream_unavailable",detail:String(e.message||e)},origin||""));
  req.pipe(p);
}

const originalPort=process.env.PORT;
process.env.PORT=String(INTERNAL_PORT);
await import("./server.js");
process.env.PORT=originalPort==null?String(EXTERNAL_PORT):originalPort;

const migration=await migrateStaticDashboardOnce();
console.log("[GATEWAY] private dashboard migration",migration);

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||"localhost"}`);
    const origin=allowOrigin(req);
    if(req.method==="OPTIONS")return corsPreflight(req,res,origin);
    if(origin===null)return writeJson(res,403,{error:"origin_not_allowed"});
    if(req.method==="GET"&&u.pathname==="/gateway-health"){
      return writeJson(res,200,{ok:true,version:String(RELEASE.version||RELEASE.ui||""),buildId:String(RELEASE.buildId||""),engine:String(RELEASE.engine||""),ruleset:String(RELEASE.ruleset||""),deploymentSha:DEPLOYMENT_SHA||null,uptimeSec:Math.floor(process.uptime()),internalPort:INTERNAL_PORT,privateData:!!(await stateGet(PRIVATE_STATE_KEY)),privateWriteConfigured:/^[a-f0-9]{64}$/.test(WRITE_TOKEN_HASH),migration},origin||"");
    }
    if(req.method==="GET"&&u.pathname==="/api/private/write-check"){
      if(!authorizedWrite(req))return writeJson(res,401,{error:"write_token_required"},origin||"");
      const current=await stateGet(PRIVATE_STATE_KEY);
      return writeJson(res,200,{
        ok:true,
        writeAuthorized:true,
        databaseConfigured:!!DATABASE_URL,
        databaseReachable:!!pool(),
        privateData:!!current,
        currentRevision:Number.isInteger(current?.privateRevision)?current.privateRevision:0,
        writeEndpoint:"/api/private/dashboard-update"
      },origin||"");
    }
    if(req.method==="POST"&&u.pathname==="/api/private/dashboard-update"){
      if(!authorizedWrite(req))return writeJson(res,401,{error:"write_token_required"},origin||"");
      const current=await stateGet(PRIVATE_STATE_KEY);
      if(!current)return writeJson(res,503,{error:"private_dashboard_unavailable"},origin||"");
      let body;
      try{body=await readJsonBody(req);}catch(e){
        if(e?.code==="BODY_TOO_LARGE")return writeJson(res,413,{error:"request_body_too_large"},origin||"");
        if(e?.code==="INVALID_JSON")return writeJson(res,400,{error:"invalid_json"},origin||"");
        throw e;
      }
      const merged=mergePrivateDashboard(current,body);
      if(!merged.ok){
        const code=merged.error==="revision_conflict"?409:400;
        return writeJson(res,code,{error:merged.error,currentRevision:merged.currentRevision,forbidden:merged.forbidden,section:merged.section},origin||"");
      }
      const receipt=privateDashboardPublicReceipt(merged,{dryRun:body.dryRun});
      if(body.dryRun)return writeJson(res,200,receipt,origin||"");
      await stateSet(PRIVATE_STATE_KEY,merged.data);
      return writeJson(res,200,receipt,origin||"");
    }
    if(isProtected(u.pathname)&&!authorizedRead(req)){
      return writeJson(res,401,{error:"read_token_required"},origin||"");
    }
    if(req.method==="GET"&&u.pathname==="/api/private/dashboard"){
      const data=await stateGet(PRIVATE_STATE_KEY);
      return data?writeJson(res,200,{private:true,data},origin||""):writeJson(res,503,{error:"private_dashboard_unavailable"},origin||"");
    }
    if(req.method==="GET"&&u.pathname==="/api/activity-summary"){
      return writeJson(res,200,await activitySummary(),origin||"");
    }
    if(req.method==="GET"&&u.pathname==="/api/research-analytics"){
      return writeJson(res,200,await researchAnalytics(),origin||"");
    }
    if(req.method==="POST"&&u.pathname==="/api/backtests"){
      return proxy(req,res,origin||"");
    }
    if(PUBLIC_PATHS.has(u.pathname)||u.pathname.startsWith("/api/")){
      return proxy(req,res,origin||"");
    }
    return proxy(req,res,origin||"");
  }catch(e){return writeJson(res,500,{error:String(e?.message||e)});}
});
server.listen(EXTERNAL_PORT,"0.0.0.0",()=>console.log(`[GATEWAY] MERIDIAN ${String(RELEASE.version||RELEASE.ui||"?")} / ${String(RELEASE.buildId||"?")} on :${EXTERNAL_PORT} -> internal :${INTERNAL_PORT}`));

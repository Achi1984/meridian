import fs from 'node:fs';

const release=JSON.parse(fs.readFileSync('version.json','utf8'));
const EXPECTED_VERSION=String(release.version||'');
const EXPECTED_BUILD=String(release.buildId||'');
const PAGES_BASE=String(process.env.MERIDIAN_PAGES_BASE||'https://achi1984.github.io/meridian').replace(/\/$/,'');
const GATEWAY=String(process.env.MERIDIAN_GATEWAY_URL||'https://p01--achi-meridian--ttvk44grdlp7.code.run').replace(/\/$/,'');
const RETRIES=Math.max(1,Number(process.env.MERIDIAN_SMOKE_RETRIES||1));
const DELAY_MS=Math.max(0,Number(process.env.MERIDIAN_SMOKE_DELAY_MS||5000));
const TIMEOUT_MS=Math.max(1000,Number(process.env.MERIDIAN_SMOKE_TIMEOUT_MS||10000));
const EXPECTED_SHA=String(process.env.GITHUB_SHA||'').trim().toLowerCase();
const REQUIRE_SHA=process.env.MERIDIAN_SMOKE_REQUIRE_SHA==='1';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fail=msg=>{throw new Error(msg)};

async function request(url,options={}){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),TIMEOUT_MS);
  try{return await fetch(url,{cache:'no-store',redirect:'manual',...options,signal:c.signal})}
  finally{clearTimeout(timer)}
}
async function json(url){
  const r=await request(url);
  if(!r.ok)fail(`${url} HTTP ${r.status}`);
  return await r.json();
}
function sameRelease(x){
  return String(x?.version||'')===EXPECTED_VERSION&&String(x?.buildId||'')===EXPECTED_BUILD;
}
function shaInfo(h){
  const deployed=String(h?.deploymentSha||'').trim().toLowerCase();
  if(!deployed||!EXPECTED_SHA)return {deploymentSha:deployed||null,shaMatch:null};
  return {deploymentSha:deployed,shaMatch:deployed===EXPECTED_SHA||deployed.startsWith(EXPECTED_SHA)||EXPECTED_SHA.startsWith(deployed)};
}

async function smoke(){
  const nonce=Date.now();
  const pages=await json(`${PAGES_BASE}/version.json?smoke=${nonce}`);
  if(!sameRelease(pages))fail(`GitHub Pages stale: expected ${EXPECTED_VERSION}/${EXPECTED_BUILD}, got ${pages?.version}/${pages?.buildId}`);

  const health=await json(`${GATEWAY}/gateway-health?smoke=${nonce}`);
  if(!health?.ok)fail('Gateway health not ok');
  if(!sameRelease(health))fail(`Northflank stale: expected ${EXPECTED_VERSION}/${EXPECTED_BUILD}, got ${health?.version}/${health?.buildId}`);
  if(health.privateData!==true)fail('Private dashboard store is not ready');

  const protectedResponse=await request(`${GATEWAY}/api/status?smoke=${nonce}`);
  if(protectedResponse.status!==401)fail(`Anonymous protected API expected 401, got ${protectedResponse.status}`);

  const sha=shaInfo(health);
  if(REQUIRE_SHA&&sha.shaMatch!==true)fail(`Deployment SHA mismatch: expected ${EXPECTED_SHA||'unknown'}, got ${sha.deploymentSha||'missing'}`);

  return {
    ok:true,
    version:EXPECTED_VERSION,
    buildId:EXPECTED_BUILD,
    pages:true,
    gateway:true,
    privateData:true,
    anonymousProtectedStatus:protectedResponse.status,
    ...sha,
    checkedAt:new Date().toISOString()
  };
}

let last;
for(let attempt=1;attempt<=RETRIES;attempt++){
  try{
    const result=await smoke();
    console.log(JSON.stringify({...result,attempt},null,2));
    process.exit(0);
  }catch(e){
    last=e;
    console.warn(`[runtime-smoke] attempt ${attempt}/${RETRIES}: ${String(e?.message||e)}`);
    if(attempt<RETRIES)await sleep(DELAY_MS);
  }
}
console.error('[runtime-smoke] FAILED:',String(last?.stack||last));
process.exit(1);

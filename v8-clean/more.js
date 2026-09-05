import {getJson,hasReadToken} from './data.js';

const n=v=>Number.isFinite(Number(v))?Number(v):null;
const txt=v=>v==null||v===''?'—':String(v);
const upper=v=>txt(v).toUpperCase();

function scannerRows(data){
  const xs=data?.scanner?.opportunities||data?.scanner?.signals||data?.signals;
  if(!Array.isArray(xs))return [];
  return xs.map(x=>({
    symbol:upper(x?.symbol||x?.asset||'SETUP'),
    side:upper(x?.side||x?.direction||''),
    status:upper(x?.status||x?.action||'WATCH'),
    confidence:n(x?.confidence)
  })).sort((a,b)=>(b.confidence??-1)-(a.confidence??-1)).slice(0,5);
}
function forecastModel(data){
  const f=data?.forecast||data?.fcst||data?.nadir||{};
  const btc=f?.btc||f?.btcForecast||f?.btcScenarios||{};
  const scenarios=[];
  if(btc&&typeof btc==='object'&&!Array.isArray(btc)){
    for(const [k,v] of Object.entries(btc))if(v!=null&&typeof v!=='object')scenarios.push({label:String(k),value:String(v)});
  }
  return {
    status:upper(f?.status||f?.label||'NO VERIFIED FORECAST'),
    score:n(f?.score),
    cycle:txt(f?.cycle||f?.cyclePhase||f?.phase),
    verifiedAt:f?.verifiedAt||f?.snapshotAt||null,
    scenarios:scenarios.slice(0,4)
  };
}
function marketModel(data){
  const m=data?.market||{};
  return {
    regime:upper(m?.regime||data?.btcRegime?.label||data?.regime?.label),
    sentiment:txt(m?.sentiment||m?.fearGreed||data?.fearGreed),
    btcDominancePct:n(m?.btcDominancePct||data?.btcDominancePct),
    totalMarketCapT:n(m?.totalMarketCapT),
    breadth:txt(m?.breadth),
    verifiedAt:m?.verifiedAt||null
  };
}
function diagnosticsModel(health,privateData,research){
  return {
    gatewayOk:!!health?.ok,
    version:txt(health?.version),
    buildId:txt(health?.buildId),
    deploymentSha:health?.deploymentSha?String(health.deploymentSha).slice(0,10):'—',
    uptimeSec:n(health?.uptimeSec),
    privateData:health?.privateData===true,
    tokenConnected:hasReadToken(),
    privateRevision:n(privateData?.privateRevision),
    researchSchema:txt(research?.schemaVersion)
  };
}

export async function loadMore(){
  let health={};
  try{health=await getJson('/gateway-health')}catch(_e){}
  if(!hasReadToken())return {ok:true,locked:true,source:'MORE_MODULES',health:diagnosticsModel(health,null,null)};
  try{
    const [privatePayload,research]=await Promise.all([getJson('/api/private/dashboard'),getJson('/api/research-analytics')]);
    const data=privatePayload?.data||privatePayload;
    return {
      ok:true,locked:false,source:'MORE_MODULES',
      market:marketModel(data),
      forecast:forecastModel(data),
      scanner:scannerRows(data),
      research:{schemaVersion:txt(research?.schemaVersion),researchOnly:research?.researchOnly!==false,executionImpact:research?.executionImpact===true,generatedAt:research?.generatedAt||null},
      diagnostics:diagnosticsModel(health,data,research)
    };
  }catch(e){
    if(e?.status===401)return {ok:true,locked:true,source:'MORE_MODULES',health:diagnosticsModel(health,null,null)};
    return {ok:false,locked:false,source:'MORE_MODULES',error:String(e?.message||e),health:diagnosticsModel(health,null,null)};
  }
}

export function moreHtml(x){
  const h=x?.diagnostics||x?.health||{};
  const connected=hasReadToken();
  if(!x)return `<section class="hero more-hero"><div class="eyebrow">MORE · MODULE HUB</div><div class="hero-value">LÄDT…</div><p class="muted">Markt, Forecast, Scanner, Research und Diagnostik werden geladen.</p></section>`;
  if(x.locked)return `<section class="hero more-hero"><div class="eyebrow">MORE · MODULE HUB</div><div class="more-state">LOCKED</div><p class="muted">Private Module sind gesperrt. Diagnostik und Token-Verbindung bleiben verfügbar.</p></section>
  <section class="card"><div class="eyebrow">DIAGNOSTICS</div><div class="more-kv"><span>Gateway</span><b>${h.gatewayOk?'ONLINE':'CHECK'}</b></div><div class="more-kv"><span>Build</span><b>${txt(h.version)} · ${txt(h.buildId)}</b></div><div class="more-kv"><span>Private Data</span><b>${h.privateData?'READY':'CHECK'}</b></div></section>
  <button id="connectToken" class="action more-connect" type="button"><span>READ TOKEN</span><b>${connected?'Token ersetzen':'Private Module verbinden'}</b></button>`;
  if(!x.ok)return `<section class="hero more-hero"><div class="eyebrow">MORE · DATA STATUS</div><div class="more-state">CHECK</div><p class="muted">${x.error||'Module nicht verfügbar'}</p></section>`;
  const m=x.market||{},f=x.forecast||{},r=x.research||{},d=x.diagnostics||{};
  const scan=(x.scanner||[]).map(s=>`<div class="module-row"><div><b>${s.symbol}${s.side?` · ${s.side}`:''}</b><small>${s.status}</small></div><div><b>${s.confidence==null?'—':s.confidence}</b><small>CONF</small></div></div>`).join('')||'<div class="chart-empty">NO READY / WATCH SIGNALS</div>';
  const scenarios=(f.scenarios||[]).map(s=>`<div class="more-kv"><span>${s.label}</span><b>${s.value}</b></div>`).join('')||'<div class="chart-empty">Keine verifizierten Szenarien</div>';
  return `<section class="hero more-hero"><div class="eyebrow">MORE · MODULE HUB</div><div class="more-state">SYSTEM</div><p class="muted">Explizite Detailmodule innerhalb eines echten MORE-Views · kein Legacy-Overlay</p></section>
  <section class="card more-module" data-module="market"><div class="eyebrow">MARKET</div><h2>${m.regime||'—'}</h2><div class="grid2"><div class="metric"><span>SENTIMENT</span><b>${m.sentiment||'—'}</b><small>${m.breadth||'—'}</small></div><div class="metric"><span>BTC DOM</span><b>${m.btcDominancePct==null?'—':m.btcDominancePct.toFixed(2)+'%'}</b><small>${m.totalMarketCapT==null?'—':m.totalMarketCapT.toFixed(2)+'T Market Cap'}</small></div></div></section>
  <section class="card more-module" data-module="forecast"><div class="eyebrow">FORECAST</div><h2>${f.status}</h2><div class="more-kv"><span>Cycle</span><b>${f.cycle}</b></div><div class="more-kv"><span>Score</span><b>${f.score==null?'—':f.score}</b></div>${scenarios}</section>
  <section class="card more-module" data-module="scanner"><div class="eyebrow">SCANNER</div>${scan}</section>
  <section class="card more-module" data-module="research"><div class="eyebrow">RESEARCH</div><div class="more-kv"><span>Schema</span><b>${r.schemaVersion}</b></div><div class="more-kv"><span>Mode</span><b>${r.researchOnly?'RESEARCH ONLY':'CHECK'}</b></div><div class="more-kv"><span>Execution Impact</span><b>${r.executionImpact?'CHECK':'NONE'}</b></div></section>
  <section class="card more-module" data-module="diagnostics"><div class="eyebrow">DIAGNOSTICS</div><div class="more-kv"><span>Gateway</span><b>${d.gatewayOk?'ONLINE':'CHECK'}</b></div><div class="more-kv"><span>Build</span><b>${d.version} · ${d.buildId}</b></div><div class="more-kv"><span>Deploy</span><b>${d.deploymentSha}</b></div><div class="more-kv"><span>Private Revision</span><b>${d.privateRevision??'—'}</b></div></section>
  <section class="card more-module" data-module="settings"><div class="eyebrow">SETTINGS</div><div class="more-kv"><span>Private Data</span><b>${connected?'VERBUNDEN':'LOCKED'}</b></div><button id="connectToken" class="action more-connect" type="button"><span>READ TOKEN</span><b>${connected?'Token ersetzen':'Token verbinden'}</b></button></section>`;
}

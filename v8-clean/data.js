const API_BASE=(window.MERIDIAN_V8_CONFIG?.apiBase||'').replace(/\/$/,'');
const TOKEN_KEY='meridian.v8.readToken';

export function setReadToken(token){
  const v=String(token||'').trim();
  if(v) sessionStorage.setItem(TOKEN_KEY,v); else sessionStorage.removeItem(TOKEN_KEY);
}
export function hasReadToken(){return !!sessionStorage.getItem(TOKEN_KEY)}
function authHeaders(){const t=sessionStorage.getItem(TOKEN_KEY);return t?{authorization:`Bearer ${t}`}:{}}
async function getJson(path){
  const r=await fetch(`${API_BASE}${path}`,{cache:'no-store',headers:{accept:'application/json',...authHeaders()}});
  if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.status=r.status;throw e}
  return r.json();
}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function holdingsValue(data){
  const hs=data?.portfolio?.holdings;
  if(!Array.isArray(hs))return null;
  return hs.reduce((sum,h)=>sum+(n(h?.usdValue)||n(h?.valueUsd)||0),0);
}
function canonicalTotal(data){
  const spot=n(data?.portfolio?.spotUsd)??holdingsValue(data);
  const trading=n(data?.portfolio?.pionexEquityUsd)??n(data?.pionexEquityUsd)??n(data?.pionexRisk?.equityUsd);
  if(spot==null&&trading==null)return null;
  return (spot||0)+(trading||0);
}
function botRows(data){
  const xs=data?.pionexRisk?.bots;
  if(!Array.isArray(xs))return [];
  return xs.map(b=>({
    id:String(b?.id||b?.botId||b?.name||'BOT'),
    buffer:n(b?.pionexLiqBufferPct)??n(b?.liqBufferPct)??n(b?.liquidationDistancePct),
    status:String(b?.status||b?.riskState||'').toUpperCase(),
    side:String(b?.side||b?.direction||'').toUpperCase()
  }));
}
function riskState(data){
  const bots=botRows(data).filter(b=>Number.isFinite(b.buffer)).sort((a,b)=>a.buffer-b.buffer);
  const b=bots[0]||null;
  if(!b)return {state:'CHECK',tone:'muted',bot:null,next:'Risikodaten prüfen'};
  if(b.buffer<8)return {state:'DANGER',tone:'danger',bot:b,next:`${b.id}: Buffer zuerst auf ≥8% bringen`};
  if(b.buffer<12)return {state:'WATCH',tone:'watch',bot:b,next:`${b.id}: Buffer auf SAFE ≥12% erhöhen`};
  return {state:'SAFE',tone:'safe',bot:b,next:'Keine akute Liquidationsmaßnahme'};
}
function marketState(data){
  const r=data?.market?.regime||data?.btcRegime?.label||data?.regime?.label;
  return r?String(r).toUpperCase():'—';
}
function bestOpportunity(data){
  const xs=data?.scanner?.opportunities||data?.scanner?.signals||data?.signals;
  if(!Array.isArray(xs))return null;
  const ready=xs.filter(x=>/READY|TRADE|ENTRY/.test(String(x?.status||x?.action||'').toUpperCase()));
  return ready.sort((a,b)=>(n(b?.confidence)||0)-(n(a?.confidence)||0))[0]||null;
}
export async function loadCenter(){
  try{
    const payload=await getJson('/api/private/dashboard');
    const data=payload?.data||payload;
    const risk=riskState(data);
    const opp=bestOpportunity(data);
    return {
      ok:true,locked:false,source:'PRIVATE_DASHBOARD',
      portfolioUsd:canonicalTotal(data),market:marketState(data),risk,
      nextAction:risk.next,
      opportunity:opp?{symbol:String(opp.symbol||opp.asset||'SETUP'),side:String(opp.side||opp.direction||''),confidence:n(opp.confidence)}:null
    };
  }catch(e){
    if(e?.status===401)return {ok:false,locked:true,source:'PRIVATE_DASHBOARD',error:'READ_TOKEN_REQUIRED'};
    return {ok:false,locked:false,source:'PRIVATE_DASHBOARD',error:String(e?.message||e)};
  }
}

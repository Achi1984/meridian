// MERIDIAN v8 R18 — transport adapter for live portfolio valuation.
// It augments only GET /api/private/dashboard responses with public Binance spot prices.
// The market request fetches the full public ticker table, so private holding symbols are never sent as query parameters.
import {buildLivePriceOverlay,clearStaleLivePrices} from './live-price-core-r18.js';

const API_BASE=(window.MERIDIAN_V8_CONFIG?.apiBase||'').replace(/\/$/,'');
const DASHBOARD_PATH='/api/private/dashboard';
const BINANCE_ALL='https://api.binance.com/api/v3/ticker/price';
const CACHE_MS=25000;
const rawFetch=window.fetch.bind(window);
let cache={at:0,rows:null};

async function allTickers(){
  const now=Date.now();
  if(Array.isArray(cache.rows)&&now-cache.at<CACHE_MS)return cache.rows;
  const r=await rawFetch(BINANCE_ALL,{cache:'no-store',headers:{accept:'application/json'}});
  if(!r.ok)throw new Error(`market_http_${r.status}`);
  const rows=await r.json();
  if(!Array.isArray(rows))throw new Error('market_payload_invalid');
  cache={at:now,rows};
  return rows;
}

function isDashboardGet(input,init){
  const url=typeof input==='string'?input:input?.url||'';
  const method=String(init?.method||input?.method||'GET').toUpperCase();
  return method==='GET'&&url===`${API_BASE}${DASHBOARD_PATH}`;
}

window.fetch=async function meridianLivePortfolioFetch(input,init){
  const response=await rawFetch(input,init);
  if(!isDashboardGet(input,init)||!response.ok)return response;
  try{
    const payload=await response.clone().json();
    const data=payload?.data||payload;
    let augmented;
    try{augmented=buildLivePriceOverlay(data,await allTickers(),Date.now())}
    catch(e){augmented=clearStaleLivePrices(data,Date.now(),String(e?.message||e))}
    const body=payload?.data?{...payload,data:augmented}:augmented;
    const headers=new Headers(response.headers);headers.set('content-type','application/json; charset=utf-8');headers.set('cache-control','no-store');
    return new Response(JSON.stringify(body),{status:response.status,statusText:response.statusText,headers});
  }catch(_e){return response}
};

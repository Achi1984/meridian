// MERIDIAN Pionex Bot API detail hydration.
// Pure helper: no credentials, no HTTP methods, no persistence and no execution paths.

export const PIONEX_FUTURES_GRID_DETAIL_PATH='/api/v1/bot/orders/futuresGrid/order';
export const PIONEX_SUPPORTED_BOT_TYPES=Object.freeze(['futures_grid','future_hedge_grid']);

const SUPPORTED=new Set(PIONEX_SUPPORTED_BOT_TYPES);
const ACTIVE=new Set([
  'prepare','lock_currency','condition_lock','open_position','init_grid','running',
  'adjust_params','adjust_params_open_position','adjust_params_init_grid',
  'pre_pause','pausing','paused','pre_resume','resuming'
]);

function activeSummary(order={}){
  const status=String(order?.buOrderData?.status||order?.status||'').toLowerCase();
  return ACTIVE.has(status);
}

export function mergePionexOrderDetail(summary,detail){
  if(!summary||typeof summary!=='object'||!detail||typeof detail!=='object')throw new Error('pionex_bot_detail_invalid');
  const summaryId=String(summary.buOrderId||'').trim();
  if(!summaryId)throw new Error('pionex_bot_detail_missing_id');

  const envelope=detail?.buOrderData&&typeof detail.buOrderData==='object'?detail:{};
  const echoedId=String(envelope.buOrderId||'').trim();
  if(echoedId&&echoedId!==summaryId)throw new Error('pionex_bot_detail_id_mismatch');

  const detailData=envelope.buOrderData||detail;
  return {
    ...summary,
    ...envelope,
    buOrderId:summaryId,
    buOrderType:String(summary.buOrderType||envelope.buOrderType||''),
    base:envelope.base||summary.base,
    quote:envelope.quote||summary.quote,
    status:envelope.status||summary.status,
    buOrderData:{...(summary.buOrderData||{}),...(detailData||{})}
  };
}

export async function hydratePionexBotSummaries(
  orders=[],
  {loadDetail,validateDetail=()=>true,sleep=ms=>new Promise(r=>setTimeout(r,ms)),delayMs=125,maxRows=100}={}
){
  if(typeof loadDetail!=='function')throw new Error('pionex_bot_detail_loader_missing');
  const list=Array.isArray(orders)?orders:[];
  const candidates=list.filter(o=>SUPPORTED.has(String(o?.buOrderType||''))&&activeSummary(o));
  if(candidates.length>maxRows)throw new Error('pionex_bot_detail_row_limit');

  const seen=new Set(),hydrated=[];
  for(let i=0;i<candidates.length;i++){
    const summary=candidates[i],id=String(summary?.buOrderId||'').trim();
    if(!id)throw new Error('pionex_bot_detail_missing_id');
    if(seen.has(id))throw new Error('pionex_bot_detail_duplicate_id');
    seen.add(id);

    const detail=await loadDetail(id);
    const merged=mergePionexOrderDetail(summary,detail);
    if(validateDetail(merged)!==true)throw new Error('pionex_bot_detail_incomplete');
    hydrated.push(merged);

    if(i<candidates.length-1&&delayMs>0)await sleep(delayMs);
  }

  return {
    orders:hydrated,
    listRows:list.length,
    supportedRows:candidates.length,
    detailRows:hydrated.length,
    detailsComplete:hydrated.length===candidates.length
  };
}

import {buildCurrentDepotModel,buildPionexDepotModel} from './depot-current-model.js?v=B16-M11-FIX5';
import {buildDepotHistoryModel} from './depot-history-model.js?v=B16-M11-FIX5';
import {buildDepotReadModel} from './depot-read-model.js?v=B16-M11-FIX5';
import {parseBotReadCredential} from './bot-read-client.js?v=B16-M11-FIX5';

const ENDPOINT = 'https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/portfolio-history?range=1w';
const CURRENT_ENDPOINT='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/dashboard';
const PRICE_ENDPOINT='https://data-api.binance.vision/api/v3/ticker/price';
// Only the Meridian bearer password is accepted; bot share access never expands to Depot.
export function parseDepotReadCredential(value) {
  const parsed = parseBotReadCredential(value);
  return parsed?.kind === 'bearer' ? parsed : null;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 10000;

async function readBounded(response, signal) {
  if (!response.ok) throw new Error('unavailable');
  const length = response.headers?.get('content-length');
  if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
    throw new Error('unavailable');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('unavailable');
  const decoder = new TextDecoder('utf-8', {fatal:true});
  let size = 0, text = '';
  const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} };
  signal.addEventListener('abort', cancel, {once:true});
  try {
    while (true) {
      if (signal.aborted) throw new Error('unavailable');
      const {done,value} = await reader.read();
      if (signal.aborted) throw new Error('unavailable');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('unavailable');
      text += decoder.decode(value, {stream:true});
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    try { reader.releaseLock(); } catch {}
  }
}

// Manual reads only. Independent source failures preserve other verified results.
export function createDepotReadClient({getToken,onChange=()=>{},fetchImpl=globalThis.fetch,
  pionexOnly=false,now=Date.now,schedule=setTimeout,cancelSchedule=clearTimeout}={}){
  let generation=0,pending=null,disposed=false,current=null,stored=null,history=null,attempted=false,src=null;
  const token=()=>{try{const value=getToken();return parseDepotReadCredential(value)?value.trim():null;}catch{return null;}};
  let snapshotToken=null;
  const emit=(status,model=null)=>{if(!disposed)try{onChange({status,model,history,reasons:reasons(),sourceIssues:sourceIssues()});}catch{}};
  const stop=()=>{generation++;pending?.abort();pending=null;};
  const wipe=()=>{current=null;stored=null;history=null;src=null;snapshotToken=null;};
  // Fixed categories only, derived at emit time so a fresh->stale projection never keeps an OK label.
  // prices: RECEIVED means transport success only; coverage is validated inside the current model.
  function reasons(){
    if(!src)return null;
    const clock=now(),valid=m=>m?.status==='FRESH_SNAPSHOT'&&clock<=m.expiresAt;
    return {
      current:valid(current)?'OK':src.dashboardFailed?'TRANSPORT':src.c==='STALE'||current?'STALE':'INCOMPLETE',
      prices:pionexOnly?'NOT_APPLICABLE':src.pricesFailed?'TRANSPORT':'RECEIVED',
      history:pionexOnly?'NOT_APPLICABLE':valid(stored)?'OK':src.archiveFailed?'TRANSPORT':src.h==='STALE'||stored?.status==='FRESH_SNAPSHOT'?'STALE':src.historyEmpty?'EMPTY':'INCOMPLETE'};
  }
  function sourceIssues(){
    if(!src||src.dashboardFailed)return [];
    if(current?.status==='FRESH_SNAPSHOT')return now()>current.expiresAt?['CURRENT_SNAPSHOT_EXPIRED']:[];
    return src.sourceIssues||[];
  }
  function project(){
    const clock=now(),valid=m=>m?.status==='FRESH_SNAPSHOT'&&clock<=m.expiresAt;
    const model=valid(current)?current:valid(stored)?stored:null;
    emit(model?'fresh':current||stored?'stale':'unavailable',model);
  }
  function lock(){stop();wipe();attempted=false;emit('locked');}
  async function read(url,credential,parent){
    const ctl=new AbortController();let timer,aborted;
    const abort=()=>ctl.abort();parent.addEventListener('abort',abort,{once:true});
    if(parent.aborted)ctl.abort();
    const deadline=new Promise((_,reject)=>{aborted=()=>reject(new Error('unavailable'));ctl.signal.addEventListener('abort',aborted,{once:true});if(ctl.signal.aborted)aborted();});
    try{
      timer=schedule(abort,TIMEOUT_MS);
      const operation=(async()=>{
        const headers={accept:'application/json'};if(credential)headers.authorization='Bearer '+credential;
        const response=await fetchImpl(url,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:ctl.signal,headers});
        if(ctl.signal.aborted)throw new Error('unavailable');
        if(credential&&(response.status===401||response.status===403))return {locked:true};
        return {data:await readBounded(response,ctl.signal),at:now()};
      })();
      return await Promise.race([operation,deadline]);
    }catch{return {failed:true};}
    finally{cancelSchedule(timer);parent.removeEventListener('abort',abort);ctl.signal.removeEventListener('abort',aborted);ctl.abort();}
  }
  async function refresh(){
    if(disposed)return;stop();wipe();const credential=token();if(!credential){emit('locked');return;}
    attempted=true;const id=generation,ctl=new AbortController();pending=ctl;snapshotToken=credential;emit('loading');
    if(id!==generation||disposed)return;
    if(pionexOnly){
      const dashboard=await read(CURRENT_ENDPOINT,credential,ctl.signal);
      if(disposed||id!==generation)return;
      pending=null;if(token()!==credential||dashboard.locked){lock();return;}
      const c=buildPionexDepotModel(dashboard.data,{now:now()});
      current=c.status==='FRESH_SNAPSHOT'?c:c.status==='STALE'?{status:'STALE'}:null;
      src={dashboardFailed:dashboard.failed||dashboard.data===undefined,c:c.status,sourceIssues:c.sourceIssues};
      project();return;
    }
    const [dashboard,prices,archive]=await Promise.all([read(CURRENT_ENDPOINT,credential,ctl.signal),read(PRICE_ENDPOINT,null,ctl.signal),read(ENDPOINT,credential,ctl.signal)]);
    if(disposed||id!==generation)return;
    pending=null;if(token()!==credential||dashboard.locked||archive.locked){lock();return;}
    const c=buildCurrentDepotModel(dashboard.data,{tickers:prices.data,tickersAt:prices.at,now:now()});
    if(c.status==='FRESH_SNAPSHOT')current=c;
    const h=buildDepotReadModel(archive.data,{now:now()});
    if(h.status==='FRESH_SNAPSHOT')stored=h;
    // Keep only validated graph projections, never the broad account response.
    history=Object.fromEntries(['1h','1d','1w'].map(range=>[range,buildDepotHistoryModel(archive.data,{now:now(),range})]));
    if(!current&&!stored&&h.status==='STALE')stored={status:'STALE'};
    const failed=r=>r.failed||r.data===undefined;
    src={dashboardFailed:failed(dashboard),pricesFailed:failed(prices),archiveFailed:failed(archive),c:c.status,h:h.status,
      historyEmpty:history['1w']?.status==='empty',sourceIssues:c.sourceIssues};
    project();
  }
  function revalidate(){if(disposed)return;if(!token()||(snapshotToken&&token()!==snapshotToken)){lock();return;}if(current||stored)project();else if(!attempted&&!pending)emit('not_loaded');}
  function dispose(){if(disposed)return;lock();disposed=true;}
  return {refresh,lock,revalidate,dispose};
}

import {buildLedgerManualModel} from './ledger-manual-model.js?v=B16-M11-FIX12';
const BASE='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/';
const PRICES='https://data-api.binance.vision/api/v3/ticker/price';
export function createLedgerManualClient({getToken,onChange=()=>{},onLock=()=>{},fetchImpl=globalThis.fetch,now=Date.now}={}){
  let generation=0,controller=null,revision=null,owner=null,disposed=false,expiry=null;
  const token=()=>{try{const t=getToken();return typeof t==='string'&&t.trim()?t.trim():null;}catch{return null;}};
  const emit=s=>{if(!disposed)onChange(s);};
  function clear(){generation++;controller?.abort();controller=null;clearTimeout(expiry);revision=null;owner=null;}
  function lock(){clear();emit({status:'locked'});}
  async function read(url,opts,ctl){
    const r=await fetchImpl(url,{credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:ctl.signal,...opts});
    if(!r.ok){const e=Error('request');e.status=r.status;throw e;}
    const reader=r.body?.getReader();if(!reader)throw Error('body');
    const abort=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}};
    ctl.signal.addEventListener('abort',abort,{once:true});
    const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
    try{while(true){const {value,done}=await reader.read();if(ctl.signal.aborted)throw Error('aborted');if(done)break;
      size+=value.byteLength;if(size>512*1024)throw Error('size');text+=decoder.decode(value,{stream:true});}
      return JSON.parse(text+decoder.decode());
    }finally{ctl.signal.removeEventListener('abort',abort);abort();reader.releaseLock();}
  }
  async function load(){
    if(disposed||controller)return;clear();const credential=token();if(!credential){lock();return;}
    const id=generation,ctl=new AbortController();controller=ctl;emit({status:'loading'});
    const timer=setTimeout(()=>ctl.abort(),10000);
    try{
      const [dashboard,quotes]=await Promise.all([
        read(BASE+'dashboard',{headers:{accept:'application/json',authorization:'Bearer '+credential}},ctl),
        read(PRICES,{headers:{accept:'application/json'}},ctl).then(data=>({data,at:now()})).catch(()=>null)]);
      if(id!==generation||disposed)return;if(token()!==credential){lock();return;}
      if(dashboard?.private!==true||!Number.isSafeInteger(dashboard.data?.privateRevision))throw Error('shape');
      revision=dashboard.data.privateRevision;owner=credential;
      const snapshot=dashboard.data.portfolio?.ledgerManualSnapshot;
      const model=buildLedgerManualModel(snapshot,{tickers:quotes?.data,pricesAt:quotes?.at,now:now()});
      if(snapshot&&!model)throw Error('snapshot');
      emit({status:'ready',model});
      if(model?.priceExpiresAt)expiry=setTimeout(()=>{
        if(id===generation&&!disposed)emit({status:'ready',model:buildLedgerManualModel(snapshot,{now:now()})});
      },Math.max(0,model.priceExpiresAt-now()+1));
    }catch(e){if(id===generation&&!disposed){revision=null;owner=null;
      if(e.status===401||e.status===403){lock();onLock();}else emit({status:'unavailable'});}}
    finally{clearTimeout(timer);ctl.abort();if(id===generation)controller=null;}
  }
  async function save(snapshot,writeToken){
    if(disposed||controller||revision===null||owner!==token()||typeof writeToken!=='string'||!writeToken.trim())return;
    const credential=owner,expectedRevision=revision;clear();const id=generation,ctl=new AbortController();controller=ctl;
    emit({status:'saving'});const timer=setTimeout(()=>ctl.abort(),10000);
    try{
      const receipt=await read(BASE+'ledger-snapshot',{method:'POST',headers:{accept:'application/json','content-type':'application/json',
        authorization:'Bearer '+credential,'x-meridian-write-token':writeToken.trim()},body:JSON.stringify({expectedRevision,snapshot})},ctl);
      if(id!==generation||disposed)return;if(token()!==credential){lock();return;}
      if(receipt?.ok!==true||receipt.revision!==expectedRevision+1)throw Error('receipt');
      emit({status:'saved'});
    }catch(e){if(id===generation&&!disposed)emit({status:e.status===409?'conflict':e.status===401||e.status===403?'write_denied':'write_unknown'});}
    finally{clearTimeout(timer);ctl.abort();if(id===generation)controller=null;}
  }
  return {load,save,lock,revalidate(){if(!token()||(owner&&owner!==token()))lock();},dispose(){lock();disposed=true;}};
}

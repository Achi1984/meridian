import {ledgerReviewHoldings} from './ledger-review-model.js?v=B16-M11-FIX3';
import {parseDepotReadCredential} from './depot-read-client.js?v=B16-M11-FIX3';
const BASE='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/';
export function createLedgerReviewClient({getToken,onChange=()=>{},onLock=()=>{},fetchImpl=globalThis.fetch}={}){
  let pending=null,rows=null,reviewToken=null,generation=0,disposed=false;
  const token=()=>{try{const t=getToken();return parseDepotReadCredential(t)?t.trim():null;}catch{return null;}};
  const emit=(status,extra={})=>{if(!disposed)onChange({status,...extra});};
  function lock(){generation++;pending?.abort();pending=null;rows=null;reviewToken=null;emit('locked');}
  async function request(write){
    if(disposed||pending)return;
    const credential=token();
    if(!credential){lock();return;}
    if(write&&(!rows||reviewToken!==credential)){lock();return;}
    const reviewed=rows;rows=null;reviewToken=null;
    const id=++generation,ctl=new AbortController();pending=ctl;
    const timer=setTimeout(()=>ctl.abort(),10000);
    emit(write?'saving':'loading');
    try{
      const response=await fetchImpl(BASE+(write?'portfolio-authority':'dashboard'),{
        method:write?'POST':'GET',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:ctl.signal,
        headers:{accept:'application/json',authorization:'Bearer '+credential,...(write?{'content-type':'application/json'}:{})},
        ...(write?{body:JSON.stringify({action:'confirm_ledger_reviewed',reviewedHoldings:reviewed})}:{})});
      if(id!==generation||disposed)return;
      if(token()!==credential||response.status===401||response.status===403){lock();onLock();return;}
      if(write&&response.status===409){emit('changed');return;}
      if(!response.ok)throw Error();
      const reader=response.body?.getReader();if(!reader)throw Error();
      let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
      const abortReader=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}};
      ctl.signal.addEventListener('abort',abortReader,{once:true});
      try{
        while(true){const {done,value}=await reader.read();if(ctl.signal.aborted)throw Error();if(done)break;
          size+=value.byteLength;if(size>512*1024)throw Error();text+=decoder.decode(value,{stream:true});}
        text+=decoder.decode();
      }finally{ctl.signal.removeEventListener('abort',abortReader);try{await reader.cancel();reader.releaseLock();}catch{}}
      if(id!==generation||disposed)return;
      if(token()!==credential){lock();onLock();return;}
      const data=JSON.parse(text);
      if(write){
        const at=Date.parse(data?.updatedAt);
        if(data?.ok!==true||data.action!=='confirm_ledger_reviewed'||!Number.isFinite(at))throw Error();
        emit('confirmed',{updatedAt:new Date(at).toISOString()});
      }else{
        rows=data?.private===true?ledgerReviewHoldings(data.data):null;
        if(!rows){emit('invalid');return;}
        reviewToken=credential;emit('review',{holdings:rows.map(r=>({...r}))});
      }
    }catch{if(id===generation&&!disposed)emit(write?'write_failed':'unavailable');}
    finally{clearTimeout(timer);ctl.abort();if(id===generation)pending=null;}
  }
  return {load:()=>request(false),confirm:()=>request(true),lock,
    revalidate(){if(!token()||(reviewToken&&token()!==reviewToken))lock();},
    dispose(){lock();disposed=true;}};
}

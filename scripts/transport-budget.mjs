import {createHash} from 'node:crypto';

// A size/integrity preflight only. This module performs no upload or authorization.
const must=(ok,code)=>{if(!ok)throw new Error('TRANSPORT_BUDGET: '+code)};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(x,key)=>Object.prototype.hasOwnProperty.call(x,key);
const validText=x=>typeof x==='string'&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x);
const bytes=x=>{must(validText(x),'INVALID_UTF8_TEXT');return Buffer.byteLength(x,'utf8')};
const serialized=x=>{let out;try{out=JSON.stringify(x)}catch{must(false,'INVALID_JSON')}must(typeof out==='string','INVALID_JSON');return out};
export function transportLimits(checkpoint){
  const s=checkpoint?.streamSafety;
  must(s?.maxPayloadBytesScope==='RENDERED_PROGRESS_AND_LOG_EXCERPTS','UNSCOPED_POLICY');
  must(s.maxPayloadBytes===4096&&s.maxSourceFileBytes===262144&&s.maxSerializedUploadBytes===393216,'UNAPPROVED_LIMITS');
  return Object.freeze({visibleBytes:s.maxPayloadBytes,fileBytes:s.maxSourceFileBytes,requestBytes:s.maxSerializedUploadBytes});
}
function approved(limits){
  must(limits?.visibleBytes===4096&&limits.fileBytes===262144&&limits.requestBytes===393216,'UNAPPROVED_LIMITS');
}
export function checkVisibleBudget(text,limits){
  approved(limits);const size=bytes(text);must(size<=limits.visibleBytes,'VISIBLE_TOO_LARGE');
  return {ok:true,bytes:size};
}
export function sourceBlobSha(text){
  const size=bytes(text);
  return createHash('sha1').update('blob '+size+'\0').update(text,'utf8').digest('hex');
}
export function verifySourceBlob(text,actualSha){
  must(typeof actualSha==='string'&&/^[a-f0-9]{40}$/.test(actualSha),'INVALID_BLOB_SHA');
  must(sourceBlobSha(text)===actualSha,'BLOB_MISMATCH');return true;
}
/** Inspect the complete native-tool arguments, including the contents API's base64 overhead. */
export function checkUploadBudget(operation,payload,limits){
  approved(limits);must(object(payload),'INVALID_REQUEST');
  const native=serialized(payload),texts=[];
  let wire=native;
  const add=text=>{const size=bytes(text);must(size<=limits.fileBytes,'SOURCE_TOO_LARGE');texts.push(text)};
  if(operation==='contents'){
    must(validText(payload.repository_full_name)&&validText(payload.path)&&validText(payload.message),'INVALID_CONTENTS_REQUEST');
    add(payload.content);
    // The contents wrapper encodes source bytes. Bound the native request AND
    // an envelope retaining every supplied field with that encoded content.
    wire=serialized({...payload,content:Buffer.from(payload.content,'utf8').toString('base64')});
  }else if(operation==='blob'){
    must(validText(payload.repository_full_name),'INVALID_BLOB_REQUEST');
    if(payload.encoding===undefined||payload.encoding==='utf-8')add(payload.content);
    else{
      must(payload.encoding==='base64'&&typeof payload.content==='string','INVALID_ENCODING');
      must(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.content),'INVALID_BASE64');
      const decoded=Buffer.from(payload.content,'base64'),text=decoded.toString('utf8');
      must(decoded.toString('base64')===payload.content&&Buffer.from(text,'utf8').equals(decoded),'INVALID_BASE64_UTF8');
      add(text);
    }
  }else if(operation==='tree'){
    must(validText(payload.repository_full_name)&&Array.isArray(payload.tree_elements)&&payload.tree_elements.length>0,'INVALID_TREE_REQUEST');
    const paths=new Set();
    for(const entry of payload.tree_elements){
      must(object(entry)&&validText(entry.path)&&!paths.has(entry.path),'INVALID_TREE_ENTRY');paths.add(entry.path);
      if(own(entry,'content')){
        must(!own(entry,'sha')&&entry.type==='blob','AMBIGUOUS_TREE_ENTRY');add(entry.content);
      }else must(own(entry,'sha')&&(entry.sha===null||/^[a-f0-9]{40}$/.test(entry.sha)),'INVALID_TREE_REFERENCE');
    }
    // Reference-only entries do not upload bytes. They still need the usual
    // separate source-blob/expected-head checks; this budget is not a waiver.
  }else must(false,'UNSUPPORTED_OPERATION');
  const requestBytes=Math.max(bytes(native),bytes(wire));
  must(requestBytes<=limits.requestBytes,'REQUEST_TOO_LARGE');
  return {ok:true,files:texts.length,fileBytes:texts.map(bytes),blobShas:texts.map(sourceBlobSha),requestBytes};
}

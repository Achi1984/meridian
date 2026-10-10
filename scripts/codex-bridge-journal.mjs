/**
 * Durable LOCAL offline journal, not an owner/CI/reviewer authorization store.
 * Private directory, O_EXCL single-writer lock, fsync, atomic rename, hash-linked history.
 * No automatic store recreation, stale-lock takeover, retry or external dispatch.
 * Does not secure hostile same-account writers, rollback, NFS or multiple hosts.
 */
import {constants,closeSync,existsSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,
  readFileSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {BridgeGuardError,digest,data,exactKeys,freeze,isHash,must,validateRequest} from './codex-bridge-contract.mjs';
const GENESIS='0'.repeat(64), LIMIT=1024*1024;
const TYPES=['REGISTER','RESERVE','STOP','UNKNOWN'];
const error=code=>new BridgeGuardError(code);
const empty=()=>({schema:1,revision:0,head:GENESIS,entries:[]});
function privateRoot(root){
  must(typeof root==='string'&&isAbsolute(root)&&resolve(root)===root,'STORE_PATH_INVALID');
  let s;try{s=lstatSync(root);}catch(e){if(e.code==='ENOENT')throw error('STORE_MISSING');throw e;}
  must(s.isDirectory()&&!s.isSymbolicLink()&&realpathSync(root)===root&&(s.mode&0o077)===0
    &&(process.getuid===undefined||s.uid===process.getuid()),'STORE_ROOT_UNSAFE');
}
function syncDir(root){
  const fd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY);
  try{fsyncSync(fd);}finally{closeSync(fd);}
}
function writeExclusive(path,body){
  const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,body,'utf8');fsyncSync(fd);}finally{closeSync(fd);}
}
function readStore(root){
  const fd=openSync(join(root,'journal.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
  let body;
  try{
    const s=fstatSync(fd);
    must(s.isFile()&&s.size<=LIMIT&&(s.mode&0o077)===0
      &&(process.getuid===undefined||s.uid===process.getuid()),'STORE_FILE_UNSAFE');
    body=readFileSync(fd,'utf8');
  }finally{closeSync(fd);}
  let state;try{state=JSON.parse(body);}catch{throw error('STORE_CORRUPT');}
  exactKeys(state,['schema','revision','head','entries'],'STORE_CORRUPT');
  must(state.schema===1&&Number.isSafeInteger(state.revision)&&state.revision>=0&&isHash(state.head)
    &&Array.isArray(state.entries)&&state.entries.length===state.revision&&state.entries.length<=128,'STORE_CORRUPT');
  let previous=GENESIS;
  const requests=new Map(),operations=new Map();
  for(let i=0;i<state.entries.length;i++){
    const e=state.entries[i];exactKeys(e,['hash','payload','previous','revision','type'],'STORE_CHAIN_INVALID');
    must(e.revision===i+1&&e.previous===previous&&TYPES.includes(e.type),'STORE_CHAIN_INVALID');
    must(e.hash===digest({revision:e.revision,previous:e.previous,type:e.type,payload:e.payload}),'STORE_CHAIN_INVALID');
    const p=e.payload;
    if(e.type==='REGISTER'){
      exactKeys(p,['request','fingerprint'],'STORE_HISTORY_INVALID');
      const r=validateRequest(p.request);
      must(p.fingerprint===r.fingerprint&&!requests.has(r.request.requestId)&&!operations.has(r.request.opId),'STORE_HISTORY_INVALID');
      requests.set(r.request.requestId,{request:r.request,fingerprint:r.fingerprint,status:'PLANNED'});
      operations.set(r.request.opId,r.request.requestId);
    }else{
      exactKeys(p,['requestId','fingerprint'],'STORE_HISTORY_INVALID');
      must(requests.has(p.requestId),'STORE_HISTORY_INVALID');
      const record=requests.get(p.requestId);
      must(record.fingerprint===p.fingerprint&&!['STOPPED','UNKNOWN'].includes(record.status),'STORE_HISTORY_INVALID');
      if(e.type==='RESERVE'){must(record.status==='PLANNED','STORE_HISTORY_INVALID');record.status='RESERVED_OFFLINE';}
      else record.status=e.type==='UNKNOWN'?'UNKNOWN':'STOPPED';
    }
    previous=e.hash;
  }
  must(previous===state.head,'STORE_CHAIN_INVALID');
  return {state,requests,operations};
}
const summarize=({state,requests})=>freeze({revision:state.revision,head:state.head,authorized:false,
  records:[...requests.values()]});
/** Explicit create-if-absent; incomplete initialization is a blocker, not a retry. */
export function createOfflineJournal(root){
  must(typeof root==='string'&&isAbsolute(root)&&resolve(root)===root,'STORE_PATH_INVALID');
  try{mkdirSync(root,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw error('STORE_ALREADY_EXISTS');throw e;}
  privateRoot(root);
  writeExclusive(join(root,'writer.lock'),'INITIALIZING_OFFLINE_ONLY\n');syncDir(root);
  writeExclusive(join(root,'journal.json'),JSON.stringify(empty())+'\n');syncDir(root);
  unlinkSync(join(root,'writer.lock'));syncDir(root);
  return openOfflineJournal(root);
}
export function openOfflineJournal(root){
  privateRoot(root);must(existsSync(join(root,'journal.json')),'STORE_MISSING');
  const locked=()=>must(!existsSync(join(root,'writer.lock')),'STORE_LOCKED_RECONCILE_REQUIRED');
  locked();readStore(root);
  const snapshot=()=>{privateRoot(root);locked();return summarize(readStore(root));};
  const mutate=(expected,makeEntry)=>{
    privateRoot(root);
    const token=data(expected);exactKeys(token,['head','revision'],'CAS_TOKEN_INVALID');
    must(Number.isSafeInteger(token.revision)&&token.revision>=0&&isHash(token.head),'CAS_TOKEN_INVALID');
    try{writeExclusive(join(root,'writer.lock'),'OFFLINE_WRITER_NO_AUTOMATIC_RECOVERY\n');}
    catch(e){if(e.code==='EEXIST')throw error('STORE_LOCKED_RECONCILE_REQUIRED');throw e;}
    // An exception before release leaves the lock. Do not catch/retry an uncertain result.
    syncDir(root);
    let current=readStore(root);
    must(current.state.revision===token.revision&&current.state.head===token.head,'CAS_CONFLICT_RECONCILE_REQUIRED');
    const spec=makeEntry(current);
    if(spec){
      must(current.state.entries.length<128,'STORE_CAPACITY_REACHED');
      const entry={revision:current.state.revision+1,previous:current.state.head,...spec};entry.hash=digest(entry);
      const next={schema:1,revision:entry.revision,head:entry.hash,entries:[...current.state.entries,entry]};
      const body=JSON.stringify(next)+'\n';must(Buffer.byteLength(body)<=LIMIT,'STORE_CAPACITY_REACHED');
      writeExclusive(join(root,'journal.pending'),body);
      renameSync(join(root,'journal.pending'),join(root,'journal.json'));syncDir(root);
      current=readStore(root);
      must(current.state.head===next.head&&current.state.revision===next.revision,'STORE_WRITE_UNCERTAIN');
    }
    // Capture the result while holding the lock. A later writer cannot change our return value.
    const result=summarize(current);
    unlinkSync(join(root,'writer.lock'));syncDir(root);
    return result;
  };
  const end=(type,request,expected)=>{
    const r=validateRequest(request);
    return mutate(expected,({requests})=>{
      const prior=requests.get(r.request.requestId);
      must(prior&&prior.fingerprint===r.fingerprint,'REQUEST_NOT_REGISTERED');
      must(!['UNKNOWN','STOPPED'].includes(prior.status),'REPLAY_NO_ACTION');
      return {type,payload:{requestId:r.request.requestId,fingerprint:r.fingerprint}};
    });
  };
  return Object.freeze({snapshot,
    register(request,expected){
      const r=validateRequest(request);
      return mutate(expected,({requests,operations})=>{
        const prior=requests.get(r.request.requestId);
        if(prior){must(prior.fingerprint===r.fingerprint,'DUPLICATE_SCOPE_CONFLICT');return null;}
        must(!operations.has(r.request.opId),'OP_ID_REUSED');
        return {type:'REGISTER',payload:{request:r.request,fingerprint:r.fingerprint}};
      });
    },
    reserve(request,expected){
      const r=validateRequest(request);
      return mutate(expected,({requests})=>{
        const prior=requests.get(r.request.requestId);
        must(prior&&prior.fingerprint===r.fingerprint,'REQUEST_NOT_REGISTERED');
        must(prior.status==='PLANNED','REPLAY_NO_ACTION');
        return {type:'RESERVE',payload:{requestId:r.request.requestId,fingerprint:r.fingerprint}};
      });
    },
    stop(request,expected){return end('STOP',request,expected);},
    markUnknown(request,expected){return end('UNKNOWN',request,expected);},
  });
}

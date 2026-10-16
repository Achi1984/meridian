// Trusted local Linux filesystem prototype. No network or autonomous execution.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {initialState} from './spot-lifecycle.mjs';
import {simulateSpotStep} from './spot-simulation-step.mjs';

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_RECORDS = 10003;
const MAX_RECORD_BYTES = 2048;
const SCHEMA = 'MERIDIAN_SYNTHETIC_SPOT_JOURNAL_V1';
const flags = {executionAuthorized:false,researchOnly:true};
const keys = (o,names) => o !== null && typeof o === 'object' &&
  Object.getPrototypeOf(o) === Object.prototype && Object.keys(o).length === names.length &&
  names.every(k => Object.hasOwn(o,k));
const fail = code => {const e=new Error(code);e.code=code;throw e;};
const reject = code => ({valid:false,code,...flags});
const success = journal => ({valid:true,version:journal.version,book:journal.book,...flags});
const paths = directory => {
  if(typeof directory !== 'string' || !path.isAbsolute(directory)) fail('INVALID_DIRECTORY');
  return {directory, journal:path.join(directory,'spot-journal.json'),lock:path.join(directory,'spot-journal.lock')};
};
function genesisBook(genesis) {
  if(!keys(genesis,['symbol','cashMicros']) || typeof genesis.symbol !== 'string' ||
    !/^[A-Z0-9][A-Z0-9._-]{0,19}(?![\s\S])/.test(genesis.symbol) ||
    typeof genesis.cashMicros !== 'string' ||
    !/^(?:0|[1-9][0-9]{0,29})(?![\s\S])/.test(genesis.cashMicros)) fail('INVALID_GENESIS');
  return {symbol:genesis.symbol,lifecycle:initialState(),account:{currency:'EUR',
    cashMicros:genesis.cashMicros,positions:[],processedFillIds:[]}};
}
function replay(journal) {
  if(!keys(journal,['schemaVersion','genesis','version','records','book']) ||
    journal.schemaVersion !== SCHEMA || !Array.isArray(journal.records) ||
    journal.records.length > MAX_RECORDS || journal.version !== journal.records.length)
    fail('INVALID_JOURNAL_SCHEMA');
  // Bound every record before any replay, including malformed records.
  for(const record of journal.records) {
    if(!keys(record,['envelope','policy']) || Buffer.byteLength(JSON.stringify(record)) > MAX_RECORD_BYTES)
      fail('INVALID_RECORD');
  }
  let book=genesisBook(journal.genesis);
  for(const record of journal.records) {
    const result=simulateSpotStep(book,record.envelope,record.policy);
    if(!result.valid) fail('INVALID_REPLAY');
    book=result.book;
  }
  if(!isDeepStrictEqual(book,journal.book)) fail('BOOK_REPLAY_MISMATCH');
  return journal;
}
async function load(p) {
  const handle=await fs.open(p.journal,'r');
  try {
    const stat=await handle.stat();
    if(!stat.isFile() || stat.size > MAX_BYTES) fail('JOURNAL_TOO_LARGE_OR_NOT_FILE');
    // Explicit bounded read rather than readFile: a file growing after stat cannot
    // cause unbounded allocation. Concurrent external modification is unsupported.
    const buffer=Buffer.alloc(stat.size+1);
    let length=0;
    while(length < buffer.length) {
      const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);
      if(!bytesRead) break;
      length+=bytesRead;
    }
    if(length !== stat.size) fail('JOURNAL_CHANGED_DURING_READ');
    let parsed;
    try {parsed=JSON.parse(buffer.subarray(0,length).toString('utf8'));}
    catch {fail('INVALID_JOURNAL_JSON');}
    return replay(parsed);
  } finally {await handle.close();}
}
async function acquire(p) {
  let handle;
  try {handle=await fs.open(p.lock,'wx',0o600);}
  catch(error) {if(error.code === 'EEXIST') fail('LOCKED');throw error;}
  const token=randomUUID();
  try {await handle.writeFile(token);await handle.sync();return {handle,token,stat:await handle.stat()};}
  catch(error) {await handle.close();throw error;} // Leave uncertain lock for manual recovery.
}
async function release(p,owner) {
  // Cooperative writers never replace a held lock. Check inode and token before
  // unlinking; foreign/replaced/missing locks are never removed by this owner.
  try {
    const stat=await fs.lstat(p.lock);
    if(!stat.isFile() || stat.dev !== owner.stat.dev || stat.ino !== owner.stat.ino ||
      await fs.readFile(p.lock,'utf8') !== owner.token) return false;
    await fs.unlink(p.lock);return true;
  } catch(error) {if(error.code === 'ENOENT') return false;throw error;}
}
async function directorySync(p) {
  const handle=await fs.open(p.directory,'r');
  try {await handle.sync();} finally {await handle.close();}
}
async function writeUnderLock(p, owner, journal, create) {
  const text=JSON.stringify(journal)+'\n';
  if(Buffer.byteLength(text) > MAX_BYTES) fail('JOURNAL_TOO_LARGE');
  const temp=path.join(p.directory,`spot-journal.${owner.token}.tmp`);
  let handle, tempOwned=false, publicationAttempted=false;
  try {
    handle=await fs.open(temp,'wx',0o600);
    tempOwned=true;
    await handle.writeFile(text);await handle.sync();await handle.close();handle=null;
    // Initial link is an atomic no-replace publication; later commits use rename.
    publicationAttempted=true;
    if(create) {await fs.link(temp,p.journal);await fs.unlink(temp);}
    else await fs.rename(temp,p.journal);
    await directorySync(p);
  } catch(error) {
    if(publicationAttempted && !(create && error.code === 'EEXIST')) {
      owner.retain=true;fail('COMMIT_UNKNOWN');
    }
    throw error;
  } finally {
    if(handle) await handle.close();
    // Only this operation's randomly named temp; never touch another writer's file.
    if(tempOwned && !owner.retain) await fs.unlink(temp).catch(e=>{if(e.code !== 'ENOENT') throw e;});
  }
}
async function locked(p, action) {
  let owner, result;
  try {
    owner=await acquire(p);
    result=await action(owner);
  } catch(error) {result=reject(error.code || 'IO_ERROR');}
  finally {
    if(owner) {
      await owner.handle.close().catch(()=>{});
      if(!owner.retain) {
        // Cleanup failure after a published commit must not imply rollback.
        try {if(!await release(p,owner)) result=reject(result?.valid ? 'COMMIT_UNKNOWN' : 'LOCK_OWNERSHIP_CHANGED');}
        catch {result=reject(result?.valid ? 'COMMIT_UNKNOWN' : 'LOCK_CLEANUP_FAILED');}
      }
    }
  }
  return result;
}

export async function createSpotJournal(input) {
  try {
    if(!keys(input,['directory','symbol','cashMicros'])) fail('INVALID_CREATE_INPUT');
    const p=paths(input.directory),genesis={symbol:input.symbol,cashMicros:input.cashMicros};
    const journal={schemaVersion:SCHEMA,genesis,version:0,records:[],book:genesisBook(genesis)};
    return await locked(p,async owner=>{
      try {await fs.lstat(p.journal);return reject('JOURNAL_ALREADY_EXISTS');}
      catch(error) {if(error.code !== 'ENOENT') throw error;}
      await writeUnderLock(p,owner,journal,true);return success(journal);
    });
  } catch(error) {return reject(error.code || 'IO_ERROR');}
}

export async function readSpotJournal(input) {
  try {
    if(!keys(input,['directory'])) fail('INVALID_READ_INPUT');
    return success(await load(paths(input.directory)));
  } catch(error) {return reject(error.code || 'IO_ERROR');}
}

export async function commitSpotJournalStep(input) {
  try {
    if(!keys(input,['directory','expectedVersion','envelope','policy']) ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
      fail('INVALID_COMMIT_INPUT');
    const p=paths(input.directory);
    const expectedVersion=input.expectedVersion;
    // Snapshot caller input before awaiting the filesystem.
    const record=structuredClone({envelope:input.envelope,policy:input.policy});
    if(!isDeepStrictEqual(record,JSON.parse(JSON.stringify(record)))) fail('NON_JSON_RECORD');
    if(Buffer.byteLength(JSON.stringify(record)) > MAX_RECORD_BYTES) fail('INVALID_RECORD');
    return await locked(p,async owner=>{
      const journal=await load(p);
      if(journal.version !== expectedVersion) return reject('VERSION_CONFLICT');
      if(journal.records.length === MAX_RECORDS) return reject('RECORD_CAPACITY');
      const result=simulateSpotStep(journal.book,record.envelope,record.policy);
      if(!result.valid) return reject(`STEP_REJECTED:${result.errors.join(',')}`);
      const next={...journal,version:journal.version+1,records:[...journal.records,record],book:result.book};
      await writeUnderLock(p,owner,next,false);return success(next);
    });
  } catch(error) {return reject(error.code || 'IO_ERROR');}
}

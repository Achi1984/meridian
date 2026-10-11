"""Source-only same-host SQLite inbox. No network, models or external effects."""
import hashlib
import json
import os
import pathlib
import re
import sqlite3

MAX_EVENTS=1000
MAX_STORED_BYTES=1048576
MAX_RESULT_BYTES=512
MAX_CONTINUATION_BYTES=16384
MAX_INT=9007199254740991
FIELDS={'repository','eventIdentity','revisionDigest','headSha','baseSha','payloadSha256'}

class InboxError(ValueError):
    def __init__(self,code):super().__init__(code);self.code=code

def need(ok,code):
    if not ok:raise InboxError(code)

def _digest(value):return type(value) is str and re.fullmatch(r'[a-f0-9]{64}',value)
def _sha(value):return type(value) is str and re.fullmatch(r'[a-f0-9]{40}',value)
def _owner(value):return type(value) is str and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,79}',value)
def _canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False)
def _path(database):
    try:path=os.fspath(database)
    except TypeError:raise InboxError('DATABASE_INVALID')
    need(type(path) is str and path and path!=':memory:' and '\0' not in path and len(path.encode())<=4096,'DATABASE_INVALID')
    return pathlib.Path(path).absolute()
def _validate(binding):
    need(type(binding) is dict and set(binding)==FIELDS,'BINDING_SCHEMA')
    need(binding['repository']=='Achi1984/meridian','REPOSITORY_INVALID')
    identity=binding['eventIdentity'];need(type(identity) is str and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,319}',identity),'EVENT_IDENTITY_INVALID')
    need(_sha(binding['headSha']) and _sha(binding['baseSha']),'SHA_INVALID')
    need(_digest(binding['revisionDigest']) and _digest(binding['payloadSha256']),'DIGEST_INVALID')
    return _canonical(binding)
def _key(binding):return hashlib.sha256(_canonical([binding['repository'],binding['eventIdentity'],binding['revisionDigest']]).encode()).hexdigest()

def _projection(raw,binding):
    need(type(raw) is str,'CONTINUATION_REQUIRED')
    try:need(len(raw.encode('utf-8'))<=MAX_CONTINUATION_BYTES,'CONTINUATION_BOUND')
    except UnicodeError:raise InboxError('CONTINUATION_INVALID')
    def pairs(items):
        obj={}
        for key,value in items:
            need(key not in obj,'CONTINUATION_INVALID');obj[key]=value
        return obj
    try:value=json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:need(False,'CONTINUATION_INVALID'))
    except (ValueError,RecursionError):raise InboxError('CONTINUATION_INVALID')
    flags={'authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable'}
    need(type(value) is dict and set(value)=={'kind','decision','reason','eventIdentity','revisionDigest','packetId','ledger'}|flags,'CONTINUATION_SCHEMA')
    need(value['kind']=='OFFLINE_CONTINUATION_DECISION' and all(value[k] is False for k in flags),'CONTINUATION_AUTHORITY')
    need(value['eventIdentity']==binding['eventIdentity'] and value['revisionDigest']==binding['revisionDigest'],'CONTINUATION_EVENT_MISMATCH')
    need(value['decision'] in ('READY_FOR_OWNER_DECISION','WAITING_REVIEW','WAITING_CI','WAITING_AGENT','WAITING_DRAFT','BLOCKED','RECONCILE_NEW_MANIFEST','RECONCILE_EVENT'),'CONTINUATION_DECISION')
    need(type(value['reason']) is str and re.fullmatch(r'[A-Z][A-Z0-9_]{0,119}',value['reason']),'CONTINUATION_REASON')
    ledger=value['ledger'];lf={'dispatchAllowed','mergeAllowed','authenticated','durable'}
    need(type(ledger) is dict and set(ledger)=={'kind','manifestDigest','revision','revoked','packets'}|lf,'CONTINUATION_LEDGER_SCHEMA')
    need(ledger['kind']=='OFFLINE_CLAIMS_ONLY' and _digest(ledger['manifestDigest']) and type(ledger['revision']) is int and 0<=ledger['revision']<=MAX_INT
         and type(ledger['revoked']) is bool and all(ledger[k] is False for k in lf),'CONTINUATION_LEDGER_INVALID')
    packets=ledger['packets'];need(type(packets) is list and 1<=len(packets)<=8,'CONTINUATION_PACKETS')
    ids=set();active=None;busy=0
    for index,item in enumerate(packets):
        need(type(item) is dict and set(item)=={'id','state','baseSha','headSha','ciHeadSha','reviewHeadSha','mergeSha'},'CONTINUATION_PACKET_SCHEMA')
        need(type(item['id']) is str and re.fullmatch(r'[a-z][a-z0-9-]{0,63}',item['id']) and item['id'] not in ids,'CONTINUATION_PACKET_ID')
        ids.add(item['id']);state=item['state'];need(state in ('READY','CLAIMED','GENERATING','CI_WAIT','REVIEW_WAIT','COMPLETE_DRAFT','MERGE_WAIT','COMPLETE_MERGED','FAILED','UNKNOWN_OUTCOME'),'CONTINUATION_STATE')
        for k in ('baseSha','headSha','ciHeadSha','reviewHeadSha','mergeSha'):need(item[k] is None or _sha(item[k]),'CONTINUATION_SHA')
        if state=='READY':need(all(item[k] is None for k in ('baseSha','headSha','ciHeadSha','reviewHeadSha','mergeSha')),'CONTINUATION_HISTORY')
        else:need(item['baseSha']==binding['baseSha'],'CONTINUATION_BASE_MISMATCH')
        if item['headSha'] is not None:need(item['headSha']!=item['baseSha'],'CONTINUATION_SHA')
        if state in ('CLAIMED','GENERATING'):need(all(item[k] is None for k in ('headSha','ciHeadSha','reviewHeadSha','mergeSha')),'CONTINUATION_HISTORY')
        if state in ('CI_WAIT','REVIEW_WAIT','COMPLETE_DRAFT','MERGE_WAIT','COMPLETE_MERGED'):need(_sha(item['headSha']),'CONTINUATION_HISTORY')
        if state=='CI_WAIT':need(all(item[k] is None for k in ('ciHeadSha','reviewHeadSha','mergeSha')),'CONTINUATION_HISTORY')
        if state in ('REVIEW_WAIT','COMPLETE_DRAFT','MERGE_WAIT','COMPLETE_MERGED'):need(item['ciHeadSha']==item['headSha'],'CONTINUATION_HISTORY')
        if state=='REVIEW_WAIT':need(item['reviewHeadSha'] is None and item['mergeSha'] is None,'CONTINUATION_HISTORY')
        if state in ('COMPLETE_DRAFT','MERGE_WAIT','COMPLETE_MERGED'):need(item['reviewHeadSha']==item['headSha'],'CONTINUATION_HISTORY')
        if state=='COMPLETE_DRAFT':need(item['mergeSha'] is None,'CONTINUATION_HISTORY')
        if state in ('MERGE_WAIT','COMPLETE_MERGED'):need(_sha(item['mergeSha']),'CONTINUATION_HISTORY')
        if ledger['revoked']:need(state=='READY' or (state in ('FAILED','UNKNOWN_OUTCOME') and item['ciHeadSha'] is None and item['reviewHeadSha'] is None),'CONTINUATION_REVOKED')
        if not ledger['revoked'] and state not in ('READY','FAILED','UNKNOWN_OUTCOME'):
            need(all(previous['state'] in ('COMPLETE_DRAFT','MERGE_WAIT','COMPLETE_MERGED') for previous in packets[:index]),'CONTINUATION_PACKET_ORDER')
        if state in ('CLAIMED','GENERATING','CI_WAIT','REVIEW_WAIT','MERGE_WAIT','UNKNOWN_OUTCOME'):busy+=1
        if item['id']==value['packetId']:active=item
    need(active is not None and (ledger['revoked'] or busy<=1),'CONTINUATION_ACTIVE')
    need(active['headSha'] is None or active['headSha']==binding['headSha'],'CONTINUATION_HEAD_MISMATCH')
    if value['decision']=='READY_FOR_OWNER_DECISION':need(active['state']=='COMPLETE_DRAFT' and not ledger['revoked'],'CONTINUATION_READINESS')
    canonical=_canonical(value);need(len(canonical.encode())<=MAX_CONTINUATION_BYTES,'CONTINUATION_BOUND')
    return canonical

def _projection_digest(binding_json,continuation_json):
    return hashlib.sha256((binding_json+'\n'+continuation_json).encode()).hexdigest()

def initialize(database):
    """Explicit local provisioning only; existing/missing-corrupt stores never reset."""
    path=_path(database)
    try:fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
    except FileExistsError:raise InboxError('DATABASE_EXISTS')
    except OSError:raise InboxError('DATABASE_CREATE_FAILED')
    connection=None
    try:
        connection=sqlite3.connect(str(path),isolation_level=None)
        connection.execute('PRAGMA page_size=4096');connection.execute('PRAGMA synchronous=FULL');connection.execute('PRAGMA max_page_count=1024')
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), fence INTEGER NOT NULL, active TEXT)')
        connection.execute('INSERT INTO meta VALUES (1,0,NULL)')
        connection.execute('''CREATE TABLE events (event_id TEXT PRIMARY KEY, binding TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('QUEUED','CLAIMED','STARTED','COMPLETE','UNKNOWN')),
            owner TEXT, fence INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1),
            result_sha TEXT, result_json TEXT, continuation_json TEXT, continuation_sha TEXT)''')
        connection.execute('PRAGMA user_version=2');connection.commit()
    except sqlite3.Error:raise InboxError('DATABASE_CREATE_FAILED')
    finally:
        if connection is not None:connection.close()
    return {'initialized':True,'authenticated':False,'dispatchAllowed':False,'mergeAllowed':False}

def _connection(database):
    path=_path(database)
    try:
        c=sqlite3.connect(path.as_uri()+'?mode=rw',uri=True,timeout=5,isolation_level=None)
        c.execute('PRAGMA synchronous=FULL');c.execute('PRAGMA max_page_count=1024');c.execute('BEGIN IMMEDIATE')
        need(c.execute('PRAGMA user_version').fetchone()==(2,),'DATABASE_SCHEMA')
        need(c.execute('PRAGMA page_size').fetchone()==(4096,),'DATABASE_SCHEMA')
        need(c.execute('SELECT COUNT(*) FROM meta').fetchone()==(1,),'DATABASE_SCHEMA')
        return c
    except (sqlite3.Error,InboxError) as error:
        if 'c' in locals():c.close()
        if isinstance(error,InboxError):raise
        raise InboxError('DATABASE_UNAVAILABLE')

def _receipt(row):
    need(row is not None,'EVENT_NOT_FOUND')
    event_id,binding,state,owner,fence,attempts,result_sha,result_json,continuation_json,continuation_sha=row
    decoded=json.loads(binding);need(_validate(decoded)==binding and _key(decoded)==event_id,'STORED_BINDING_CORRUPT')
    if state in ('COMPLETE','UNKNOWN'):need(_digest(result_sha),'STORED_RESULT_DIGEST')
    else:need(result_sha is None and result_json is None,'STORED_RESULT_STATE')
    summary=None
    if result_json is not None:
        need(type(result_json) is str and len(result_json.encode())<=MAX_RESULT_BYTES,'STORED_SUMMARY_INVALID')
        def unique(items):
            out={}
            for key,value in items:need(key not in out,'STORED_SUMMARY_INVALID');out[key]=value
            return out
        try:summary=json.loads(result_json,object_pairs_hook=unique)
        except (ValueError,RecursionError):raise InboxError('STORED_SUMMARY_INVALID')
        need(type(summary) is dict and set(summary)=={'decision','reason'} and type(summary['reason']) is str
             and re.fullmatch(r'[A-Z][A-Z0-9_]{0,119}',summary['reason']),'STORED_SUMMARY_INVALID')
        need(state!='UNKNOWN' or summary['decision']=='UNKNOWN','STORED_SUMMARY_INVALID')

    if continuation_json is not None:
        need(state=='COMPLETE' and _digest(continuation_sha),'STORED_CONTINUATION_INVALID')
        need(_projection(continuation_json,decoded)==continuation_json and _projection_digest(binding,continuation_json)==continuation_sha,'STORED_CONTINUATION_DIGEST')
        if summary is not None:need(all(summary[k]==json.loads(continuation_json)[k] for k in ('decision','reason')),'STORED_SUMMARY_MISMATCH')
    else:need(state!='COMPLETE' and continuation_sha is None,'STORED_CONTINUATION_MISSING')
    return {'eventId':event_id,'binding':json.loads(binding),'state':state,'owner':owner,'fence':fence,'attempts':attempts,
            'resultSha256':result_sha,'resultJson':result_json,'continuationJson':continuation_json,'continuationSha256':continuation_sha,'authenticated':False,'provenanceVerified':False,
            'authorized':False,'dispatchAllowed':False,'mergeAllowed':False,'mayWrite':False,'distributed':False}

def _run(database,operation):
    c=_connection(database)
    try:
        value=operation(c);c.commit();return value
    except sqlite3.Error:raise InboxError('INBOX_STORAGE_ERROR')
    finally:
        if c.in_transaction:c.rollback()
        c.close()

def _usage(c):return c.execute('SELECT COUNT(*),COALESCE(SUM(length(CAST(binding AS BLOB))+COALESCE(length(CAST(result_json AS BLOB)),0)+COALESCE(length(CAST(continuation_json AS BLOB)),0)),0) FROM events').fetchone()

def enqueue(database,binding):
    serialized=_validate(binding);event_id=_key(binding)
    def op(c):
        row=c.execute('SELECT * FROM events WHERE event_id=?',(event_id,)).fetchone()
        if row:
            need(row[1]==serialized,'EVENT_REVISION_CONFLICT');return _receipt(row)
        count,total=_usage(c);need(count<MAX_EVENTS and total+len(serialized.encode())<=MAX_STORED_BYTES,'INBOX_CAPACITY')
        c.execute("INSERT INTO events(event_id,binding,state) VALUES (?,?,'QUEUED')",(event_id,serialized))
        return _receipt(c.execute('SELECT * FROM events WHERE event_id=?',(event_id,)).fetchone())
    return _run(database,op)

def claim(database,event_id,owner):
    need(_digest(event_id) and _owner(owner),'CLAIM_INPUT')
    def op(c):
        row=c.execute('SELECT * FROM events WHERE event_id=?',(event_id,)).fetchone();need(row is not None,'EVENT_NOT_FOUND')
        need(row[2]=='QUEUED' and row[5]==0,'ATTEMPT_CONSUMED')
        fence,active=c.execute('SELECT fence,active FROM meta WHERE id=1').fetchone()
        need(active is None,'INBOX_BUSY');need(type(fence) is int and 0<=fence<MAX_INT,'FENCE_EXHAUSTED')
        fence+=1
        c.execute('UPDATE events SET state=?,owner=?,fence=?,attempts=1 WHERE event_id=?',('CLAIMED',owner,fence,event_id))
        c.execute('UPDATE meta SET fence=?,active=? WHERE id=1',(fence,event_id))
        return _receipt(c.execute('SELECT * FROM events WHERE event_id=?',(event_id,)).fetchone())
    return _run(database,op)

def _bound(c,receipt):
    need(type(receipt) is dict and _digest(receipt.get('eventId')) and _owner(receipt.get('owner'))
         and type(receipt.get('fence')) is int and 1<=receipt['fence']<=MAX_INT,'RECEIPT_INVALID')
    row=c.execute('SELECT * FROM events WHERE event_id=?',(receipt['eventId'],)).fetchone();need(row is not None,'EVENT_NOT_FOUND')
    need(row[3]==receipt['owner'] and row[4]==receipt['fence'] and json.loads(row[1])==receipt.get('binding'),'STALE_CLAIM')
    need(c.execute('SELECT fence,active FROM meta WHERE id=1').fetchone()==(receipt['fence'],receipt['eventId']),'STALE_FENCE')
    return row

def start(database,receipt):
    def op(c):
        row=_bound(c,receipt);need(row[2]=='CLAIMED','ALREADY_STARTED_OR_TERMINAL')
        c.execute("UPDATE events SET state='STARTED' WHERE event_id=?",(row[0],))
        return _receipt(c.execute('SELECT * FROM events WHERE event_id=?',(row[0],)).fetchone())
    return _run(database,op)

def _finish(database,receipt,outcome,result_sha256,result_json,continuation_json=None):
    need(_digest(result_sha256),'RESULT_DIGEST_INVALID')
    need(result_json is None or type(result_json) is str,'RESULT_INVALID')
    if result_json is not None:
        try:raw=result_json.encode('utf-8')
        except UnicodeError:raise InboxError('RESULT_INVALID')
        need(len(raw)<=MAX_RESULT_BYTES,'RESULT_BOUND')
        def pairs(items):
            obj={}
            for key,value in items:
                need(key not in obj,'RESULT_INVALID');obj[key]=value
            return obj
        try:summary=json.loads(result_json,object_pairs_hook=pairs)
        except (ValueError,RecursionError):raise InboxError('RESULT_INVALID')
        need(type(summary) is dict and set(summary)=={'decision','reason'},'RESULT_INVALID')
        need(summary['decision'] in ('READY_FOR_OWNER_DECISION','WAITING_REVIEW','WAITING_CI','WAITING_AGENT','WAITING_DRAFT','BLOCKED','RECONCILE_NEW_MANIFEST','RECONCILE_EVENT','UNKNOWN'),'RESULT_INVALID')
        need(type(summary['reason']) is str and re.fullmatch(r'[A-Z][A-Z0-9_]{0,119}',summary['reason']),'RESULT_INVALID')
        need((summary['decision']=='UNKNOWN')==(outcome=='UNKNOWN'),'OUTCOME_SUMMARY_CONFLICT')
    def op(c):
        row=_bound(c,receipt)
        need(row[2] in (('STARTED',) if outcome=='COMPLETE' else ('CLAIMED','STARTED')),'INVALID_SETTLEMENT')
        need(outcome=='COMPLETE' or continuation_json is None,'UNKNOWN_HAS_CONTINUATION')
        projection=_projection(continuation_json,json.loads(row[1])) if outcome=='COMPLETE' else None
        projection_sha=_projection_digest(row[1],projection) if projection is not None else None
        if result_json is not None and projection is not None:
            summary=json.loads(result_json);record=json.loads(projection)
            need(all(summary[k]==record[k] for k in ('decision','reason')),'CONTINUATION_SUMMARY_MISMATCH')

        count,total=_usage(c);need(total+(len(result_json.encode()) if result_json is not None else 0)+(len(projection.encode()) if projection is not None else 0)<=MAX_STORED_BYTES,'INBOX_CAPACITY')
        c.execute('UPDATE events SET state=?,result_sha=?,result_json=?,continuation_json=?,continuation_sha=? WHERE event_id=?',(outcome,result_sha256,result_json,projection,projection_sha,row[0]))
        if outcome=='COMPLETE':c.execute('UPDATE meta SET active=NULL WHERE id=1')
        return _receipt(c.execute('SELECT * FROM events WHERE event_id=?',(row[0],)).fetchone())
    return _run(database,op)

def complete(database,receipt,result_sha256,result_json=None,continuation_json=None):return _finish(database,receipt,'COMPLETE',result_sha256,result_json,continuation_json)
def unknown(database,receipt,result_sha256,result_json=None):return _finish(database,receipt,'UNKNOWN',result_sha256,result_json)
def inspect_event(database,event_id):
    need(_digest(event_id),'EVENT_ID_INVALID')
    return _run(database,lambda c:_receipt(c.execute('SELECT * FROM events WHERE event_id=?',(event_id,)).fetchone()))

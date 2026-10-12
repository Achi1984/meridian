"""Local one-use check journal; integrity is not authentication or execution proof."""
import json
import os
from pathlib import Path
import re
import sqlite3
from datetime import datetime
import check_executor as executor

MAX_ROWS=1000
MAX_BYTES=1048576
class JournalError(ValueError):pass
def need(ok,code):
    if not ok:raise JournalError(code)
def canonical(x):return executor.canonical(x)
def sha(x):return type(x) is str and re.fullmatch('[a-f0-9]{64}',x)
def binding(scope,check_id,command_sha256):
    try:executor._scope(scope)
    except ValueError:raise JournalError('SCOPE_INVALID') from None
    need(check_id==executor.CHECK_ID and command_sha256==executor.COMMAND_SHA256,'CATALOG_MISMATCH')
    return canonical({'scope':scope,'checkId':check_id,'commandSha256':command_sha256})
def identity(raw):return executor.digest(raw.encode())
def path(db):
    need(isinstance(db,(str,os.PathLike)),'DATABASE_PATH')
    p=os.fspath(db);need(type(p) is str and p and p!=':memory:' and '\0' not in p and len(p.encode())<=4096,'DATABASE_PATH')
    return Path(p).absolute()
def initialize(db):
    p=path(db)
    try:fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
    except OSError:raise JournalError('DATABASE_CREATE_FAILED') from None
    c=sqlite3.connect(str(p))
    try:
        c.execute('PRAGMA page_size=4096');c.execute('PRAGMA synchronous=FULL');c.execute('PRAGMA max_page_count=1024')
        c.execute('CREATE TABLE meta(id INTEGER PRIMARY KEY CHECK(id=1),fence INTEGER NOT NULL,active TEXT)')
        c.execute('INSERT INTO meta VALUES(1,0,NULL)')
        c.execute('CREATE TABLE checks(key TEXT PRIMARY KEY,binding TEXT NOT NULL,state TEXT NOT NULL,fence INTEGER NOT NULL,receipt TEXT,digest TEXT)')
        c.execute('PRAGMA user_version=1');c.commit()
    except sqlite3.Error:raise JournalError('DATABASE_CREATE_FAILED') from None
    finally:c.close()

def run(db,op):
    c=None
    try:
        c=sqlite3.connect(path(db).as_uri()+'?mode=rw',uri=True,isolation_level=None,timeout=5)
        c.execute('PRAGMA synchronous=FULL');c.execute('PRAGMA max_page_count=1024');c.execute('BEGIN IMMEDIATE')
        need(c.execute('PRAGMA user_version').fetchone()==(1,) and c.execute('PRAGMA page_size').fetchone()==(4096,),'DATABASE_SCHEMA')
        need(c.execute('SELECT COUNT(*) FROM meta').fetchone()==(1,),'DATABASE_SCHEMA')
        store_invariants(c)
        result=op(c);store_invariants(c);c.commit();return result
    except sqlite3.Error:raise JournalError('DATABASE_UNAVAILABLE') from None
    finally:
        if c is not None:c.close()

def validate_receipt(receipt,b):
    need(type(receipt) is dict,'RECEIPT_SCHEMA')
    keys={'kind','scope','commandSha256','exitCode','stdoutSha256','stderrSha256','startedAt','finishedAt','evidenceSha256','check'}|set(executor.FLAGS)
    need(set(receipt)==keys,'RECEIPT_SCHEMA')
    need(receipt['kind']=='LOCAL_CHECK_EXECUTION' and canonical(receipt['scope'])==canonical(b['scope']) and receipt['commandSha256']==b['commandSha256'],'RECEIPT_BINDING')
    need(all(receipt[k] is False for k in executor.FLAGS),'RECEIPT_AUTHORITY')
    code=receipt['exitCode'];need(type(code) is int and 0<=code<=255,'RECEIPT_EXIT')
    need(all(sha(receipt[k]) for k in ('stdoutSha256','stderrSha256','evidenceSha256')),'RECEIPT_HASH')
    times=[]
    for k in ('startedAt','finishedAt'):
        value=receipt[k];need(type(value) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z',value),'RECEIPT_TIME')
        try:times.append(datetime.fromisoformat(value.replace('Z','+00:00')))
        except ValueError:raise JournalError('RECEIPT_TIME') from None
    need(times[1]>=times[0],'RECEIPT_TIME')
    record={k:v for k,v in receipt.items() if k not in ('evidenceSha256','check')}
    need(executor.digest(canonical(record).encode())==receipt['evidenceSha256'],'RECEIPT_EVIDENCE')
    expected={'id':b['checkId'],'commandSha256':b['commandSha256'],'executed':True,'status':'passed' if code==0 else 'failed','exitCode':code,'evidenceSha256':receipt['evidenceSha256'],**{k:b['scope'][k] for k in ('headSha','baseSha','requestId','opId','prNumber','ci')}}
    need(canonical(receipt['check'])==canonical(expected),'RECEIPT_CHECK')
    raw=canonical(receipt);need(len(raw.encode())<=8192,'RECEIPT_BOUND');return raw

def decode(raw):
    def pairs(items):
        d={}
        for k,v in items:need(k not in d,'STORED_JSON');d[k]=v
        return d
    try:return json.loads(raw,object_pairs_hook=pairs)
    except (ValueError,TypeError,RecursionError):raise JournalError('STORED_JSON') from None

def read(row):
    need(row is not None,'NOT_FOUND');key,raw,state,fence,receipt,digest=row;b=decode(raw)
    need(type(b) is dict and set(b)=={'scope','checkId','commandSha256'},'STORED_BINDING')
    need(binding(b['scope'],b['checkId'],b['commandSha256'])==raw and identity(raw)==key,'STORED_BINDING')
    need(state in ('RESERVED','STARTED','COMPLETE','UNKNOWN') and type(fence) is int and 0<fence<=9007199254740991,'STORED_STATE')
    value=None
    if state=='COMPLETE':
        value=decode(receipt);need(validate_receipt(value,b)==receipt and sha(digest) and identity(raw+'\n'+receipt)==digest,'STORED_RECEIPT')
    else:need(receipt is None and digest is None,'STORED_STATE')
    return {'key':key,**b,'state':state,'fence':fence,'receipt':value}

def store_invariants(c):
    count,total=c.execute('SELECT COUNT(*),COALESCE(SUM(length(binding)+COALESCE(length(receipt),0)),0) FROM checks').fetchone()
    need(count<=MAX_ROWS and total<=MAX_BYTES,'STORED_CAPACITY')
    rows=[read(row) for row in c.execute('SELECT * FROM checks')]
    meta=c.execute('SELECT id,fence,active FROM meta').fetchone()
    need(meta is not None and meta[0]==1 and type(meta[1]) is int and 0<=meta[1]<=9007199254740991,'STORED_META')
    fences=[row['fence'] for row in rows]
    need(len(set(fences))==len(fences) and meta[1]==max(fences,default=0),'STORED_FENCE')
    unresolved=[row for row in rows if row['state']!='COMPLETE']
    need(len(unresolved)<=1,'STORED_ACTIVE')
    if unresolved:
        need((meta[2],meta[1])==(unresolved[0]['key'],unresolved[0]['fence']),'STORED_ACTIVE')
    else:need(meta[2] is None,'STORED_ACTIVE')

def reserve(db,scope,check_id,command_sha256):
    raw=binding(scope,check_id,command_sha256);key=identity(raw)
    def op(c):
        need(c.execute('SELECT 1 FROM checks WHERE key=?',(key,)).fetchone() is None,'ATTEMPT_CONSUMED')
        fence,active=c.execute('SELECT fence,active FROM meta WHERE id=1').fetchone();need(active is None,'JOURNAL_BUSY')
        need(type(fence) is int and 0<=fence<9007199254740991,'FENCE_INVALID')
        count,total=c.execute('SELECT COUNT(*),COALESCE(SUM(length(binding)+COALESCE(length(receipt),0)),0) FROM checks').fetchone()
        need(count<MAX_ROWS and total+len(raw.encode())<=MAX_BYTES,'JOURNAL_CAPACITY')
        c.execute('INSERT INTO checks VALUES(?,?,?, ?,NULL,NULL)',(key,raw,'RESERVED',fence+1));c.execute('UPDATE meta SET fence=?,active=? WHERE id=1',(fence+1,key))
        return read(c.execute('SELECT * FROM checks WHERE key=?',(key,)).fetchone())
    return run(db,op)

def settle(db,reservation,state,receipt=None):
    need(type(reservation) is dict and sha(reservation.get('key')),'RESERVATION_INVALID')
    def op(c):
        row=c.execute('SELECT * FROM checks WHERE key=?',(reservation['key'],)).fetchone();stored=read(row)
        need(all(canonical(stored.get(k))==canonical(reservation.get(k)) for k in ('key','scope','checkId','commandSha256','fence')),'STALE_RESERVATION')
        need(c.execute('SELECT fence,active FROM meta WHERE id=1').fetchone()==(stored['fence'],stored['key']),'STALE_FENCE')
        need(stored['state'] in ({'STARTED':['RESERVED'],'COMPLETE':['STARTED'],'UNKNOWN':['RESERVED','STARTED']}[state]),'ATTEMPT_CONSUMED')
        raw=validate_receipt(receipt,stored) if state=='COMPLETE' else None
        if raw:
            total=c.execute('SELECT COALESCE(SUM(length(binding)+COALESCE(length(receipt),0)),0) FROM checks').fetchone()[0]
            need(total+len(raw.encode())<=MAX_BYTES,'JOURNAL_CAPACITY')
        digest=identity(row[1]+'\n'+raw) if raw else None
        c.execute('UPDATE checks SET state=?,receipt=?,digest=? WHERE key=?',(state,raw,digest,stored['key']))
        if state=='COMPLETE':c.execute('UPDATE meta SET active=NULL WHERE id=1')
        return read(c.execute('SELECT * FROM checks WHERE key=?',(stored['key'],)).fetchone())
    return run(db,op)
def mark_started(db,reservation):return settle(db,reservation,'STARTED')
def complete(db,reservation,receipt):return settle(db,reservation,'COMPLETE',receipt)
def mark_unknown(db,reservation):return settle(db,reservation,'UNKNOWN')
def recover(db,scope,check_id,command_sha256):
    raw=binding(scope,check_id,command_sha256)
    return run(db,lambda c:read(c.execute('SELECT * FROM checks WHERE key=?',(identity(raw),)).fetchone()))

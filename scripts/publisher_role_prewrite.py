"""Fresh catalog/grant/role observations on an existing write transaction.

CatalogPrewrite(baseline)(connection, binding) is the injected driver's prewrite
callable; success returns None and last_report contains observations. It requires
actual libpq INTRANS/TLS and one cursor on the supplied connection throughout.
The old read-only inspector and its NOLOGIN verifier are never changed. A local
verifier explicitly checks owner identity plus NOLOGIN activation / LOGIN closure;
the unchanged collector verifies the pinned grant matrix and fixture catalog.

This is NOT full Gate A: owner approval, actual provider endpoint binding,
concurrent privileged actors, credentials, journal authority and external parent
supervision remain separate trusted-launcher obligations. Import is inert. There
is no connection factory, operational CLI, repair, GRANT or ALTER in this module.
"""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import publisher_role_transition as transition

ROOT=Path(__file__).resolve().parent
PINS={
    'publisher_test_readonly_inspection.py':'5feb20a9b4007fd7d65d4230a50f9055bb7dbfeb9053acbdc091363ae8f6d22d',
    'publisher_test_password_setup.py':'3f3e4cab7fa64b5890fda1483bc73ac277636f001ec933bf514c926267ef68fb',
    'publisher-test-readonly-queries.json':'99ac288ed3e1dd5681345aa828bed3e129e729a1430f9022ca456622b62e7789',
}
TRANSACTION_SQL="SELECT pg_catalog.pg_backend_pid(), pg_catalog.current_setting('transaction_read_only')::boolean"


def load_inputs():
    captured={}
    for name,digest in PINS.items():
        fd=os.open(ROOT/name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            info=os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0,os.getuid())
                    or info.st_mode & 0o022 or not 0 < info.st_size <= 262144):
                raise ValueError('prewrite source boundary')
            data=os.read(fd,262145)
            if len(data)!=info.st_size or hashlib.sha256(data).hexdigest()!=digest:
                raise ValueError('prewrite source pin')
            captured[name]=data
        finally: os.close(fd)
    def module(name):
        path=ROOT/name
        result=importlib.util.module_from_spec(importlib.util.spec_from_file_location('prewrite_'+path.stem,path))
        exec(compile(captured[name],str(path),'exec'),result.__dict__)
        return result
    inspector=module('publisher_test_readonly_inspection.py')
    original=module('publisher_test_password_setup.py')
    queries=json.loads(captured['publisher-test-readonly-queries.json'])
    catalog=inspector.load_catalog()  # Existing strict module/manifest pins and parser.
    return inspector,original,queries,catalog


def _rows(cursor,sql,count,width):
    cursor.execute(sql)
    rows=cursor.fetchmany(count+1)
    if type(rows) is not list or len(rows)!=count or any(type(r) is not tuple or len(r)!=width for r in rows):
        raise ValueError('prewrite observation shape')
    return rows


class _DirectionVerifier:
    ROLES=transition.cycle.ROLES
    def __init__(self,original,login): self.original,self.login=original,login
    def verify(self,cursor,baseline):
        row=_rows(cursor,self.original.IDENTITY_SQL,1,13)[0]
        if (row[:3]!=('publisher_ledger','publisher_owner','publisher_owner')
                or type(row[3]) is not int or row[3]!=160015
                or row[4:6]!=('pg_catalog','')
                or type(row[6]) is not int or row[6]!=baseline['owner_oid']
                or row[7] is not True or row[8] is not False
                or any(type(v) is not int for v in row[9:12]) or row[9:12]!=(1,1,2)):
            raise ValueError('prewrite owner identity')
        # pg_stat_ssl is a server/proxy-hop observation, not client TLS proof.
        rows=_rows(cursor,self.original.ROLE_SQL,3,10)
        roles={}
        for row in rows:
            if type(row[0]) is not str or row[0] not in self.ROLES or row[0] in roles:
                raise ValueError('prewrite role identity')
            roles[row[0]]=dict(zip(('oid','login')+transition.cycle.FLAGS,row[1:]))
        memberships=_rows(cursor,self.original.MEMBERSHIP_SQL,3,6)
        snapshot={'roles':roles,'memberships':[dict(zip(
            ('role_oid','member_oid','grantor_oid','admin','inherit','set'),row)) for row in memberships]}
        transition.cycle.validate_snapshot(baseline,snapshot,self.login)


class CatalogPrewrite:
    def __init__(self,baseline):
        transition.cycle.validate_baseline(baseline)
        self.baseline=copy.deepcopy(baseline)
        self.inspector,self.original,self.queries,self.catalog=load_inputs()
        self.last_report=None

    @staticmethod
    def _transaction(connection,cursor,expected_pid=None):
        pgconn=getattr(connection,'pgconn',None)
        if (getattr(pgconn,'ssl_in_use',None) is not True
                or type(getattr(pgconn,'transaction_status',None)) is not int
                or pgconn.transaction_status!=2):
            raise ValueError('prewrite requires TLS INTRANS')
        rows=_rows(cursor,TRANSACTION_SQL,1,2)
        pid,read_only=rows[0]
        if (type(pid) is not int or pid<=0 or read_only is not False
                or type(getattr(pgconn,'backend_pid',None)) is not int or pid!=pgconn.backend_pid
                or (expected_pid is not None and pid!=expected_pid)):
            raise ValueError('prewrite transaction identity')
        return pid

    def __call__(self,connection,binding):
        self.last_report=None
        transition.validate_binding(binding,binding)  # Shape/fixed scope, not authority.
        cursor=connection.cursor()
        pid=self._transaction(connection,cursor)
        verifier=_DirectionVerifier(self.original,binding['direction']=='closure')
        report=self.inspector.collect(cursor,verifier,self.baseline,self.queries,self.catalog)
        self._transaction(connection,cursor,pid)
        self.last_report={**report,'kind':'ROLE_PREWRITE_CATALOG_OBSERVATION',
                          'direction':binding['direction'],'catalogGrantsRolesVerified':True,
                          'sameWriteTransactionObserved':True,'fullGateAEstablished':False,
                          'productionTargetValidated':False,'evidenceAuthenticated':False,
                          'activationAuthorized':False,'parentSupervisorCompletionEstablished':False}

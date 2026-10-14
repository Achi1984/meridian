"""Explicit v2 review evidence contract. Source-only caller claims, no execution."""
import hashlib
import importlib.util
import json
import pathlib
import re

_spec=importlib.util.spec_from_file_location('evidence_transport',pathlib.Path(__file__).resolve().parents[1]/'fixtures'/'structured-review-transport.py')
_transport=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_transport)
MAX_BODY=16384
FLAGS=('authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable')


def need(ok,code):
    if not ok:raise ValueError(code)

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False)
def digest(value):return hashlib.sha256(canonical(value).encode()).hexdigest()
def hex64(value):return type(value) is str and re.fullmatch(r'[a-f0-9]{64}',value)
def ident(value):return type(value) is str and re.fullmatch(r'[a-z][a-z0-9-]{2,63}',value)
def shape(value,keys):need(type(value) is dict and set(value)==set(keys),'ENVELOPE_SCHEMA')

def decode(raw,bound=MAX_BODY):
    need(type(raw) is str,'ENVELOPE_INPUT')
    try:need(len(raw.encode('utf-8'))<=bound,'ENVELOPE_BOUND')
    except UnicodeError:raise ValueError('ENVELOPE_UTF8')
    def pairs(items):
        obj={}
        for k,v in items:need(k not in obj,'DUPLICATE_JSON_KEY');obj[k]=v
        return obj
    def invalid(_):raise ValueError('JSON_NUMBER_INVALID')
    try:value=json.loads(raw,object_pairs_hook=pairs,parse_float=invalid,parse_constant=invalid)
    except (json.JSONDecodeError,RecursionError):raise ValueError('ENVELOPE_JSON')
    pending=[(value,0)];count=0
    while pending:
        item,depth=pending.pop();count+=1;need(count<=2048 and depth<=7,'ENVELOPE_BOUND')
        if type(item) is dict:pending.extend((v,depth+1) for v in item.values())
        elif type(item) is list:need(len(item)<=32,'ENVELOPE_BOUND');pending.extend((v,depth+1) for v in item)
        elif type(item) is str:
            try:need(len(item.encode('utf-8'))<=8192,'ENVELOPE_BOUND')
            except UnicodeError:raise ValueError('ENVELOPE_UTF8')
        elif type(item) is int:need(abs(item)<=9007199254740991,'JSON_NUMBER_INVALID')
        else:need(item is None or type(item) is bool,'ENVELOPE_JSON')
    return value

def policy_checked(raw):
    policy=decode(raw,4096);shape(policy,('requiredChecks',));rows=policy['requiredChecks']
    need(type(rows) is list and 1<=len(rows)<=16,'REQUIRED_POLICY_BOUND');seen=set();out=[]
    for row in rows:
        shape(row,('id','commandSha256'));need(ident(row['id']) and row['id'] not in seen and hex64(row['commandSha256']),'REQUIRED_POLICY_INVALID')
        seen.add(row['id']);out.append(dict(row))
    return {'requiredChecks':sorted(out,key=lambda r:r['id'])}

def validate_envelope(body_raw,expected_scope_raw,required_policy_raw):
    envelope=decode(body_raw);shape(envelope,('schemaVersion','policySha256','claim','assessment','evidenceSha256'))
    need(type(envelope['schemaVersion']) is int and envelope['schemaVersion']==2,'ENVELOPE_VERSION')
    policy=policy_checked(required_policy_raw)
    need(hex64(envelope['policySha256']) and envelope['policySha256']==digest(policy),'REQUIRED_POLICY_MISMATCH')
    payload={k:v for k,v in envelope.items() if k!='evidenceSha256'}
    need(hex64(envelope['evidenceSha256']) and envelope['evidenceSha256']==digest(payload),'EVIDENCE_DIGEST_MISMATCH')
    # Reuse unchanged v1 scope/PR/CI/verdict validation, including duplicate-key transport.
    checked=_transport.validate_received(canonical(envelope['claim']),expected_scope_raw)
    expected=_transport.strict_object(expected_scope_raw)
    assessment=envelope['assessment'];shape(assessment,('findings','checks'))
    findings=assessment['findings'];need(type(findings) is list and len(findings)<=16,'FINDINGS_BOUND');blocking=False
    for finding in findings:
        shape(finding,('severity','text'));need(finding['severity'] in ('blocking','advisory'),'FINDING_SEVERITY')
        text=finding['text'];need(type(text) is str and text.strip() and '\x00' not in text and len(text.encode('utf-8'))<=512,'FINDING_TEXT')
        blocking=blocking or finding['severity']=='blocking'
    checks=assessment['checks'];need(type(checks) is list and len(checks)<=16,'CHECKS_BOUND')
    required={r['id']:r['commandSha256'] for r in policy['requiredChecks']};seen=set();all_passed=True
    fields=('id','commandSha256','executed','status','exitCode','evidenceSha256','headSha','baseSha','requestId','opId','prNumber','ci')
    for check in checks:
        shape(check,fields);need(ident(check['id']) and check['id'] not in seen,'CHECK_DUPLICATE_OR_ID');seen.add(check['id'])
        need(check['id'] in required and check['commandSha256']==required[check['id']],'CHECK_POLICY_MISMATCH')
        need(all(type(check[k]) is type(expected[k]) and check[k]==expected[k] for k in ('headSha','baseSha','requestId','opId','prNumber')),'CHECK_SCOPE_MISMATCH')
        shape(check['ci'],('runId','runAttempt','workflowId','headSha'))
        need(all(type(check['ci'][k]) is type(expected['ci'][k]) and check['ci'][k]==expected['ci'][k] for k in check['ci']),'CHECK_CI_MISMATCH')
        need(type(check['executed']) is bool and check['status'] in ('passed','failed','not_executed'),'CHECK_STATUS_INVALID')
        if check['status']=='not_executed':need(check['executed'] is False and check['exitCode'] is None and check['evidenceSha256'] is None,'CHECK_EXECUTION_CONFLICT')
        else:
            need(check['executed'] is True and type(check['exitCode']) is int and 0<=check['exitCode']<=255 and hex64(check['evidenceSha256']),'CHECK_EXECUTION_CONFLICT')
            need((check['status']=='passed')==(check['exitCode']==0),'CHECK_EXIT_CONFLICT')
        all_passed=all_passed and check['status']=='passed'
    verdict=checked['verdict']
    if verdict=='GREEN_LIGHT':
        need(not blocking,'GREEN_BLOCKING_FINDINGS');need(seen==set(required),'MANDATORY_CHECK_MISSING');need(all_passed,'MANDATORY_CHECK_NOT_PASSED')
    else:need(len(findings)>0,'NON_GREEN_FINDING_REQUIRED')
    return {'kind':'UNVERIFIED_REVIEW_EVIDENCE','claim':envelope['claim'],'assessment':assessment,'verdict':verdict,
            'bodySha256':hashlib.sha256(body_raw.encode('utf-8')).hexdigest(),'evidenceSha256':envelope['evidenceSha256'],
            'policySha256':envelope['policySha256'],**{k:False for k in FLAGS}}

def produce_envelope(claim_raw,assessment_raw,expected_scope_raw,required_policy_raw):
    """No default verdict or checks. Serialize only a fully supplied explicit assessment."""
    claim=decode(claim_raw);assessment=decode(assessment_raw);policy=policy_checked(required_policy_raw)
    envelope={'schemaVersion':2,'policySha256':digest(policy),'claim':claim,'assessment':assessment}
    envelope['evidenceSha256']=digest(envelope);body=canonical(envelope)
    validate_envelope(body,expected_scope_raw,required_policy_raw)
    return body

def prepare_negative_publication(body_raw,expected_scope_raw,required_policy_raw,expected_body_sha256):
    """Offline candidate only. No publisher, actor authentication or execution.

    Preserve the original bytes; never strip an action wrapper or repair JSON.
    This stricter preparation mode does not change the general review validator.
    """
    checked=validate_envelope(body_raw,expected_scope_raw,required_policy_raw)
    need(hex64(expected_body_sha256) and checked['bodySha256']==expected_body_sha256,'PUBLICATION_BODY_MISMATCH')
    need(checked['verdict']=='REVISION_REQUIRED','PUBLICATION_NEGATIVE_ONLY')
    policy=policy_checked(required_policy_raw)
    checks=checked['assessment']['checks']
    need({r['id'] for r in checks}=={r['id'] for r in policy['requiredChecks']},'PUBLICATION_COMPLETE_POLICY')
    need(all(r['status']=='not_executed' and r['executed'] is False and
             r['exitCode'] is None and r['evidenceSha256'] is None for r in checks),'PUBLICATION_UNEXECUTED_ONLY')
    marker='COMPATIBILITY-ONLY SUPPLIED TEST DATA'
    need(any(f['severity']=='blocking' and marker in f['text'] for f in checked['assessment']['findings']),'PUBLICATION_TEST_MARKER')
    need('@claude' not in body_raw.lower() and 'CROSS_MODEL_REQUEST' not in body_raw.upper(),'PUBLICATION_TRIGGER_FORBIDDEN')
    return {'kind':'OFFLINE_NEGATIVE_PUBLICATION_CANDIDATE','body':body_raw,
            'bodySha256':checked['bodySha256'],'policySha256':checked['policySha256'],
            'verdict':checked['verdict'],**{k:False for k in FLAGS}}

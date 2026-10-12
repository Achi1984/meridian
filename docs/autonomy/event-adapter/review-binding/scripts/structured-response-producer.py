"""Offline serialization only; never a reviewer, collector or approval mechanism."""
import hashlib
import importlib.util
import json
import pathlib

_spec=importlib.util.spec_from_file_location('producer_transport',pathlib.Path(__file__).resolve().parents[1]/'fixtures'/'structured-review-transport.py')
_transport=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_transport)
VERDICTS=frozenset(('GREEN_LIGHT','NEEDS_MORE_EVIDENCE','REVISION_REQUIRED','CHANGES_REQUIRED','STALE_HEAD'))


def need(value,code):
    if not value:
        raise ValueError(code)


def produce_response(scope_raw, verdict, findings, ci_state_raw):
    """Require explicit reviewer assessment and separately collected scope/CI.

    Findings remain outside the existing strict claim schema, in an explicit
    evidence sidecar. The body must be published together with that separately
    preserved evidence by any future approved producer. No default verdict.
    """
    scope=_transport.strict_object(scope_raw)
    state=_transport.strict_object(ci_state_raw)
    need(set(scope)=={'repository','requestId','opId','headSha','baseSha','prNumber','ci'},'SCOPE_SCHEMA')
    need(type(scope['ci']) is dict and set(scope['ci'])=={'runId','runAttempt','workflowId','headSha'},'CI_PIN_SCHEMA')
    need(set(state)=={'status','conclusion'},'CI_STATE_SCHEMA')
    need(type(verdict) is str and verdict in VERDICTS,'EXPLICIT_VERDICT_REQUIRED')
    need(type(findings) is list and len(findings)<=32,'FINDINGS_BOUND')
    clean=[]
    for finding in findings:
        need(type(finding) is dict and set(finding)=={'severity','text'},'FINDING_SCHEMA')
        need(type(finding['severity']) is str and finding['severity'] in ('blocking','advisory'),'FINDING_SEVERITY')
        text=finding['text']
        need(type(text) is str and 0<len(text.strip()) and len(text.encode('utf-8'))<=2048 and '\x00' not in text,'FINDING_TEXT')
        clean.append({'severity':finding['severity'],'text':text})
    need(verdict!='GREEN_LIGHT' or all(f['severity']!='blocking' for f in clean),'GREEN_BLOCKING_FINDINGS')
    need(verdict=='GREEN_LIGHT' or len(clean)>0,'NON_GREEN_REASON_REQUIRED')
    claim={'schemaVersion':1,**scope,'verdict':verdict,'ci':{**scope['ci'],**state}}
    body=json.dumps(claim,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
    # Existing exact scope, CI and explicit-verdict contract is authoritative.
    checked=_transport.validate_received(body,scope_raw)
    need(checked['verdict']==verdict,'VERDICT_CHANGED')
    body_digest=hashlib.sha256(body.encode()).hexdigest()
    assessment={'scope':scope,'bodySha256':body_digest,'verdict':verdict,'findings':clean}
    sidecar=json.dumps(assessment,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
    return {'kind':'OFFLINE_STRUCTURED_RESPONSE','body':body,'bodySha256':body_digest,
            'assessment':assessment,'assessmentSha256':hashlib.sha256(sidecar.encode()).hexdigest(),
            'authenticated':False,'provenanceVerified':False,'authorized':False,'dispatchAllowed':False,'mergeAllowed':False,'durable':False}

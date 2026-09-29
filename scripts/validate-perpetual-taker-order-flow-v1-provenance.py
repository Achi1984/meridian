#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
audit=json.loads((ROOT/'research'/'perpetual-taker-order-flow-v1-provenance-audit.json').read_text())
result=json.loads((ROOT/'research'/'perpetual-taker-order-flow-v1-development-result.json').read_text())

errors=[]

def req(cond,msg):
    if not cond:
        errors.append(msg)

def blob(path):
    return subprocess.check_output(
        ['git','rev-parse',f'HEAD:{path}'],
        cwd=ROOT,text=True
    ).strip()

req(audit.get('ruleset')=='PERPETUAL-TAKER-ORDER-FLOW-V1-FROZEN','audit ruleset mismatch')
req(audit.get('status')=='PROVENANCE_AUDIT_FROZEN_AFTER_DEVELOPMENT_FAIL','audit status mismatch')
req(audit.get('executionImpact') is False,'executionImpact must remain false')

dev=audit.get('developmentEvidence',{})
req(dev.get('workflowRun')==36609900324,'workflow run mismatch')
req(dev.get('runCommit')=='88e7225eca567c516ea197c27254c82cb4775645','run commit mismatch')
req(dev.get('periods')==102,'audit periods mismatch')
req(dev.get('eligibleEveryWeek')==12,'audit eligibleEveryWeek mismatch')
req(dev.get('sideCountEveryWeek')==2,'audit sideCountEveryWeek mismatch')
req(dev.get('dataIntegrityFailure') is False,'audit must record no data integrity failure')
req(dev.get('holdoutLoaded') is False,'audit must record holdout unloaded')
req(dev.get('postDevelopmentDataLoaded') is False,'audit must record no post-development data')
req(dev.get('decision')=='DEVELOPMENT_FAIL_RESEARCH_REDESIGN','audit decision mismatch')
req(dev.get('holdoutAuthorized') is False,'audit must keep holdout unauthorized')

req(result.get('workflowRun')==dev.get('workflowRun'),'frozen result workflow differs from audit')
req(result.get('commit')==dev.get('runCommit'),'frozen result commit differs from audit')
req(result.get('periods')==102,'frozen result periods != 102')
req(result.get('eligibleEveryWeek')==12,'frozen result eligibleEveryWeek != 12')
req(result.get('sideCountEveryWeek')==2,'frozen result sideCountEveryWeek != 2')
req(result.get('dataIntegrityFailure') is False,'frozen result dataIntegrityFailure must be false')
req(result.get('holdoutLoaded') is False,'frozen result holdoutLoaded must be false')
req(result.get('postDevelopmentDataLoaded') is False,'frozen result postDevelopmentDataLoaded must be false')
req(result.get('decision')=='DEVELOPMENT_FAIL_RESEARCH_REDESIGN','frozen result must remain FAIL')
req(result.get('holdoutAuthorized') is False,'frozen result holdout must remain unauthorized')
req(result.get('immutable') is True,'frozen result must remain immutable')

# The audited V1 implementation is intentionally preserved after first PnL.
req(blob('research/perpetual_taker_order_flow_v1.py')==dev.get('engineBlobSha'),
    'V1 engine blob changed after frozen DEVELOPMENT result')
req(blob('research/run-perpetual-taker-order-flow-v1-development.py')==dev.get('developmentRunnerBlobSha'),
    'V1 development runner blob changed after frozen result')
req(blob('scripts/collect-perpetual-taker-order-flow-v1-development.py')==dev.get('developmentCollectorBlobSha'),
    'V1 development collector blob changed after frozen result')

findings={x.get('id'):x for x in audit.get('findings',[])}
req('OFV1-PROV-001' in findings,'missing future-availability provenance finding')
req('OFV1-PROV-002' in findings,'missing holdout-guard provenance finding')
req(findings.get('OFV1-PROV-001',{}).get('observedRunImpact')=='NO_OBSERVED_ELIGIBILITY_OR_RANKING_IMPACT',
    'future-availability finding impact classification changed')
req(findings.get('OFV1-PROV-002',{}).get('observedRunImpact')=='NO_HOLDOUT_CONTAMINATION_OBSERVED',
    'holdout finding impact classification changed')

disp=audit.get('disposition',{})
req(disp.get('v1Result')=='IMMUTABLE_DEVELOPMENT_FAIL','V1 disposition changed')
req(disp.get('rerunAuthorized') is False,'V1 rerun must remain unauthorized')
req(disp.get('temporalHoldoutAuthorized') is False,'V1 holdout must remain unauthorized')
req(disp.get('retroactiveEngineMutationAuthorized') is False,'retroactive V1 engine mutation must remain unauthorized')
req(disp.get('paperAuthorized') is False,'Paper must remain unauthorized')
req(disp.get('liveAuthorized') is False,'live must remain unauthorized')

if errors:
    for e in errors:
        print('FAIL:',e)
    raise SystemExit(1)

print('Taker Order Flow V1 provenance audit: GREEN')

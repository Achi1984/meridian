#!/usr/bin/env python3
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
state=json.loads((ROOT/'MERIDIAN_AGENT_STATE.json').read_text())
resume=json.loads((ROOT/'MERIDIAN_RESUME.json').read_text())

errors=[]

def req(cond,msg):
    if not cond:
        errors.append(msg)

req(state.get('schema')==1,'agent state schema must be 1')
req(state.get('protocolVersion')==1,'agent protocolVersion must be 1')
req(state.get('protocolPath')=='docs/AGENT_ORCHESTRATION.md','protocol path mismatch')
req(state.get('sourceOfTruth')=='REPOSITORY_NOT_CHAT_STREAM','chat stream must not be source of truth')
req(state.get('mergeOwner')=='MAIN_AGENT','merge owner must be MAIN_AGENT')
req(state.get('userCommunicationOwner')=='MAIN_AGENT','only MAIN_AGENT may communicate with user')
req(state.get('singleWriter') is True,'singleWriter must be true')
req(state.get('concurrentMergeAllowed') is False,'concurrent merge must be false')
req(state.get('maxReviewLoops')==3,'review loops must be exactly 3 max')

sg=state.get('streamingGuard',{})
req(1 <= int(sg.get('maxToolCallGroupsPerVisibleBurst',0)) <= 3,'visible burst tool-call group cap must be 1..3')
req(sg.get('checkpointBeforeLongOrIrreversibleStep') is True,'checkpoint-before-risk must be enabled')
req(sg.get('streamIsNeverSourceOfTruth') is True,'streamIsNeverSourceOfTruth must be true')
req(sg.get('repeatCompletedWritesAfterInterruption') is False,'completed writes must not be repeated after interruption')

routing=state.get('requestedModelRouting',{})
req(routing.get('mainAgent')=='GPT-6-Astra','requested main model routing changed')
req(routing.get('reviewer')=='GPT-6-Sol','requested reviewer model routing changed')
req(routing.get('subagentMinimum')=='GPT-6-Luna','requested subagent minimum routing changed')

cap=state.get('runtimeCapabilityPolicy',{})
req(cap.get('neverClaimUnavailableModelOrAgent') is True,'runtime honesty guard must be enabled')
req(cap.get('fallbackDisclosureRequired') is True,'fallback disclosure must be required')

expected_lifecycle=['RECONCILE','PLAN','ASSIGN','EXECUTE','REVIEW','INTEGRATE','GATE','MERGE','CHECKPOINT','REPORT']
req(state.get('lifecycle')==expected_lifecycle,'lifecycle mismatch')

coord=resume.get('coordination',{})
req(coord.get('mergeOwner')=='MAIN_AGENT','resume mergeOwner must remain MAIN_AGENT')
req(coord.get('singleWriter') is True,'resume singleWriter must remain true')
req(coord.get('concurrentMerge') is False,'resume concurrentMerge must remain false')
req(coord.get('orchestrationProtocol')=='docs/AGENT_ORCHESTRATION.md','resume orchestrationProtocol missing/mismatch')
req(coord.get('agentState')=='MERIDIAN_AGENT_STATE.json','resume agentState missing/mismatch')
req(coord.get('maxReviewLoops')==3,'resume maxReviewLoops must be 3')
req(coord.get('streamingIsNeverSourceOfTruth') is True,'resume streaming source-of-truth guard missing')
req(coord.get('resumeOnInterruption')=='RECONCILE_REPO_THEN_CONTINUE_FIRST_INCOMPLETE_STEP','resume interruption policy mismatch')

if errors:
    for e in errors:
        print('FAIL:',e)
    raise SystemExit(1)

print('MERIDIAN agent orchestration safety: GREEN')

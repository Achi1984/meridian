#!/usr/bin/env python3
import json
from pathlib import Path
from lead_lease_validation import validate_lead_lease

ROOT=Path(__file__).resolve().parents[1]
state=json.loads((ROOT/'MERIDIAN_AGENT_STATE.json').read_text())
resume=json.loads((ROOT/'MERIDIAN_RESUME.json').read_text())
version=json.loads((ROOT/'version.json').read_text())
lease=json.loads((ROOT/'MERIDIAN_LEAD_LEASE.json').read_text())

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
req(sg.get('checkpointBeforeLongOrIrreversibleStep') is True,'checkpoint-before-risk must be enabled')
req(sg.get('streamIsNeverSourceOfTruth') is True,'streamIsNeverSourceOfTruth must be true')
req(sg.get('repeatCompletedWritesAfterInterruption') is False,'completed writes must not be repeated after interruption')
req(sg.get('maxPayloadBytes')==4096,'stream payload budget must be 4096 bytes')
req(sg.get('checkpointAfterEveryMutation') is True,'checkpoint-after-mutation must be enabled')
req(sg.get('userVisibleCheckpointRequired') is True,'user-visible checkpoint must be required')
req(sg.get('longOperationSplitRequired') is True,'long operations must be split into bounded bursts')
req(sg.get('protocol')=='STREAM-SAFE-V8','agent-state stream-safe protocol must be V8')
req(int(sg.get('maxToolResultEchoChars',0)) <= 600,'tool-result echo cap must be <=600')
req(sg.get('maxMailboxTailComments')==5,'mailbox tail cap must be 5')
req(sg.get('waitingIsTerminalTurnState') is True,'WAITING must be terminal turn state')
req(sg.get('duplicateClaudeRequestPolicy')=='SAME_ID_AND_HEAD_ONLY_NO_REPOST','duplicate Claude policy mismatch')
req(sg.get('nextStepLineRequired') is True,'NEXT line must be required')

routing=state.get('requestedModelRouting',{})
req(routing.get('mainAgent')=='GPT-6-Astra','requested main model routing changed')
req(routing.get('reviewer')=='GPT-6-Sol','requested reviewer model routing changed')
req(routing.get('subagentMinimum')=='GPT-6-Luna','requested subagent minimum routing changed')
req(routing.get('scope')=='LEAD_INTERNAL_TARGETS_ONLY','requested model routing scope must be lead-internal only')
req(routing.get('crossModelProtocol')=='MERIDIAN_CROSS_MODEL_PROTOCOL.md','cross-model protocol path mismatch')
errors.extend(validate_lead_lease(lease,routing.get('reviewerCrossModel')))

cap=state.get('runtimeCapabilityPolicy',{})
req(cap.get('neverClaimUnavailableModelOrAgent') is True,'runtime honesty guard must be enabled')
req(cap.get('fallbackDisclosureRequired') is True,'fallback disclosure must be required')

pwp=state.get('parallelWritePolicy',{})
req(pwp.get('sameBranchConcurrentWritesAllowed') is False,'same-branch concurrent writes must be forbidden')
req(pwp.get('readOnlyParallelismAllowed') is True,'read-only parallelism should remain allowed')
req(pwp.get('separateBranchParallelismAllowed') is True,'separate-branch parallelism should remain allowed')
req(pwp.get('mergeSerialization')=='MAIN_AGENT_ONLY_ONE_AT_A_TIME','merge serialization policy mismatch')

expected_lifecycle=['RECONCILE','PLAN','ASSIGN','EXECUTE','REVIEW','INTEGRATE','GATE','MERGE','CHECKPOINT','REPORT']
req(state.get('lifecycle')==expected_lifecycle,'lifecycle mismatch')

wp_required=state.get('workPackageRequiredFields',[])
task_required=state.get('taskRequiredFields',[])
expected_wp={'id','title','status','baseMainSha','orchestrationBranch','executionMode','riskClass','tasks','reviewStatus','createdAt','lastCheckpoint'}
expected_task={'id','role','status','dependencies','allowedFiles','forbiddenFiles','acceptanceCriteria','reviewLoop','reviewVerdict'}
req(set(wp_required)==expected_wp,'workPackageRequiredFields mismatch')
req(set(task_required)==expected_task,'taskRequiredFields mismatch')

active=state.get('activeWorkPackage')
if active is not None:
    req(isinstance(active,dict),'activeWorkPackage must be object or null')
    if isinstance(active,dict):
        missing=expected_wp-set(active)
        req(not missing,'activeWorkPackage missing fields: '+','.join(sorted(missing)))
        tasks=active.get('tasks',[])
        req(isinstance(tasks,list) and len(tasks)>0,'activeWorkPackage tasks must be non-empty list')
        if isinstance(tasks,list):
            ids=[]
            for i,t in enumerate(tasks):
                req(isinstance(t,dict),f'task {i} must be object')
                if not isinstance(t,dict):
                    continue
                miss=expected_task-set(t)
                req(not miss,f'task {i} missing fields: '+','.join(sorted(miss)))
                ids.append(t.get('id'))
                loop=t.get('reviewLoop',0)
                req(isinstance(loop,int) and 0 <= loop <= 3,f'task {i} reviewLoop must be 0..3')
                verdict=t.get('reviewVerdict')
                req(verdict in (None,'GREEN','CHANGES_REQUIRED','BLOCKED','COMPAT_GREEN'),f'task {i} invalid reviewVerdict')
            req(len(ids)==len(set(ids)),'task IDs must be unique')

coord=resume.get('coordination',{})
req(coord.get('mergeOwner')=='MAIN_AGENT','resume mergeOwner must remain MAIN_AGENT')
req(coord.get('singleWriter') is True,'resume singleWriter must remain true')
req(coord.get('concurrentMerge') is False,'resume concurrentMerge must remain false')
req(coord.get('orchestrationProtocol')=='docs/AGENT_ORCHESTRATION.md','resume orchestrationProtocol missing/mismatch')
req(coord.get('agentState')=='MERIDIAN_AGENT_STATE.json','resume agentState missing/mismatch')
req(coord.get('maxReviewLoops')==3,'resume maxReviewLoops must be 3')
req(coord.get('streamingIsNeverSourceOfTruth') is True,'resume streaming source-of-truth guard missing')
req(coord.get('resumeOnInterruption')=='RECONCILE_REPO_THEN_CONTINUE_FIRST_INCOMPLETE_STEP','resume interruption policy mismatch')
req(resume.get('build')==version.get('terminalBuild'),'MERIDIAN_RESUME build must match version.json terminalBuild')
req(coord.get('streamSafeProtocol')=='STREAM-SAFE-V8','resume stream-safe protocol must be V8')
req(coord.get('compactBootstrap')=='MERIDIAN_LIVE_CHECKPOINT.json','compact bootstrap must be MERIDIAN_LIVE_CHECKPOINT.json')
req(coord.get('maxPayloadBytes')==4096,'resume stream payload budget must be 4096 bytes')
req(coord.get('waitingIsTerminalTurnState') is True,'resume must allow WAITING terminal turn')

checkpoint=json.loads((ROOT/'MERIDIAN_LIVE_CHECKPOINT.json').read_text())
req(checkpoint.get('protocol')=='STREAM-SAFE-V8','checkpoint protocol mismatch')
from work_package_policy import validate_policy
for label, policy in [('checkpoint',checkpoint.get('streamSafety',{})),('agent',sg),('resume',coord)]:
    errors.extend(label+': '+e for e in validate_policy(policy, label))

if errors:
    for e in errors:
        print('FAIL:',e)
    raise SystemExit(1)

print('MERIDIAN agent orchestration safety: GREEN')

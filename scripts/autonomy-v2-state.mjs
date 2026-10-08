// Pure, side-effect-free Autonomy V2 state machine. No workflow execution.
export const STATES=Object.freeze({QUEUED:'QUEUED',CLAIMED:'CLAIMED',IMPLEMENTING:'IMPLEMENTING',CI_CHECK:'CI_CHECK',REPAIR:'REPAIR',REVIEW_REQUESTED:'REVIEW_REQUESTED',REVIEW_GREEN:'REVIEW_GREEN',HUMAN_GATE:'HUMAN_GATE',BLOCKED:'BLOCKED_NEEDS_DECISION'});
const transitions={
 QUEUED:['CLAIMED','BLOCKED_NEEDS_DECISION'],
 CLAIMED:['IMPLEMENTING','BLOCKED_NEEDS_DECISION'],
 IMPLEMENTING:['CI_CHECK','BLOCKED_NEEDS_DECISION'],
 CI_CHECK:['REPAIR','REVIEW_REQUESTED','BLOCKED_NEEDS_DECISION'],
 REPAIR:['CI_CHECK','BLOCKED_NEEDS_DECISION'],
 REVIEW_REQUESTED:['REVIEW_GREEN','REPAIR','BLOCKED_NEEDS_DECISION'],
 REVIEW_GREEN:['HUMAN_GATE','BLOCKED_NEEDS_DECISION'],
 HUMAN_GATE:[],BLOCKED_NEEDS_DECISION:[]
};
const validSha=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);
export function transition(task,event){
 if(!task||!event||!Number.isSafeInteger(task.revision)||!Number.isSafeInteger(task.attempts))throw Error('invalid task');
 if(event.expectedRevision!==task.revision||!validSha(event.expectedHead)||event.expectedHead!==task.head||!validSha(task.base))throw Error('STALE_CAS');
 if(typeof event.opId!=='string'||!event.opId.trim())throw Error('MISSING_OP_ID');
 if(task.lastOpId===event.opId)throw Error('DUPLICATE_OP_ID');
 if(!transitions[task.state]?.includes(event.to))throw Error('INVALID_TRANSITION');
 if(event.to==='CLAIMED'&&(!event.writer||task.writer&&task.writer!==event.writer))throw Error('WRITER_CONFLICT');
 if(task.writer&&event.writer!==task.writer)throw Error('WRITER_CONFLICT');
 if(event.to==='REVIEW_GREEN'&&(!event.review||event.review.head!==task.head||event.review.base!==task.base||event.review.verdict!=='GREEN_LIGHT'))throw Error('STALE_REVIEW');
 if(event.to==='REVIEW_REQUESTED'&&event.ci!== 'SUCCESS_EXACT_HEAD')throw Error('CI_NOT_GREEN');
 let attempts=task.attempts;
 if(event.to==='REPAIR'){if(attempts>=3)throw Error('REPAIR_BUDGET_EXHAUSTED');attempts++;}
 return Object.freeze({...task,state:event.to,attempts,revision:task.revision+1,lastOpId:event.opId,writer:task.writer??event.writer??null});
}

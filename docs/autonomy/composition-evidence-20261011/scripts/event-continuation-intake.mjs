/** Pure offline normalization. A proposal is never a trusted receipt or command. */
import { createHash } from 'node:crypto';
export class IntakeError extends Error {
  constructor(code) { super(code); this.name = 'IntakeError'; this.code = code; }
}
const need = (ok, code) => { if (!ok) throw new IntakeError(code); };
const positive = x => Number.isSafeInteger(x) && x > 0;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const digest = text => createHash('sha256').update(text).digest('hex');
function parse(text, bytes) {
  need(typeof text === 'string' && text.isWellFormed() && Buffer.byteLength(text,'utf8') <= bytes, 'INPUT_LIMIT');
  let value; try { value = JSON.parse(text); } catch { throw new IntakeError('INVALID_JSON'); }
  const todo = [[value,0]]; let count = 0;
  while (todo.length) {
    const [item,depth] = todo.pop();
    need(++count <= 4096 && depth <= 12, 'INPUT_LIMIT');
    if (typeof item === 'string') need(item.isWellFormed(),'INVALID_UNICODE');
    if (item && typeof item === 'object') {
      for (const key of Object.keys(item)) {
        need(key.isWellFormed(),'INVALID_UNICODE');
        need(!['__proto__','constructor','prototype'].includes(key),'FORBIDDEN_KEY');
        todo.push([item[key],depth+1]);
      }
    }
  }
  need(record(value),'INVALID_OBJECT'); return value;
}
const timestamp = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x.replace('Z','.000Z');
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const conclusions = ['success','failure','neutral','cancelled','skipped','timed_out','action_required','stale','startup_failure'];

/** GitHub-shaped serialized data only; no transport, clock, queue or side effects. */
export function normalizeEvent(eventName, payloadJson, configJson) {
  const config = parse(configJson,4096), payload = parse(payloadJson,65536);
  need(Object.keys(config).length === 3 && ['repository','mailboxIssue','workflowIds'].every(k=>Object.hasOwn(config,k)), 'CONFIG_SCHEMA');
  need(config.repository === 'Achi1984/meridian' && positive(config.mailboxIssue)
    && Array.isArray(config.workflowIds) && config.workflowIds.length > 0 && config.workflowIds.length <= 32
    && config.workflowIds.every(positive) && new Set(config.workflowIds).size === config.workflowIds.length,'CONFIG_SCOPE');
  need(record(payload.repository) && payload.repository.full_name === config.repository
    && payload.repository.fork === false,'REPOSITORY_MISMATCH');
  let identity, revision, hint, claims;
  if (eventName === 'workflow_run') {
    const run = payload.workflow_run;
    need(payload.action === 'completed' && record(run) && run.status === 'completed','UNSUPPORTED_WORKFLOW_ACTION');
    need(positive(run.id) && positive(run.run_attempt) && positive(run.workflow_id)
      && config.workflowIds.includes(run.workflow_id),'WORKFLOW_SCOPE');
    need(record(run.head_repository) && run.head_repository.full_name === config.repository
      && run.head_repository.fork === false,'FORK_ORIGIN');
    need(typeof run.head_sha === 'string' && /^[a-f0-9]{40}$/.test(run.head_sha)
      && conclusions.includes(run.conclusion),'INVALID_WORKFLOW_RESULT');
    identity = `workflow-run:${config.repository}:${run.id}:${run.run_attempt}:completed`;
    claims = {runId:run.id,runAttempt:run.run_attempt,workflowId:run.workflow_id,headSha:run.head_sha,conclusion:run.conclusion};
    revision = digest(JSON.stringify(claims));
    hint = {method:'GET',path:`/repos/${config.repository}/actions/runs/${run.id}/attempts/${run.run_attempt}`};
  } else if (eventName === 'issue_comment') {
    const issue=payload.issue, comment=payload.comment;
    need(['created','edited','deleted'].includes(payload.action),'UNSUPPORTED_COMMENT_ACTION');
    need(record(issue) && issue.number === config.mailboxIssue && !Object.hasOwn(issue,'pull_request'),'MAILBOX_SCOPE');
    need(record(comment) && positive(comment.id) && typeof comment.body === 'string'
      && timestamp(comment.created_at) && timestamp(comment.updated_at)
      && comment.updated_at >= comment.created_at,'INVALID_COMMENT');
    // Body is opaque untrusted data, never parsed into a review verdict or instruction.
    const bodyDigest=digest(comment.body);
    identity=`mailbox-comment:${config.repository}:${issue.number}:${comment.id}`;
    claims={issueNumber:issue.number,commentId:comment.id,action:payload.action,
      createdAt:comment.created_at,updatedAt:comment.updated_at,bodyDigest};
    revision=digest(JSON.stringify(claims));
    hint={method:'GET',path:`/repos/${config.repository}/issues/comments/${comment.id}`};
  } else throw new IntakeError('UNSUPPORTED_EVENT');
  return freeze({proposal:'READ_ONLY_RECONCILE',eventName,repository:config.repository,
    eventIdentity:identity,revisionDigest:revision,deduplicationKey:identity+':'+revision,
    sourceHint:hint,claims,authenticated:false,provenanceVerified:false,authorized:false,
    dispatchAllowed:false,mergeAllowed:false,leaseAcquired:false,durableDeduplication:false});
}
